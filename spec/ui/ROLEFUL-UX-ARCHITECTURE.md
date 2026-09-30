# FleetOS Roleful UX Architecture

STATUS: PRODUCTIZATION UX CONTRACT — architecture remains FROZEN v1.0

## Principle

FleetOS is one product with multiple lenses.

A person may have several roles in the same tenant. The user should not need separate accounts, separate consoles, or separate mental models for those roles.

The active role changes:

- what FleetOS emphasizes first;
- which areas are prominent;
- which actions are offered;
- which records are grouped together;
- the terminology/help shown to the user.

The active role never bypasses:

- tenant isolation;
- explicit authorization;
- Contract Guardian;
- consequential-action approval rules;
- audit/evidence;
- verification.

The experience profile is therefore a UX lens, not a second permission system.

## Canonical role families

These are experience profiles. Authorization remains owned by identity + Contract Guardian.

| Role | Primary question FleetOS should answer |
| --- | --- |
| fleet.admin | What is the state of my fleet and what must I govern? |
| service.desk | Which devices/users need help and what can I safely do next? |
| security.compliance | What risks, policy decisions, approvals and evidence need attention? |
| asset.manager | What should we buy, maintain, replace or subscribe to? |
| team.manager | How is my team affected and which requests/approvals need me? |
| employee | Is my device healthy, what should I do, and how do I request help? |
| vendor.operator | Which quotes, work orders and fulfillment steps require my response? |

A principal may have any subset of these roles.

## Role switch contract

The shell must expose a compact role switcher in the persistent top bar.

The switcher shows:

- active role;
- tenant/workspace;
- a short "what this role is for" description;
- other assigned roles;
- a clear disabled state when the selected role lacks a capability;
- no fake "act as another user" semantics.

Role switch:

1. resolves the user's active role assignment for the current tenant;
2. recomputes role-filtered navigation from effective permissions;
3. recomputes the Control Tower lens;
4. preserves the current tenant;
5. preserves the current record where safe;
6. emits an audit event;
7. never mutates business records by itself.

The active role may be stored in session UI state only as a selector. The authoritative set of assigned roles remains in the identity domain/persistent store.

## Experience architecture

### Global shell

Always visible:

- FleetOS identity;
- tenant/workspace selector where the user has multiple tenants;
- active role switcher;
- global search;
- notifications/approval inbox;
- help;
- current environment;
- mobile navigation.

### Control Tower

Control Tower is role-shaped.

It should not become seven completely different pages. It keeps a shared backbone:

1. Needs attention
2. Current fleet/resource pulse
3. Requests/approvals
4. Recent activity
5. Recommended next steps
6. Evidence links

Only the ordering, copy, filters, and primary actions change by role.

### Record page

Every record follows:

summary -> current state -> why it matters -> available action -> authorization -> evidence -> history -> verified outcome.

The same record may be seen differently by different roles, but the underlying identity and evidence references remain stable.

### Cross-role continuity

A record should explain role limitations rather than dead-end:

"You are viewing this as Employee. Lock and wipe are restricted to Service Desk/Security roles."

A role-aware CTA may offer:

"Switch to Service Desk"

but only when the user actually has that role.

When the user does not have the required role, the UI explains the required role and the appropriate request/escalation path instead.

### First-run onboarding

The first session should be task-led:

1. Welcome
2. Create/join workspace
3. Choose initial role(s)
4. Add first device
5. Install/connect agent
6. Wait for first observation
7. Review Device Doctor
8. Complete one safe action/request
9. Land on Control Tower

The first-run experience should teach the product through the real domain rather than a marketing-only tour.

## Role-to-surface emphasis

| Surface | Fleet Admin | Service Desk | Security | Asset | Manager | Employee | Vendor |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Control Tower | High | High | High | High | High | High | Medium |
| Devices | High | High | Medium | High | Medium | My-device | Low |
| Recovery | High | High | Medium | Low | Medium | My-device | Low |
| Security | High | Medium | Highest | Medium | Low | Personal-policy | Low |
| Policies | High | Medium | Highest | Medium | Low | Explain | Low |
| Fleet Actions | High | High | High | Low | Medium | Request | Low |
| Workloads | High | Medium | Medium | Highest | High | My-work | Low |
| Commerce | High | Medium | Medium | Highest | Medium | Requests | Highest |
| Evidence & Audit | High | High | Highest | High | Medium | Personal | High |
| Learning | High | Medium | High | Medium | Medium | Low | Low |

These are UX emphasis hints, not permission grants.

## Creative freedom for worker agents

Workers may innovate in:

- card composition;
- table vs timeline presentation;
- empty-state illustrations or lightweight visual metaphors;
- drawer/sheet layouts;
- density presets;
- wording refinements;
- contextual quick actions;
- role-specific ordering inside a surface.

Workers may not change:

- route/record vocabulary without TL approval;
- authority boundaries;
- status semantics;
- tenant boundaries;
- consequential-action authorization;
- evidence requirements;
- the distinction between proposal and execution;
- the provider-neutral domain boundary.

## Data boundary

React state may contain transient interaction state:

- open drawer;
- active tab;
- selected row;
- active role selector;
- search query;
- form draft.

React state may not become the canonical source for:

- device health;
- roles;
- permissions;
- policy decisions;
- action status;
- procurement truth;
- recovery state;
- audit history.

Those come from public application/domain projections.

## Accessibility

Role switching, navigation, status, approvals and disabled actions must remain usable with:

- keyboard navigation;
- visible focus;
- accessible names;
- text-equivalent state;
- reduced motion;
- responsive touch targets;
- screen-reader announcements for async transitions.

## ShareNet reference boundary

The ShareNet reference is used for interaction qualities:

- calm persistent navigation;
- whitespace;
- concise headers;
- breadcrumbs;
- drawers/sheets;
- semantic status;
- responsive shell;
- strong empty/loading/error states.

FleetOS must not copy ShareNet branding, copy, source code, or pixel-level layout.
