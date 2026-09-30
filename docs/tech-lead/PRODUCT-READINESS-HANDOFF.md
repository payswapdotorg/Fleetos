# FleetOS Product-Readiness Handoff

STATUS: READY FOR NEXT TECH LEAD / ORCHESTRATOR

## Objective

Turn the current W001-W092 implementation into a stage where all three statements are true for a non-commercial staging/demo environment:

1. "I can install and use FleetOS."
2. "FleetOS is deployed on the documented free-tier staging stack."
3. "FleetOS has a solid, roleful, user-friendly interface that exposes the product's capabilities."

## Source of truth

- target integration branch: integration/wave0
- preparation branch: integration/product-readiness
- architecture: FROZEN v1.0
- worker limit: exactly 3
- current accepted base: W090A/B/C + W091 + W092
- do not trust historical documentation over the current repository tree and acceptance gates.

## Read before dispatch

1. AGENTS.md
2. spec/ARCHITECTURE.md
3. spec/ARCHITECTURE-LOCK.md
4. spec/MODULE-DEPENDENCY-MAP.md
5. spec/WORK-ITEM-DEPENDENCY-GRAPH.md
6. spec/work-items/WORK-ITEM-CATALOG.md
7. spec/worker-ownership.yaml
8. docs/tech-lead/merge-gates.md
9. spec/ui/CONSOLE-DESIGN.md
10. spec/ui/ROLEFUL-UX-ARCHITECTURE.md
11. spec/ui/ROLE-EXPERIENCE-MATRIX.yaml
12. spec/install/INSTALL-AND-ENROLLMENT-CONTRACT.md
13. docs/tech-lead/PRODUCT-READINESS-AUDIT.md
14. docs/tech-lead/UX-OPERATIONAL-SIMULATION.md
15. docs/tech-lead/FREE-TIER-PROVIDER-MATRIX.md
16. docs/tech-lead/PRODUCT-READINESS-HANDOFF.md

## Product shape

FleetOS is not just a backend.

The product is:

user/workspace -> role lens -> Control Tower -> domain journeys -> agent/connectors -> verified outcomes -> evidence -> learning

The same tenant and records must support several user roles with different interfaces.

## Wave 9 — three-worker parallel implementation

### W100A [Worker A] — Installable agent + real enrollment

Scope:

- apps/agent/
- packages/device-adapters/
- packages/recovery/
- packages/integrations/adcos/
- apps/web/device/
- apps/web/recovery/
- agent release packaging inside A-owned paths
- install/enrollment browser tests

Implement:

- reproducible Windows/macOS/Linux agent artifacts;
- version/checksum/release metadata;
- enrollment-request flow;
- one-time bootstrap code/token exchange;
- first check-in;
- first observation;
- Device Twin confirmation;
- installer health/status in the web UI;
- revoke/uninstall state;
- BYOD/corporate-owned scope;
- fail-closed enrollment refusal states.

Do not:

- add provider credentials to installers;
- mutate domain authority from the UI;
- create a second authorization system.

### W100B [Worker B] — Role-shaped security/action/learning experiences

Scope:

- packages/security/
- packages/policy/
- packages/actions/
- packages/learning/
- packages/integrations/arena/
- apps/web/security/
- apps/web/actions/
- apps/web/learning/

Implement:

- role-aware projections for Security/Compliance, Service Desk, Manager and Employee lenses;
- clear policy/Guardian explanations;
- approval queue that explains why an action is parked;
- Fleet Action and Print experiences with role-specific emphasis;
- evidence-first security flows;
- learning/adoption explanations;
- cross-role restricted-action copy and escalation affordances;
- browser tests proving role-aware presentation never changes authority.

Consume the role model as a public experience contract; do not change tenant/identity ownership from this lane.

### W100C [Worker C] — Durable identity, sessions, role switching + resource/commercial experiences

Scope:

- packages/identity/
- packages/audit/
- packages/workloads/
- packages/vendors/
- packages/procurement/
- packages/software/
- packages/maintenance/
- packages/integrations/aurum/
- NEW packages/integrations/apify/
- apps/web/workloads/
- apps/web/commerce/

Implement:

- persistent user/principal/session records over Neon;
- workspace/tenant create/join lifecycle;
- role assignment persistence;
- active-role session semantics;
- auditable role switching;
- role-aware workload/commerce projections;
- full workload -> software -> procurement -> vendor -> maintenance/connectivity journey;
- optional Apify enrichment adapter for vendor/catalog discovery;
- explicit provider-unavailable state when Apify is absent or budget-exhausted.

Apify output must be proposal/enrichment data only; never authoritative inventory, price, policy or fulfillment truth.

## Wave 10 — Tech Lead convergence

### W101 [TL] — Product shell + auth/onboarding composition

Implement:

- sign-in/session composition;
- workspace creation/join;
- first-run onboarding rail;
- active-role switcher;
- role-shaped Control Tower;
- Install Center route;
- notifications/approval inbox;
- role-aware global search result context;
- route guards;
- employee/vendor restricted surfaces;
- mobile role-aware navigation;
- session expiry/recovery UX.

The shell remains composition-only. Business truth stays in application/domain packages.

### W102 [TL] — Durable staging + free-tier deployment

Bind:

- Neon durable schema/migrations;
- Upstash transient coordination;
- R2 evidence/artifacts/install metadata;
- optional Apify;
- optional Resend;
- staging secrets and environment separation;
- CI agent artifact build;
- Vercel deployment;
- health/credential-leak checks;
- deployment manifest;
- W080 release gate;
- reproducible staging seed data.

Staging must expose a clearly labeled demo/staging environment and must never masquerade as commercial production.

### W103 [TL] — UX simulation, browser acceptance and release

Run:

- all personas in docs/tech-lead/UX-OPERATIONAL-SIMULATION.md;
- desktop and mobile navigation checks;
- role switching;
- multi-role same-user continuity;
- device installation;
- first check-in;
- Device Doctor;
- security approval;
- procurement/commercial flow;
- employee restrictions;
- evidence trails;
- session expiry;
- tenant isolation;
- no-credential-leak check.

Any simulation finding that contradicts the operational architecture becomes a tracked work item before release.

## Parallelization rule

Only W100A/W100B/W100C may run concurrently.

W101 starts after all three worker lanes are accepted.

W102 may run in parallel with late W101 hardening only when the TL records the exact file scopes and no deployment gate is bypassed.

W103 is the final acceptance item.

## Drift controls

Every worker must:

- read the frozen architecture and relevant UX contracts before implementation;
- stay inside its ownership paths;
- consume public domain contracts instead of importing internals;
- preserve tenant scoping;
- add tests at the seam between worker-owned UI and domain records;
- record implementation judgment calls in docs/tech-lead/SKELETON-NOTES.md;
- never change a shared contract without a TL-owned ADR.

The TL must reject:

- duplicated business logic in React;
- role-based permission hacks in UI code;
- provider SDKs in domain packages;
- hidden admin backdoors;
- fake success states;
- demo data presented as customer data;
- provider credentials in browser or agent bundles;
- role switching that changes tenant context;
- actions that bypass Guardian/authorization.

## Definition of YES to all three

### YES #1 — install and use

A fresh browser user can sign in, create/join a workspace, choose multiple roles, add a device, install the agent, complete enrollment, see the device's first observation and perform at least one safe workflow through the console.

### YES #2 — free-tier staging

The deployed staging stack is reproducible from repository instructions using:

- Vercel Hobby;
- Neon Free;
- Upstash Redis Free;
- Cloudflare R2 Free;
- optional Apify Free;
- optional Resend Free.

Any paid/commercial requirement is explicitly labeled rather than hidden.

### YES #3 — solid frontend

A human can discover the product without knowing its package/module structure, switch roles, complete the major journeys, understand why something is allowed/blocked/approval-required, and follow evidence to the verified outcome.

## Final release evidence

The TL must publish one integration/acceptance commit containing:

- current project state;
- provider matrix;
- install guide;
- role UX contract;
- simulation results;
- E2E journey evidence;
- test/typecheck/architecture/ownership/contract results;
- deployment manifest;
- staging URL;
- artifact release references;
- explicit three-question YES checklist.
