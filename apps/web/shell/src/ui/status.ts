/**
 * @fleetos/web-shell — the console STATUS vocabulary (W091 [TL]).
 *
 * `spec/ui/CONSOLE-DESIGN.md` freezes a small, consistent semantic
 * vocabulary: Healthy / Informational / Needs attention / Approval
 * required / Blocked / Running / Succeeded / Failed / Unknown — and
 * requires that "state is not conveyed by color alone" (every
 * indicator carries its text label).
 *
 * This is the SHARED shell mapping: the coherence bands (the W061
 * uniform presentation contract) and the audit chain states project
 * onto the console vocabulary. PURE and DETERMINISTIC. The lanes ship
 * their own local mappers for their domain vocabularies; the shell's
 * copy is the canonical chrome-level mapping.
 *
 * No runtime dependencies. No `any`. Strict TS.
 */
import type { ShellAuditChainState } from "../seams";
import type { ShellStatusBand, ShellTone } from "../coherence";

/** The console status vocabulary (the design contract's nine states). */
export type ConsoleStatus =
  | "healthy"
  | "informational"
  | "needs_attention"
  | "approval_required"
  | "blocked"
  | "running"
  | "succeeded"
  | "failed"
  | "unknown";

/** The frozen status order (machine-stable presentation). */
export const CONSOLE_STATUS_ORDER: readonly ConsoleStatus[] = Object.freeze([
  "healthy",
  "informational",
  "needs_attention",
  "approval_required",
  "blocked",
  "running",
  "succeeded",
  "failed",
  "unknown",
]);

/** Operator-facing labels (never color alone; the label IS the state). */
export const CONSOLE_STATUS_LABEL: Readonly<Record<ConsoleStatus, string>> = Object.freeze({
  healthy: "Healthy",
  informational: "Informational",
  needs_attention: "Needs attention",
  approval_required: "Approval required",
  blocked: "Blocked",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  unknown: "Unknown",
});

/** The coherence band -> console status mapping (frozen, total). */
export const BAND_CONSOLE_STATUS: Readonly<Record<ShellStatusBand, ConsoleStatus>> = Object.freeze({
  critical: "blocked",
  high: "needs_attention",
  medium: "needs_attention",
  low: "healthy",
  ok: "healthy",
  neutral: "informational",
});

/** The audit chain state -> console status mapping (frozen, total). */
export const CHAIN_CONSOLE_STATUS: Readonly<Record<ShellAuditChainState, ConsoleStatus>> =
  Object.freeze({
    verified: "succeeded",
    tamper_detected: "failed",
    unknown: "unknown",
  });

/** Map a coherence band onto the console vocabulary. */
export function bandConsoleStatus(band: ShellStatusBand): ConsoleStatus {
  return BAND_CONSOLE_STATUS[band];
}

/** Map an audit chain state onto the console vocabulary. */
export function chainConsoleStatus(state: ShellAuditChainState): ConsoleStatus {
  return CHAIN_CONSOLE_STATUS[state];
}

/** The tone -> status-dot class mapping (rendering hint, frozen). */
export function statusClass(status: ConsoleStatus): string {
  return `fos-status fos-status--${status}`;
}

/** The operator-facing label for a status (never color alone). */
export function statusLabel(status: ConsoleStatus): string {
  return CONSOLE_STATUS_LABEL[status];
}

/** A coherence tone re-exports for chrome consumers (single spelling). */
export type { ShellTone };
