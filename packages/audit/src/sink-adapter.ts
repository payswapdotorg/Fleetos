/**
 * @fleetos/audit — The audit sink adapter (W012 D3).
 *
 * Other lanes cannot import `@fleetos/audit` (the ownership gate permits
 * cross-lane imports only via `@fleetos/contracts`), so they define minimal
 * audit-sink seams in their own packages — e.g. `@fleetos/device-model`'s
 * `AuditSink` (W011): `append(record)` where the record carries
 * { tenantId, action, subject, occurredAt, correlationId, causationId?,
 * details }.
 *
 * This module adapts an `AuditLog` to ANY structurally compatible sink seam
 * — TypeScript structural typing means the returned object satisfies lane
 * B's `AuditSink` interface without importing it. The adaptation:
 *
 *   - the record's `subject` is preserved in `details.subject` (audit
 *     records correlate to entities via `relatedEventIds` + `details`, not
 *     a typed subject field);
 *   - the emitting actor defaults to a service principal named by the
 *     injected `source` (the seam carries no actor — the WHO is the
 *     boundary itself); callers inject a richer actor projection when the
 *     underlying lane knows the acting principal;
 *   - the outcome defaults to success (the seam carries no outcome).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { CorrelationId, CausationId, TenantId } from "@fleetos/contracts";
import { makeTenantContext } from "@fleetos/identity";
import { frozen } from "./internal";
import type { AuditLog } from "./log";
import type { AuditActorRef, AuditOutcome } from "./record";
import { makeAuditActorRef } from "./record";

/**
 * The structural input of the sink adapter: the record shape emitted by
 * lane-local audit seams (device-model's `DeviceModelAuditRecord` satisfies
 * this structurally). `subject` is the entity the record is about (device
 * id), or null when the emission predates attribution.
 */
export interface AuditSinkRecord {
  readonly tenantId: TenantId;
  readonly action: string;
  readonly subject: string | null;
  readonly occurredAt: string;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
  readonly details: Readonly<Record<string, unknown>>;
}

/**
 * The sink contract this adapter produces: structurally compatible with
 * lane-local `AuditSink` seams (`append(record): void`).
 */
export interface AuditSink {
  append(record: AuditSinkRecord): void;
}

/** Options for the adapter. */
export interface AuditSinkAdapterOptions {
  /** The emitting boundary recorded in the WHERE field (e.g. "device-model.ingestion"). */
  readonly source: string;
  /**
   * The actor projection. Either a fixed ref, or a function of the record
   * (for lanes that know the acting principal per record). Defaults to a
   * service actor named by `source`.
   */
  readonly actor?: AuditActorRef | ((record: AuditSinkRecord) => AuditActorRef);
  /** The outcome projection (defaults to success). */
  readonly outcome?: (record: AuditSinkRecord) => AuditOutcome;
}

/**
 * Adapt an `AuditLog` into an `AuditSink` for a lane-local seam. The
 * returned sink appends every record into the log's tenant-scoped,
 * hash-chained, append-only trail.
 *
 * The sink throws on structurally invalid records (the log's validation)
 * and on invalid tenant ids (the identity guard) — sinks MUST NOT drop
 * records silently (`@fleetos/device-model`'s seam contract: a record
 * handed to append is durably recorded and never rewritten).
 *
 * @param log the audit log to append into
 * @param opts adapter options (source is required)
 * @returns a frozen AuditSink
 */
export function createAuditSinkAdapter(
  log: AuditLog,
  opts: AuditSinkAdapterOptions,
): AuditSink {
  if (typeof opts.source !== "string" || opts.source.length === 0) {
    throw new TypeError("createAuditSinkAdapter: source must be a non-empty string");
  }
  return frozen({
    append(record: AuditSinkRecord): void {
      // WHO: the caller's projection, or the emitting boundary itself as a
      // service actor. A caller-supplied fixed actor with a foreign tenant
      // is rejected by the log's actor-tenant validation — loudly, not
      // silently rewritten.
      const actor: AuditActorRef =
        typeof opts.actor === "function"
          ? opts.actor(record)
          : (opts.actor ?? makeAuditActorRef("service", `svc:${opts.source}`, record.tenantId));
      const outcome: AuditOutcome = opts.outcome
        ? opts.outcome(record)
        : frozen({ status: "success" as const });
      const ctx = makeTenantContext(record.tenantId, record.correlationId);
      log.append(ctx, {
        tenantId: record.tenantId,
        actor,
        action: record.action,
        occurredAt: record.occurredAt,
        source: opts.source,
        outcome,
        correlationId: record.correlationId,
        causationId: record.causationId,
        relatedEventIds: [],
        details: frozen({ ...record.details, subject: record.subject }),
      });
    },
  });
}
