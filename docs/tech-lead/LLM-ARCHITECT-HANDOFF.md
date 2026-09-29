FleetOS LLM Tech Lead Handoff

Mission:
Implement the frozen FleetOS architecture end to end with three concurrent workers and minimal drift.

Product thesis:
FleetOS is not merely MDM, RMM, procurement, marketplace or DLP. It is the operating layer for physical computing fleets.

Core loop:
observe -> model -> diagnose -> plan -> authorize -> act -> verify -> learn

The SaaS is independently valuable and can be installed on fleets not procured through Fleet.

Ecosystem:
ADCOS = connectivity outcome/orchestration
Arena = capability learning/evaluation/certification
Aurum Chat = organizational communication/intelligence
These are external integrations, not semantic dependencies.

Repository state:
The repo began empty and is now an architecture-first implementation skeleton. There is no legacy application code to preserve.

Authoritative files:
AGENTS.md
spec/ARCHITECTURE.md
spec/ARCHITECTURE-LOCK.md
spec/MODULE-DEPENDENCY-MAP.md
spec/WORK-ITEM-DEPENDENCY-GRAPH.md
spec/work-items/WORK-ITEM-CATALOG.md

First move:
Complete W001, W002 and W003 in the Tech Lead lane. Then activate exactly three Wave 1 items:
A -> W010
B -> W011
C -> W012
This is intentional: all three worker lanes start immediately after the contract harness is frozen.

Maintain spec/PROJECT-STATE.md as the live checkpoint.

Worker boundaries:
A owns device edge/platform/recovery.
B owns intelligence/security/actions/learning.
C owns workload/commerce and the small foundation bootstrap assigned in W012.
The Tech Lead owns cross-worker integration and shared contracts.

Priorities:
1. Preserve Device Twin and Intent semantics.
2. Keep provider/platform specifics behind adapters.
3. Keep authorization separate from AI/ML reasoning.
4. Make consequential actions auditable, idempotent and verifiable.
5. Make privacy and tenant isolation structural.
6. Use contract tests to enable parallel workers.
7. Keep procurement optional.
8. Learn from workload and maintenance outcomes.
9. Expose architecture-level capabilities in the UI.
10. Prefer mature open-source/provider services when reliable without semantic lock-in.

Reference deployment:
A reasonable first SaaS target is Vercel + PostgreSQL + Redis-compatible queues/cache + object storage. Device agents and LAN/printer connectors run outside the web runtime.

Required order:
Wave 0 -> Wave 1 -> Wave 2 -> Wave 3 -> Wave 4 -> Wave 5 adapters -> W051 convergence -> Wave 6 surfaces -> W061 journey convergence -> W070/W071/W072 -> W080

Maximum active worker items: 3.

Final acceptance:
- enroll an existing fleet;
- survey multiple device classes;
- detect a realistic health/security problem;
- produce evidence-backed diagnosis;
- schedule maintenance;
- enforce contract policy;
- recommend device/software for a workload;
- create aggregated procurement request;
- execute a fleet action;
- route printing to selected people's printers;
- request ADCOS connectivity;
- execute recovery;
- send Aurum notification;
- create Arena learning case;
- survive duplicate/replayed commands;
- preserve tenant isolation/auditability.

Decision discipline:
Prefer frozen architecture; choose the smallest satisfying implementation; use ADRs for genuine architecture change; never use shortcuts that silently alter boundaries.

## Follow-on phase after W080

The W001-W080 roadmap is complete, but the repository's web layer is still a contract/view-model layer rather than a rendered browser console.

The next implementation phase is governed by:
- `docs/tech-lead/UX-JOURNEY-SIMULATION.md`
- `spec/ui/CONSOLE-DESIGN.md`
- `docs/tech-lead/CONSOLE-DEPLOYMENT-HANDOFF.md`
- `docs/tech-lead/FREE-TIER-DEPLOYMENT.md`

Dispatch exactly three workers:
- A -> W090A rendered Device/Recovery/Enrollment UI
- B -> W090B rendered Security/Policies/Actions/Learning UI
- C -> W090C rendered Workload/Commerce UI

Then the TL executes:
- W091 rendered Control Tower + journey convergence
- W092 free-tier staging deployment + release rehearsal

Critical product finding:
W061 proves navigation/discoverability/view-model semantics, but no actual Next.js/React console exists yet. The next phase must therefore optimize for product emergence rather than additional domain abstraction.

Design source:
Use the interaction qualities of `pectoraux/ShareNet` as inspiration — calm navigation, whitespace, typography, status-led presentation, drawers/sheets, responsive mobile navigation, and clear loading/empty/error states — without copying branding or implementation.

Deployment source:
Use Vercel Hobby only for non-commercial staging/demo, with Neon Free as authoritative Postgres, Upstash Redis Free for transient queue/cache/lock, and Cloudflare R2 for evidence/artifacts. The W080 release gate remains the production-control authority.