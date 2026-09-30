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

Current state (WAVE 8 COMPLETE + PRODUCTIZATION PREPARATION, 2026-09-30):
- architecture: FROZEN v1.0
- original W001-W080 roadmap: COMPLETE
- W090A: ACCEPTED + merged
- W090B: ACCEPTED + merged
- W090C: ACCEPTED + merged
- W091: DELIVERED + browser-verified
- W092: DEPLOYED + ACCEPTED on the non-commercial staging stack
- current staging console: https://fleetos-staging-flame.vercel.app
- current integration source of truth remains integration/wave0; this preparation branch is integration/product-readiness
- IMPORTANT: the current console is a deterministic demo/control-plane experience. It is NOT YET the complete installable/multi-role/durable-user product.
- next phase: W100A/B/C -> W101 -> W102 -> W103
- worker limit: 3
- free-tier staging target: Vercel Hobby + Neon Free + Upstash Redis Free + Cloudflare R2 Free + optional Apify Free + optional Resend Free
- Vercel Hobby is staging/demo only; commercial production requires a commercial-capable plan
- read docs/tech-lead/PRODUCT-READINESS-AUDIT.md, spec/ui/ROLEFUL-UX-ARCHITECTURE.md, spec/install/INSTALL-AND-ENROLLMENT-CONTRACT.md, docs/tech-lead/UX-OPERATIONAL-SIMULATION.md, and docs/tech-lead/PRODUCT-READINESS-HANDOFF.md before dispatch
- when W100A/B/C are accepted, TL must converge W101, deploy W102, then run W103 as the final product-readiness acceptance
