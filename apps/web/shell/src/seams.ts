/**
 * @fleetos/web-shell — structural seams to the six UI surface lanes.
 *
 * The shell NEVER imports a surface package from src/ (the ownership
 * discipline: src/ imports @fleetos/contracts ONLY). Instead each
 * surface is described by a STRUCTURAL descriptor the real package
 * satisfies; the REAL binding happens in test/ (binding-shell.test.ts)
 * where the actual @fleetos/web-* modules construct descriptors.
 */
import type { TenantId } from "@fleetos/contracts";
import type { ShellTenantScope } from "./internal";

/** The canonical shell surface areas (the Control Tower's sections). */
export type ShellSurfaceArea =
  | "overview"
  | "device"
  | "recovery"
  | "security"
  | "actions"
  | "workloads"
  | "commerce";

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
