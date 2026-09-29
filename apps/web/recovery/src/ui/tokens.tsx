/**
 * @fleetos/web-recovery — the LOCAL console design tokens (W090A).
 *
 * The binding design contract is `spec/ui/CONSOLE-DESIGN.md`:
 *   - CSS variables / design tokens for ALL colors (warm neutral
 *     background, graphite text, hairline borders, restrained semantic
 *     accents, modest radii, NO gradients, NO glassmorphism);
 *   - a small local shadcn-style component vocabulary implemented in
 *     plain React + CSS (no external UI library dependency);
 *   - whitespace carries hierarchy; animation is optional and respects
 *     reduced-motion preferences.
 *
 * Tokens are defined LOCALLY per package — shared token consolidation
 * is W091 Tech-Lead work (the names stay semantic: --surface,
 * --text-primary, --status-attention, ...). The identical vocabulary
 * ships in the device lane's local copy; W091 consolidates.
 *
 * The stylesheet is a FROZEN template literal rendered verbatim by
 * `<ConsoleStyles />` inside a `<style>` element: deterministic,
 * byte-identical for every render, and inspectable by tests (the
 * reduced-motion rule and the token declarations are asserted by the
 * browser-facing test suite).
 */

import type { JSX } from "react";

/** The frozen console stylesheet (design tokens + local vocabulary CSS). */
export const CONSOLE_CSS: string = `/* FleetOS console — local design tokens (spec/ui/CONSOLE-DESIGN.md) */
.fos-scope {
  --surface: #faf8f4;
  --surface-raised: #fffefb;
  --surface-sunken: #f3efe8;
  --text-primary: #2d2a26;
  --text-secondary: #6d675e;
  --text-muted: #8f887f;
  --hairline: #e6e0d6;
  --hairline-strong: #d2c9bb;
  --accent: #4a4238;
  --accent-hover: #3a332b;
  --accent-contrast: #fffefb;
  --status-healthy: #3e7a52;
  --status-informational: #6d675e;
  --status-attention: #a05e2c;
  --status-approval: #8a6d2f;
  --status-blocked: #a14242;
  --status-running: #4a7a72;
  --status-unknown: #8f887f;
  --radius: 6px;
  --radius-sm: 4px;
  --shadow: 0 1px 2px rgba(45, 42, 38, 0.06);
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-family: var(--font);
  color: var(--text-primary);
  background: var(--surface);
  line-height: 1.5;
}
.fos-scope *, .fos-scope *::before, .fos-scope *::after { box-sizing: border-box; }
.fos-scope:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.fos-scope button:focus-visible,
.fos-scope input:focus-visible,
.fos-scope select:focus-visible,
.fos-scope textarea:focus-visible,
.fos-scope a:focus-visible,
.fos-scope [tabindex]:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}

/* Layout */
.fos-screen { display: flex; flex-direction: column; gap: 1.25rem; padding: 1.5rem; min-width: 0; }
.fos-screen-header { display: flex; flex-wrap: wrap; gap: 1rem; align-items: flex-end; justify-content: space-between; }
.fos-screen-title { margin: 0; font-size: 1.375rem; font-weight: 600; letter-spacing: -0.01em; }
.fos-screen-subtitle { margin: 0.25rem 0 0; color: var(--text-secondary); font-size: 0.875rem; }
.fos-stack { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
.fos-row { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; }
.fos-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); }
.fos-spread { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
.fos-meta { color: var(--text-secondary); font-size: 0.8125rem; }
.fos-mono { font-family: var(--mono); font-size: 0.8125rem; }

/* Card */
.fos-card { background: var(--surface-raised); border: 1px solid var(--hairline); border-radius: var(--radius); box-shadow: var(--shadow); padding: 1.25rem; min-width: 0; }
.fos-card-title { margin: 0 0 0.75rem; font-size: 1rem; font-weight: 600; }
.fos-card-subtitle { margin: 0 0 0.75rem; color: var(--text-secondary); font-size: 0.8125rem; }

/* Button */
.fos-btn { display: inline-flex; align-items: center; gap: 0.4rem; font: inherit; font-size: 0.875rem; font-weight: 500; padding: 0.5rem 0.9rem; min-height: 2.25rem; border-radius: var(--radius-sm); border: 1px solid transparent; cursor: pointer; background: transparent; color: var(--text-primary); transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease; }
.fos-btn:disabled { cursor: not-allowed; opacity: 0.55; }
.fos-btn--primary { background: var(--accent); color: var(--accent-contrast); }
.fos-btn--primary:hover:enabled { background: var(--accent-hover); }
.fos-btn--secondary { background: var(--surface-raised); border-color: var(--hairline-strong); }
.fos-btn--secondary:hover:enabled { background: var(--surface-sunken); }
.fos-btn--ghost:hover:enabled { background: var(--surface-sunken); }
.fos-btn--danger { background: var(--surface-raised); border-color: var(--status-blocked); color: var(--status-blocked); }
.fos-btn--danger:hover:enabled { background: #f7ecec; }

/* Badge + status indicator */
.fos-badge { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.75rem; font-weight: 600; letter-spacing: 0.02em; padding: 0.15rem 0.55rem; border-radius: 999px; border: 1px solid var(--hairline-strong); background: var(--surface-raised); color: var(--text-secondary); white-space: nowrap; }
.fos-status { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.8125rem; white-space: nowrap; }
.fos-status__dot { width: 0.5rem; height: 0.5rem; border-radius: 50%; border: 1px solid rgba(45, 42, 38, 0.25); flex: none; }
.fos-status--healthy .fos-status__dot { background: var(--status-healthy); }
.fos-status--informational .fos-status__dot { background: var(--status-informational); }
.fos-status--needs_attention .fos-status__dot { background: var(--status-attention); }
.fos-status--approval_required .fos-status__dot { background: var(--status-approval); }
.fos-status--blocked .fos-status__dot { background: var(--status-blocked); }
.fos-status--running .fos-status__dot { background: var(--status-running); }
.fos-status--succeeded .fos-status__dot { background: var(--status-healthy); }
.fos-status--failed .fos-status__dot { background: var(--status-blocked); }
.fos-status--unknown .fos-status__dot { background: var(--status-unknown); }
.fos-badge--healthy { border-color: var(--status-healthy); color: var(--status-healthy); }
.fos-badge--needs_attention { border-color: var(--status-attention); color: var(--status-attention); }
.fos-badge--approval_required { border-color: var(--status-approval); color: var(--status-approval); }
.fos-badge--blocked { border-color: var(--status-blocked); color: var(--status-blocked); }
.fos-badge--running { border-color: var(--status-running); color: var(--status-running); }
.fos-badge--succeeded { border-color: var(--status-healthy); color: var(--status-healthy); }
.fos-badge--failed { border-color: var(--status-blocked); color: var(--status-blocked); }
.fos-badge--unknown { color: var(--text-secondary); }

/* Table */
.fos-table-wrap { overflow-x: auto; border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-raised); }
.fos-table { border-collapse: collapse; width: 100%; font-size: 0.875rem; }
.fos-table caption { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.fos-table th, .fos-table td { text-align: left; padding: 0.6rem 0.85rem; border-bottom: 1px solid var(--hairline); vertical-align: top; }
.fos-table thead th { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-secondary); background: var(--surface-sunken); position: sticky; top: 0; }
.fos-table tbody tr:last-child td { border-bottom: none; }
.fos-table tbody tr:hover { background: #f8f5ef; }
.fos-th-sort { font: inherit; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-secondary); background: none; border: none; padding: 0; cursor: pointer; display: inline-flex; gap: 0.3rem; align-items: center; }
.fos-linklike { font: inherit; font-size: 0.875rem; color: var(--text-primary); background: none; border: none; padding: 0; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.fos-linklike:hover { color: var(--accent); }

/* Tabs */
.fos-tabs { display: flex; gap: 0.25rem; border-bottom: 1px solid var(--hairline); flex-wrap: wrap; }
.fos-tab { font: inherit; font-size: 0.875rem; font-weight: 500; padding: 0.5rem 0.9rem; min-height: 2.25rem; background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; color: var(--text-secondary); }
.fos-tab:hover:enabled { color: var(--text-primary); background: var(--surface-sunken); }
.fos-tab[aria-selected="true"] { color: var(--text-primary); border-bottom-color: var(--accent); }

/* Sheet + dialog */
.fos-scrim { position: fixed; inset: 0; background: rgba(45, 42, 38, 0.32); display: flex; z-index: 40; }
.fos-scrim--end { justify-content: flex-end; }
.fos-scrim--center { align-items: center; justify-content: center; padding: 1.5rem; }
.fos-sheet { background: var(--surface-raised); border-left: 1px solid var(--hairline); box-shadow: -4px 0 16px rgba(45, 42, 38, 0.08); width: min(30rem, 100vw); height: 100%; overflow-y: auto; display: flex; flex-direction: column; gap: 1rem; padding: 1.25rem; }
.fos-dialog { background: var(--surface-raised); border: 1px solid var(--hairline); border-radius: var(--radius); box-shadow: var(--shadow); width: min(28rem, 100%); max-height: 85vh; overflow-y: auto; display: flex; flex-direction: column; gap: 1rem; padding: 1.25rem; }
.fos-sheet__header, .fos-dialog__header { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.75rem; }
.fos-sheet__title, .fos-dialog__title { margin: 0; font-size: 1.0625rem; font-weight: 600; }

/* Dropdown menu */
.fos-menu { position: relative; display: inline-block; }
.fos-menu__list { position: absolute; margin: 0.25rem 0 0; padding: 0.25rem; list-style: none; background: var(--surface-raised); border: 1px solid var(--hairline-strong); border-radius: var(--radius-sm); box-shadow: var(--shadow); min-width: 12rem; z-index: 30; }
.fos-menu__item { display: block; width: 100%; text-align: left; font: inherit; font-size: 0.875rem; padding: 0.45rem 0.6rem; min-height: 2rem; background: none; border: none; border-radius: var(--radius-sm); cursor: pointer; color: var(--text-primary); }
.fos-menu__item:hover:enabled, .fos-menu__item[data-active="true"] { background: var(--surface-sunken); }

/* Breadcrumb */
.fos-breadcrumb { font-size: 0.8125rem; color: var(--text-secondary); }
.fos-breadcrumb ol { list-style: none; display: flex; flex-wrap: wrap; gap: 0.35rem; margin: 0; padding: 0; }
.fos-breadcrumb li { display: flex; gap: 0.35rem; align-items: center; }
.fos-breadcrumb [aria-current="page"] { color: var(--text-primary); font-weight: 500; }

/* Tooltip (progressive disclosure; CSS-only) */
.fos-tooltip { position: relative; display: inline-flex; }
.fos-tooltip__bubble { position: absolute; bottom: calc(100% + 0.4rem); left: 50%; transform: translateX(-50%); background: var(--text-primary); color: var(--surface-raised); font-size: 0.75rem; padding: 0.3rem 0.55rem; border-radius: var(--radius-sm); white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity 120ms ease; z-index: 30; }
.fos-tooltip:hover .fos-tooltip__bubble, .fos-tooltip:focus-within .fos-tooltip__bubble { opacity: 1; }

/* Skeleton (loading placeholders) */
.fos-skeleton { display: flex; flex-direction: column; gap: 0.75rem; }
.fos-skeleton__bar { height: 0.875rem; border-radius: var(--radius-sm); background: linear-gradient(90deg, var(--surface-sunken) 25%, #eceadf 45%, var(--surface-sunken) 65%); background-size: 200% 100%; animation: fos-shimmer 1400ms linear infinite; }
.fos-skeleton__bar--wide { width: 92%; }
.fos-skeleton__bar--mid { width: 64%; }
.fos-skeleton__bar--narrow { width: 36%; }
@keyframes fos-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }

/* Empty + error states */
.fos-empty { display: flex; flex-direction: column; align-items: flex-start; gap: 0.6rem; padding: 2rem 1.5rem; border: 1px dashed var(--hairline-strong); border-radius: var(--radius); background: var(--surface-raised); }
.fos-empty__title { margin: 0; font-size: 1rem; font-weight: 600; }
.fos-empty__hint { margin: 0; color: var(--text-secondary); font-size: 0.875rem; max-width: 38rem; }
.fos-alert { display: flex; flex-direction: column; gap: 0.5rem; padding: 1rem 1.25rem; border-radius: var(--radius); border: 1px solid var(--status-blocked); background: #f9f0ef; }
.fos-alert__title { margin: 0; font-weight: 600; font-size: 0.9375rem; }
.fos-alert__message { margin: 0; font-size: 0.875rem; color: var(--text-secondary); }
.fos-alert ul { margin: 0; padding-left: 1.1rem; font-size: 0.8125rem; color: var(--text-secondary); }

/* Timeline */
.fos-timeline { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.fos-timeline li { display: flex; gap: 0.75rem; padding: 0.5rem 0; position: relative; }
.fos-timeline li:not(:last-child)::before { content: ""; position: absolute; left: 0.4375rem; top: 1.6rem; bottom: -0.2rem; width: 1px; background: var(--hairline-strong); }
.fos-timeline__marker { width: 0.875rem; height: 0.875rem; border-radius: 50%; border: 2px solid var(--hairline-strong); background: var(--surface-raised); flex: none; margin-top: 0.2rem; }
.fos-timeline__marker--done { background: var(--status-healthy); border-color: var(--status-healthy); }
.fos-timeline__marker--current { background: var(--surface-raised); border-color: var(--accent); }
.fos-timeline__marker--blocked { background: var(--status-blocked); border-color: var(--status-blocked); }
.fos-timeline__body { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
.fos-timeline__label { font-size: 0.875rem; font-weight: 500; }
.fos-timeline__detail { font-size: 0.8125rem; color: var(--text-secondary); }

/* Form fields */
.fos-field { display: flex; flex-direction: column; gap: 0.3rem; min-width: 0; }
.fos-field > label { font-size: 0.8125rem; font-weight: 500; color: var(--text-primary); }
.fos-field > input, .fos-field > select { font: inherit; font-size: 0.875rem; padding: 0.5rem 0.65rem; min-height: 2.25rem; border: 1px solid var(--hairline-strong); border-radius: var(--radius-sm); background: var(--surface-raised); color: var(--text-primary); width: 100%; }
.fos-field > input:hover:enabled, .fos-field > select:hover:enabled { border-color: var(--text-muted); }
.fos-field__hint { font-size: 0.75rem; color: var(--text-muted); }
.fos-field__error { font-size: 0.75rem; color: var(--status-blocked); }
.fos-fieldset { border: 1px solid var(--hairline); border-radius: var(--radius); padding: 0.9rem 1rem 1rem; margin: 0; display: flex; flex-direction: column; gap: 0.75rem; min-width: 0; }
.fos-fieldset > legend { font-size: 0.8125rem; font-weight: 600; padding: 0 0.35rem; }
.fos-chipbar { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.fos-chip { font: inherit; font-size: 0.78rem; padding: 0.28rem 0.65rem; min-height: 1.9rem; border-radius: 999px; border: 1px solid var(--hairline-strong); background: var(--surface-raised); cursor: pointer; color: var(--text-secondary); }
.fos-chip:hover:enabled { background: var(--surface-sunken); }
.fos-chip[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--accent-contrast); }
.fos-check { display: flex; gap: 0.55rem; align-items: flex-start; font-size: 0.875rem; }
.fos-check input { width: 1rem; height: 1rem; margin: 0.2rem 0 0; accent-color: var(--accent); }
.fos-definition { display: grid; grid-template-columns: minmax(9rem, auto) 1fr; gap: 0.35rem 1rem; margin: 0; font-size: 0.875rem; }
.fos-definition dt { color: var(--text-secondary); }
.fos-definition dd { margin: 0; overflow-wrap: anywhere; }

/* Stepper */
.fos-stepper { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.fos-stepper__step { display: inline-flex; align-items: center; gap: 0.45rem; font-size: 0.8125rem; padding: 0.3rem 0.8rem; border-radius: 999px; border: 1px solid var(--hairline-strong); color: var(--text-secondary); background: var(--surface-raised); }
.fos-stepper__step--current { border-color: var(--accent); color: var(--text-primary); font-weight: 600; }
.fos-stepper__step--done { border-color: var(--status-healthy); color: var(--status-healthy); }

/* Responsive: compact stacked layout on narrow viewports. */
@media (max-width: 720px) {
  .fos-screen { padding: 1rem; gap: 1rem; }
  .fos-card { padding: 1rem; }
  .fos-table th, .fos-table td { padding: 0.5rem 0.6rem; font-size: 0.8125rem; }
  .fos-definition { grid-template-columns: 1fr; gap: 0.1rem 0; }
  .fos-definition dt { margin-top: 0.5rem; }
}

/* Reduced motion: all animation/transition is optional and disabled. */
@media (prefers-reduced-motion: reduce) {
  .fos-scope, .fos-scope *, .fos-scope *::before, .fos-scope *::after {
    animation: none !important;
    transition: none !important;
    scroll-behavior: auto !important;
  }
}
`;

/**
 * Render the console stylesheet. Mounted once per surface root; the
 * content is the frozen `CONSOLE_CSS` constant (byte-identical every
 * render — asserted by the determinism tests).
 */
export function ConsoleStyles(): JSX.Element {
  return <style data-fos-console="tokens">{CONSOLE_CSS}</style>;
}
