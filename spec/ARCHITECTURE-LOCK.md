# FleetOS Architecture Lock v1.0

1. FleetOS works for independently enrolled customer fleets; procurement is optional.
2. Device Twin is the canonical durable representation of a managed device.
3. Observations/events are immutable; derived diagnoses/recommendations are versioned.
4. All consequential actions have authorization, idempotency, audit and verification.
5. Device agents are untrusted and tenant-scoped.
6. Provider-specific APIs/types never enter core domain contracts.
7. ADCOS, Arena and Aurum integrate through provider-neutral contracts.
8. ADCOS owns network-native topology/path execution; FleetOS owns fleet connectivity intent and device/workload policy.
9. Arena owns capability learning/certification; FleetOS owns operational adoption.
10. Aurum is a communication/intelligence channel; FleetOS remains operational authority.
11. Contract Guardian enforces explicit policy and never asserts unobservable employee intent.
12. Hardware, software, connectivity and maintenance are first-class resources linked to workloads.
13. Procurement is an exchange/matching problem, not a hard-coded vendor integration.
14. Deadlines may drive compatible order aggregation and discounts without erasing contract identity.
15. Telemetry is minimized and purpose-bound; BYOD and corporate-owned scopes are distinct.
16. Destructive actions require an explicit policy grant and evidence trail.
17. Tenant isolation is enforced at persistence and action boundaries.
18. Redis/cache/queues cannot become business truth.
19. UI journeys must expose architecture-level capabilities.
20. Workers implement contracts; the Tech Lead owns cross-cutting changes and acceptance.