# FleetOS Industry Adoption Simulation — SIM-C Report (Wave 13)

**Status: IN PROGRESS — this report is the acceptance record for GitHub issue #2.**
The before-baseline is the accepted SIM-B record; the after-rerun executes against
the LIVE post-fix deployment once Wave-13 lanes are merged and deployed. Nothing in
the after-sections is filled until the identical journeys have been re-executed on
production — no roadmap credit, no source-code credit, no placeholder credit.

**Method (issue #2 protocol, identical journeys before/after):**
USER-ONLY browser evaluation (headless Chromium via agent-browser CLI, desktop
1280×800 and mobile 390×844) against the deployed product only. Minimum panel:
10 industries × 3 firm sizes (LARGE 500+ / MEDIUM 50–150 / SMALL 5–25) ≥ 30 real
workspaces created through the real sign-up flow; 7 personas per workspace where
applicable; ≥100 repeatable project/operational journeys per firm where supported;
a mobile pass per industry; representative cross-role handoffs. Adoption verdicts
are SWITCH-ONLY / MAIN-INTERFACE / COMPLEMENT / RETAIN, based strictly on what a
user can actually complete in the product.

**Deployment under evaluation:** https://fleetos-staging-flame.vercel.app
(pre-fix = SIM-B record @ Wave-12 state; post-fix = Wave-13 merged tree, deployed
by W144 — deployment manifest recorded in the acceptance ledger when it ships.)

---

## 1. Executive summary

**IN PROGRESS.** To be filled after the post-fix rerun: the verdict distribution
(personas, not firms), the before/after delta table, the residual blocker list
traced to the minimal actionable cause, and the honest statement of what still
cannot be done in the product.

## 2. Before-baseline (accepted SIM-B ground truth, 2026-10-02)

- **Verdict distribution (105 personas): SWITCH-ONLY 0 (0%) · MAIN-INTERFACE 0 (0%) · RETAIN 105 (100%).**
- **Six of ten lanes are runtime placeholders:** Device Doctor, Security Doctor
  remediation walk, Recovery cases, Fleet Actions plans, Workloads planning,
  Commerce procurement — each says verbatim *"not yet composed in this runtime."*
- **Inert controls:** Approve/Reject on the parked plan (no dialog, no request, no
  state change across 15 workspaces); gated destructive controls equally inert.
- **Client-side-only control plane:** all state in `localStorage`; zero network
  requests on consequential actions; a real agent can never check in; enrollment
  verification waits forever.
- **Cross-tenant join-code defect (W130):** first invite code identical across
  workspaces; a member invited to workspace A landed in the shared DEMO tenant;
  the next join failed silently with an empty alert.
- **Mobile roster overflow:** 993px table forces horizontal page scroll below ~480px.
- Full record: `docs/simulations/sim-b-report.md` (the authoritative before-state;
  its surface map and per-industry journey logs are the rerun script).

## 3. The Wave-13 fix ledger (what actually landed, TL-verified at exact commits)

| Blocker (SIM-B) | Fix lane | State | Evidence of fix (machine-verified) |
|---|---|---|---|
| Client-side-only control plane | **W140** (TL scope) | **MERGED** @ integration/wave0 `0f08fd7` | Server-only request-scoped Neon DurableRecordStore behind DATABASE_URL; `/api/session` httpOnly-cookie sign-in (fails closed on every malformed/unknown/expired/revoked/tenant-mismatch); `/api/enrollment/{codes,redeem}` through the REAL createEnrollmentRequest boundary (W130-shape one-time codes, viewer frozen words); `/api/agent/check-in` + `/api/agent/observations` with durable idempotency, back-pressure shed, REAL twin mutation; driver isolation machine-proven; a real agent enrolls, checks in, and causes a real observation end-to-end. TL gates at `a039db8`: check 4/4 (150-contract snapshot unchanged), typecheck 0, bun test 3394/0 (+55). |
| Device Doctor + Recovery placeholders (unbound lanes) | **W141** (Worker A) | **MERGED** @ integration/wave0 `c6bfe45` | `composeDeviceDoctorFeed` (nine-stage diagnosis journey, severity-first evidence-anchored symptom walk, remediation walk with Guardian decision); `composeRecoveryCasesFeed` (seven-stage per-case journeys), `composeFindMyDeviceFeed` (honest `no_location_evidence`), `composeDestructiveActionsFeed` (four gated actions); every un-routed stage honestly `not_yet_observed`/`not_decided`/`not_evaluated`; confirmation flow refuses without explicit `CONFIRM <ACTION> <deviceId>` and routes only through the REAL gated boundary, writing audit entries into the REAL hash-chained log. TL gates at `f7c18a9`: check 4/4, typecheck 0, bun test 3380/0 (+41); post-merge composition gates on the merged tree 3435/0 (3339+55+41, zero cross-lane interference). |
| Security Doctor walk + Fleet Actions plans + **inert Approve/Reject** | **W142** (Worker B) | **MERGED** @ integration/wave0 `a1562b2` | `composeSecurityDoctorFeed` (the 9-stage finding → inspect → proposed remediation → Contract Guardian decision → approval → human confirmation → execution → evidence → verified-result journey); `composeFleetActionsFeed` + `composePrintDistributionFeed`; `approvals-execution.ts` makes the report's central demand real: Approve → confirmation dialog with the typed `CONFIRM <ACTION> <planId>` phrase gate (never one-click) → RBAC authorization gate (restricted roles get the machine-stable `authorization_required` refusal with escalation path, never a silent no-op) → the injected gated boundary owns the state change → BOTH audit entries (explicit-confirmation + dispatched) write through the structural `SecurityDecisionAuditSink` → duplicate-safe `already_decided` (original record stays authoritative) → cancelled confirmation writes nothing; Reject records reason/state, plan does NOT execute; gated destructive controls (`disable_enrollment_code`, `revoke_device_trust`) follow the W141-disclosed pattern with explicit confirmation + visible RBAC denial + dispatch audit entries. TL gates at `d538d56`: check 4/4 (150-contract snapshot unchanged), typecheck 0, bun test 3521/0 (+86 over the 3435 baseline); post-merge gates on the merged tree 3521/0; scope verified (19 files, `apps/web/security` + `apps/web/actions` only, 6360 insertions, no console-app edits). |
| Workloads planning + Commerce procurement placeholders | **W143** (Worker C) | **RUNNING since 11:21Z Oct 4** (fresh GLM-5.2 dispatch on the unlocked agent pipeline — chat 62304588; the original parked chat f474b538 is superseded: it is GLM-5.3 model-gated and in-chat model is fixed per chat) | Same binding pattern; planning walk fleet inventory → proposal → recommendation review → decision → plan → evidence; procurement case journeys need → case → vendor context → authorization → decision → order → evidence; honest empties. |
| SMALL-firm cold start (no import path) + mobile roster overflow | **W145** (Worker A) | **PACKET PREPPED** — dispatches when a slot frees | Declared-import surface provenance-flagged DECLARED (never conflated with OBSERVED — marking, not exclusion); mobile priority-card roster below ~480px (993px table → card list, no horizontal scroll, same REAL runtime state). |
| Console runtime binding of all lanes + server-side composition root + deploy | **W144** (TL scope, TL-scope-grant worker + TL re-verification) | **QUEUED** — composes on the merged tree after W142/W143/W145 | Binds the six lanes' deep views into the console runtime over the compositions; wires the approvals inbox to the executed decision path; composition-root wiring so the deployed tier resolves sessions + enrollment server-side while development keeps the localStorage seam; end-to-end browser journeys per lane; Vercel deploy + post-deploy check + SIM-B-style re-verification of the six lanes and the Approve/Reject journey on production. |
| Cross-tenant join-code defect | W130 (Wave 12) | **FIXED + ACCEPTED** (pre-Wave-13) | Live-verified on production during W130 acceptance; regression-checked in every Wave-13 gate run (check 4/4 includes the frozen contracts). |

**Integration tree:** `integration/wave0 @ a1562b2` — 3521/0 tests (3339 base + 55
W140 + 41 W141 + 86 W142), check 4/4, typecheck 0. Every merge is `--no-ff` with the full
TL acceptance record in the commit message; every gate re-run is independent (a
fresh clone at the exact delivered commit, never the worker's own run).

### 3.1 Evening operational record (2026-10-03, the honest timeline)

- **12:15–16:49Z — platform outage:** the browser VPN tunnel died; chat.z.ai's edge
  blocked every completions POST from the fallback sandbox egress (GETs passed,
  POSTs got the 405 gateway page). This killed the W142 attempt-1 stream
  mid-generation and poisoned every subsequent send ("No response, Please try
  again later."). Root-caused and fixed 16:49Z; the §8 quota-drain doctrine of
  2026-09-30 shows the same signature and is flagged for re-examination.
- **Same window, site-side:** the Full-Stack skill chip began routing dispatches to
  a broken `web_dev` surface (cold-boot route-guard bounce, http-500-wedged
  records, tasks that cannot see their own packet). All Wave-13 lanes now dispatch
  on the healthy `general_agent` path (agents tab + GLM-5.3, skill omitted) — a
  documented deviation that serves the operator directive's intent.
- **Since ~16:52Z — GLM-5.3 account capacity gate** (model-specific: GLM-5.2
  generates fine; GLM-5.3-Flash is offered but forbidden by the standing operator
  directive). Signature matches the documented daily-quota drain with a
  05:38–09:36Z reset window.
- **Armed and durable overnight:** 300s gate probes with an instant lane playbook
  (w143 begin-directive + w142 packet send; 30-min re-nudge cooldown; horizon
  through ~10:46Z); one completion oracle per lane on the parked chats;
  server-side batch-growth tracking; an origin guard; outage-hold anti-churn
  discipline. All lane state is durable across sandbox resets.
- **Deadline honesty:** the midnight deadline for the full chain (W142/W143 →
  W145 → W144 → deploy → rerun) was not met — the outage consumed the working
  window. This ledger records exactly what landed; the autonomous machinery
  maximizes what lands overnight; the morning session completes the chain.

### 3.2 Morning operational record (2026-10-04, the blocker root-caused and cleared)

- **The 17-hour "GLM-5.3 capacity gate" was root-caused at ~10:15Z and it was
  not a model quota.** The platform's account-level *sandbox concurrency
  limit* ("Limit Sandbox Concurrency — current active sandboxes exceed the
  limit, please release") had been saturated by stale sandboxes: the w143
  chat's own sandbox had been held ~16h by the zombie probe turn (task never
  started), plus two idle `ws-` sessions of unknown (possibly sibling-session)
  provenance. With the pool full, agent-surface sends either dropped silently
  (in-chat GLM-5.3 sends: composer clears, nothing lands server-side) or
  queued forever (fresh sends: message lands, batch store stays empty). The
  documented "reset window 05:38–09:36Z" doctrine is retired — a full cycle
  passed with the gate never opening because it was never a timed quota.
- **The unlock:** releasing the stale w143-chat sandbox (the platform's
  release button needs a front-focused tab and real pointer events —
  programmatic clicks are ignored) immediately restored generation. The chat
  surface had generated fine throughout (different pool), which is what made
  the model-quota diagnosis plausible for so long.
- **Second discovery:** the GLM-5.3 *model* capacity message is real but
  separate — an in-chat begin-directive on a GLM-5.3 chat was refused with
  "intensifying the coordination of resources" even with free sandbox slots,
  and the in-chat model is fixed per chat (cannot switch to GLM-5.2). The
  operative dispatch path is therefore: **fresh chats on GLM-5.2** (allowed,
  not the operator-forbidden GLM-5.3-Flash), one lane at a time, with the
  completed lane's sandbox released explicitly before the next dispatch
  (completed-task sandboxes linger and re-saturate the pool).
- **W142 ran ~48 minutes on GLM-5.2 and delivered clean** (see the fix
  ledger); W143 was fresh-dispatched on the same path at 11:21Z and is
  running. The quality risk of the weaker model is bounded by the unchanged
  acceptance protocol: TL gates re-run at the exact delivered commit, scope
  review, and the post-merge battery on the merged tree.

## 4. Post-fix rerun (the identical journeys)

**PENDING DEPLOYMENT.** The rerun executes the SIM-B script — same industries,
same firm sizes, same persona count, same journey set, same mobile passes, same
verdict rubric — against the post-fix deployment. Sections 4.1–4.8 to be filled
from that run only.

- 4.1 Panel + workspace creation record — TBD
- 4.2 Per-industry journey results — TBD
- 4.3 The six previously-placeholder lanes — TBD (the regression check: each lane
  must now run its full journey on REAL runtime state; honest empty states are
  acceptable only where no data exists, never as a substitute for a bound lane)
- 4.4 Approve/Reject + destructive-control execution — TBD (the central inert-control
  regression target: dialog → decision record → state change → evidence, or an
  explicit frozen denial for restricted roles)
- 4.5 Real-agent check-in end-to-end — TBD (enrollment → check-in → observation →
  twin update through the server-side control plane)
- 4.6 Declared-import + mobile roster — TBD (SMALL-firm cold start; 390px no-overflow)
- 4.7 Verdict distribution + before/after delta — TBD
- 4.8 Residual blockers, each traced to the minimal actionable cause — TBD

## 5. Acceptance statement

**PENDING.** Wave 13 closes only on this report's completion with the before/after
counts, the regression evidence, the production browser evidence, and the post-fix
adoption result — per GitHub issue #2. Unit tests and implementation claims alone
do not close it.
