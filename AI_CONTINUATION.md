# Fresh-session continuation

A new Tech Lead must not rely on chat history.

Read:
1. AGENTS.md
2. docs/tech-lead/LLM-ARCHITECT-HANDOFF.md
3. spec/ARCHITECTURE.md
4. spec/ARCHITECTURE-LOCK.md
5. spec/MODULE-DEPENDENCY-MAP.md
6. spec/WORK-ITEM-DEPENDENCY-GRAPH.md
7. spec/work-items/WORK-ITEM-CATALOG.md
8. docs/tech-lead/worker-model.md
9. docs/tech-lead/worker-runbook.md
10. docs/tech-lead/merge-gates.md
11. docs/tech-lead/UX-JOURNEY-SIMULATION.md
12. spec/ui/CONSOLE-DESIGN.md
13. docs/tech-lead/CONSOLE-DEPLOYMENT-HANDOFF.md
14. docs/tech-lead/FREE-TIER-DEPLOYMENT.md

Current state (WAVE 13 IN FLIGHT — adoption roadmap, 2026-10-02):
- architecture: FROZEN v1.0
- roadmap: original W001-W080 + render W090A/B/C + W091 + W092 + productization W100A/B/C + W101-W103 + W110 + W120-W122 + W130 ALL SHIPPED; post-roadmap SIM-B experiment delivered (report accepted, verdict 0/0/105 RETAIN — the honest ground truth)
- WAVE 13 OPEN (the adoption roadmap — SIM-B asks 1/2/3/5/7; asks 4+6 closed by W130): catalog da2a3b8 records W140 (server-side control plane + agent check-in) / W141 (Device Doctor + Recovery bindings) / W142 (Security walk + Fleet Actions + approvals execution) / W143 (Workloads + Commerce bindings) / W145 (declared import + mobile roster) / W144 (TL runtime composition + deployment). W140/W141/W142 dispatched in parallel worktrees; W143/W145 follow as slots free; W144 composes on the merged tree
- production: LIVE at https://fleetos-staging-flame.vercel.app (Vercel Hobby; post-deploy-check PASSED at efc264b; W130 live-verified)
- current integration source of truth: integration/wave0 (= main 0da0934 at phase open); integration/product-readiness is a CONSUMED historical branch
- Do NOT re-dispatch shipped items (W100A/B/C, W101, W102, W103, W110, W120-W122, W130); every one is accepted + merged
- worker limit: 3
- free-tier staging target: Vercel Hobby + Neon Free + Upstash Redis Free + Cloudflare R2 Free + optional Apify Free (delivered, W100C) + optional Resend Free (never scoped)
- Vercel Hobby is staging/demo only; commercial production requires a commercial-capable plan
- external integrations remain provider-neutral
- the productization read-list (docs/tech-lead/PRODUCT-READINESS-AUDIT.md, spec/ui/ROLEFUL-UX-ARCHITECTURE.md, spec/install/INSTALL-AND-ENROLLMENT-CONTRACT.md, docs/tech-lead/UX-OPERATIONAL-SIMULATION.md, docs/tech-lead/PRODUCT-READINESS-HANDOFF.md) remains authoritative for understanding the delivered product; spec/PROJECT-STATE.md carries the full acceptance ledger
