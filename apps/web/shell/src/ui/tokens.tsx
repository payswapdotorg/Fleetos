/**
 * @fleetos/web-shell — the SHARED console design tokens (W091 [TL]).
 *
 * The binding design contract is `spec/ui/CONSOLE-DESIGN.md`. The lane
 * packages (W090A/B/C) each ship a LOCAL copy of the same token
 * vocabulary for their own screens; W091 consolidates the CANONICAL
 * copy here and extends it with the APP CHROME vocabulary the shell
 * owns: the persistent sidebar, the top bar with global search, the
 * content header with breadcrumbs, the responsive mobile navigation
 * (compact top bar + bottom navigation for the highest-frequency
 * areas + sheets for secondary navigation), and the command palette.
 *
 * The token VALUES are identical to the lanes' local copies (same
 * warm-neutral foundation, hairlines, restrained semantic accents) so
 * lane screens and shell chrome render as one system. This file is the
 * canonical source; the lanes' copies remain frozen in place (their
 * tests own them).
 *
 * The stylesheet is a FROZEN template literal rendered verbatim by
 * `<ConsoleStyles />` inside a `<style>` element: deterministic,
 * byte-identical for every render, and inspectable by tests (the
 * reduced-motion rule and the token declarations are asserted by the
 * browser-facing test suite).
 */
import type { JSX } from "react";

/** The frozen console stylesheet (shared tokens + app chrome). */
export const CONSOLE_CSS: string = `/* FleetOS console — shared design tokens + app chrome (spec/ui/CONSOLE-DESIGN.md) */
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
.fos-scope a:focus-visible,
.fos-scope [tabindex]:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}

/* ---- App chrome: the application frame ---- */
.fos-app { display: flex; min-height: 100vh; background: var(--surface); }
.fos-sidebar { width: 15.5rem; flex: none; border-right: 1px solid var(--hairline); background: var(--surface-raised); display: flex; flex-direction: column; gap: 0.25rem; padding: 1rem 0.75rem; position: sticky; top: 0; max-height: 100vh; overflow-y: auto; }
.fos-sidebar__brand { display: flex; flex-direction: column; gap: 0.1rem; padding: 0.35rem 0.6rem 0.9rem; }
.fos-sidebar__brand-name { font-size: 0.9375rem; font-weight: 700; letter-spacing: 0.01em; }
.fos-sidebar__brand-sub { font-size: 0.75rem; color: var(--text-muted); }
.fos-sidebar__group { display: flex; flex-direction: column; gap: 0.1rem; margin-top: 0.4rem; }
.fos-sidebar__group-label { font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); padding: 0.3rem 0.6rem 0.15rem; }
.fos-sidebar__link { display: flex; align-items: center; gap: 0.5rem; font: inherit; font-size: 0.875rem; padding: 0.42rem 0.6rem; min-height: 2.25rem; border: none; background: none; border-radius: var(--radius-sm); cursor: pointer; color: var(--text-secondary); text-align: left; text-decoration: none; }
.fos-sidebar__link:hover { background: var(--surface-sunken); color: var(--text-primary); }
.fos-sidebar__link[aria-current="page"] { background: var(--surface-sunken); color: var(--text-primary); font-weight: 600; box-shadow: inset 2px 0 0 var(--accent); }
.fos-sidebar__link--disabled { cursor: not-allowed; opacity: 0.55; }
.fos-sidebar__footer { margin-top: auto; padding: 0.75rem 0.6rem 0.25rem; border-top: 1px solid var(--hairline); font-size: 0.75rem; color: var(--text-muted); display: flex; flex-direction: column; gap: 0.15rem; }

.fos-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.fos-topbar { display: flex; align-items: center; gap: 0.75rem; padding: 0.6rem 1.25rem; border-bottom: 1px solid var(--hairline); background: var(--surface-raised); position: sticky; top: 0; z-index: 20; }
.fos-topbar__title { font-size: 0.9375rem; font-weight: 600; margin: 0; }
.fos-topbar__ident { display: flex; align-items: center; gap: 0.5rem; font-size: 0.8125rem; color: var(--text-secondary); }
.fos-topbar__ident-dot { width: 0.45rem; height: 0.45rem; border-radius: 50%; background: var(--status-healthy); flex: none; }
.fos-search-trigger { flex: 1 1 auto; max-width: 26rem; display: flex; align-items: center; gap: 0.5rem; font: inherit; font-size: 0.875rem; color: var(--text-muted); background: var(--surface-sunken); border: 1px solid var(--hairline-strong); border-radius: var(--radius-sm); padding: 0.45rem 0.7rem; min-height: 2.25rem; cursor: pointer; text-align: left; }
.fos-search-trigger:hover { border-color: var(--text-muted); }
.fos-search-trigger kbd { margin-left: auto; font-family: var(--mono); font-size: 0.6875rem; background: var(--surface-raised); border: 1px solid var(--hairline-strong); border-radius: 3px; padding: 0.05rem 0.3rem; color: var(--text-secondary); }

.fos-content { flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; }
.fos-content-header { display: flex; flex-direction: column; gap: 0.35rem; padding: 1rem 1.5rem 0.5rem; }
.fos-content-header h1 { margin: 0; font-size: 1.25rem; font-weight: 600; letter-spacing: -0.01em; }
.fos-content-header__sub { margin: 0; color: var(--text-secondary); font-size: 0.875rem; }
.fos-content-body { padding: 0.75rem 1.5rem 2rem; display: flex; flex-direction: column; gap: 1.25rem; min-width: 0; }

.fos-breadcrumb { font-size: 0.8125rem; color: var(--text-secondary); }
.fos-breadcrumb ol { list-style: none; display: flex; flex-wrap: wrap; gap: 0.35rem; margin: 0; padding: 0; }
.fos-breadcrumb li { display: flex; gap: 0.35rem; align-items: center; }
.fos-breadcrumb [aria-current="page"] { color: var(--text-primary); font-weight: 500; }

/* ---- Command palette (global search) ---- */
.fos-cmd-scrim { position: fixed; inset: 0; background: rgba(45, 42, 38, 0.32); display: flex; align-items: flex-start; justify-content: center; padding: 8vh 1rem 1rem; z-index: 50; }
.fos-cmd { width: min(34rem, 100%); background: var(--surface-raised); border: 1px solid var(--hairline-strong); border-radius: var(--radius); box-shadow: 0 12px 32px rgba(45, 42, 38, 0.18); display: flex; flex-direction: column; overflow: hidden; }
.fos-cmd__input { font: inherit; font-size: 1rem; padding: 0.85rem 1rem; border: none; border-bottom: 1px solid var(--hairline); background: transparent; color: var(--text-primary); width: 100%; }
.fos-cmd__input:focus { outline: none; }
.fos-cmd__list { list-style: none; margin: 0; padding: 0.35rem; max-height: 18rem; overflow-y: auto; display: flex; flex-direction: column; gap: 0.1rem; }
.fos-cmd__group { font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); padding: 0.4rem 0.6rem 0.15rem; }
.fos-cmd__item { display: flex; flex-direction: column; gap: 0.1rem; font: inherit; font-size: 0.875rem; text-align: left; padding: 0.5rem 0.6rem; min-height: 2.4rem; background: none; border: none; border-radius: var(--radius-sm); cursor: pointer; color: var(--text-primary); }
.fos-cmd__item:hover, .fos-cmd__item[data-active="true"] { background: var(--surface-sunken); }
.fos-cmd__item-title { display: flex; align-items: center; gap: 0.5rem; font-weight: 500; }
.fos-cmd__item-title .fos-badge { flex: none; }
.fos-cmd__item-sub { font-size: 0.75rem; color: var(--text-secondary); }
.fos-cmd__empty { padding: 1rem 0.75rem 1.1rem; color: var(--text-secondary); font-size: 0.875rem; }
.fos-cmd__hint { padding: 0.5rem 0.75rem; border-top: 1px solid var(--hairline); font-size: 0.75rem; color: var(--text-muted); }

/* ---- Shared component vocabulary (shell chrome) ---- */
.fos-screen { display: flex; flex-direction: column; gap: 1.25rem; min-width: 0; }
.fos-stack { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
.fos-row { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; }
.fos-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); }
.fos-spread { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
.fos-meta { color: var(--text-secondary); font-size: 0.8125rem; }
.fos-mono { font-family: var(--mono); font-size: 0.8125rem; overflow-wrap: anywhere; }

.fos-card { background: var(--surface-raised); border: 1px solid var(--hairline); border-radius: var(--radius); box-shadow: var(--shadow); padding: 1.25rem; min-width: 0; }
.fos-card-title { margin: 0 0 0.75rem; font-size: 1rem; font-weight: 600; }
.fos-card-subtitle { margin: 0 0 0.75rem; color: var(--text-secondary); font-size: 0.8125rem; }

.fos-btn { display: inline-flex; align-items: center; gap: 0.4rem; font: inherit; font-size: 0.875rem; font-weight: 500; padding: 0.5rem 0.9rem; min-height: 2.25rem; border-radius: var(--radius-sm); border: 1px solid transparent; cursor: pointer; background: transparent; color: var(--text-primary); transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease; }
.fos-btn:disabled { cursor: not-allowed; opacity: 0.55; }
.fos-btn--primary { background: var(--accent); color: var(--accent-contrast); }
.fos-btn--primary:hover:enabled { background: var(--accent-hover); }
.fos-btn--secondary { background: var(--surface-raised); border-color: var(--hairline-strong); }
.fos-btn--secondary:hover:enabled { background: var(--surface-sunken); }
.fos-btn--ghost:hover:enabled { background: var(--surface-sunken); }

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

.fos-table-wrap { overflow-x: auto; border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-raised); }
.fos-table { border-collapse: collapse; width: 100%; font-size: 0.875rem; }
.fos-table caption { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.fos-table th, .fos-table td { text-align: left; padding: 0.6rem 0.85rem; border-bottom: 1px solid var(--hairline); vertical-align: top; }
.fos-table thead th { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-secondary); background: var(--surface-sunken); position: sticky; top: 0; }
.fos-table tbody tr:last-child td { border-bottom: none; }
.fos-linklike { font: inherit; font-size: 0.875rem; color: var(--text-primary); background: none; border: none; padding: 0; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.fos-linklike:hover { color: var(--accent); }

.fos-skeleton { display: flex; flex-direction: column; gap: 0.75rem; }
.fos-skeleton__bar { height: 0.875rem; border-radius: var(--radius-sm); background: linear-gradient(90deg, var(--surface-sunken) 25%, #eceadf 45%, var(--surface-sunken) 65%); background-size: 200% 100%; animation: fos-shimmer 1400ms linear infinite; }
.fos-skeleton__bar--wide { width: 92%; }
.fos-skeleton__bar--mid { width: 64%; }
.fos-skeleton__bar--narrow { width: 36%; }
@keyframes fos-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }

.fos-empty { display: flex; flex-direction: column; align-items: flex-start; gap: 0.6rem; padding: 2rem 1.5rem; border: 1px dashed var(--hairline-strong); border-radius: var(--radius); background: var(--surface-raised); }
.fos-empty__title { margin: 0; font-size: 1rem; font-weight: 600; }
.fos-empty__hint { margin: 0; color: var(--text-secondary); font-size: 0.875rem; max-width: 38rem; }
.fos-alert { display: flex; flex-direction: column; gap: 0.5rem; padding: 1rem 1.25rem; border-radius: var(--radius); border: 1px solid var(--status-blocked); background: #f9f0ef; }
.fos-alert__title { margin: 0; font-weight: 600; font-size: 0.9375rem; }
.fos-alert__message { margin: 0; font-size: 0.875rem; color: var(--text-secondary); }

.fos-timeline { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.fos-timeline li { display: flex; gap: 0.75rem; padding: 0.5rem 0; position: relative; }
.fos-timeline li:not(:last-child)::before { content: ""; position: absolute; left: 0.4375rem; top: 1.6rem; bottom: -0.2rem; width: 1px; background: var(--hairline-strong); }
.fos-timeline__marker { width: 0.875rem; height: 0.875rem; border-radius: 50%; border: 2px solid var(--hairline-strong); background: var(--surface-raised); flex: none; margin-top: 0.2rem; }
.fos-timeline__marker--done { background: var(--status-healthy); border-color: var(--status-healthy); }
.fos-timeline__marker--blocked { background: var(--status-blocked); border-color: var(--status-blocked); }
.fos-timeline__body { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
.fos-timeline__label { font-size: 0.875rem; font-weight: 500; }
.fos-timeline__detail { font-size: 0.8125rem; color: var(--text-secondary); }

.fos-scrim { position: fixed; inset: 0; background: rgba(45, 42, 38, 0.32); display: flex; z-index: 40; }
.fos-scrim--end { justify-content: flex-end; }
.fos-sheet { background: var(--surface-raised); border-left: 1px solid var(--hairline); box-shadow: -4px 0 16px rgba(45, 42, 38, 0.08); width: min(30rem, 100vw); height: 100%; overflow-y: auto; display: flex; flex-direction: column; gap: 1rem; padding: 1.25rem; }
.fos-sheet__header { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.75rem; }
.fos-sheet__title { margin: 0; font-size: 1.0625rem; font-weight: 600; }

/* ---- Mobile navigation ---- */
.fos-mobilebar { display: none; }
.fos-mobilenav { display: none; }
.fos-skip { position: absolute; left: -9999px; }
.fos-skip:focus-visible { position: fixed; top: 0.5rem; left: 0.5rem; z-index: 60; background: var(--accent); color: var(--accent-contrast); padding: 0.5rem 0.8rem; border-radius: var(--radius-sm); }

@media (max-width: 900px) {
  .fos-app { flex-direction: column; }
  .fos-sidebar { display: none; }
  .fos-mobilebar { display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 1rem; border-bottom: 1px solid var(--hairline); background: var(--surface-raised); position: sticky; top: 0; z-index: 20; }
  .fos-mobilebar__brand { font-size: 0.9375rem; font-weight: 700; }
  .fos-mobilebar__menu { font: inherit; font-size: 0.875rem; padding: 0.4rem 0.7rem; min-height: 2.25rem; background: none; border: 1px solid var(--hairline-strong); border-radius: var(--radius-sm); cursor: pointer; }
  .fos-content-header { padding: 0.85rem 1rem 0.4rem; }
  .fos-content-body { padding: 0.6rem 1rem 5.5rem; }
  .fos-mobilenav { display: flex; position: fixed; bottom: 0; left: 0; right: 0; z-index: 30; background: var(--surface-raised); border-top: 1px solid var(--hairline-strong); padding: 0.25rem 0.5rem calc(0.25rem + env(safe-area-inset-bottom)); justify-content: space-around; }
  .fos-mobilenav__link { display: flex; flex-direction: column; align-items: center; gap: 0.12rem; font: inherit; font-size: 0.6875rem; padding: 0.35rem 0.55rem 0.3rem; min-height: 2.75rem; min-width: 3.5rem; background: none; border: none; border-radius: var(--radius-sm); cursor: pointer; color: var(--text-secondary); }
  .fos-mobilenav__link[aria-current="page"] { color: var(--text-primary); font-weight: 600; background: var(--surface-sunken); }
  .fos-mobilenav__link-label { white-space: nowrap; }
  .fos-topbar { position: static; }
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
 * Render the console stylesheet. Mounted once per application root;
 * the content is the frozen `CONSOLE_CSS` constant (byte-identical
 * every render — asserted by the determinism tests).
 */
export function ConsoleStyles(): JSX.Element {
  return <style data-fos-console="shell-tokens">{CONSOLE_CSS}</style>;
}
