# FleetOS Product Readiness Acceptance Checklist

A release candidate cannot be called product-ready until every line is checked.

## User / identity

- [ ] Sign in works.
- [ ] Sign out works.
- [ ] Session expiry is handled.
- [ ] Create workspace works.
- [ ] Join workspace works.
- [ ] User can hold more than one role.
- [ ] Role switch is visible, immediate and audited.
- [ ] Role switch never changes tenant.

## Install / device

- [ ] Install Center is discoverable from Control Tower.
- [ ] Windows artifact is downloadable.
- [ ] macOS artifact is downloadable.
- [ ] Linux artifact is downloadable.
- [ ] Checksums are published.
- [ ] One-time enrollment code expires.
- [ ] Replay of enrollment code is refused.
- [ ] First check-in is visible.
- [ ] First observation is visible.
- [ ] Device Doctor is reachable.
- [ ] BYOD scope is explicit.
- [ ] Revoke/uninstall path is visible.

## Roleful UX

- [ ] Fleet Admin lens is useful.
- [ ] Service Desk lens is useful.
- [ ] Security/Compliance lens is useful.
- [ ] Asset/Procurement lens is useful.
- [ ] Team Manager lens is useful.
- [ ] Employee lens is useful.
- [ ] Vendor operator lens is scoped and isolated.
- [ ] Restricted actions explain why.
- [ ] Role-specific navigation never grants authority.
- [ ] Global search respects tenant and role context.

## Core journeys

- [ ] Enroll fleet.
- [ ] Inspect device.
- [ ] Diagnose health issue.
- [ ] Schedule/verify maintenance.
- [ ] Security finding -> Guardian -> approval -> execution -> verification.
- [ ] Fleet Action.
- [ ] Print.
- [ ] Recover lost device.
- [ ] Workload -> software -> procurement -> vendor -> verified outcome.
- [ ] Connectivity.
- [ ] Communication outcome.
- [ ] Evidence trail.
- [ ] Learning/adoption.

## Provider / deployment

- [ ] Vercel Hobby deployment is clearly labeled staging/demo.
- [ ] Neon is authoritative.
- [ ] Redis is non-authoritative.
- [ ] R2 is non-authoritative.
- [ ] Apify is optional/non-authoritative.
- [ ] Resend is optional/non-authoritative.
- [ ] Provider secrets never appear in client payloads.
- [ ] Post-deploy health is healthy.
- [ ] Deployment manifest is generated.
- [ ] W080 release gate passes for the candidate.
- [ ] Staging can be recreated from repository instructions.

## UX simulation

- [ ] Fleet Admin simulation passes.
- [ ] Service Desk simulation passes.
- [ ] Security simulation passes.
- [ ] Asset Manager simulation passes.
- [ ] Team Manager simulation passes.
- [ ] Employee simulation passes.
- [ ] Vendor simulation passes.
- [ ] Mobile simulation passes.
- [ ] Cross-role continuity passes.
- [ ] No architectural capability is stranded behind internal terminology.
