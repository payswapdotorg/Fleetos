/**
 * @fleetos/audit — The append-only AuditLog abstraction (W012 D3).
 *
 * The interface exposes EXACTLY: append, records (read-only), head, verify,
 * size. There is NO update and NO delete operation AT ALL — the append-only
 * property is structural, not disciplinary. Records are hash-chained per
 * tenant (each record carries the prior record's hash) through an INJECTED
 * hash function, and `verify` walks the chain to detect tampering.
 *
 * Tenant scoping: every operation takes the `TenantContext` from
 * `@fleetos/identity` as its first parameter; each tenant owns an
 * independent chain (own sequence, own genesis). Cross-tenant access is
 * rejected by the identity guards; the log has no API that names another
 * tenant's chain.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { AuditRecordId, CorrelationId, EventId, TenantId, ValidationFailure } from "@fleetos/contracts";
import type { TenantContext } from "@fleetos/identity";
import {
  SYNTHETIC_SYSTEM_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT_ID,
  assertTenantIsolation,
  requireTenantContext,
} from "@fleetos/identity";
import { frozen } from "./internal";
import type { HashFn } from "./hash";
import { AUDIT_GENESIS_HASH, fnv1a32Hex } from "./hash";
import type {
  AuditAppendInput,
  AuditOutcome,
  AuditRecord,
  AuditRecordIdGenerator,
  AuditVerificationResult,
} from "./record";
import {
  computeRecordHash,
  createSequentialAuditRecordIdGenerator,
  verifyAuditChain,
} from "./record";
import { AuditValidationError } from "./errors";
import { auditValidationFailure } from "./errors";

/**
 * The chain head of a tenant's audit log: the sequence number and content
 * hash of the last appended record. Exposed for EXTERNAL anchoring (a
 * storage wave may pin the head hash periodically; see SKELETON-NOTES
 * lane C, known limitations).
 */
export interface AuditLogHead {
  readonly sequence: number;
  readonly recordHash: string;
}

/**
 * The append-only audit log. The complete operation set is append + read +
 * verify — there is no update, no delete, and no truncation API by design.
 */
export interface AuditLog {
  /**
   * Append a record to the acting tenant's chain. Assigns id + sequence +
   * hash-chain fields; validates the input; returns the frozen record.
   *
   * @param ctx the acting tenant context (must match input.tenantId)
   * @param input the append input
   * @returns the frozen, hash-chained AuditRecord
   * @throws AuditValidationError on invalid input
   * @throws TenantIsolationError on context-free or cross-tenant access
   */
  append(ctx: TenantContext, input: AuditAppendInput): AuditRecord;
  /**
   * The acting tenant's records, in sequence order. The array is a frozen
   * copy; the records themselves are frozen. Read-only by construction.
   *
   * @param ctx the acting tenant context
   */
  records(ctx: TenantContext): readonly AuditRecord[];
  /**
   * The acting tenant's chain head (undefined for an empty chain).
   *
   * @param ctx the acting tenant context
   */
  head(ctx: TenantContext): AuditLogHead | undefined;
  /**
   * Walk the acting tenant's chain and detect tampering (hash mismatch,
   * chain break, sequence gap, spliced foreign record).
   *
   * @param ctx the acting tenant context
   */
  verify(ctx: TenantContext): AuditVerificationResult;
  /**
   * The number of records in the acting tenant's chain.
   *
   * @param ctx the acting tenant context
   */
  size(ctx: TenantContext): number;
}

/** Options for the in-memory reference log. */
export interface InMemoryAuditLogOptions {
  /**
   * The injected hash function. Default: the FNV-1a reference hash
   * (deterministic, non-cryptographic — production injects SHA-256).
   */
  readonly hash?: HashFn;
  /**
   * The injected record-id generator. Default: the sequential `aud_...`
   * reference generator (deterministic per log instance).
   */
  readonly idGenerator?: AuditRecordIdGenerator;
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateAppendInput(
  input: AuditAppendInput,
): ReturnType<typeof auditValidationFailure> | undefined {
  const failures: ValidationFailure[] = [];

  // Fallbacks for the error projection when the input itself is malformed:
  // the synthetic system scope (identity package convention) keeps the
  // FleetError shape valid without inventing permissive tenant ids.
  const errorTenant: TenantId =
    typeof input.tenantId === "string" && input.tenantId.length > 0
      ? input.tenantId
      : SYNTHETIC_SYSTEM_TENANT_ID;
  const errorCorrelation: CorrelationId =
    typeof input.correlationId === "string" && input.correlationId.length > 0
      ? input.correlationId
      : SYNTHETIC_SYSTEM_CORRELATION_ID;

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

/**
 * Create the in-memory reference implementation of `AuditLog`.
 *
 * Storage is partitioned by tenant (one chain per tenant). The ONLY mutable
 * operation is `append`; `records` returns frozen copies. Verification
 * recomputes every content hash and walks the chain via the pure
 * `verifyAuditChain`.
 *
 * @param opts the log options (injected hash + id generator)
 * @returns a frozen AuditLog
 */
export function createInMemoryAuditLog(
  opts: InMemoryAuditLogOptions = {},
): AuditLog {
  const hash: HashFn = opts.hash ?? fnv1a32Hex;
  const idGenerator: AuditRecordIdGenerator =
    opts.idGenerator ?? createSequentialAuditRecordIdGenerator();
  /** Keyed by tenant id string; values are the per-tenant chains. */
  const chains = new Map<string, AuditRecord[]>();

  function chainOf(tenantId: string): AuditRecord[] {
    let chain = chains.get(tenantId);
    if (chain === undefined) {
      chain = [];
      chains.set(tenantId, chain);
    }
    return chain;
  }

  return frozen({
    append(ctx: TenantContext, input: AuditAppendInput): AuditRecord {
      // Tenant isolation: context-free access rejected by the guard;
      // cross-tenant injection (ctx.tenantId !== input.tenantId) rejected.
      assertTenantIsolation(ctx, input);

      const failure = validateAppendInput(input);
      if (failure !== undefined) {
        throw new AuditValidationError(failure);
      }

      const chain = chainOf(ctx.tenantId);
      const prior = chain[chain.length - 1];
      const priorRecordHash = prior === undefined ? AUDIT_GENESIS_HASH : prior.recordHash;
      const sequence = chain.length + 1;
      const id: AuditRecordId = idGenerator();

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
      chain.push(record);
      return record;
    },

    records(ctx: TenantContext): readonly AuditRecord[] {
      const tenantId = requireTenantContext(ctx);
      const chain = chains.get(tenantId);
      if (chain === undefined) return Object.freeze([]);
      return Object.freeze([...chain]);
    },

    head(ctx: TenantContext): AuditLogHead | undefined {
      const tenantId = requireTenantContext(ctx);
      const chain = chains.get(tenantId);
      const last = chain?.[chain.length - 1];
      if (last === undefined) return undefined;
      return frozen({ sequence: last.sequence, recordHash: last.recordHash });
    },

    verify(ctx: TenantContext): AuditVerificationResult {
      const tenantId = requireTenantContext(ctx);
      const chain = chains.get(tenantId);
      if (chain === undefined || chain.length === 0) {
        return { ok: true, records: 0, headHash: AUDIT_GENESIS_HASH };
      }
      return verifyAuditChain(chain, hash);
    },

    size(ctx: TenantContext): number {
      const tenantId = requireTenantContext(ctx);
      return chains.get(tenantId)?.length ?? 0;
    },
  });
}
