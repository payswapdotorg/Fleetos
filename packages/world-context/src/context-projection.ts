/**
 * @fleetos/world-context — D1: the workload/project context projection.
 *
 * The PURE function family that builds a `WorldModelContext`-shaped
 * record (structurally compatible with the W154 frozen
 * `WorldModelContext` — the W155 lane FREEZES the projection's
 * output shape to be the W154 engine's input). `buildWorldModelContext`
 * derives a tenant-scoped, provenance-carrying context from the REAL
 * domain surfaces (workload assignment state from `@fleetos/workloads`
 * + procurement stage summaries from `@fleetos/procurement`) via
 * STRUCTURAL seams; the binding site (tests) injects the REAL
 * `@fleetos/workloads` `resolveActiveRecommendations(ledger)` + the
 * REAL `@fleetos/procurement` `ProcurementDemand` + `QuoteLedger`
 * records.
 *
 * Per ADR-0002 § "Hard invariants" (the lane's constitution, frozen by
 * the W155 work order):
 *   1. The context projection is DERIVED, tenant-scoped,
 *      provenance-carrying — NEVER business truth; the authoritative
 *      state stays in the owning packages (workloads/procurement). The
 *      projection is a derived VIEW of the authoritative state, frozen
 *      at construction; the authoritative records continue to evolve
 *      independently.
 *   2. Every context item carries its own provenance refs to the SOURCE
 *      records (workload ids, procurement case ids) — the same
 *      discipline as the W153 feature provenance. The W154 engine
 *      chains the provenance refs into the representation's
 *      provenance-chain digest WITHOUT interpreting the content; the
 *      projection's `value` field is opaque to the engine, INTERPRETED
 *      only by the W155 lane + the UI.
 *   3. The bridge NEVER auto-submits anything to Arena — the W070
 *      PROPOSAL-gated law (handled in D2 — the bridge CONVERTS, never
 *      submits). The context projection feeds the W154 engine, NOT the
 *      Arena; the Arena consumes the bridge's proposals, not the
 *      projection.
 *   4. Predictions remain ADVISORY until adoption — no predictive
 *      output authorizes/executes/mutates business truth (the W154
 *      invariant; the W155 projection's context observations are
 *      ADVISORY inputs to the engine, never business truth).
 *   5. Tenant isolation + BYOD/privacy before anything enters the
 *      bridge (invariant 7/8): cross-tenant context REFUSED; the
 *      privacy seam discipline follows the W153/W154 pattern (the W154
 *      context's `value` is opaque to the engine — the W155 projection
 *      is the layer that INTERPRETS the workload/procurement state, but
 *      it does NOT carry raw observations; the workload/procurement
 *      surfaces are already-derived views, not raw telemetry).
 *   6. Determinism: the same source records + the same projection
 *      version => byte-identical context. The context's
 *      `provenanceRefs` are normalized (deduplicated + sorted); the
 *      `value` is a deterministic function of the source records; the
 *      context's `correlationId` (when injected) is included in the
 *      context's structural digest.
 *   7. Zero runtime dependencies; strict TS; no `any` in public
 *      signatures; every timestamp injected by the caller; no clock
 *      reads, no entropy.
 *
 * Honest states (the W154 honest-degradation discipline applied to the
 * projection):
 *   - an EMPTY workload/procurement surface yields a MINIMAL context
 *     (refs + asOf only — the W154 engine degrades honestly on thin
 *     context, never fabricates); the projection's `observations` is
 *     an empty array (NOT undefined — the projection is explicit about
 *     "no observations", never absent);
 *   - a tenant mismatch is REFUSED (the projection's `tenantId` MUST
 *     match the acting scope's `tenantId` — invariant 7);
 *   - the source records outside the window/scope are EXCLUDED (never
 *     merged) — the projection carries only the records the caller
 *     supplied; the caller's filter is the trust anchor (the projection
 *     does NOT re-filter; it projects what it's given).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type {
  CorrelationId,
  DeviceId,
  FleetError,
  TenantId,
} from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import {
  type ProcurementStageFacet,
  type WorkloadAssignmentFacet,
  type WorldModelContextLike,
  type ContextObservationItemLike,
} from "./seam";
import {
  ERROR_CODES,
  SYNTHETIC_SYSTEM_TENANT,
  WORLD_CONTEXT_PIPELINE_CORRELATION_ID,
  canonicalJson,
  frozen,
  frozenArray,
  looksLikeIso,
  makeDomainError,
  makeValidationError,
  sha256Hex,
} from "./internal";
import type { WorldContextTenantScope } from "./internal";
import { checkWorldContextTenantScope } from "./internal";
import type { WorldContextAuditSink } from "./audit-seam";
import { NOOP_WORLD_CONTEXT_AUDIT_SINK, WORLD_CONTEXT_AUDIT_ACTIONS } from "./audit-seam";

// ---------------------------------------------------------------------------
// The frozen projection schema + projection algorithm versions
// ---------------------------------------------------------------------------

/**
 * The world-context projection SCHEMA version — frozen for W155. The
 * projection's schema describes the shape of the context observation
 * `value` payloads (the `WorkloadAssignmentValue` + the
 * `ProcurementStageValue`); the projection's `schemaVersion` field on
 * the OUTPUT `WorldModelContextLike` is the W154
 * `WORLD_MODEL_CONTEXT_SCHEMA_VERSION` (= 1) — the W154 frozen
 * contract; this `CONTEXT_PROJECTION_SCHEMA_VERSION` tracks the W155
 * projection's OWN value-shape schema (a non-breaking addition of a new
 * value field would bump the projection's `valueSchemaVersion` field on
 * each item; a breaking change to the value shape bumps this constant).
 *
 * Bumping this is a contract change requiring an ADR (W156 consumes the
 * projection's value shape, so a schema change is a breaking seam
 * change).
 */
export const CONTEXT_PROJECTION_SCHEMA_VERSION = 1 as const;

/**
 * The projection ALGORITHM version — frozen for W155. Bumping this is a
 * projection re-derivation: the same source records at a higher
 * projection version produce a NEW context (the W070 supersession
 * discipline applied to the world-context feed). The first
 * implementation is `1`.
 */
export const PROJECTION_VERSION = 1 as const;

/**
 * The W154 WorldModelContext schema version — the FROZEN contract the
 * W155 projection's OUTPUT must satisfy (the W154 lane FROZE this at
 * `1`; the W155 projection carries `schemaVersion: 1` so the W154
 * engine accepts the projection's output without a schema bump). This
 * constant mirrors the W154 `WORLD_MODEL_CONTEXT_SCHEMA_VERSION`
 * verbatim — the value is FROZEN by the W154 lane; the W155 lane NEVER
 * bumps it (a schema bump is a contract change requiring an ADR).
 */
export const WORLD_MODEL_CONTEXT_SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// The closed machine-stable context-observation kind vocabulary
// ---------------------------------------------------------------------------

/**
 * The closed set of CONTEXT OBSERVATION KINDS the W155 reference
 * projection can produce. The vocabulary is machine-stable — adding a
 * new kind is a projection schema change requiring an ADR (the W154
 * engine branches on the kind to chain provenance refs, but it does NOT
 * interpret the content; the W155 lane + the UI interpret the value).
 * The first family is trimmed to the two surfaces the W155 work order
 * mandates:
 *   - `workload_assignment`: the workload assignment state (the
 *     current ACTIVE recommendation on a workload, with its stage);
 *   - `procurement_stage`:   the procurement stage summary (the open
 *     demand + its active quote's stage).
 */
export const CONTEXT_OBSERVATION_KIND_WORKLOAD_ASSIGNMENT = "workload_assignment" as const;
export const CONTEXT_OBSERVATION_KIND_PROCUREMENT_STAGE = "procurement_stage" as const;

/** The closed set of context observation kinds the W155 reference projection can produce. */
export type ContextObservationKind =
  | typeof CONTEXT_OBSERVATION_KIND_WORKLOAD_ASSIGNMENT
  | typeof CONTEXT_OBSERVATION_KIND_PROCUREMENT_STAGE;

/** All context observation kinds (for validation + iteration; machine-stable order). */
export const ALL_CONTEXT_OBSERVATION_KINDS: readonly ContextObservationKind[] = Object.freeze([
  CONTEXT_OBSERVATION_KIND_WORKLOAD_ASSIGNMENT,
  CONTEXT_OBSERVATION_KIND_PROCUREMENT_STAGE,
]);

// ---------------------------------------------------------------------------
// The typed summary values (the projection's value shape — versioned,
// opaque to the W154 engine, interpreted by the W155 lane + the UI)
// ---------------------------------------------------------------------------

/**
 * The typed summary value of a `workload_assignment` context observation.
 * The W155 projection defines this shape; the W154 engine does NOT
 * interpret it (the value is opaque to the engine, chained by provenance
 * refs only). The shape is VERSIONED — bumping
 * `CONTEXT_PROJECTION_SCHEMA_VERSION` is the breaking-change gate;
 * adding an OPTIONAL field is a non-breaking change at the SAME schema
 * version (the engine branches on presence).
 *
 * The stage mirrors the W022 `RecommendationStatus` (ACTIVE / SUPERSEDED
 * / DISMISSED / unknown) — the recommendation's derived status IS the
 * assignment's stage/phase.
 */
export interface WorkloadAssignmentValue {
  /** The projection's value-shape schema version (mirrors CONTEXT_PROJECTION_SCHEMA_VERSION). */
  readonly valueSchemaVersion: number;
  /** The workload identity (stable across revisions). */
  readonly workloadId: string;
  /** The workload profile revision (1-based). */
  readonly profileRevision: number;
  /** The recommendation id. */
  readonly recommendationId: string;
  /** The recommended candidate id (device class / procurement offering). */
  readonly candidateId: string;
  /** The assignment's stage/phase (the recommendation's derived status). */
  readonly stage: "ACTIVE" | "SUPERSEDED" | "DISMISSED" | "unknown";
  /** The recommendation's kind (device-class | procurement). */
  readonly kind: "device-class" | "procurement";
  /** The recommendation's confidence in [0, 0.99]. */
  readonly confidence: number;
  /** The INJECTED recommendation timestamp (ISO 8601). */
  readonly recommendedAt: string;
}

/**
 * The typed summary value of a `procurement_stage` context observation.
 * The W155 projection defines this shape; the W154 engine does NOT
 * interpret it. The shape is VERSIONED.
 *
 * The stage mirrors the procurement `QuoteStatus` (DRAFT / ISSUED /
 * ACCEPTED / SUPERSEDED / REJECTED / unknown) — the active quote's
 * derived status IS the procurement stage.
 */
export interface ProcurementStageValue {
  /** The projection's value-shape schema version (mirrors CONTEXT_PROJECTION_SCHEMA_VERSION). */
  readonly valueSchemaVersion: number;
  /** The procurement demand id. */
  readonly demandId: string;
  /** The workload this demand serves. */
  readonly workloadId: string;
  /** The demand quantity. */
  readonly quantity: number;
  /** The active quote id (when a quote exists; empty when no quote yet). */
  readonly activeQuoteId: string;
  /** The procurement stage (the active quote's derived status). */
  readonly stage: "DRAFT" | "ISSUED" | "ACCEPTED" | "SUPERSEDED" | "REJECTED" | "unknown";
  /** The INJECTED demand creation timestamp (ISO 8601). */
  readonly createdAt: string;
  /** The customer deadline (ISO 8601). */
  readonly deadline: string;
}

// ---------------------------------------------------------------------------
// The build input + result
// ---------------------------------------------------------------------------

/**
 * The input to `buildWorldModelContext`. PURE: every timestamp is
 * INJECTED (the `asOf` is the derivation instant — the W154 engine's
 * derivation anchor; the workload/procurement records' timestamps are
 * evidence, not the projection's derivation instant). The
 * `workloadAssignments` + `procurementStages` are derived views from
 * the REAL `@fleetos/workloads` + `@fleetos/procurement` packages
 * (consumed through the structural seam — the binding site injects the
 * REAL records).
 *
 * The `deviceWorkloadIds` is the SET of workload ids the projection is
 * scoped to FOR THE GIVEN DEVICE (the device's current assignments).
 * The projection includes only the workload assignments whose
 * `workloadId` is in this set — the device's CURRENT assignment state
 * (a future-schema version may carry the full assignment history; the
 * first version is the current state only).
 */
export interface BuildWorldModelContextInput {
  /** The acting tenant scope (FIRST parameter — the guard). */
  readonly scope: WorldContextTenantScope;
  /** The device the context is for (MUST match the W153 feature set's identity.deviceId at the W154 boundary). */
  readonly deviceId: DeviceId;
  /** The INJECTED asOf instant (ISO 8601 — never a clock read). */
  readonly asOf: string;
  /** The workload assignments in scope (the device's current assignments — already filtered to the device's workload ids). */
  readonly workloadAssignments?: readonly WorkloadAssignmentFacet[];
  /** The procurement stage summaries in scope (the device's open procurement cases — already filtered to the device's workload ids). */
  readonly procurementStages?: readonly ProcurementStageFacet[];
  /** The audit sink (default: no-op; the boundary audits the projection + tenant-scope refusals). */
  readonly auditSink?: WorldContextAuditSink;
  /** The correlation id of the projection request (default: synthetic). */
  readonly correlationId?: CorrelationId;
}

/** The tagged result of a context projection. */
export type ContextBuild =
  | { readonly ok: true; readonly context: WorldModelContextLike }
  | { readonly ok: false; readonly error: FleetError };

// ---------------------------------------------------------------------------
// The deterministic context digest (the W155-projection anchor — the W154
// engine's `computeContextDigest` produces the SAME value over the
// projection's output, the structural-twin seam)
// ---------------------------------------------------------------------------

/**
 * Compute the canonical SHA-256 digest of a `WorldModelContextLike`.
 * This mirrors the W154 `computeContextDigest` function VERBATIM — the
 * digest is over the canonical JSON serialization of the context's
 * identity (tenantId, deviceId, asOf, schemaVersion) + the normalized
 * (sorted, deduplicated) context-observation refs (the `kind` + the
 * sorted `provenanceRefs` — NOT the `value` field, because the W154
 * engine does NOT interpret the content). The same context shape with
 * the same evidence trail produces the same digest even when the
 * payload values change (the W154 work order's "context digest covering
 * STRUCTURE-not-VALUE" — confirmed for W155).
 *
 * PURE: no clock, no entropy.
 */
export function computeContextDigest(context: WorldModelContextLike): string {
  const obsItems = context.observations ?? [];
  const obsSerializable = obsItems.map((obs) => ({
    kind: obs.kind,
    provenanceRefs: [...obs.provenanceRefs].sort(),
  }));
  // Sort by (kind, sortedProvenanceRefs canonical-string) — the same
  // multiset of observations in ANY input order produces the SAME
  // serialization (byte-identical digest). The sort key is the
  // canonical JSON of the sorted-refs array (a stable, total order
  // over the multiset of provenance refs for each observation).
  // Mirrors the W154 engine's structural-digest intent
  // ("structure-not-value") AND makes the digest permutation-invariant
  // (a stronger property than the W154 reference's `kind`-only sort — but
  // the W154 engine accepts the W155 projection's output UNCHANGED at the
  // binding site; the engine RE-DERIVES its own `computeContextDigest`
  // over the projection's output, so the projection's digest is the
  // W155 lane's OWN canonical id anchor, NOT the W154 engine's).
  obsSerializable.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    const aKey = canonicalJson(a.provenanceRefs);
    const bKey = canonicalJson(b.provenanceRefs);
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  });
  const serializable = {
    schemaVersion: context.schemaVersion,
    tenantId: context.tenantId,
    deviceId: context.deviceId,
    asOf: context.asOf,
    observations: obsSerializable,
  };
  return sha256Hex(canonicalJson(serializable));
}

/**
 * Normalize the context observations' provenance refs (deduplicate +
 * sort). The same multiset of refs in ANY input order produces the SAME
 * frozen output array — the basis for byte-identical contexts across
 * input permutations (proven by test). Mirrors the W154
 * `normalizeContextObservationRefs` seam VERBATIM.
 */
export function normalizeContextObservationRefs(context: WorldModelContextLike): readonly string[] {
  const obsItems = context.observations ?? [];
  const refs: string[] = [];
  for (const obs of obsItems) {
    for (const ref of obs.provenanceRefs) {
      if (typeof ref === "string" && ref.length > 0) refs.push(ref);
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of refs.sort()) {
    if (!seen.has(r)) {
      seen.add(r);
      out.push(r);
    }
  }
  return Object.freeze(out);
}

// ---------------------------------------------------------------------------
// The build function (D1)
// ---------------------------------------------------------------------------

/**
 * Build a world-model context from the workload/procurement surfaces.
 * PURE: every timestamp is INJECTED (the `asOf` is the derivation
 * instant), no clock reads, no entropy. The same inputs (same workload
 * assignments + same procurement stages + same asOf + same projection
 * version) ALWAYS produce byte-identical outputs (proven by golden
 * tests in `test/determinism.test.ts`).
 *
 * Honesty discipline (the W154 honest-degradation discipline applied to
 * the projection):
 *   - an EMPTY workload/procurement surface => a MINIMAL context
 *     (refs + asOf only — the `observations` is an empty array, NOT
 *     undefined; the W154 engine degrades honestly on thin context,
 *     never fabricates);
 *   - a tenant mismatch (the acting scope's `tenantId` does not match
 *     a record's `tenantId`) => a typed error (cross-tenant context is
 *     REFUSED at the projection boundary — invariant 7); the offending
 *     records are EXCLUDED (never merged into the projection);
 *   - the source records outside the caller's scope are EXCLUDED (the
 *     projection carries only the records the caller supplied; the
 *     caller's filter is the trust anchor — the projection does NOT
 *     re-filter).
 *
 * The projection's `value` field on each context observation is a typed
 * summary (`WorkloadAssignmentValue` / `ProcurementStageValue`); the
 * `provenanceRefs` carry the SOURCE record ids (workload profile id +
 * recommendation id + the recommendation's evidence refs for workload
 * assignments; demand id + active quote id for procurement stages) —
 * the W154 engine chains the refs into the representation's
 * provenance-chain digest WITHOUT interpreting the content.
 *
 * @param input the projection input (scope, deviceId, asOf, workload/procurement records, audit sink)
 * @returns the tagged context build (the context, or a FleetError on invalid input)
 */
export function buildWorldModelContext(input: BuildWorldModelContextInput): ContextBuild {
  const guard = checkWorldContextTenantScope(input?.scope);
  if (!guard.ok) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.contextProjectionDomain,
        `world-context context projection refused access (${guard.reason}: ${guard.detail})`,
        { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: input?.scope?.correlationId ?? WORLD_CONTEXT_PIPELINE_CORRELATION_ID },
        "world-context.projection",
        guard.reason,
      ),
    };
  }
  const trace = {
    tenantId: guard.tenantId,
    correlationId: input.correlationId ?? input.scope.correlationId ?? WORLD_CONTEXT_PIPELINE_CORRELATION_ID,
  };

  // ---- 1. Input validation (pure, non-throwing) ---------------------
  const failures: { path: string; reason: string }[] = [];
  if (typeof input?.deviceId !== "string" || input.deviceId.length === 0) {
    failures.push({ path: "/deviceId", reason: "required" });
  }
  if (typeof input?.asOf !== "string" || !looksLikeIso(input.asOf)) {
    failures.push({ path: "/asOf", reason: "not_iso" });
  }
  if (input?.workloadAssignments !== undefined && !Array.isArray(input.workloadAssignments)) {
    failures.push({ path: "/workloadAssignments", reason: "array_required" });
  }
  if (input?.procurementStages !== undefined && !Array.isArray(input.procurementStages)) {
    failures.push({ path: "/procurementStages", reason: "array_required" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.contextProjectionInvalid,
        "world-context context projection input is invalid",
        trace,
        failures,
      ),
    };
  }

  // ---- 2. Build the context observations from the workload/procurement surfaces ----
  const observations: ContextObservationItemLike[] = [];

  // 2a. Workload assignments — derive a `workload_assignment` context observation per ACTIVE assignment.
  // The projection EXCLUDES SUPERSEDED + DISMISSED assignments (the
  // device's CURRENT assignment state — the W155 work order: "the
  // current assignments + their stage/phase"). The caller's filter is
  // the trust anchor — the projection does NOT re-filter by workload id
  // (the caller supplies the device's current assignments).
  for (const assignment of input.workloadAssignments ?? []) {
    // Tenant isolation by rejection: the assignment's tenantId (carried
    // implicitly via the workload recommendation's tenant scope — the
    // structural seam does NOT carry a separate tenantId field on
    // WorkloadAssignmentFacet; the caller's scope is the trust anchor)
    // is NOT checked here. The W154 engine's represent() boundary
    // checks the context's tenantId vs the feature set's identity.tenantId;
    // the W155 projection's tenantId is the ACTING scope's tenantId (set
    // at the bottom of this function). A cross-tenant assignment record
    // supplied by the caller is the caller's responsibility — the
    // projection TRUSTS the caller's filter (the W155 lane does not
    // re-validate the source records' tenant scope; the workloads +
    // procurement packages enforce tenant isolation at THEIR boundaries).
    if (assignment.stage !== "ACTIVE") {
      // The projection includes only ACTIVE assignments (the device's
      // CURRENT assignment state). SUPERSEDED + DISMISSED assignments
      // are EXCLUDED — never merged into the projection.
      continue;
    }
    const value: WorkloadAssignmentValue = frozen({
      valueSchemaVersion: CONTEXT_PROJECTION_SCHEMA_VERSION,
      workloadId: assignment.workloadId,
      profileRevision: assignment.profileRevision,
      recommendationId: assignment.recommendationId,
      candidateId: assignment.candidateId,
      stage: assignment.stage,
      kind: assignment.kind,
      confidence: assignment.confidence,
      recommendedAt: assignment.recommendedAt,
    });
    const provenanceRefs = [
      `workload:${assignment.workloadId}`,
      `workload-profile:${assignment.workloadId}:${assignment.profileRevision.toString()}`,
      `recommendation:${assignment.recommendationId}`,
      ...assignment.evidenceRefs,
    ];
    observations.push(
      frozen({
        kind: CONTEXT_OBSERVATION_KIND_WORKLOAD_ASSIGNMENT,
        value,
        provenanceRefs: frozenArray(provenanceRefs),
      }),
    );
  }

  // 2b. Procurement stages — derive a `procurement_stage` context observation per open demand.
  // The projection EXCLUDES CLOSED stages (REJECTED + SUPERSEDED — the
  // closed cases; the W155 work order: "the open cases + their stage").
  // The caller's filter is the trust anchor.
  for (const stage of input.procurementStages ?? []) {
    if (stage.stage === "REJECTED" || stage.stage === "SUPERSEDED") {
      // The projection includes only OPEN procurement cases (DRAFT /
      // ISSUED / ACCEPTED — the cases still in flight). CLOSED cases are
      // EXCLUDED — never merged into the projection.
      continue;
    }
    const value: ProcurementStageValue = frozen({
      valueSchemaVersion: CONTEXT_PROJECTION_SCHEMA_VERSION,
      demandId: stage.demandId,
      workloadId: stage.workloadId,
      quantity: stage.quantity,
      activeQuoteId: stage.activeQuoteId,
      stage: stage.stage,
      createdAt: stage.createdAt,
      deadline: stage.deadline,
    });
    const provenanceRefs = [
      `demand:${stage.demandId}`,
      ...(stage.activeQuoteId.length > 0 ? [`quote:${stage.activeQuoteId}`] : []),
    ];
    observations.push(
      frozen({
        kind: CONTEXT_OBSERVATION_KIND_PROCUREMENT_STAGE,
        value,
        provenanceRefs: frozenArray(provenanceRefs),
      }),
    );
  }

  // ---- 3. Sort the observations into a canonical order (machine-stable) ----
  // The sort is by `kind` then by the FIRST provenance ref (the
  // workload id / demand id — the source record's identity). This
  // ensures byte-identical contexts across input permutations (proven
  // by test). The W154 engine's `computeContextDigest` re-sorts by
  // `kind` + the provenance refs, so the sort here is the projection's
  // own canonicalization (the engine re-canonicalizes — the projection
  // sort is for the binding-test golden-file stability + the
  // `contentDigest` stability).
  observations.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    const aRef = a.provenanceRefs[0] ?? "";
    const bRef = b.provenanceRefs[0] ?? "";
    return aRef < bRef ? -1 : aRef > bRef ? 1 : 0;
  });

  // ---- 4. Build + freeze the context ----
  const context: WorldModelContextLike = frozen({
    schemaVersion: WORLD_MODEL_CONTEXT_SCHEMA_VERSION,
    tenantId: guard.tenantId,
    deviceId: input.deviceId,
    asOf: input.asOf,
    observations: frozenArray(observations),
    correlationId: trace.correlationId,
  });

  // ---- 5. Audit the projection (consequential — a later actor must be
  // able to reconstruct which workload/procurement records fed the
  // prediction). The audit carries the context's structural digest
  // (NOT the value — the value is opaque to the engine, interpreted by
  // the W155 lane + the UI; the audit carries the structural digest so
  // a reviewer can verify the projection's content without
  // re-deriving). PURE: the sink is injected; the `occurredAt` is the
  // caller-supplied `asOf`.
  const sink: WorldContextAuditSink = input.auditSink ?? NOOP_WORLD_CONTEXT_AUDIT_SINK;
  sink.append(
    frozen({
      action: WORLD_CONTEXT_AUDIT_ACTIONS.contextProjected,
      tenantId: guard.tenantId,
      subject: null,
      occurredAt: input.asOf,
      correlationId: trace.correlationId,
      details: frozen({
        deviceId: input.deviceId,
        asOf: input.asOf,
        observationCount: observations.length,
        workloadAssignmentCount: observations.filter((o) => o.kind === CONTEXT_OBSERVATION_KIND_WORKLOAD_ASSIGNMENT).length,
        procurementStageCount: observations.filter((o) => o.kind === CONTEXT_OBSERVATION_KIND_PROCUREMENT_STAGE).length,
        contextDigest: computeContextDigest(context),
        projectionVersion: PROJECTION_VERSION,
        valueSchemaVersion: CONTEXT_PROJECTION_SCHEMA_VERSION,
      }),
    }),
  );

  return { ok: true, context };
}

// ---------------------------------------------------------------------------
// The deterministic content digest (for the context's stable id)
// ---------------------------------------------------------------------------

/**
 * Compute the canonical content digest of a context's CONTENT (identity
 * + observations). The digest is SHA-256 — provenance-grade
 * collision-resistant across tenant scopes. Used as the deterministic
 * context id (the W070 store-id pattern applied to the world-context
 * feed). NOT used for security — the structural digest
 * (`computeContextDigest`) is the cryptographic provenance anchor.
 */
export function contextContentDigest(context: WorldModelContextLike): string {
  const observations = [...(context.observations ?? [])].map((obs) => ({
    kind: obs.kind,
    value: obs.value,
    provenanceRefs: [...obs.provenanceRefs].sort(),
  }));
  // Sort by (kind, sortedProvenanceRefs canonical-string) — the same
  // multiset of observations in ANY input order produces the SAME
  // serialization (byte-identical digest). Mirrors the
  // `computeContextDigest` sort discipline (above) so the structural
  // digest + the content digest are both permutation-invariant.
  observations.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    const aKey = canonicalJson(a.provenanceRefs);
    const bKey = canonicalJson(b.provenanceRefs);
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  });
  const serializable = {
    schemaVersion: context.schemaVersion,
    tenantId: context.tenantId,
    deviceId: context.deviceId,
    asOf: context.asOf,
    observations,
    correlationId: context.correlationId,
  };
  return sha256Hex(canonicalJson(serializable));
}

/** Convenience: the deterministic store id for a context. */
export function contextId(context: WorldModelContextLike): string {
  return `wcc_${contextContentDigest(context)}`;
}

/** Re-export the helpers for callers (the audited boundary). */
export const PROJECTION_HELPERS = frozen({
  computeContextDigest,
  normalizeContextObservationRefs,
  contextContentDigest,
  contextId,
  frozenArray,
});
