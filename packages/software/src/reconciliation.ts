/**
 * @fleetos/software — W072 D2: subscription commercial reconciliation.
 *
 * The software lane's arm of the commercial reconciliation pass
 * (procurement owns the demand->quote->acceptance->delivery chains;
 * software owns the subscription -> agreed terms -> provision
 * evidence chains). Every chain link carries typed commercial facts
 * (agreed price/SLA/warranty and the agreed seat count/term vs the
 * delivered provision evidence), consumed STRUCTURALLY: the
 * `SubscriptionChainFacts` twin is satisfiable by the REAL
 * `SoftwareSubscription` record (subscriptionId, softwareId, seatCount,
 * termDays flow verbatim — proven by test in this package's suite),
 * while the agreed commercial terms and the provision evidence are
 * INJECTED at the binding site (the subscription record carries no
 * price/SLA/warranty; those facts arrive with the commercial contract).
 *
 * Discrepancies classify machine-stably with the SAME five-kind
 * taxonomy as the procurement lane (the machine-stable vocabulary of
 * W072), with the seat count playing the quantity role:
 *
 *   - `price_mismatch`  — the delivered unit price differs from the agreed;
 *   - `sla_breach`      — the delivered SLA coverage is below the agreed;
 *   - `warranty_gap`    — the delivered warranty days are below the agreed;
 *   - `undelivered`     — no provision evidence, or provisioned seats
 *                         short of the agreed seat count;
 *   - `over_delivered`  — provisioned seats exceeding the agreed seat
 *                         count.
 *
 * Both sides' refs are carried verbatim: the agreed side's subscription
 * id and the delivered side's provision id (null when no provision
 * evidence exists).
 *
 * READ-ONLY: reconciliation is a REPORT surface, never a mutation path.
 * `runSubscriptionReconciliation` accepts readonly inputs, mutates
 * nothing, writes no store, and returns a new frozen report. The only
 * side effect is the audit emission (append-only logging of the
 * report's computation).
 *
 * Determinism: the report is a pure function of its inputs — the same
 * chains (in any order) plus the same injected `at` produce the
 * byte-identical report (content-addressed reportId, canonical
 * discrepancy ordering).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: `at` is injected by the caller.
 */

import type { CorrelationId, FleetError, TenantId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import type { SoftwareAuditSink } from "./audit-seam";
import { NOOP_SOFTWARE_AUDIT_SINK } from "./audit-seam";
import {
  ERROR_CODES,
  SYNTHETIC_SYSTEM_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT_ID,
  canonicalJson,
  fnv1a32Hex,
  frozen,
  frozenArray,
  looksLikeIso,
  makeValidationError,
} from "./internal";

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

/** The subscription reconciliation report schema version. */
export const SUBSCRIPTION_RECONCILIATION_SCHEMA_VERSION = 1 as const;

/** The subscription reconciliation report model version. */
export const SUBSCRIPTION_RECONCILIATION_MODEL_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Machine-stable discrepancy classification (the W072 five-kind vocabulary)
// ---------------------------------------------------------------------------

/**
 * The machine-stable discrepancy kinds — the same five-kind taxonomy as
 * the procurement lane's commercial reconciliation. The list order
 * below is the CANONICAL classification order.
 */
export type SubscriptionDiscrepancyKind =
  | "price_mismatch"
  | "sla_breach"
  | "warranty_gap"
  | "undelivered"
  | "over_delivered";

/** All discrepancy kinds in canonical order. */
export const SUBSCRIPTION_DISCREPANCY_KINDS: readonly SubscriptionDiscrepancyKind[] = Object.freeze([
  "price_mismatch",
  "sla_breach",
  "warranty_gap",
  "undelivered",
  "over_delivered",
] as const);

/** The canonical kind order (for deterministic report ordering). */
function kindOrder(kind: SubscriptionDiscrepancyKind): number {
  return SUBSCRIPTION_DISCREPANCY_KINDS.indexOf(kind);
}

// ---------------------------------------------------------------------------
// Chain sources (STRUCTURAL twins + injected evidence)
// ---------------------------------------------------------------------------

/**
 * The subscription link of one chain (STRUCTURAL twin of the
 * `SoftwareSubscription` commercial facts: subscriptionId, softwareId,
 * seatCount, termDays — verbatim).
 */
export interface SubscriptionChainFacts {
  readonly tenantId: TenantId;
  /** The subscription id (the agreed side's machine-stable ref). */
  readonly subscriptionId: string;
  /** The software id (carried verbatim). */
  readonly softwareId: string;
  /** The agreed seat count (>= 0). */
  readonly agreedSeatCount: number;
  /** The agreed subscription term in days (>= 0; carried, not classified). */
  readonly agreedTermDays: number;
}

/**
 * The agreed commercial terms of the subscription (INJECTED: the
 * subscription record carries no price/SLA/warranty — these facts
 * arrive with the commercial contract at the binding site).
 */
export interface SubscriptionAgreedTerms {
  /** The agreed unit price (USD, per seat). */
  readonly unitPriceUsd: number;
  /** The agreed SLA coverage in [0, 1]. */
  readonly slaCoverage: number;
  /** The agreed warranty duration (days). */
  readonly warrantyDays: number;
}

/**
 * The provision evidence of one chain (INJECTED delivery side). Null
 * when no provision evidence exists.
 */
export interface SubscriptionProvisionFacts {
  /** The provision id (the delivered side's machine-stable ref). */
  readonly provisionId: string;
  /** The provisioned seat count (>= 0). */
  readonly provisionedSeatCount: number;
  /** The provisioned term in days (>= 0; carried, not classified). */
  readonly provisionedTermDays: number;
  /** The delivered unit price (USD). */
  readonly deliveredUnitPriceUsd: number;
  /** The delivered SLA coverage in [0, 1]. */
  readonly deliveredSlaCoverage: number;
  /** The delivered warranty duration (days). */
  readonly deliveredWarrantyDays: number;
  /** When the provision occurred (injected). */
  readonly provisionedAt: string;
}

/** One subscription -> agreed terms -> provision chain, consumed structurally. */
export interface SubscriptionChainSource {
  readonly subscription: SubscriptionChainFacts;
  readonly agreed: SubscriptionAgreedTerms;
  /** The provision evidence (null: no delivery evidence). */
  readonly provision: SubscriptionProvisionFacts | null;
}

// ---------------------------------------------------------------------------
// The discrepancy record (both sides verbatim)
// ---------------------------------------------------------------------------

/**
 * One classified subscription discrepancy. Carries the refs of BOTH
 * sides verbatim (the agreed side's subscription id, the delivered
 * side's provision id — null when the delivered side is absent) plus
 * the typed fact snapshots of both sides.
 */
export interface SubscriptionDiscrepancy {
  readonly kind: SubscriptionDiscrepancyKind;
  /** The agreed side's ref (the subscription id), verbatim. */
  readonly subscriptionRef: string;
  /** The delivered side's ref (the provision id), verbatim; null when absent. */
  readonly provisionRef: string | null;
  /** The agreed facts (typed snapshot, verbatim). */
  readonly agreed: Readonly<{
    readonly seatCount: number;
    readonly termDays: number;
    readonly unitPriceUsd: number;
    readonly slaCoverage: number;
    readonly warrantyDays: number;
  }>;
  /** The delivered facts (typed snapshot, verbatim); null when absent. */
  readonly delivered: Readonly<{
    readonly seatCount: number;
    readonly termDays: number;
    readonly unitPriceUsd: number;
    readonly slaCoverage: number;
    readonly warrantyDays: number;
  }> | null;
}

// ---------------------------------------------------------------------------
// The report record
// ---------------------------------------------------------------------------

/**
 * A subscription reconciliation report: the READ-ONLY outcome of one
 * reconciliation pass. Frozen at construction; content-addressed.
 * Nothing in this surface writes back to any subscription or store.
 */
export interface SubscriptionReconciliationReport extends TenantScoped {
  /** Deterministic id: `srecon_` + fnv1a32 of the report content. */
  readonly reportId: string;
  readonly tenantId: TenantId;
  /** The number of reconciled chains. */
  readonly chainCount: number;
  /** The chains with provision evidence (machine-stable count). */
  readonly provisionedChainCount: number;
  /** The classified discrepancies (canonical order). */
  readonly discrepancies: readonly SubscriptionDiscrepancy[];
  /** The total discrepancy count. */
  readonly discrepancyCount: number;
  /** Per-kind discrepancy counts (machine-stable). */
  readonly byKind: Readonly<Record<SubscriptionDiscrepancyKind, number>>;
  /** Injected computation timestamp. */
  readonly computedAt: string;
  readonly schemaVersion: number;
  readonly modelVersion: number;
  /** Deterministic content hash (fnv1a32 over canonical JSON; not security). */
  readonly contentHash: string;
}

/** Options of a subscription reconciliation run. */
export interface SubscriptionReconciliationOptions {
  /** Injected run timestamp. */
  readonly at: string;
  /** Correlation id threading the causal graph. */
  readonly correlationId: CorrelationId;
  /** Audit sink (default: no-op). The report computation is consequential — it audits. */
  readonly auditSink?: SoftwareAuditSink;
}

/** The tagged result of a subscription reconciliation run. */
export type SubscriptionReconciliationResult =
  | { readonly ok: true; readonly report: SubscriptionReconciliationReport }
  | { readonly ok: false; readonly error: FleetError };

/** Stable machine action names emitted by the software reconciliation surface. */
export const SOFTWARE_RECONCILIATION_AUDIT_ACTIONS = frozen({
  /** A subscription reconciliation report was computed (READ-ONLY derivation). */
  reportComputed: "software.reconciliation.computed",
} as const);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Validate one chain source. Returns the failure list (empty = ok). */
function validateChain(
  chain: unknown,
  index: number,
  tenantId: TenantId,
): { path: string; reason: string }[] {
  const failures: { path: string; reason: string }[] = [];
  const path = `/chains/${index}`;
  if (chain === null || typeof chain !== "object") {
    return [{ path, reason: "object_required" }];
  }
  const candidate = chain as Record<string, unknown>;
  const subscription = candidate["subscription"];
  if (subscription === null || typeof subscription !== "object") {
    failures.push({ path: `${path}/subscription`, reason: "object_required" });
    return failures;
  }
  const subscriptionRecord = subscription as Record<string, unknown>;
  if (subscriptionRecord["tenantId"] !== tenantId) {
    failures.push({ path: `${path}/subscription/tenantId`, reason: "tenant_mismatch" });
  }
  if (
    typeof subscriptionRecord["subscriptionId"] !== "string" ||
    (subscriptionRecord["subscriptionId"] as string).length === 0
  ) {
    failures.push({ path: `${path}/subscription/subscriptionId`, reason: "required" });
  }
  if (
    typeof subscriptionRecord["softwareId"] !== "string" ||
    (subscriptionRecord["softwareId"] as string).length === 0
  ) {
    failures.push({ path: `${path}/subscription/softwareId`, reason: "required" });
  }
  const seatCount = subscriptionRecord["agreedSeatCount"];
  if (typeof seatCount !== "number" || !Number.isInteger(seatCount) || seatCount < 0) {
    failures.push({ path: `${path}/subscription/agreedSeatCount`, reason: "must_be_integer_at_least_0" });
  }
  const termDays = subscriptionRecord["agreedTermDays"];
  if (typeof termDays !== "number" || !Number.isFinite(termDays) || termDays < 0) {
    failures.push({ path: `${path}/subscription/agreedTermDays`, reason: "must_be_non_negative" });
  }

  const agreed = candidate["agreed"];
  if (agreed === null || typeof agreed !== "object") {
    failures.push({ path: `${path}/agreed`, reason: "object_required" });
  } else {
    const agreedRecord = agreed as Record<string, unknown>;
    if (
      typeof agreedRecord["unitPriceUsd"] !== "number" ||
      !Number.isFinite(agreedRecord["unitPriceUsd"] as number) ||
      (agreedRecord["unitPriceUsd"] as number) < 0
    ) {
      failures.push({ path: `${path}/agreed/unitPriceUsd`, reason: "must_be_non_negative" });
    }
    if (
      typeof agreedRecord["slaCoverage"] !== "number" ||
      !Number.isFinite(agreedRecord["slaCoverage"] as number) ||
      (agreedRecord["slaCoverage"] as number) < 0 ||
      (agreedRecord["slaCoverage"] as number) > 1
    ) {
      failures.push({ path: `${path}/agreed/slaCoverage`, reason: "must_be_in_0_1" });
    }
    if (
      typeof agreedRecord["warrantyDays"] !== "number" ||
      !Number.isFinite(agreedRecord["warrantyDays"] as number) ||
      (agreedRecord["warrantyDays"] as number) < 0
    ) {
      failures.push({ path: `${path}/agreed/warrantyDays`, reason: "must_be_non_negative" });
    }
  }

  const provision = candidate["provision"];
  if (provision !== null && provision !== undefined) {
    if (typeof provision !== "object") {
      failures.push({ path: `${path}/provision`, reason: "object_or_null_required" });
    } else {
      const provisionRecord = provision as Record<string, unknown>;
      if (
        typeof provisionRecord["provisionId"] !== "string" ||
        (provisionRecord["provisionId"] as string).length === 0
      ) {
        failures.push({ path: `${path}/provision/provisionId`, reason: "required" });
      }
      const provisionedSeats = provisionRecord["provisionedSeatCount"];
      if (
        typeof provisionedSeats !== "number" ||
        !Number.isInteger(provisionedSeats) ||
        provisionedSeats < 0
      ) {
        failures.push({ path: `${path}/provision/provisionedSeatCount`, reason: "must_be_integer_at_least_0" });
      }
      if (
        typeof provisionRecord["provisionedTermDays"] !== "number" ||
        !Number.isFinite(provisionRecord["provisionedTermDays"] as number) ||
        (provisionRecord["provisionedTermDays"] as number) < 0
      ) {
        failures.push({ path: `${path}/provision/provisionedTermDays`, reason: "must_be_non_negative" });
      }
      if (
        typeof provisionRecord["deliveredUnitPriceUsd"] !== "number" ||
        !Number.isFinite(provisionRecord["deliveredUnitPriceUsd"] as number) ||
        (provisionRecord["deliveredUnitPriceUsd"] as number) < 0
      ) {
        failures.push({ path: `${path}/provision/deliveredUnitPriceUsd`, reason: "must_be_non_negative" });
      }
      if (
        typeof provisionRecord["deliveredSlaCoverage"] !== "number" ||
        !Number.isFinite(provisionRecord["deliveredSlaCoverage"] as number) ||
        (provisionRecord["deliveredSlaCoverage"] as number) < 0 ||
        (provisionRecord["deliveredSlaCoverage"] as number) > 1
      ) {
        failures.push({ path: `${path}/provision/deliveredSlaCoverage`, reason: "must_be_in_0_1" });
      }
      if (
        typeof provisionRecord["deliveredWarrantyDays"] !== "number" ||
        !Number.isFinite(provisionRecord["deliveredWarrantyDays"] as number) ||
        (provisionRecord["deliveredWarrantyDays"] as number) < 0
      ) {
        failures.push({ path: `${path}/provision/deliveredWarrantyDays`, reason: "must_be_non_negative" });
      }
      if (
        typeof provisionRecord["provisionedAt"] !== "string" ||
        !looksLikeIso(provisionRecord["provisionedAt"] as string)
      ) {
        failures.push({ path: `${path}/provision/provisionedAt`, reason: "not_iso" });
      }
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Classification (pure)
// ---------------------------------------------------------------------------

/**
 * Classify one chain's discrepancies. PURE and deterministic; both-side
 * refs and fact snapshots verbatim. Documented judgment call: the term
 * (agreedTermDays vs provisionedTermDays) is CARRIED in both snapshots
 * but not classified — the v1 five-kind taxonomy has no term kind; the
 * facts remain inspectable on the discrepancy record.
 */
function classifyChain(chain: SubscriptionChainSource): readonly SubscriptionDiscrepancy[] {
  const agreed = {
    seatCount: chain.subscription.agreedSeatCount,
    termDays: chain.subscription.agreedTermDays,
    unitPriceUsd: chain.agreed.unitPriceUsd,
    slaCoverage: chain.agreed.slaCoverage,
    warrantyDays: chain.agreed.warrantyDays,
  };
  const delivered =
    chain.provision === null
      ? null
      : {
          seatCount: chain.provision.provisionedSeatCount,
          termDays: chain.provision.provisionedTermDays,
          unitPriceUsd: chain.provision.deliveredUnitPriceUsd,
          slaCoverage: chain.provision.deliveredSlaCoverage,
          warrantyDays: chain.provision.deliveredWarrantyDays,
        };
  const base = {
    subscriptionRef: chain.subscription.subscriptionId,
    provisionRef: chain.provision === null ? null : chain.provision.provisionId,
  };

  const discrepancies: SubscriptionDiscrepancy[] = [];
  if (chain.provision === null || chain.provision.provisionedSeatCount < chain.subscription.agreedSeatCount) {
    discrepancies.push(frozen({ ...base, kind: "undelivered", agreed, delivered }));
  }
  if (chain.provision !== null && chain.provision.provisionedSeatCount > chain.subscription.agreedSeatCount) {
    discrepancies.push(frozen({ ...base, kind: "over_delivered", agreed, delivered }));
  }
  if (chain.provision !== null && chain.provision.deliveredUnitPriceUsd !== chain.agreed.unitPriceUsd) {
    discrepancies.push(frozen({ ...base, kind: "price_mismatch", agreed, delivered }));
  }
  if (chain.provision !== null && chain.provision.deliveredSlaCoverage < chain.agreed.slaCoverage) {
    discrepancies.push(frozen({ ...base, kind: "sla_breach", agreed, delivered }));
  }
  if (chain.provision !== null && chain.provision.deliveredWarrantyDays < chain.agreed.warrantyDays) {
    discrepancies.push(frozen({ ...base, kind: "warranty_gap", agreed, delivered }));
  }
  return discrepancies;
}

// ---------------------------------------------------------------------------
// The reconciliation run (READ-ONLY)
// ---------------------------------------------------------------------------

/**
 * Run one subscription reconciliation pass over the injected chains.
 * READ-ONLY: the chains are never mutated, no store is touched, and the
 * result is a new frozen report. DETERMINISTIC: chain input order never
 * matters; the same inputs plus the same `at` produce the
 * byte-identical report (content-addressed reportId).
 *
 * @param tenantId the acting tenant (the report's scope)
 * @param chains the subscription -> agreed terms -> provision chains (injected)
 * @param options the run options (at, correlationId, audit sink)
 * @returns the tagged reconciliation result
 */
export function runSubscriptionReconciliation(
  tenantId: TenantId,
  chains: readonly SubscriptionChainSource[],
  options: SubscriptionReconciliationOptions,
): SubscriptionReconciliationResult {
  const failures: { path: string; reason: string }[] = [];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    failures.push({ path: "/tenantId", reason: "required" });
  }
  if (typeof options?.at !== "string" || !looksLikeIso(options.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof options?.correlationId !== "string" || options.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (!Array.isArray(chains) || chains.length === 0) {
    failures.push({ path: "/chains", reason: "must_be_non_empty_array" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.reconciliationInvalid,
        "subscription reconciliation request is invalid",
        {
          tenantId: tenantId ?? SYNTHETIC_SYSTEM_TENANT_ID,
          correlationId: options?.correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID,
        },
        failures,
      ),
    };
  }

  const chainFailures: { path: string; reason: string }[] = [];
  for (let i = 0; i < chains.length; i++) {
    chainFailures.push(...validateChain(chains[i], i, tenantId));
  }
  // Duplicate subscription refs (the chain identity) are refused.
  const subscriptionIds = chains.map((c) => c?.subscription?.subscriptionId ?? "");
  const seen = new Set<string>();
  for (const id of subscriptionIds) {
    if (id.length === 0) continue; // already reported as a field failure
    if (seen.has(id)) {
      chainFailures.push({ path: "/chains", reason: "duplicate_subscription_ref" });
      break;
    }
    seen.add(id);
  }
  if (chainFailures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.reconciliationInvalid,
        "subscription reconciliation request is invalid",
        { tenantId, correlationId: options.correlationId },
        chainFailures,
      ),
    };
  }

  // Canonical chain order (deterministic under permutations).
  const sortedChains = [...chains].sort((a, b) =>
    a.subscription.subscriptionId < b.subscription.subscriptionId
      ? -1
      : a.subscription.subscriptionId > b.subscription.subscriptionId
        ? 1
        : 0,
  );

  const discrepancies = sortedChains
    .flatMap((chain) => [...classifyChain(chain)])
    .sort((a, b) => {
      const byKind = kindOrder(a.kind) - kindOrder(b.kind);
      if (byKind !== 0) return byKind;
      if (a.subscriptionRef !== b.subscriptionRef) {
        return a.subscriptionRef < b.subscriptionRef ? -1 : 1;
      }
      const aProvision = a.provisionRef ?? "";
      const bProvision = b.provisionRef ?? "";
      return aProvision < bProvision ? -1 : aProvision > bProvision ? 1 : 0;
    });

  const byKind: Record<SubscriptionDiscrepancyKind, number> = {
    price_mismatch: 0,
    sla_breach: 0,
    warranty_gap: 0,
    undelivered: 0,
    over_delivered: 0,
  };
  for (const discrepancy of discrepancies) {
    byKind[discrepancy.kind] += 1;
  }

  const content: Omit<SubscriptionReconciliationReport, "contentHash" | "reportId"> = frozen({
    tenantId,
    chainCount: sortedChains.length,
    provisionedChainCount: sortedChains.filter((c) => c.provision !== null).length,
    discrepancies: frozenArray(discrepancies),
    discrepancyCount: discrepancies.length,
    byKind: frozen(byKind),
    computedAt: options.at,
    schemaVersion: SUBSCRIPTION_RECONCILIATION_SCHEMA_VERSION,
    modelVersion: SUBSCRIPTION_RECONCILIATION_MODEL_VERSION,
  });
  const contentHash = fnv1a32Hex(
    canonicalJson({
      tenantId: content.tenantId as string,
      chainCount: content.chainCount,
      provisionedChainCount: content.provisionedChainCount,
      discrepancies: content.discrepancies,
      byKind: content.byKind,
      computedAt: content.computedAt,
      schemaVersion: content.schemaVersion,
      modelVersion: content.modelVersion,
    }),
  );
  const reportId = `srecon_${fnv1a32Hex(
    canonicalJson({ tenantId: tenantId as string, contentHash }),
  )}`;
  const report: SubscriptionReconciliationReport = frozen({ ...content, reportId, contentHash });

  (options.auditSink ?? NOOP_SOFTWARE_AUDIT_SINK).append(
    frozen({
      action: SOFTWARE_RECONCILIATION_AUDIT_ACTIONS.reportComputed,
      tenantId,
      subject: reportId,
      occurredAt: options.at,
      correlationId: options.correlationId,
      details: {
        chainCount: report.chainCount,
        provisionedChainCount: report.provisionedChainCount,
        discrepancyCount: report.discrepancyCount,
        byKind: report.byKind,
        contentHash: report.contentHash,
        readOnly: true,
      },
    }),
  );

  return { ok: true, report };
}
