/**
 * @fleetos/web-shell — structural seams to the UI surface lanes.
 *
 * The shell NEVER imports a surface package from src/ (the ownership
 * discipline: src/ imports @fleetos/contracts ONLY). Instead each
 * surface is described by a STRUCTURAL descriptor the real package
 * satisfies; the REAL binding happens in test/ (binding-shell.test.ts)
 * where the actual @fleetos/web-* modules construct descriptors.
 *
 * W091 [TL] — the area vocabulary is frozen at TEN top-level areas per
 * spec/ui/CONSOLE-DESIGN.md (Control Tower, Devices, Recovery,
 * Security, Policies, Fleet Actions, Workloads, Commerce, Evidence &
 * Audit, Learning). The route vocabulary — including the onboarding
 * entry point (device enrollment) and the full Commerce tree — is the
 * W091 "final route vocabulary" deliverable.
 */
import type { TenantId } from "@fleetos/contracts";
import type { ShellTenantScope } from "./internal";

/** The canonical shell surface areas (the Control Tower's sections). */
export type ShellSurfaceArea =
  | "overview"
  | "device"
  | "recovery"
  | "security"
  | "policies"
  | "actions"
  | "workloads"
  | "commerce"
  | "evidence"
  | "learning";

/**
 * A surface descriptor: what a bound surface package contributes to the
 * Control Tower — its module identity, the shell area it serves, the
 * views it exposes (route targets), and the record kinds its view-models
 * present (journey/discoverability hooks).
 */
export interface ShellSurfaceDescriptor {
  /** The module's MODULE_NAME (e.g. "web-device"). Opaque identity. */
  readonly moduleName: string;
  /** The shell area this surface serves. */
  readonly area: ShellSurfaceArea;
  /** View ids this surface exposes (the route vocabulary for the area). */
  readonly views: readonly string[];
  /** Record kinds this surface presents (e.g. "device.doctor"). */
  readonly recordKinds: readonly string[];
}

/**
 * A searchable record summary — the discoverability seam. Structurally
 * satisfied by projections of any surface's view-models.
 */
export interface ShellRecordSummary {
  /** The owning surface area. */
  readonly area: ShellSurfaceArea;
  /** Opaque record identity (machine-stable within the area). */
  readonly recordId: string;
  /** Human-readable title (already derived by the surface). */
  readonly title: string;
  /** Search keywords (lowercase tokens, derived by the surface). */
  readonly keywords: readonly string[];
}

/**
 * A status-band-bearing summary — the coherence seam. Structurally
 * satisfied by projections of any surface's view-models.
 */
export interface ShellBandedSummary extends ShellRecordSummary {
  /** The surface-derived status band (see coherence.ts). */
  readonly band: string;
  /** One-line subtitle (already derived by the surface). */
  readonly subtitle: string;
}

/** A record provider bound at the shell's binding site (test-scope REAL). */
export interface ShellRecordSource {
  /** The tenant scope every read is bound to. */
  readonly scope: ShellTenantScope;
  /** Enumerate searchable summaries (machine-stable order). */
  readonly listSummaries: () => readonly ShellRecordSummary[];
}

/** Structural marker: the identity TenantContext satisfies the scope. */
export type ShellScopeOf<TContext extends { tenantId: TenantId }> = TContext;

// ---------------------------------------------------------------------------
// W091 [TL] — the Evidence & Audit structural seams
// ---------------------------------------------------------------------------

/**
 * An audit-trail record summary — the Evidence & Audit seam.
 * Structurally satisfied by projections of the REAL `@fleetos/audit`
 * AuditRecord (who/what/when/where/outcome + correlation ids). The
 * shell presents observable records ONLY; the append-only/hash-chain
 * truth stays in the domain (never re-derived here).
 */
export interface ShellAuditRecordLike {
  /** Opaque record identity (machine-stable within the tenant). */
  readonly recordId: string;
  /** The acting tenant (fail-closed cross-tenant refusal). */
  readonly tenantId: TenantId;
  /** Who performed the consequential act (opaque principal label). */
  readonly actor: string;
  /** What kind of act (opaque domain label, displayed verbatim). */
  readonly action: string;
  /** When (ISO instant, injected by the caller — never a clock read). */
  readonly at: string;
  /** The outcome label (domain vocabulary, verbatim). */
  readonly outcome: string;
  /** Correlation id to the originating EventEnvelope (opaque). */
  readonly correlationId: string;
  /** Opaque content-addressable evidence refs, presented verbatim. */
  readonly evidenceRefs: readonly string[];
}

/** The evidence-trail chain-verification state (observable, not computed). */
export type ShellAuditChainState =
  | "verified"
  | "tamper_detected"
  | "unknown";

/**
 * An evidence trail step — one consequential stage of a record's life,
 * presented in the order the domain recorded it. The stages follow the
 * UX-JOURNEY-SIMULATION Journey 8 shape: source observation ->
 * diagnosis version -> Guardian decision -> approval -> command ->
 * execution -> verification -> notification/integration outcome.
 */
export interface ShellEvidenceStep {
  /** The stage label (domain vocabulary, verbatim). */
  readonly stage: string;
  /** The acting principal (opaque label). */
  readonly actor: string;
  /** When (ISO instant). */
  readonly at: string;
  /** The outcome label (domain vocabulary, verbatim). */
  readonly outcome: string;
  /** Opaque evidence refs (never interpreted by the shell). */
  readonly evidenceRefs: readonly string[];
  /** The audit record this step projects (opaque id). */
  readonly recordId: string;
}

/** A complete evidence trail for one consequential record. */
export interface ShellEvidenceTrail {
  /** The subject record's opaque identity. */
  readonly subjectId: string;
  /** The subject's human title (derived by the binding site). */
  readonly subjectTitle: string;
  /** The area the subject lives in (navigation back-link). */
  readonly area: ShellSurfaceArea;
  /** The trail steps, earliest first (machine-stable order). */
  readonly steps: readonly ShellEvidenceStep[];
  /** The observable chain-verification state for the whole trail. */
  readonly chainState: ShellAuditChainState;
}
