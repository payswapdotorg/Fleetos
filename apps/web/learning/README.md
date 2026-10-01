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

## W100B — the ROLE LENS + the rationale explanations

W100B adds the role-shaped experience layer with the evaluation-case
rationale and capability-adoption explanations (all W090B
builders/screens unchanged — the lens is additive and optional):

- `src/role-lens.ts` — the frozen role model consumed as a PUBLIC
  EXPERIENCE CONTRACT (spec-conformance proven by
  `test/role-lens.test.ts`); the authority seam (identity's
  `ResolvedPermissions`), the VERBATIM echo and the restricted-
  capability explanations (reason + escalation path).
- `src/learning-role-view.ts` — the role-shaped learning view with the
  RATIONALE layer: every evaluation case explains WHY it carries its
  disposition (the Guardian decision chain — PROPOSED/PARKED/REJECTED
  + the redaction rationale + the ground truth), and every adoption
  explains its basis (the Arena certification ref + suite revision,
  the EXPLICIT HUMAN GRANT, the rollout, the rollback plan and the
  verbatim warnings). The rationales are deterministic derivations
  over the base views' observable fields — identical for every lens
  (domain truth, not role opinion); the lens shapes ONLY the lead
  copy and the spotlight ids.
- `src/screens/role-lens-section.tsx` — the rendered role banner
  (role + home lens + primary question + emphasis + the authority echo
  line + restricted-capability cards).
- `test/role-lens.test.ts`, `test/role-views.test.ts`,
  `test/render-role-lens.test.tsx`, `test/binding-role-lens.test.ts`,
  `test/journey-role-learning.test.tsx` — spec conformance, the
  view-model invariance, the BROWSER authority-invariance over REAL
  W070 records, the REAL identity bindings and the two-persona
  journeys (security.compliance + employee).
