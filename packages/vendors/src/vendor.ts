/**
 * @fleetos/vendors — D1: the Vendor domain model.
 *
 * "FleetOS is the demand-side orchestrator. Local vendors own inventory,
 * pricing and fulfillment." — `spec/ARCHITECTURE.md` § Procurement/service
 * exchange.
 *
 * The vendor model carries:
 *   - vendor identity (tenant-scoped — the tenant may approve vendors;
 *     the vendor itself is local/independent);
 *   - capability declarations (what a vendor can fulfill: device classes,
 *     services, regions) — typed comparable values;
 *   - inventory signals (availability, lead time) — typed comparable
 *     values;
 *   - quality/SLA/warranty terms as typed comparable values.
 *
 * Versioned-interpretation discipline (`spec/ARCHITECTURE-LOCK.md`
 * item 3): a vendor REVISION is immutable. Creating a vendor writes
 * revision 1; every update appends a NEW frozen revision
 * (revision = prior + 1) with a fresh content hash — the prior
 * revision is never rewritten. `buildVendor` / `reviseVendor`
 * are pure builders (the store in `store.ts` owns persistence and tenant
 * isolation; the audit emission lives at the service boundary).
 *
 * The model is intentionally MINIMAL but typed: every comparable value
 * lives on a typed field with documented units. The matching engine in
 * `@fleetos/procurement` consumes these typed values deterministically.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: `at` is injected by the caller.
 */

import type { CorrelationId, TenantId, VendorId } from "@fleetos/contracts";
import { asVendorId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
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

/** The vendor schema version (>= 1, monotonically increasing). */
export const VENDOR_SCHEMA_VERSION = 1 as const;

/** The vendor model version (bumped when the comparable shapes change). */
export const VENDOR_MODEL_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Comparable typed values (units documented; comparison is pure)
// ---------------------------------------------------------------------------

/**
 * A non-negative duration in days. Used for lead times and warranty
 * terms. Comparable: shorter is better for lead time; longer is better
 * for warranty.
 */
export interface DaysDuration {
  readonly days: number;
}

/**
 * A non-negative monetary amount in USD. Used for budget and price
 * comparisons. Comparable: lower is better for cost.
 */
export interface UsdAmount {
  readonly usd: number;
}

/**
 * A vendor quality score in [0, 1]. Higher is better. Derived
 * deterministically from vendor outcomes (final price adherence,
 * delivery time adherence, failure rate, warranty outcome, return
 * rate, customer satisfaction, maintenance performance — the spec's
 * "Vendor outcomes" list). The derivation rule belongs to a later
 * learning wave; here the score is an INJECTED typed value.
 */
export interface QualityScore {
  /** Quality score in [0, 1]. */
  readonly score: number;
}

/**
 * An SLA coverage level in [0, 1]. Higher is better. Represents the
 * fraction of demand-side SLA requirements the vendor contractually
 * commits to (uptime, response time, etc.).
 */
export interface SlaCoverage {
  /** SLA coverage in [0, 1]. */
  readonly coverage: number;
}

/**
 * Inventory availability in [0, 1]. Higher is better. Represents the
 * vendor's current stock ratio for the requested item class.
 */
export interface InventoryAvailability {
  /** Availability ratio in [0, 1]. */
  readonly ratio: number;
}

/**
 * A vendor capability declaration: what a vendor can fulfill.
 * Capability kinds are typed string literals; the open `(string & {})`
 * suffix permits forward compatibility (unknown kinds are NOT errors —
 * a candidate may declare capabilities the matcher does not recognize).
 */
export type VendorCapabilityKind =
  | "device-class"
  | "service"
  | "region"
  | "software"
  | "peripheral"
  | (string & {});

/** One capability a vendor declares. */
export interface VendorCapability {
  /** The capability kind (typed; open union for forward compatibility). */
  readonly kind: VendorCapabilityKind;
  /** The capability identifier (e.g. "class.standard_laptop", "us-east-1"). */
  readonly id: string;
}

/**
 * A vendor's inventory signal for one capability: how available, how
 * fast. The matcher consumes these to determine which vendors can
 * fulfill a demand by when.
 */
export interface VendorInventorySignal {
  /** The capability this signal describes. */
  readonly capability: VendorCapability;
  /** Availability ratio in [0, 1]. */
  readonly availability: InventoryAvailability;
  /** Lead time in days (best-known estimate). */
  readonly leadTime: DaysDuration;
}

/**
 * The vendor's quality, SLA, and warranty terms. All typed comparable
 * values; the matcher ranks vendors on these dimensions.
 */
export interface VendorTerms {
  /** Vendor quality score in [0, 1]. */
  readonly quality: QualityScore;
  /** SLA coverage in [0, 1]. */
  readonly sla: SlaCoverage;
  /** Standard warranty duration (days). */
  readonly warranty: DaysDuration;
}

// ---------------------------------------------------------------------------
// The vendor record
// ---------------------------------------------------------------------------

/**
 * A Vendor: one local fulfillment provider, at one immutable revision.
 * Frozen at construction; updates create new revisions. Carries the
 * tenant scope (the tenant that approved this vendor), the vendor's
 * stable identity, its capability declarations, its inventory signals,
 * its quality/SLA/warranty terms, and a deterministic content hash
 * binding the full revision content.
 */
export interface Vendor extends TenantScoped {
  /** The vendor this record describes (stable across revisions). */
  readonly vendorId: VendorId;
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** Stable machine name (e.g. "acme.local"). */
  readonly name: string;
  /** Human-readable description. */
  readonly description: string;
  /** 1-based revision. Immutable once written; updates append revision+1. */
  readonly revision: number;
  /** Capability declarations (what this vendor can fulfill). */
  readonly capabilities: readonly VendorCapability[];
  /** Inventory signals per capability (availability + lead time). */
  readonly inventory: readonly VendorInventorySignal[];
  /** Quality/SLA/warranty terms. */
  readonly terms: VendorTerms;
  /** Service regions (free-form strings; matched against demand location). */
  readonly regions: readonly string[];
  /** Injected revision-creation timestamp. */
  readonly createdAt: string;
  /**
   * Deterministic content hash: fnv1a32 over the canonical JSON of the
   * full revision content. Binds the revision content; never used for
   * security.
   */
  readonly contentHash: string;
  /** The vendor payload schema version. */
  readonly schemaVersion: number;
  /** The vendor model version (the comparable shapes version). */
  readonly modelVersion: number;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** The input of a vendor creation (revision 1). */
export interface CreateVendorInput {
  /** Explicit vendor id; derived deterministically when absent. */
  readonly vendorId?: VendorId;
  readonly name: string;
  readonly description: string;
  readonly capabilities?: readonly VendorCapability[];
  readonly inventory?: readonly VendorInventorySignal[];
  readonly terms: VendorTerms;
  readonly regions?: readonly string[];
  /** Injected creation timestamp. */
  readonly at: string;
  /** Correlation id threading the causal graph (also stamped on errors). */
  readonly correlationId: CorrelationId;
}

/** The input of a vendor revision (revision = prior + 1). */
export interface ReviseVendorInput {
  readonly name: string;
  readonly description: string;
  readonly capabilities?: readonly VendorCapability[];
  readonly inventory?: readonly VendorInventorySignal[];
  readonly terms: VendorTerms;
  readonly regions?: readonly string[];
  /** Injected revision timestamp. */
  readonly at: string;
  readonly correlationId: CorrelationId;
}

/** The tagged result of a pure vendor build. */
export type VendorBuildResult =
  | { readonly ok: true; readonly vendor: Vendor }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Validate a `VendorCapability` (returns null on success; an error string on failure). */
function validateCapability(cap: unknown, path: string): string | null {
  if (cap === null || typeof cap !== "object") return `${path}: not_an_object`;
  const obj = cap as { kind?: unknown; id?: unknown };
  if (typeof obj.kind !== "string" || obj.kind.length === 0) return `${path}/kind: required`;
  if (typeof obj.id !== "string" || obj.id.length === 0) return `${path}/id: required`;
  return null;
}

/** Validate a `VendorInventorySignal` (returns null on success; an error string on failure). */
function validateInventory(sig: unknown, path: string): string | null {
  if (sig === null || typeof sig !== "object") return `${path}: not_an_object`;
  const obj = sig as {
    capability?: unknown;
    availability?: unknown;
    leadTime?: unknown;
  };
  const capErr = validateCapability(obj.capability, `${path}/capability`);
  if (capErr !== null) return capErr;
  const av = obj.availability as { ratio?: unknown } | undefined;
  if (
    av === undefined ||
    typeof av.ratio !== "number" ||
    !Number.isFinite(av.ratio) ||
    av.ratio < 0 ||
    av.ratio > 1
  ) {
    return `${path}/availability/ratio: must_be_in_0_1`;
  }
  const lt = obj.leadTime as { days?: unknown } | undefined;
  if (
    lt === undefined ||
    typeof lt.days !== "number" ||
    !Number.isFinite(lt.days) ||
    lt.days < 0
  ) {
    return `${path}/leadTime/days: must_be_non_negative`;
  }
  return null;
}

/** Validate `VendorTerms` (returns null on success; an error string on failure). */
function validateTerms(terms: unknown, path: string): string | null {
  if (terms === null || typeof terms !== "object") return `${path}: not_an_object`;
  const obj = terms as {
    quality?: unknown;
    sla?: unknown;
    warranty?: unknown;
  };
  const q = obj.quality as { score?: unknown } | undefined;
  if (
    q === undefined ||
    typeof q.score !== "number" ||
    !Number.isFinite(q.score) ||
    q.score < 0 ||
    q.score > 1
  ) {
    return `${path}/quality/score: must_be_in_0_1`;
  }
  const sla = obj.sla as { coverage?: unknown } | undefined;
  if (
    sla === undefined ||
    typeof sla.coverage !== "number" ||
    !Number.isFinite(sla.coverage) ||
    sla.coverage < 0 ||
    sla.coverage > 1
  ) {
    return `${path}/sla/coverage: must_be_in_0_1`;
  }
  const w = obj.warranty as { days?: unknown } | undefined;
  if (
    w === undefined ||
    typeof w.days !== "number" ||
    !Number.isFinite(w.days) ||
    w.days < 0
  ) {
    return `${path}/warranty/days: must_be_non_negative`;
  }
  return null;
}

/** Validate the shared payload fields; returns the failure list (empty = ok). */
function validatePayloadFields(input: CreateVendorInput): { path: string; reason: string }[] {
  const failures: { path: string; reason: string }[] = [];
  if (typeof input?.name !== "string" || input.name.length === 0 || input.name.length > 200) {
    failures.push({ path: "/name", reason: "required_1_200_chars" });
  }
  if (
    typeof input?.description !== "string" ||
    input.description.length === 0 ||
    input.description.length > 2000
  ) {
    failures.push({ path: "/description", reason: "required_1_2000_chars" });
  }
  if (typeof input?.at !== "string" || !looksLikeIso(input.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof input?.correlationId !== "string" || input.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  const termsErr = validateTerms(input?.terms, "/terms");
  if (termsErr !== null) failures.push({ path: termsErr.split(":")[0] ?? "/terms", reason: termsErr.split(":")[1] ?? "invalid" });
  if (input?.capabilities !== undefined && !Array.isArray(input.capabilities)) {
    failures.push({ path: "/capabilities", reason: "not_array" });
  } else if (input?.capabilities !== undefined) {
    for (let i = 0; i < input.capabilities.length; i++) {
      const err = validateCapability(input.capabilities[i], `/capabilities/${i}`);
      if (err !== null) failures.push({ path: err.split(":")[0] ?? `/capabilities/${i}`, reason: err.split(":")[1] ?? "invalid" });
    }
  }
  if (input?.inventory !== undefined && !Array.isArray(input.inventory)) {
    failures.push({ path: "/inventory", reason: "not_array" });
  } else if (input?.inventory !== undefined) {
    for (let i = 0; i < input.inventory.length; i++) {
      const err = validateInventory(input.inventory[i], `/inventory/${i}`);
      if (err !== null) failures.push({ path: err.split(":")[0] ?? `/inventory/${i}`, reason: err.split(":")[1] ?? "invalid" });
    }
  }
  if (input?.regions !== undefined && !Array.isArray(input.regions)) {
    failures.push({ path: "/regions", reason: "not_array" });
  } else if (input?.regions !== undefined) {
    for (let i = 0; i < input.regions.length; i++) {
      if (typeof input.regions[i] !== "string" || (input.regions[i] as string).length === 0) {
        failures.push({ path: `/regions/${i}`, reason: "required" });
      }
    }
  }
  return failures;
}

/** Deterministically derive a vendor id from the identity tuple. */
function deriveVendorId(tenantId: TenantId, name: string): VendorId {
  return asVendorId(
    `vnd_${fnv1a32Hex(canonicalJson({ tenantId: tenantId as string, name }))}`,
  );
}

/** Compute the deterministic content hash of a revision's content. */
function computeVendorContentHash(content: Omit<Vendor, "contentHash">): string {
  return fnv1a32Hex(
    canonicalJson({
      vendorId: content.vendorId as string,
      tenantId: content.tenantId as string,
      name: content.name,
      description: content.description,
      revision: content.revision,
      capabilities: content.capabilities,
      inventory: content.inventory,
      terms: content.terms,
      regions: content.regions,
      createdAt: content.createdAt,
      schemaVersion: content.schemaVersion,
      modelVersion: content.modelVersion,
    }),
  );
}

// ---------------------------------------------------------------------------
// Builders (pure)
// ---------------------------------------------------------------------------

/**
 * Build revision 1 of a vendor. Pure and deterministic: the same inputs
 * produce the byte-identical frozen vendor (including the derived
 * vendor id and content hash). The tenant scope comes from the acting
 * context (the store passes it); it is stamped onto the vendor.
 *
 * @param tenantId the acting tenant (structural isolation)
 * @param input the creation input
 * @returns the tagged build result
 */
export function buildVendor(
  tenantId: TenantId,
  input: CreateVendorInput,
): VendorBuildResult {
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.vendorInvalid,
        "vendor request is invalid",
        { tenantId: SYNTHETIC_SYSTEM_TENANT_ID, correlationId: input?.correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID },
        [{ path: "/tenantId", reason: "required" }],
      ),
    };
  }
  const failures = validatePayloadFields(input);
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.vendorInvalid,
        "vendor request is invalid",
        { tenantId, correlationId: input?.correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID },
        failures,
      ),
    };
  }

  const vendorId = input.vendorId ?? deriveVendorId(tenantId, input.name);
  const content: Omit<Vendor, "contentHash"> = frozen({
    vendorId,
    tenantId,
    name: input.name,
    description: input.description,
    revision: 1,
    capabilities: frozenArray(input.capabilities ?? []),
    inventory: frozenArray(input.inventory ?? []),
    terms: frozen(input.terms),
    regions: frozenArray(input.regions ?? []),
    createdAt: input.at,
    schemaVersion: VENDOR_SCHEMA_VERSION,
    modelVersion: VENDOR_MODEL_VERSION,
  });
  const contentHash = computeVendorContentHash(content);
  return { ok: true, vendor: frozen({ ...content, contentHash }) };
}

/**
 * Build the next revision of a vendor (revision = prior + 1). Pure and
 * deterministic; the prior revision is never rewritten.
 *
 * @param prior the prior revision (must be the latest)
 * @param input the revision input
 * @returns the tagged build result
 */
export function reviseVendor(
  prior: Vendor,
  input: ReviseVendorInput,
): VendorBuildResult {
  const failures = validatePayloadFields({ ...input, vendorId: prior.vendorId });
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.vendorInvalid,
        "vendor revision is invalid",
        { tenantId: prior.tenantId, correlationId: input.correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID },
        failures,
      ),
    };
  }
  const content: Omit<Vendor, "contentHash"> = frozen({
    vendorId: prior.vendorId,
    tenantId: prior.tenantId,
    name: input.name,
    description: input.description,
    revision: prior.revision + 1,
    capabilities: frozenArray(input.capabilities ?? []),
    inventory: frozenArray(input.inventory ?? []),
    terms: frozen(input.terms),
    regions: frozenArray(input.regions ?? []),
    createdAt: input.at,
    schemaVersion: VENDOR_SCHEMA_VERSION,
    modelVersion: VENDOR_MODEL_VERSION,
  });
  const contentHash = computeVendorContentHash(content);
  return { ok: true, vendor: frozen({ ...content, contentHash }) };
}

/** Deterministic sentinel correlation id for vendors-pipeline internal calls. */
export const VENDORS_PIPELINE_CORRELATION_ID: CorrelationId = SYNTHETIC_SYSTEM_CORRELATION_ID;
