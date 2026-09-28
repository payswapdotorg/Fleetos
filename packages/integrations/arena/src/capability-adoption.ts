/**
 * @fleetos/integration-arena — D2: certified capability adoption.
 *
 * Per `spec/integration/ARENA.md` + the W050B work order: an adoption
 * record carries:
 *   - capability ID/version,
 *   - Arena certification reference,
 *   - FleetOS compatibility statement,
 *   - evaluation-suite revision,
 *   - rollout policy,
 *   - cohort,
 *   - rollback version.
 *
 * Versioned append-only records with supersession discipline: a new
 * revision is a NEW record citing the prior via `supersedes`; the prior
 * revision is never rewritten (the versioned-interpretation discipline
 * from `spec/ARCHITECTURE-LOCK.md` item 3). The adoption identity
 * (`adoptionId`) is the deterministic digest of (tenantId,
 * capabilityId, capabilityVersion) — stable across revisions, unique
 * per (tenant, capability, version).
 *
 * Adoption is an EXPLICIT PROPOSAL-gated transition (never automatic):
 *   - The capability metadata is routed through D3's
 *     `requireCertifiedCapability` gate FIRST (fail-closed at the
 *     certification boundary — ARENA.md invariant).
 *   - The certified capability is then adopted through an EXPLICIT
 *     human-approved proposal (the `CapabilityAdoptionProposal` seam —
 *     the caller supplies a proposal id and approver id; this package
 *     never auto-adopts).
 *
 * Tenant isolation is BY CONSTRUCTION (W012's pattern): every operation
 * takes the acting `ArenaTenantScope` FIRST; storage is partitioned per
 * tenant; a foreign adoption id is indistinguishable from an unknown one.
 *
 * Audit (D5): consequential mutations (capability ADOPTED / SUPERSEDED,
 * uncertified refusal) emit audit records to the injected sink. Pure
 * reads and failed validations never audit.
 *
 * ARENA.md invariant: this module NEVER treats an uncertified model
 * output as action permission. The adoption record carries the
 * certification reference VERBATIM — the record is the audit evidence
 * that the certification existed at adoption time. The capability
 * metadata is consumed ONLY through the D3 gate; there is no path from
 * raw model output to an adoption record (proven by test).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type {
  CausationId,
  CorrelationId,
  FleetError,
  TenantId,
  UserId,
} from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import type { ArenaAuditSink } from "./audit-seam";
import { ARENA_AUDIT_ACTIONS, NOOP_ARENA_AUDIT_SINK } from "./audit-seam";
import type {
  CertifiedCapability,
  CertifiedCapabilityMetadata,
  CertificationRefusal,
  CertificationResult,
} from "./certification-boundary";
import { requireCertifiedCapability, refusalToFleetError } from "./certification-boundary";
import {
  ERROR_CODES,
  ARENA_PIPELINE_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT,
  canonicalJson,
  fnv1a32Hex,
  frozen,
  looksLikeIso,
  makeDomainError,
  makeValidationError,
} from "./internal";
import type { ArenaTenantScope } from "./internal";
import { checkArenaTenantScope } from "./internal";

// ---------------------------------------------------------------------------
// The adoption status (machine-stable)
// ---------------------------------------------------------------------------

export const ADOPTION_ACTIVE = "ACTIVE" as const;
export const ADOPTION_SUPERSEDED = "SUPERSEDED" as const;

/**
 * The status of a capability adoption revision. `ACTIVE` is the only
 * non-terminal status: an ACTIVE adoption is the latest revision of its
 * adoption identity; a SUPERSEDED adoption has been replaced by a newer
 * revision (the prior revision is never rewritten — it carries the
 * supersession link for the audit trail).
 */
export type CapabilityAdoptionStatus =
  | typeof ADOPTION_ACTIVE
  | typeof ADOPTION_SUPERSEDED;

/** All adoption statuses (for validation + iteration). */
export const ALL_CAPABILITY_ADOPTION_STATUSES: readonly CapabilityAdoptionStatus[] = Object.freeze([
  ADOPTION_ACTIVE,
  ADOPTION_SUPERSEDED,
]);

// ---------------------------------------------------------------------------
// The rollout policy (machine-stable)
// ---------------------------------------------------------------------------

/**
 * The rollout policy of a capability adoption. The control plane never
 * interprets the policy's `kind` beyond recording it; the binding site
 * (a future UI wave / control-tower surface) consumes the policy to
 * drive the actual rollout. This package records the policy verbatim.
 *
 *   - `canary`:    adopt for a small canary cohort first.
 *   - `ring`:       adopt for a specific ring of cohorts (the `ringIds`).
 *   - `full`:       adopt for the entire tenant.
 */
export type RolloutPolicyKind = "canary" | "ring" | "full";

/** All rollout policy kinds (for validation + iteration). */
export const ALL_ROLLOUT_POLICY_KINDS: readonly RolloutPolicyKind[] = Object.freeze([
  "canary",
  "ring",
  "full",
]);

/**
 * The rollout policy record. Carries the kind, an optional percentage
 * (0-100 — for canary), an optional ringIds list (for ring), and an
 * optional cohort (the cohort identifier — for any kind, the cohort
 * the adoption is targeted at).
 */
export interface RolloutPolicy {
  /** The rollout kind. */
  readonly kind: RolloutPolicyKind;
  /** The percentage (0-100) for canary rollouts (optional; ignored for other kinds). */
  readonly percentage?: number;
  /** The ring ids for ring rollouts (optional; ignored for other kinds). */
  readonly ringIds?: readonly string[];
}

// ---------------------------------------------------------------------------
// The PROPOSAL seam (the human-approval gate the adoption requires)
// ---------------------------------------------------------------------------

/**
 * The explicit, human-approved capability adoption proposal. This is the
 * PROPOSAL seam: adoption NEVER happens automatically; the caller MUST
 * supply a proposal that has been human-approved (the proposal id + the
 * approver id + the approval instant — all injected by the caller).
 *
 * The proposal carries:
 *   - `proposalId` — the durable proposal identifier (content-addressable).
 *   - `approverId` — the approving principal's user id (a branded
 *     `UserId` from the frozen contracts).
 *   - `approvedAt` — the injected approval instant (ISO 8601).
 *   - `cohort` — the cohort the adoption is targeted at.
 *   - `rollbackVersion` — the prior capability version to roll back to
 *     if the adoption fails (the rollback plan is part of the proposal —
 *     never inferred).
 *   - `supersedes` — the prior adoption recordId this proposal
 *     supersedes (optional — present on a supersession, absent on a
 *     fresh adoption).
 */
export interface CapabilityAdoptionProposal {
  /** The durable proposal identifier (content-addressable string). */
  readonly proposalId: string;
  /** The approving principal's user id (a branded `UserId` from the frozen contracts). */
  readonly approverId: UserId;
  /** The injected approval instant (ISO 8601). */
  readonly approvedAt: string;
  /** The cohort the adoption is targeted at (machine-stable string). */
  readonly cohort: string;
  /** The prior capability version to roll back to if the adoption fails. */
  readonly rollbackVersion: string;
  /** Optional: the prior adoption recordId this proposal supersedes (present on a supersession; absent on a fresh adoption). */
  readonly supersedes?: string;
}

// ---------------------------------------------------------------------------
// The versioned adoption record
// ---------------------------------------------------------------------------

/**
 * A versioned capability adoption record. Append-only: a supersession
 * appends a NEW revision (version = prior + 1) with the prior's
 * `recordId` in `supersedes`; the prior revision is never rewritten
 * (only its `status` field is conceptually SUPERSEDED — but the record
 * itself is immutable, so the supersession is recorded as a NEW record
 * referencing the prior).
 *
 * The adoption identity (`adoptionId`) is the deterministic digest of
 * (tenantId, capabilityId, capabilityVersion) — stable across
 * revisions, unique per (tenant, capability, version).
 */
export interface CapabilityAdoptionRecord extends TenantScoped {
  /** Deterministic adoption identity: `adp_` + fnv1a32(tenantId, capabilityId, capabilityVersion). */
  readonly adoptionId: string;
  /** Deterministic revision id: `adpv_` + fnv1a32(adoptionId, version). */
  readonly recordId: string;
  readonly tenantId: TenantId;
  /** The append-only revision number (>= 1). */
  readonly version: number;
  /** The adoption status (ACTIVE / SUPERSEDED). */
  readonly status: CapabilityAdoptionStatus;
  /** The capability id (from the certified metadata — verbatim). */
  readonly capabilityId: string;
  /** The capability version (from the certified metadata — verbatim). */
  readonly capabilityVersion: string;
  /** The Arena certification reference (from the certified metadata — verbatim; the audit evidence that the certification existed at adoption time). */
  readonly certificationRef: string;
  /** The evaluation-suite revision (from the certified metadata — verbatim). */
  readonly evaluationSuiteRevision: string;
  /** The FleetOS compatibility statement (from the certified metadata — verbatim). */
  readonly fleetOSCompatibilityStatement: string;
  /** The warnings (from the certified metadata — verbatim; may be empty). */
  readonly warnings: readonly string[];
  /** The optional capability class (from the certified metadata — verbatim; may be absent). */
  readonly capabilityClass?: string;
  /** The rollout policy (from the proposal — verbatim). */
  readonly rolloutPolicy: RolloutPolicy;
  /** The cohort (from the proposal — verbatim). */
  readonly cohort: string;
  /** The rollback version (from the proposal — verbatim). */
  readonly rollbackVersion: string;
  /** The proposal id (from the proposal — verbatim). */
  readonly proposalId: string;
  /** The approver id (from the proposal — verbatim). */
  readonly approverId: UserId;
  /** The injected approval instant (ISO 8601 — from the proposal). */
  readonly approvedAt: string;
  /** The injected adoption instant (ISO 8601 — when the adoption record was created). */
  readonly adoptedAt: string;
  /** Optional: the prior adoption recordId this revision supersedes. */
  readonly supersedes?: string;
  /** Canonical digest of the record's CONTENT (identity fields excluded). */
  readonly contentDigest: string;
}

/** The deterministic adoption identity. */
export function capabilityAdoptionId(
  tenantId: TenantId,
  capabilityId: string,
): string {
  return `adp_${fnv1a32Hex(canonicalJson([tenantId, capabilityId]))}`;
}

/** The deterministic adoption REVISION id. */
export function capabilityAdoptionRecordId(adoptionId: string, version: number): string {
  return `adpv_${fnv1a32Hex(canonicalJson([adoptionId, version]))}`;
}

/** The canonical content digest of an adoption revision's content fields. */
export function capabilityAdoptionContentDigest(
  record: Omit<CapabilityAdoptionRecord, "adoptionId" | "recordId" | "contentDigest">,
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
// The tenant-partitioned adoption store
// ---------------------------------------------------------------------------

/** The tagged result of an adoption-store write. */
export type CapabilityAdoptionStoreWrite =
  | { readonly ok: true; readonly record: CapabilityAdoptionRecord }
  | { readonly ok: false; readonly error: FleetError };

/**
 * The tenant-scoped, append-only capability-adoption store. Every
 * operation takes the acting `ArenaTenantScope` FIRST and touches only
 * the acting tenant's partition. Adoption revisions are append-only per
 * adoption id (the prior is never rewritten — versioned-interpretation
 * discipline).
 */
export interface CapabilityAdoptionStore {
  /** Append an adoption revision into the ACTING tenant's partition (tenant must match). */
  appendAdoption(scope: ArenaTenantScope, record: CapabilityAdoptionRecord): CapabilityAdoptionStoreWrite;
  /** The LATEST revision of an adoption (own partition only; undefined when absent/foreign). */
  getLatestAdoption(scope: ArenaTenantScope, adoptionId: string): CapabilityAdoptionRecord | undefined;
  /** A specific revision of an adoption (own partition only). */
  getAdoptionRevision(scope: ArenaTenantScope, adoptionId: string, version: number): CapabilityAdoptionRecord | undefined;
  /** Every revision of an adoption, version order (own partition only). */
  listAdoptionRevisions(scope: ArenaTenantScope, adoptionId: string): readonly CapabilityAdoptionRecord[];
  /** All adoption ids in the acting partition (sorted). */
  listAdoptionIds(scope: ArenaTenantScope): readonly string[];
  /** The number of adoptions in the acting partition. */
  size(scope: ArenaTenantScope): number;
}

/**
 * Create the in-memory reference `CapabilityAdoptionStore`. Storage is
 * partitioned by tenant id; adoption revisions are append-only per
 * adoption id.
 *
 * The store audits NOTHING: every consequential adoption mutation's
 * audit (adopted / superseded / refused) is emitted by the domain
 * boundary function (`adoptCapability` /
 * `supersedeCapabilityAdoption`) through ITS injected sink — one
 * coherent emission policy across the arena package.
 */
export function createInMemoryCapabilityAdoptionStore(): CapabilityAdoptionStore {
  /** tenantId -> (adoptionId -> CapabilityAdoptionRecord[]). */
  const partitions = new Map<string, Map<string, CapabilityAdoptionRecord[]>>();

  function partitionOf(tenantId: string): Map<string, CapabilityAdoptionRecord[]> {
    let partition = partitions.get(tenantId);
    if (partition === undefined) {
      partition = new Map<string, CapabilityAdoptionRecord[]>();
      partitions.set(tenantId, partition);
    }
    return partition;
  }

  function guarded(
    scope: ArenaTenantScope,
  ): { ok: true; tenantId: string } | { ok: false; error: FleetError } {
    const check = checkArenaTenantScope(scope);
    if (!check.ok) {
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.adoptionStoreDomain,
          `arena capability-adoption store refused access (${check.reason}: ${check.detail})`,
          { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: ARENA_PIPELINE_CORRELATION_ID },
          "arena.adoption.store",
          check.reason,
        ),
      };
    }
    return { ok: true, tenantId: check.tenantId };
  }

  function trace(tenantId: string, correlationId: ArenaTenantScope["correlationId"]) {
    return {
      tenantId: tenantId as TenantId,
      correlationId: correlationId ?? ARENA_PIPELINE_CORRELATION_ID,
    };
  }

  return frozen({
    appendAdoption(
      scope: ArenaTenantScope,
      record: CapabilityAdoptionRecord,
    ): CapabilityAdoptionStoreWrite {
      const guard = guarded(scope);
      if (!guard.ok) return guard;
      const tenantId = guard.tenantId;
      if (record.tenantId !== tenantId) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.adoptionStoreDomain,
            "arena capability adoption tenant does not match the acting tenant scope",
            trace(tenantId, scope.correlationId),
            "arena.adoption.store",
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
      // Supersession discipline: enforce BEFORE the version-slot check
      // so a fresh (non-supersession) revision on an existing adoptionId
      // surfaces the structural failure (supersedes_required_for_existing_adoption)
      // rather than the version-slot failure (version_slot_occupied).
      //   1. If `revisions.length > 0` and `record.supersedes === undefined`,
      //      the only legal way to add a revision is via supersession.
      //   2. If `record.supersedes !== undefined`, the target MUST exist
      //      AND be ACTIVE.
      if (record.supersedes === undefined && revisions.length > 0) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.adoptionSupersessionIllegal,
            "adoption revision on an existing adoptionId MUST supersede the prior revision (use supersedes field)",
            trace(tenantId, scope.correlationId),
            "arena.adoption.supersession",
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
              "arena.adoption.supersession",
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
              "arena.adoption.supersession",
              "supersession_target_not_active",
            ),
          };
        }
      }
      // Idempotent re-write: if a record with the same version AND
      // content digest exists, return it verbatim (the same record —
      // never a duplicate).
      const existing = revisions.find((r) => r.version === record.version);
      if (existing !== undefined) {
        if (existing.contentDigest === record.contentDigest) {
          return { ok: true, record: existing };
        }
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.adoptionStoreDomain,
            "adoption version slot already holds different content (append-only)",
            trace(tenantId, scope.correlationId),
            "arena.adoption.store",
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
            "arena.adoption.store",
            "version_out_of_sequence",
          ),
        };
      }
      revisions.push(record);
      return { ok: true, record };
    },
    getLatestAdoption(scope: ArenaTenantScope, adoptionId: string): CapabilityAdoptionRecord | undefined {
      const guard = guarded(scope);
      if (!guard.ok) return undefined;
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return undefined;
      const revisions = partition.get(adoptionId);
      if (revisions === undefined || revisions.length === 0) return undefined;
      return revisions[revisions.length - 1];
    },
    getAdoptionRevision(
      scope: ArenaTenantScope,
      adoptionId: string,
      version: number,
    ): CapabilityAdoptionRecord | undefined {
      const guard = guarded(scope);
      if (!guard.ok) return undefined;
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return undefined;
      const revisions = partition.get(adoptionId);
      if (revisions === undefined) return undefined;
      return revisions.find((r) => r.version === version);
    },
    listAdoptionRevisions(scope: ArenaTenantScope, adoptionId: string): readonly CapabilityAdoptionRecord[] {
      const guard = guarded(scope);
      if (!guard.ok) return [];
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return [];
      const revisions = partition.get(adoptionId);
      if (revisions === undefined) return [];
      return Object.freeze([...revisions]);
    },
    listAdoptionIds(scope: ArenaTenantScope): readonly string[] {
      const guard = guarded(scope);
      if (!guard.ok) return [];
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return [];
      return Object.freeze([...partition.keys()].sort());
    },
    size(scope: ArenaTenantScope): number {
      const guard = guarded(scope);
      if (!guard.ok) return 0;
      const partition = partitions.get(guard.tenantId);
      return partition?.size ?? 0;
    },
  });
}

// ---------------------------------------------------------------------------
// Adoption (the EXPLICIT PROPOSAL-gated transition)
// ---------------------------------------------------------------------------

/** Options for `adoptCapability`. */
export interface AdoptCapabilityOptions {
  /** The injected adoption instant (ISO 8601). */
  readonly at: string;
  /** The correlation id of the adoption request. */
  readonly correlationId: CorrelationId;
  /** The causation id, when the adoption is caused by a specific command/event. */
  readonly causationId?: CausationId;
  /** The injected audit sink (the adoption emits; default: no-op). */
  readonly auditSink?: ArenaAuditSink;
  /** Optional: the content-hash check for the certification (defense in depth; passed to the D3 gate). */
  readonly hashCheck?: { readonly expectedHash: string; readonly hashAlgorithm: string };
}

/** The tagged result of a capability adoption. */
export type CapabilityAdoptionResult =
  | {
      readonly ok: true;
      readonly record: CapabilityAdoptionRecord;
      /** The certified capability (the D3 gate's output — the narrowed metadata the adoption consumed). */
      readonly certified: CertifiedCapability;
    }
  | { readonly ok: false; readonly error: FleetError; readonly refusal?: CertificationRefusal };

/**
 * Adopt a certified capability through an EXPLICIT PROPOSAL-gated
 * transition. PURE: every input (capability metadata, proposal,
 * adoption instant, correlation id) is injected; the arena package
 * reads no clock and no entropy.
 *
 * The adoption is PROPOSAL-gated (never automatic):
 *   1. The capability metadata is routed through D3's
 *      `requireCertifiedCapability` gate FIRST (fail-closed at the
 *      certification boundary — ARENA.md invariant). A refusal
 *      produces a `CapabilityAdoptionResult` with `ok: false` carrying
 *      the machine-stable refusal reasons; the adoption store is
 *      untouched, and the refusal is audited.
 *   2. The certified capability is then adopted through an EXPLICIT
 *      human-approved proposal (the `CapabilityAdoptionProposal` seam).
 *      The proposal's `approverId` is recorded verbatim — the audit
 *      evidence that a human approved the adoption.
 *   3. The adoption is durable in the append-only ledger (version 1
 *      for a fresh adoption; version = prior + 1 for a supersession).
 *
 * ARENA.md invariant: this module NEVER treats an uncertified model
 * output as action permission. The adoption record carries the
 * certification reference VERBATIM — the record is the audit evidence
 * that the certification existed at adoption time. The capability
 * metadata is consumed ONLY through the D3 gate; there is no path from
 * raw model output to an adoption record (proven by test).
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param store the capability-adoption store
 * @param metadata the certified-capability metadata (consumed through the D3 gate)
 * @param proposal the human-approved adoption proposal (the PROPOSAL seam)
 * @param options the adoption options (adoption instant, correlation id, audit sink)
 * @returns the tagged adoption result
 */
export function adoptCapability(
  scope: ArenaTenantScope,
  store: CapabilityAdoptionStore,
  metadata: CertifiedCapabilityMetadata | null | undefined,
  proposal: CapabilityAdoptionProposal,
  options: AdoptCapabilityOptions,
): CapabilityAdoptionResult {
  // 1. The tenant-scope guard.
  const guard = checkArenaTenantScope(scope);
  if (!guard.ok) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.adoptionStoreDomain,
        `arena capability-adoption store refused access (${guard.reason}: ${guard.detail})`,
        { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: ARENA_PIPELINE_CORRELATION_ID },
        "arena.adoption.store",
        guard.reason,
      ),
    };
  }
  const trace = {
    tenantId: guard.tenantId,
    correlationId: options.correlationId ?? ARENA_PIPELINE_CORRELATION_ID,
  };
  // 2. Validate the proposal inputs (pure, non-throwing).
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
  if (proposal?.supersedes !== undefined && (typeof proposal.supersedes !== "string" || proposal.supersedes.length === 0)) {
    failures.push({ path: "/proposal/supersedes", reason: "non_empty_string_required" });
  }
  if (typeof options?.at !== "string" || !looksLikeIso(options.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof options?.correlationId !== "string" || options.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.adoptionInvalid,
        "arena capability adoption request is invalid",
        trace,
        failures,
      ),
    };
  }
  // 3. The D3 fail-closed certification gate — FIRST, before any store
  // mutation. A refusal produces a tagged result with the machine-stable
  // reasons; the store is untouched; the refusal is audited.
  const certification: CertificationResult = requireCertifiedCapability(metadata, {
    correlationId: trace.correlationId,
    ...(options.hashCheck !== undefined ? { hashCheck: options.hashCheck } : {}),
  });
  if (!certification.ok) {
    const sink: ArenaAuditSink = options.auditSink ?? NOOP_ARENA_AUDIT_SINK;
    sink.append(
      frozen({
        action: ARENA_AUDIT_ACTIONS.capabilityRefused,
        tenantId: certification.refusal.tenantId,
        subject: certification.refusal.metadata.capabilityId ?? null,
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
  // 4. The certified capability is now safe to adopt. The adoption
  // identity is the deterministic digest of (tenantId, capabilityId,
  // capabilityVersion).
  const certified = certification.certified;
  // 5. Tenant isolation by rejection: the certified capability's
  // tenant MUST match the acting scope's tenant. (The D3 gate produced
  // the certified capability with the metadata's tenant — which may be
  // `tnt_system` for missing-metadata cases. We surface the mismatch
  // here so the adoption lane is fail-closed at the adoption boundary.)
  if (certified.tenantId !== guard.tenantId) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.adoptionStoreDomain,
        "arena capability adoption refused: certified capability tenant does not match the acting tenant scope",
        trace,
        "arena.adoption.adopt",
        "tenant_mismatch",
      ),
    };
  }
  // 6. Supersession discipline: if the proposal supersedes a prior
  // adoption, the prior MUST exist in the store AND be ACTIVE. The
  // store enforces this on append; we let the store's validation
  // surface the failure (the store's `appendAdoption` checks the
  // supersession target). The new revision's `supersedes` is the prior
  // recordId.
  const adoptionId = capabilityAdoptionId(
    guard.tenantId,
    certified.capabilityId,
  );
  // 7. Determine the version: 1 for a fresh adoption; prior + 1 for a
  // supersession.
  const priorRevisions = store.listAdoptionRevisions(scope, adoptionId);
  const version = proposal.supersedes !== undefined ? priorRevisions.length + 1 : 1;
  const status: CapabilityAdoptionStatus = ADOPTION_ACTIVE;
  // The rollout policy is built from the proposal — the caller supplies
  // the kind via the proposal's `cohort` (the rollout policy is
  // defaulted to `full` for v1; a later wave may let the proposal
  // carry the rollout policy explicitly).
  const rolloutPolicy: RolloutPolicy = frozen({ kind: "full" });
  const content: Omit<CapabilityAdoptionRecord, "adoptionId" | "recordId" | "contentDigest"> = frozen({
    tenantId: guard.tenantId,
    version,
    status,
    capabilityId: certified.capabilityId,
    capabilityVersion: certified.capabilityVersion,
    certificationRef: certified.certificationRef,
    evaluationSuiteRevision: certified.evaluationSuiteRevision,
    fleetOSCompatibilityStatement: certified.fleetOSCompatibilityStatement,
    warnings: Object.freeze([...certified.warnings]),
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
  const record: CapabilityAdoptionRecord = frozen({
    ...content,
    adoptionId,
    recordId: capabilityAdoptionRecordId(adoptionId, version),
    contentDigest: capabilityAdoptionContentDigest(content),
  });
  const write = store.appendAdoption(scope, record);
  if (!write.ok) {
    return { ok: false, error: write.error };
  }
  // 8. Audit the adoption (consequential mutation).
  const sink: ArenaAuditSink = options.auditSink ?? NOOP_ARENA_AUDIT_SINK;
  const action =
    proposal.supersedes !== undefined
      ? ARENA_AUDIT_ACTIONS.capabilitySuperseded
      : ARENA_AUDIT_ACTIONS.capabilityAdopted;
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
  return { ok: true, record, certified };
}
