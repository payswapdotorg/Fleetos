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


# Productization extension — W100-W103

W100A - Installable agent + real enrollment
A. Produce reproducible Windows/macOS/Linux agent artifacts; one-time enrollment/bootstrap; first check-in and first observation; install center integration; revoke/uninstall; BYOD scope; browser acceptance. Scope: apps/agent, packages/device-adapters, packages/recovery, packages/integrations/adcos, apps/web/device, apps/web/recovery, and agent-release workflow artifacts owned by the lane.

W100B - Role-shaped security/action/learning experiences
B. Implement role-aware experience projections for security, policy, approvals, actions, print and learning; explain blocked/approval-required actions; expose evidence and escalation affordances; add browser tests. Scope: packages/security, packages/policy, packages/actions, packages/learning, packages/integrations/arena, apps/web/security, apps/web/actions, apps/web/learning.

W100C - Durable identity/session/role switching + resource/commercial experiences
C. Persist users/workspaces/sessions/role assignments over Neon; implement auditable active-role semantics; role-aware workload/commerce flows; add optional provider-neutral Apify enrichment adapter; add browser/integration tests. Scope: packages/identity, packages/audit, packages/workloads, packages/vendors, packages/procurement, packages/software, packages/maintenance, packages/integrations/aurum, packages/integrations/apify, apps/web/workloads, apps/web/commerce.

W101 - Product shell + auth/onboarding convergence
TL. Compose sign-in/session, workspace lifecycle, onboarding rail, role switcher, role-shaped Control Tower, Install Center, approval/notification inbox, role-aware search, route guards and mobile behavior. No new business truth in the shell.

W102 - Durable free-tier staging deployment
TL. Bind Neon durable persistence, Upstash transient coordination, R2 artifacts/evidence, optional Apify/Resend adapters, CI, agent artifact release, Vercel staging, post-deploy checks, manifest and W080 release gate.

W103 - UX operational simulation + final product acceptance
TL. Run all role/persona simulations, browser E2E, mobile flows, install/first-check-in, tenant isolation, session lifecycle and provider/credential checks. Update UX contracts when simulation discovers operational drift. Publish the three-question YES checklist.

New-work acceptance rule: no item is accepted on worker-reported unit tests alone. The TL re-runs architecture check, ownership check, contracts check, typecheck, full test suite, build, browser E2E and relevant provider/deployment evidence on the exact delivered commit.

# Wave 12 — operator product directives (2026-10-01)

W120 - Stripe-adapted design system
Worker (TL-scope grant: apps/web/src/console-styles.css, apps/web/shell/src, apps/web/product/src/session-chrome.tsx). Adapt the interaction and visual qualities of stripe.com: light foundation with generous whitespace, crisp 8px-radius cards and inputs, subtle gray borders with soft elevation, grouped light sidebar navigation + topbar with account area, #635BFF accent for primary actions and focus rings, Inter/system font stack, restrained semantic colors for states. Adapt qualities — never copy Stripe branding, logos, or marketing text pixel-for-pixel (the ShareNet law applied to Stripe). Stable fos-* class CONTRACT: class names and their semantic meaning stay stable so auth screens (W121) inherit the new language without markup conflicts. No logic changes, no session-screens.tsx, no product-gate.tsx, no package edits.

W121 - Proper authentication (sign-up / sign-in / sign-out with credentials)
Worker (C-scope packages/identity + TL-scope grant: apps/web/src/runtime/product-session.ts, apps/web/src/product-gate.tsx, apps/web/product/src/session-screens.tsx). Account credentials through the identity seam: password credential records (hashed through an injectable PasswordHasher seam — pure computation, no crypto dependency inside identity; the composition root injects the real implementation), sign-up (create account + workspace as founder with credentials), sign-in (workspace + email + password verification against the stored verifier — machine-stable refusal reasons for wrong password / unknown account), sign-out. Persistent browser sessions: the runtime persists the session token through an injected session-store seam (localStorage at the composition root) so reload KEEPS the session honest (expiry still enforced; corrupted/unknown tokens fail closed to the gate). Passwords never render; no credential values in any client payload beyond the verifier inputs. Style ONLY through existing fos-* classes (W120 owns every css file). All existing tests must pass; base 3265/0.

W122 - Demo accounts with quick links + strict demo-data isolation
Worker (after W120+W121 merged; TL-scope grant: apps/web/src/runtime/demo-fleet.ts, apps/web/src/console-app.tsx, apps/web/product/src/session-screens.tsx quick-links strip). Demo personas (one per experience role) pre-seeded in a dedicated demo tenant with the rich demo fleet; sign-in screen offers one-click demo quick links that open the demo workspace session clearly labeled DEMO. Isolation law: console areas render records scoped to the ACTIVE session's tenant — demo tenants see the demo fleet; every non-demo workspace sees ONLY its own records (honest empty states for fresh workspaces — no demo content anywhere in non-demo accounts). Machine tests assert the isolation law (a non-demo tenant can never resolve demo records) and the quick-link journeys.

Wave 12 acceptance rule: TL re-runs all gates on the exact delivery, live browser acceptance on production (sign-up -> reload persists -> sign-out; demo quick link shows demo data; fresh non-demo workspace shows zero demo records), and the Stripe-language review against this catalog entry.

# Wave 13 — adoption roadmap (SIM-B ground truth, 2026-10-02)

Operator basis: the standing resident-watch directive (continuous monitor → harvest → review → approve/require-changes → dispatch next until the roadmap completes; no early returns) + the operator's 2026-10-02 "continue". The backlog is the accepted SIM-B report's ranked improvement list (docs/simulations/sim-b-report.md §11) — the repo's own AI_CONTINUATION names this the NEXT PHASE. Asks 4 + 6 are CLOSED (W130). Remaining asks, by rank: (1) compose the six runtime lanes; (2) server-side control plane + real agent check-in; (3) actionable Approve/Reject through the confirmation+audit path; (5) declared-import path for device records; (7) mobile card layout for the device roster below ~480px.

W140 - Server-side control plane + real agent check-in
Worker (TL-scope grant: apps/web/app/api/**, apps/web/src/server/**, apps/agent/**, plus a package.json driver dependency addition recorded in the delivery). Server-issued sessions and verifiers over the accepted durable identity seams: a server-only Postgres/Neon DurableRecordStore implementation (fetch-based @neondatabase/serverless over DATABASE_URL; the in-memory reference store remains the development/test tier; secrets never reach client bundles), API routes for session issuance/resolve/revocation (sign-in verifies through the identity password seam and sets an httpOnly server session; resolution fails closed), enrollment verification (redeems server-issued high-entropy scoped codes tenant-scoped; creates the device record + membership; the Install Center "unbootstrapped — waiting" state becomes real), a real agent check-in endpoint (idempotent, correlation + causation ids, audit entries; observations ingested as real observations — never fabricated), and server-side scoped-code issuance. The frozen identity/audit packages gain NO new dependencies (the driver lives server-only in apps/web). Development tier behavior is unchanged (localStorage session seam).

W141 - Lane composition I: Device Doctor + Recovery deep screens
Worker A (apps/web/device/**, apps/web/recovery/**). Turn the accepted deep screens into runtime-bindable compositions: view-model composition functions + feeds that carry the Device Doctor detail (symptom walk, remediation steps, honest not-yet-observed states), recovery cases list/detail, Find My Device, and the destructive-action confirmation flow (gated, explicit confirmation, audit entry) from the runtime state contract into the screens' phase props. Machine tests over the lane packages prove every phase transition (loading/ready/error/blocked/approval-required) and the destructive gates. No console-app edits (TL composition follows in W144).

W142 - Lane composition II: Security Doctor walk + Fleet Actions plans + approvals execution
Worker B (apps/web/security/**, apps/web/actions/**). Same binding pattern for the Security Doctor remediation walk and the Fleet Actions plan surfaces (plan detail, print distribution), PLUS the approvals execution path the report demands: Approve/Reject on a parked plan produces a confirmation dialog, a decision record through the audit seam, and the state change (never auto-promoted; decided by an owner; restricted roles get the frozen denial explanations). Gated destructive controls (disable enrollment code, revoke device trust) gain their confirmation flows with feedback + audit entries. Machine tests prove the decision lifecycle, the confirmation gates, and RBAC denials.

W143 - Lane composition III: Workloads planning + Commerce procurement deep screens
Worker C (apps/web/workloads/**, apps/web/commerce/**). Same binding pattern for workload planning/recommendations and the commerce procurement surfaces (procurement cases, vendor context, software/maintenance/connectivity as owned). Machine tests prove phase transitions and honest empty/blocked states.

W145 - Declared-import path + mobile roster cards
Worker A (apps/web/device/**). A declared-import surface for device records — manual entry clearly provenance-flagged DECLARED (never conflated with agent OBSERVED records; the real-observations-only doctrine is respected by marking), so SMALL firms can begin tracking before agent rollout. Mobile priority-card layout for the device roster below ~480px (the 993px table becomes a card list; no horizontal page scroll required for field use).

W144 - Runtime composition + deployment convergence
TL (apps/web/src/console-app.tsx, apps/web/src/runtime/product-session.ts, apps/web/src/product-gate.tsx as needed; may be executed by a briefed worker under TL-scope grant with TL re-verification). Bind the six lanes' deep views into the console runtime over W141/W142/W143's compositions; wire the approvals inbox to the executed decision path; composition-root wiring so the deployed tier resolves sessions + enrollment server-side (W140 routes) while development keeps the localStorage seam; end-to-end browser journeys for every composed lane; Vercel deploy + post-deploy check + a SIM-B-style re-verification of the six lanes and the Approve/Reject journey on production.

Wave 13 acceptance rule: no item is accepted on worker-reported tests alone — the TL re-runs check (4/4, 150-contract snapshot unchanged unless an ADR is recorded), typecheck, the full battery, and browser-verifies the composed surfaces on production. Lane compositions must render real runtime state (demo tenant + fresh-workspace honest empty states), never fabricated data. W140's routes must fail closed on every refusal path and leak no secret VALUES (names only, per the env module law). Do NOT re-dispatch any shipped item.
