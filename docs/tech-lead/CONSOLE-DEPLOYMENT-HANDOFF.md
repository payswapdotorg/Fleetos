# STATUS: W092 HISTORICAL HANDOFF — SUPERSEDED FOR CURRENT WORK BY docs/tech-lead/PRODUCT-READINESS-HANDOFF.md

# FleetOS Console + Deployment Handoff

## Incoming objective

Continue from the completed W080 engineering roadmap and turn the accepted domain/UI contracts into a real, navigable FleetOS application.

The architecture remains FROZEN v1.0.

The current gap is product emergence, not core domain design.

## Source of truth

The current implementation checkpoint is:

- branch: `integration/wave0`
- W080 delivery tip: `503f6e6`
- reported verification at W080: 2641 tests passed, 0 failed; typecheck 0; architecture/ownership/contract checks green; 23 packages; 150-contract snapshot unchanged.

The repository itself remains authoritative; this handoff is a plan/acceptance overlay, not a replacement for the frozen architecture.

## What the current UI code really is

W060A/B/C and W061 are accepted **UI contracts, view-models, permissions, journeys and discoverability logic**.

They are not a rendered browser application.

`apps/web/README.md` still describes `@fleetos/web` as a placeholder and explicitly says there is no Next.js scaffolding yet.

Therefore the next phase must create the actual web runtime.

## Design direction

Use the ShareNet application in `pectoraux/ShareNet` as the interaction-quality reference:

- persistent sidebar;
- concise route vocabulary;
- calm typography;
- generous whitespace;
- subtle semantic status colors;
- drawers/sheets for details;
- responsive mobile navigation;
- clear loading/empty/error states;
- progressive disclosure of technical detail.

FleetOS remains visually and semantically distinct.

The implementation contract is in `spec/ui/CONSOLE-DESIGN.md`.

## Simulated journey gaps

The simulation found these missing or incomplete discoverability paths:

1. existing-fleet enrollment/onboarding;
2. maintenance journey terminal verification;
3. full lost-device recovery journey;
4. complete workload -> software -> procurement -> connectivity outcome journey;
5. dedicated Fleet Action journey;
6. dedicated Print journey;
7. Evidence & Audit as a first-class area;
8. Learning/Arena as a first-class area;
9. Policies as a first-class area;
10. global browser-level search landing directly on records/capabilities.

The current four W061 journeys are retained but must be upgraded from descriptive route graphs into fully rendered, testable journeys.

## New post-roadmap execution plan

### Wave 8 — parallel implementation

- **W090A [A]** — rendered Device/Recovery/Enrollment UI
- **W090B [B]** — rendered Security/Policies/Actions/Learning UI
- **W090C [C]** — rendered Workload/Commerce UI

All three workers:
- consume the accepted W060 contracts;
- add real React rendering inside their owned UI packages;
- preserve the existing read-only/authority boundaries;
- add browser-facing interaction tests;
- add exact empty/loading/error/blocked/approval states;
- do not introduce provider SDK dependencies.

### W091 [TL] — rendered Control Tower convergence

The Tech Lead owns:
- Next.js runtime;
- root application layout;
- Control Tower;
- global navigation/search;
- breadcrumbs;
- shared design tokens;
- responsive behavior;
- Evidence & Audit route;
- cross-surface journey composition;
- onboarding entry point;
- final route vocabulary;
- browser-level E2E journey harness.

### W092 [TL] — free-tier deployment binding

Implement:
- Vercel/Next.js deployment;
- Neon PostgreSQL binding;
- Upstash Redis binding;
- R2 binding;
- environment separation;
- deployment manifest generation;
- release-gate invocation;
- staging deployment;
- CI build step;
- post-deploy health/evidence checks.

The free-tier environment is for non-commercial staging/demo because Vercel Hobby is restricted to personal/non-commercial use.

## W090A handoff

Worker A owns:
- device list;
- Device Doctor;
- lifecycle;
- Find My Device;
- recovery cases;
- gated destructive-action presentation;
- device enrollment/onboarding subflow;
- browser tests for these areas.

Required journeys:
- enroll fleet;
- diagnose device;
- recover lost device.

## W090B handoff

Worker B owns:
- Security Doctor;
- findings;
- Guardian/policy views;
- approvals queue;
- Fleet Actions;
- Print;
- Learning/Arena views;
- browser tests for proposals, approvals, blocks, execution and verification.

Required journeys:
- remediate finding;
- approve/execute/verify action;
- print workflow;
- inspect learning/certification.

## W090C handoff

Worker C owns:
- workload planning;
- recommendations;
- procurement;
- software;
- vendors;
- maintenance;
- connectivity;
- communication/Aurum outcome;
- browser tests for commerce/resource journeys.

Required journeys:
- workload -> software -> procurement -> connectivity;
- maintenance exchange;
- vendor/quote flow.

## TL acceptance for W091

The shell is accepted only when:
- all architecture-level capabilities are reachable from the console or global search;
- no capability exists only under an internal package name;
- every consequential state visibly communicates authorization status;
- evidence is reachable from consequential records;
- mobile navigation remains complete;
- unknown routes fail safely;
- the four existing W061 journey contracts are expanded to cover the complete user journeys;
- enrollment, Fleet Actions, Print, Evidence/Audit, Policies and Learning have explicit discoverable entry points.

## TL acceptance for W092

Deployment is accepted only when:
- staging deploys from the designated integration branch;
- Neon is the authoritative business store;
- Redis is only cache/queue/lock;
- R2 stores only artifacts/evidence;
- browser bundles contain no provider credentials;
- migration/release gates pass;
- post-deploy health is healthy;
- representative journeys emit E2E evidence;
- deployment is reproducible from the repository.

## Stop-the-line conditions

- a worker moves business truth into React state;
- a UI surface bypasses Guardian/authorization;
- a provider SDK appears in a domain package;
- a rendered action can execute without the accepted intent/policy path;
- tenant context is not established at the server boundary;
- evidence cannot connect a consequential action to its authorization and verification;
- Vercel Hobby is presented as a commercial production deployment;
- a deployment succeeds without the W080 release gate evidence.
