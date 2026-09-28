/**
 * @fleetos/vendors — W072 D1: vendor scorecards.
 *
 * Versioned, append-only scorecard records derived from CLOSED commercial
 * interactions via STRUCTURAL seams over the frozen lane surfaces:
 *
 *   - W032 match outcomes (`@fleetos/procurement` matching) — the
 *     `MatchOutcomeInteraction` twin;
 *   - W032 quote acceptances (`@fleetos/procurement` quotes) — the
 *     `QuoteAcceptanceInteraction` twin;
 *   - W042 service work-order outcomes (`@fleetos/maintenance`) — the
 *     `ServiceWorkOrderOutcomeInteraction` twin.
 *
 * The twins are STRUCTURAL: the binding site (the caller / the test suite)
 * projects the REAL records field-for-field through them; `src/` never
 * imports the procurement or maintenance packages (the ownership gate
 * permits same-lane imports, but the structural-seam discipline — the
 * W040/W042 pattern over health — is preserved deliberately so the
 * scorecard surface stays a pure consumer of injected facts).
 *
 * Machine-stable quality dimensions, computed DETERMINISTICALLY from the
 * INJECTED interaction records (no aggregates from ambient state — the
 * builder reads only its explicit input, never a store, a log, or a
 * clock):
 *
 *   - `fulfillment`         — did the vendor deliver the contracted
 *                              interaction? (denominator: closed
 *                              contracted interactions; numerator:
 *                              delivered/completed);
 *   - `sla_adherence`       — of the fulfilled interactions, how many
 *                              met the injected SLA evidence;
 *   - `warranty_honoring`   — of the fulfilled interactions, how many
 *                              honored the injected warranty evidence;
 *   - `quote_accuracy`      — of the fulfilled quote interactions with a
 *                              delivered price, how many matched the
 *                              agreed unit price.
 *
 * Every dimension carries its numerator, its denominator, the refs of the
 * interactions it counted, and its value in [0, 1] (`null` iff the
 * denominator is 0 — a dimension with no applicable evidence is NOT a
 * zero, it is unmeasured).
 *
 * Supersession discipline (`spec/ARCHITECTURE-LOCK.md` item 3): a
 * scorecard revision is a NEW record; the prior is never rewritten. A new
 * evaluation window produces a new revision citing the prior via
 * `supersedes`. Revising with an IDENTICAL window is refused
 * (`window_unchanged`) — revisions exist because windows move.
 *
 * Emission policy (mirrors the W032 judgment calls): a successful
 * scorecard build emits exactly one `vendors.scorecard.recorded` audit
 * record to the injected `VendorsOutcomeAuditSink` (the W072 seam —
 * structurally identical to the lane's W012-pattern seams, with the
 * maintenance lane's subject flexibility since a scorecard's subject is
 * its id, not a vendor id); failed builds emit none.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: `at` and every interaction timestamp are injected.
 */

import type { CorrelationId, FleetError, TenantId, VendorId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import type { VendorsOutcomeAuditSink } from "./outcome-audit-seam";
import { NOOP_VENDORS_OUTCOME_AUDIT_SINK } from "./outcome-audit-seam";
import {
  ERROR_CODES,
  SYNTHETIC_SYSTEM_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT_ID,
  canonicalJson,
  fnv1a32Hex,
  frozen,
  frozenArray,
  looksLikeIso,
  makeDomainError,
  makeValidationError,
} from "./internal";

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

/** The scorecard schema version. */
export const SCORECARD_SCHEMA_VERSION = 1 as const;

/** The scorecard model version (bumped when the dimension shapes change). */
export const SCORECARD_MODEL_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Machine-stable quality dimensions
// ---------------------------------------------------------------------------

/**
 * The machine-stable quality dimensions of a vendor scorecard. Callers and
 * auditors match on the kind string; the mapping from interaction kinds to
 * dimensions is documented on each and total (every interaction kind feeds
 * at least the record's interaction refs / match summary).
 */
export type ScorecardQualityDimension =
  | "fulfillment"
  | "sla_adherence"
  | "warranty_honoring"
  | "quote_accuracy";

/** All dimensions in canonical order. */
export const ALL_SCORECARD_DIMENSIONS: readonly ScorecardQualityDimension[] = Object.freeze([
  "fulfillment",
  "sla_adherence",
  "warranty_honoring",
  "quote_accuracy",
] as const);

// ---------------------------------------------------------------------------
// The evaluation window
// ---------------------------------------------------------------------------

/**
 * The evaluation window of a scorecard: every counted interaction's
 * `closedAt` lies within [from, to] (both inclusive, ISO 8601, injected).
 * Carried verbatim on every revision; a NEW window is what produces a NEW
 * revision (supersession discipline).
 */
export interface ScorecardWindow {
  /** Window start (ISO 8601, injected). */
  readonly from: string;
  /** Window end (ISO 8601, injected; must be >= from). */
  readonly to: string;
}

// ---------------------------------------------------------------------------
// Interaction seams (STRUCTURAL twins over the frozen lane surfaces)
// ---------------------------------------------------------------------------

/** The machine-stable kind of an interaction record (its source seam). */
export type ScorecardInteractionKind =
  | "match_outcome"
  | "quote_acceptance"
  | "service_work_order_outcome";

/**
 * A CLOSED W032 match-outcome interaction (STRUCTURAL twin of
 * `@fleetos/procurement`'s `VendorMatch` over one demand). The binding
 * site passes the real match's `vendorId`, `satisfiable` and `rankScore`
 * through verbatim; the match is PRE-CONTRACTUAL evidence (a proposal, not
 * an outcome), so it never counts toward a quality dimension — it is
 * carried in the scorecard's `matchSummary` and `interactionRefs` (the
 * documented judgment call: fulfillment counts contracts, not proposals).
 */
export interface MatchOutcomeInteraction {
  readonly kind: "match_outcome";
  readonly tenantId: TenantId;
  readonly vendorId: VendorId;
  /** The demand that was matched (the machine-stable interaction ref). */
  readonly demandId: string;
  /** True when the vendor satisfied every hard gate (VendorMatch.satisfiable). */
  readonly satisfiable: boolean;
  /** The match rank score in [0, 1] (VendorMatch.rankScore). */
  readonly rankScore: number;
  /** When the match was recorded (injected; the matching run's `at`). */
  readonly recordedAt: string;
  /** The interaction's closure instant (injected; must be inside the window). */
  readonly closedAt: string;
}

/**
 * A CLOSED quote-acceptance interaction (STRUCTURAL twin of
 * `@fleetos/procurement`'s accepted `Quote` + the injected delivery
 * evidence). The agreed facts flow verbatim from the real quote; the
 * delivery facts are INJECTED at the binding site (procurement owns the
 * quote; the outcome evidence arrives from the fulfillment records).
 */
export interface QuoteAcceptanceInteraction {
  readonly kind: "quote_acceptance";
  readonly tenantId: TenantId;
  readonly vendorId: VendorId;
  /** The demand the quote fulfills (carried verbatim for trace). */
  readonly demandId: string;
  /** The quote id (the machine-stable interaction ref). */
  readonly quoteId: string;
  /** Agreed facts — the accepted quote's terms, verbatim. */
  readonly unitPriceUsd: number;
  readonly leadTimeDays: number;
  readonly warrantyDays: number;
  readonly slaCoverage: number;
  /** When the quote was accepted (injected; the acceptance entry's `at`). */
  readonly acceptedAt: string;
  /** Delivery evidence: was the contracted quantity delivered? */
  readonly delivered: boolean;
  /** When delivery completed (null iff `delivered` is false). */
  readonly deliveredAt: string | null;
  /** The delivered unit price (null when undelivered or unpriced). */
  readonly deliveredUnitPriceUsd: number | null;
  /** Did the delivered outcome meet the agreed SLA? (null when undelivered). */
  readonly slaMet: boolean | null;
  /** Did the delivered outcome honor the agreed warranty? (null when undelivered). */
  readonly warrantyHonored: boolean | null;
  /** The interaction's closure instant (injected; must be inside the window). */
  readonly closedAt: string;
}

/**
 * A CLOSED W042 service work-order outcome interaction (STRUCTURAL twin
 * of `@fleetos/maintenance`'s `ServiceWorkOrder` + the injected completion
 * evidence). The work order id, service area and deadline flow verbatim
 * from the real work order; the completion facts are INJECTED at the
 * binding site.
 */
export interface ServiceWorkOrderOutcomeInteraction {
  readonly kind: "service_work_order_outcome";
  readonly tenantId: TenantId;
  /** The vendor that fulfilled the work order (from the matched pair). */
  readonly vendorId: VendorId;
  /** The work order id (the machine-stable interaction ref). */
  readonly workOrderId: string;
  /** The work order's service area (carried verbatim for trace). */
  readonly serviceArea: string;
  /** The work order's customer deadline (carried verbatim). */
  readonly deadline: string;
  /** Completion evidence: was the contract completed? */
  readonly completed: boolean;
  /** When the contract completed (null iff `completed` is false). */
  readonly completedAt: string | null;
  /** Did the completed outcome meet the work order's SLA floor? (null when uncompleted). */
  readonly slaMet: boolean | null;
  /** Did the completed outcome honor the warranty rules? (null when uncompleted). */
  readonly warrantyHonored: boolean | null;
  /** The interaction's closure instant (injected; must be inside the window). */
  readonly closedAt: string;
}

/** A closed commercial interaction injected into a scorecard build. */
export type ScorecardInteraction =
  | MatchOutcomeInteraction
  | QuoteAcceptanceInteraction
  | ServiceWorkOrderOutcomeInteraction;

// ---------------------------------------------------------------------------
// The scorecard record
// ---------------------------------------------------------------------------

/**
 * One dimension's measured score: the numerator, the machine-stable
 * denominator, the refs of the interactions counted in the denominator,
 * and the value in [0, 1] (null iff the denominator is 0 — unmeasured,
 * never silently zero).
 */
export interface ScorecardDimensionScore {
  readonly kind: ScorecardQualityDimension;
  readonly numerator: number;
  readonly denominator: number;
  /** The interaction refs counted in the denominator (canonical order). */
  readonly countedRefs: readonly string[];
  /** value = numerator / denominator in [0, 1]; null iff denominator === 0. */
  readonly value: number | null;
}

/**
 * A vendor scorecard at one immutable revision: the vendor's measured
 * quality over one evaluation window, derived deterministically from the
 * injected closed interactions. Frozen at construction; a new window
 * appends a new revision citing the prior via `supersedes`.
 */
export interface VendorScorecard extends TenantScoped {
  /** Deterministic id: `vsc_` + fnv1a32 of the identity + content hash. */
  readonly scorecardId: string;
  readonly tenantId: TenantId;
  readonly vendorId: VendorId;
  /** 1-based revision (append-only). */
  readonly revision: number;
  /** The prior scorecard this revision supersedes (absent on revision 1). */
  readonly supersedes?: string;
  /** The evaluation window (carried verbatim). */
  readonly window: ScorecardWindow;
  /** The interaction refs verbatim, canonical order (sorted by ref). */
  readonly interactionRefs: readonly string[];
  /** Per-kind interaction counts (machine-stable). */
  readonly interactionCounts: Readonly<Record<ScorecardInteractionKind, number>>;
  /** The W032 match-outcome summary (pre-contractual evidence). */
  readonly matchSummary: Readonly<{
    readonly total: number;
    readonly satisfiable: number;
    readonly rejected: number;
  }>;
  /** The measured dimensions (canonical order). */
  readonly dimensions: readonly ScorecardDimensionScore[];
  /** Injected computation timestamp. */
  readonly computedAt: string;
  /** The scorecard payload schema version. */
  readonly schemaVersion: number;
  /** The scorecard model version. */
  readonly modelVersion: number;
  /** Deterministic content hash (fnv1a32 over canonical JSON; not security). */
  readonly contentHash: string;
}

/** The input of a scorecard build. */
export interface BuildVendorScorecardInput {
  readonly vendorId: VendorId;
  readonly window: ScorecardWindow;
  /** The closed commercial interactions (injected; no ambient state). */
  readonly interactions: readonly ScorecardInteraction[];
  /** Injected computation timestamp. */
  readonly at: string;
  /** Correlation id threading the causal graph. */
  readonly correlationId: CorrelationId;
  /** The prior scorecard revision (supersession; required for revision > 1). */
  readonly prior?: VendorScorecard;
}

/** The tagged result of a scorecard build. */
export type ScorecardBuildResult =
  | { readonly ok: true; readonly scorecard: VendorScorecard }
  | { readonly ok: false; readonly error: FleetError };

/** Stable machine action names emitted by the scorecard surface. */
export const SCORECARD_AUDIT_ACTIONS = frozen({
  /** A scorecard revision was computed and recorded. */
  scorecardRecorded: "vendors.scorecard.recorded",
} as const);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** The interaction ref of an interaction (its contract identifier). */
function interactionRef(interaction: ScorecardInteraction): string {
  switch (interaction.kind) {
    case "match_outcome":
      return interaction.demandId;
    case "quote_acceptance":
      return interaction.quoteId;
    case "service_work_order_outcome":
      return interaction.workOrderId;
  }
}

/** Validate one injected interaction. Returns the failure list (empty = ok). */
function validateInteraction(
  interaction: unknown,
  index: number,
  tenantId: TenantId,
  vendorId: VendorId,
  window: ScorecardWindow,
): { path: string; reason: string }[] {
  const failures: { path: string; reason: string }[] = [];
  const path = `/interactions/${index}`;
  if (interaction === null || typeof interaction !== "object") {
    return [{ path, reason: "object_required" }];
  }
  const candidate = interaction as Record<string, unknown>;
  const kind = candidate["kind"];
  if (
    kind !== "match_outcome" &&
    kind !== "quote_acceptance" &&
    kind !== "service_work_order_outcome"
  ) {
    failures.push({ path: `${path}/kind`, reason: "unknown_interaction_kind" });
    return failures;
  }
  if (candidate["tenantId"] !== tenantId) {
    failures.push({ path: `${path}/tenantId`, reason: "tenant_mismatch" });
  }
  if (candidate["vendorId"] !== vendorId) {
    failures.push({ path: `${path}/vendorId`, reason: "foreign_interaction" });
  }
  if (typeof candidate["closedAt"] !== "string" || !looksLikeIso(candidate["closedAt"] as string)) {
    failures.push({ path: `${path}/closedAt`, reason: "not_iso" });
  }
  const closedMs = Date.parse(candidate["closedAt"] as string);
  const fromMs = Date.parse(window.from);
  const toMs = Date.parse(window.to);
  if (
    Number.isFinite(closedMs) &&
    Number.isFinite(fromMs) &&
    Number.isFinite(toMs) &&
    (closedMs < fromMs || closedMs > toMs)
  ) {
    failures.push({ path: `${path}/closedAt`, reason: "outside_window" });
  }

  if (kind === "match_outcome") {
    const demandId = candidate["demandId"];
    if (typeof demandId !== "string" || demandId.length === 0) {
      failures.push({ path: `${path}/demandId`, reason: "required" });
    }
    if (typeof candidate["satisfiable"] !== "boolean") {
      failures.push({ path: `${path}/satisfiable`, reason: "boolean_required" });
    }
    const rankScore = candidate["rankScore"];
    if (
      typeof rankScore !== "number" ||
      !Number.isFinite(rankScore) ||
      rankScore < 0 ||
      rankScore > 1
    ) {
      failures.push({ path: `${path}/rankScore`, reason: "must_be_in_0_1" });
    }
    if (typeof candidate["recordedAt"] !== "string" || !looksLikeIso(candidate["recordedAt"] as string)) {
      failures.push({ path: `${path}/recordedAt`, reason: "not_iso" });
    }
    return failures;
  }

  if (kind === "quote_acceptance") {
    for (const field of ["demandId", "quoteId"] as const) {
      const value = candidate[field];
      if (typeof value !== "string" || value.length === 0) {
        failures.push({ path: `${path}/${field}`, reason: "required" });
      }
    }
    for (const field of ["unitPriceUsd", "leadTimeDays", "warrantyDays"] as const) {
      const value = candidate[field];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        failures.push({ path: `${path}/${field}`, reason: "must_be_non_negative" });
      }
    }
    const slaCoverage = candidate["slaCoverage"];
    if (
      typeof slaCoverage !== "number" ||
      !Number.isFinite(slaCoverage) ||
      slaCoverage < 0 ||
      slaCoverage > 1
    ) {
      failures.push({ path: `${path}/slaCoverage`, reason: "must_be_in_0_1" });
    }
    if (typeof candidate["acceptedAt"] !== "string" || !looksLikeIso(candidate["acceptedAt"] as string)) {
      failures.push({ path: `${path}/acceptedAt`, reason: "not_iso" });
    }
    const delivered = candidate["delivered"];
    if (typeof delivered !== "boolean") {
      failures.push({ path: `${path}/delivered`, reason: "boolean_required" });
      return failures;
    }
    if (delivered) {
      if (typeof candidate["deliveredAt"] !== "string" || !looksLikeIso(candidate["deliveredAt"] as string)) {
        failures.push({ path: `${path}/deliveredAt`, reason: "not_iso" });
      }
      // slaMet / warrantyHonored are booleans when delivered.
      if (typeof candidate["slaMet"] !== "boolean") {
        failures.push({ path: `${path}/slaMet`, reason: "boolean_required" });
      }
      if (typeof candidate["warrantyHonored"] !== "boolean") {
        failures.push({ path: `${path}/warrantyHonored`, reason: "boolean_required" });
      }
      const deliveredPrice = candidate["deliveredUnitPriceUsd"];
      if (
        deliveredPrice !== null &&
        (typeof deliveredPrice !== "number" || !Number.isFinite(deliveredPrice) || deliveredPrice < 0)
      ) {
        failures.push({ path: `${path}/deliveredUnitPriceUsd`, reason: "must_be_non_negative_or_null" });
      }
    } else {
      // Undelivered: the outcome fields must be null (machine-stable totality).
      if (candidate["deliveredAt"] !== null) {
        failures.push({ path: `${path}/deliveredAt`, reason: "must_be_null_when_undelivered" });
      }
      if (candidate["slaMet"] !== null) {
        failures.push({ path: `${path}/slaMet`, reason: "must_be_null_when_undelivered" });
      }
      if (candidate["warrantyHonored"] !== null) {
        failures.push({ path: `${path}/warrantyHonored`, reason: "must_be_null_when_undelivered" });
      }
      if (candidate["deliveredUnitPriceUsd"] !== null) {
        failures.push({ path: `${path}/deliveredUnitPriceUsd`, reason: "must_be_null_when_undelivered" });
      }
    }
    return failures;
  }

  // kind === "service_work_order_outcome"
  for (const field of ["workOrderId", "serviceArea", "deadline"] as const) {
    const value = candidate[field];
    if (typeof value !== "string" || value.length === 0) {
      failures.push({ path: `${path}/${field}`, reason: "required" });
    }
  }
  if (typeof candidate["deadline"] === "string" && !looksLikeIso(candidate["deadline"] as string)) {
    failures.push({ path: `${path}/deadline`, reason: "not_iso" });
  }
  const completed = candidate["completed"];
  if (typeof completed !== "boolean") {
    failures.push({ path: `${path}/completed`, reason: "boolean_required" });
    return failures;
  }
  if (completed) {
    if (typeof candidate["completedAt"] !== "string" || !looksLikeIso(candidate["completedAt"] as string)) {
      failures.push({ path: `${path}/completedAt`, reason: "not_iso" });
    }
    if (typeof candidate["slaMet"] !== "boolean") {
      failures.push({ path: `${path}/slaMet`, reason: "boolean_required" });
    }
    if (typeof candidate["warrantyHonored"] !== "boolean") {
      failures.push({ path: `${path}/warrantyHonored`, reason: "boolean_required" });
    }
  } else {
    if (candidate["completedAt"] !== null) {
      failures.push({ path: `${path}/completedAt`, reason: "must_be_null_when_uncompleted" });
    }
    if (candidate["slaMet"] !== null) {
      failures.push({ path: `${path}/slaMet`, reason: "must_be_null_when_uncompleted" });
    }
    if (candidate["warrantyHonored"] !== null) {
      failures.push({ path: `${path}/warrantyHonored`, reason: "must_be_null_when_uncompleted" });
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Dimension computation (pure, documented mapping)
// ---------------------------------------------------------------------------

/**
 * The contracted interactions: quote acceptances and service work-order
 * outcomes (match outcomes are pre-contractual proposals — documented
 * judgment call: fulfillment counts contracts, not proposals).
 */
function isContracted(interaction: ScorecardInteraction): boolean {
  return interaction.kind === "quote_acceptance" || interaction.kind === "service_work_order_outcome";
}

function isFulfilled(interaction: ScorecardInteraction): boolean {
  if (interaction.kind === "quote_acceptance") return interaction.delivered;
  if (interaction.kind === "service_work_order_outcome") return interaction.completed;
  return false;
}

/**
 * Compute the four machine-stable dimensions from the sorted interactions.
 * PURE and deterministic; the mapping is total and documented:
 *
 *   fulfillment         — denominator: contracted interactions;
 *                         numerator: fulfilled ones.
 *   sla_adherence       — denominator: fulfilled contracted interactions
 *                         (slaMet is only defined for fulfilled ones);
 *                         numerator: slaMet === true.
 *   warranty_honoring   — denominator: fulfilled contracted interactions;
 *                         numerator: warrantyHonored === true.
 *   quote_accuracy      — denominator: fulfilled quote interactions with a
 *                         delivered unit price; numerator:
 *                         deliveredUnitPriceUsd === unitPriceUsd.
 */
function computeDimensions(
  interactions: readonly ScorecardInteraction[],
): readonly ScorecardDimensionScore[] {
  const contracted = interactions.filter(isContracted);
  const fulfilled = contracted.filter(isFulfilled);

  const fulfillmentRefs = contracted.map(interactionRef);
  const fulfilledRefs = fulfilled.map(interactionRef);
  const quoteAccuracyBase = fulfilled.filter(
    (i): i is QuoteAcceptanceInteraction =>
      i.kind === "quote_acceptance" && i.deliveredUnitPriceUsd !== null,
  );

  const slaMetCount = fulfilled.filter(
    (i) =>
      (i.kind === "quote_acceptance" || i.kind === "service_work_order_outcome") &&
      i.slaMet === true,
  ).length;
  const warrantyHonoredCount = fulfilled.filter(
    (i) =>
      (i.kind === "quote_acceptance" || i.kind === "service_work_order_outcome") &&
      i.warrantyHonored === true,
  ).length;
  const priceAccurateCount = quoteAccuracyBase.filter(
    (i) => i.deliveredUnitPriceUsd === i.unitPriceUsd,
  ).length;

  const ratio = (numerator: number, denominator: number): number | null =>
    denominator === 0 ? null : numerator / denominator;

  return [
    frozen({
      kind: "fulfillment",
      numerator: fulfilled.length,
      denominator: contracted.length,
      countedRefs: frozenArray(fulfillmentRefs),
      value: ratio(fulfilled.length, contracted.length),
    }),
    frozen({
      kind: "sla_adherence",
      numerator: slaMetCount,
      denominator: fulfilled.length,
      countedRefs: frozenArray(fulfilledRefs),
      value: ratio(slaMetCount, fulfilled.length),
    }),
    frozen({
      kind: "warranty_honoring",
      numerator: warrantyHonoredCount,
      denominator: fulfilled.length,
      countedRefs: frozenArray(fulfilledRefs),
      value: ratio(warrantyHonoredCount, fulfilled.length),
    }),
    frozen({
      kind: "quote_accuracy",
      numerator: priceAccurateCount,
      denominator: quoteAccuracyBase.length,
      countedRefs: frozenArray(quoteAccuracyBase.map(interactionRef)),
      value: ratio(priceAccurateCount, quoteAccuracyBase.length),
    }),
  ];
}

// ---------------------------------------------------------------------------
// The content hash + id
// ---------------------------------------------------------------------------

/** Compute the deterministic content hash of a scorecard revision. */
function computeScorecardContentHash(content: Omit<VendorScorecard, "contentHash" | "scorecardId">): string {
  return fnv1a32Hex(
    canonicalJson({
      tenantId: content.tenantId as string,
      vendorId: content.vendorId as string,
      revision: content.revision,
      supersedes: content.supersedes,
      window: content.window,
      interactionRefs: content.interactionRefs,
      interactionCounts: content.interactionCounts,
      matchSummary: content.matchSummary,
      dimensions: content.dimensions,
      computedAt: content.computedAt,
      schemaVersion: content.schemaVersion,
      modelVersion: content.modelVersion,
    }),
  );
}

// ---------------------------------------------------------------------------
// The pure builder (+ audit emission at the boundary)
// ---------------------------------------------------------------------------

/**
 * Build one scorecard revision from the injected closed interactions.
 * PURE and deterministic: the same inputs produce the byte-identical
 * frozen scorecard (including the derived id, dimensions, and content
 * hash) regardless of interaction input order. The only side effect is
 * the audit emission on success (the sink contract requires append-only
 * durability).
 *
 * @param tenantId the acting tenant (structural isolation)
 * @param input the scorecard build input
 * @param sink the audit sink (default: no-op)
 * @returns the tagged build result
 */
export function buildVendorScorecard(
  tenantId: TenantId,
  input: BuildVendorScorecardInput,
  sink: VendorsOutcomeAuditSink = NOOP_VENDORS_OUTCOME_AUDIT_SINK,
): ScorecardBuildResult {
  const failures: { path: string; reason: string }[] = [];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.scorecardInvalid,
        "scorecard request is invalid",
        { tenantId: SYNTHETIC_SYSTEM_TENANT_ID, correlationId: input?.correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID },
        [{ path: "/tenantId", reason: "required" }],
      ),
    };
  }
  if (typeof input?.vendorId !== "string" || input.vendorId.length === 0) {
    failures.push({ path: "/vendorId", reason: "required" });
  }
  if (typeof input?.at !== "string" || !looksLikeIso(input.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof input?.correlationId !== "string" || input.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (input?.window === null || typeof input?.window !== "object") {
    failures.push({ path: "/window", reason: "object_required" });
  } else {
    if (typeof input.window.from !== "string" || !looksLikeIso(input.window.from)) {
      failures.push({ path: "/window/from", reason: "not_iso" });
    }
    if (typeof input.window.to !== "string" || !looksLikeIso(input.window.to)) {
      failures.push({ path: "/window/to", reason: "not_iso" });
    }
    const fromMs = Date.parse(input.window.from);
    const toMs = Date.parse(input.window.to);
    if (Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs < fromMs) {
      failures.push({ path: "/window/to", reason: "window_end_before_start" });
    }
  }
  if (!Array.isArray(input?.interactions) || input.interactions.length === 0) {
    failures.push({ path: "/interactions", reason: "must_be_non_empty_array" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.scorecardInvalid,
        "scorecard request is invalid",
        { tenantId, correlationId: input?.correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID },
        failures,
      ),
    };
  }

  const vendorId = input.vendorId;
  const window = input.window;

  // Per-interaction validation (tenant scope, vendor scope, window, fields).
  const interactionFailures: { path: string; reason: string }[] = [];
  for (let i = 0; i < input.interactions.length; i++) {
    const one = validateInteraction(input.interactions[i], i, tenantId, vendorId, window);
    interactionFailures.push(...one);
  }
  // Duplicate refs (the same contract counted twice) are refused.
  const refs = input.interactions.map(interactionRef);
  const seen = new Set<string>();
  for (const ref of refs) {
    if (ref.length === 0) continue; // already reported as a field failure
    if (seen.has(ref)) {
      interactionFailures.push({ path: "/interactions", reason: "duplicate_interaction_ref" });
      break;
    }
    seen.add(ref);
  }
  if (interactionFailures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.scorecardInvalid,
        "scorecard request is invalid",
        { tenantId, correlationId: input.correlationId },
        interactionFailures,
      ),
    };
  }

  // Supersession discipline: a new window -> a new revision citing the prior.
  let revision = 1;
  let supersedes: string | undefined = undefined;
  if (input.prior !== undefined) {
    if (input.prior.tenantId !== tenantId || input.prior.vendorId !== vendorId) {
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.scorecardDomain,
          "prior scorecard belongs to another vendor or tenant",
          { tenantId, correlationId: input.correlationId },
          "vendors.scorecard.supersession",
          "prior_scope_mismatch",
        ),
      };
    }
    if (input.prior.window.from === window.from && input.prior.window.to === window.to) {
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.scorecardDomain,
          "scorecard revision requires a new evaluation window",
          { tenantId, correlationId: input.correlationId },
          "vendors.scorecard.supersession",
          "window_unchanged",
        ),
      };
    }
    revision = input.prior.revision + 1;
    supersedes = input.prior.scorecardId;
  }

  // Canonical order: interactions sorted by ref (deterministic under
  // input permutations).
  const sorted = [...input.interactions].sort((a, b) => {
    const ra = interactionRef(a);
    const rb = interactionRef(b);
    return ra < rb ? -1 : ra > rb ? 1 : 0;
  });
  const sortedRefs = sorted.map(interactionRef);

  const matchInteractions = sorted.filter(
    (i): i is MatchOutcomeInteraction => i.kind === "match_outcome",
  );
  const interactionCounts: Record<ScorecardInteractionKind, number> = {
    match_outcome: matchInteractions.length,
    quote_acceptance: sorted.filter((i) => i.kind === "quote_acceptance").length,
    service_work_order_outcome: sorted.filter((i) => i.kind === "service_work_order_outcome").length,
  };
  const matchSummary = {
    total: matchInteractions.length,
    satisfiable: matchInteractions.filter((m) => m.satisfiable).length,
    rejected: matchInteractions.filter((m) => !m.satisfiable).length,
  };
  const dimensions = computeDimensions(sorted);

  const content: Omit<VendorScorecard, "contentHash" | "scorecardId"> = frozen({
    tenantId,
    vendorId,
    revision,
    supersedes,
    window: frozen({ ...window }),
    interactionRefs: frozenArray(sortedRefs),
    interactionCounts: frozen(interactionCounts),
    matchSummary: frozen(matchSummary),
    dimensions: frozenArray(dimensions),
    computedAt: input.at,
    schemaVersion: SCORECARD_SCHEMA_VERSION,
    modelVersion: SCORECARD_MODEL_VERSION,
  });
  const contentHash = computeScorecardContentHash(content);
  const scorecardId = `vsc_${fnv1a32Hex(
    canonicalJson({
      tenantId: tenantId as string,
      vendorId: vendorId as string,
      revision,
      contentHash,
    }),
  )}`;
  const scorecard: VendorScorecard = frozen({ ...content, scorecardId, contentHash });

  sink.append(
    frozen({
      action: SCORECARD_AUDIT_ACTIONS.scorecardRecorded,
      tenantId,
      subject: scorecardId,
      occurredAt: input.at,
      correlationId: input.correlationId,
      details: {
        vendorId: vendorId as string,
        revision,
        supersedes: supersedes ?? null,
        window,
        interactionRefCount: sortedRefs.length,
        interactionCounts,
        matchSummary,
        dimensions: dimensions.map((d) => ({
          kind: d.kind,
          numerator: d.numerator,
          denominator: d.denominator,
          value: d.value,
        })),
        contentHash,
      },
    }),
  );

  return { ok: true, scorecard };
}

// ---------------------------------------------------------------------------
// The append-only scorecard ledger (per-tenant partition)
// ---------------------------------------------------------------------------

/** The append-only, per-tenant scorecard ledger. */
export interface VendorScorecardLedger {
  readonly tenantId: TenantId;
  /** Entries are append-only; nothing is ever rewritten. */
  readonly entries: readonly VendorScorecard[];
}

/** The tagged result of a ledger append. */
export type ScorecardLedgerAppend =
  | { readonly ok: true; readonly ledger: VendorScorecardLedger }
  | { readonly ok: false; readonly error: FleetError };

/** Create an empty scorecard ledger (one tenant's partition). */
export function createVendorScorecardLedger(tenantId: TenantId): VendorScorecardLedger {
  return frozen({ tenantId, entries: frozenArray([]) });
}

/**
 * Append a scorecard revision to the ledger. Returns a NEW ledger; the
 * input is untouched. Enforces the append-only supersession discipline:
 *
 *   - the scorecard's tenant must match the ledger scope;
 *   - no duplicate scorecard ids;
 *   - revision 1 must be the vendor's first entry in this ledger;
 *   - revision n > 1 requires the vendor's revision n-1 present and
 *     `supersedes` pointing at it.
 */
export function appendVendorScorecard(
  ledger: VendorScorecardLedger,
  scorecard: VendorScorecard,
): ScorecardLedgerAppend {
  if (scorecard.tenantId !== ledger.tenantId) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.scorecardDomain,
        "scorecard tenantId does not match the ledger scope",
        { tenantId: ledger.tenantId, correlationId: SYNTHETIC_SYSTEM_CORRELATION_ID },
        "vendors.scorecard.ledger",
        "tenant_mismatch",
      ),
    };
  }
  if (ledger.entries.some((e) => e.scorecardId === scorecard.scorecardId)) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.scorecardDomain,
        "scorecard id already present in the ledger",
        { tenantId: ledger.tenantId, correlationId: SYNTHETIC_SYSTEM_CORRELATION_ID },
        "vendors.scorecard.ledger",
        "duplicate_scorecard",
      ),
    };
  }
  const vendorHistory = ledger.entries.filter((e) => e.vendorId === scorecard.vendorId);
  if (scorecard.revision === 1) {
    if (vendorHistory.length > 0) {
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.scorecardDomain,
          "revision 1 appended after an existing history for this vendor",
          { tenantId: ledger.tenantId, correlationId: SYNTHETIC_SYSTEM_CORRELATION_ID },
          "vendors.scorecard.ledger",
          "revision_conflict",
        ),
      };
    }
  } else {
    const priorRevision = vendorHistory.find((e) => e.revision === scorecard.revision - 1);
    if (priorRevision === undefined) {
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.scorecardDomain,
          "scorecard revision is not sequential in this ledger",
          { tenantId: ledger.tenantId, correlationId: SYNTHETIC_SYSTEM_CORRELATION_ID },
          "vendors.scorecard.ledger",
          "revision_gap",
        ),
      };
    }
    if (scorecard.supersedes !== priorRevision.scorecardId) {
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.scorecardDomain,
          "scorecard supersedes does not cite the ledger's prior revision",
          { tenantId: ledger.tenantId, correlationId: SYNTHETIC_SYSTEM_CORRELATION_ID },
          "vendors.scorecard.ledger",
          "supersedes_mismatch",
        ),
      };
    }
  }
  return {
    ok: true,
    ledger: frozen({
      ...ledger,
      entries: frozenArray([...ledger.entries, scorecard]),
    }),
  };
}

/**
 * The latest scorecard revision of a vendor in THIS tenant's partition.
 * A vendor that exists only in another tenant's partition is
 * indistinguishable from an unknown vendor (undefined — no existence
 * side channel).
 */
export function resolveLatestScorecard(
  ledger: VendorScorecardLedger,
  vendorId: VendorId,
): VendorScorecard | undefined {
  const history = ledger.entries
    .filter((e) => e.vendorId === vendorId)
    .sort((a, b) => a.revision - b.revision);
  return history.length === 0 ? undefined : history[history.length - 1];
}

/** The full revision history of one vendor (revision order; own partition only). */
export function listScorecardHistory(
  ledger: VendorScorecardLedger,
  vendorId: VendorId,
): readonly VendorScorecard[] {
  return frozenArray(
    [...ledger.entries]
      .filter((e) => e.vendorId === vendorId)
      .sort((a, b) => a.revision - b.revision),
  );
}
