W001 - Repository governance + skeleton
TL. Create package boundaries, CI, architecture checks, ADR template and test scaffolding.

W002 - Shared domain/event/API contracts
TL. Define IDs, tenant scope, event envelope, correlation/causation, idempotency, errors and versioning.

W003 - Architecture/contract test harness
TL. Import-boundary checks, public-contract checks and fixture strategy.

W010 - Device agent/runtime contract
A. Check-in, capability discovery, observation batch, command receipt/result and local signed-policy cache.

W011 - Device Twin + observation ingestion
B. Device identity, ownership, normalization and ingestion control-plane boundary.

W012 - Tenant/auth/audit foundations
C. Tenant isolation, actor identity, append-only audit and scoped authorization primitives.

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

W050A - ADCOS adapter
A. Translate FleetOS ConnectivityIntent to the normalized ADCOS contract and normalize status/evidence.

W050B - Arena adapter
B. Submit evaluation cases and consume certified capability metadata through the Arena contract.

W050C - Aurum adapter
C. Emit normalized communication intents and consume delivery/outcome metadata.

W051 - External integration convergence
TL. Contract compatibility tests, retries/idempotency, adapter health and integration evidence.

W060A - Device/recovery UI surfaces
A. Device list, Device Doctor detail, device actions and Find My Device surfaces.

W060B - Security/policy/action UI surfaces
B. Security findings, Contract Guardian decisions, Fleet Actions and print workflow.

W060C - Workload/commerce/connectivity UI surfaces
C. Workload planning, procurement, software, maintenance, vendor and connectivity surfaces.

W061 - Control Tower/journey convergence
TL. Navigation, permissions, cross-surface journeys, discoverability and end-to-end UX coherence.

W070 - Learning/evaluation loop
B. Convert outcomes into evaluation cases and capability adoption records.

W071 - Privacy/security/tenant hardening
A. Agent trust, signed-policy cache, enrollment security, BYOD scoping, data minimization and destructive-action gates.

W072 - Vendor/commercial outcome quality
C. Vendor scorecards, commercial reconciliation, aggregation outcome measurement and marketplace-quality evidence.

W080 - Production readiness
TL. Deployment, observability, backup/restore, migrations, E2E evidence, operator runbook and release gate.

Every item is done only with contract conformance, invariant tests, boundary integration tests, audit evidence, docs, ownership compliance and green CI.