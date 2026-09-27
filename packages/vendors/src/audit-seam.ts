/**
 * @fleetos/vendors — the audit emission seam (W012's pattern).
 *
 * Vendor mutations emit append-only audit records to an INJECTED audit
 * sink. The audit PACKAGE is lane C's `@fleetos/audit` (W012, accepted);
 * this seam is structurally identical to W011's device-model seam, W021's
 * health seam, and W022's workloads seam:
 * `{ tenantId, action, subject, occurredAt, correlationId, causationId?,
 * details }`. W012's sink adapter (`packages/audit/src/sink-adapter.ts`)
 * adapts any `AuditLog` to any structurally identical seam — the adapter
 * returned by `createAuditSinkAdapter(log, { source })` satisfies
 * `VendorAuditSink` WITHOUT any cross-package wiring (proven by test).
 *
 * Emission policy (documented, mirrors the W011/W021/W022 judgment
 * calls): audit records are emitted for CONSEQUENTIAL mutations —
 * vendor created, vendor revised (new revision), inventory revised.
 * Pure reads (get/list) and derived folds (status resolution) do not
 * audit.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { CausationId, CorrelationId, TenantId, VendorId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import { frozen } from "./internal";

/**
 * An append-only audit record handed to the sink by the vendors
 * package. Carries the full traceability set: tenant scope, subject
 * (the vendor), action, time, correlation/causation ids, and a
 * JSON-serializable details bag.
 */
export interface VendorAuditRecord extends TenantScoped {
  /** Stable machine action name (e.g. "vendors.vendor.created"). */
  readonly action: string;
  /** The vendor the record is about. */
  readonly subject: VendorId;
  /** ISO 8601 timestamp (injected by the emitter — no clock reads). */
  readonly occurredAt: string;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
  /** JSON-serializable action context (ids, revisions, hashes). */
  readonly details: Readonly<Record<string, unknown>>;
}

/**
 * The minimal audit sink interface. Implementations MUST be append-only:
 * a record handed to `append` is durably recorded and never rewritten.
 * The interface is synchronous by design — the vendors reference
 * implementation is pure and in-memory; a durable implementation may
 * queue internally, but MUST NOT drop records.
 */
export interface VendorAuditSink {
  append(record: VendorAuditRecord): void;
}

/** Convenience constructor for a frozen audit record. */
export function makeVendorAuditRecord(record: VendorAuditRecord): VendorAuditRecord {
  return frozen(record);
}

/** The default sink: discards records (used when no sink is injected). */
export const NOOP_VENDOR_AUDIT_SINK: VendorAuditSink = frozen({
  append: (_record: VendorAuditRecord): void => undefined,
});

/** A collecting sink for tests and in-memory deployments. */
export function createInMemoryVendorAuditSink(): VendorAuditSink & {
  readonly records: readonly VendorAuditRecord[];
} {
  const records: VendorAuditRecord[] = [];
  return frozen({
    append(record: VendorAuditRecord): void {
      records.push(record);
    },
    get records(): readonly VendorAuditRecord[] {
      return records;
    },
  });
}

/** Stable machine action names emitted by the vendors package. */
export const VENDOR_AUDIT_ACTIONS = frozen({
  vendorCreated: "vendors.vendor.created",
  vendorRevised: "vendors.vendor.revised",
  inventoryRevised: "vendors.inventory.revised",
} as const);
