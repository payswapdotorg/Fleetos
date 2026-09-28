/**
 * @fleetos/web-commerce — the COMMUNICATION channel surface (W050C Aurum,
 * metadata-only).
 *
 * "Aurum is a communication/intelligence channel; FleetOS remains
 * operational authority." — `spec/ARCHITECTURE-LOCK.md` item 10. The
 * AURUM.md invariant: Aurum returns delivery/outcome metadata and cannot
 * mutate FleetOS truth except through explicitly authorized FleetOS
 * action APIs.
 *
 * This module surfaces the Aurum boundary METADATA-ONLY and READ-ONLY:
 *
 *   - the OUTBOX view: the tenant's emission ledger (what FleetOS asked
 *     Aurum to communicate) — the SIX provider-neutral message kinds,
 *     the derived priorities, the typed recipients, the derived titles/
 *     summaries, the redaction evidence (redacted field keys);
 *   - the DELIVERY view: the metadata-only return path — the per-message
 *     delivery timeline (state, disposition, channel, recipient ref)
 *     and the derived latest-state summaries;
 *   - THE AUTHORITY BOUNDARY: every export here is a PURE read-only
 *     projection. There is NO API that mutates any FleetOS domain store,
 *     emits any message, or acknowledges any delivery — any FleetOS-side
 *     mutation a delivery outcome might prompt flows exclusively through
 *     the authorized action/intent surfaces (never this surface). The
 *     export-surface allowlist test asserts this byte-for-byte.
 *
 * The seam EXCLUDES the provider's own message handle
 * (`providerMessageId`): the display shows the provider-neutral
 * recipient ref + channel (metadata-only).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads; every timestamp is echoed from the ledger records.
 */

import type { TenantId } from "@fleetos/contracts";
import type { DeliveryRecordFacets, OutboxEntryFacets } from "./seams";
import { compareStrings, frozen, frozenArray, makeSurfaceValidationError, tenantMismatch } from "./internal";

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

/** The communication view-model schema version. */
export const COMMUNICATION_VIEW_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// The six message kinds (provider-neutral, verbatim from the W050C model)
// ---------------------------------------------------------------------------

/** The six provider-neutral message kinds (AURUM.md, machine-stable). */
export const COMMUNICATION_KIND_SET: readonly string[] = Object.freeze([
  "maintenance_notice",
  "incident_warning",
  "approval_request",
  "recovery_message",
  "procurement_update",
  "manager_briefing",
]);

// ---------------------------------------------------------------------------
// The outbox view (the emission ledger — read-only)
// ---------------------------------------------------------------------------

/** One outbox display row. */
export interface OutboxRowView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  /** The 1-based, per-tenant, gapless sequence position, verbatim. */
  readonly sequence: number;
  readonly messageId: string;
  /** The provider-neutral message kind (one of the six). */
  readonly kind: string;
  /** The source entity ref (work order id, quote id, ...). */
  readonly subjectRef: string;
  /** The typed recipient (kind + ref — never a raw address). */
  readonly recipient: { readonly kind: string; readonly ref: string };
  /** The derived priority, verbatim. */
  readonly priority: string;
  /** The derived title (machine discriminants only). */
  readonly title: string;
  /** The derived summary (machine discriminants only). */
  readonly summary: string;
  /** The structured field count. */
  readonly fieldCount: number;
  /** The count of redacted field keys (the redaction evidence). */
  readonly redactedFieldCount: number;
  /** The post-redaction content digest (the immutability evidence). */
  readonly contentDigest: string;
  /** The injected emission instant, verbatim. */
  readonly emittedAt: string;
}

/** The outbox list view. */
export interface OutboxListView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  /** Rows in sequence order (the ledger's gapless per-tenant order). */
  readonly rows: readonly OutboxRowView[];
  readonly total: number;
  /** Count by message kind (all six keys present when non-zero kinds occur). */
  readonly byKind: Readonly<Record<string, number>>;
}

/** The tagged result of an outbox view build. */
export type OutboxListResult =
  | { readonly ok: true; readonly view: OutboxListView }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

/** Render the typed recipient as a provider-neutral ref. */
function recipientRef(recipient: OutboxEntryFacets["intent"]["recipient"]): string {
  if (recipient.kind === "role") return `role:${recipient.role ?? ""}`;
  if (recipient.kind === "principal") return `principal:${recipient.principalId ?? ""}`;
  return `${recipient.kind}:`;
}

/**
 * Build the READ-ONLY outbox view (the emission ledger): every message
 * FleetOS asked Aurum to communicate, with the six provider-neutral
 * kinds, the derived priorities, and the redaction evidence. Rows are in
 * the ledger's sequence order (the gapless per-tenant positions).
 *
 * @param tenantId the acting tenant
 * @param entries the W050C `OutboxEntry` records (the tenant's partition)
 * @returns the tagged outbox view result
 */
export function buildOutboxListView(
  tenantId: TenantId,
  entries: readonly OutboxEntryFacets[],
): OutboxListResult {
  if (!Array.isArray(entries)) {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-commerce.communication",
        "outbox view request is invalid",
        tenantId,
        [{ path: "/entries", reason: "array_required" }],
      ),
    };
  }
  for (const entry of entries) {
    const mismatch = tenantMismatch(tenantId, entry?.tenantId, "web-commerce.communication");
    if (mismatch !== null) return { ok: false, error: mismatch };
  }

  const rows = [...entries]
    .sort((a, b) => a.sequence - b.sequence)
    .map((entry) =>
      frozen({
        viewVersion: COMMUNICATION_VIEW_VERSION,
        tenantId,
        sequence: entry.sequence,
        messageId: entry.intent.messageId,
        kind: entry.intent.kind,
        subjectRef: entry.intent.subjectRef,
        recipient: frozen({
          kind: entry.intent.recipient.kind,
          ref: recipientRef(entry.intent.recipient),
        }),
        priority: entry.intent.priority,
        title: entry.intent.content.title,
        summary: entry.intent.content.summary,
        fieldCount: entry.intent.content.fields.length,
        redactedFieldCount: entry.intent.redactedFieldKeys.length,
        contentDigest: entry.intent.contentDigest,
        emittedAt: entry.intent.emittedAt,
      }),
    );

  const byKind: Record<string, number> = {};
  for (const row of rows) byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;

  return {
    ok: true,
    view: frozen({
      viewVersion: COMMUNICATION_VIEW_VERSION,
      tenantId,
      rows: frozenArray(rows),
      total: rows.length,
      byKind: frozen({ ...byKind }),
    }),
  };
}

// ---------------------------------------------------------------------------
// The delivery view (the metadata-only return path — read-only)
// ---------------------------------------------------------------------------

/** One delivery-attempt display row. */
export interface DeliveryAttemptView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly messageRef: string;
  /** The 1-based delivery attempt, verbatim. */
  readonly deliveryAttempt: number;
  /** The reported delivery state (machine-stable), verbatim. */
  readonly state: string;
  /** The state-derived disposition, verbatim. */
  readonly disposition: string;
  /** The provider-neutral recipient ref + channel (metadata-only). */
  readonly recipientRef: string;
  readonly channel: string;
  /** The injected ingestion instant, verbatim. */
  readonly ingestedAt: string;
}

/** The per-message delivery timeline view. */
export interface DeliveryTimelineView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly messageRef: string;
  /** The attempts in append order (attempt asc). */
  readonly attempts: readonly DeliveryAttemptView[];
  readonly attemptCount: number;
  /** The latest state, disposition, and terminal flag (machine-stable). */
  readonly latestState: string | null;
  readonly latestDisposition: string | null;
  readonly terminal: boolean;
}

/** The tagged result of a delivery timeline build. */
export type DeliveryTimelineResult =
  | { readonly ok: true; readonly view: DeliveryTimelineView }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

/** The terminal delivery states (no outgoing transitions). */
const TERMINAL_DELIVERY_STATES: readonly string[] = Object.freeze(["read", "undeliverable"]);

/**
 * Build the READ-ONLY delivery timeline for ONE message ref: the
 * metadata Aurum reported (state, disposition, channel, recipient ref)
 * per delivery attempt, plus the derived latest-state summary. The
 * provider's own message handle is NEVER surfaced (the seam excludes
 * it — LOCK 10 metadata-only).
 *
 * @param tenantId the acting tenant
 * @param messageRef the outbox message id the records report on
 * @param records the W050C `DeliveryRecord` records for the message
 * @returns the tagged timeline result
 */
export function buildDeliveryTimelineView(
  tenantId: TenantId,
  messageRef: string,
  records: readonly DeliveryRecordFacets[],
): DeliveryTimelineResult {
  if (typeof messageRef !== "string" || messageRef.length === 0) {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-commerce.communication",
        "delivery timeline request is invalid",
        tenantId,
        [{ path: "/messageRef", reason: "non_empty_string_required" }],
      ),
    };
  }
  if (!Array.isArray(records)) {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-commerce.communication",
        "delivery timeline request is invalid",
        tenantId,
        [{ path: "/records", reason: "array_required" }],
      ),
    };
  }
  for (const record of records) {
    const mismatch = tenantMismatch(tenantId, record?.tenantId, "web-commerce.communication");
    if (mismatch !== null) return { ok: false, error: mismatch };
    if (record.messageRef !== messageRef) {
      return {
        ok: false,
        error: makeSurfaceValidationError(
          "web-commerce.communication",
          "delivery timeline request is invalid",
          tenantId,
          [{ path: "/records", reason: "message_ref_mismatch" }],
        ),
      };
    }
  }

  const attempts = [...records]
    .sort((a, b) => a.deliveryAttempt - b.deliveryAttempt)
    .map((record) =>
      frozen({
        viewVersion: COMMUNICATION_VIEW_VERSION,
        tenantId,
        messageRef: record.messageRef,
        deliveryAttempt: record.deliveryAttempt,
        state: record.state,
        disposition: record.disposition,
        recipientRef: record.recipient.recipientRef,
        channel: record.recipient.channel,
        ingestedAt: record.ingestedAt,
      }),
    );

  const latest = attempts[attempts.length - 1];
  return {
    ok: true,
    view: frozen({
      viewVersion: COMMUNICATION_VIEW_VERSION,
      tenantId,
      messageRef,
      attempts: frozenArray(attempts),
      attemptCount: attempts.length,
      latestState: latest?.state ?? null,
      latestDisposition: latest?.disposition ?? null,
      terminal: latest !== undefined && TERMINAL_DELIVERY_STATES.includes(latest.state),
    }),
  };
}

// ---------------------------------------------------------------------------
// The communication channel summary (the six kinds + delivery health)
// ---------------------------------------------------------------------------

/** The channel summary (read-only counts, machine-stable). */
export interface CommunicationSummaryView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  /** Total emitted messages (the outbox count). */
  readonly emittedTotal: number;
  /** Count by message kind — all SIX keys always present. */
  readonly emittedByKind: Readonly<Record<string, number>>;
  /** Total delivery records ingested. */
  readonly deliveryRecordsTotal: number;
  /** Count by delivery state (machine-stable keys). */
  readonly deliveryByState: Readonly<Record<string, number>>;
  /** Count by disposition. */
  readonly deliveryByDisposition: Readonly<Record<string, number>>;
}

/** The tagged result of a summary build. */
export type CommunicationSummaryResult =
  | { readonly ok: true; readonly view: CommunicationSummaryView }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

/**
 * Build the READ-ONLY communication channel summary: emitted counts by
 * the six provider-neutral kinds (every key always present) + delivery
 * counts by state and disposition. PURE and DETERMINISTIC.
 *
 * @param tenantId the acting tenant
 * @param outboxEntries the W050C outbox entries (the tenant's partition)
 * @param deliveryRecords the W050C delivery records (the tenant's partition)
 * @returns the tagged summary result
 */
export function buildCommunicationSummaryView(
  tenantId: TenantId,
  outboxEntries: readonly OutboxEntryFacets[],
  deliveryRecords: readonly DeliveryRecordFacets[],
): CommunicationSummaryResult {
  const outbox = buildOutboxListView(tenantId, outboxEntries);
  if (!outbox.ok) return outbox;
  if (!Array.isArray(deliveryRecords)) {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-commerce.communication",
        "communication summary request is invalid",
        tenantId,
        [{ path: "/deliveryRecords", reason: "array_required" }],
      ),
    };
  }
  for (const record of deliveryRecords) {
    const mismatch = tenantMismatch(tenantId, record?.tenantId, "web-commerce.communication");
    if (mismatch !== null) return { ok: false, error: mismatch };
  }

  const emittedByKind: Record<string, number> = {};
  for (const kind of COMMUNICATION_KIND_SET) emittedByKind[kind] = 0;
  for (const row of outbox.view.rows) emittedByKind[row.kind] = (emittedByKind[row.kind] ?? 0) + 1;

  const deliveryByState: Record<string, number> = {};
  const deliveryByDisposition: Record<string, number> = {};
  for (const record of deliveryRecords) {
    deliveryByState[record.state] = (deliveryByState[record.state] ?? 0) + 1;
    deliveryByDisposition[record.disposition] = (deliveryByDisposition[record.disposition] ?? 0) + 1;
  }

  return {
    ok: true,
    view: frozen({
      viewVersion: COMMUNICATION_VIEW_VERSION,
      tenantId,
      emittedTotal: outbox.view.total,
      emittedByKind: frozen({ ...emittedByKind }),
      deliveryRecordsTotal: deliveryRecords.length,
      deliveryByState: frozen({ ...deliveryByState }),
      deliveryByDisposition: frozen({ ...deliveryByDisposition }),
    }),
  };
}

// ---------------------------------------------------------------------------
// The read-only lookup helpers
// ---------------------------------------------------------------------------

/**
 * Select the outbox rows of ONE message kind (read-only lookup; the six
 * kinds are independently selectable). Unknown kinds are refused
 * machine-stably (`unknown_communication_kind`).
 */
export function selectOutboxRowsByKind(
  view: OutboxListView,
  kind: string,
):
  | { readonly ok: true; readonly rows: readonly OutboxRowView[] }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError } {
  if (!COMMUNICATION_KIND_SET.includes(kind)) {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-commerce.communication",
        "unknown communication kind",
        view.tenantId,
        [{ path: "/kind", reason: "unknown_communication_kind" }],
      ),
    };
  }
  const rows = view.rows
    .filter((row) => row.kind === kind)
    .sort((a, b) => compareStrings(a.messageId, b.messageId));
  return { ok: true, rows: frozenArray(rows) };
}
