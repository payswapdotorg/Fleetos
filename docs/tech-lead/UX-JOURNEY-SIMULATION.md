# FleetOS UX Journey Simulation

## Simulation basis

This review was performed against the actual `integration/wave0` implementation after W080.

Important finding:

**FleetOS has a user-facing information architecture and UI view-model/interaction layer, but it does not yet have a rendered web console.**

The repository explicitly describes `apps/web` as a placeholder and the W060/W061 packages as pure TypeScript surface/view-model/state-machine modules. There is no Next.js application scaffold, React runtime, rendered route tree, or browser-facing console in the current repository checkpoint.

Therefore the simulation below tests the existing navigation/interaction model as if rendered, and identifies what must be added before a real user can complete these journeys.

## Current shell vocabulary

The W061 shell currently exposes:

- Overview: home, activity
- Device: list, doctor, lifecycle
- Recovery: cases, find-my, destructive
- Security: findings, decisions, approvals
- Actions: plans, print
- Workloads: planning, recommendations
- Commerce: procurement, maintenance, connectivity, communication

The shell also has deterministic search, breadcrumbs, permissions and four built-in cross-surface journey descriptors.

## Journey 1 — Enroll an existing fleet

### Intended user

IT/fleet operator with an existing customer-owned fleet.

### Simulation

Control Tower -> Devices -> fleet list -> look for an "Add/Enroll" action.

### Finding

**Gap.** The architecture requires independently enrolled fleets, but the current shell has no explicit enrollment/onboarding journey.

### Required change

Add a clear "Enroll devices" entry point from Control Tower and Devices.

The onboarding experience should guide:
1. choose device class;
2. install/use the appropriate agent or connector;
3. verify device identity;
4. accept tenant/BYOD scope;
5. show first observation;
6. land on Device Doctor.

## Journey 2 — Device Doctor -> maintenance

### Simulation

Devices -> Device Doctor -> diagnosis -> Maintenance.

### Finding

The domain surfaces support the journey and W061 has a `service-device` journey descriptor.

However, the descriptor jumps from maintenance preparation to procurement matching as a "verify" step. That is not the real terminal state of maintenance.

### Required change

Render the actual sequence:

Device Doctor
-> Diagnosis evidence
-> Treatment recommendation
-> Create/accept work order
-> Vendor/service match
-> Quote/acceptance where required
-> Fulfillment
-> Verification
-> Evidence trail

The UI must preserve the distinction between diagnosis, proposal, accepted work, and verified outcome.

## Journey 3 — Security finding -> action -> verification

### Simulation

Security -> Findings -> Decision -> Approvals -> Actions -> verification.

### Finding

The domain model supports all required states and W061 exposes findings, decisions, approvals and action plans.

The rendered experience does not yet exist, and the current built-in journey omits the final evidence/audit destination.

### Required change

Make the journey visible end-to-end:

Finding
-> evidence
-> Guardian decision
-> approval queue when parked
-> action plan
-> dispatch
-> execution result
-> verification
-> audit/evidence

A blocked decision must visually stop the journey. A parked decision must visibly require a human approval.

## Journey 4 — Lost device recovery

### Simulation

Devices -> Find My Device -> Recovery case -> destructive action.

### Finding

The current shell exposes the right areas, but the built-in journey ends at preparation. It does not describe the full recovery state progression.

### Required change

Render:

Device
-> last-seen evidence
-> recovery case
-> locate/lock where supported
-> owner/authorization gate
-> destructive action if permitted
-> verification
-> replacement escalation
-> recovery evidence

Unsupported capabilities must remain visibly unsupported rather than becoming disabled-looking fake controls.

## Journey 5 — Workload planning -> software/procurement/connectivity

### Simulation

Workloads -> Planning -> Recommendation -> Commerce.

### Finding

W061 exposes planning/recommendations and Commerce exposes procurement, maintenance, connectivity and communication.

But the architectural journey is broader than the current four-step descriptor and currently hides Software and Vendors inside Commerce.

The descriptor also ends in Communication, which is not the same as verified connectivity outcome.

### Required change

Render the complete graph:

Workload Profile
-> Requirement/constraint explanation
-> Device fit
-> Software subscription requirement
-> Vendor/procurement match
-> Quote/aggregation
-> Acceptance
-> Connectivity request
-> normalized connectivity status/evidence
-> communication outcome

Preserve the separation between recommendations/proposals and accepted procurement or software allocations.

## Journey 6 — Fleet Action

### Simulation

Actions -> Plans.

### Finding

Fleet Actions exists in the domain and the Actions UI package contains action-plan view-models, but there is no dedicated built-in journey descriptor for the major architecture example.

### Required change

Add:

Select devices/people
-> choose action
-> preview affected targets
-> Guardian decision
-> approval if required
-> dispatch
-> per-target result
-> verification
-> evidence

## Journey 7 — Print orchestration

### Simulation

Actions -> Print.

### Finding

The surface exists, but printing is not represented as one of the shell's built-in cross-surface journeys.

### Required change

Make the architecture example directly discoverable:

Select people
-> select document
-> Print
-> resolve each approved printer
-> show policy decisions
-> dispatch
-> per-printer result
-> verification/evidence

Routing refusal must be visible and actionable rather than hidden as a technical error.

## Journey 8 — Evidence and audit

### Simulation

User completes an important action and looks for proof.

### Finding

The architecture makes Evidence/Audit a first-class product surface, but the W061 shell has no Evidence/Audit area.

This is a direct discoverability gap.

### Required change

Add Evidence & Audit as a first-class area and allow every consequential record to expose an "Evidence trail" entry point.

The evidence view should show:
- source observation;
- diagnosis/prediction version;
- policy/Guardian decision;
- approval;
- command/action;
- execution result;
- verification;
- related notifications/integration outcome.

## Journey 9 — Learning / Arena

### Simulation

User wants to know what FleetOS has learned from previous outcomes.

### Finding

W070 exists and is accepted, but there is no first-class Learning UI area.

### Required change

Expose:
- evaluation cases;
- outcomes used for evaluation;
- certification state;
- adopted capability/version;
- compatibility;
- rollout/adoption state;
- rollback/supersession evidence.

The UI must make clear that uncertified model output never becomes action permission.

## Journey 10 — Policies / Contract Guardian

### Simulation

User needs to understand or change why an action was blocked.

### Finding

Security decisions expose the Guardian output, but Policies is not a first-class top-level navigational area even though the frozen architecture explicitly lists Policies as a user-facing capability.

### Required change

Expose a Policies area with:
- policy sets;
- rules;
- effective decision examples;
- reason/evidence;
- affected scopes;
- version history.

Policy editing must remain separate from decision execution and must preserve versioned audit evidence.

## Global discoverability result

The existing W061 deterministic search design is a strong foundation, but it currently searches injected surface records rather than providing a real browser-level global search experience.

The rendered console must make search a first-class escape hatch.

A user should be able to type:
- "battery"
- "confidential upload"
- "lost laptop"
- "approval"
- "printer"
- "structural engineer"
- "Acme quote"
- "Arena capability"
- "audit"

and land on the relevant FleetOS record or capability without knowing its internal package name.

## Simulation conclusion

The architecture is now well covered by domain/UI contracts, but the actual product is **not yet visually navigable**.

The key follow-on work is therefore not another domain-model wave.

It is:

rendered console
-> complete navigation vocabulary
-> complete journeys
-> data/runtime composition
-> browser-level E2E evidence
-> free-tier staging deployment
-> release-gate-backed deployment rehearsal
