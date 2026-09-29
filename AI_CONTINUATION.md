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

Current state:
- architecture: FROZEN v1.0
- original W001-W080 roadmap: COMPLETE on integration/wave0
- W090A/W090B/W090C: ready for parallel worker dispatch
- W091/W092: Tech Lead follow-on work after the three worker deliveries
- worker limit: 3
- integration lane: Tech Lead
- rendered console: NOT YET IMPLEMENTED
- current web packages: UI contracts/view-models/state machines, not browser rendering
- staging target: Vercel Hobby + Neon Free + Upstash Redis Free + Cloudflare R2 free tier
- Vercel Hobby is staging/demo only; commercial production requires a commercial Vercel plan
- external integrations remain provider-neutral