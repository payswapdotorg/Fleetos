/**
 * @fleetos/audit — the durable audit log (W100C).
 *
 * A `DurableRecordStore`-backed implementation of the frozen `AuditLog`
 * interface (`append / records / head / verify / size` — still NO update,
 * NO delete, NO truncation). The append-only property is structural here
 * too: the ONLY writes are inserts keyed by the per-tenant sequence.
 *
 * Persistence: records serialize into the `fleetos_audit_records` table
 * (declared below — the DDL renders through the identity lane's
 * `renderCreateTableSql`, the single source of truth for table DDL).
 * Nested fields (actor, outcome, relatedEventIds, details,
 * guardianDecision) serialize as CANONICAL JSON (`canonicalJson` — the
 * same basis the hash chain uses, so a re-read record re-hashes
 * identically).
 *
 * Restart continuity: a NEW `createDurableAuditLog` over the SAME store
 * continues each tenant's chain (the sequence and prior-record hash come
 * from the persisted rows — never from in-memory state). The chain
 * verifies across restarts (proven by test).
 *
 * The store seam is the same seam the identity durable repositories use
 * (the W102 Neon binding implements it once for both).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type {
  AuditRecordId,
  CorrelationId,
  EventId,
  GuardianDecision,
  TenantId,
  ValidationFailure,
} from "@fleetos/contracts";
import { asAuditRecordId, asCausationId, asCorrelationId, asTenantId } from "@fleetos/contracts";
import type { TenantContext } from "@fleetos/identity";
import { requireTenantContext } from "@fleetos/identity";
import type { DurableRecordStore } from "@fleetos/identity";
import type { DurableTableDefinition } from "@fleetos/identity";
import { renderCreateTableSql } from "@fleetos/identity";
import { frozen } from "./internal";
import { canonicalJson } from "./internal";
import type { HashFn } from "./hash";
import { AUDIT_GENESIS_HASH, fnv1a32Hex } from "./hash";
import type {
  AuditAppendInput,
  AuditActorRef,
  AuditOutcome,
  AuditRecord,
  AuditRecordIdGenerator,
  AuditVerificationResult,
} from "./record";
import { computeRecordHash, verifyAuditChain } from "./record";
import { AuditValidationError } from "./errors";
import { auditValidationFailure } from "./errors";
import type { AuditLog, AuditLogHead } from "./log";

// ---------------------------------------------------------------------------
// The durable table
// ---------------------------------------------------------------------------

/**
 * `fleetos_audit_records` — the durable audit trail. One row per record,
 * keyed by the per-tenant sequence (the append-only primary ordering).
 */
export const AUDIT_DURABLE_TABLE: DurableTableDefinition = frozen({
  name: "fleetos_audit_records",
  tenantScoped: true,
  description: "The durable append-only audit trail — one row per hash-chained record.",
  columns: frozen([
    { name: "tenant_id", type: "text", nullable: false, description: "The owning tenant (isolation)." },
    { name: "record_id", type: "text", nullable: false, description: "The audit record id (aud_ grammar)." },
    { name: "sequence", type: "integer", nullable: false, description: "1-based per-tenant chain position." },
    { name: "actor", type: "jsonb", nullable: false, description: "The WHO (canonical JSON)." },
    { name: "action", type: "text", nullable: false, description: "The stable machine action name." },
    { name: "occurred_at", type: "timestamptz", nullable: false, description: "WHEN (injected ISO 8601)." },
    { name: "source", type: "text", nullable: false, description: "WHERE (the emitting boundary)." },
    { name: "outcome", type: "jsonb", nullable: false, description: "The OUTCOME (canonical JSON)." },
    { name: "correlation_id", type: "text", nullable: false, description: "The correlation id." },
    { name: "causation_id", type: "text", nullable: true, description: "The causation id, when present." },
    { name: "related_event_ids", type: "jsonb", nullable: false, description: "Related event ids (canonical JSON array)." },
    { name: "details", type: "jsonb", nullable: false, description: "The details bag (canonical JSON object)." },
    { name: "guardian_decision", type: "jsonb", nullable: true, description: "The Guardian decision correlation, when present." },
    { name: "prior_record_hash", type: "text", nullable: false, description: "The prior record's hash (chain link)." },
    { name: "record_hash", type: "text", nullable: false, description: "This record's content hash." },
  ] as const),
  primaryKey: frozen(["sequence"]),
});

/**
 * The rendered DDL for the audit table (deterministic — derived from the
 * definition, the identity lane's single source of truth for DDL
 * rendering). The W102 Neon migration applies this beside the identity
 * tables.
 */
export const AUDIT_DURABLE_DDL: string = renderCreateTableSql(AUDIT_DURABLE_TABLE);

// ---------------------------------------------------------------------------
// Row <-> record translation
// ---------------------------------------------------------------------------

/** The audit table name (the seam's table identifier). */
const TABLE = "fleetos_audit_records";

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate an append input (the W012 discipline, identical semantics). */
function validateAppendInput(
  input: AuditAppendInput,
): ReturnType<typeof auditValidationFailure> | undefined {
  const failures: ValidationFailure[] = [];

  const errorTenant: TenantId =
    typeof input.tenantId === "string" && input.tenantId.length > 0
      ? input.tenantId
      : ("tnt_system" as TenantId);
  const errorCorrelation: CorrelationId =
    typeof input.correlationId === "string" && input.correlationId.length > 0
      ? input.correlationId
      : ("cor_system" as CorrelationId);

  if (typeof input.action !== "string" || input.action.length === 0) {
    failures.push({ path: "/action", reason: "non_empty_string_required" });
  }
  if (typeof input.occurredAt !== "string" || !/T\d{2}:\d{2}/.test(input.occurredAt)) {
    failures.push({ path: "/occurredAt", reason: "iso8601_required" });
  }
  if (typeof input.source !== "string" || input.source.length === 0) {
    failures.push({ path: "/source", reason: "non_empty_string_required" });
  }
  if (typeof input.correlationId !== "string" || input.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "non_empty_string_required" });
  }
  if (typeof input.tenantId !== "string" || input.tenantId.length === 0) {
    failures.push({ path: "/tenantId", reason: "non_empty_string_required" });
  }
  if (!isRecordLike(input.actor)) {
    failures.push({ path: "/actor", reason: "object_required" });
  } else {
    const actor = input.actor as Record<string, unknown>;
    const kinds: readonly unknown[] = ["user", "service", "agent", "system"];
    if (!kinds.includes(actor["kind"])) {
      failures.push({ path: "/actor/kind", reason: "unknown_actor_kind" });
    }
    if (typeof actor["principalId"] !== "string" || (actor["principalId"] as string).length === 0) {
      failures.push({ path: "/actor/principalId", reason: "non_empty_string_required" });
    }
    if (actor["tenantId"] !== input.tenantId) {
      failures.push({ path: "/actor/tenantId", reason: "tenant_mismatch" });
    }
  }
  if (
    !isRecordLike(input.outcome) ||
    typeof (input.outcome as { status?: unknown }).status !== "string"
  ) {
    failures.push({ path: "/outcome", reason: "outcome_shape_required" });
  } else {
    const outcome = input.outcome as { status?: unknown; error?: unknown; reasons?: unknown };
    if (outcome.status !== "success" && outcome.status !== "failure" && outcome.status !== "denied") {
      failures.push({ path: "/outcome/status", reason: "unknown_status" });
    }
    if (outcome.status === "failure" && !isRecordLike(outcome.error)) {
      failures.push({ path: "/outcome/error", reason: "fleet_error_required_on_failure" });
    }
    if (outcome.status === "denied" && !Array.isArray(outcome.reasons)) {
      failures.push({ path: "/outcome/reasons", reason: "reasons_required_on_denied" });
    }
  }
  if (input.relatedEventIds !== undefined) {
    if (!Array.isArray(input.relatedEventIds)) {
      failures.push({ path: "/relatedEventIds", reason: "array_required" });
    } else {
      for (let i = 0; i < input.relatedEventIds.length; i++) {
        const eventId = input.relatedEventIds[i];
        if (typeof eventId !== "string" || eventId.length === 0) {
          failures.push({ path: `/relatedEventIds/${i}`, reason: "non_empty_string_required" });
        }
      }
    }
  }
  if (input.details !== undefined && !isRecordLike(input.details)) {
    failures.push({ path: "/details", reason: "object_required" });
  }
  if (input.guardianDecision !== undefined && input.guardianDecision.tenantId !== input.tenantId) {
    failures.push({ path: "/guardianDecision/tenantId", reason: "tenant_mismatch" });
  }

  if (failures.length === 0) return undefined;
  return auditValidationFailure(
    "append: audit input failed validation",
    failures,
    errorTenant,
    errorCorrelation,
  );
}

/** The durable row for one record (flat + canonical JSON columns). */
function recordToRow(record: AuditRecord): Record<string, string | number | boolean | null> {
  return frozen({
    tenant_id: record.tenantId,
    record_id: record.id,
    sequence: record.sequence,
    actor: canonicalJson(record.actor),
    action: record.action,
    occurred_at: record.occurredAt,
    source: record.source,
    outcome: canonicalJson(record.outcome),
    correlation_id: record.correlationId,
    causation_id: record.causationId ?? null,
    related_event_ids: canonicalJson(record.relatedEventIds),
    details: canonicalJson(record.details),
    guardian_decision: record.guardianDecision === undefined ? null : canonicalJson(record.guardianDecision),
    prior_record_hash: record.priorRecordHash,
    record_hash: record.recordHash,
  });
}

/** Rehydrate one record from a durable row. */
function rowToRecord(row: Record<string, string | number | boolean | null>): AuditRecord {
  const guardianRaw = row["guardian_decision"];
  return frozen({
    id: asAuditRecordId(row["record_id"] as string),
    sequence: row["sequence"] as number,
    tenantId: asTenantId(row["tenant_id"] as string),
    actor: frozen(JSON.parse(row["actor"] as string) as AuditActorRef),
    action: row["action"] as string,
    occurredAt: row["occurred_at"] as string,
    source: row["source"] as string,
    outcome: frozen(JSON.parse(row["outcome"] as string) as AuditOutcome),
    correlationId: asCorrelationId(row["correlation_id"] as string),
    causationId:
      row["causation_id"] !== null
        ? asCausationId(row["causation_id"] as string)
        : undefined,
    relatedEventIds: frozen(JSON.parse(row["related_event_ids"] as string) as readonly EventId[]),
    details: frozen(JSON.parse(row["details"] as string) as Record<string, unknown>),
    guardianDecision:
      guardianRaw !== null
        ? frozen(JSON.parse(guardianRaw as string) as GuardianDecision)
        : undefined,
    priorRecordHash: row["prior_record_hash"] as string,
    recordHash: row["record_hash"] as string,
  });
}

/** The row key: the zero-padded per-tenant sequence (stable ordering). */
function sequenceKey(sequence: number): string {
  return String(sequence).padStart(10, "0");
}

// ---------------------------------------------------------------------------
// The durable log
// ---------------------------------------------------------------------------

/** Options for the durable audit log. */
export interface DurableAuditLogOptions {
  /** The injected hash function (default: the FNV-1a reference hash). */
  readonly hash?: HashFn;
  /**
   * The injected record-id generator. Default: a deterministic
   * restart-stable `aud_d<tenant-tail>_<padded sequence>` derived from
   * the persisted sequence — unique per (tenant, sequence) across
   * restarts. Inject a ULID/UUID generator at a real storage boundary.
   */
  readonly idGenerator?: (tenantId: TenantId, sequence: number) => AuditRecordId;
}

/**
 * Create the durable audit log over a `DurableRecordStore`.
 *
 * The returned object satisfies the frozen `AuditLog` interface
 * EXACTLY: append / records / head / verify / size — no update, no
 * delete, no truncation. Every write is an INSERT keyed by the
 * per-tenant sequence; a duplicate key is an id/sequence collision and
 * THROWS (never silently drops or rewrites).
 *
 * @param store the durable record store (Neon at the W102 binding)
 * @param opts the log options
 * @returns a frozen AuditLog
 */
export function createDurableAuditLog(
  store: DurableRecordStore,
  opts: DurableAuditLogOptions = {},
): AuditLog {
  const hash: HashFn = opts.hash ?? fnv1a32Hex;
  const idOf: (tenantId: TenantId, sequence: number) => AuditRecordId =
    opts.idGenerator ??
    ((tenantId, sequence) =>
      asAuditRecordId(`aud_d${tenantId.slice(4)}_${String(sequence).padStart(6, "0")}`));

  /** The tenant's persisted chain, sequence order. */
  function chainOf(ctx: TenantContext): readonly AuditRecord[] {
    requireTenantContext(ctx);
    return store.list(ctx, TABLE).map((stored) => rowToRecord(stored.row));
  }

  return frozen({
    append(ctx: TenantContext, input: AuditAppendInput): AuditRecord {
      requireTenantContext(ctx);
      // Tenant isolation: the acting context's tenant must match the
      // input's tenant scope (cross-tenant injection refused).
      if (ctx.tenantId !== input.tenantId) {
        throw new AuditValidationError(
          auditValidationFailure(
            "append: acting context tenant does not match the input tenant",
            [{ path: "/tenantId", reason: "tenant_mismatch" }],
            input.tenantId,
            input.correlationId ?? ("cor_system" as CorrelationId),
          ),
        );
      }

      const failure = validateAppendInput(input);
      if (failure !== undefined) {
        throw new AuditValidationError(failure);
      }

      // The chain state comes from PERSISTENCE — a fresh log instance
      // over the same store continues the chain (restart continuity).
      const chain = chainOf(ctx);
      const prior = chain[chain.length - 1];
      const priorRecordHash = prior === undefined ? AUDIT_GENESIS_HASH : prior.recordHash;
      const sequence = chain.length + 1;
      const id: AuditRecordId = idOf(input.tenantId, sequence);

      const hashable = frozen({
        id,
        sequence,
        tenantId: input.tenantId,
        actor: input.actor,
        action: input.action,
        occurredAt: input.occurredAt,
        source: input.source,
        outcome: input.outcome,
        correlationId: input.correlationId,
        causationId: input.causationId,
        relatedEventIds: Object.freeze([...(input.relatedEventIds ?? [])]) as readonly EventId[],
        details: input.details ?? {},
        guardianDecision: input.guardianDecision,
        priorRecordHash,
      });
      const record: AuditRecord = frozen({
        ...hashable,
        recordHash: computeRecordHash(hashable, hash),
      });

      const write = store.insert(ctx, TABLE, sequenceKey(sequence), recordToRow(record));
      if (!write.ok) {
        // A sequence collision means concurrent appenders or a corrupted
        // key space — NEVER silently drop or renumber.
        throw new AuditValidationError(
          auditValidationFailure(
            "append: durable insert refused — the audit chain is append-only and never renumbers",
            [{ path: "/sequence", reason: "sequence_collision" }],
            input.tenantId,
            input.correlationId,
          ),
        );
      }
      return record;
    },

    records(ctx: TenantContext): readonly AuditRecord[] {
      return Object.freeze([...chainOf(ctx)]);
    },

    head(ctx: TenantContext): AuditLogHead | undefined {
      const chain = chainOf(ctx);
      const last = chain[chain.length - 1];
      if (last === undefined) return undefined;
      return frozen({ sequence: last.sequence, recordHash: last.recordHash });
    },

    verify(ctx: TenantContext): AuditVerificationResult {
      const chain = chainOf(ctx);
      if (chain.length === 0) {
        return { ok: true, records: 0, headHash: AUDIT_GENESIS_HASH };
      }
      return verifyAuditChain(chain, hash);
    },

    size(ctx: TenantContext): number {
      requireTenantContext(ctx);
      return store.count(ctx, TABLE);
    },
  });
}
