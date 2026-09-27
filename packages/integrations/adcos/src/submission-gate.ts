/**
 * @fleetos/integration-adcos — D3c: the policy-gated submission gate.
 *
 * Submitting a connectivity request is PROPOSAL-gated through the W031
 * Contract Guardian decision model (the injected
 * `AdcosGuardianEvaluateFn` seam — `@fleetos/policy`'s
 * `evaluateGuardianRequest` satisfies it structurally and is injected at
 * the binding site; proven by test against the REAL engine):
 *
 *   - ALLOW  submits — the translated request is dispatched through the
 *     injected transport seam, the acceptance lands as the SUBMITTED
 *     revision (opaque handle + connectivity id), and the adopted
 *     connectivity record is SEEDED (revision 1, bound to the intent);
 *   - WARN   submits with the warning context (non-blocking per the
 *     FROZEN `isBlockingDecision` helper — the reasons + matched rules
 *     ride the revision and the audit);
 *   - REQUIRE_APPROVAL parks the submission for human approval (the
 *     parked -> approved/rejected transitions are recorded as
 *     revisions; approval dispatches — the human approval IS the
 *     explicit grant; rejection terminals);
 *   - BLOCK  rejects with the Guardian's machine-stable reasons (the
 *     matched rule ids + reason codes carried verbatim).
 *
 *   NEVER auto-submit: nothing dispatches without the Guardian's
 *   advance (or a human approval of a parked submission). The gate
 *   evaluates EVERY submission uniformly — fail-closed policy authority
 *   (the request's consequential properties — budget, duration,
 *   security-relevant constraints — ride the submission record and its
 *   audit trail; the engine-matchable facets ride the evaluation).
 *
 * Submission identity is deterministic: resubmitting the same intent
 * with the same requirements REPLAYS the existing record (idempotent —
 * never re-evaluates, never re-dispatches).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import {
  asDeviceId,
  asWorkloadId,
  isBlockingDecision,
} from "@fleetos/contracts";
import type {
  CausationId,
  CorrelationId,
  DomainError,
  EvidenceRef,
  FleetError,
  GuardianDecision,
} from "@fleetos/contracts";
import { translateConnectivityIntent } from "./translation";
import type { AdcosConnectivityRequest } from "./request-model";
import type { AdcosProviderHandle } from "./provider-boundary";
import { isProviderNeutral } from "./provider-boundary";
import type { AdcosSubmissionAck, AdcosTransportPort } from "./transport-seam";
import type {
  AdcosGuardianEvaluateFn,
  AdcosGuardianPrincipal,
} from "./policy-seam";
import {
  ADCOS_SUBMISSION_ACTION,
  ADCOS_SUBMISSION_TARGET_KIND,
} from "./policy-seam";
import type {
  AdcosGuardianNetworkZone,
  AdcosEvaluationReason,
  AdcosMatchedRuleRef,
} from "./policy-seam";
import type { AdcosAuditSink } from "./audit-seam";
import { ADCOS_AUDIT_ACTIONS } from "./audit-seam";
import {
  SUBMISSION_APPROVED,
  SUBMISSION_PARKED,
  SUBMISSION_PROPOSED,
  SUBMISSION_REJECTED,
  SUBMISSION_SUBMITTED,
} from "./submission";
import type {
  AdcosSubmissionStore,
  ConnectivitySubmissionRecord,
  SubmissionRevision,
} from "./submission";
import { nextSubmissionRevision, submissionIdOf } from "./submission";
import type { AdcosConnectivityRecordStore, ConnectivityRecord } from "./adoption";
import { adoptionContentDigest } from "./adoption";
import { validateStatusReport } from "./status-model";
import {
  ADCOS_PIPELINE_CORRELATION_ID,
  ERROR_CODES,
  SYNTHETIC_SYSTEM_TENANT,
  frozen,
  makeDomainError,
  makeValidationError,
} from "./internal";
import type { AdcosTenantScope, ErrorTrace } from "./internal";
import { checkAdcosTenantScope } from "./internal";

// ---------------------------------------------------------------------------
// Options + results
// ---------------------------------------------------------------------------

/** The canonical network zones the Guardian request facet can carry (the closed twin). */
const CANONICAL_ZONES: readonly AdcosGuardianNetworkZone[] = [
  "corporate",
  "vpn",
  "trusted-partner",
  "public",
  "unknown",
];

/** Options for `submitConnectivityIntent`. */
export interface SubmitConnectivityOptions<R> {
  /** The injected submission instant (ISO 8601 — no clock reads). */
  readonly at: string;
  /** The correlation id of the submission request. */
  readonly correlationId: CorrelationId;
  /** The causation id, when the submission is caused by a specific command/event. */
  readonly causationId?: CausationId;
  /** The compiled Guardian rule set (injected at the binding site). */
  readonly ruleSet: R;
  /** The injected Guardian evaluation function (the REAL engine at the binding site). */
  readonly evaluator: AdcosGuardianEvaluateFn<R>;
  /** The injected provider transport (the D2 seam). */
  readonly transport: AdcosTransportPort;
  /** The injected audit sink (consequential mutations emit). */
  readonly auditSink?: AdcosAuditSink;
  /** The acting principal, when the submission is user-initiated (observable facts). */
  readonly principal?: AdcosGuardianPrincipal;
  /** Observable evidence artifacts supporting the request's facts. */
  readonly evidence?: readonly EvidenceRef[];
}

/** The tagged submission result. */
export type SubmissionResult =
  | {
      readonly ok: true;
      readonly record: ConnectivitySubmissionRecord;
      /** True when the deterministic submission id already existed (idempotent replay). */
      readonly replayed: boolean;
      /** The seeded/adopted connectivity record, set when the dispatch succeeded. */
      readonly connectivityRecord: ConnectivityRecord | null;
    }
  | { readonly ok: false; readonly error: FleetError };

/** Options for the human-approval flows. */
export interface ApprovalOptions {
  /** The injected decision instant (ISO 8601 — no clock reads). */
  readonly at: string;
  /** The correlation id of the approval request. */
  readonly correlationId: CorrelationId;
  /** The injected provider transport (dispatch on approval). */
  readonly transport: AdcosTransportPort;
  /** The injected audit sink. */
  readonly auditSink?: AdcosAuditSink;
}

// ---------------------------------------------------------------------------
// The submission gate
// ---------------------------------------------------------------------------

/**
 * Translate + policy-gate + dispatch a ConnectivityIntent submission:
 *
 *   1. TRANSLATE (pure D1): the frozen envelope + requirements become
 *      the typed request — a malformed/unsupported intent is refused
 *      with machine-stable reasons BEFORE any state exists (no record,
 *      no audit — the frozen error taxonomy carries the trace);
 *   2. REPLAY CHECK: the deterministic submission id already exists ->
 *      idempotent replay of the existing record (never re-evaluates,
 *      never re-dispatches);
 *   3. PROPOSE (revision 1, audited);
 *   4. GATE through the injected Guardian (the D3a structural seam);
 *   5. DISPATCH on the Guardian's advance (ALLOW/WARN) — the acceptance
 *      lands as the SUBMITTED revision and the connectivity record is
 *      seeded; a provider refusal lands as REJECTED with the typed
 *      refusal; REQUIRE_APPROVAL parks; BLOCK rejects.
 */
export function submitConnectivityIntent<R>(
  scope: AdcosTenantScope,
  submissionStore: AdcosSubmissionStore,
  recordStore: AdcosConnectivityRecordStore,
  intent: unknown,
  requirements: unknown,
  opts: SubmitConnectivityOptions<R>,
): SubmissionResult {
  const tenantCheck = checkAdcosTenantScope(scope);
  if (!tenantCheck.ok) {
    return {
      ok: false,
      error: gateError(
        ERROR_CODES.submissionInvalid,
        `submission refused: ${tenantCheck.reason}`,
        { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: opts.correlationId },
        tenantCheck.reason,
      ),
    };
  }
  if (tenantCheck.tenantId !== scope.tenantId) {
    return {
      ok: false,
      error: gateError(
        ERROR_CODES.submissionInvalid,
        "submission refused: invalid tenant id",
        { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: opts.correlationId },
        "invalid_tenant_id",
      ),
    };
  }
  const trace: ErrorTrace = { tenantId: tenantCheck.tenantId, correlationId: opts.correlationId };

  // 1. Translate (pure).
  const translation = translateConnectivityIntent(intent, requirements, opts.correlationId);
  if (!translation.ok) {
    return { ok: false, error: translation.error };
  }
  const request = translation.request;
  if (request.tenantId !== tenantCheck.tenantId) {
    // The envelope's tenant must match the acting scope — cross-tenant
    // submission is impossible by construction.
    return {
      ok: false,
      error: gateError(
        ERROR_CODES.submissionInvalid,
        "submission refused: intent tenant does not match the acting scope",
        trace,
        "tenant_mismatch",
      ),
    };
  }

  // 2. Replay check (idempotent by deterministic identity).
  const submissionId = submissionIdOf(request);
  const existing = submissionStore.get(scope, submissionId);
  if (existing.ok) {
    const head = existing.value.revisions[existing.value.revisions.length - 1];
    let connectivityRecord: ConnectivityRecord | null = null;
    if (head !== undefined && head.connectivityId !== null) {
      const lookup = recordStore.get(scope, head.connectivityId);
      if (lookup.ok) {
        connectivityRecord = lookup.value;
      }
    }
    return {
      ok: true,
      record: existing.value,
      replayed: true,
      connectivityRecord,
    };
  }

  // 3. Propose (revision 1, audited).
  const proposedRevision = nextSubmissionRevision([], {
    status: SUBMISSION_PROPOSED,
    at: opts.at,
  });
  const proposal: ConnectivitySubmissionRecord = frozen({
    tenantId: tenantCheck.tenantId,
    submissionId,
    request,
    status: SUBMISSION_PROPOSED,
    revisions: frozen([proposedRevision]),
  });
  const opened = submissionStore.open(scope, proposal);
  if (!opened.ok) {
    return { ok: false, error: opened.error };
  }
  emitAudit(opts.auditSink, {
    action: ADCOS_AUDIT_ACTIONS.submissionProposed,
    tenantId: tenantCheck.tenantId,
    subject: submissionId,
    occurredAt: opts.at,
    correlationId: opts.correlationId,
    details: {
      intentId: request.intentRef.intentId,
      outcome: request.outcome.canonical,
      requestDigest: request.requestDigest,
      budgetRef: request.budget.budgetRef ?? null,
      policyRefCount: request.budget.policyRefs.length,
      encryption: request.security.encryption,
      privateRouting: request.security.privateRouting,
      durationStartAt: request.duration.startAt,
      durationIndefinite: request.duration.indefinite ?? false,
    },
  });

  // 4. Gate through the injected Guardian.
  const evaluation = opts.evaluator(
    opts.ruleSet,
    guardianRequestOf(request, opts),
    { at: opts.at, correlationId: opts.correlationId, causationId: opts.causationId },
  );
  if (!evaluation.ok) {
    // The evaluation itself failed (e.g. a tenant-mismatched rule set):
    // the submission is rejected carrying the FleetError verbatim.
    const revision = nextSubmissionRevision([proposedRevision], {
      status: SUBMISSION_REJECTED,
      at: opts.at,
      error: evaluation.error,
    });
    return finalizeRejection(scope, submissionStore, proposal, revision, evaluation.error.code, opts, trace);
  }

  const decision = evaluation.evaluation.decision;
  const reasons = evaluation.evaluation.reasons;
  const matchedRules = evaluation.evaluation.matchedRules;

  if (decision.decision === "BLOCK") {
    const revision = nextSubmissionRevision([proposedRevision], {
      status: SUBMISSION_REJECTED,
      at: opts.at,
      decision,
      reasons,
      matchedRules,
    });
    return finalizeRejection(
      scope,
      submissionStore,
      proposal,
      revision,
      "guardian_block",
      opts,
      trace,
      decision,
      reasons,
      matchedRules,
    );
  }

  if (decision.decision === "REQUIRE_APPROVAL") {
    const revision = nextSubmissionRevision([proposedRevision], {
      status: SUBMISSION_PARKED,
      at: opts.at,
      decision,
      reasons,
      matchedRules,
    });
    const appended = submissionStore.append(scope, submissionId, revision);
    if (!appended.ok) {
      return { ok: false, error: appended.error };
    }
    emitAudit(opts.auditSink, {
      action: ADCOS_AUDIT_ACTIONS.submissionParked,
      tenantId: tenantCheck.tenantId,
      subject: submissionId,
      occurredAt: opts.at,
      correlationId: opts.correlationId,
      details: guardianDetails(decision, reasons, matchedRules, {
        intentId: request.intentRef.intentId,
        outcome: request.outcome.canonical,
        requestDigest: request.requestDigest,
      }),
    });
    return { ok: true, record: appended.value, replayed: false, connectivityRecord: null };
  }

  // ALLOW / WARN — the Guardian's advance (WARN is non-blocking per the
  // FROZEN `isBlockingDecision` helper; the warning context rides the
  // revision + audit).
  if (isBlockingDecision(decision.decision)) {
    // Unreachable for the frozen decision types (BLOCK and
    // REQUIRE_APPROVAL are handled above) — fail-closed by construction.
    return {
      ok: false,
      error: gateError(
        ERROR_CODES.submissionInvalid,
        `submission refused: blocking decision ${decision.decision} never dispatches`,
        trace,
        "blocking_decision",
      ),
    };
  }
  return dispatchSubmission(
    scope,
    submissionStore,
    recordStore,
    proposal,
    decision,
    reasons,
    matchedRules,
    opts,
    trace,
  );
}

// ---------------------------------------------------------------------------
// The human-approval flows (parked -> approved/rejected)
// ---------------------------------------------------------------------------

/**
 * Approve a parked submission (the explicit human grant) and dispatch
 * it: the APPROVED revision is recorded, then the translated request is
 * dispatched through the transport (a provider refusal lands as
 * REJECTED with the typed refusal). Only a PARKED submission can be
 * approved.
 */
export function approveSubmission(
  scope: AdcosTenantScope,
  submissionStore: AdcosSubmissionStore,
  recordStore: AdcosConnectivityRecordStore,
  submissionId: string,
  opts: ApprovalOptions,
): SubmissionResult {
  const tenantCheck = checkAdcosTenantScope(scope);
  if (!tenantCheck.ok) {
    return {
      ok: false,
      error: gateError(
        ERROR_CODES.submissionInvalid,
        `approval refused: ${tenantCheck.reason}`,
        { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: opts.correlationId },
        tenantCheck.reason,
      ),
    };
  }
  const trace: ErrorTrace = { tenantId: tenantCheck.tenantId, correlationId: opts.correlationId };
  const existing = submissionStore.get(scope, submissionId);
  if (!existing.ok) {
    return { ok: false, error: notFound(submissionId, trace) };
  }
  const record = existing.value;
  if (record.status !== SUBMISSION_PARKED) {
    return {
      ok: false,
      error: gateError(
        ERROR_CODES.submissionIllegalTransition,
        `approval refused: submission is ${record.status}, not PARKED`,
        trace,
        "illegal_transition",
      ),
    };
  }

  const head = record.revisions[record.revisions.length - 1];
  const approvedRevision = nextSubmissionRevision(record.revisions, {
    status: SUBMISSION_APPROVED,
    at: opts.at,
    decision: head.decision,
    reasons: head.reasons,
    matchedRules: head.matchedRules,
  });
  const approved = submissionStore.append(scope, submissionId, approvedRevision);
  if (!approved.ok) {
    return { ok: false, error: approved.error };
  }
  emitAudit(opts.auditSink, {
    action: ADCOS_AUDIT_ACTIONS.submissionApproved,
    tenantId: tenantCheck.tenantId,
    subject: submissionId,
    occurredAt: opts.at,
    correlationId: opts.correlationId,
    details: {
      intentId: record.request.intentRef.intentId,
      outcome: record.request.outcome.canonical,
      requestDigest: record.request.requestDigest,
    },
  });

  return dispatchSubmission(
    scope,
    submissionStore,
    recordStore,
    approved.value,
    head.decision,
    head.reasons,
    head.matchedRules,
    opts,
    trace,
  );
}

/**
 * Reject a parked submission (the human rejection terminal). Only a
 * PARKED submission can be rejected.
 */
export function rejectSubmission(
  scope: AdcosTenantScope,
  submissionStore: AdcosSubmissionStore,
  submissionId: string,
  opts: { readonly at: string; readonly correlationId: CorrelationId; readonly auditSink?: AdcosAuditSink },
): SubmissionResult {
  const tenantCheck = checkAdcosTenantScope(scope);
  if (!tenantCheck.ok) {
    return {
      ok: false,
      error: gateError(
        ERROR_CODES.submissionInvalid,
        `rejection refused: ${tenantCheck.reason}`,
        { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: opts.correlationId },
        tenantCheck.reason,
      ),
    };
  }
  const trace: ErrorTrace = { tenantId: tenantCheck.tenantId, correlationId: opts.correlationId };
  const existing = submissionStore.get(scope, submissionId);
  if (!existing.ok) {
    return { ok: false, error: notFound(submissionId, trace) };
  }
  const record = existing.value;
  if (record.status !== SUBMISSION_PARKED) {
    return {
      ok: false,
      error: gateError(
        ERROR_CODES.submissionIllegalTransition,
        `rejection refused: submission is ${record.status}, not PARKED`,
        trace,
        "illegal_transition",
      ),
    };
  }
  const head = record.revisions[record.revisions.length - 1];
  const revision = nextSubmissionRevision(record.revisions, {
    status: SUBMISSION_REJECTED,
    at: opts.at,
    decision: head.decision,
    reasons: head.reasons,
    matchedRules: head.matchedRules,
  });
  return finalizeRejection(
    scope,
    submissionStore,
    record,
    revision,
    "human_rejection",
    opts,
    trace,
    head.decision,
    head.reasons,
    head.matchedRules,
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** The approval options double as dispatch options (transport + audit + time). */
type DispatchOptions = {
  readonly at: string;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
  readonly transport: AdcosTransportPort;
  readonly auditSink?: AdcosAuditSink;
};

/**
 * Dispatch a granted submission through the transport: the acceptance
 * lands as the SUBMITTED revision + the seeded connectivity record; a
 * provider refusal lands as REJECTED with the typed refusal. The
 * provider-neutral boundary is enforced on the ack (a non-neutral
 * provider value is refused — never recorded).
 */
function dispatchSubmission(
  scope: AdcosTenantScope,
  submissionStore: AdcosSubmissionStore,
  recordStore: AdcosConnectivityRecordStore,
  granted: ConnectivitySubmissionRecord,
  decision: GuardianDecision | null,
  reasons: readonly AdcosEvaluationReason[],
  matchedRules: readonly AdcosMatchedRuleRef[],
  opts: DispatchOptions,
  trace: ErrorTrace,
): SubmissionResult {
  const request = granted.request;

  // The provider-neutral boundary applies to the outbound request too
  // (defense in depth — the translated request is plain data by
  // construction; a future seam regression is caught here, never forwarded).
  const neutrality = isProviderNeutral(request);
  if (!neutrality.ok) {
    const revision = nextSubmissionRevision(granted.revisions, {
      status: SUBMISSION_REJECTED,
      at: opts.at,
      decision,
      reasons,
      matchedRules,
      error: makeValidationError(
        ERROR_CODES.submissionInvalid,
        "dispatch refused: the request violates the provider-neutral boundary",
        trace,
        [{ path: neutrality.path, reason: "provider_boundary" }],
      ),
    });
    return finalizeRejection(
      scope, submissionStore, granted, revision, "provider_boundary", opts, trace, decision, reasons, matchedRules,
    );
  }

  const ack: AdcosSubmissionAck = opts.transport.submit(request, {
    at: opts.at,
    correlationId: opts.correlationId,
    causationId: opts.causationId,
  });

  if (!ack.ok) {
    const revision = nextSubmissionRevision(granted.revisions, {
      status: SUBMISSION_REJECTED,
      at: opts.at,
      decision,
      reasons,
      matchedRules,
      providerRefusal: ack.refusal,
    });
    return finalizeRejection(
      scope, submissionStore, granted, revision, `provider_refusal:${ack.refusal.reason}`, opts, trace, decision, reasons, matchedRules,
    );
  }

  // Boundary enforcement on the provider's acceptance (never record a leak).
  const ackNeutrality = isProviderNeutral(ack);
  if (!ackNeutrality.ok) {
    const revision = nextSubmissionRevision(granted.revisions, {
      status: SUBMISSION_REJECTED,
      at: opts.at,
      decision,
      reasons,
      matchedRules,
      error: makeValidationError(
        ERROR_CODES.submissionInvalid,
        "dispatch refused: the provider acceptance violates the provider-neutral boundary",
        trace,
        [{ path: ackNeutrality.path, reason: "provider_boundary" }],
      ),
    });
    return finalizeRejection(
      scope, submissionStore, granted, revision, "provider_boundary", opts, trace, decision, reasons, matchedRules,
    );
  }

  // The initial report: the acceptance's typed commitment, validated by
  // the SAME normalization invariants as every later adoption (an
  // acceptance that cannot form a valid initial state — e.g. TERMINATED
  // with no termination record — is a malformed acceptance: rejected).
  const initialReport = frozen({
    connectivityId: ack.connectivityId,
    handle: ack.handle,
    executionState: ack.initialState,
    acceptedRequirements: ack.acceptedRequirements,
    measurements: [],
    degradation: frozen({ kind: "none" as const }),
    failure: frozen({ kind: "none" as const }),
    termination: null,
    reportedAt: opts.at,
  });
  const validation = validateStatusReport(initialReport);
  if (!validation.ok) {
    const revision = nextSubmissionRevision(granted.revisions, {
      status: SUBMISSION_REJECTED,
      at: opts.at,
      decision,
      reasons,
      matchedRules,
      error: makeValidationError(
        ERROR_CODES.reportInvalid,
        "dispatch refused: the provider acceptance cannot form a valid initial state",
        trace,
        validation.failures,
      ),
    });
    return finalizeRejection(
      scope, submissionStore, granted, revision, "invalid_acceptance", opts, trace, decision, reasons, matchedRules,
    );
  }

  // SUBMITTED revision (handle + connectivity id recorded).
  const submittedRevision = nextSubmissionRevision(granted.revisions, {
    status: SUBMISSION_SUBMITTED,
    at: opts.at,
    decision,
    reasons,
    matchedRules,
    handle: ack.handle,
    connectivityId: ack.connectivityId,
  });
  const appended = submissionStore.append(scope, granted.submissionId, submittedRevision);
  if (!appended.ok) {
    return { ok: false, error: appended.error };
  }
  emitAudit(opts.auditSink, {
    action: ADCOS_AUDIT_ACTIONS.submissionSubmitted,
    tenantId: granted.tenantId,
    subject: granted.submissionId,
    occurredAt: opts.at,
    correlationId: opts.correlationId,
    details: guardianDetails(decision, reasons, matchedRules, {
      intentId: request.intentRef.intentId,
      outcome: request.outcome.canonical,
      requestDigest: request.requestDigest,
      connectivityId: ack.connectivityId,
    }),
  });

  // Seed the connectivity record (revision 1, bound to the intent).
  const seededRevision = {
    revision: 1,
    adoptedAt: opts.at,
    acceptedRequirements: validation.report.acceptedRequirements,
    executionState: validation.report.executionState,
    measurements: validation.report.measurements,
    degradation: validation.report.degradation,
    failure: validation.report.failure,
    termination: validation.report.termination,
    contentDigest: adoptionContentDigest(validation.report),
    priorDigest: null,
  };
  const connectivityRecord: ConnectivityRecord = frozen({
    tenantId: granted.tenantId,
    connectivityId: ack.connectivityId,
    handle: ack.handle,
    intentRef: request.intentRef,
    requestDigest: request.requestDigest,
    executionState: validation.report.executionState,
    revisions: frozen([seededRevision]),
  });
  const seeded = recordStore.seed(scope, connectivityRecord);
  if (!seeded.ok) {
    // Deterministic edge: the connectivity id already exists under this
    // tenant (a provider-side id collision across submissions). The
    // submission is rejected carrying the store's machine-stable error.
    const revision = nextSubmissionRevision(appended.value.revisions, {
      status: SUBMISSION_REJECTED,
      at: opts.at,
      decision,
      reasons,
      matchedRules,
      error: seeded.error,
    });
    return finalizeRejection(
      scope, submissionStore, appended.value, revision, "duplicate_connectivity", opts, trace, decision, reasons, matchedRules,
    );
  }
  emitAudit(opts.auditSink, {
    action: ADCOS_AUDIT_ACTIONS.statusAdopted,
    tenantId: granted.tenantId,
    subject: ack.connectivityId,
    occurredAt: opts.at,
    correlationId: opts.correlationId,
    details: {
      revision: 1,
      executionState: validation.report.executionState,
      contentDigest: seededRevision.contentDigest,
      intentId: request.intentRef.intentId,
      measurementCount: 0,
    },
  });

  return {
    ok: true,
    record: appended.value,
    replayed: false,
    connectivityRecord: seeded.value,
  };
}

/** Append the REJECTED revision + audit — the shared terminal helper. */
function finalizeRejection(
  scope: AdcosTenantScope,
  submissionStore: AdcosSubmissionStore,
  record: ConnectivitySubmissionRecord,
  revision: SubmissionRevision,
  reason: string,
  opts: { readonly at: string; readonly correlationId: CorrelationId; readonly auditSink?: AdcosAuditSink },
  trace: ErrorTrace,
  decision: GuardianDecision | null = null,
  reasons: readonly AdcosEvaluationReason[] = [],
  matchedRules: readonly AdcosMatchedRuleRef[] = [],
): SubmissionResult {
  const appended = submissionStore.append(scope, record.submissionId, revision);
  if (!appended.ok) {
    return { ok: false, error: appended.error };
  }
  const isProviderRefusal = reason.startsWith("provider_refusal:");
  emitAudit(opts.auditSink, {
    action: isProviderRefusal
      ? ADCOS_AUDIT_ACTIONS.submissionRefused
      : ADCOS_AUDIT_ACTIONS.submissionRejected,
    tenantId: record.tenantId,
    subject: record.submissionId,
    occurredAt: opts.at,
    correlationId: opts.correlationId,
    details: guardianDetails(decision, reasons, matchedRules, {
      intentId: record.request.intentRef.intentId,
      outcome: record.request.outcome.canonical,
      requestDigest: record.request.requestDigest,
      rejectionReason: reason,
      providerRefusal: revision.providerRefusal,
      errorCode: revision.error !== null ? revision.error.code : null,
    }),
  });
  return { ok: true, record: appended.value, replayed: false, connectivityRecord: null };
}

/** Build the structural Guardian request from the translated request (observable facts only). */
function guardianRequestOf<R>(
  request: AdcosConnectivityRequest,
  opts: SubmitConnectivityOptions<R>,
): import("./policy-seam").AdcosGuardianRequest {
  const deviceRef = request.targets.targetDeviceId ?? request.targets.sourceDeviceId;
  // The network facet carries the request's zone constraint ONLY when it
  // is a single canonical zone the closed union can represent — never a
  // guess for multi-zone or non-canonical constraints (disclosed).
  const zones = request.constraints.requiredZones;
  const zone: AdcosGuardianNetworkZone | undefined =
    zones.length === 1 && CANONICAL_ZONES.includes(zones[0] as AdcosGuardianNetworkZone)
      ? (zones[0] as AdcosGuardianNetworkZone)
      : undefined;
  return {
    tenantId: request.tenantId,
    action: { action: ADCOS_SUBMISSION_ACTION, targetKind: ADCOS_SUBMISSION_TARGET_KIND },
    principal: opts.principal,
    time: { at: request.duration.startAt },
    evidence: opts.evidence,
    ...(deviceRef !== undefined ? { device: { deviceId: asDeviceId(deviceRef) } } : {}),
    ...(request.targets.workloadId !== undefined
      ? { workload: { workloadId: asWorkloadId(request.targets.workloadId) } }
      : {}),
    ...(zone !== undefined ? { network: { zone } } : {}),
  };
}

/** The shared Guardian-context details projection for audit records. */
function guardianDetails(
  decision: GuardianDecision | null,
  reasons: readonly AdcosEvaluationReason[],
  matchedRules: readonly AdcosMatchedRuleRef[],
  extra: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return frozen({
    ...extra,
    decision: decision === null ? null : decision.decision,
    ruleIds: frozen(matchedRules.map((rule) => rule.ruleId)),
    reasonCodes: frozen(reasons.map((reason) => reason.code)),
  });
}

function gateError(
  code: string,
  message: string,
  trace: ErrorTrace,
  invariant: string,
): DomainError {
  return makeDomainError(code, message, trace, "adcos.submission.gate", invariant);
}

function notFound(submissionId: string, trace: ErrorTrace): DomainError {
  return gateError(
    ERROR_CODES.submissionNotFound,
    "submission refused: unknown submission id",
    trace,
    "not_found",
  );
}

function emitAudit(
  sink: AdcosAuditSink | undefined,
  record: import("./audit-seam").AdcosAuditRecord,
): void {
  if (sink === undefined) return;
  sink.append(record);
}
