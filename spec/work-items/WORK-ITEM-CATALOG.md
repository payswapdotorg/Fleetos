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

# Post-roadmap console + deployment extension

W090A - Rendered Device/Recovery/Enrollment console
A. Turn the accepted W060A view-models into real React UI inside the worker-owned web surface packages. Implement fleet enrollment/onboarding entry points, device list/Doctor/lifecycle, Find My Device, recovery cases, gated destructive-action presentation and browser journey tests.

W090B - Rendered Security/Policies/Actions/Learning console
B. Turn the accepted W060B view-models plus W070 learning capabilities into real React UI. Implement Security Doctor, findings, Contract Guardian/policies, approvals, Fleet Actions, Print, Learning/Arena views and browser journey tests.

W090C - Rendered Workload/Commerce console
C. Turn the accepted W060C view-models into real React UI. Implement workload planning/recommendations, procurement, software, vendors, maintenance, connectivity and Aurum communication outcome views plus browser journey tests.

W091 - Rendered Control Tower + journey convergence
TL. Create the Next.js application, responsive ShareNet-inspired shell, Control Tower, global search, breadcrumbs, shared design tokens/primitives, Evidence & Audit area, complete route vocabulary, onboarding composition and end-to-end browser journey harness. Expand the four W061 journey descriptors into complete product journeys without changing domain authority boundaries.

W092 - Free-tier staging deployment + release rehearsal
TL. Bind the rendered app to Neon PostgreSQL, Upstash Redis and Cloudflare R2; add Vercel staging configuration, environment templates, build/deploy CI, deployment manifests, post-deploy health/evidence checks and W080 release-gate integration. Vercel Hobby is staging/demo only because it is restricted to personal/non-commercial use; commercial production requires a commercial plan.

New-work acceptance rule: W090A/B/C require browser-visible rendering, accessible interaction states, tenant/authorization semantics, empty/loading/error/blocked/approval states and journey evidence. W091 requires all architecture-level capabilities to be reachable from navigation or global search. W092 requires reproducible staging deployment and release-gate evidence. The frozen architecture/contracts remain unchanged unless a genuine architectural change is proposed through an ADR.
