# FleetOS UX vs Operational Architecture Simulation

STATUS: PRODUCTIZATION ACCEPTANCE SIMULATION — 2026-09-30

## Simulation goal

Validate that the user experience exposes the existing operational architecture without inventing authority, hiding important capabilities, or forcing users to understand internal module names.

Simulation is performed against the frozen architecture, current route vocabulary, existing domain ownership, and the new roleful UX contract.

## Persona 1 — Fleet Administrator

Goal: bring an existing fleet under management and understand fleet health.

Path:

Get started -> Sign in -> Workspace -> Role: Fleet Admin -> Control Tower -> Add devices -> Install Center -> Enroll -> Device list -> Device Doctor

Capabilities surfaced:

- tenant identity;
- device enrollment;
- Device Twin;
- first observation;
- health/diagnosis;
- audit/evidence;
- maintenance/action next steps.

Finding: the current console has destination surfaces but not the real first-run account/workspace/install path.

Required change: add an explicit first-run onboarding rail and a persistent Add devices task.

## Persona 2 — Service Desk

Goal: handle an unhealthy or missing device.

Path:

Role switch -> Control Tower / Operations lens -> Needs attention -> Device Doctor -> Recovery or Maintenance -> Authorization -> Execution -> Verification -> Evidence

Capabilities surfaced:

- health diagnosis;
- treatment proposal;
- maintenance exchange;
- recovery case;
- gated destructive action;
- verification;
- audit.

Finding: the domain flow exists, but this role needs an operations-oriented queue rather than a generic dashboard.

Required change: role-specific Control Tower lens and action-oriented next-step cards.

## Persona 3 — Security & Compliance

Goal: resolve a security finding while preserving evidence.

Path:

Role switch -> Risk lens -> Finding -> Guardian decision -> Approval -> Action plan -> Result -> Verification -> Evidence

Capabilities surfaced:

- security posture;
- Contract Guardian;
- approvals;
- Fleet Action;
- audit/evidence;
- learning/certification.

Finding: current components exist, but role context must explain why actions are blocked or approval-required.

Required change: role-context explanations and role-aware escalation CTAs.

## Persona 4 — Asset / Procurement Manager

Goal: translate a workload need into a usable fleet resource.

Path:

Role switch -> Resources lens -> Workload -> Recommendation -> Software -> Procurement -> Vendor/Quote -> Maintenance -> Connectivity -> Verified outcome

Capabilities surfaced:

- workload profile;
- requirement vector;
- software recommendation;
- procurement exchange;
- vendor matching;
- deadline aggregation;
- connectivity;
- evidence.

Finding: this is the longest cross-domain journey.

Required change: treat it as one visible composite journey rail with persisted position and evidence links at terminal states.

## Persona 5 — Employee / Device Owner

Goal: understand personal device health and request help.

Path:

Role switch -> Personal lens -> My device -> Device Doctor -> Recommended action -> Request approval/help -> Status -> Verification

Capabilities surfaced:

- Device Twin;
- diagnosis;
- request creation;
- security explanation;
- recovery;
- communication.

Finding: an employee should not see an administrator's fleet-wide control surface.

Required change: personal Control Tower lens and strict record filtering.

## Persona 6 — Team Manager

Goal: understand team impact and approve a request.

Path:

Role switch -> Team lens -> Needs attention -> Team request -> Approval -> Outcome -> Evidence

Required change: summarize impact at team/workload level rather than exposing raw device operations.

## Persona 7 — Vendor / Service Operator

Goal: respond to a quote or work order.

Path:

Invited workspace -> Vendor role -> Commerce -> Quote/work order -> Respond -> Fulfillment status -> Evidence

Required change: keep vendor experience scoped to the exchange contracts they participate in.

## Cross-persona findings

### A — role must be visible

Add:

- role switcher;
- active-role label;
- role-specific Control Tower;
- role-specific search context.

### B — role must not become a permission system

Experience profiles are presentation hints only.

Identity + Guardian remain authoritative.

### C — onboarding must be task-led

Add:

- first-run checklist;
- Add devices CTA;
- Install Center;
- first observation confirmation.

### D — long journeys need continuity

Add:

- composite journey rail;
- visible current step;
- evidence on terminal steps;
- no internal package/module names in UI.

### E — same record, different lens

Use shared record identity and evidence lineage, with role-specific summary projections.

### F — mobile navigation cannot become a second product

Use role-filtered primary areas, with a full navigation sheet for secondary areas.

## Operational consistency checks

Every simulated journey must preserve:

- tenant context;
- Device Twin as canonical device representation;
- immutable observation/event semantics;
- versioned interpretation;
- intent lifecycle;
- Guardian authorization;
- approval when required;
- idempotency;
- audit;
- verification;
- provider neutrality;
- Redis non-authoritative rule.

## Browser acceptance scenarios

Add E2E coverage for:

1. create workspace;
2. join workspace;
3. assign multiple roles;
4. switch roles;
5. role-filtered navigation;
6. enroll device;
7. install/first check-in;
8. Device Doctor;
9. security finding -> approval -> verification;
10. workload -> procurement -> verified outcome;
11. employee restricted-action explanation;
12. evidence trail from consequential record;
13. unknown route;
14. mobile navigation;
15. logout/session expiry.

## Simulation verdict

The UX architecture is operationally coherent after adding:

- persistent identity/session;
- role switcher;
- role-shaped Control Tower;
- first-run onboarding;
- Install Center;
- composite journey continuity;
- cross-role restriction explanations.

Any implementation that omits one of these is not ready for the requested product-ready state.
