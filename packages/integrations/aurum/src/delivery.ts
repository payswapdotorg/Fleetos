/**
 * @fleetos/integration-aurum — D2: delivery/outcome metadata ingestion.
 *
 * The RETURN PATH from Aurum is METADATA-ONLY (the AURUM.md invariant):
 * typed delivery records append-only ingested into the adapter's own
 * delivery ledger. Nothing here mutates FleetOS domain truth — the
 * ingestion validates, appends and audits; ANY FleetOS-side action that
 * a delivery outcome might prompt flows exclusively through the existing
 * authorized action/intent surfaces (W041/W040), never through this
 * package (asserted by the authority-boundary test).
 *
 * A delivery record carries:
 *   - the MESSAGE REF (an outbox `messageId` the ACTING tenant emitted);
 *   - the DELIVERY ATTEMPT (1-based);
 *   - the DELIVERY STATE (a machine-stable lifecycle with a typed
 *     transition table and a DERIVED outcome disposition);
 *   - the RECIPIENT METADATA (the provider-neutral recipient ref + the
 *     delivery channel — never a raw address);
 *   - the injected ingestion instant + correlation/causation ids.
 *
 * Ingestion rules (all machine-stable, never a guess):
 *   - unknown refs are REFUSED (`unknown_message_ref`) — a ref the
 *     acting tenant never emitted is indistinguishable from a foreign
 *     tenant's ref (no existence side channel);
 *   - idempotent by (message ref, delivery attempt): re-ingesting the
 *     same pair with the same content is a duplicate no-op; the same
 *     pair with different content is refused (`delivery_conflict`);
 *   - the record's state must be known (`unknown_delivery_state`);
 *   - the record's disposition must match the state-derived disposition
 *     (`disposition_mismatch`);
 *   - the recipient metadata must match the emitted message's recipient
 *     (`recipient_mismatch`);
 *   - a ref in a TERMINAL state (read | undeliverable) absorbs no
 *     further records (`message_terminal`);
 *   - the acting context is guarded (context-free/invalid access
 *     rejected with the types bypassed).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: every timestamp is injected by the caller.
 */

import type { CorrelationId, CausationId, FleetError, TenantId, TenantScoped } from "@fleetos/contracts";
import type { TenantContext, TenantScopedStore, TenantStoreEntry } from "@fleetos/identity";
import { requireTenantContext } from "@fleetos/identity";
import type { AurumAuditSink } from "./audit-seam";
import { AURUM_AUDIT_ACTIONS, NOOP_AURUM_AUDIT_SINK } from "./audit-seam";
import type { OutboxLedger } from "./outbox";
import {
  AURUM_PIPELINE_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT_ID,
  ERROR_CODES,
  canonicalJson,
  frozen,
  frozenArray,
  fnv1a32Hex,
  looksLikeIso,
  makeDomainError,
  makeValidationError,
} from "./internal";

// ---------------------------------------------------------------------------
// The delivery state lifecycle
// ---------------------------------------------------------------------------

/** The delivery states (machine-stable). */
export const DELIVERY_STATES = frozen([
  "queued",
  "sent",
  "delivered",
  "read",
  "failed",
  "undeliverable",
] as const);

/** The delivery state. */
export type DeliveryState = (typeof DELIVERY_STATES)[number];

/**
 * The typed state-lifecycle transition table. The canonical progression
 * is queued -> sent -> delivered -> read; failures may surface from
 * queued or sent (`failed` is per-attempt terminal — a NEW attempt may
 * follow; `undeliverable` is terminally terminal).
 */
export const DELIVERY_STATE_TRANSITIONS: Readonly<Record<DeliveryState, readonly DeliveryState[]>> =
  frozen({
    queued: frozenArray(["sent", "failed", "undeliverable"]),
    sent: frozenArray(["delivered", "failed", "undeliverable"]),
    delivered: frozenArray(["read"]),
    read: frozenArray([]),
    failed: frozenArray([]),
    undeliverable: frozenArray([]),
  });

/** The terminal states (no outgoing transitions). */
export const TERMINAL_DELIVERY_STATES: readonly DeliveryState[] = frozenArray([
  "read",
  "undeliverable",
]);

/**
 * Pure transition predicate: is `from -> to` a legal delivery-state
 * transition per `DELIVERY_STATE_TRANSITIONS`?
 *
 * @param from the current state
 * @param to the proposed next state
 * @returns true when legal
 */
export function canTransitionDeliveryState(from: DeliveryState, to: DeliveryState): boolean {
  const allowed = DELIVERY_STATE_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}

/** The outcome dispositions (machine-stable). */
export const DELIVERY_DISPOSITIONS = frozen(["in_progress", "succeeded", "failed"] as const);

/** The outcome disposition. */
export type DeliveryDisposition = (typeof DELIVERY_DISPOSITIONS)[number];

/** The state → disposition derivation table (machine-stable). */
export const DELIVERY_DISPOSITION_BY_STATE: Readonly<Record<DeliveryState, DeliveryDisposition>> =
  frozen({
    queued: "in_progress",
    sent: "in_progress",
    delivered: "succeeded",
    read: "succeeded",
    failed: "failed",
    undeliverable: "failed",
  });

/**
 * Derive the outcome disposition of a delivery state (pure).
 *
 * @param state the delivery state
 * @returns the derived disposition
 */
export function dispositionForState(state: DeliveryState): DeliveryDisposition {
  return DELIVERY_DISPOSITION_BY_STATE[state];
}

// ---------------------------------------------------------------------------
// The delivery record
// ---------------------------------------------------------------------------

/** The delivery-record payload schema version. */
export const DELIVERY_RECORD_SCHEMA_VERSION = 1 as const;

/**
 * The recipient metadata reported by the provider: the provider-neutral
 * recipient REF (the emitted message's recipient identity — never a raw
 * address) + the delivery channel. `providerMessageId` carries the
 * provider's own message handle when known.
 */
export interface RecipientMetadata {
  /** The emitted message's recipient ref (role name or principal id). */
  readonly recipientRef: string;
  /** The delivery channel (open string, e.g. "email" | "sms" | "push" | "chat"). */
  readonly channel: string;
  /** The provider's own message handle, when known. */
  readonly providerMessageId?: string;
}

/**
 * One append-only delivery/outcome record: the metadata Aurum reported
 * for one (message ref, delivery attempt) pair.
 */
export interface DeliveryRecord extends TenantScoped {
  /** The emitted outbox message id this record reports on. */
  readonly messageRef: string;
  /** The 1-based delivery attempt this record describes. */
  readonly deliveryAttempt: number;
  /** The reported delivery state. */
  readonly state: DeliveryState;
  /** The recipient metadata (provider-neutral ref + channel). */
  readonly recipient: RecipientMetadata;
  /** The outcome disposition (state-derived; validated at ingestion). */
  readonly disposition: DeliveryDisposition;
  /** The injected ingestion instant (ISO 8601). */
  readonly ingestedAt: string;
  /** Correlation id threading the causal graph. */
  readonly correlationId: CorrelationId;
  /** Causation id, when the ingestion is caused by a specific command/event. */
  readonly causationId?: CausationId;
  /** Deterministic digest of the record's CONTENT (idempotency conflicts). */
  readonly contentDigest: string;
  /** The delivery-record payload schema version. */
  readonly schemaVersion: number;
}

/** The input of a delivery ingestion (the record facets + injected trace). */
export interface DeliveryIngestInput {
  readonly messageRef: string;
  readonly deliveryAttempt: number;
  readonly state: DeliveryState;
  readonly recipient: RecipientMetadata;
  readonly disposition: DeliveryDisposition;
  readonly ingestedAt: string;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
}

/** Options for `ingestDeliveryMetadata`. */
export interface DeliveryIngestOptions {
  /** The injected audit sink (consequential mutations + refusals emit; default: no-op). */
  readonly auditSink?: AurumAuditSink;
}

/** The tagged result of a delivery ingestion. */
export type DeliveryIngestResult =
  | {
      readonly ok: true;
      /** The ingested record (freshly appended, or the prior record when duplicate). */
      readonly record: DeliveryRecord;
      /** True when the ingestion was an idempotent duplicate (nothing appended). */
      readonly duplicate: boolean;
    }
  | { readonly ok: false; readonly error: FleetError };

/**
 * The tenant-scoped, append-only delivery ledger. Every operation takes
 * the acting `TenantContext` FIRST; there is NO update and NO delete.
 */
export interface DeliveryLedger {
  /** The records of the acting partition, append order. */
  list(ctx: TenantContext): readonly DeliveryRecord[];
  /** The records for ONE message ref (own partition only), append order. */
  listForMessage(ctx: TenantContext, messageRef: string): readonly DeliveryRecord[];
  /** The number of records in the acting partition. */
  size(ctx: TenantContext): number;
  /** The internal append (validated + idempotent; called by the boundary). */
  append(ctx: TenantContext, record: DeliveryRecord): DeliveryIngestResult;
}

/**
 * The in-memory reference delivery ledger, extended with the raw
 * tenant-scoped KV view (for W012's reusable isolation harness).
 */
export interface InMemoryDeliveryLedger extends DeliveryLedger {
  readonly tenantScopedView: TenantScopedStore<DeliveryRecord>;
}

/**
 * Create the in-memory reference `DeliveryLedger`. Storage is
 * partitioned by tenant id; records are append-only per (messageRef,
 * attempt) key. The TWO-partition judgment call mirrors the outbox
 * ledger (the W032/W042 pattern — the harness's caller-supplied key
 * cannot collide with the deterministic (messageRef, attempt) key).
 */
export function createInMemoryDeliveryLedger(): InMemoryDeliveryLedger {
  /** tenantId -> records (append order). */
  const partitions = new Map<string, DeliveryRecord[]>();
  /** tenantId -> (key -> record) — the raw KV view (W012 harness). */
  const rawPartitions = new Map<string, Map<string, DeliveryRecord>>();

  function partitionOf(tenantId: TenantId): DeliveryRecord[] {
    let partition = partitions.get(tenantId);
    if (partition === undefined) {
      partition = [];
      partitions.set(tenantId, partition);
    }
    return partition;
  }

  function rawPartitionOf(tenantId: TenantId): Map<string, DeliveryRecord> {
    let partition = rawPartitions.get(tenantId);
    if (partition === undefined) {
      partition = new Map<string, DeliveryRecord>();
      rawPartitions.set(tenantId, partition);
    }
    return partition;
  }

  const rich: DeliveryLedger = frozen({
    append(ctx: TenantContext, record: DeliveryRecord): DeliveryIngestResult {
      const tenantId = requireTenantContext(ctx);
      if (
        typeof record !== "object" ||
        record === null ||
        typeof record.messageRef !== "string" ||
        record.messageRef.length === 0
      ) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.deliveryDomain,
            "delivery append requires a well-formed delivery record",
            { tenantId, correlationId: AURUM_PIPELINE_CORRELATION_ID },
            "aurum.delivery",
            "record_invalid",
          ),
        };
      }
      if (record.tenantId !== tenantId) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.deliveryDomain,
            "delivery append refused: record tenantId does not match the acting context",
            { tenantId, correlationId: AURUM_PIPELINE_CORRELATION_ID },
            "aurum.delivery",
            "tenant_mismatch",
          ),
        };
      }
      const partition = partitionOf(tenantId);
      const existing = partition.find(
        (prior) =>
          prior.messageRef === record.messageRef && prior.deliveryAttempt === record.deliveryAttempt,
      );
      if (existing !== undefined) {
        if (existing.contentDigest === record.contentDigest) {
          return { ok: true, record: existing, duplicate: true };
        }
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.deliveryDomain,
            "delivery append refused: (message ref, attempt) re-reported with different content",
            { tenantId, correlationId: record.correlationId },
            "aurum.delivery",
            "delivery_conflict",
          ),
        };
      }
      partition.push(record);
      return { ok: true, record, duplicate: false };
    },

    list(ctx: TenantContext): readonly DeliveryRecord[] {
      const tenantId = requireTenantContext(ctx);
      return frozenArray(partitions.get(tenantId) ?? []);
    },

    listForMessage(ctx: TenantContext, messageRef: string): readonly DeliveryRecord[] {
      const tenantId = requireTenantContext(ctx);
      if (typeof messageRef !== "string" || messageRef.length === 0) return frozenArray([]);
      const partition = partitions.get(tenantId);
      if (partition === undefined) return frozenArray([]);
      return frozenArray(partition.filter((record) => record.messageRef === messageRef));
    },

    size(ctx: TenantContext): number {
      const tenantId = requireTenantContext(ctx);
      return partitions.get(tenantId)?.length ?? 0;
    },
  });

  // The raw KV view — SEPARATE partitions (the outbox judgment call).
  const tenantScopedView: TenantScopedStore<DeliveryRecord> = frozen({
    put(ctx: TenantContext, key: string, value: DeliveryRecord): void {
      const tenantId = requireTenantContext(ctx);
      if (typeof key !== "string" || key.length === 0) {
        throw new TypeError("tenantScopedView: key must be a non-empty string");
      }
      if (typeof value !== "object" || value === null) {
        throw new TypeError("tenantScopedView: value must be a DeliveryRecord object");
      }
      rawPartitionOf(tenantId).set(key, value);
    },
    get(ctx: TenantContext, key: string): DeliveryRecord | undefined {
      const tenantId = requireTenantContext(ctx);
      if (typeof key !== "string" || key.length === 0) return undefined;
      return rawPartitions.get(tenantId)?.get(key);
    },
    has(ctx: TenantContext, key: string): boolean {
      const tenantId = requireTenantContext(ctx);
      if (typeof key !== "string" || key.length === 0) return false;
      return rawPartitions.get(tenantId)?.has(key) ?? false;
    },
    remove(ctx: TenantContext, key: string): boolean {
      const tenantId = requireTenantContext(ctx);
      if (typeof key !== "string" || key.length === 0) return false;
      return rawPartitions.get(tenantId)?.delete(key) ?? false;
    },
    list(ctx: TenantContext): readonly TenantStoreEntry<DeliveryRecord>[] {
      const tenantId = requireTenantContext(ctx);
      const partition = rawPartitions.get(tenantId);
      if (partition === undefined) return frozenArray([]);
      return frozenArray(
        [...partition.entries()]
          .map(([key, value]) => frozen({ key, value }))
          .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
      );
    },
    size(ctx: TenantContext): number {
      const tenantId = requireTenantContext(ctx);
      return rawPartitions.get(tenantId)?.size ?? 0;
    },
  });

  return frozen({ ...rich, tenantScopedView });
}

/** Project the in-memory ledger's view for W012's isolation harness. */
export function asTenantScopedDeliveryStore(
  ledger: InMemoryDeliveryLedger,
): TenantScopedStore<DeliveryRecord> {
  return ledger.tenantScopedView;
}

// ---------------------------------------------------------------------------
// The ingestion boundary
// ---------------------------------------------------------------------------

/** The deterministic content digest of a delivery record's content fields. */
export function deliveryContentDigest(
  record: Omit<DeliveryRecord, "contentDigest">,
): string {
  return fnv1a32Hex(
    canonicalJson([
      record.tenantId,
      record.messageRef,
      record.deliveryAttempt,
      record.state,
      record.recipient,
      record.disposition,
      record.ingestedAt,
      record.correlationId,
      record.causationId ?? null,
    ]),
  );
}

/** A non-empty-string check on an unknown-typed candidate. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Render the recipient ref of an emitted message's typed recipient. */
function recipientRefOf(recipient: { kind: string; role?: string; principalId?: string }): string {
  return recipient.kind === "role" ? (recipient.role ?? "") : (recipient.principalId ?? "");
}

/**
 * Ingest one delivery/outcome metadata record (the aurum return path —
 * METADATA-ONLY). Validates the input (machine-stable refusals), checks
 * the message ref against the ACTING tenant's outbox, and appends
 * idempotently by (message ref, delivery attempt).
 *
 * Emission policy: an ACTUAL append audits `aurum.delivery.ingested`;
 * a refusal audits `aurum.delivery.refused` carrying the machine-stable
 * reason; an idempotent duplicate audits nothing (nothing mutated).
 *
 * @param ctx the acting tenant context (guarded)
 * @param outbox the outbox ledger (the ref existence check — own partition only)
 * @param ledger the delivery ledger (the adapter's OWN ledger)
 * @param input the delivery record input
 * @param options the injected audit sink
 * @returns the tagged ingestion result
 */
export function ingestDeliveryMetadata(
  ctx: TenantContext,
  outbox: OutboxLedger,
  ledger: DeliveryLedger,
  input: DeliveryIngestInput,
  options: DeliveryIngestOptions = {},
): DeliveryIngestResult {
  let tenantId: TenantId;
  try {
    tenantId = requireTenantContext(ctx);
  } catch (err) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.deliveryDomain,
        `delivery ingestion refused: acting context rejected (${
          err instanceof Error ? err.message : String(err)
        })`,
        { tenantId: SYNTHETIC_SYSTEM_TENANT_ID, correlationId: AURUM_PIPELINE_CORRELATION_ID },
        "aurum.delivery.ingestion",
        "acting_context_invalid",
      ),
    };
  }
  const correlationId: CorrelationId = isNonEmptyString(input?.correlationId)
    ? input.correlationId
    : AURUM_PIPELINE_CORRELATION_ID;
  const trace = { tenantId, correlationId };
  const auditSink: AurumAuditSink = options.auditSink ?? NOOP_AURUM_AUDIT_SINK;

  const refuse = (reason: string, message: string, failures?: readonly { path: string; reason: string }[]): DeliveryIngestResult => {
    const error: FleetError =
      failures === undefined
        ? makeDomainError(ERROR_CODES.deliveryDomain, message, trace, "aurum.delivery.ingestion", reason)
        : makeValidationError(ERROR_CODES.deliveryInvalid, message, trace, failures);
    auditSink.append(
      frozen({
        tenantId,
        action: AURUM_AUDIT_ACTIONS.deliveryRefused,
        subject: isNonEmptyString(input?.messageRef) ? input.messageRef : null,
        occurredAt: isNonEmptyString(input?.ingestedAt) ? input.ingestedAt : "1970-01-01T00:00:00Z",
        correlationId,
        details: frozen({ reason, state: typeof input?.state === "string" ? input.state : null }),
      }),
    );
    return { ok: false, error };
  };

  // 1. Input validation (machine-stable, never a guess).
  const failures: { path: string; reason: string }[] = [];
  if (!isNonEmptyString(input?.messageRef)) {
    failures.push({ path: "/messageRef", reason: "non_empty_string_required" });
  }
  if (
    typeof input?.deliveryAttempt !== "number" ||
    !Number.isInteger(input.deliveryAttempt) ||
    input.deliveryAttempt < 1
  ) {
    failures.push({ path: "/deliveryAttempt", reason: "positive_integer_required" });
  }
  if (!(DELIVERY_STATES as readonly string[]).includes(input?.state as string)) {
    failures.push({ path: "/state", reason: "unknown_delivery_state" });
  }
  const recipient = input?.recipient as RecipientMetadata | null | undefined;
  if (recipient === null || typeof recipient !== "object") {
    failures.push({ path: "/recipient", reason: "recipient_metadata_required" });
  } else {
    if (!isNonEmptyString(recipient.recipientRef)) {
      failures.push({ path: "/recipient/recipientRef", reason: "non_empty_string_required" });
    }
    if (!isNonEmptyString(recipient.channel)) {
      failures.push({ path: "/recipient/channel", reason: "non_empty_string_required" });
    }
    if (
      recipient.providerMessageId !== undefined &&
      !isNonEmptyString(recipient.providerMessageId)
    ) {
      failures.push({ path: "/recipient/providerMessageId", reason: "non_empty_string_required" });
    }
  }
  if (!(DELIVERY_DISPOSITIONS as readonly string[]).includes(input?.disposition as string)) {
    failures.push({ path: "/disposition", reason: "unknown_disposition" });
  }
  if (typeof input?.ingestedAt !== "string" || !looksLikeIso(input.ingestedAt)) {
    failures.push({ path: "/ingestedAt", reason: "not_iso" });
  }
  if (!isNonEmptyString(input?.correlationId)) {
    failures.push({ path: "/correlationId", reason: "non_empty_string_required" });
  }
  if (failures.length > 0) {
    return refuse("input_invalid", "delivery record is invalid", frozenArray(failures));
  }

  // 2. Disposition consistency (the disposition is state-derived).
  const state = input.state as DeliveryState;
  if (input.disposition !== dispositionForState(state)) {
    return refuse(
      "disposition_mismatch",
      `delivery record disposition does not match the state-derived disposition (state ${state} requires ${dispositionForState(state)})`,
    );
  }

  // 3. The message ref must exist in the ACTING tenant's outbox — a
  // foreign tenant's ref is indistinguishable from an unknown one (no
  // existence side channel).
  const entry = outbox.get(ctx, input.messageRef);
  if (entry === undefined) {
    return refuse(
      "unknown_message_ref",
      `delivery ingestion refused: message ref ${input.messageRef} is not an emitted message of the acting tenant`,
    );
  }

  // 4. The recipient metadata must match the emitted message's recipient.
  const expectedRef = recipientRefOf(entry.intent.recipient);
  if (input.recipient.recipientRef !== expectedRef) {
    return refuse(
      "recipient_mismatch",
      `delivery ingestion refused: recipient ref does not match the emitted message's recipient`,
    );
  }

  // 5. Build the candidate record (the digest drives idempotency).
  const content: Omit<DeliveryRecord, "contentDigest"> = frozen({
    tenantId,
    messageRef: input.messageRef,
    deliveryAttempt: input.deliveryAttempt,
    state,
    recipient: frozen({ ...input.recipient }),
    disposition: input.disposition,
    ingestedAt: input.ingestedAt,
    correlationId: input.correlationId,
    causationId: input.causationId,
    schemaVersion: DELIVERY_RECORD_SCHEMA_VERSION,
  });
  const record: DeliveryRecord = frozen({
    ...content,
    contentDigest: deliveryContentDigest(content),
  });

  // 6. Idempotency by (message ref, delivery attempt) — checked BEFORE
  // terminality so a re-report of a terminal record is still a duplicate
  // no-op, never a false refusal.
  const priorRecords = ledger.listForMessage(ctx, input.messageRef);
  const existing = priorRecords.find(
    (prior) =>
      prior.messageRef === input.messageRef && prior.deliveryAttempt === input.deliveryAttempt,
  );
  if (existing !== undefined) {
    if (existing.contentDigest === record.contentDigest) {
      return { ok: true, record: existing, duplicate: true };
    }
    return refuse(
      "delivery_conflict",
      `delivery ingestion refused: (message ref, attempt) re-reported with different content`,
    );
  }

  // 7. A ref in a TERMINAL state absorbs no further records (a NEW
  // attempt after read/undeliverable is refused — never a guess).
  const priorTerminal = priorRecords.find((prior) => TERMINAL_DELIVERY_STATES.includes(prior.state));
  if (priorTerminal !== undefined) {
    return refuse(
      "message_terminal",
      `delivery ingestion refused: message ref ${input.messageRef} reached the terminal state ${priorTerminal.state} at attempt ${priorTerminal.deliveryAttempt}`,
    );
  }

  // 8. Append (idempotent by (message ref, attempt); conflict-guarded).
  const append = ledger.append(ctx, record);
  if (!append.ok) {
    const reason =
      append.error.kind === "DomainError"
        ? append.error.invariant ?? "delivery_refused"
        : "delivery_refused";
    return refuse(
      reason,
      `delivery ingestion refused: ${append.error.message}`,
    );
  }
  if (!append.duplicate) {
    auditSink.append(
      frozen({
        tenantId,
        action: AURUM_AUDIT_ACTIONS.deliveryIngested,
        subject: `${input.messageRef}:${input.deliveryAttempt}`,
        occurredAt: input.ingestedAt,
        correlationId: input.correlationId,
        causationId: input.causationId,
        details: frozen({
          messageRef: input.messageRef,
          deliveryAttempt: input.deliveryAttempt,
          state,
          disposition: input.disposition,
          channel: input.recipient.channel,
          contentDigest: record.contentDigest,
        }),
      }),
    );
  }
  return { ok: true, record: append.record, duplicate: append.duplicate };
}

/**
 * The derived delivery summary of one message ref (a pure read for
 * binding sites; never audited).
 */
export interface DeliverySummary {
  readonly attempts: number;
  readonly latestState: DeliveryState | null;
  readonly latestDisposition: DeliveryDisposition | null;
  readonly terminal: boolean;
}

/**
 * Summarize the delivery state of one message ref from its records
 * (pure; latest = last in append order).
 *
 * @param records the ref's delivery records (append order)
 * @returns the frozen summary
 */
export function summarizeDeliveries(records: readonly DeliveryRecord[]): DeliverySummary {
  if (records.length === 0) {
    return frozen({ attempts: 0, latestState: null, latestDisposition: null, terminal: false });
  }
  const latest = records[records.length - 1] as DeliveryRecord;
  return frozen({
    attempts: records.length,
    latestState: latest.state,
    latestDisposition: latest.disposition,
    terminal: TERMINAL_DELIVERY_STATES.includes(latest.state),
  });
}
