# FleetOS Console Design Contract

STATUS: IMPLEMENTATION CONTRACT — architecture remains FROZEN v1.0

## Purpose

FleetOS already has the domain and UI view-model contracts, but the repository does not yet contain a rendered operator console. This document is the design contract for the rendered console that the follow-on W090-W092 work must implement.

The design is inspired by the interaction qualities of the ShareNet application in `pectoraux/ShareNet`:

- persistent, calm navigation;
- generous whitespace and strong typographic hierarchy;
- concise page headers and breadcrumbs;
- state-led status indicators rather than noisy dashboards;
- contextual detail in drawers/sheets instead of forcing users into deep page stacks;
- responsive desktop sidebar + mobile navigation;
- first-class loading, empty and error states;
- progressive disclosure of technical evidence;
- restrained visual language: warm off-white/graphite foundation with small semantic accents for healthy, warning, and blocking states.

FleetOS must be its own product. Do not copy ShareNet branding, text, icons, layout pixel-for-pixel, or component code.

## Console information architecture

The rendered console must expose every architecture-level capability through navigation and/or global search.

Top-level areas:

1. Control Tower
2. Devices
3. Recovery
4. Security
5. Policies
6. Fleet Actions
7. Workloads
8. Commerce
9. Evidence & Audit
10. Learning

Commerce must expose:
- Procurement
- Software
- Vendors
- Maintenance
- Connectivity
- Communication

Devices must expose:
- Fleet list
- Device Doctor
- Lifecycle

Security must expose:
- Security Doctor
- Findings
- Guardian decisions
- Approvals

Evidence & Audit must expose the evidence trail for observations, diagnoses, policy decisions, actions, recovery, commerce, integrations, and releases.

Learning must expose evaluation cases and capability adoption/certification status.

## Control Tower

The Control Tower is the first screen after successful tenant selection.

It must answer, without deep navigation:

- What needs my attention?
- Which devices are unhealthy or at risk?
- Which security decisions require action?
- Which consequential actions are awaiting approval?
- Which maintenance jobs are due/late?
- Which procurement/software requests are in flight?
- What is the fleet connectivity state?
- What recently changed?
- Where is the evidence for any important decision?

The Control Tower should prefer:

- one primary "Needs attention" stream;
- a compact fleet-health/security pulse;
- recent activity;
- a small set of high-value counters;
- direct links into the exact record that needs action.

Avoid a dense wall of KPI cards.

## Navigation behavior

Desktop:
- persistent left navigation;
- active-area indicator;
- area grouping and concise labels;
- search/command entry always available;
- tenant/environment identity visible;
- current route breadcrumbs in the content header.

Mobile:
- compact top bar;
- bottom navigation for the highest-frequency areas;
- sheets/drawers for secondary navigation and record details.

Global search:
- reuse the existing deterministic W061 search semantics;
- index architecture-level records and capabilities;
- results must land directly on the relevant record or route;
- show the reason a result matched;
- never require users to know internal package/module names.

## Detail interaction

Every domain record should follow the same pattern:

summary -> current state -> why it matters -> recommended/available action -> evidence -> history

Consequential actions must visibly show:
- authorization state;
- policy/Guardian decision;
- whether approval is required;
- expected effect;
- evidence required;
- execution state;
- verification result.

Never present a proposal as an executed action.

## Status language

Use a small, consistent semantic vocabulary:

- Healthy
- Informational
- Needs attention
- Approval required
- Blocked
- Running
- Succeeded
- Failed
- Unknown

Visual treatment should be subtle and accessible. State is not conveyed by color alone.

## Design-system rules

The rendered application should use a small local component vocabulary, preferably shadcn-style primitives already familiar to the ShareNet reference:

- Button
- Badge
- Card
- Table
- Tabs
- Drawer/Sheet
- Dialog
- Dropdown
- Command/Search
- Breadcrumb
- Tooltip
- Skeleton
- Empty state
- Alert/error state
- Timeline
- Status indicator

Use CSS variables/design tokens rather than hard-coded surface colors throughout the application.

Target aesthetic:
- warm neutral background rather than pure white;
- graphite primary text rather than absolute black;
- hairline borders;
- restrained semantic accents;
- modest corner radii;
- no gradients or glassmorphism by default;
- whitespace carries hierarchy;
- animation is optional and respects reduced-motion preferences.

## Accessibility

The rendered console must provide:

- keyboard navigation;
- visible focus;
- semantic landmarks;
- accessible names for icon-only controls;
- sufficient text contrast;
- state announcements for async operations;
- reduced-motion behavior;
- mobile touch targets.

## Data boundary

Rendered components consume the existing public UI/domain contracts. They may not import provider SDKs or domain implementation internals.

The Next.js runtime is composition only:
- authenticate;
- resolve tenant context;
- call public application/domain services;
- shape data for the UI;
- execute authorized commands through the established intent/action boundaries.

Do not move business truth into React state.

## Acceptance

The console is not complete until a human can navigate the following journeys without knowing internal implementation names:

- enroll an existing fleet;
- inspect a device;
- understand a health diagnosis;
- schedule maintenance;
- inspect a security finding;
- understand a Contract Guardian decision;
- approve/reject a parked consequential action;
- execute/verify a Fleet Action;
- route a print job;
- recover a lost device;
- plan a workload;
- inspect software recommendations/subscriptions;
- request procurement and inspect vendor/quote progress;
- inspect maintenance matching;
- request/inspect fleet connectivity;
- inspect Aurum communication outcome;
- inspect the evidence trail/audit history;
- inspect Arena evaluation/capability adoption state.

Each journey must have a visible entry point from Control Tower/search/navigation and a visible terminal/verified state.
