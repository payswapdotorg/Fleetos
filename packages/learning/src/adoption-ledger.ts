/**
 * @fleetos/learning — D3: the capability adoption ledger (versioned,
 * append-only records derived from certified capability metadata).
 *
 * The closed loop's output: certified capabilities become FleetOS
 * OPERATIONAL adoption records. Per `spec/ARCHITECTURE-LOCK.md` item 9
 * ("Arena owns capability learning/certification; FleetOS owns
 * operational adoption"), the learning package owns the FleetOS-side
 * adoption ledger; the W050B arena adapter's adoption boundary is
 * consumed STRUCTURALLY:
 *
 *   - `CertifiedCapabilityFacet` is the STRUCTURAL TWIN of the arena
 *     adapter's `CertifiedCapabilityMetadata` (same fields, same
 *     machine-stable compatibility union, same canonical `acr_`
 *     certification-reference grammar). A REAL arena metadata value
 *     flows through the facet unchanged (proven by test).
 *   - `LearningAdoptionProposal` is the STRUCTURAL TWIN of the arena
 *     adapter's `CapabilityAdoptionProposal` — the adoption proposals
 *     carry the HUMAN approver id + the approved-at instant (the
 *     EXPLICIT grant; adoption never happens automatically).
 *   - `LearningAdoptionRecord` is the STRUCTURAL TWIN of the arena
 *     adapter's `CapabilityAdoptionRecord` — same field names, same
 *     deterministic identity schemes (`adp_` / `adpv_` prefixes, the
 *     same content-digest field list), so a learning adoption record
 *     and an arena adoption record built from identical inputs are
 *     byte-identical and interchangeable across the two ledgers
 *     (proven by test — the convergence proof).
 *
 * FAIL-CLOSED certification boundary: `requireCertifiedCapability` (the
 * structural twin of the arena adapter's D3 gate) refuses
 * uncertified/malformed capability metadata machine-stably — a refusal
 * carries enumerated reason codes; NO partial or degraded record is
 * ever produced; the refused metadata NEVER becomes an adoption record
 * (the ARENA.md invariant: "FleetOS never treats an uncertified model
 * output as action permission" — there is no path from raw model
 * output to an adoption record; the gate consumes ONLY the typed
 * certified-metadata facet).
 *
 * Supersession discipline (the versioned-interpretation discipline
 * from ARCHITECTURE-LOCK item 3): a new version cites the prior via
 * `supersedes`; the prior revision is NEVER rewritten. A fresh revision
 * on an existing adoptionId MUST supersede; a supersession target MUST
 * exist in the same adoption's revisions AND be ACTIVE.
 *
 * Tenant isolation is BY CONSTRUCTION (the W012 pattern): every
 * operation takes the acting `LearningTenantScope` FIRST; storage is
 * partitioned per tenant; a foreign adoption id is indistinguishable
 * from an unknown one.
 *
 * Audit: the `recordCapabilityAdoption` boundary audits the
 * consequential mutations — a refusal at the certification boundary
 * (`learning.adoption.refused` — the boundary holding is evidence a
 * reviewer must be able to prove), a created adoption revision
 * (`learning.adoption.recorded` / `.superseded`). Idempotent
 * re-appends mutate nothing and audit nothing; failed validations
 * never audit.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type {
  CorrelationId,
  CausationId,
  DomainError,
  FleetError,
  TenantId,
  UserId,
} from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import type { LearningAuditSink } from "./audit-seam";
import { LEARNING_AUDIT_ACTIONS, NOOP_LEARNING_AUDIT_SINK } from "./audit-seam";
import {
  ERROR_CODES,
  LEARNING_PIPELINE_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT,
  canonicalJson,
  fnv1a32Hex,
  frozen,
  frozenArray,
  looksLikeIso,
  makeDomainError,
  makeValidationError,
} from "./internal";
import type { LearningTenantScope } from "./internal";
import { checkLearningTenantScope } from "./internal";

// ---------------------------------------------------------------------------
// The certified capability metadata (the arena adoption boundary, structural)
// ---------------------------------------------------------------------------

/**
 * Arena's fleetOS compatibility statement — the STRUCTURAL TWIN of the
 * arena adapter's `FleetOSCompatibilityStatement` (the same
 * machine-stable union). `compatible` adopts as-is;
 * `compatible_with_warnings` adopts carrying the warnings verbatim;
 * `incompatible` is refused at the boundary (certified but explicitly
 * not adoptable into FleetOS's current shape).
 */
export type FleetOSCompatibilityStatementFacet =
  | "compatible"
  | "compatible_with_warnings"
  | "incompatible";

/** All compatibility statements (for validation + iteration). */
export const ALL_FLEETOS_COMPATIBILITY_STATEMENT_FACETS: readonly FleetOSCompatibilityStatementFacet[] =
  Object.freeze(["compatible", "compatible_with_warnings", "incompatible"]);

/**
 * The certified capability metadata Arena's certification produces —
 * the STRUCTURAL TWIN of the W050B arena adapter's
 * `CertifiedCapabilityMetadata`. Arena owns capability
 * learning/certification; this ledger only reads the metadata — never
 * re-derives it. The real arena metadata value satisfies this facet
 * structurally (proven by test).
 */
export interface CertifiedCapabilityFacet extends TenantScoped {
  readonly tenantId: TenantId;
  /** The stable capability identifier (machine-stable string). */
  readonly capabilityId: string;
  /** The certified version (machine-stable string). */
  readonly capabilityVersion: string;
  /** A typed reference to Arena's certification record (canonical `acr_` prefix + base32). */
  readonly certificationRef: string;
  /** The evaluation-suite revision the certification was granted against. */
  readonly evaluationSuiteRevision: string;
  /** Arena's compatibility statement. */
  readonly fleetOSCompatibilityStatement: FleetOSCompatibilityStatementFacet;
  /** Optional: the cryptographic hash of the certification record (defense in depth). */
  readonly certificationHash?: string;
  /** Optional: machine-stable warnings when the statement is `compatible_with_warnings`. */
  readonly warnings?: readonly string[];
  /** Optional: the capability class (open union, for grouping in the ledger). */
  readonly capabilityClass?: string;
}

// ---------------------------------------------------------------------------
// The certification-reference grammar (fail-closed, the arena twin)
// ---------------------------------------------------------------------------

/**
 * The canonical certification-reference grammar — the STRUCTURAL TWIN
 * of the arena adapter's `CERTIFICATION_REF_PATTERN`: `acr_` prefix
 * followed by 16+ URL-safe base32 chars (lowercase a-z plus 0-9). The
 * control plane never interprets the reference's contents; it only
 * records that the reference exists and matches the grammar.
 */
export const CERTIFICATION_REF_PATTERN = /^acr_[a-z0-9]{16,}$/;

/** The minimum length of a certification-reference string (after the prefix). */
export const CERTIFICATION_REF_MIN_LENGTH = 16;

/** The maximum length of a certification-reference string (after the prefix). */
export const CERTIFICATION_REF_MAX_LENGTH = 256;

/**
 * Pure (non-throwing) check: does the candidate reference match the
 * canonical certification-reference grammar?
 */
export function isValidCertificationRef(ref: string): boolean {
  if (typeof ref !== "string") return false;
  if (ref.length < `acr_`.length + CERTIFICATION_REF_MIN_LENGTH) return false;
  if (ref.length > `acr_`.length + CERTIFICATION_REF_MAX_LENGTH) return false;
  return CERTIFICATION_REF_PATTERN.test(ref);
}

// ---------------------------------------------------------------------------
// The fail-closed certification gate (the arena D3 twin)
// ---------------------------------------------------------------------------

/**
 * Machine-stable refusal reason codes — the STRUCTURAL TWIN of the
 * arena adapter's `CertificationRefusalReason` set (callers branch on
 * the failure mode without parsing human messages).
 */
export type CertificationRefusalReason =
  | "missing_metadata"
  | "missing_capability_id"
  | "missing_capability_version"
  | "missing_certification_ref"
  | "malformed_certification_ref"
  | "incompatible_capability"
  | "certification_hash_mismatch";

/** All refusal reason codes (for validation + iteration). */
export const ALL_CERTIFICATION_REFUSAL_REASONS: readonly CertificationRefusalReason[] = Object.freeze([
  "missing_metadata",
  "missing_capability_id",
  "missing_capability_version",
  "missing_certification_ref",
  "malformed_certification_ref",
  "incompatible_capability",
  "certification_hash_mismatch",
]);

/**
 * The narrowed certified capability the adoption boundary consumes —
 * the STRUCTURAL TWIN of the arena adapter's `CertifiedCapability`
 * (the metadata fields an adoption record carries VERBATIM). The
 * widening is explicit so the adoption boundary cannot accidentally
 * ingest raw `unknown` — it must receive a certified capability from
 * this gate.
 */
export interface CertifiedCapability extends TenantScoped {
  readonly tenantId: TenantId;
  readonly capabilityId: string;
  readonly capabilityVersion: string;
  readonly certificationRef: string;
  readonly evaluationSuiteRevision: string;
  readonly fleetOSCompatibilityStatement: FleetOSCompatibilityStatementFacet;
  readonly warnings: readonly string[];
  readonly capabilityClass?: string;
}

/**
 * A machine-stable certification refusal. The `reasons` array is the
 * machine-readable failure set; the `metadata` carries the input fields
 * that survived validation (for audit evidence — the refusal is
 * auditable so a reviewer can prove the boundary held).
 */
export interface CertificationRefusal {
  readonly tenantId: TenantId;
  readonly reasons: readonly CertificationRefusalReason[];
  /** The surviving metadata fields (for audit evidence). */
  readonly metadata: {
    readonly capabilityId: string | null;
    readonly capabilityVersion: string | null;
    readonly certificationRef: string | null;
    readonly evaluationSuiteRevision: string | null;
    readonly fleetOSCompatibilityStatement: FleetOSCompatibilityStatementFacet | null;
  };
}

/** The tagged result of `requireCertifiedCapability`. */
export type CertificationResult =
  | { readonly ok: true; readonly certified: CertifiedCapability }
  | { readonly ok: false; readonly refusal: CertificationRefusal };

/**
 * Optional caller-injected assertion: a content-hash check against the
 * certification reference (defense in depth — a stale or substituted
 * certificationRef fails the check). The STRUCTURAL TWIN of the arena
 * adapter's `CertificationHashCheck`.
 */
export interface CertificationHashCheck {
  /** The expected hash (the hash of the certification record at submission time). */
  readonly expectedHash: string;
  /** The hash algorithm used (e.g., "sha256"). */
  readonly hashAlgorithm: string;
}

/** Options for `requireCertifiedCapability`. */
export interface RequireCertifiedCapabilityOptions {
  /** The correlation id of the adoption request (for the audit trail). */
  readonly correlationId: CorrelationId;
  /** Optional: the content-hash check (defense in depth). */
  readonly hashCheck?: CertificationHashCheck;
}

/**
 * The fail-closed certification gate. Pure: every input is
 * caller-supplied; the gate reads no clock and no entropy. Returns a
 * tagged `CertificationResult` — never a partial/degraded certified
 * capability, never throws.
 *
 * The gate refuses in order (the arena adapter's twin discipline —
 * structural failures before content failures; multiple reasons MAY be
 * accumulated, every problem exposed at once, never silently):
 *   1. `missing_metadata` — the input is null/absent;
 *   2. `missing_capability_id` / `missing_capability_version` /
 *      `missing_certification_ref` — required fields absent/empty;
 *   3. `malformed_certification_ref` — the canonical grammar failed;
 *   4. `certification_hash_mismatch` — the opt-in hash check failed;
 *   5. `incompatible_capability` — the statement is `incompatible` or
 *      unknown (fail-closed: never adopt a capability whose
 *      compatibility the control plane does not understand).
 *
 * @param metadata the certified-capability metadata (the arena facet)
 * @param options the gate options (correlation id + optional hash check)
 * @returns the tagged certification result
 */
export function requireCertifiedCapability(
  metadata: CertifiedCapabilityFacet | null | undefined,
  options: RequireCertifiedCapabilityOptions,
): CertificationResult {
  const correlationId = options?.correlationId ?? LEARNING_PIPELINE_CORRELATION_ID;
  void correlationId; // reserved for the audit emission at the boundary function
  // 1. missing_metadata — the input is null/absent.
  if (metadata === null || metadata === undefined || typeof metadata !== "object") {
    return refused(
      SYNTHETIC_SYSTEM_TENANT,
      ["missing_metadata"],
      {
        capabilityId: null,
        capabilityVersion: null,
        certificationRef: null,
        evaluationSuiteRevision: null,
        fleetOSCompatibilityStatement: null,
      },
    );
  }
  const tenantId: TenantId =
    typeof metadata.tenantId === "string" && metadata.tenantId.length > 0
      ? metadata.tenantId
      : SYNTHETIC_SYSTEM_TENANT;
  const reasons: CertificationRefusalReason[] = [];
  // 2. missing required fields.
  if (typeof metadata.capabilityId !== "string" || metadata.capabilityId.length === 0) {
    reasons.push("missing_capability_id");
  }
  if (typeof metadata.capabilityVersion !== "string" || metadata.capabilityVersion.length === 0) {
    reasons.push("missing_capability_version");
  }
  if (typeof metadata.certificationRef !== "string" || metadata.certificationRef.length === 0) {
    reasons.push("missing_certification_ref");
  }
  // 3. malformed certification reference (only checked when present).
  if (
    typeof metadata.certificationRef === "string" &&
    metadata.certificationRef.length > 0 &&
    !isValidCertificationRef(metadata.certificationRef)
  ) {
    reasons.push("malformed_certification_ref");
  }
  // 4. certification hash mismatch (defense in depth; opt-in).
  if (options.hashCheck !== undefined) {
    if (typeof metadata.certificationHash !== "string" || metadata.certificationHash.length === 0) {
      reasons.push("certification_hash_mismatch");
    } else if (metadata.certificationHash !== options.hashCheck.expectedHash) {
      reasons.push("certification_hash_mismatch");
    }
  }
  // 5. incompatible capability (unknown statements are treated as
  // incompatible — fail-closed).
  if (
    typeof metadata.fleetOSCompatibilityStatement === "string" &&
    metadata.fleetOSCompatibilityStatement === "incompatible"
  ) {
    reasons.push("incompatible_capability");
  } else if (
    typeof metadata.fleetOSCompatibilityStatement !== "string" ||
    !(ALL_FLEETOS_COMPATIBILITY_STATEMENT_FACETS as readonly string[]).includes(
      metadata.fleetOSCompatibilityStatement,
    )
  ) {
    reasons.push("incompatible_capability");
  }
  if (reasons.length > 0) {
    return refused(
      tenantId,
      reasons,
      {
        capabilityId: typeof metadata.capabilityId === "string" ? metadata.capabilityId : null,
        capabilityVersion:
          typeof metadata.capabilityVersion === "string" ? metadata.capabilityVersion : null,
        certificationRef:
          typeof metadata.certificationRef === "string" ? metadata.certificationRef : null,
        evaluationSuiteRevision:
          typeof metadata.evaluationSuiteRevision === "string"
            ? metadata.evaluationSuiteRevision
            : null,
        fleetOSCompatibilityStatement:
          typeof metadata.fleetOSCompatibilityStatement === "string" &&
          (ALL_FLEETOS_COMPATIBILITY_STATEMENT_FACETS as readonly string[]).includes(
            metadata.fleetOSCompatibilityStatement,
          )
            ? metadata.fleetOSCompatibilityStatement
            : null,
      },
    );
  }
  // All checks passed: produce the certified capability (the narrowed
  // shape the adoption boundary consumes).
  const certified: CertifiedCapability = frozen({
    tenantId,
    capabilityId: metadata.capabilityId as string,
    capabilityVersion: metadata.capabilityVersion as string,
    certificationRef: metadata.certificationRef as string,
    evaluationSuiteRevision: metadata.evaluationSuiteRevision as string,
    fleetOSCompatibilityStatement:
      metadata.fleetOSCompatibilityStatement as FleetOSCompatibilityStatementFacet,
    warnings: Object.freeze([...(metadata.warnings ?? [])]),
    ...(metadata.capabilityClass !== undefined ? { capabilityClass: metadata.capabilityClass } : {}),
  });
  return { ok: true, certified };
}

/** Internal: build a refused result carrying the surviving metadata. Pure. */
function refused(
  tenantId: TenantId,
  reasons: readonly CertificationRefusalReason[],
  metadata: CertificationRefusal["metadata"],
): CertificationResult {
  return {
    ok: false,
    refusal: frozen({
      tenantId,
      reasons: Object.freeze([...reasons]),
      metadata: frozen(metadata),
    }),
  };
}

/**
 * Project a `CertificationRefusal` into a `DomainError` so the adoption
 * boundary's caller can surface it through the frozen error taxonomy.
 * The reasons are carried in the `invariant` field (a stable,
 * machine-readable string — callers do NOT parse the human message).
 */
export function refusalToFleetError(
  refusal: CertificationRefusal,
  correlationId: CorrelationId,
): DomainError {
  return makeDomainError(
    ERROR_CODES.certificationRefused,
    `learning certification boundary refused capability adoption (reasons: ${refusal.reasons.join(", ")})`,
    { tenantId: refusal.tenantId, correlationId },
    "learning.certification.boundary",
    refusal.reasons.join(","),
  );
}

// ---------------------------------------------------------------------------
// The adoption proposal (the explicit human grant) + rollout policy
// ---------------------------------------------------------------------------

/**
 * The rollout policy of a capability adoption — the STRUCTURAL TWIN of
 * the arena adapter's `RolloutPolicy`. The control plane records the
 * policy verbatim; the binding site consumes it to drive the rollout.
 *   - `canary`: a small canary cohort first (a percentage 0-100 is required);
 *   - `ring`:   a specific ring of cohorts (non-empty `ringIds` required);
 *   - `full`:   the entire tenant (neither percentage nor ringIds).
 */
export type RolloutPolicyKind = "canary" | "ring" | "full";

/** All rollout policy kinds (for validation + iteration). */
export const ALL_ROLLOUT_POLICY_KINDS: readonly RolloutPolicyKind[] = Object.freeze([
  "canary",
  "ring",
  "full",
]);

/** The rollout policy record (the arena adapter's twin). */
export interface RolloutPolicy {
  /** The rollout kind. */
  readonly kind: RolloutPolicyKind;
  /** The percentage (0-100) for canary rollouts (required for canary). */
  readonly percentage?: number;
  /** The ring ids for ring rollouts (required for ring). */
  readonly ringIds?: readonly string[];
}

/**
 * The explicit, human-approved capability adoption proposal — the
 * STRUCTURAL TWIN of the arena adapter's `CapabilityAdoptionProposal`.
 * Adoption NEVER happens automatically: the caller MUST supply a
 * proposal that has been human-approved. The `approverId` + the
 * `approvedAt` instant are the EXPLICIT GRANT (recorded verbatim — the
 * audit evidence that a human approved the adoption); `supersedes`
 * cites the prior adoption recordId on a supersession (absent on a
 * fresh adoption).
 */
export interface LearningAdoptionProposal {
  /** The durable proposal identifier (content-addressable string). */
  readonly proposalId: string;
  /** The approving principal's user id (a branded `UserId` from the frozen contracts). */
  readonly approverId: UserId;
  /** The injected approval instant (ISO 8601 — the explicit grant). */
  readonly approvedAt: string;
  /** The cohort the adoption is targeted at (machine-stable string). */
  readonly cohort: string;
  /** The prior capability version to roll back to if the adoption fails. */
  readonly rollbackVersion: string;
  /** Optional: the prior adoption recordId this proposal supersedes. */
  readonly supersedes?: string;
}

// ---------------------------------------------------------------------------
// The versioned adoption record (the arena twin — same schemes)
// ---------------------------------------------------------------------------

/** The only non-terminal adoption status: the latest revision of its identity. */
export const ADOPTION_ACTIVE = "ACTIVE" as const;
/** A superseded adoption: replaced by a newer revision (never rewritten). */
export const ADOPTION_SUPERSEDED = "SUPERSEDED" as const;

/** The status of a capability adoption revision. */
export type LearningAdoptionStatus =
  | typeof ADOPTION_ACTIVE
  | typeof ADOPTION_SUPERSEDED;

/** All adoption statuses (for validation + iteration). */
export const ALL_LEARNING_ADOPTION_STATUSES: readonly LearningAdoptionStatus[] = Object.freeze([
  ADOPTION_ACTIVE,
  ADOPTION_SUPERSEDED,
]);

/**
 * A versioned capability adoption record — the STRUCTURAL TWIN of the
 * arena adapter's `CapabilityAdoptionRecord` (same field names, same
 * deterministic identity schemes, same content-digest field list), so
 * learning and arena adoption records built from identical inputs are
 * byte-identical and interchangeable (proven by test).
 *
 * Append-only: a supersession appends a NEW revision (version = prior +
 * 1) with the prior's `recordId` in `supersedes`; the prior revision is
 * never rewritten. The adoption identity (`adoptionId`) is the
 * deterministic digest of (tenantId, capabilityId) — stable across
 * revisions.
 */
export interface LearningAdoptionRecord extends TenantScoped {
  /** Deterministic adoption identity: `adp_` + fnv1a32(tenantId, capabilityId). */
  readonly adoptionId: string;
  /** Deterministic revision id: `adpv_` + fnv1a32(adoptionId, version). */
  readonly recordId: string;
  readonly tenantId: TenantId;
  /** The append-only revision number (>= 1). */
  readonly version: number;
  /** The adoption status (ACTIVE on every fresh revision). */
  readonly status: LearningAdoptionStatus;
  /** The capability id (from the certified metadata — verbatim). */
  readonly capabilityId: string;
  /** The capability version (from the certified metadata — verbatim). */
  readonly capabilityVersion: string;
  /** The Arena certification reference (from the certified metadata — verbatim). */
  readonly certificationRef: string;
  /** The evaluation-suite revision (from the certified metadata — verbatim). */
  readonly evaluationSuiteRevision: string;
  /** The FleetOS compatibility statement (from the certified metadata — verbatim; widened to `string`, the arena record's twin — the narrowed union lives in `CertifiedCapability`). */
  readonly fleetOSCompatibilityStatement: string;
  /** The warnings (from the certified metadata — verbatim; may be empty). */
  readonly warnings: readonly string[];
  /** The optional capability class (from the certified metadata — verbatim). */
  readonly capabilityClass?: string;
  /** The rollout policy (from the boundary options — verbatim). */
  readonly rolloutPolicy: RolloutPolicy;
  /** The cohort (from the proposal — verbatim). */
  readonly cohort: string;
  /** The rollback version (from the proposal — verbatim). */
  readonly rollbackVersion: string;
  /** The proposal id (from the proposal — verbatim). */
  readonly proposalId: string;
  /** The approver id (from the proposal — verbatim — the EXPLICIT GRANT). */
  readonly approverId: UserId;
  /** The injected approval instant (ISO 8601 — from the proposal). */
  readonly approvedAt: string;
  /** The injected adoption instant (ISO 8601 — when the record was created). */
  readonly adoptedAt: string;
  /** Optional: the prior adoption recordId this revision supersedes. */
  readonly supersedes?: string;
  /** Canonical digest of the record's CONTENT (identity fields excluded). */
  readonly contentDigest: string;
}

/**
 * The deterministic adoption identity — the SAME scheme as the arena
 * adapter's (`adp_` + fnv1a32 over (tenantId, capabilityId)), so both
 * ledgers derive the same identity for the same (tenant, capability).
 */
export function capabilityAdoptionId(
  tenantId: TenantId,
  capabilityId: string,
): string {
  return `adp_${fnv1a32Hex(canonicalJson([tenantId, capabilityId]))}`;
}

/** The deterministic adoption REVISION id (the arena adapter's scheme). */
export function capabilityAdoptionRecordId(adoptionId: string, version: number): string {
  return `adpv_${fnv1a32Hex(canonicalJson([adoptionId, version]))}`;
}

/**
 * The canonical content digest of an adoption revision's content fields
 * — the SAME field list as the arena adapter's
 * `capabilityAdoptionContentDigest` (the convergence basis: identical
 * inputs produce identical digests across the two ledgers).
 */
export function capabilityAdoptionContentDigest(
  record: Omit<LearningAdoptionRecord, "adoptionId" | "recordId" | "contentDigest">,
): string {
  return fnv1a32Hex(
    canonicalJson([
      record.tenantId,
      record.version,
      record.status,
      record.capabilityId,
      record.capabilityVersion,
      record.certificationRef,
      record.evaluationSuiteRevision,
      record.fleetOSCompatibilityStatement,
      record.warnings,
      record.capabilityClass ?? null,
      record.rolloutPolicy,
      record.cohort,
      record.rollbackVersion,
      record.proposalId,
      record.approverId,
      record.approvedAt,
      record.adoptedAt,
      record.supersedes ?? null,
    ]),
  );
}

// ---------------------------------------------------------------------------
// The tenant-partitioned, append-only adoption ledger store
// ---------------------------------------------------------------------------

/** The tagged result of an adoption-ledger write. */
export type LearningAdoptionStoreWrite =
  | { readonly ok: true; readonly record: LearningAdoptionRecord; readonly created: boolean }
  | { readonly ok: false; readonly error: FleetError };

/**
 * The tenant-scoped, append-only capability adoption ledger. Every
 * operation takes the acting `LearningTenantScope` FIRST and touches
 * only the acting tenant's partition. Adoption revisions are
 * append-only per adoption id with the supersession discipline (a new
 * revision on an existing adoptionId MUST supersede an ACTIVE prior;
 * the prior is never rewritten).
 */
export interface LearningAdoptionStore {
  /** Append an adoption revision into the ACTING tenant's partition (tenant must match). */
  appendAdoption(scope: LearningTenantScope, record: LearningAdoptionRecord): LearningAdoptionStoreWrite;
  /** The LATEST revision of an adoption (own partition only; undefined when absent/foreign). */
  getLatestAdoption(scope: LearningTenantScope, adoptionId: string): LearningAdoptionRecord | undefined;
  /** A specific revision of an adoption (own partition only). */
  getAdoptionRevision(scope: LearningTenantScope, adoptionId: string, version: number): LearningAdoptionRecord | undefined;
  /** Every revision of an adoption, version order (own partition only). */
  listAdoptionRevisions(scope: LearningTenantScope, adoptionId: string): readonly LearningAdoptionRecord[];
  /** All adoption ids in the acting partition (sorted). */
  listAdoptionIds(scope: LearningTenantScope): readonly string[];
  /** The number of adoptions in the acting partition. */
  size(scope: LearningTenantScope): number;
}

/**
 * Create the in-memory reference `LearningAdoptionStore`. Storage is
 * partitioned by tenant id; adoption revisions are append-only per
 * adoption id with the supersession discipline (the store audits
 * NOTHING — the `recordCapabilityAdoption` boundary emits through its
 * injected sink).
 */
export function createInMemoryLearningAdoptionStore(): LearningAdoptionStore {
  /** tenantId -> (adoptionId -> LearningAdoptionRecord[]). */
  const partitions = new Map<string, Map<string, LearningAdoptionRecord[]>>();

  function partitionOf(tenantId: string): Map<string, LearningAdoptionRecord[]> {
    let partition = partitions.get(tenantId);
    if (partition === undefined) {
      partition = new Map<string, LearningAdoptionRecord[]>();
      partitions.set(tenantId, partition);
    }
    return partition;
  }

  function guarded(
    scope: LearningTenantScope,
  ): { ok: true; tenantId: string } | { ok: false; error: FleetError } {
    const check = checkLearningTenantScope(scope);
    if (!check.ok) {
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.adoptionStoreDomain,
          `learning capability-adoption store refused access (${check.reason}: ${check.detail})`,
          { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: LEARNING_PIPELINE_CORRELATION_ID },
          "learning.adoption.store",
          check.reason,
        ),
      };
    }
    return { ok: true, tenantId: check.tenantId };
  }

  function trace(tenantId: string, correlationId: LearningTenantScope["correlationId"]) {
    return {
      tenantId: tenantId as TenantId,
      correlationId: correlationId ?? LEARNING_PIPELINE_CORRELATION_ID,
    };
  }

  return frozen({
    appendAdoption(
      scope: LearningTenantScope,
      record: LearningAdoptionRecord,
    ): LearningAdoptionStoreWrite {
      const guard = guarded(scope);
      if (!guard.ok) return guard;
      const tenantId = guard.tenantId;
      if (record.tenantId !== tenantId) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.adoptionStoreDomain,
            "learning capability adoption tenant does not match the acting tenant scope",
            trace(tenantId, scope.correlationId),
            "learning.adoption.store",
            "tenant_mismatch",
          ),
        };
      }
      const partition = partitionOf(tenantId);
      let revisions = partition.get(record.adoptionId);
      if (revisions === undefined) {
        revisions = [];
        partition.set(record.adoptionId, revisions);
      }
      // Supersession discipline (enforced BEFORE the version-slot check
      // so the structural failure surfaces first — the arena twin):
      //   1. a fresh (non-supersession) revision on an existing
      //      adoptionId is illegal;
      //   2. a supersession target MUST exist AND be ACTIVE.
      if (record.supersedes === undefined && revisions.length > 0) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.adoptionSupersessionIllegal,
            "adoption revision on an existing adoptionId MUST supersede the prior revision (use supersedes field)",
            trace(tenantId, scope.correlationId),
            "learning.adoption.supersession",
            "supersedes_required_for_existing_adoption",
          ),
        };
      }
      if (record.supersedes !== undefined) {
        const prior = revisions.find((r) => r.recordId === record.supersedes);
        if (prior === undefined) {
          return {
            ok: false,
            error: makeDomainError(
              ERROR_CODES.adoptionSupersessionIllegal,
              `adoption supersession target ${record.supersedes} does not exist in this adoption's revisions`,
              trace(tenantId, scope.correlationId),
              "learning.adoption.supersession",
              "supersession_target_unknown",
            ),
          };
        }
        if (prior.status !== ADOPTION_ACTIVE) {
          return {
            ok: false,
            error: makeDomainError(
              ERROR_CODES.adoptionSupersessionIllegal,
              `adoption supersession target ${record.supersedes} is not ACTIVE (got ${prior.status})`,
              trace(tenantId, scope.correlationId),
              "learning.adoption.supersession",
              "supersession_target_not_active",
            ),
          };
        }
      }
      // Idempotent re-write: same version + same digest returns the
      // existing record verbatim (created: false).
      const existing = revisions.find((r) => r.version === record.version);
      if (existing !== undefined) {
        if (existing.contentDigest === record.contentDigest) {
          return { ok: true, record: existing, created: false };
        }
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.adoptionStoreDomain,
            "adoption version slot already holds different content (append-only)",
            trace(tenantId, scope.correlationId),
            "learning.adoption.store",
            "version_slot_occupied",
          ),
        };
      }
      const expectedVersion =
        revisions.length === 0 ? record.version : revisions[revisions.length - 1].version + 1;
      if (record.version !== expectedVersion) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.adoptionStoreDomain,
            `adoption revision version out of sequence (expected ${expectedVersion}, got ${record.version})`,
            trace(tenantId, scope.correlationId),
            "learning.adoption.store",
            "version_out_of_sequence",
          ),
        };
      }
      revisions.push(record);
      return { ok: true, record, created: true };
    },
    getLatestAdoption(scope: LearningTenantScope, adoptionId: string): LearningAdoptionRecord | undefined {
      const guard = guarded(scope);
      if (!guard.ok) return undefined;
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return undefined;
      const revisions = partition.get(adoptionId);
      if (revisions === undefined || revisions.length === 0) return undefined;
      return revisions[revisions.length - 1];
    },
    getAdoptionRevision(
      scope: LearningTenantScope,
      adoptionId: string,
      version: number,
    ): LearningAdoptionRecord | undefined {
      const guard = guarded(scope);
      if (!guard.ok) return undefined;
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return undefined;
      const revisions = partition.get(adoptionId);
      if (revisions === undefined) return undefined;
      return revisions.find((r) => r.version === version);
    },
    listAdoptionRevisions(scope: LearningTenantScope, adoptionId: string): readonly LearningAdoptionRecord[] {
      const guard = guarded(scope);
      if (!guard.ok) return [];
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return [];
      const revisions = partition.get(adoptionId);
      if (revisions === undefined) return [];
      return Object.freeze([...revisions]);
    },
    listAdoptionIds(scope: LearningTenantScope): readonly string[] {
      const guard = guarded(scope);
      if (!guard.ok) return [];
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return [];
      return Object.freeze([...partition.keys()].sort());
    },
    size(scope: LearningTenantScope): number {
      const guard = guarded(scope);
      if (!guard.ok) return 0;
      const partition = partitions.get(guard.tenantId);
      return partition?.size ?? 0;
    },
  });
}

// ---------------------------------------------------------------------------
// The audited adoption boundary (PROPOSAL-gated, fail-closed)
// ---------------------------------------------------------------------------

/** Options for `recordCapabilityAdoption`. */
export interface RecordAdoptionOptions {
  /** The injected adoption instant (ISO 8601). */
  readonly at: string;
  /** The correlation id of the adoption request. */
  readonly correlationId: CorrelationId;
  /** The causation id, when the adoption is caused by a specific command/event. */
  readonly causationId?: CausationId;
  /** The injected audit sink (the boundary emits; default: no-op). */
  readonly auditSink?: LearningAuditSink;
  /** The rollout policy (defaults to `{ kind: "full" }`; canary/ring carry their required facets). */
  readonly rolloutPolicy?: RolloutPolicy;
  /** Optional: the content-hash check for the certification (defense in depth). */
  readonly hashCheck?: CertificationHashCheck;
}

/** The tagged result of a capability adoption. */
export type LearningAdoptionResult =
  | {
      readonly ok: true;
      readonly record: LearningAdoptionRecord;
      /** The certified capability (the gate's output — the narrowed metadata the adoption consumed). */
      readonly certified: CertifiedCapability;
      /** Whether this call CREATED the revision (false on an idempotent re-append). */
      readonly created: boolean;
    }
  | { readonly ok: false; readonly error: FleetError; readonly refusal?: CertificationRefusal };

/**
 * Record a capability adoption through the EXPLICIT PROPOSAL-gated
 * transition. PURE: every input (capability metadata, proposal,
 * adoption instant, correlation id) is injected; this boundary reads no
 * clock and no entropy.
 *
 * The adoption is PROPOSAL-gated (never automatic):
 *   1. The capability metadata is routed through the fail-closed
 *      certification gate FIRST. A refusal produces a tagged result
 *      carrying the machine-stable reasons; the ledger is untouched;
 *      the refusal is AUDITED (the boundary holding is evidence a
 *      reviewer must be able to prove).
 *   2. The certified capability is then adopted through the EXPLICIT
 *      human-approved proposal — the approver id + approved-at instant
 *      are recorded verbatim (the explicit grant).
 *   3. The adoption is durable in the append-only ledger (version 1
 *      for a fresh adoption; version = prior + 1 for a supersession —
 *      the store enforces the supersession discipline).
 *
 * The record carries the certification reference VERBATIM — the record
 * is the audit evidence that the certification existed at adoption
 * time. There is NO path from raw model output to an adoption record
 * (the gate consumes ONLY the typed certified-metadata facet).
 *
 * Audit: a refusal emits `learning.adoption.refused`; a CREATED
 * revision emits `learning.adoption.recorded` (fresh) or
 * `learning.adoption.superseded` (a revision citing a prior). An
 * idempotent re-append mutates nothing and audits nothing. Failed
 * validations never audit.
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param store the capability adoption ledger
 * @param metadata the certified-capability metadata (consumed through the fail-closed gate)
 * @param proposal the human-approved adoption proposal (the PROPOSAL seam)
 * @param options the adoption options (instant, trace, rollout policy, audit sink)
 * @returns the tagged adoption result
 */
export function recordCapabilityAdoption(
  scope: LearningTenantScope,
  store: LearningAdoptionStore,
  metadata: CertifiedCapabilityFacet | null | undefined,
  proposal: LearningAdoptionProposal,
  options: RecordAdoptionOptions,
): LearningAdoptionResult {
  // 1. The tenant-scope guard.
  const guard = checkLearningTenantScope(scope);
  if (!guard.ok) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.adoptionStoreDomain,
        `learning capability-adoption store refused access (${guard.reason}: ${guard.detail})`,
        { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: LEARNING_PIPELINE_CORRELATION_ID },
        "learning.adoption.store",
        guard.reason,
      ),
    };
  }
  const trace = { tenantId: guard.tenantId, correlationId: options?.correlationId ?? LEARNING_PIPELINE_CORRELATION_ID };
  // 2. Validate the proposal + options (pure, non-throwing).
  const failures: { path: string; reason: string }[] = [];
  if (typeof proposal?.proposalId !== "string" || proposal.proposalId.length === 0) {
    failures.push({ path: "/proposal/proposalId", reason: "required" });
  }
  if (typeof proposal?.approverId !== "string" || proposal.approverId.length === 0) {
    failures.push({ path: "/proposal/approverId", reason: "required" });
  }
  if (typeof proposal?.approvedAt !== "string" || !looksLikeIso(proposal.approvedAt)) {
    failures.push({ path: "/proposal/approvedAt", reason: "not_iso" });
  }
  if (typeof proposal?.cohort !== "string" || proposal.cohort.length === 0) {
    failures.push({ path: "/proposal/cohort", reason: "required" });
  }
  if (typeof proposal?.rollbackVersion !== "string" || proposal.rollbackVersion.length === 0) {
    failures.push({ path: "/proposal/rollbackVersion", reason: "required" });
  }
  if (
    proposal?.supersedes !== undefined &&
    (typeof proposal.supersedes !== "string" || proposal.supersedes.length === 0)
  ) {
    failures.push({ path: "/proposal/supersedes", reason: "non_empty_string_required" });
  }
  if (typeof options?.at !== "string" || !looksLikeIso(options.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof options?.correlationId !== "string" || options.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  // The rollout policy validation (canary requires a 0-100 percentage;
  // ring requires non-empty ringIds; full requires neither).
  const rolloutPolicy: RolloutPolicy =
    options?.rolloutPolicy !== undefined ? options.rolloutPolicy : frozen({ kind: "full" });
  if (
    rolloutPolicy === null ||
    typeof rolloutPolicy !== "object" ||
    !(ALL_ROLLOUT_POLICY_KINDS as readonly string[]).includes(rolloutPolicy.kind)
  ) {
    failures.push({ path: "/rolloutPolicy/kind", reason: "unknown_rollout_kind" });
  } else if (rolloutPolicy.kind === "canary") {
    if (
      typeof rolloutPolicy.percentage !== "number" ||
      !Number.isFinite(rolloutPolicy.percentage) ||
      rolloutPolicy.percentage < 0 ||
      rolloutPolicy.percentage > 100
    ) {
      failures.push({ path: "/rolloutPolicy/percentage", reason: "percentage_0_100_required" });
    }
    if (rolloutPolicy.ringIds !== undefined) {
      failures.push({ path: "/rolloutPolicy/ringIds", reason: "not_allowed_for_canary" });
    }
  } else if (rolloutPolicy.kind === "ring") {
    if (
      !Array.isArray(rolloutPolicy.ringIds) ||
      rolloutPolicy.ringIds.length === 0 ||
      !rolloutPolicy.ringIds.every((r) => typeof r === "string" && r.length > 0)
    ) {
      failures.push({ path: "/rolloutPolicy/ringIds", reason: "non_empty_string_array_required" });
    }
    if (rolloutPolicy.percentage !== undefined) {
      failures.push({ path: "/rolloutPolicy/percentage", reason: "not_allowed_for_ring" });
    }
  } else if (rolloutPolicy.kind === "full") {
    if (rolloutPolicy.percentage !== undefined || rolloutPolicy.ringIds !== undefined) {
      failures.push({ path: "/rolloutPolicy", reason: "not_allowed_for_full" });
    }
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.adoptionInvalid,
        "learning capability adoption request is invalid",
        trace,
        failures,
      ),
    };
  }
  // 3. The fail-closed certification gate — FIRST, before any ledger
  // mutation. A refusal is audited (the boundary held) and returned.
  const certification: CertificationResult = requireCertifiedCapability(metadata, {
    correlationId: trace.correlationId,
    ...(options.hashCheck !== undefined ? { hashCheck: options.hashCheck } : {}),
  });
  if (!certification.ok) {
    const sink: LearningAuditSink = options.auditSink ?? NOOP_LEARNING_AUDIT_SINK;
    sink.append(
      frozen({
        action: LEARNING_AUDIT_ACTIONS.adoptionRefused,
        tenantId: certification.refusal.tenantId,
        subject: certification.refusal.metadata.capabilityId,
        occurredAt: options.at,
        correlationId: trace.correlationId,
        causationId: options.causationId,
        details: frozen({
          capabilityId: certification.refusal.metadata.capabilityId,
          capabilityVersion: certification.refusal.metadata.capabilityVersion,
          certificationRef: certification.refusal.metadata.certificationRef,
          evaluationSuiteRevision: certification.refusal.metadata.evaluationSuiteRevision,
          fleetOSCompatibilityStatement: certification.refusal.metadata.fleetOSCompatibilityStatement,
          reasons: certification.refusal.reasons,
        }),
      }),
    );
    return {
      ok: false,
      error: refusalToFleetError(certification.refusal, trace.correlationId),
      refusal: certification.refusal,
    };
  }
  // 4. The certified capability is now safe to adopt.
  const certified = certification.certified;
  // 5. Tenant isolation by rejection: the certified capability's tenant
  // MUST match the acting scope's tenant.
  if (certified.tenantId !== guard.tenantId) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.adoptionStoreDomain,
        "learning capability adoption refused: certified capability tenant does not match the acting tenant scope",
        trace,
        "learning.adoption.record",
        "tenant_mismatch",
      ),
    };
  }
  // 6. The adoption identity + version (fresh: 1; supersession:
  // prior revisions + 1 — the store enforces the discipline on append).
  const adoptionId = capabilityAdoptionId(guard.tenantId, certified.capabilityId);
  const priorRevisions = store.listAdoptionRevisions(scope, adoptionId);
  const version = proposal.supersedes !== undefined ? priorRevisions.length + 1 : 1;
  const status: LearningAdoptionStatus = ADOPTION_ACTIVE;
  const content: Omit<LearningAdoptionRecord, "adoptionId" | "recordId" | "contentDigest"> = frozen({
    tenantId: guard.tenantId,
    version,
    status,
    capabilityId: certified.capabilityId,
    capabilityVersion: certified.capabilityVersion,
    certificationRef: certified.certificationRef,
    evaluationSuiteRevision: certified.evaluationSuiteRevision,
    fleetOSCompatibilityStatement: certified.fleetOSCompatibilityStatement,
    warnings: frozenArray(certified.warnings),
    ...(certified.capabilityClass !== undefined ? { capabilityClass: certified.capabilityClass } : {}),
    rolloutPolicy,
    cohort: proposal.cohort,
    rollbackVersion: proposal.rollbackVersion,
    proposalId: proposal.proposalId,
    approverId: proposal.approverId,
    approvedAt: proposal.approvedAt,
    adoptedAt: options.at,
    ...(proposal.supersedes !== undefined ? { supersedes: proposal.supersedes } : {}),
  });
  const record: LearningAdoptionRecord = frozen({
    ...content,
    adoptionId,
    recordId: capabilityAdoptionRecordId(adoptionId, version),
    contentDigest: capabilityAdoptionContentDigest(content),
  });
  const write = store.appendAdoption(scope, record);
  if (!write.ok) {
    return { ok: false, error: write.error };
  }
  // 7. Audit the consequential mutation (a CREATED revision only — an
  // idempotent re-append mutates nothing and audits nothing).
  if (write.created) {
    const sink: LearningAuditSink = options.auditSink ?? NOOP_LEARNING_AUDIT_SINK;
    const action =
      proposal.supersedes !== undefined
        ? LEARNING_AUDIT_ACTIONS.adoptionSuperseded
        : LEARNING_AUDIT_ACTIONS.adoptionRecorded;
    sink.append(
      frozen({
        action,
        tenantId: record.tenantId,
        subject: record.adoptionId,
        occurredAt: record.adoptedAt,
        correlationId: trace.correlationId,
        causationId: options.causationId,
        details: frozen({
          adoptionId: record.adoptionId,
          recordId: record.recordId,
          version: record.version,
          status: record.status,
          capabilityId: record.capabilityId,
          capabilityVersion: record.capabilityVersion,
          certificationRef: record.certificationRef,
          evaluationSuiteRevision: record.evaluationSuiteRevision,
          fleetOSCompatibilityStatement: record.fleetOSCompatibilityStatement,
          warnings: record.warnings,
          rolloutPolicy: record.rolloutPolicy,
          cohort: record.cohort,
          rollbackVersion: record.rollbackVersion,
          proposalId: record.proposalId,
          approverId: record.approverId as string,
          approvedAt: record.approvedAt,
          ...(record.supersedes !== undefined ? { supersedes: record.supersedes } : {}),
          contentDigest: record.contentDigest,
        }),
      }),
    );
  }
  return { ok: true, record: write.record, certified, created: write.created };
}
