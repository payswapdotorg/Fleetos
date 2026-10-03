/**
 * @fleetos/web — W140: the server-plane audit bridge.
 *
 * SERVER-ONLY (apps/web/src/server). Composes the frozen `@fleetos/audit`
 * durable hash-chained log over the request-scoped store, plus the sink
 * adapters that structurally satisfy the lane-local audit seams:
 *
 *   - `@fleetos/device-model`'s `AuditSink` (DeviceModelAuditRecord) via
 *     the audit package's `createAuditSinkAdapter`;
 *   - `@fleetos/identity`'s `IdentityAuditSink` (the W100C lifecycle
 *     services' seam) via a local structural adapter (the identity
 *     record's `actorPrincipalId` becomes the audit actor).
 *
 * Emission discipline (the lanes' law): every consequential mutation and
 * every attributable refusal emits; pure reads never do. Records are
 * append-only and never rewritten (the log enforces it).
 *
 * No `any` in public signatures. Strict TS. No clock reads.
 */

import { createAuditSinkAdapter } from "@fleetos/audit";
import { createDurableAuditLog } from "@fleetos/audit";
import type { AuditLog, AuditSink } from "@fleetos/audit";
import type { CorrelationId, CausationId, TenantId } from "@fleetos/contracts";
import type { DurableRecordStore } from "@fleetos/identity";
import type { IdentityAuditRecord, IdentityAuditSink, TenantContext } from "@fleetos/identity";
import { makeAuditActorRef } from "@fleetos/audit";
import { frozen } from "./server-internal";

/** The audit actions of the server enrollment plane (the frozen
 * enrollment-request store's machine vocabulary, mirrored as literals —
 * equality with `ENROLLMENT_REQUEST_AUDIT_ACTIONS` is proven by the
 * wire-compatibility test). */
export const SERVER_ENROLLMENT_AUDIT_ACTIONS = frozen({
  created: "enrollment.request.created",
  fulfilled: "enrollment.request.fulfilled",
  refused: "enrollment.request.refused",
  revoked: "enrollment.request.revoked",
  expired: "enrollment.request.expired",
} as const);

/** The audit actions of the server agent-check-in plane. */
export const SERVER_AGENT_AUDIT_ACTIONS = frozen({
  checkedIn: "agent.checkin.registered",
  renewed: "agent.checkin.renewed",
  duplicate: "agent.checkin.duplicate-suppressed",
  refused: "agent.checkin.refused",
  observationsAdmitted: "device.observations.admitted",
  observationsDuplicate: "device.observations.duplicate-suppressed",
  observationsShed: "device.observations.shed",
  observationsRejected: "device.observations.rejected",
} as const);

/** The server plane's composed audit surfaces for one request. */
export interface ServerAuditPlane {
  /** The durable hash-chained audit log (the frozen AuditLog). */
  readonly log: AuditLog;
  /** The sink satisfying @fleetos/device-model's AuditSink seam. */
  readonly deviceSink: AuditSink;
  /** The sink satisfying @fleetos/identity's IdentityAuditSink seam. */
  readonly identitySink: IdentityAuditSink;
  /**
   * Append a server-plane audit record directly (the control plane's
   * own actions — enrollment issuance, agent trust lifecycle).
   */
  appendServerRecord(input: {
    readonly tenantId: TenantId;
    readonly action: string;
    readonly subject: string | null;
    readonly occurredAt: string;
    readonly correlationId: CorrelationId;
    readonly causationId?: CausationId;
    readonly actorPrincipalId: string;
    readonly details: Readonly<Record<string, unknown>>;
  }): void;
}

/** The audit log's source label for the server control plane. */
export const SERVER_AUDIT_SOURCE = "web.server-control-plane" as const;

/**
 * Build the request's audit plane over the request-scoped store.
 *
 * @param store the request-scoped DurableRecordStore
 * @returns the frozen audit plane
 */
export function buildServerAuditPlane(store: DurableRecordStore): ServerAuditPlane {
  const log = createDurableAuditLog(store);
  const deviceSink: AuditSink = createAuditSinkAdapter(log, {
    source: SERVER_AUDIT_SOURCE,
  });
  const identitySink: IdentityAuditSink = {
    append(record: IdentityAuditRecord): void {
      const ctx: TenantContext = { tenantId: record.tenantId, correlationId: record.correlationId };
      log.append(ctx, {
        tenantId: record.tenantId,
        actor: makeAuditActorRef(
          record.actorPrincipalId.startsWith("svc:") ? "service" : "user",
          record.actorPrincipalId,
          record.tenantId,
        ),
        action: record.action,
        occurredAt: record.occurredAt,
        source: SERVER_AUDIT_SOURCE,
        outcome: { status: "success" as const },
        correlationId: record.correlationId,
        causationId: record.causationId,
        relatedEventIds: [],
        details: { ...record.details, subject: record.subject },
      });
    },
  };
  return frozen({
    log,
    deviceSink,
    identitySink,
    appendServerRecord(input): void {
      const ctx: TenantContext = { tenantId: input.tenantId, correlationId: input.correlationId };
      log.append(ctx, {
        tenantId: input.tenantId,
        actor: makeAuditActorRef(
          input.actorPrincipalId.startsWith("svc:") || input.actorPrincipalId.startsWith("agt:")
            ? "service"
            : "user",
          input.actorPrincipalId,
          input.tenantId,
        ),
        action: input.action,
        occurredAt: input.occurredAt,
        source: SERVER_AUDIT_SOURCE,
        outcome: { status: "success" as const },
        correlationId: input.correlationId,
        causationId: input.causationId,
        relatedEventIds: [],
        details: { ...input.details, subject: input.subject },
      });
    },
  });
}
