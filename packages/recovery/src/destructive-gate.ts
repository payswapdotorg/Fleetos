/**
 * @fleetos/recovery — D3c: the destructive recovery gate.
 *
 * A recovery case may request a destructive action (lock / locate /
 * wipe / reboot — the `RecoveryIntent` action set) ONLY as a proposal
 * routed through the W031 Contract Guardian (the injected
 * `GuardianEvaluateFn` seam — `@fleetos/policy`'s
 * `evaluateGuardianRequest` satisfies it structurally and is injected at
 * the binding site; proven by test against the REAL engine):
 *
 *   - ALLOW  advances — and dispatches the execution through the
 *     injected W020 `EndpointAdapter` seam (same lane: imported from
 *     `@fleetos/device-adapters`);
 *   - WARN   advances with the warning context (non-blocking per the
 *     FROZEN `isBlockingDecision` helper — the reasons ride on the
 *     revision and the audit) and dispatches;
 *   - REQUIRE_APPROVAL parks the request for human approval (the parked
 *     -> approved/rejected transitions are recorded as ledger entries;
 *     approval dispatches, rejection terminals);
 *   - BLOCK  rejects with the Guardian's machine-stable reasons (the
 *     matched rule ids + reason codes carried verbatim).
 *
 *   NEVER auto-execute: nothing dispatches without the Guardian's
 *   advance (or a human approval of a parked request).
 *
 * Capability awareness (ARCHITECTURE-LOCK item 16): UNSUPPORTED or
 * unauthorized destructive capabilities are refused with machine-stable
 * reasons BEFORE any seam call — never emulated, never a fallback. The
 * gate refuses, in order, when: the adapter fronts a foreign tenant; the
 * adapter fronts a different device; the action's capability is not in
 * the adapter's DECLARED capability record; the case is not in an active
 * recovery state. Only then is the Guardian consulted; only a granted
 * (advanced/approved) request reaches the adapter — whose own W020
 * negotiation re-asserts the grant + fresh-policy-cache requirements
 * (defense in depth; an adapter-side refusal is recorded, never
 * retried, never emulated).
 *
 * Evidence trail (§16): every granted destructive action carries the
 * full trail — the frozen `GuardianDecision` (policy decision), the
 * matched rule refs (rule ids), and the observation evidence artifacts
 * (`EvidenceRef`s built from the case's evidence basis). The audit
 * record for a granted execution carries exactly that set.
 *
 * Tenant isolation is BY CONSTRUCTION: every operation takes the acting
 * `RecoveryTenantScope` FIRST; storage is partitioned per tenant; a
 * foreign request/case id is indistinguishable from an unknown one.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type {
  CorrelationId,
  CausationId,
  DeviceId,
  EvidenceRef,
  FleetError,
  Observation,
  TenantId,
} from "@fleetos/contracts";
import { isBlockingDecision } from "@fleetos/contracts";
// The injected adapter seam: the W020 EndpointAdapter interface (SAME
// LANE — the only @fleetos import besides contracts in this package's src).
import type {
  AdapterCommandContext,
  AdapterCommandOutcome,
  AdapterOperationRequest,
  EndpointAdapter,
} from "@fleetos/device-adapters";
import { isCapabilitySupported } from "@fleetos/device-adapters";
import type { RecoveryCaseRecord } from "./recovery-case";
import { ACTIVE_RECOVERY_CASE_STATUSES } from "./recovery-case";
import type { RecoveryAuditSink } from "./audit-seam";
import { NOOP_RECOVERY_AUDIT_SINK, RECOVERY_AUDIT_ACTIONS } from "./audit-seam";
import type {
  GuardianEvaluateFn,
  RecoveryGuardianOptions,
  RecoveryGuardianOwnership,
  RecoveryGuardianPosture,
  RecoveryGuardianPrincipal,
} from "./policy-seam";
import type {
  DestructiveRecoveryAction,
  DestructiveRequestRecord,
  DestructiveRequestStore,
} from "./destructive-request";
import {
  ALL_DESTRUCTIVE_RECOVERY_ACTIONS,
  DESTRUCTIVE_INTENT_KIND,
  REQUEST_ADVANCED,
  REQUEST_APPROVED,
  REQUEST_EXECUTED,
  REQUEST_FAILED,
  REQUEST_PARKED,
  REQUEST_REJECTED,
  REQUEST_REQUESTED,
  destructiveRequestId,
  destructiveRequestRecordId,
  destructiveRequestContentDigest,
} from "./destructive-request";
import {
  ERROR_CODES,
  RECOVERY_PIPELINE_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT,
  canonicalJson,
  fnv1a32Hex,
  frozen,
  looksLikeIso,
  makeDomainError,
  makeValidationError,
} from "./internal";
import type { RecoveryTenantScope } from "./internal";
import { checkRecoveryTenantScope } from "./internal";

// ---------------------------------------------------------------------------
// The canonical Guardian action kinds (machine-stable, recovery-owned)
// ---------------------------------------------------------------------------

/**
 * The canonical Guardian action kinds for the destructive recovery
 * action set. `device.lock` and `device.wipe` match the policy rule
 * model's canonical constants; `device.locate` and `device.reboot` are
 * open-union extensions (the frozen `GuardianActionKind` union is open
 * by design). Machine-stable; recovery-owned.
 */
export const RECOVERY_GUARDIAN_ACTION_KINDS: Readonly<Record<DestructiveRecoveryAction, string>> =
  Object.freeze({
    lock: "device.lock",
    locate: "device.locate",
    wipe: "device.wipe",
    reboot: "device.reboot",
  });

// ---------------------------------------------------------------------------
// Observation evidence helpers (the §16 trail basis)
// ---------------------------------------------------------------------------

/**
 * Build content-addressed evidence refs from observations — one
 * `EvidenceRef` per observation, keyed `observations://{deviceId}/{id}`,
 * hashed FNV-1a over the canonical JSON of the observation (the same
 * convention the W020 adapter uses for observation-batch evidence;
 * never for security). Sorted by key for determinism.
 *
 * @param deviceId the device the observations concern
 * @param observations the observations backing the request
 * @returns frozen evidence refs, sorted by key
 */
export function evidenceRefsFromObservations(
  deviceId: DeviceId,
  observations: readonly Observation[],
): readonly EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  for (const observation of observations) {
    const canonical = canonicalJson(observation);
    refs.push(
      frozen<EvidenceRef>({
        key: `observations://${deviceId as string}/${observation.id as string}`,
        sizeBytes: canonical.length,
        hash: fnv1a32Hex(canonical),
        hashAlgorithm: "fnv1a32",
      }),
    );
  }
  refs.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return Object.freeze(refs);
}

// ---------------------------------------------------------------------------
// The request options
// ---------------------------------------------------------------------------

/** The device facets the caller supplies for the Guardian request (observable facts). */
export interface DestructiveRequestDeviceFacets {
  readonly platform?: string;
  readonly ownership?: RecoveryGuardianOwnership;
  readonly posture?: RecoveryGuardianPosture;
}

/** Options for `requestDestructiveAction`. */
export interface RequestDestructiveOptions<R> {
  /** The compiled Guardian rule set (the policy version the request is evaluated against). */
  readonly ruleSet: R;
  /** The INJECTED Guardian evaluation seam — the real `evaluateGuardianRequest` at the binding site. */
  readonly evaluator: GuardianEvaluateFn<R>;
  /** The INJECTED W020 EndpointAdapter the granted action dispatches through. */
  readonly adapter: EndpointAdapter;
  /** The injected request instant (ISO 8601) — also the decision + dispatch instant. */
  readonly at: string;
  /** The correlation id of the request. */
  readonly correlationId: CorrelationId;
  /** The causation id, when the request is caused by a specific command/event. */
  readonly causationId?: CausationId;
  /** Whether the adapter's local signed-policy cache is fresh + verified (W020 D5). */
  readonly policyCacheReady: boolean;
  /** The requesting principal, when known (observable facts). */
  readonly principal?: RecoveryGuardianPrincipal;
  /** The device facets for the Guardian request (observable facts). */
  readonly deviceFacets?: DestructiveRequestDeviceFacets;
  /** The requesting principal's id (recorded on the request + audit). */
  readonly requestedBy?: string;
  /** The observation evidence artifacts backing the request (the §16 trail). */
  readonly evidence?: readonly EvidenceRef[];
  /** An opaque operation payload forwarded to the adapter, when applicable. */
  readonly payload?: unknown;
  /** The injected audit sink (every consequential mutation emits; default: no-op). */
  readonly auditSink?: RecoveryAuditSink;
}

/** The tagged result of a destructive-action request. */
export type RequestDestructiveResult =
  | { readonly ok: true; readonly record: DestructiveRequestRecord }
  | { readonly ok: false; readonly error: FleetError };

// ---------------------------------------------------------------------------
// Internal revision builder
// ---------------------------------------------------------------------------

function nextRevision(
  prior: DestructiveRequestRecord,
  patch: Partial<Omit<DestructiveRequestRecord, "requestId" | "recordId" | "tenantId" | "deviceId" | "caseId" | "version" | "contentDigest">>,
): DestructiveRequestRecord {
  const content: Omit<DestructiveRequestRecord, "requestId" | "recordId" | "contentDigest"> = frozen({
    ...prior,
    ...patch,
    version: prior.version + 1,
  });
  return frozen({
    ...content,
    requestId: prior.requestId,
    recordId: destructiveRequestRecordId(prior.requestId, prior.version + 1),
    contentDigest: destructiveRequestContentDigest(content),
  });
}

/** Validate the shared request-options fields; returns the failure list (empty = ok). */
interface DestructiveOptionsShape {
  readonly at?: unknown;
  readonly correlationId?: unknown;
  readonly evaluator?: unknown;
  readonly adapter?: unknown;
  readonly ruleSet?: unknown;
  readonly policyCacheReady?: unknown;
}

function validateOptions(options: DestructiveOptionsShape): { path: string; reason: string }[] {
  const failures: { path: string; reason: string }[] = [];
  if (typeof options?.at !== "string" || !looksLikeIso(options.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof options?.correlationId !== "string" || options.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (typeof options?.evaluator !== "function") {
    failures.push({ path: "/evaluator", reason: "function_required" });
  }
  if (options?.adapter === null || typeof options?.adapter !== "object") {
    failures.push({ path: "/adapter", reason: "adapter_required" });
  }
  if (options?.ruleSet === null || typeof options?.ruleSet !== "object") {
    failures.push({ path: "/ruleSet", reason: "rule_set_required" });
  }
  if (typeof options?.policyCacheReady !== "boolean") {
    failures.push({ path: "/policyCacheReady", reason: "boolean_required" });
  }
  return failures;
}

// ---------------------------------------------------------------------------
// The request boundary
// ---------------------------------------------------------------------------

/**
 * Request a destructive recovery action on behalf of a recovery case:
 * the proposal-gated, capability-aware, Guardian-routed boundary.
 *
 * Order of gates (machine-stable refusal reasons, ALL before any seam
 * call — never emulated, never a fallback):
 *   1. scope/shape validation (tagged ValidationError);
 *   2. the case MUST be in an ACTIVE recovery state (OPENED/SECURING);
 *   3. the adapter MUST front the SAME tenant + device as the case
 *      (`adapter_tenant_mismatch` / `adapter_device_mismatch`);
 *   4. the action's capability MUST be in the adapter's DECLARED
 *      capability record (`capability_unsupported`).
 * Then the request is routed through the injected Guardian evaluator:
 * ALLOW/WARN appends the ADVANCED revision and dispatches execution
 * through the adapter (recording EXECUTED/FAILED with the adapter's
 * evidence); REQUIRE_APPROVAL appends the PARKED revision (awaiting the
 * human-approval step); BLOCK appends the REJECTED revision carrying
 * the Guardian's machine-stable reasons. NEVER auto-execute.
 *
 * Every appended revision is append-only (prior revisions never
 * rewritten) and audited (`recovery.destructive.requested` on the
 * REQUESTED revision — carrying the decision context; then parked/
 * executed/failed/refused as the flow progresses).
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param store the destructive-request store
 * @param caseRecord the LATEST revision of the recovery case (from the acting partition)
 * @param action the destructive action (lock/locate/wipe/reboot — the frozen payload union)
 * @param options the injected options
 * @returns the tagged result (the LATEST request revision)
 */
export function requestDestructiveAction<R>(
  scope: RecoveryTenantScope,
  store: DestructiveRequestStore,
  caseRecord: RecoveryCaseRecord,
  action: DestructiveRecoveryAction,
  options: RequestDestructiveOptions<R>,
): RequestDestructiveResult {
  const guard = checkRecoveryTenantScope(scope);
  if (!guard.ok) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.requestStoreDomain,
        `destructive request store refused access (${guard.reason}: ${guard.detail})`,
        { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: RECOVERY_PIPELINE_CORRELATION_ID },
        "recovery.destructive.request",
        guard.reason,
      ),
    };
  }
  const trace = {
    tenantId: guard.tenantId,
    correlationId: options.correlationId ?? RECOVERY_PIPELINE_CORRELATION_ID,
  };
  const failures = validateOptions(options);
  if (!(ALL_DESTRUCTIVE_RECOVERY_ACTIONS as readonly string[]).includes(action)) {
    failures.push({ path: "/action", reason: "unknown_action" });
  }
  if (caseRecord === null || typeof caseRecord !== "object") {
    failures.push({ path: "/caseRecord", reason: "case_required" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.requestInvalid,
        "destructive recovery request is invalid",
        trace,
        failures,
      ),
    };
  }
  if (caseRecord.tenantId !== guard.tenantId) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.requestRefused,
        "destructive request refused: case tenant does not match the acting tenant scope",
        trace,
        "recovery.destructive.request",
        "tenant_mismatch",
      ),
    };
  }
  if (!ACTIVE_RECOVERY_CASE_STATUSES.includes(caseRecord.status)) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.requestRefused,
        `destructive request refused: case status ${caseRecord.status} is not an active recovery state`,
        trace,
        "recovery.destructive.request",
        "case_not_active",
      ),
    };
  }
  const adapter = options.adapter;
  // --- capability awareness: all refusals BEFORE any seam call ---------
  if ((adapter.descriptor.tenantId as string) !== (guard.tenantId as string)) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.requestRefused,
        "destructive request refused: the adapter fronts a different tenant (tenant isolation)",
        trace,
        "recovery.destructive.request",
        "adapter_tenant_mismatch",
      ),
    };
  }
  if ((adapter.descriptor.deviceId as string) !== (caseRecord.deviceId as string)) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.requestRefused,
        "destructive request refused: the adapter fronts a different device than the case",
        trace,
        "recovery.destructive.request",
        "adapter_device_mismatch",
      ),
    };
  }
  if (!isCapabilitySupported(adapter.capabilities, action)) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.requestRefused,
        `destructive request refused: capability "${action}" is not supported by this adapter (${adapter.capabilities.adapterFamily}) — never emulated`,
        trace,
        "recovery.destructive.request",
        "capability_unsupported",
      ),
    };
  }

  // --- the durable intent record (frozen payload, VERBATIM) ------------
  const intentPayload = frozen({ deviceId: caseRecord.deviceId, action });
  const requestId = destructiveRequestId(guard.tenantId, caseRecord.caseId, action, options.at);
  const evidence = Object.freeze([...(options.evidence ?? [])]);
  const requestedContent: Omit<DestructiveRequestRecord, "requestId" | "recordId" | "contentDigest"> =
    frozen({
      tenantId: guard.tenantId,
      deviceId: caseRecord.deviceId,
      caseId: caseRecord.caseId,
      version: 1,
      intentKind: DESTRUCTIVE_INTENT_KIND,
      intentPayload,
      status: REQUEST_REQUESTED,
      requestedAt: options.at,
      ...(options.requestedBy !== undefined ? { requestedBy: options.requestedBy } : {}),
      caseEvidence: caseRecord.evidence,
      evidence,
    });
  const requestedRevision: DestructiveRequestRecord = frozen({
    ...requestedContent,
    requestId,
    recordId: destructiveRequestRecordId(requestId, 1),
    contentDigest: destructiveRequestContentDigest(requestedContent),
  });
  const firstWrite = store.appendRequest(scope, requestedRevision);
  if (!firstWrite.ok) return firstWrite;
  const sink: RecoveryAuditSink = options.auditSink ?? NOOP_RECOVERY_AUDIT_SINK;
  const requested = firstWrite.record;
  sink.append(
    frozen({
      action: RECOVERY_AUDIT_ACTIONS.destructiveRequested,
      tenantId: guard.tenantId,
      subject: requestId,
      occurredAt: options.at,
      correlationId: trace.correlationId,
      causationId: options.causationId,
      details: frozen({
        requestId,
        caseId: caseRecord.caseId,
        deviceId: caseRecord.deviceId as string,
        intentKind: requested.intentKind,
        intentPayload: requested.intentPayload,
        requestedBy: requested.requestedBy ?? null,
        lastSeenRecordId: caseRecord.evidence.lastSeenRecordId ?? null,
        postureFindingRefs: caseRecord.evidence.postureFindingRefs,
        evidence: evidence.map((e) => e.key),
        contentDigest: requested.contentDigest,
      }),
    }),
  );

  // --- route through the W031 Guardian (the injected real engine) ------
  const guardianRequest = frozen({
    tenantId: guard.tenantId,
    action: frozen({ action: RECOVERY_GUARDIAN_ACTION_KINDS[action], targetKind: "device" }),
    ...(options.principal !== undefined ? { principal: options.principal } : {}),
    device: frozen({
      deviceId: caseRecord.deviceId,
      ...(options.deviceFacets?.platform !== undefined
        ? { platform: options.deviceFacets.platform }
        : {}),
      ...(options.deviceFacets?.ownership !== undefined
        ? { ownership: options.deviceFacets.ownership }
        : {}),
      ...(options.deviceFacets?.posture !== undefined ? { posture: options.deviceFacets.posture } : {}),
    }),
    evidence,
  });
  const guardianOptions: RecoveryGuardianOptions = frozen({
    at: options.at,
    correlationId: options.correlationId,
    ...(options.causationId !== undefined ? { causationId: options.causationId } : {}),
  });
  const outcome = options.evaluator(options.ruleSet, guardianRequest, guardianOptions);
  if (!outcome.ok) {
    // The evaluation itself failed (invalid request / tenant mismatch in
    // the engine): a refusal, machine-stable, audited — never a guess.
    const refused = nextRevision(requested, {
      status: REQUEST_REJECTED,
      refusalReason: "guardian_evaluation_error",
      decidedAt: options.at,
    });
    const write = store.appendRequest(scope, refused);
    if (!write.ok) return write;
    sink.append(
      frozen({
        action: RECOVERY_AUDIT_ACTIONS.destructiveRefused,
        tenantId: guard.tenantId,
        subject: requestId,
        occurredAt: options.at,
        correlationId: trace.correlationId,
        causationId: options.causationId,
        details: frozen({
          requestId,
          caseId: caseRecord.caseId,
          action,
          refusalReason: refused.refusalReason,
          error: outcome.error.code,
          contentDigest: refused.contentDigest,
        }),
      }),
    );
    return { ok: true, record: write.record };
  }

  const evaluation = outcome.evaluation;
  const decision = evaluation.decision;
  const decisionType = decision.decision;

  if (decisionType === "BLOCK") {
    // BLOCK: reject with the Guardian's machine-stable reasons.
    const rejected = nextRevision(requested, {
      status: REQUEST_REJECTED,
      decision,
      matchedRules: evaluation.matchedRules,
      reasons: evaluation.reasons,
      refusalReason: "guardian_block",
      decidedAt: options.at,
    });
    const write = store.appendRequest(scope, rejected);
    if (!write.ok) return write;
    sink.append(
      frozen({
        action: RECOVERY_AUDIT_ACTIONS.destructiveRefused,
        tenantId: guard.tenantId,
        subject: requestId,
        occurredAt: options.at,
        correlationId: trace.correlationId,
        causationId: options.causationId,
        details: frozen({
          requestId,
          caseId: caseRecord.caseId,
          action,
          refusalReason: "guardian_block",
          decision: decisionType,
          isBlocking: isBlockingDecision(decisionType),
          ruleSetId: evaluation.ruleSetId,
          ruleSetVersion: evaluation.ruleSetVersion,
          matchedRuleIds: evaluation.matchedRules.map((r) => r.ruleId),
          reasonCodes: evaluation.reasons.map((r) => r.code),
          evidence: decision.evidence.map((e) => e.key),
          contentDigest: rejected.contentDigest,
        }),
      }),
    );
    return { ok: true, record: write.record };
  }

  if (decisionType === "REQUIRE_APPROVAL") {
    // REQUIRE_APPROVAL: park the request for human approval.
    const parked = nextRevision(requested, {
      status: REQUEST_PARKED,
      decision,
      matchedRules: evaluation.matchedRules,
      reasons: evaluation.reasons,
      decidedAt: options.at,
    });
    const write = store.appendRequest(scope, parked);
    if (!write.ok) return write;
    sink.append(
      frozen({
        action: RECOVERY_AUDIT_ACTIONS.destructiveParked,
        tenantId: guard.tenantId,
        subject: requestId,
        occurredAt: options.at,
        correlationId: trace.correlationId,
        causationId: options.causationId,
        details: frozen({
          requestId,
          caseId: caseRecord.caseId,
          action,
          decision: decisionType,
          ruleSetId: evaluation.ruleSetId,
          ruleSetVersion: evaluation.ruleSetVersion,
          matchedRuleIds: evaluation.matchedRules.map((r) => r.ruleId),
          reasonCodes: evaluation.reasons.map((r) => r.code),
          evidence: decision.evidence.map((e) => e.key),
          contentDigest: parked.contentDigest,
        }),
      }),
    );
    return { ok: true, record: write.record };
  }

  // ALLOW / WARN (non-blocking per the frozen isBlockingDecision): the
  // request ADVANCES — WARN's warning context rides on the revision +
  // the audit — and execution dispatches through the adapter seam.
  const advanced = nextRevision(requested, {
    status: REQUEST_ADVANCED,
    decision,
    matchedRules: evaluation.matchedRules,
    reasons: evaluation.reasons,
    decidedAt: options.at,
  });
  const advancedWrite = store.appendRequest(scope, advanced);
  if (!advancedWrite.ok) return advancedWrite;
  return dispatchGranted(
    scope,
    store,
    advancedWrite.record,
    {
      adapter: options.adapter,
      at: options.at,
      correlationId: options.correlationId,
      ...(options.causationId !== undefined ? { causationId: options.causationId } : {}),
      policyCacheReady: options.policyCacheReady,
      ...(options.payload !== undefined ? { payload: options.payload } : {}),
    },
    sink,
  );
}

// ---------------------------------------------------------------------------
// Dispatch (the capability-aware adapter seam call for a GRANTED request)
// ---------------------------------------------------------------------------

/** The dispatch parameters a granted request carries to the adapter seam. */
interface DispatchParams {
  readonly adapter: EndpointAdapter;
  readonly at: string;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
  readonly policyCacheReady: boolean;
  readonly payload?: unknown;
}

/** The adapter-method routing table — exhaustive by construction over the action set. */
const ADAPTER_METHODS: Readonly<
  Record<
    DestructiveRecoveryAction,
    (adapter: EndpointAdapter, context: AdapterCommandContext, request: AdapterOperationRequest | undefined) => AdapterCommandOutcome
  >
> = Object.freeze({
  lock: (adapter, context, request) => adapter.lock(context, request),
  locate: (adapter, context, request) => adapter.locate(context, request),
  wipe: (adapter, context, request) => adapter.wipe(context, request),
  reboot: (adapter, context, request) => adapter.reboot(context, request),
});

/**
 * Dispatch a GRANTED (ADVANCED/APPROVED) destructive request through the
 * injected W020 EndpointAdapter. The `AdapterCommandContext` carries
 * `policyGrant: true` — the Guardian's advance (or the human approval)
 * IS the explicit policy grant (ARCHITECTURE-LOCK §16) — and the
 * caller-injected `policyCacheReady`. The adapter's own negotiation
 * re-asserts the grant + cache requirements (defense in depth); an
 * adapter refusal/failure is RECORDED (the FleetError verbatim), never
 * retried, never emulated.
 */
function dispatchGranted(
  scope: RecoveryTenantScope,
  store: DestructiveRequestStore,
  granted: DestructiveRequestRecord,
  params: DispatchParams,
  sink: RecoveryAuditSink,
): RequestDestructiveResult {
  const action = granted.intentPayload.action;
  const context: AdapterCommandContext = frozen({
    tenantId: granted.tenantId,
    correlationId: params.correlationId,
    executedAt: params.at,
    deviceId: granted.deviceId,
    policyGrant: true, // the Guardian advance / human approval is the explicit grant
    policyCacheReady: params.policyCacheReady,
  });
  const request: AdapterOperationRequest | undefined =
    params.payload === undefined ? undefined : frozen({ payload: params.payload });
  const outcome: AdapterCommandOutcome = ADAPTER_METHODS[action](params.adapter, context, request);
  if (outcome.ok) {
    const executed = nextRevision(granted, {
      status: REQUEST_EXECUTED,
      execution: frozen({
        attemptedAt: params.at,
        outcome: "executed" as const,
        adapterEvidence: Object.freeze([...outcome.evidence]),
      }),
    });
    const write = store.appendRequest(scope, executed);
    if (!write.ok) return write;
    // The §16 evidence trail: policy decision + rule ids + observation evidence.
    sink.append(
      frozen({
        action: RECOVERY_AUDIT_ACTIONS.destructiveExecuted,
        tenantId: granted.tenantId,
        subject: granted.requestId,
        occurredAt: params.at,
        correlationId: params.correlationId,
        causationId: params.causationId,
        details: frozen({
          requestId: granted.requestId,
          caseId: granted.caseId,
          action,
          decision: granted.decision?.decision ?? null,
          ruleIds: (granted.matchedRules ?? []).map((r) => r.ruleId),
          reasonCodes: (granted.reasons ?? []).map((r) => r.code),
          policyDecidedAt: granted.decidedAt ?? null,
          observationEvidence: granted.evidence.map((e) => e.key),
          adapterEvidence: outcome.evidence.map((e) => e.key),
          contentDigest: executed.contentDigest,
        }),
      }),
    );
    return { ok: true, record: write.record };
  }
  const failed = nextRevision(granted, {
    status: REQUEST_FAILED,
    execution: frozen({
      attemptedAt: params.at,
      outcome: "failed" as const,
      adapterEvidence: Object.freeze([...outcome.evidence]),
      error: outcome.error,
    }),
  });
  const write = store.appendRequest(scope, failed);
  if (!write.ok) return write;
  sink.append(
    frozen({
      action: RECOVERY_AUDIT_ACTIONS.destructiveFailed,
      tenantId: granted.tenantId,
      subject: granted.requestId,
      occurredAt: params.at,
      correlationId: params.correlationId,
      causationId: params.causationId,
      details: frozen({
        requestId: granted.requestId,
        caseId: granted.caseId,
        action,
        adapterStatus: outcome.status,
        error: outcome.error.code,
        errorMessage: outcome.error.message,
        adapterEvidence: outcome.evidence.map((e) => e.key),
        contentDigest: failed.contentDigest,
      }),
    }),
  );
  return { ok: true, record: write.record };
}

// ---------------------------------------------------------------------------
// The human-approval step (parked -> approved / rejected)
// ---------------------------------------------------------------------------

/** Options for `approveDestructiveRequest`. */
export interface ApproveDestructiveOptions<R> {
  /** The INJECTED W020 EndpointAdapter the approved action dispatches through. */
  readonly adapter: EndpointAdapter;
  /** The injected decision instant (ISO 8601). */
  readonly at: string;
  /** The correlation id of the approval request. */
  readonly correlationId: CorrelationId;
  /** The causation id, when the approval is caused by a specific command/event. */
  readonly causationId?: CausationId;
  /** Whether the adapter's local signed-policy cache is fresh + verified (W020 D5). */
  readonly policyCacheReady: boolean;
  /** The approving principal's id (recorded on the revision + audit). */
  readonly approverId?: string;
  /** An opaque operation payload forwarded to the adapter, when applicable. */
  readonly payload?: unknown;
  /** The injected audit sink (the approval transition emits; default: no-op). */
  readonly auditSink?: RecoveryAuditSink;
}

/** The tagged result of the human-approval step. */
export type ApproveDestructiveResult =
  | { readonly ok: true; readonly record: DestructiveRequestRecord }
  | { readonly ok: false; readonly error: FleetError };

/**
 * The human-approval step a PARKED destructive request awaits: the
 * W031 Guardian's REQUIRE_APPROVAL decision holds the action; the human
 * decides. `decision: "approve"` appends the APPROVED revision and
 * dispatches the execution through the adapter seam (the human approval
 * IS the explicit grant — ARCHITECTURE-LOCK §16); `decision: "reject"`
 * appends the REJECTED revision (terminal). Both transitions are
 * recorded as ledger entries + audited. PURE decision boundary: nothing
 * re-consults the Guardian on approval (the decision was
 * REQUIRE_APPROVAL — hold for a human; the human's judgment completes
 * it).
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param store the destructive-request store
 * @param parked the PARKED request revision (LATEST, from the acting partition)
 * @param decision the human decision ("approve" | "reject")
 * @param options the injected options
 * @returns the tagged result (the LATEST request revision)
 */
export function approveDestructiveRequest<R>(
  scope: RecoveryTenantScope,
  store: DestructiveRequestStore,
  parked: DestructiveRequestRecord,
  decision: "approve" | "reject",
  options: ApproveDestructiveOptions<R>,
): ApproveDestructiveResult {
  const guard = checkRecoveryTenantScope(scope);
  if (!guard.ok) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.requestStoreDomain,
        `destructive request store refused access (${guard.reason}: ${guard.detail})`,
        { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: RECOVERY_PIPELINE_CORRELATION_ID },
        "recovery.destructive.approve",
        guard.reason,
      ),
    };
  }
  const trace = {
    tenantId: guard.tenantId,
    correlationId: options.correlationId ?? RECOVERY_PIPELINE_CORRELATION_ID,
  };
  const failures: { path: string; reason: string }[] = [];
  if (typeof options?.at !== "string" || !looksLikeIso(options.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof options?.correlationId !== "string" || options.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (options?.adapter === null || typeof options?.adapter !== "object") {
    failures.push({ path: "/adapter", reason: "adapter_required" });
  }
  if (typeof options?.policyCacheReady !== "boolean") {
    failures.push({ path: "/policyCacheReady", reason: "boolean_required" });
  }
  if (decision !== "approve" && decision !== "reject") {
    failures.push({ path: "/decision", reason: "approve_or_reject_required" });
  }
  if (parked === null || typeof parked !== "object") {
    failures.push({ path: "/parked", reason: "request_required" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.requestInvalid,
        "destructive request approval is invalid",
        trace,
        failures,
      ),
    };
  }
  if (parked.tenantId !== guard.tenantId) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.requestRefused,
        "destructive request approval refused: request tenant does not match the acting tenant scope",
        trace,
        "recovery.destructive.approve",
        "tenant_mismatch",
      ),
    };
  }
  if (parked.status !== REQUEST_PARKED) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.requestStatusIllegal,
        `destructive request approval requires status PARKED (got ${parked.status})`,
        trace,
        "recovery.destructive.approve",
        "status_not_parked",
      ),
    };
  }
  const sink: RecoveryAuditSink = options.auditSink ?? NOOP_RECOVERY_AUDIT_SINK;
  if (decision === "reject") {
    const rejected = nextRevision(parked, {
      status: REQUEST_REJECTED,
      refusalReason: "human_rejected",
      approvalDecidedAt: options.at,
    });
    const write = store.appendRequest(scope, rejected);
    if (!write.ok) return write;
    sink.append(
      frozen({
        action: RECOVERY_AUDIT_ACTIONS.destructiveRejected,
        tenantId: guard.tenantId,
        subject: parked.requestId,
        occurredAt: options.at,
        correlationId: trace.correlationId,
        causationId: options.causationId,
        details: frozen({
          requestId: parked.requestId,
          caseId: parked.caseId,
          action: parked.intentPayload.action,
          approverId: options.approverId ?? null,
          decision,
          contentDigest: rejected.contentDigest,
        }),
      }),
    );
    return { ok: true, record: write.record };
  }
  const approved = nextRevision(parked, {
    status: REQUEST_APPROVED,
    ...(options.approverId !== undefined ? { approvedBy: options.approverId } : {}),
    approvalDecidedAt: options.at,
  });
  const approvedWrite = store.appendRequest(scope, approved);
  if (!approvedWrite.ok) return approvedWrite;
  sink.append(
    frozen({
      action: RECOVERY_AUDIT_ACTIONS.destructiveApproved,
      tenantId: guard.tenantId,
      subject: parked.requestId,
      occurredAt: options.at,
      correlationId: trace.correlationId,
      causationId: options.causationId,
      details: frozen({
        requestId: parked.requestId,
        caseId: parked.caseId,
        action: parked.intentPayload.action,
        approverId: options.approverId ?? null,
        decision,
        guardianDecision: parked.decision?.decision ?? null,
        ruleIds: (parked.matchedRules ?? []).map((r) => r.ruleId),
        contentDigest: approved.contentDigest,
      }),
    }),
  );
  // The human approval IS the explicit grant — dispatch through the seam.
  return dispatchGranted(
    scope,
    store,
    approvedWrite.record,
    {
      adapter: options.adapter,
      at: options.at,
      correlationId: options.correlationId,
      ...(options.causationId !== undefined ? { causationId: options.causationId } : {}),
      policyCacheReady: options.policyCacheReady,
      ...(options.payload !== undefined ? { payload: options.payload } : {}),
    },
    sink,
  );
}
