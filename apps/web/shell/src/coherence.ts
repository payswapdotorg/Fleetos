/**
 * @fleetos/web-shell — UX coherence (the uniform presentation contract).
 *
 * Every surface record is presented through ONE frozen shape: title,
 * subtitle, status band, tone, and an area-specific empty state. The
 * band -> tone mapping is frozen and total; unknown bands refuse
 * machine-stably (a surface introducing a new band must extend this
 * table through the Tech Lead — the same discipline as the contracts
 * snapshot).
 */
import type { ShellBandedSummary, ShellSurfaceArea } from "./seams";
import { titleFromSlug } from "./internal";

/** The frozen status band union (the coherence vocabulary). */
export type ShellStatusBand = "critical" | "high" | "medium" | "low" | "ok" | "neutral";

/** The presentation tone (rendering hint, frozen mapping). */
export type ShellTone = "alert" | "warning" | "info" | "positive" | "muted";

/** The frozen band -> tone mapping (total over the band union). */
export const BAND_TONE: Readonly<Record<ShellStatusBand, ShellTone>> = {
  critical: "alert",
  high: "warning",
  medium: "info",
  low: "positive",
  ok: "positive",
  neutral: "muted",
};

/** The frozen band severity order (machine-stable ordering key). */
export const BAND_SEVERITY_ORDER: readonly ShellStatusBand[] = [
  "critical",
  "high",
  "medium",
  "low",
  "ok",
  "neutral",
];

/** The uniform presentation shape every surface record renders through. */
export interface ShellPresentation {
  readonly title: string;
  readonly subtitle: string;
  readonly band: ShellStatusBand;
  readonly tone: ShellTone;
}

export type PresentationCheck =
  | { readonly ok: true; readonly presentation: ShellPresentation }
  | { readonly ok: false; readonly reason: "unknown_band" | "blank_title"; readonly band?: string };

/** The frozen per-area empty-state messages (discoverability of "nothing"). */
export const AREA_EMPTY_STATES: Readonly<Record<ShellSurfaceArea, string>> = {
  overview: "No activity yet — surfaces report here as the fleet operates.",
  device: "No devices registered for this tenant yet.",
  recovery: "No recovery cases open — the fleet is where it should be.",
  security: "No security findings recorded for this tenant yet.",
  actions: "No action plans yet — proposals appear here once surfaces draft them.",
  workloads: "No workload plans recorded yet.",
  commerce: "No commerce records yet — procurement and service flows land here.",
};

/** Validate + derive the presentation for a banded summary. Frozen output. */
export function presentationOf(summary: ShellBandedSummary): PresentationCheck {
  if (summary.title.trim().length === 0) {
    return { ok: false, reason: "blank_title" };
  }
  if (!(BAND_SEVERITY_ORDER as readonly string[]).includes(summary.band)) {
    return { ok: false, reason: "unknown_band", band: summary.band };
  }
  const band = summary.band as ShellStatusBand;
  return {
    ok: true,
    presentation: {
      title: summary.title.trim(),
      subtitle: summary.subtitle.trim(),
      band,
      tone: BAND_TONE[band],
    },
  };
}

/** The empty-state message for an area (frozen per-area vocabulary). */
export function emptyStateFor(area: ShellSurfaceArea): string {
  return AREA_EMPTY_STATES[area];
}

/** Machine-stable band ordering comparator (severity desc, then name). */
export function compareBands(a: ShellStatusBand, b: ShellStatusBand): number {
  const ia = (BAND_SEVERITY_ORDER as readonly string[]).indexOf(a);
  const ib = (BAND_SEVERITY_ORDER as readonly string[]).indexOf(b);
  if (ia !== ib) return ia - ib;
  return 0;
}

/**
 * Derive an area's display label (the coherence twin of the navigation
 * label — the shell guarantees one spelling per area everywhere).
 */
export function areaLabel(area: ShellSurfaceArea): string {
  return titleFromSlug(area);
}
