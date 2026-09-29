# @fleetos/web-learning

The FleetOS Learning/Arena UI surface (W090B, lane B): the pure,
deterministic VIEW-MODELS plus the RENDERED React screens for the
Learning area — evaluation-case submissions, the versioned capability
adoption ledger with certification state, and the outcome observation
feed.

## What this package is

- **View-models** (`src/learning-view.ts`): pure, typed, deterministic
  projections over STRUCTURAL seams (`src/seams.ts`) that the real
  `@fleetos/learning` records satisfy (W070: outcome observations,
  Guardian-gated evaluation-case submission proposals, the append-only
  adoption ledger with the fail-closed certification boundary). The
  real packages are dev-dependencies bound at the binding site and
  proven by test — `src/` imports the shared seam `@fleetos/contracts`
  only.
- **Rendered screens** (`src/screens/learning-screen.tsx`): the
  LearningScreen React component (presentational, fully controlled —
  props in, JSX out; no business truth in React state; no clock, no
  randomness, no I/O).
- **Local console vocabulary** (`src/ui/`): the design tokens
  (`spec/ui/CONSOLE-DESIGN.md`), the nine-state status vocabulary, and
  the local shadcn-style component primitives (plain React + CSS).

## Discipline

- A proposal is NEVER presented as executed; adoption is visible as
  the EXPLICIT human grant (approver id + approved-at instant) over a
  CERTIFIED capability — uncertified model output never becomes action
  permission (the screen discloses this invariant).
- Supersession is first-class: every adoption revision cites the prior
  record it supersedes; the prior is never rewritten.
- Tenant isolation is fail-closed: a cross-tenant record REFUSES the
  whole view build (tagged error, never silently filtered).
- Determinism: the same inputs produce byte-identical views and
  byte-identical static markup.

## Module markers

`MODULE_NAME = "web-learning"`, `MODULE_VERSION = "0.1.0"` (the
workspace placeholder contract).
