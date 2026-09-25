# FleetOS Work Item Catalog

W001 - Repository governance + skeleton
TL. Create package boundaries, CI, architecture checks, ADR template and test scaffolding.

W002 - Shared domain/event/API contracts
TL. Define IDs, tenant scope, event envelope, correlation/causation, idempotency, errors and versioning.

W003 - Architecture/contract test harness
TL. Import-boundary checks, public-contract checks and fixture strategy.

W010 - Device agent/runtime contract
A. Check-in, capability discovery, observation batch, command receipt/result and local signed-policy cache.

W011 - Device Twin + observation ingestion
A. Device identity, ownership, normalization and ingestion.

W012 - Tenant/auth/audit foundations
TL. Tenant isolation, actor identity, append-only audit and scoped authorization.

W020 - Endpoint adapter SDK
A. Normalized interface and Windows/macOS/Linux seams.

W021 - Health + diagnosis engine
B. Signals, baselines, anomalies, diagnosis hypotheses and treatment recommendations.

W022 - Workload profiles + recommendation contracts
C. Workload model, requirement vectors and recommendation outputs.

W030 - Mobile + printer/copier adapter contracts
A. Android/iOS and SNMP/vendor printer/copier boundaries.

W031 - Security Doctor + Contract Guardian
B. Security posture, findings, classification, policy evaluation and enforceable decisions.

W032 - Procurement/vendor/software exchange
C. Demand, vendor capabilities, matching, software subscriptions and quotes.

W040 - Recovery + Find My Device
A. Last-seen evidence, recovery state, lock/locate and replacement escalation.

W041 - Fleet Actions + Print orchestration
B. Group selection, action plans, target resolution and printer routing.

W042 - Maintenance exchange + deadline aggregation
C. Service work orders, vendor matching, warranty, replacement and aggregation.

W050 - ADCOS/Arena/Aurum integrations
TL with support from A/B/C. Provider-neutral adapters and contract tests.

W060 - Control Tower + major journeys
TL with worker APIs. Onboarding, Device Doctor, policies, workload planning, procurement, software, maintenance, connectivity, actions and recovery.

W070 - Learning/evaluation loop
B. Convert outcomes into evaluation cases and capability adoption records.

W071 - Privacy/security/tenant hardening
A. Agent trust, signed-policy cache, enrollment security, BYOD scoping, data minimization and destructive-action gates.

W080 - Production readiness
TL. Deployment, observability, backup/restore, migrations, E2E evidence, operator runbook and release gate.

Every item is done only with contract conformance, invariant tests, boundary integration tests, audit evidence, docs, ownership compliance and green CI.