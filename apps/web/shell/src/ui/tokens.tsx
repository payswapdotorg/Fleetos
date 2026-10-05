/**
 * @fleetos/web-shell — the SHARED console design tokens (W091 [TL]; W120).
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
 * W120 (Stripe-ADAPTED qualities — the language, never the identity):
 * a light cool-neutral foundation with generous whitespace, crisp
 * 8px-radius cards and inputs (6px small radius), subtle gray
 * hairlines with near-flat soft elevation, a grouped light sidebar
 * with an active-item pill, a topbar account area (member chip / role
 * switcher / approvals inbox), the #635BFF indigo accent for primary
 * actions and focus rings, the Inter/system font stack (no webfont
 * load — the stack degrades gracefully), and re-tuned calmer semantic
 * status hues (same nine meanings, same classes).
 *
 * CASCADE NOTE — why the tokens live on `.fos-scope.fos-app` rather
 * than plain `.fos-scope`: the lane-local copies are FROZEN with the
 * previous warm palette and mount their own `<style>` elements later
 * in the document (inside the content area). Equal-specificity
 * selectors resolve by document order, so a plain `.fos-scope` token
 * block here would be overridden by every mounted lane copy and the
 * chrome would silently revert on lane pages. Declaring the tokens at
 * (0,2,0) on the shell root makes the chrome token resolution
 * order-immune, while the lane screens keep their own frozen tokens
 * on their own `.fos-scope` roots (unification is a later wave).
 * Shared component rules (`.fos-btn`, `.fos-badge`, `.fos-breadcrumb`,
 * the layout utilities) keep their rule text stable with the lane
 * copies on purpose: every visual delta flows through the tokens, so
 * the chrome renders the same language on every page regardless of
 * which lane stylesheet is mounted.
 *
 * The stylesheet is a FROZEN template literal rendered verbatim by
 * `<ConsoleStyles />` inside a `<style>` element: deterministic,
 * byte-identical for every render, and inspectable by tests (the
 * reduced-motion rule and the token declarations are asserted by the
 * browser-facing test suite).
 */
import type { JSX } from "react";

/** The frozen console stylesheet (shared tokens + app chrome). */
export const CONSOLE_CSS: string = `/* FleetOS console — shared design tokens + app chrome (spec/ui/CONSOLE-DESIGN.md; W120 Stripe-adapted qualities) */
.fos-scope.fos-app {
  --surface: #f6f8fb;
  --surface-raised: #ffffff;
  --surface-sunken: #eef1f6;
  --text-primary: #1b2032;
  --text-secondary: #5b6478;
  --text-muted: #8a94a6;
  --hairline: #e4e8ee;
  --hairline-strong: #d4dae3;
  --accent: #635bff;
  --accent-hover: #5449d6;
  --accent-contrast: #ffffff;
  --accent-soft: #eeedfe;
  --status-healthy: #0d8050;
  --status-informational: #5f6b81;
  --status-attention: #b05309;
  --status-approval: #8d6a1e;
  --status-blocked: #c23636;
  --status-running: #12718a;
  --status-unknown: #8a94a6;
  --radius: 8px;
  --radius-sm: 6px;
  --shadow: 0 1px 2px rgba(27, 32, 50, 0.06);
  --font: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
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

/* ---- App chrome: the application frame (light, grouped, breathing) ---- */
.fos-app { display: flex; min-height: 100vh; background: var(--surface); }
.fos-sidebar { width: 16rem; flex: none; border-right: 1px solid var(--hairline); background: var(--surface-raised); display: flex; flex-direction: column; gap: 0.25rem; padding: 1.25rem 0.875rem 1rem; position: sticky; top: 0; max-height: 100vh; overflow-y: auto; }
.fos-sidebar__brand { display: flex; flex-direction: column; gap: 0.15rem; padding: 0.25rem 0.65rem 0.35rem; }
.fos-sidebar__brand-name { font-size: 1rem; font-weight: 700; letter-spacing: -0.01em; }
.fos-sidebar__brand-sub { font-size: 0.75rem; color: var(--text-muted); }
.fos-sidebar__group { display: flex; flex-direction: column; gap: 0.125rem; margin-top: 1.1rem; }
.fos-sidebar__group-label { font-size: 0.6875rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); padding: 0 0.65rem 0.35rem; }
.fos-sidebar__link { display: flex; align-items: center; gap: 0.5rem; font: inherit; font-size: 0.875rem; padding: 0.45rem 0.65rem; min-height: 2.25rem; border: none; background: none; border-radius: var(--radius-sm); cursor: pointer; color: var(--text-secondary); text-align: left; text-decoration: none; }
.fos-sidebar__link:hover { background: var(--surface-sunken); color: var(--text-primary); }
.fos-sidebar__link[aria-current="page"] { background: var(--accent-soft); color: var(--text-primary); font-weight: 600; }
.fos-sidebar__link--disabled { cursor: not-allowed; opacity: 0.55; }
.fos-sidebar__footer { margin-top: auto; padding: 0.9rem 0.65rem 0.25rem; border-top: 1px solid var(--hairline); font-size: 0.75rem; color: var(--text-muted); display: flex; flex-direction: column; gap: 0.15rem; }

.fos-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.fos-topbar { display: flex; align-items: center; gap: 1rem; padding: 0.7rem 1.75rem; border-bottom: 1px solid var(--hairline); background: var(--surface-raised); position: sticky; top: 0; z-index: 20; }
.fos-topbar__title { font-size: 0.9375rem; font-weight: 600; margin: 0; }
.fos-topbar__ident { display: flex; align-items: center; gap: 0.5rem; font-size: 0.8125rem; color: var(--text-secondary); }
.fos-topbar__ident-dot { width: 0.45rem; height: 0.45rem; border-radius: 50%; background: var(--status-healthy); flex: none; }
.fos-topbar__chrome { display: flex; align-items: center; gap: 0.6rem; margin-left: auto; padding-left: 1.1rem; border-left: 1px solid var(--hairline); }
.fos-search-trigger { flex: 1 1 auto; max-width: 26rem; display: flex; align-items: center; gap: 0.5rem; font: inherit; font-size: 0.875rem; color: var(--text-muted); background: var(--surface-raised); border: 1px solid var(--hairline-strong); border-radius: var(--radius-sm); padding: 0.45rem 0.75rem; min-height: 2.25rem; cursor: pointer; text-align: left; }
.fos-search-trigger:hover { border-color: var(--text-muted); background: var(--surface); }
.fos-search-trigger kbd { margin-left: auto; font-family: var(--mono); font-size: 0.6875rem; background: var(--surface-sunken); border: 1px solid var(--hairline-strong); border-radius: 3px; padding: 0.05rem 0.3rem; color: var(--text-secondary); }

.fos-content { flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; }
.fos-content-header { display: flex; flex-direction: column; gap: 0.4rem; padding: 1.75rem 2rem 0.75rem; }
.fos-content-header h1, .fos-content-header h2 { margin: 0; font-size: 1.375rem; font-weight: 600; letter-spacing: -0.015em; }
.fos-content-header__sub { margin: 0; color: var(--text-secondary); font-size: 0.875rem; }
.fos-content-body { padding: 0.5rem 2rem 3.25rem; display: flex; flex-direction: column; gap: 1.75rem; min-width: 0; }

.fos-breadcrumb { font-size: 0.8125rem; color: var(--text-secondary); }
.fos-breadcrumb ol { list-style: none; display: flex; flex-wrap: wrap; gap: 0.35rem; margin: 0; padding: 0; }
.fos-breadcrumb li { display: flex; gap: 0.35rem; align-items: center; }
.fos-breadcrumb [aria-current="page"] { color: var(--text-primary); font-weight: 500; }

/* ---- Session chrome: the topbar account area ---- */
.fos-roleswitcher { position: relative; }
.fos-rolechip { font: inherit; display: inline-flex; align-items: center; padding: 0.2rem; border: none; background: none; border-radius: 999px; cursor: pointer; }
.fos-rolechip:hover { background: var(--surface-sunken); }
.fos-rolemenu { position: absolute; right: 0; top: calc(100% + 0.45rem); z-index: 30; min-width: 17rem; margin: 0; padding: 0.5rem; list-style: none; display: flex; flex-direction: column; gap: 0.25rem; background: var(--surface-raised); border: 1px solid var(--hairline); border-radius: var(--radius); box-shadow: 0 4px 12px rgba(27, 32, 50, 0.08), 0 16px 40px rgba(27, 32, 50, 0.14); }
.fos-rolemenu .fos-btn { width: 100%; justify-content: flex-start; }
.fos-role-empty { padding: 0.45rem 0.6rem; font-size: 0.875rem; color: var(--text-secondary); list-style: none; }
.fos-role-note { padding: 0.5rem 0.6rem 0.25rem; margin-top: 0.25rem; font-size: 0.75rem; color: var(--text-muted); border-top: 1px solid var(--hairline); }
.fos-inbox { font: inherit; font-size: 0.875rem; color: var(--text-secondary); display: inline-flex; align-items: center; gap: 0.45rem; padding: 0.35rem 0.6rem; min-height: 2.25rem; background: none; border: none; border-radius: var(--radius-sm); cursor: pointer; }
.fos-inbox:hover { background: var(--surface-sunken); color: var(--text-primary); }
.fos-memberchip { display: inline-flex; align-items: center; gap: 0.7rem; padding: 0.25rem 0.3rem; background: var(--surface-raised); border: 1px solid var(--hairline); border-radius: 999px; box-shadow: var(--shadow); }
.fos-memberchip .fos-btn { padding: 0.3rem 0.75rem; min-height: 2rem; }
.fos-member-avatar { width: 1.9rem; height: 1.9rem; flex: none; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--accent-soft); color: var(--accent); font-size: 0.8125rem; font-weight: 600; }
.fos-member-identity { display: flex; flex-direction: column; line-height: 1.25; min-width: 0; }
.fos-member-identity strong { font-size: 0.8125rem; font-weight: 600; color: var(--text-primary); }
.fos-member-identity span { font-size: 0.75rem; color: var(--text-secondary); }

/* ---- Command palette (global search) ---- */
.fos-cmd-scrim { position: fixed; inset: 0; background: rgba(27, 32, 50, 0.32); display: flex; align-items: flex-start; justify-content: center; padding: 8vh 1rem 1rem; z-index: 50; }
.fos-cmd { width: min(34rem, 100%); background: var(--surface-raised); border: 1px solid var(--hairline); border-radius: var(--radius); box-shadow: 0 4px 12px rgba(27, 32, 50, 0.08), 0 24px 56px rgba(27, 32, 50, 0.16); display: flex; flex-direction: column; overflow: hidden; }
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
.fos-screen { display: flex; flex-direction: column; gap: 1.5rem; min-width: 0; }
.fos-stack { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
.fos-row { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; }
.fos-grid { display: grid; gap: 1.25rem; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); }
.fos-spread { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
.fos-meta { color: var(--text-secondary); font-size: 0.8125rem; }
.fos-mono { font-family: var(--mono); font-size: 0.8125rem; overflow-wrap: anywhere; }

.fos-card { background: var(--surface-raised); border: 1px solid var(--hairline); border-radius: var(--radius); box-shadow: var(--shadow); padding: 1.5rem; min-width: 0; }
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
.fos-status__dot { width: 0.5rem; height: 0.5rem; border-radius: 50%; border: 1px solid rgba(27, 32, 50, 0.2); flex: none; }
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
.fos-table th, .fos-table td { text-align: left; padding: 0.65rem 0.9rem; border-bottom: 1px solid var(--hairline); vertical-align: top; }
.fos-table thead th { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-secondary); background: var(--surface-sunken); position: sticky; top: 0; }
.fos-table tbody tr:last-child td { border-bottom: none; }
.fos-linklike { font: inherit; font-size: 0.875rem; color: var(--text-primary); background: none; border: none; padding: 0; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.fos-linklike:hover { color: var(--accent); }

.fos-skeleton { display: flex; flex-direction: column; gap: 0.75rem; }
.fos-skeleton__bar { height: 0.875rem; border-radius: var(--radius-sm); background: linear-gradient(90deg, var(--surface-sunken) 25%, #e7ebf1 45%, var(--surface-sunken) 65%); background-size: 200% 100%; animation: fos-shimmer 1400ms linear infinite; }
.fos-skeleton__bar--wide { width: 92%; }
.fos-skeleton__bar--mid { width: 64%; }
.fos-skeleton__bar--narrow { width: 36%; }
@keyframes fos-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }

.fos-empty { display: flex; flex-direction: column; align-items: flex-start; gap: 0.6rem; padding: 2.25rem 1.75rem; border: 1px dashed var(--hairline-strong); border-radius: var(--radius); background: var(--surface-raised); }
.fos-empty__title { margin: 0; font-size: 1rem; font-weight: 600; }
.fos-empty__hint { margin: 0; color: var(--text-secondary); font-size: 0.875rem; max-width: 38rem; }
.fos-alert { display: flex; flex-direction: column; gap: 0.5rem; padding: 1rem 1.25rem; border-radius: var(--radius); border: 1px solid var(--status-blocked); background: #fbf1f1; }
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

.fos-scrim { position: fixed; inset: 0; background: rgba(27, 32, 50, 0.32); display: flex; z-index: 40; }
.fos-scrim--end { justify-content: flex-end; }
.fos-sheet { background: var(--surface-raised); border-left: 1px solid var(--hairline); box-shadow: -8px 0 24px rgba(27, 32, 50, 0.1); width: min(30rem, 100vw); height: 100%; overflow-y: auto; display: flex; flex-direction: column; gap: 1.25rem; padding: 1.5rem; }
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
  /* W145 deploy convergence: NO horizontal page scroll at 390x844 — the
     topbar wraps (title + search on one row, the chrome below), the ident
     hides (its workspace/role facts stay visible in the memberchip + role
     switcher), and the memberchip caps so the session chrome can never
     force the page wider than the viewport. */
  .fos-topbar { flex-wrap: wrap; row-gap: 0.4rem; }
  .fos-topbar__ident { display: none; }
  .fos-memberchip { max-width: calc(100vw - 2.5rem); }
  .fos-memberchip .fos-btn { max-width: 100%; }
  .fos-memberchip .fos-badge { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .fos-mobilebar { display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 1rem; border-bottom: 1px solid var(--hairline); background: var(--surface-raised); position: sticky; top: 0; z-index: 20; }
  .fos-mobilebar__brand { font-size: 0.9375rem; font-weight: 700; }
  .fos-mobilebar__menu { font: inherit; font-size: 0.875rem; padding: 0.4rem 0.7rem; min-height: 2.25rem; background: none; border: 1px solid var(--hairline-strong); border-radius: var(--radius-sm); cursor: pointer; }
  .fos-content-header { padding: 1rem 1rem 0.5rem; }
  .fos-content-body { padding: 0.6rem 1rem 5.5rem; gap: 1.25rem; }
  .fos-mobilenav { display: flex; position: fixed; bottom: 0; left: 0; right: 0; z-index: 30; background: var(--surface-raised); border-top: 1px solid var(--hairline-strong); padding: 0.25rem 0.5rem calc(0.25rem + env(safe-area-inset-bottom)); justify-content: space-around; }
  .fos-mobilenav__link { display: flex; flex-direction: column; align-items: center; gap: 0.12rem; font: inherit; font-size: 0.6875rem; padding: 0.35rem 0.55rem 0.3rem; min-height: 2.75rem; min-width: 3.5rem; background: none; border: none; border-radius: var(--radius-sm); cursor: pointer; color: var(--text-secondary); }
  .fos-mobilenav__link[aria-current="page"] { color: var(--text-primary); font-weight: 600; background: var(--accent-soft); }
  .fos-mobilenav__link-label { white-space: nowrap; }
  .fos-topbar { position: static; }
  .fos-topbar__chrome { margin-left: 0; padding-left: 0; border-left: none; flex-wrap: wrap; }
  .fos-rolemenu { right: auto; left: 0; }
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
