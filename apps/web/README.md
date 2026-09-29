# @fleetos/web

The FleetOS console — the Next.js RUNTIME (W091 [TL]).

Composition ONLY, per the binding design contract (`spec/ui/CONSOLE-DESIGN.md` "Data boundary"): authenticate, resolve tenant context, call public application/domain services, shape data for the UI. The business truth stays in the domain packages and their accepted view-models — never in React state.

## Structure

- `app/` — the App Router: the root layout + the single catch-all route that maps every URL onto the shell's frozen route vocabulary (`/{area}/{view}`; the Control Tower at `/`). Unknown paths fail SAFELY inside the console (the machine-stable refusal state, never a crash).
- `src/console-app.tsx` — the client composition root: owns the UI state (current route via the history API, per-screen interaction state) and renders the `@fleetos/web-shell` AppShell + the lane screens over the composed view-models.
- `src/runtime/demo-fleet.ts` — the deterministic binding site: REAL domain packages (device-model, security, policy, actions, audit, learning) composed in-memory into the standing demo data; the shell view-models (Control Tower, Evidence & Audit, search) built over the composed records.
- `src/console-styles.css` — the document shell reset (the AppShell carries the full frozen design system).

## Commands

- `bun run dev` — the console on :3101
- `bun run build` / `bun run start` — the production build (verified: the catch-all route compiles; home/area/unknown paths all serve)
- `bun run typecheck` / `bun test` — the workspace gates

## Ownership

Lane: `tech-lead` (per `spec/worker-ownership.yaml` — `apps/web/` and `apps/web/shell/`).

## Frozen spec source

`spec/ui/CONSOLE-DESIGN.md`; `docs/tech-lead/CONSOLE-DEPLOYMENT-HANDOFF.md` (W091); `spec/ARCHITECTURE-LOCK.md` item 19.

## Runtime binding-site exception

Files under `apps/web/src/` may import PUBLIC `@fleetos/*` package ENTRY POINTS (bare specifiers only — never deep paths, never the adapter/integration lanes). This is the sanctioned composition role recorded in `tools/check-ownership.mjs`; the lane packages' own `src/` keeps the stricter `@fleetos/contracts`-only rule.
