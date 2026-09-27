/**
 * @fleetos/policy — the audit emission seam (W011/W021/W022's pattern).
 *
 * The Contract Guardian emits append-only audit records to an INJECTED
 * audit sink. The audit PACKAGE is lane C's `@fleetos/audit` (W012,
 * accepted); the ownership gate forbids importing it from this lane, so
 * this seam is structurally identical to `@fleetos/device-model`'s W011
 * `AuditSink`, `@fleetos/health`'s W021 seam and `@fleetos/workloads`'s
 * W022 seam: `{ tenantId, action, subject, occurredAt, correlationId,
 * causationId?, details }`. W012's sink adapter
 * (`packages/audit/src/sink-adapter.ts`) adapts any append-only audit log
 * to any structurally identical seam without a cross-lane import
 * (proven by test in this package's test suite).
 *
 * Emission policy (documented, mirrors the W011/W021/W022 judgment
 * calls): audit records are emitted for CONSEQUENTIAL events only —
 * a Guardian evaluation whose decision is BLOCK or REQUIRE_APPROVAL
 * (the decision types that hold or refuse an action), and the
 * publication of a rule-set version (a mutation of the tenant's
 * authorization posture). Pure reads, ALLOW/WARN decisions and failed
 * mutations never audit (the frozen error taxonomy carries its own
 * trace).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { CausationId, CorrelationId, TenantId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import { frozen } from "./internal";

/**
 * An append-only audit record handed to the sink by the Contract
 * Guardian. Carries the full traceability set: tenant scope, subject (the
 * device or principal the decision is about — null when unattributed),
 * action, time, correlation/causation ids, and a JSON-serializable
 * details bag.
 */
export interface PolicyAuditRecord extends TenantScoped {
  /** Stable machine action name (e.g. "policy.guardian.evaluated"). */
  readonly action: string;
  /** The entity the record is about (device id or principal id), or null. */
  readonly subject: string | null;
  /** ISO 8601 timestamp (injected by the emitter — no clock reads). */
  readonly occurredAt: string;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
  /** JSON-serializable action context (decision, rule refs, versions). */
  readonly details: Readonly<Record<string, unknown>>;
}

/**
 * The minimal audit sink interface. Implementations MUST be append-only:
 * a record handed to `append` is durably recorded and never rewritten.
 * The interface is synchronous by design — the policy reference
 * implementation is pure and in-memory; a durable implementation may
 * queue internally, but MUST NOT drop records.
 */
export interface PolicyAuditSink {
  append(record: PolicyAuditRecord): void;
}

/** Convenience constructor for a frozen audit record. */
export function makePolicyAuditRecord(record: PolicyAuditRecord): PolicyAuditRecord {
  return frozen(record);
}

/** The default sink: discards records (used when no sink is injected). */
export const NOOP_POLICY_AUDIT_SINK: PolicyAuditSink = frozen({
  append: (_record: PolicyAuditRecord): void => undefined,
});

/** A collecting sink for tests and in-memory deployments. */
export function createInMemoryPolicyAuditSink(): PolicyAuditSink & {
  readonly records: readonly PolicyAuditRecord[];
} {
  const records: PolicyAuditRecord[] = [];
  return frozen({
    append(record: PolicyAuditRecord): void {
      records.push(record);
    },
    get records(): readonly PolicyAuditRecord[] {
      return records;
    },
  });
}

/** Stable machine action names emitted by the Contract Guardian. */
export const POLICY_AUDIT_ACTIONS = frozen({
  /** A consequential (blocking) Guardian decision: BLOCK or REQUIRE_APPROVAL. */
  guardianEvaluated: "policy.guardian.evaluated",
  /** A rule-set version was published into a tenant's partition. */
  ruleSetPublished: "policy.ruleset.published",
} as const);
