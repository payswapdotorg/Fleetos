/**
 * @fleetos/identity — the audit emission seam for the W100C durable
 * lifecycle services.
 *
 * The established lane-C pattern (W022/W032/W042 all the way to W090C):
 * consequential mutations emit append-only audit records to an INJECTED
 * sink; the audit PACKAGE is lane C's `@fleetos/audit`, whose sink
 * adapter (`createAuditSinkAdapter(log, { source })`) structurally
 * satisfies this seam WITHOUT any wiring dependency (proven by test in
 * `test/durable/audit-bridge.test.ts`).
 *
 * Emission policy for W100C (the auditable identity lifecycle):
 *   - `identity.workspace.created`      — a workspace/tenant is created;
 *   - `identity.workspace.invitation_created` — a join invitation is issued;
 *   - `identity.workspace.joined`       — a principal joins via invitation;
 *   - `identity.session.opened`         — a durable session is opened;
 *   - `identity.session.revoked`        — a durable session is revoked;
 *   - `identity.role.switched`          — a role switch SUCCEEDED (every
 *     switch writes the audit trail — ROLE-EXPERIENCE-MATRIX rule
 *     `role_switch_is_audited`);
 *   - `identity.role.switch_denied`     — a role switch was REFUSED
 *     (denied outcome with machine-stable reasons);
 *   - `identity.credential.created`     — a password credential is
 *     registered (W121; ids only — never salt/verifier/plain).
 *
 * Pure reads (get/list/resolve) never audit. `lastSeenAt` touches are
 * not consequential and do not audit (documented judgment call).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { CorrelationId, CausationId, TenantId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import { frozen } from "./internal";

/**
 * An append-only audit record handed to the sink by the identity
 * lifecycle services. Carries the full traceability set: tenant scope,
 * the acting principal, action, time, correlation/causation ids, and a
 * JSON-serializable details bag. Structurally compatible with
 * `@fleetos/audit`'s `AuditSinkRecord` (the `subject` field), so
 * `createAuditSinkAdapter(log, { source, actor })` bridges this seam
 * into the real hash-chained audit trail WITHOUT any wiring dependency
 * (proven by test in `test/durable/audit-bridge.test.ts`).
 */
export interface IdentityAuditRecord extends TenantScoped {
  /** Stable machine action name (the vocabulary above). */
  readonly action: string;
  /** The entity the record is about (workspace/session/principal id), or null. */
  readonly subject: string | null;
  /** The acting principal id (who performed the audited action). */
  readonly actorPrincipalId: string;
  /** ISO 8601 timestamp (injected by the emitter — no clock reads). */
  readonly occurredAt: string;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
  /** JSON-serializable action context (ids, roles, session refs). */
  readonly details: Readonly<Record<string, unknown>>;
}

/**
 * The minimal audit sink interface. Implementations MUST be append-only:
 * a record handed to `append` is durably recorded and never rewritten.
 */
export interface IdentityAuditSink {
  append(record: IdentityAuditRecord): void;
}

/** Convenience constructor for a frozen audit record. */
export function makeIdentityAuditRecord(record: IdentityAuditRecord): IdentityAuditRecord {
  return frozen(record);
}

/** The default sink: discards records (used when no sink is injected). */
export const NOOP_IDENTITY_AUDIT_SINK: IdentityAuditSink = frozen({
  append: (_record: IdentityAuditRecord): void => undefined,
});

/** A collecting sink for tests and in-memory deployments. */
export function createInMemoryIdentityAuditSink(): IdentityAuditSink & {
  readonly records: readonly IdentityAuditRecord[];
} {
  const records: IdentityAuditRecord[] = [];
  return frozen({
    append(record: IdentityAuditRecord): void {
      records.push(record);
    },
    get records(): readonly IdentityAuditRecord[] {
      return records;
    },
  });
}

/** Stable machine action names emitted by the identity lifecycle. */
export const IDENTITY_AUDIT_ACTIONS = frozen({
  workspaceCreated: "identity.workspace.created",
  invitationCreated: "identity.workspace.invitation_created",
  workspaceJoined: "identity.workspace.joined",
  sessionOpened: "identity.session.opened",
  sessionRevoked: "identity.session.revoked",
  roleSwitched: "identity.role.switched",
  roleSwitchDenied: "identity.role.switch_denied",
  credentialCreated: "identity.credential.created",
} as const);
