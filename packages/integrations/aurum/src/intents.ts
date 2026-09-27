/**
 * @fleetos/integration-aurum — D1: outbound communication intents.
 *
 * "FleetOS may emit maintenance notices, incident warnings, approval
 * requests, recovery messages, procurement updates and manager briefings."
 * — `spec/integration/AURUM.md`
 *
 * Six provider-neutral message kinds, each built by a PURE builder from
 * an injected STRUCTURAL seam: the seam declares only the facets the
 * adapter consumes, and the REAL accepted domain records (W042
 * `ServiceWorkOrder`, W031 `SecurityFinding`, the W031/W040/W041
 * parked-decision records, W040 `RecoveryCaseRecord`, W032 `Quote` +
 * `ProcurementDemand`) are ASSIGNABLE to those facets — TypeScript
 * structural typing is the proof at the type level, and this package's
 * test suite is the runtime proof at the binding site (the ownership
 * gate forbids cross-lane src imports; same-lane domain packages are
 * ALSO consumed through the seams so the integration stays
 * provider-neutral per `spec/ARCHITECTURE-LOCK.md` items 6-7 — the
 * W040 disclosed pattern).
 *
 * Message CONTENT is derived deterministically from the injected
 * structured inputs — never free text the caller must format: the title
 * and summary are templates over the kind + machine-stable discriminants
 * only (redaction-sound by construction), and the structured body is an
 * ordered field list rendered by the kind's template. The typed
 * redaction policy (content.ts) is applied BEFORE emission; the content
 * digest is computed over the POST-redaction content.
 *
 * Deterministic identity: `messageId` is the FNV-1a digest of the
 * identity tuple (tenantId, kind, subjectRef, recipient, at,
 * correlationId) PLUS the derived post-redaction `contentDigest` —
 * content-addressed messaging: the same emission re-derived produces
 * the same id (the outbox's idempotency basis), while two DIFFERENT
 * messages about the same source at the same instant (e.g. work-order
 * revision 1 created + revision 2 revised in one request context) get
 * distinct ids. A hand-forged id that collides with different content
 * is refused by the outbox's digest guard (`content_digest_mismatch`).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: `at` is injected by the caller.
 */

import type {
  CausationId,
  CorrelationId,
  FleetError,
  TenantId,
  TenantScoped,
} from "@fleetos/contracts";
import {
  AURUM_PIPELINE_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT_ID,
  canonicalJson,
  dedupeSortedStrings,
  fnv1a32Hex,
  frozen,
  frozenArray,
  looksLikeIso,
  makeDomainError,
  makeValidationError,
  parseIsoMs,
  sortedStrings,
} from "./internal";
import { ERROR_CODES } from "./internal";
import type {
  ContentField,
  MessageContent,
  RedactionPolicy,
} from "./content";
import { NO_REDACTION, applyRedaction, validateRedactionPolicy } from "./content";

// ---------------------------------------------------------------------------
// Provider-neutral kinds, priorities, recipients
// ---------------------------------------------------------------------------

/** The six provider-neutral communication message kinds (AURUM.md). */
export const COMMUNICATION_KINDS = frozen({
  maintenanceNotice: "maintenance_notice",
  incidentWarning: "incident_warning",
  approvalRequest: "approval_request",
  recoveryMessage: "recovery_message",
  procurementUpdate: "procurement_update",
  managerBriefing: "manager_briefing",
} as const);

/** The provider-neutral message kind. */
export type CommunicationKind =
  (typeof COMMUNICATION_KINDS)[keyof typeof COMMUNICATION_KINDS];

/** Every kind, in canonical order (for validation + iteration). */
export const ALL_COMMUNICATION_KINDS: readonly CommunicationKind[] = frozenArray([
  COMMUNICATION_KINDS.maintenanceNotice,
  COMMUNICATION_KINDS.incidentWarning,
  COMMUNICATION_KINDS.approvalRequest,
  COMMUNICATION_KINDS.recoveryMessage,
  COMMUNICATION_KINDS.procurementUpdate,
  COMMUNICATION_KINDS.managerBriefing,
]);

/** The derived message priority (machine-stable). */
export type MessagePriority = "urgent" | "high" | "normal" | "low";

/** Every priority, most urgent first. */
export const ALL_MESSAGE_PRIORITIES: readonly MessagePriority[] = frozenArray([
  "urgent",
  "high",
  "normal",
  "low",
]);

/**
 * The typed recipient. Provider-neutral by construction: Aurum resolves
 * the addressing; FleetOS only names WHO by role or by principal.
 */
export type MessageRecipient =
  | { readonly kind: "role"; readonly role: string }
  | { readonly kind: "principal"; readonly principalId: string };

/** The communication-intent payload schema version. */
export const COMMUNICATION_INTENT_SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// The communication intent
// ---------------------------------------------------------------------------

/**
 * A normalized, tenant-scoped outbound communication intent. Frozen at
 * construction; the outbox ledger (outbox.ts) owns persistence and
 * tenant isolation; the emission boundary (emission.ts) owns the
 * consequential side effects (append + transport + audit).
 */
export interface CommunicationIntent extends TenantScoped {
  /** Deterministic id: `aurum_msg_` + fnv1a32 of (identity tuple + content digest). */
  readonly messageId: string;
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** The provider-neutral message kind. */
  readonly kind: CommunicationKind;
  /** The source entity ref (work order id, finding id, ... — never null). */
  readonly subjectRef: string;
  /** The typed recipient. */
  readonly recipient: MessageRecipient;
  /** The derived priority. */
  readonly priority: MessagePriority;
  /** The derived, POST-redaction content. */
  readonly content: MessageContent;
  /** The redacted field keys (sorted, deduplicated; empty when none). */
  readonly redactedFieldKeys: readonly string[];
  /** Deterministic digest of the post-redaction content. */
  readonly contentDigest: string;
  /** The injected emission instant (ISO 8601). */
  readonly emittedAt: string;
  /** Correlation id threading the causal graph. */
  readonly correlationId: CorrelationId;
  /** Causation id, when the emission is caused by a specific command/event. */
  readonly causationId?: CausationId;
  /** The intent payload schema version. */
  readonly schemaVersion: number;
}

/** The tagged result of a pure intent build. */
export type CommunicationBuildResult =
  | { readonly ok: true; readonly intent: CommunicationIntent }
  | { readonly ok: false; readonly error: FleetError };

// ---------------------------------------------------------------------------
// Shared input facets + validation
// ---------------------------------------------------------------------------

/** The shared input facets of every builder (all injected, no clock reads). */
export interface CommunicationInputBase {
  /** The typed recipient. */
  readonly recipient: MessageRecipient;
  /** The injected emission instant (ISO 8601). */
  readonly at: string;
  /** Correlation id threading the causal graph. */
  readonly correlationId: CorrelationId;
  /** Causation id, when the emission is caused by a specific command/event. */
  readonly causationId?: CausationId;
  /** The typed redaction policy (default: none). */
  readonly redaction?: RedactionPolicy;
}

/** A non-empty-string check on an unknown-typed candidate. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Validate the shared input facets; returns the failure list (empty = ok). */
function validateBaseInput(
  input: Partial<CommunicationInputBase>,
): { path: string; reason: string }[] {
  const failures: { path: string; reason: string }[] = [];
  const recipient = input.recipient as unknown;
  if (recipient === null || typeof recipient !== "object") {
    failures.push({ path: "/recipient", reason: "recipient_required" });
  } else {
    const r = recipient as { kind?: unknown; role?: unknown; principalId?: unknown };
    if (r.kind === "role") {
      if (!isNonEmptyString(r.role)) {
        failures.push({ path: "/recipient/role", reason: "non_empty_string_required" });
      }
    } else if (r.kind === "principal") {
      if (!isNonEmptyString(r.principalId)) {
        failures.push({ path: "/recipient/principalId", reason: "non_empty_string_required" });
      }
    } else {
      failures.push({ path: "/recipient/kind", reason: "unknown_recipient_kind" });
    }
  }
  if (typeof input.at !== "string" || !looksLikeIso(input.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (!isNonEmptyString(input.correlationId)) {
    failures.push({ path: "/correlationId", reason: "non_empty_string_required" });
  }
  return failures;
}

/** The deterministic message identity: `aurum_msg_` + fnv1a32(identity tuple + content digest). */
function communicationMessageId(
  tenantId: TenantId,
  kind: CommunicationKind,
  subjectRef: string,
  recipient: MessageRecipient,
  at: string,
  correlationId: CorrelationId,
  contentDigest: string,
): string {
  return `aurum_msg_${fnv1a32Hex(
    canonicalJson([tenantId, kind, subjectRef, recipient, at, correlationId, contentDigest]),
  )}`;
}

/** The deterministic digest of post-redaction derived content. */
function contentDigestOf(content: MessageContent): string {
  return fnv1a32Hex(canonicalJson(content));
}

/**
 * Finalize an intent: apply the redaction policy to the derived content,
 * compute the deterministic ids/digests, freeze. Returns the tagged build
 * result; redaction-policy validation failures surface here.
 */
function finalizeIntent(
  derived: {
    readonly tenantId: TenantId;
    readonly kind: CommunicationKind;
    readonly subjectRef: string;
    readonly content: MessageContent;
    readonly priority: MessagePriority;
  },
  input: CommunicationInputBase,
): CommunicationBuildResult {
  const trace = {
    tenantId: derived.tenantId,
    correlationId: isNonEmptyString(input.correlationId)
      ? input.correlationId
      : AURUM_PIPELINE_CORRELATION_ID,
  };
  const policy = input.redaction ?? NO_REDACTION;
  const redactionFailures = validateRedactionPolicy(policy, derived.content);
  if (redactionFailures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.intentInvalid,
        "communication intent redaction policy is invalid",
        trace,
        redactionFailures.map((f) => frozen({ path: f.path, reason: f.reason })),
      ),
    };
  }
  const redaction = applyRedaction(derived.content, policy);
  const contentDigest = contentDigestOf(redaction.content);
  const messageId = communicationMessageId(
    derived.tenantId,
    derived.kind,
    derived.subjectRef,
    input.recipient,
    input.at,
    input.correlationId,
    contentDigest,
  );
  return {
    ok: true,
    intent: frozen({
      messageId,
      tenantId: derived.tenantId,
      kind: derived.kind,
      subjectRef: derived.subjectRef,
      recipient: frozen({ ...input.recipient }),
      priority: derived.priority,
      content: redaction.content,
      redactedFieldKeys: redaction.redactedFieldKeys,
      contentDigest,
      emittedAt: input.at,
      correlationId: input.correlationId,
      causationId: input.causationId,
      schemaVersion: COMMUNICATION_INTENT_SCHEMA_VERSION,
    }),
  };
}

/** A content-field helper (keeps the templates terse). */
function field(
  key: string,
  value: string,
  sensitivity: ContentField["sensitivity"],
): ContentField {
  return frozen({ key, value, sensitivity });
}

// ---------------------------------------------------------------------------
// Kind 1 — maintenance notices (W042 work-order events)
// ---------------------------------------------------------------------------

/**
 * The maintenance work-order facets the adapter consumes — a STRUCTURAL
 * seam: W042's `ServiceWorkOrder` (packages/maintenance) is ASSIGNABLE to
 * this shape (extra fields are irrelevant to structural typing). The
 * binding site injects the real record; proven by test.
 */
export interface MaintenanceNoticeSource {
  readonly workOrderId: string;
  readonly tenantId: TenantId;
  readonly deviceId: string;
  readonly revision: number;
  readonly serviceArea: string;
  readonly deadline: string;
  readonly serviceCategory: string;
}

/** The work-order lifecycle events that carry a notice (machine-stable). */
export const MAINTENANCE_NOTICE_EVENTS = frozen(["created", "revised"] as const);

/** The work-order lifecycle event. */
export type MaintenanceNoticeEvent = (typeof MAINTENANCE_NOTICE_EVENTS)[number];

/** The input of a maintenance-notice build. */
export interface MaintenanceNoticeInput extends CommunicationInputBase {
  /** The work-order record (the W042 `ServiceWorkOrder` at the binding site). */
  readonly workOrder: MaintenanceNoticeSource;
  /** The work-order lifecycle event being noticed. */
  readonly event: MaintenanceNoticeEvent;
}

/**
 * Build a maintenance notice from a W042 work-order event (PURE).
 *
 * Derivation: fields cite the work order verbatim (refs, device, revision,
 * area, deadline, category); priority is `urgent` when the deadline is
 * already past the injected emission instant (deterministically overdue),
 * else `normal`; title/summary carry only the event discriminant.
 *
 * @param input the build input
 * @returns the tagged build result
 */
export function buildMaintenanceNotice(input: MaintenanceNoticeInput): CommunicationBuildResult {
  const failures = validateBaseInput(input);
  const wo = input.workOrder as unknown;
  if (wo === null || typeof wo !== "object") {
    failures.push({ path: "/workOrder", reason: "work_order_required" });
  } else {
    const w = wo as Record<string, unknown>;
    if (!isNonEmptyString(w.workOrderId)) {
      failures.push({ path: "/workOrder/workOrderId", reason: "non_empty_string_required" });
    }
    if (!isNonEmptyString(w.tenantId)) {
      failures.push({ path: "/workOrder/tenantId", reason: "non_empty_string_required" });
    }
    if (!isNonEmptyString(w.deviceId)) {
      failures.push({ path: "/workOrder/deviceId", reason: "non_empty_string_required" });
    }
    if (typeof w.revision !== "number" || !Number.isInteger(w.revision) || w.revision < 1) {
      failures.push({ path: "/workOrder/revision", reason: "positive_integer_required" });
    }
    if (!isNonEmptyString(w.serviceArea)) {
      failures.push({ path: "/workOrder/serviceArea", reason: "non_empty_string_required" });
    }
    if (typeof w.deadline !== "string" || !looksLikeIso(w.deadline)) {
      failures.push({ path: "/workOrder/deadline", reason: "not_iso" });
    }
    if (!isNonEmptyString(w.serviceCategory)) {
      failures.push({ path: "/workOrder/serviceCategory", reason: "non_empty_string_required" });
    }
  }
  if (
    input.event !== "created" &&
    input.event !== "revised"
  ) {
    failures.push({ path: "/event", reason: "unknown_notice_event" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.intentInvalid,
        "maintenance notice input is invalid",
        {
          tenantId: SYNTHETIC_SYSTEM_TENANT_ID,
          correlationId: isNonEmptyString(input.correlationId)
            ? input.correlationId
            : AURUM_PIPELINE_CORRELATION_ID,
        },
        frozenArray(failures),
      ),
    };
  }
  const workOrder = input.workOrder;
  const overdue = parseIsoMs(workOrder.deadline) < parseIsoMs(input.at);
  const content: MessageContent = frozen({
    title: `Service work order ${input.event}`,
    summary: `A service work order was ${input.event} for vendor fulfillment.`,
    fields: frozenArray([
      field("subject_ref", workOrder.workOrderId, "reference"),
      field("event", input.event, "machine"),
      field("device_id", workOrder.deviceId, "identity"),
      field("revision", String(workOrder.revision), "machine"),
      field("service_area", workOrder.serviceArea, "reference"),
      field("deadline", workOrder.deadline, "machine"),
      field("service_category", workOrder.serviceCategory, "machine"),
    ]),
  });
  return finalizeIntent(
    {
      tenantId: workOrder.tenantId,
      kind: COMMUNICATION_KINDS.maintenanceNotice,
      subjectRef: workOrder.workOrderId,
      content,
      priority: overdue ? "urgent" : "normal",
    },
    input,
  );
}

// ---------------------------------------------------------------------------
// Kind 2 — incident warnings (W031 security findings)
// ---------------------------------------------------------------------------

/** The security severities (structural twin of W031's `SecuritySeverity`). */
export const INCIDENT_SEVERITIES = frozen(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const);

/** The security severity facet. */
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

/** The severity → priority derivation table (machine-stable). */
export const INCIDENT_PRIORITY_BY_SEVERITY: Readonly<Record<IncidentSeverity, MessagePriority>> =
  frozen({
    CRITICAL: "urgent",
    HIGH: "high",
    MEDIUM: "normal",
    LOW: "low",
  });

/**
 * The security-finding facets the adapter consumes — a STRUCTURAL seam:
 * W031's `SecurityFinding` (packages/security) is ASSIGNABLE to this
 * shape. The binding site injects the real record; proven by test.
 */
export interface IncidentWarningSource {
  readonly findingId: string;
  readonly tenantId: TenantId;
  readonly deviceId: string;
  readonly code: string;
  readonly severity: IncidentSeverity;
  readonly classification: string;
  readonly detectedAt: string;
}

/** The input of an incident-warning build. */
export interface IncidentWarningInput extends CommunicationInputBase {
  /** The security finding (the W031 `SecurityFinding` at the binding site). */
  readonly finding: IncidentWarningSource;
}

/**
 * Build an incident warning from a W031 security finding (PURE). The
 * severity drives the priority via the machine-stable table; the
 * machine-stable finding code, classification and detection instant ride
 * the fields verbatim.
 *
 * @param input the build input
 * @returns the tagged build result
 */
export function buildIncidentWarning(input: IncidentWarningInput): CommunicationBuildResult {
  const failures = validateBaseInput(input);
  const f0 = input.finding as unknown;
  if (f0 === null || typeof f0 !== "object") {
    failures.push({ path: "/finding", reason: "finding_required" });
  } else {
    const f = f0 as Record<string, unknown>;
    if (!isNonEmptyString(f.findingId)) {
      failures.push({ path: "/finding/findingId", reason: "non_empty_string_required" });
    }
    if (!isNonEmptyString(f.tenantId)) {
      failures.push({ path: "/finding/tenantId", reason: "non_empty_string_required" });
    }
    if (!isNonEmptyString(f.deviceId)) {
      failures.push({ path: "/finding/deviceId", reason: "non_empty_string_required" });
    }
    if (!isNonEmptyString(f.code)) {
      failures.push({ path: "/finding/code", reason: "non_empty_string_required" });
    }
    if (!(INCIDENT_SEVERITIES as readonly string[]).includes(f.severity as string)) {
      failures.push({ path: "/finding/severity", reason: "unknown_severity" });
    }
    if (!isNonEmptyString(f.classification)) {
      failures.push({ path: "/finding/classification", reason: "non_empty_string_required" });
    }
    if (typeof f.detectedAt !== "string" || !looksLikeIso(f.detectedAt)) {
      failures.push({ path: "/finding/detectedAt", reason: "not_iso" });
    }
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.intentInvalid,
        "incident warning input is invalid",
        {
          tenantId: SYNTHETIC_SYSTEM_TENANT_ID,
          correlationId: isNonEmptyString(input.correlationId)
            ? input.correlationId
            : AURUM_PIPELINE_CORRELATION_ID,
        },
        frozenArray(failures),
      ),
    };
  }
  const finding = input.finding;
  const content: MessageContent = frozen({
    title: "Security incident warning",
    summary: "A security finding was detected and requires attention.",
    fields: frozenArray([
      field("subject_ref", finding.findingId, "reference"),
      field("device_id", finding.deviceId, "identity"),
      field("finding_code", finding.code, "machine"),
      field("severity", finding.severity, "machine"),
      field("classification", finding.classification, "machine"),
      field("detected_at", finding.detectedAt, "machine"),
    ]),
  });
  return finalizeIntent(
    {
      tenantId: finding.tenantId,
      kind: COMMUNICATION_KINDS.incidentWarning,
      subjectRef: finding.findingId,
      content,
      priority: INCIDENT_PRIORITY_BY_SEVERITY[finding.severity],
    },
    input,
  );
}

// ---------------------------------------------------------------------------
// Kind 3 — approval requests (the W031/W040/W041 parked-decision surfaces)
// ---------------------------------------------------------------------------

/**
 * The parked action-plan facets the adapter consumes — a STRUCTURAL seam:
 * W041's `ActionPlanTemplate` (packages/actions) in `PARKED` status is
 * ASSIGNABLE to this shape. The binding site injects the real record;
 * proven by test.
 */
export interface ActionPlanApprovalSource {
  readonly planId: string;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly capability: string;
  readonly status: string;
  readonly targetCount: number;
  readonly version: number;
  readonly transitionedAt?: string;
  readonly requestedBy?: string;
}

/**
 * The parked destructive-recovery-request facets the adapter consumes — a
 * STRUCTURAL seam: W040's `DestructiveRequestRecord` (packages/recovery)
 * in `PARKED` status is ASSIGNABLE to this shape. The binding site
 * injects the real record; proven by test.
 */
export interface DestructiveApprovalSource {
  readonly requestId: string;
  readonly tenantId: TenantId;
  readonly deviceId: string;
  readonly caseId: string;
  readonly intentPayload: { readonly action: string };
  readonly status: string;
  readonly version: number;
  readonly requestedAt: string;
  readonly requestedBy?: string;
  readonly decidedAt?: string;
}

/**
 * The REQUIRE_APPROVAL Guardian-decision facets the adapter consumes — a
 * STRUCTURAL seam: the FROZEN `GuardianDecision` from `@fleetos/contracts`
 * (built by the real W031 engine at the binding site) is ASSIGNABLE to
 * this shape. Proven by test.
 */
export interface GuardianApprovalSource {
  readonly tenantId: TenantId;
  readonly decision: string;
  readonly rules: readonly { readonly ruleId: string; readonly ruleVersion: number }[];
  readonly decidedAt: string;
}

/** The parked-decision surfaces (machine-stable). */
export const APPROVAL_SURFACES = frozen([
  "action_plan",
  "destructive_request",
  "guardian_decision",
] as const);

/** The parked-decision surface discriminator. */
export type ApprovalSurface = (typeof APPROVAL_SURFACES)[number];

/** The input of an approval-request build (one facet per surface). */
export type ApprovalRequestInput =
  | (CommunicationInputBase & {
      readonly surface: "action_plan";
      readonly plan: ActionPlanApprovalSource;
    })
  | (CommunicationInputBase & {
      readonly surface: "destructive_request";
      readonly request: DestructiveApprovalSource;
    })
  | (CommunicationInputBase & {
      readonly surface: "guardian_decision";
      readonly decision: GuardianApprovalSource;
    });

/**
 * Build an approval request from a parked decision (PURE). Only a PARKED
 * decision carries an approval request — an action plan or destructive
 * request whose status is not `PARKED`, or a Guardian decision that is
 * not `REQUIRE_APPROVAL`, is REFUSED with the machine-stable reason
 * `decision_not_parked` (never a guess; the caller cannot request
 * approval for a decision that is not held).
 *
 * @param input the build input
 * @returns the tagged build result
 */
export function buildApprovalRequest(input: ApprovalRequestInput): CommunicationBuildResult {
  const failures = validateBaseInput(input);
  const trace = {
    tenantId: SYNTHETIC_SYSTEM_TENANT_ID,
    correlationId: isNonEmptyString(input.correlationId)
      ? input.correlationId
      : AURUM_PIPELINE_CORRELATION_ID,
  };
  let derived: {
    readonly tenantId: TenantId;
    readonly subjectRef: string;
    readonly content: MessageContent;
    readonly priority: MessagePriority;
  } | null = null;

  if (input.surface === "action_plan") {
    const p0 = input.plan as unknown;
    if (p0 === null || typeof p0 !== "object") {
      failures.push({ path: "/plan", reason: "plan_required" });
    } else {
      const p = p0 as Record<string, unknown>;
      if (!isNonEmptyString(p.planId)) {
        failures.push({ path: "/plan/planId", reason: "non_empty_string_required" });
      }
      if (!isNonEmptyString(p.tenantId)) {
        failures.push({ path: "/plan/tenantId", reason: "non_empty_string_required" });
      }
      if (!isNonEmptyString(p.capability)) {
        failures.push({ path: "/plan/capability", reason: "non_empty_string_required" });
      }
      if (typeof p.targetCount !== "number" || !Number.isInteger(p.targetCount) || p.targetCount < 1) {
        failures.push({ path: "/plan/targetCount", reason: "positive_integer_required" });
      }
      if (typeof p.version !== "number" || !Number.isInteger(p.version) || p.version < 1) {
        failures.push({ path: "/plan/version", reason: "positive_integer_required" });
      }
      if (p.status !== "PARKED") {
        failures.push({ path: "/plan/status", reason: "decision_not_parked" });
      }
    }
    if (failures.length === 0) {
      const plan = input.plan;
      const fields: ContentField[] = [
        field("subject_ref", plan.planId, "reference"),
        field("surface", "action_plan", "machine"),
        field("requested_action", plan.capability, "machine"),
        field("target_count", String(plan.targetCount), "machine"),
      ];
      if (plan.transitionedAt !== undefined) {
        fields.push(field("parked_at", plan.transitionedAt, "machine"));
      }
      if (plan.requestedBy !== undefined) {
        fields.push(field("requested_by", plan.requestedBy, "identity"));
      }
      derived = {
        tenantId: plan.tenantId,
        subjectRef: plan.planId,
        content: frozen({
          title: "Approval required: parked action plan",
          summary: "An action plan is held for human approval.",
          fields: frozenArray(fields),
        }),
        priority: "high",
      };
    }
  } else if (input.surface === "destructive_request") {
    const r0 = input.request as unknown;
    if (r0 === null || typeof r0 !== "object") {
      failures.push({ path: "/request", reason: "request_required" });
    } else {
      const r = r0 as Record<string, unknown>;
      if (!isNonEmptyString(r.requestId)) {
        failures.push({ path: "/request/requestId", reason: "non_empty_string_required" });
      }
      if (!isNonEmptyString(r.tenantId)) {
        failures.push({ path: "/request/tenantId", reason: "non_empty_string_required" });
      }
      if (!isNonEmptyString(r.deviceId)) {
        failures.push({ path: "/request/deviceId", reason: "non_empty_string_required" });
      }
      if (!isNonEmptyString(r.caseId)) {
        failures.push({ path: "/request/caseId", reason: "non_empty_string_required" });
      }
      const payload = r.intentPayload as { action?: unknown } | null | undefined;
      if (payload === null || typeof payload !== "object" || !isNonEmptyString(payload.action)) {
        failures.push({ path: "/request/intentPayload/action", reason: "non_empty_string_required" });
      }
      if (typeof r.version !== "number" || !Number.isInteger(r.version) || r.version < 1) {
        failures.push({ path: "/request/version", reason: "positive_integer_required" });
      }
      if (typeof r.requestedAt !== "string" || !looksLikeIso(r.requestedAt)) {
        failures.push({ path: "/request/requestedAt", reason: "not_iso" });
      }
      if (r.status !== "PARKED") {
        failures.push({ path: "/request/status", reason: "decision_not_parked" });
      }
    }
    if (failures.length === 0) {
      const request = input.request;
      const fields: ContentField[] = [
        field("subject_ref", request.requestId, "reference"),
        field("surface", "destructive_request", "machine"),
        field("requested_action", request.intentPayload.action, "machine"),
        field("case_ref", request.caseId, "reference"),
        field("device_id", request.deviceId, "identity"),
        field("requested_at", request.requestedAt, "machine"),
      ];
      if (request.decidedAt !== undefined) {
        fields.push(field("parked_at", request.decidedAt, "machine"));
      }
      if (request.requestedBy !== undefined) {
        fields.push(field("requested_by", request.requestedBy, "identity"));
      }
      derived = {
        tenantId: request.tenantId,
        subjectRef: request.requestId,
        content: frozen({
          title: "Approval required: parked destructive recovery request",
          summary: "A destructive recovery request is held for human approval.",
          fields: frozenArray(fields),
        }),
        priority: "urgent",
      };
    }
  } else if (input.surface === "guardian_decision") {
    const d0 = input.decision as unknown;
    if (d0 === null || typeof d0 !== "object") {
      failures.push({ path: "/decision", reason: "decision_required" });
    } else {
      const d = d0 as Record<string, unknown>;
      if (!isNonEmptyString(d.tenantId)) {
        failures.push({ path: "/decision/tenantId", reason: "non_empty_string_required" });
      }
      if (d.decision !== "REQUIRE_APPROVAL") {
        failures.push({ path: "/decision/decision", reason: "decision_not_parked" });
      }
      if (!Array.isArray(d.rules)) {
        failures.push({ path: "/decision/rules", reason: "array_required" });
      } else {
        for (let i = 0; i < d.rules.length; i++) {
          const rule = d.rules[i] as { ruleId?: unknown; ruleVersion?: unknown } | null;
          if (
            rule === null ||
            typeof rule !== "object" ||
            !isNonEmptyString(rule.ruleId) ||
            typeof rule.ruleVersion !== "number"
          ) {
            failures.push({ path: `/decision/rules/${i}`, reason: "rule_ref_required" });
          }
        }
      }
      if (typeof d.decidedAt !== "string" || !looksLikeIso(d.decidedAt)) {
        failures.push({ path: "/decision/decidedAt", reason: "not_iso" });
      }
    }
    if (failures.length === 0) {
      const decision = input.decision;
      // The rule SET (not the rule order) is the decision's identity:
      // rules are canonicalized (sorted) before the digest, so a
      // re-evaluation reporting the same rules in a different order
      // derives the SAME decision ref (permutation-invariant identity).
      const canonicalRules = [...decision.rules].sort((a, b) => {
        if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
        return a.ruleVersion - b.ruleVersion;
      });
      const ruleIds = sortedStrings(decision.rules.map((rule) => rule.ruleId));
      const decisionRef = `gdec_${fnv1a32Hex(
        canonicalJson([decision.tenantId, decision.decidedAt, canonicalRules]),
      )}`;
      derived = {
        tenantId: decision.tenantId,
        subjectRef: decisionRef,
        content: frozen({
          title: "Approval required: Guardian hold",
          summary: "The Contract Guardian held an action for human approval.",
          fields: frozenArray([
            field("subject_ref", decisionRef, "reference"),
            field("surface", "guardian_decision", "machine"),
            field("matched_rule_ids", ruleIds.join(","), "machine"),
            field("decided_at", decision.decidedAt, "machine"),
          ]),
        }),
        priority: "high",
      };
    }
  } else {
    failures.push({ path: "/surface", reason: "unknown_approval_surface" });
  }

  if (failures.length > 0 || derived === null) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.intentInvalid,
        "approval request input is invalid",
        trace,
        frozenArray(failures),
      ),
    };
  }
  return finalizeIntent(
    {
      tenantId: derived.tenantId,
      kind: COMMUNICATION_KINDS.approvalRequest,
      subjectRef: derived.subjectRef,
      content: derived.content,
      priority: derived.priority,
    },
    input,
  );
}

// ---------------------------------------------------------------------------
// Kind 4 — recovery messages (W040 case transitions)
// ---------------------------------------------------------------------------

/** The recovery case statuses (structural twin of W040's statuses). */
export const RECOVERY_CASE_STATUSES = frozen([
  "OPENED",
  "SECURING",
  "SECURED",
  "ESCALATED",
  "REPLACEMENT_PROPOSED",
  "CLOSED",
] as const);

/** The recovery case status facet. */
export type RecoveryCaseStatusFacet = (typeof RECOVERY_CASE_STATUSES)[number];

/** The status → priority derivation table (machine-stable). */
export const RECOVERY_PRIORITY_BY_STATUS: Readonly<
  Record<RecoveryCaseStatusFacet, MessagePriority>
> = frozen({
  OPENED: "normal",
  SECURING: "high",
  SECURED: "normal",
  ESCALATED: "urgent",
  REPLACEMENT_PROPOSED: "normal",
  CLOSED: "low",
});

/**
 * The recovery-case facets the adapter consumes — a STRUCTURAL seam:
 * W040's `RecoveryCaseRecord` (packages/recovery) is ASSIGNABLE to this
 * shape (the `trigger` facet is the trigger's `kind` discriminator only).
 * The binding site injects the real record; proven by test.
 */
export interface RecoveryCaseSource {
  readonly caseId: string;
  readonly tenantId: TenantId;
  readonly deviceId: string;
  readonly version: number;
  readonly status: string;
  readonly trigger: { readonly kind: string };
  readonly openedAt: string;
  readonly transitionedAt?: string;
  readonly closureReason?: string;
}

/** The input of a recovery-message build. */
export interface RecoveryMessageInput extends CommunicationInputBase {
  /** The post-transition case revision (the W040 `RecoveryCaseRecord`). */
  readonly caseRecord: RecoveryCaseSource;
}

/**
 * Build a recovery message from a W040 case transition (PURE). The
 * append-only case revision IS the transition record: version 1 is the
 * case opening; version > 1 is a transition to the revision's status.
 * Machine-stable refusals: an unknown status (`unknown_case_status`), a
 * version-1 revision that is not OPENED or a later revision without a
 * transition instant (`case_version_status_mismatch` /
 * `transition_instant_required`), and a CLOSED revision without a
 * closure reason (`closure_reason_required`).
 *
 * @param input the build input
 * @returns the tagged build result
 */
export function buildRecoveryMessage(input: RecoveryMessageInput): CommunicationBuildResult {
  const failures = validateBaseInput(input);
  const trace = {
    tenantId: SYNTHETIC_SYSTEM_TENANT_ID,
    correlationId: isNonEmptyString(input.correlationId)
      ? input.correlationId
      : AURUM_PIPELINE_CORRELATION_ID,
  };
  const c0 = input.caseRecord as unknown;
  if (c0 === null || typeof c0 !== "object") {
    failures.push({ path: "/caseRecord", reason: "case_record_required" });
  } else {
    const c = c0 as Record<string, unknown>;
    if (!isNonEmptyString(c.caseId)) {
      failures.push({ path: "/caseRecord/caseId", reason: "non_empty_string_required" });
    }
    if (!isNonEmptyString(c.tenantId)) {
      failures.push({ path: "/caseRecord/tenantId", reason: "non_empty_string_required" });
    }
    if (!isNonEmptyString(c.deviceId)) {
      failures.push({ path: "/caseRecord/deviceId", reason: "non_empty_string_required" });
    }
    if (typeof c.version !== "number" || !Number.isInteger(c.version) || c.version < 1) {
      failures.push({ path: "/caseRecord/version", reason: "positive_integer_required" });
    }
    if (!(RECOVERY_CASE_STATUSES as readonly string[]).includes(c.status as string)) {
      failures.push({ path: "/caseRecord/status", reason: "unknown_case_status" });
    }
    const trigger = c.trigger as { kind?: unknown } | null | undefined;
    if (trigger === null || typeof trigger !== "object" || !isNonEmptyString(trigger.kind)) {
      failures.push({ path: "/caseRecord/trigger/kind", reason: "non_empty_string_required" });
    }
    if (typeof c.openedAt !== "string" || !looksLikeIso(c.openedAt)) {
      failures.push({ path: "/caseRecord/openedAt", reason: "not_iso" });
    }
    if (c.version === 1 && c.status !== undefined && c.status !== "OPENED") {
      failures.push({ path: "/caseRecord/status", reason: "case_version_status_mismatch" });
    }
    if (
      typeof c.version === "number" &&
      c.version > 1 &&
      (typeof c.transitionedAt !== "string" || c.transitionedAt.length === 0)
    ) {
      failures.push({ path: "/caseRecord/transitionedAt", reason: "transition_instant_required" });
    }
    if (c.status === "CLOSED" && !isNonEmptyString(c.closureReason)) {
      failures.push({ path: "/caseRecord/closureReason", reason: "closure_reason_required" });
    }
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.intentInvalid,
        "recovery message input is invalid",
        trace,
        frozenArray(failures),
      ),
    };
  }
  const record = input.caseRecord;
  const status = record.status as RecoveryCaseStatusFacet;
  const fields: ContentField[] = [
    field("subject_ref", record.caseId, "reference"),
    field("device_id", record.deviceId, "identity"),
    field("case_status", status, "machine"),
    field("case_version", String(record.version), "machine"),
    field("trigger_kind", record.trigger.kind, "machine"),
    field("opened_at", record.openedAt, "machine"),
  ];
  if (record.transitionedAt !== undefined) {
    fields.push(field("transitioned_at", record.transitionedAt, "machine"));
  }
  if (record.closureReason !== undefined) {
    fields.push(field("closure_reason", record.closureReason, "machine"));
  }
  const opened = record.version === 1;
  const content: MessageContent = frozen({
    title: opened ? "Recovery case opened" : "Recovery case update",
    summary: opened
      ? "A device recovery case was opened."
      : "A device recovery case changed state.",
    fields: frozenArray(fields),
  });
  return finalizeIntent(
    {
      tenantId: record.tenantId,
      kind: COMMUNICATION_KINDS.recoveryMessage,
      subjectRef: record.caseId,
      content,
      priority: RECOVERY_PRIORITY_BY_STATUS[status],
    },
    input,
  );
}

// ---------------------------------------------------------------------------
// Kind 5 — procurement updates (W032 quote/demand events)
// ---------------------------------------------------------------------------

/** The quote lifecycle events (machine-stable; W032 quote statuses). */
export const QUOTE_EVENTS = frozen(["issued", "accepted", "superseded", "rejected"] as const);

/** The quote lifecycle event. */
export type QuoteEvent = (typeof QUOTE_EVENTS)[number];

/** The event → quote-status binding (machine-stable). */
export const QUOTE_STATUS_BY_EVENT: Readonly<Record<QuoteEvent, string>> = frozen({
  issued: "ISSUED",
  accepted: "ACCEPTED",
  superseded: "SUPERSEDED",
  rejected: "REJECTED",
});

/**
 * The quote facets the adapter consumes — a STRUCTURAL seam: W032's
 * `Quote` (packages/procurement) is ASSIGNABLE to this shape. The
 * binding site injects the real record; proven by test.
 */
export interface QuoteUpdateSource {
  readonly quoteId: string;
  readonly tenantId: TenantId;
  readonly demandId: string;
  readonly vendorId: string;
  readonly quoteVersion: number;
  readonly unitPriceUsd: number;
  readonly totalPriceUsd: number;
  readonly leadTimeDays: number;
  readonly warrantyDays: number;
  readonly slaCoverage: number;
  readonly status: string;
  readonly issuedAt: string;
}

/**
 * The demand facets the adapter consumes — a STRUCTURAL seam: W032's
 * `ProcurementDemand` (packages/procurement) is ASSIGNABLE to this shape.
 * The binding site injects the real record; proven by test.
 */
export interface DemandUpdateSource {
  readonly demandId: string;
  readonly tenantId: TenantId;
  readonly workloadId: string;
  readonly description: string;
  readonly quantity: number;
  readonly deadline: string;
  readonly deliveryArea: string;
}

/** The input of a procurement-update build (one facet per surface). */
export type ProcurementUpdateInput =
  | (CommunicationInputBase & {
      readonly surface: "quote";
      readonly event: QuoteEvent;
      readonly quote: QuoteUpdateSource;
    })
  | (CommunicationInputBase & {
      readonly surface: "demand";
      readonly event: "created";
      readonly demand: DemandUpdateSource;
    });

/** Validate a non-negative finite number field. */
function pushNonNegativeNumber(
  failures: { path: string; reason: string }[],
  value: unknown,
  path: string,
): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    failures.push({ path, reason: "non_negative_number_required" });
  }
}

/**
 * Build a procurement update from a W032 quote or demand event (PURE).
 * The event must match the record's lifecycle status
 * (`event_status_mismatch` otherwise — never a guess); a demand whose
 * deadline is past the injected emission instant derives `urgent`.
 *
 * @param input the build input
 * @returns the tagged build result
 */
export function buildProcurementUpdate(input: ProcurementUpdateInput): CommunicationBuildResult {
  const failures = validateBaseInput(input);
  const trace = {
    tenantId: SYNTHETIC_SYSTEM_TENANT_ID,
    correlationId: isNonEmptyString(input.correlationId)
      ? input.correlationId
      : AURUM_PIPELINE_CORRELATION_ID,
  };
  let derived: {
    readonly tenantId: TenantId;
    readonly subjectRef: string;
    readonly content: MessageContent;
    readonly priority: MessagePriority;
  } | null = null;

  if (input.surface === "quote") {
    const q0 = input.quote as unknown;
    if (q0 === null || typeof q0 !== "object") {
      failures.push({ path: "/quote", reason: "quote_required" });
    } else {
      const q = q0 as Record<string, unknown>;
      if (!isNonEmptyString(q.quoteId)) {
        failures.push({ path: "/quote/quoteId", reason: "non_empty_string_required" });
      }
      if (!isNonEmptyString(q.tenantId)) {
        failures.push({ path: "/quote/tenantId", reason: "non_empty_string_required" });
      }
      if (!isNonEmptyString(q.demandId)) {
        failures.push({ path: "/quote/demandId", reason: "non_empty_string_required" });
      }
      if (!isNonEmptyString(q.vendorId)) {
        failures.push({ path: "/quote/vendorId", reason: "non_empty_string_required" });
      }
      if (typeof q.quoteVersion !== "number" || !Number.isInteger(q.quoteVersion) || q.quoteVersion < 1) {
        failures.push({ path: "/quote/quoteVersion", reason: "positive_integer_required" });
      }
      pushNonNegativeNumber(failures, q.unitPriceUsd, "/quote/unitPriceUsd");
      pushNonNegativeNumber(failures, q.totalPriceUsd, "/quote/totalPriceUsd");
      pushNonNegativeNumber(failures, q.leadTimeDays, "/quote/leadTimeDays");
      pushNonNegativeNumber(failures, q.warrantyDays, "/quote/warrantyDays");
      pushNonNegativeNumber(failures, q.slaCoverage, "/quote/slaCoverage");
      if (typeof q.issuedAt !== "string" || !looksLikeIso(q.issuedAt)) {
        failures.push({ path: "/quote/issuedAt", reason: "not_iso" });
      }
      if ((QUOTE_EVENTS as readonly string[]).includes(input.event as string)) {
        const expected = QUOTE_STATUS_BY_EVENT[input.event as QuoteEvent];
        if (q.status !== expected) {
          failures.push({ path: "/quote/status", reason: "event_status_mismatch" });
        }
      } else {
        failures.push({ path: "/event", reason: "unknown_quote_event" });
      }
    }
    if (failures.length === 0) {
      const quote = input.quote;
      const priority: MessagePriority =
        input.event === "accepted" ? "high" : input.event === "rejected" ? "low" : "normal";
      derived = {
        tenantId: quote.tenantId,
        subjectRef: quote.quoteId,
        content: frozen({
          title: "Procurement quote update",
          summary: "A procurement quote changed lifecycle state.",
          fields: frozenArray([
            field("subject_ref", quote.quoteId, "reference"),
            field("surface", "quote", "machine"),
            field("event", input.event, "machine"),
            field("demand_ref", quote.demandId, "reference"),
            field("vendor_id", quote.vendorId, "identity"),
            field("quote_version", String(quote.quoteVersion), "machine"),
            field("quote_status", quote.status, "machine"),
            field("unit_price_usd", String(quote.unitPriceUsd), "machine"),
            field("total_price_usd", String(quote.totalPriceUsd), "machine"),
            field("lead_time_days", String(quote.leadTimeDays), "machine"),
            field("warranty_days", String(quote.warrantyDays), "machine"),
            field("sla_coverage", String(quote.slaCoverage), "machine"),
            field("issued_at", quote.issuedAt, "machine"),
          ]),
        }),
        priority,
      };
    }
  } else if (input.surface === "demand") {
    const d0 = input.demand as unknown;
    if (d0 === null || typeof d0 !== "object") {
      failures.push({ path: "/demand", reason: "demand_required" });
    } else {
      const d = d0 as Record<string, unknown>;
      if (!isNonEmptyString(d.demandId)) {
        failures.push({ path: "/demand/demandId", reason: "non_empty_string_required" });
      }
      if (!isNonEmptyString(d.tenantId)) {
        failures.push({ path: "/demand/tenantId", reason: "non_empty_string_required" });
      }
      if (!isNonEmptyString(d.workloadId)) {
        failures.push({ path: "/demand/workloadId", reason: "non_empty_string_required" });
      }
      if (!isNonEmptyString(d.description)) {
        failures.push({ path: "/demand/description", reason: "non_empty_string_required" });
      }
      if (typeof d.quantity !== "number" || !Number.isInteger(d.quantity) || d.quantity < 1) {
        failures.push({ path: "/demand/quantity", reason: "positive_integer_required" });
      }
      if (typeof d.deadline !== "string" || !looksLikeIso(d.deadline)) {
        failures.push({ path: "/demand/deadline", reason: "not_iso" });
      }
      if (!isNonEmptyString(d.deliveryArea)) {
        failures.push({ path: "/demand/deliveryArea", reason: "non_empty_string_required" });
      }
    }
    if (failures.length === 0) {
      const demand = input.demand;
      const overdue = parseIsoMs(demand.deadline) < parseIsoMs(input.at);
      derived = {
        tenantId: demand.tenantId,
        subjectRef: demand.demandId,
        content: frozen({
          title: "Procurement demand update",
          summary: "A procurement demand was created for vendor matching.",
          fields: frozenArray([
            field("subject_ref", demand.demandId, "reference"),
            field("surface", "demand", "machine"),
            field("event", "created", "machine"),
            field("workload_ref", demand.workloadId, "reference"),
            field("description", demand.description, "reference"),
            field("quantity", String(demand.quantity), "machine"),
            field("deadline", demand.deadline, "machine"),
            field("delivery_area", demand.deliveryArea, "reference"),
          ]),
        }),
        priority: overdue ? "urgent" : "normal",
      };
    }
  } else {
    failures.push({ path: "/surface", reason: "unknown_procurement_surface" });
  }

  if (failures.length > 0 || derived === null) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.intentInvalid,
        "procurement update input is invalid",
        trace,
        frozenArray(failures),
      ),
    };
  }
  return finalizeIntent(
    {
      tenantId: derived.tenantId,
      kind: COMMUNICATION_KINDS.procurementUpdate,
      subjectRef: derived.subjectRef,
      content: derived.content,
      priority: derived.priority,
    },
    input,
  );
}

// ---------------------------------------------------------------------------
// Kind 6 — manager briefings (aggregated summaries)
// ---------------------------------------------------------------------------

/** The deadline sources a briefing can cite (machine-stable). */
export const BRIEFING_DEADLINE_SOURCES = frozen(["maintenance", "procurement"] as const);

/** The deadline source facet. */
export type BriefingDeadlineSource = (typeof BRIEFING_DEADLINE_SOURCES)[number];

/** One deadline cited by a briefing (a ref + its deadline + its source). */
export interface BriefingDeadlineRef {
  readonly ref: string;
  readonly deadline: string;
  readonly source: BriefingDeadlineSource;
}

/**
 * The manager-briefing aggregate the adapter consumes: injected
 * structured inputs (id sets + deadline refs) the adapter derives the
 * summary from deterministically — counts are DEDUPLICATED and SORTED by
 * the adapter, never trusted from the caller's array order.
 */
export interface ManagerBriefingSource {
  readonly tenantId: TenantId;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly openRecoveryCaseIds: readonly string[];
  readonly criticalSecurityFindingIds: readonly string[];
  readonly parkedDecisionRefs: readonly string[];
  readonly deadlineRefs: readonly BriefingDeadlineRef[];
}

/** The input of a manager-briefing build. */
export interface ManagerBriefingInput extends CommunicationInputBase {
  /** The injected aggregate (computed by the caller from domain surfaces). */
  readonly briefing: ManagerBriefingSource;
}

/**
 * Build a manager briefing from an injected aggregate (PURE). The
 * subjectRef is the deterministic digest of the window + the deduplicated
 * id sets — the same window + the same data produce the same briefing
 * identity (the idempotency basis), different data a different identity.
 * Deadlines classify deterministically against the window: `overdue`
 * (before windowStart), `due` (within the window), `later` (after
 * windowEnd). Priority: `high` when anything is overdue or any critical
 * finding is cited, else `normal`.
 *
 * @param input the build input
 * @returns the tagged build result
 */
export function buildManagerBriefing(input: ManagerBriefingInput): CommunicationBuildResult {
  const failures = validateBaseInput(input);
  const trace = {
    tenantId: SYNTHETIC_SYSTEM_TENANT_ID,
    correlationId: isNonEmptyString(input.correlationId)
      ? input.correlationId
      : AURUM_PIPELINE_CORRELATION_ID,
  };
  const b0 = input.briefing as unknown;
  if (b0 === null || typeof b0 !== "object") {
    failures.push({ path: "/briefing", reason: "briefing_required" });
  } else {
    const b = b0 as Record<string, unknown>;
    if (!isNonEmptyString(b.tenantId)) {
      failures.push({ path: "/briefing/tenantId", reason: "non_empty_string_required" });
    }
    if (typeof b.windowStart !== "string" || !looksLikeIso(b.windowStart)) {
      failures.push({ path: "/briefing/windowStart", reason: "not_iso" });
    }
    if (typeof b.windowEnd !== "string" || !looksLikeIso(b.windowEnd)) {
      failures.push({ path: "/briefing/windowEnd", reason: "not_iso" });
    }
    if (
      typeof b.windowStart === "string" &&
      typeof b.windowEnd === "string" &&
      looksLikeIso(b.windowStart) &&
      looksLikeIso(b.windowEnd) &&
      parseIsoMs(b.windowEnd) < parseIsoMs(b.windowStart)
    ) {
      failures.push({ path: "/briefing/windowEnd", reason: "window_inverted" });
    }
    for (const [path, value] of [
      ["/briefing/openRecoveryCaseIds", b.openRecoveryCaseIds],
      ["/briefing/criticalSecurityFindingIds", b.criticalSecurityFindingIds],
      ["/briefing/parkedDecisionRefs", b.parkedDecisionRefs],
    ] as const) {
      if (!Array.isArray(value)) {
        failures.push({ path, reason: "array_required" });
      } else {
        for (let i = 0; i < value.length; i++) {
          if (!isNonEmptyString(value[i])) {
            failures.push({ path: `${path}/${i}`, reason: "non_empty_string_required" });
          }
        }
      }
    }
    if (!Array.isArray(b.deadlineRefs)) {
      failures.push({ path: "/briefing/deadlineRefs", reason: "array_required" });
    } else {
      for (let i = 0; i < b.deadlineRefs.length; i++) {
        const ref = b.deadlineRefs[i] as BriefingDeadlineRef | null;
        if (ref === null || typeof ref !== "object") {
          failures.push({ path: `/briefing/deadlineRefs/${i}`, reason: "object_required" });
          continue;
        }
        if (!isNonEmptyString(ref.ref)) {
          failures.push({ path: `/briefing/deadlineRefs/${i}/ref`, reason: "non_empty_string_required" });
        }
        if (typeof ref.deadline !== "string" || !looksLikeIso(ref.deadline)) {
          failures.push({ path: `/briefing/deadlineRefs/${i}/deadline`, reason: "not_iso" });
        }
        if (!(BRIEFING_DEADLINE_SOURCES as readonly string[]).includes(ref.source)) {
          failures.push({ path: `/briefing/deadlineRefs/${i}/source`, reason: "unknown_deadline_source" });
        }
      }
    }
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.intentInvalid,
        "manager briefing input is invalid",
        trace,
        frozenArray(failures),
      ),
    };
  }
  const briefing = input.briefing;
  const caseIds = dedupeSortedStrings(briefing.openRecoveryCaseIds);
  const findingIds = dedupeSortedStrings(briefing.criticalSecurityFindingIds);
  const parkedRefs = dedupeSortedStrings(briefing.parkedDecisionRefs);
  const windowStartMs = parseIsoMs(briefing.windowStart);
  const windowEndMs = parseIsoMs(briefing.windowEnd);
  // The canonical deadline set: sorted by (ref, deadline, source) canonical
  // form, deduplicated by ref (the canonical-first entry wins — a
  // deterministic pick even when a caller reports the same ref with
  // different deadlines). Input array order and duplicate entries never
  // affect the derived output.
  const canonicalDeadlines = [
    ...new Map(
      [...briefing.deadlineRefs]
        .map((ref) => ({ ref, key: canonicalJson([ref.ref, ref.deadline, ref.source]) }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
        .map((entry) => [entry.ref.ref, entry.ref] as const),
    ).values(),
  ];
  const overdue: string[] = [];
  const due: string[] = [];
  const later: string[] = [];
  for (const ref of canonicalDeadlines) {
    const at = parseIsoMs(ref.deadline);
    if (at < windowStartMs) overdue.push(ref.ref);
    else if (at <= windowEndMs) due.push(ref.ref);
    else later.push(ref.ref);
  }
  const sortedOverdue = sortedStrings(overdue);
  const sortedDue = sortedStrings(due);
  const sortedLater = sortedStrings(later);
  const subjectRef = `brief_${fnv1a32Hex(
    canonicalJson([
      briefing.tenantId,
      briefing.windowStart,
      briefing.windowEnd,
      caseIds,
      findingIds,
      parkedRefs,
      canonicalDeadlines.map((ref) => canonicalJson([ref.ref, ref.deadline, ref.source])),
    ]),
  )}`;
  const priority: MessagePriority =
    sortedOverdue.length > 0 || findingIds.length > 0 ? "high" : "normal";
  const content: MessageContent = frozen({
    title: "Manager briefing",
    summary: "An aggregated fleet briefing was produced for the requested window.",
    fields: frozenArray([
      field("subject_ref", subjectRef, "reference"),
      field("window_start", briefing.windowStart, "machine"),
      field("window_end", briefing.windowEnd, "machine"),
      field("open_recovery_cases", String(caseIds.length), "machine"),
      field("critical_security_findings", String(findingIds.length), "machine"),
      field("parked_decisions", String(parkedRefs.length), "machine"),
      field("deadlines_overdue", String(sortedOverdue.length), "machine"),
      field("deadlines_due", String(sortedDue.length), "machine"),
      field("deadlines_later", String(sortedLater.length), "machine"),
      field("overdue_refs", sortedOverdue.join(","), "reference"),
      field("due_refs", sortedDue.join(","), "reference"),
      field("later_refs", sortedLater.join(","), "reference"),
      field("recovery_case_refs", caseIds.join(","), "reference"),
      field("critical_finding_refs", findingIds.join(","), "reference"),
      field("parked_decision_refs", parkedRefs.join(","), "reference"),
    ]),
  });
  return finalizeIntent(
    {
      tenantId: briefing.tenantId,
      kind: COMMUNICATION_KINDS.managerBriefing,
      subjectRef,
      content,
      priority,
    },
    input,
  );
}
