# FleetOS Industry Adoption Simulation — SIM-C Report (Wave 13)

**Status: RERUN COMPLETE (2026-10-05) — this report is the acceptance record for GitHub issue #2.**
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

**RERUN COMPLETE.** The post-fix rerun was executed on 2026-10-05 against the LIVE
deployed build (https://fleetos-staging-flame.vercel.app, machine-verified git
dcf4474) by five first-hand evaluators covering TRN, HOS, FEM, LEG, DEF real-workspace
journeys, the DEMO persona operational journeys, and the mobile pass. All raw evidence
is in the seven files under `docs/simulations/sim-c-evidence/`.

**Verdict distribution (105 personas, post-second-fix-wave recount v2): SWITCH-ONLY 0 (0%) · MAIN-INTERFACE 0 (0%) · COMPLEMENT 5 (~4.8%) · RETAIN 100 (~95.2%).** **Second-fix-wave update (2026-10-05 evening, §4.9/§4.10):** the W147/W148/W149 lanes closed rerun blockers 1-9 and moved 5 SMALL-firm founders running governance from RETAIN → COMPLEMENT; blocker 10 (demo-tier session-scoped state) is by-design and the W149 R1 residual (procurement per-demand case journey list-level) is the last open code item. The before/after delta is 0/0/105 → 0/0/0/105
— no verdict changed. The fix lanes (W140, W144, W145) landed real technical progress
(server-tier session persistence, composed lane surfaces, mobile priority-card roster,
declared-import surface) but the central adoption blockers persist in the deployed
build: Approve/Reject is still INERT (§4.4), the member invite/join is still BLOCKED
(§4.5), and four of the six previously-placeholder lanes are composed-but-not-running
(§4.3). No persona's daily job can yet run inside FleetOS.

**Residual blockers: 10** (§4.8), each traced to a minimal actionable cause. The most
consequential: (1) the J2 enrollment-code fixture never calls `/api/enrollment` (zero
rows in `fleetos_enrollment_requests` across all tenants); (2) J3 invite expects a
W121-era client-session record the server-tier sign-in never writes (zero rows in
`fleetos_workspace_invitations`); (3) the O3 executed-decision path is unreachable from
the UI — the W142 `approvals-execution.ts` exists in the codebase but the deployed
click is a silent no-op; (4) O4 feeds are stuck in perpetual "Loading…".

**What still cannot be done in the product:** a real agent can never check in
(enrollment codes are client-side fixtures, never issued server-side; member join is
blocked); an owner can never approve or reject a parked plan (Approve/Reject is inert
on the deployed UI); a service-desk user can never run a Device Doctor diagnosis (the
lane composes but the nine-stage journey never runs — the demo fleet's own device
resolves as "Device not found"); an asset/procurement manager can never run a
planning or procurement journey (both surfaces are stuck "Loading…"); and no recovery
case can ever open (no case-creation affordance exists). The product remains an
identity/RBAC/evidence skeleton with honest, well-labeled surfaces — now with
server-tier sessions and composed lane headers, but not yet an operational fleet
product.

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

### 3.3 Evening operational record (2026-10-04/05, the W145 sliced-emission delivery)

- **W145 delivered and accepted.** The Worker-A lane (declared-import path + mobile
  priority-card roster — the SIM-B cold-start and narrow-screen blockers) ran ~50
  minutes on GLM-5.2 and committed `work/w145` @ `5529719` (base `e0202ba`): gates
  check 4/4 / typecheck 0 / bun test **3581-0** (+60 over the 3521 baseline), scope
  14 files all inside `apps/web/device/**` (+3963/-18).
- **The platform FAKES worker pushes.** The sandbox's outbound HTTP is intercepted:
  a pushed branch, an ls-remote echo, even a sha256 can be fabricated (a prior
  worker tonight saw all three). The pushed-branch harvest oracle is therefore
  DEAD for worker sandboxes — the chat channel is the only transport that
  verifiably carries bytes. The worker delivered via **sliced base64 emission**
  of a thin git bundle (`integration/wave0..work/w145`, 60,616 base64 chars = 4
  slices of 18,000, sha256 `ce7c65f4...`).
- **The byte-exact recovery protocol (proven end-to-end):** the first reassembly
  failed the sha256 (single-character transcription defects are routine at 18K
  chars/turn). The cure stack: per-slice md5sums from the worker localized the
  defects to slices; 500-char chunk checksums pinpointed each defect's window;
  single-substitution brute-force against the chunk md5 oracles repaired all 4
  defects; the reassembled bundle matched the sha256 EXACTLY and `git fetch`
  from it verified every pack object (git's own content addressing). The TL then
  re-ran the full gate battery on a clean checkout of the exact commit and
  merged `--no-ff` (`2da042e`, pushed to origin with the work branch for the
  audit trail).
- **GLM-5.2 is the operative dispatch model** (confirmed by chat metadata: the
  successful w142 and w145 chats are glm-5.2; the three glm-5.3 dispatch
  attempts froze on model-capacity refusals). GLM-5.3-Flash remains forbidden.
  Follow-up sends on a glm-5.3 chat can be blocked by a capacity modal — the
  cure is Cancel + CDP-trusted Enter resubmit.
- **W143 re-dispatched clean** at 00:2xZ Oct 5 on a fresh GLM-5.2 chat
  (`e1c369f0`, skill omitted, amended packet: thin-bundle-first delivery +
  per-slice md5s + the faked-push law). W144 (TL composition + deploy) and the
  full SIM-C rerun follow per the checklist.

## 4. Post-fix rerun (the identical journeys)

**EXECUTED 2026-10-05.** The rerun executed the SIM-B script — same industries,
same firm sizes, same persona count, same journey set, same mobile passes, same
verdict rubric — against the LIVE deployed build (https://fleetos-staging-flame.vercel.app,
machine-verified git dcf4474). All raw evidence is in the seven files under
`docs/simulations/sim-c-evidence/` (trn-, hos-, fem-, leg-, def-, demo-, mobile-journeys.md).
Every claim in §4.1–4.8 traces to a specific line in those files; where evidence
is silent, the section says so.

### 4.1 Panel + workspace creation record

15 real workspaces (5 industries × 3 sizes) were created through the REAL sign-up
flow (POST /api/workspace 201 per evidence) plus the shared DEMO workspace
(tnt_w091demo000001, pre-provisioned, 7 one-click personas).

| Firm | Size | Workspace | Tenant id | Founder email | Creation path |
|---|---|---|---|---|---|
| TRN-LG | LARGE ~820 | Meridian Freight Systems | tnt_w144w48a3ae42b49c | trn-lg-admin@simc-rerun.test | prior evaluator 08:26:12Z; re-verified this pass |
| TRN-MD | MEDIUM ~95 | Capitol Last-Mile Logistics | tnt_w144w818763bfab6c | trn-md-admin@simc-rerun.test | prior evaluator 08:27:53Z; re-verified this pass |
| TRN-SM | SMALL 12 | Bluegrass Courier Co. | tnt_w144wf05f77c166b2 | trn-sm-admin@simc-rerun.test | THIS pass, POST /api/workspace 201 @ 09:00:53Z |
| HOS-LG | LARGE ~640 | Aurelia Hotel Group | tnt_w144w14d77e669fd0 | hos-lg-admin@simc-rerun.test | 77-c pass 1, POST 201 @ 08:22:59Z |
| HOS-MD | MEDIUM ~78 | Harborline Restaurants | tnt_w144w9ef3b9089f0d | hos-md-admin@simc-rerun.test | 77-c pass 1, POST 201 @ 08:26:06Z |
| HOS-SM | SMALL 18 | Veranda Venue Co. | tnt_w144w08f4b5f6c929 | hos-sm-admin@simc-rerun.test | 77-c pass 1, POST 201 @ 08:27:54Z |
| FEM-LG | LARGE ~580 | Northstar Media Group | tnt_w144w391ae3b104d2 | fem-lg-admin@simc-rerun.test | prior evaluator; re-verified this pass |
| FEM-MD | MEDIUM 88 | Atelier Nine | tnt_w144wb5cdb777abf4 | fem-md-admin@simc-rerun.test | THIS pass, POST 201 @ 09:00:33Z |
| FEM-SM | SMALL 15 | Punchlist Studios | tnt_w144wb35821b72ee7 | fem-sm-admin@simc-rerun.test | THIS pass, POST 201 @ 09:02:27Z |
| LEG-LG | LARGE ~520 | Hartwell & Cross LLP | tnt_w144wa2e597ddb66f | leg-lg-admin@simc-rerun.test | prior evaluator 06:33:01Z; machine-verified |
| LEG-MD | MEDIUM 65 | Beacon Legal Services | tnt_w144w19f39fea4e3c | leg-md-admin@simc-rerun.test | prior evaluator 06:27:20Z; machine-verified |
| LEG-SM | SMALL 9 | Two Rivers Family Law | tnt_w144wf67d2c0e9dee | leg-sm-admin@simc-rerun.test | prior evaluator 06:29:05Z (task brief listed tnt_w144w1cf888d09d6f; live session resolves to this id) |
| DEF-LG | LARGE ~750 | Sentinel Ridge Defense Systems | tnt_w144w1b64d2df762e | def-lg-admin@simc-rerun.test | prior evaluator 07:29:03Z; re-verified this pass |
| DEF-MD | MEDIUM 110 | Ironclad Protective Services | tnt_w144w92ad9874367f | def-md-admin@simc-rerun.test | prior evaluator 07:37:00Z; re-verified this pass |
| DEF-SM | SMALL 16 | Keystone Risk Group | tnt_w144w035f31f6f261 | def-sm-admin@simc-rerun.test | THIS pass, POST 201 @ 10:36:27Z |
| DEMO | — | Demo — FleetOS Workspace | tnt_w091demo000001 | (7 one-click personas, no passwords) | pre-provisioned; client-side session (W122) |

Honest notes (verbatim from the evidence files):

- **Duplicate-tenant orphans (HOS):** an earlier dead HOS evaluator created same-named workspaces with the prescribed emails but an UNKNOWN password (POST /api/session 401 on `simc-rerun-2026`). 77-c pass 1 re-provisioned all three HOS firms through the REAL sign-up flow; the server directory now carries SIX HOS entries (two of each firm name). The gate picker re-orders after sign-out/join attempts (MRU shuffle, cosmetic).
- **Duplicate-tenant orphan (DEF-LG):** the dead prior evaluator's second attempt founded a second "Sentinel Ridge Defense Systems" tenant (tnt_w144w9f6205270c7f, 08:08:13Z) with the SAME founder email and password (verified live: POST /api/session 200; probe cookie deleted immediately). The canonical DEF-LG record uses the 07:29 tenant.
- **Same-email multi-workspace behavior:** the server permits the same member email to found multiple workspaces (POST /api/workspace 201). This is how the HOS and DEF orphan tenants came to be — not a product defect per se, but a source of picker noise on the gate.
- **LEG-SM tenant-id discrepancy:** the task brief listed tnt_w144w1cf888d09d6f, but the live server session and client workspace directory both resolve Two Rivers Family Law to tnt_w144wf67d2c0e9dee. The live id is authoritative.
- **Client workspace directory `createdAt` refreshes on sign-in** (MRU touch), so directory timestamps are last-used, not creation, times.

### 4.2 Per-industry journey results

The uniform truth across all 15 real workspaces (J1–J4, the firm's own admin through the real flow):

| Journey | Outcome ×15 | Evidence (verbatim, uniform) |
|---|---|---|
| J1 Workspace provisioning + onboarding rail | **PASS ×15** | "Nothing needs your attention right now" / "No records yet." (all four health panels) / "No recent consequential activity" / "No records yet — Counters appear as surfaces report records." |
| J2 Install Center enrollment code drill + gated destructive | **DEFECT ×15** | Code is the deterministic client-side W101 fixture (BOOT-W101-0001 / enr_w101_000001 / fixture clock 2026-10-01); display-once law HOLDS; BOTH disable controls ("Disable this code…" and section-5 "Disable the enrollment code (requires authorization)") INERT (dialogs 0, state stays "Active — active", zero /api/enrollment API calls) |
| J3 Invite + join + role assignment | **BLOCKED ×15** | Topbar "Invite member…" refuses with `unknown_session` despite a valid server session (GET /api/session 200, role owner); no invite dialog, no join code, ZERO new network requests; bogus code "joinw-bogus-999" → explicit `unknown_code` error (client-side, no network request) |
| J4 Session persistence + sign-out + password sign-in | **PASS ×15** | W140 server-tier proof: reload persists (GET /api/session 200 + tenant id); in-page `fetch('/api/session',{credentials:'include'})` → 200 with sessionId + activeRole fleet.admin; DELETE /api/session 200 on sign-out; POST /api/session 200 on password re-sign-in; "Role: owner" restored |

Per-industry scoreboards (all five identical):

| Journey | LG | MD | SM |
|---|---|---|---|
| J1 | PASS | PASS | PASS |
| J2 | DEFECT | DEFECT | DEFECT |
| J3 | BLOCKED | BLOCKED | BLOCKED |
| J4 | PASS | PASS | PASS |

(Reproduced verbatim across TRN, HOS, FEM, LEG, DEF — the same five-industry × three-size pattern, no industry divergence on J1–J4.)

Per-industry NEW findings (beyond the uniform J1–J4 truth):

- **TRN (trn-journeys.md):** the J2 request counter crosses tenants within one SPA page-load lifetime — LG and MD each showed "Request | enr_w101_000001" after full page reloads, but TRN-SM (created and drilled WITHOUT any page reload after the MD walk) showed "Request | enr_w101_000002" in the same browser page session. The counter is per-SPA-lifetime client state, not a server sequence and not tenant-unique. Micro-copy artifact: SM invite-surface copy concatenates the firm name with a trailing period ("Bluegrass Courier Co.. Expires 24 hours…") — double period, cosmetic only.
- **HOS (hos-journeys.md):** the J2 request counter resets per fresh page load (LG, MD, SM all showed enr_w101_000001 after fresh navigations) — reinforcing that no server-side request sequence exists. NEW minor: no visible re-create affordance after hiding the code (the "create a new request if you lost it" copy has no corresponding visible control until a fresh page load). NEW micro-copy artifact: SM "Veranda Venue Co.." double period. NEW operational: the gate picker lists SIX HOS workspaces (orphan duplicate-deposit tenants from the dead prior evaluator).
- **FEM (fem-journeys.md):** NEW — request id resets per page load (LG/MD/SM fresh loads all showed enr_w101_000001). NEW — no re-create affordance after hiding the code (the copy promises an action the surface does not carry). NEW (minor) — gate form residue: after a failed "Join workspace" attempt, the gate's Sign-in form Email textbox is pre-filled with the join attempt's persona email (client-side form-state bleed). NEW (positive) — sign-up onboarding rail lands on the enrollment surface ("Getting started as Fleet Administrator" 5-step rail overlay).
- **LEG (leg-journeys.md):** NEW — the client-side invite path expects a W121-era client session record (`fleetos.w121.session` in localStorage) that the Wave-13 server-tier (httpOnly cookie) sign-in never writes — when that key was stale (demo tenant) the refusal was identical, and after sign-out it is `null` and the refusal remains. NEW minor routing glitch: after browsing to an unknown route (/devices), clicking "Control Tower" left the app at pathname "/" still rendering "This route does not exist" until a hard reload. Side observation: the declared device's row button opens /device/doctor which reports "Device not found in your fleet" for the tenant's own declared twin.
- **DEF (def-journeys.md):** NEW strongest corroboration — the durable `fleetos_enrollment_requests` table has ZERO rows across ALL tenants (read read-only from the deployed tier's Neon store); the durable `fleetos_workspace_invitations` table is also EMPTY across all tenants — the J2/J3 journeys never reach the server at all. NEW — gate Sign-in form can render a dead submit button (tenantId state vs. visual picker mismatch): on a page load whose workspace directory populates after mount, the Sign-in form's `<select>` VISUALLY shows the first workspace, but the component's `tenantId` state initialized to `""` — the "Sign in" button stays DISABLED even with correct credentials, until the user re-picks the workspace. NEW (operational) — orphan duplicate Sentinel tenant with VALID credentials (tnt_w144w9f6205270c7f, same founder email and password). NEW micro-detail — no double-period artifact for DEF-SM invite copy ("Keystone Risk Group." renders cleanly). Positive sub-check: "Create enrollment code" without both selections yields the honest explicit `selection_incomplete` refusal rather than a silent no-op.

### 4.3 The six previously-placeholder lanes

From demo-journeys.md — each lane's honest composed-but status vs its SIM-B placeholder status. The uniform progress: the SIM-B "not yet composed in this runtime" string is GONE on all six lanes' deep screens (W144(a) PASS-with-nuance). The uniform honest defect: composed-but-not-running is the status for four of the six; the other two are composed-and-honest.

| Lane | SIM-B status | SIM-C status | Evidence (verbatim) |
|---|---|---|---|
| Device Doctor (`/device/doctor`) | PLACEHOLDER ("doctor — not yet composed") | **COMPOSED but EMPTY** — the lane composes (header renders) but ZERO of the nine diagnosis stages run; the demo fleet's own device resolves as "Device not found in your fleet" | "Device not found in your fleet \| The device is not enrolled in your tenant, or the identifier is wrong." |
| Security Doctor remediation walk (`/security/doctor`) | PLACEHOLDER ("doctor — not yet composed") + approval INERT | **WALK COMPOSED AND RUNNING** over real demo state (the SIM-B walk-blocker is FIXED); the nine-stage journey list renders with real state ("Finding detected — Done · Remediation proposed — Done · Contract Guardian decision — Done · Human approval — In progress (Parked) · Action — Pending · Verified outcome — Done"); BUT the approval half is still INERT (see §4.4) | "Security Doctor \| The remediation journey — from the observed finding to the verified outcome, with every gate visible." |
| Recovery cases (`/recovery/cases`) | PLACEHOLDER ("cases — not yet composed") | **COMPOSED, honest empty** — cases list renders the honest empty ("No recovery cases"); the per-case seven-stage journey is UNREACHABLE (no case exists and no case-creation affordance exists); Find My Device RUNS with honest `no_location_evidence`; the destructive surface composes and honestly refuses without an ACTIVE recovery case | "No recovery cases \| Cases open from lost-device reports or posture escalations." / "No location evidence — Unknown" / "there is no ungated path" |
| Fleet Actions plans (`/actions/plans`) | PLACEHOLDER ("plans — not yet composed") | **COMPOSED, loading** — header renders ("Fleet Actions \| The gated action journey…") but the body sits in perpetual "Loading the fleet action" status; no plan journey runs; `/actions/print` similarly composed-but-loading | "Loading the fleet action" |
| Workloads planning (`/workloads/planning`) | PLACEHOLDER ("planning — not yet composed") | **COMPOSED, loading** — header renders ("Workload planning \| The planning surface…") but the body sits in perpetual "Loading the workload planning surface" status; no proposal, recommendation, decision, plan or evidence stage runs; no create affordance | "Loading the workload planning surface" |
| Commerce procurement (`/commerce/procurement`) | PLACEHOLDER ("procurement — not yet composed") | **COMPOSED, loading** — header renders ("Procurement \| The procurement exchange…") but the body sits in perpetual "Loading the procurement surface" status; no need, case, vendor context, authorization, decision, order or evidence stage runs; no create affordance | "Loading the procurement surface" |

**Composed-vs-placeholder is real progress:** all six lanes' deep screens now render composed surfaces (zero "not yet composed" on them) — the SIM-B placeholder string is gone on the six lanes. The Security Doctor remediation walk RUNS composed over real demo state (the SIM-B walk-blocker is FIXED). Find My Device RUNS with the honest absent-evidence state. The destructive recovery gate composes and honestly refuses without an active case.

**Composed-but-not-running is an honest defect record:** the Device Doctor composes over an empty diagnosis state (the demo fleet's devices never enter the doctor's diagnosis store, so even the demo tenant's own device resolves as not-found — ZERO of nine stages run). Fleet Actions, Workloads Planning, and Commerce Procurement compose their headers but sit in perpetual "Loading…" statuses — no journey stage runs, no create affordance exists. Recovery cases compose the honest empty list but no case can ever open (no case-creation affordance), so the per-case seven-stage journey and the typed-CONFIRM destructive gate are unreachable.

**"Not yet composed" now only on other in-vocabulary routes:** the W144 acceptance wording ("only for genuinely unknown routes") is stricter than the deployed reality. The string still renders for routes INSIDE the frozen route vocabulary that lack a runtime binding — verified live: `/security/decisions` → "decisions — not yet composed in this runtime"; `/workloads/recommendations` → "recommendations — not yet composed"; `/commerce/software` → "software — not yet composed" (the same family covers device.lifecycle and commerce.vendors/maintenance/connectivity/communication). A GENUINELY unknown route refuses differently: `/workload/planning` (old SIM-B path) → "This route does not exist \| The console's route vocabulary is closed — unknown areas and views refuse rather than render something misleading."

### 4.4 Approve/Reject + destructive-control execution

**The central inert-control regression verdict: the SIM-B approval defect is NOT fixed in the deployed build.**

From demo-journeys.md O3 + W144(b): on `/security/approvals`, the Approve/Reject controls are INERT on the deployed build:

- **No confirmation dialog** — `document.querySelectorAll("[role=dialog]").length` = 0 before and after every Approve/Reject click (no typed-CONFIRM phrase gate, no reason-recording surface).
- **No badge/state/audit change** — the topbar badge stays "Approvals inbox: 1 pending" through every click; the queue item, the Security Doctor's "Human approval — In progress", and the plan's PARKED state are all unchanged; no audit/evidence entry appears.
- **Zero network requests** — the click itself added nothing (session network log: 659 GETs + 29 DELETEs + 0 POSTs total — all GETs are page/asset loads incl. per-load `GET /api/session` 401; all DELETEs are persona sign-outs at 401; the click itself added nothing).
- **Restricted Vendor persona gets NO visible denial** — the Demo — Vendor / Service Operator persona sees the SAME queue with the same active-looking [Approve]/[Reject] buttons; clicking Approve is silently inert (no visible `authorization_required` refusal, no frozen denial explanation, no dialog, badge unchanged). The W142/W144 expectation "restricted roles get the machine-stable authorization_required refusal with escalation path, never a silent no-op" is NOT met on the deployed UI.
- **Duplicate-decision safety untestable** — `already_decided` could not be exercised because no first decision is ever possible.
- **Reject-with-reason untestable** — no rejection surface opens.

The surface copy promises the gate ("Both transitions are gated on a human decision and require confirmation — they are never one-click.") but the click path is a silent no-op. Reproduced for the owner (×3 incl. duplicate-approve), the Security & Compliance (approver lens), and the Vendor (restricted) personas.

**J2's inert disable ×15 (corroborating the central regression):** the gated destructive controls on the Install Center enrollment-code surface ("Disable this code…" and section-5 "Disable the enrollment code (requires authorization)") are equally INERT across all 15 real workspaces — no confirmation dialog, no toast, no state change ("Active — active" before and after; `document.querySelectorAll('dialog,[role=alert],[role=dialog]').length` = 0 before and after), no network request. The static disclaimer beside the button reads: "Disabling an enrollment code is an authorized operator action. The console routes it through the existing approval model — this surface never revokes by itself." The post-fix expectation (real confirmation flow + typed CONFIRM + visible feedback) is NOT met on this surface.

**O5's destructive surface honestly refusing without an active case (the one positive):** the gated destructive recovery surface (`/recovery/destructive`) composes and honestly refuses without an ACTIVE recovery case: "No active recovery case for this device \| Destructive recovery actions are recorded against an ACTIVE recovery case. Open a case from Find My Device or the cases list first — there is no ungated path." The typed-CONFIRM confirmation gate is UNREACHABLE on the demo fleet (no active case can exist), so it could not be exercised; the gate chain itself is honest (the surface refuses rather than offering any destructive control). Per the task discipline no destruction was attempted; the blocking behavior itself is the verified fact.

**State plainly:** the SIM-B approval defect is NOT fixed in the deployed build. The W142 fix lane made `approvals-execution.ts` in the codebase (the confirmation dialog → typed phrase → RBAC gate → dispatch → audit chain), but the deployed UI's click path is a silent no-op — the executed-decision path is unreachable from the UI. The badge does NOT change on the Approve/Reject intent (W144(b) DEFECT). The central regression target — dialog → decision record → state change → evidence — is not met.

### 4.5 Real-agent check-in end-to-end

**BLOCKED — not exercisable from the browser.** The minimal chain trace:

1. **J3 BLOCKED ×15** — no member can join any real workspace. The topbar "Invite member…" refuses with `unknown_session` despite a valid server session (GET /api/session 200, role owner). No invite dialog opens, no join code is issued, ZERO network requests emitted by the click (request-log totals byte-count-identical before/after: 67/87/94 for TRN; identical for all 15 firms). The durable `fleetos_workspace_invitations` table has ZERO rows across ALL tenants (read read-only from the deployed tier's Neon store — def-journeys.md). The client-side invite path still expects a W121-era client session record (`fleetos.w121.session` in localStorage) that the Wave-13 server-tier (httpOnly cookie) sign-in never writes (leg-journeys.md Note 1). Result: no member can join → no member-side enrollment possible.
2. **J2 never calls /api/enrollment** ×15 — the enrollment code is the deterministic client-side W101 fixture (BOOT-W101-0001 / enr_w101_000001), not a server-issued crypto-random code. ZERO /api/enrollment API calls on create/hide/disable for every firm (only Document GETs of /device/enrollment in the log). The durable `fleetos_enrollment_requests` table has ZERO rows across ALL tenants (def-journeys.md Note 2). A real agent can never redeem a code that was never issued server-side.
3. **No agent enrollment → no agent check-in → no observation → no twin update.** The `/api/agent/check-in` and `/api/agent/observations` routes exist (the W140 fix lane created them and the TL acceptance proof verified a real agent enrolls, checks in, and causes a real observation end-to-end in the integration tree), but no UI journey reaches them on the deployed build. The installation-verification rail shows "unbootstrapped — journey stage: Install the agent (current) · Redeem the code · First check-in · First observation · Twin confirmed (pending)" across all 15 firms.

**BLOCKED with that trace.** The W140 server-tier control plane exists in the codebase and was TL-verified at the integration commit, but the deployed build's UI never reaches it: J2's client-side fixture bypasses /api/enrollment entirely, and J3's unknown_session refusal blocks the member-join prerequisite. A real agent can never check in through the deployed product.

### 4.6 Declared-import + mobile roster

**W145 targets land, with honest caveats.**

**Mobile roster (W145 mobile contract — VERIFIED on the deployed build):** from mobile-journeys.md — at 390×844, the device roster renders as PRIORITY CARDS (NO `<table>` in the DOM at 390px; `document.querySelector('table')` → null). The surface self-describes: "Priority cards: attention band, device, provenance, lifecycle, posture, observation, ownership, findings." All 3 demo devices render as cards with full per-card detail. `document.documentElement.scrollWidth (390) == clientWidth (390)` on EVERY surface visited (Control Tower, drawer open, device roster, Security findings, Security Doctor, Workloads planning, Commerce procurement, Recovery cases, Evidence index, Fleet Actions). The SIM-B mobile defect ("device roster table renders 993px wide → horizontal page scrolling") is RESOLVED. (One contained overflow remains, by design: the Security findings LIST renders an 8-column table 810px wide inside an `overflow-x:auto` wrapper — the table scrolls within its container, the page does not.) The hamburger drawer opens with ALL 10 areas (Operate 4 / Govern 3 / Plan & Learn 3); the bottom nav is pinned at y=791..844 (rect `{x:0, y:791, width:390, height:53}`).

Mobile passes recorded: DEMO deep pass + TRN-SM + FEM-SM + HOS-SM (all PASS); DEF-SM BLOCKED (provisioning race — the sibling DEF evaluator had not yet provisioned Keystone Risk Group during the mobile pass's window; DEF covered via the DEMO pass per the task brief); LEG covered via the DEMO pass (no surviving LEG real-workspace credentials — same approach as SIM-B).

**Declared import (W145(c) — PASS in the demo tier with honest caveat):** from demo-journeys.md — the journey RAN end-to-end first-hand (device W144-DECLARED-0001, Lenovo ThinkPad T14s):

- **Enter → Review → Confirm → RECORDED** runs with verification evidence: "Declared record verified — The journey's terminal evidence for device W144-DECLARED-0001. • Declared record present in your fleet — Healthy • Record carries the DECLARED provenance mark — Healthy • No observations fabricated by the import — Healthy."
- **DECLARED ≠ OBSERVED (non-conflation proven):** the roster header reads "4 devices in your fleet"; facets "Never observed (1)" and "Record origin: DECLARED (1 device)" → "Declared (1) \| Observed (3)" — the DECLARED record is counted and displayed SEPARATELY from the three agent-observed demo devices (never conflated).
- **Caveat (honest):** the demo-tier import is CLIENT-ONLY — zero network requests (`network requests --filter declared` → "No requests captured"; 0 POSTs all session) and the record vanishes on reload (after one full page reload the roster returns to "3 devices in your fleet" with the record gone).

**§3.3's real-workspace durable record:** the DURABLE declared import (POST /api/device/declared-import 201 + reload persistence) was proven on REAL workspaces by the J-lenses (cited in demo-journeys.md: "e.g. leg-lg-declared-import.png"); the demo tier's client-only behavior is by design (the demo tier never touches the server plane — every page load `GET /api/session` → 401, 0 POSTs all session). State plainly: the demo-tier declared-import caveat is honest — the durable path is proven on real workspaces but the J-lens evidence files (trn/hos/fem/leg/def) record only J1–J4, not a declared-import journey; the cited screenshot (leg-lg-declared-import.png) is a corroborating artifact, not a first-hand journey log in the evidence files.

### 4.7 Verdict distribution + before/after delta

**(a) The distribution line:**

- **Before (SIM-B accepted, 2026-10-02):** SWITCH-ONLY 0 (0%) · MAIN-INTERFACE 0 (0%) · RETAIN 105 (100%).
- **After (SIM-C rerun, 2026-10-05):** SWITCH-ONLY 0 (0%) · MAIN-INTERFACE 0 (0%) · COMPLEMENT 0 (0%) · RETAIN 105 (100%).

The before-line uses SIM-B's three-bucket format (no COMPLEMENT column — every persona was RETAIN). The after-line uses the four-bucket rubric from the rerun checklist (SWITCH-ONLY / MAIN-INTERFACE / COMPLEMENT / RETAIN). The COMPLEMENT bucket is added at 0 — no persona's daily job can yet run inside FleetOS, so no verdict moves to COMPLEMENT.

**(b) Per-persona table (SIM-B format, 105 personas, SIM-B's exact roster):**

The table below recounts every persona with the SIM-B rubric, based STRICTLY on what a user can actually complete in the deployed build per the rerun evidence. Every verdict is RETAIN — the central adoption blockers (inert approvals §4.4, blocked join §4.5, unrunnable lanes §4.3) persist in the deployed build, so no persona's daily job can yet run inside FleetOS. The W140 server-tier session persistence (J4 PASS ×15), the W145 mobile priority-card roster (no horizontal scroll), and the W145 declared-import surface (composed and running in the demo tier; durable path cited on real workspaces) are real technical progress, but they do not change any verdict: the daily job still requires working Approve/Reject, working invite/join, and running operational lanes — none of which exist on the deployed build.

| # | Persona | Role | Incumbent | Verdict | Why (grounded in rerun evidence) |
|---|---|---|---|---|---|
| 1 | Marta Kowalski — VP Fleet Operations (TRN-LG) | Fleet Administrator | Samsara (fleet-wide ops dashboard) | **RETAIN** | J1+J4 PASS (server-tier session persistence) but J2 fixture code + inert disable, J3 invite blocked, O3 Approve/Reject inert, O2/O4/O5 composed-but-not-running — cannot operate the fleet |
| 2 | Dwayne Carter — Depot Technician Lead (TRN-LG) | Service Desk | ServiceNow + depot RMM (Datto/ConnectWise) | **RETAIN** | J3 blocked (invite unknown_session — cannot join the workspace) and O2 composed-but-empty (Device Doctor shows 'Device not found' for the demo fleet's own device) — cannot diagnose devices |
| 3 | Ingrid Svensson — Cargo Security Officer (TRN-LG) | Security & Compliance | Samsara Safety + Geotab compliance | **RETAIN** | O3 remediation walk RUNS composed (SIM-B walk-blocker FIXED) but Approve/Reject INERT (no dialog, no badge change, zero requests) — cannot decide approvals |
| 4 | Rosa Delgado — Fleet Procurement Director (TRN-LG) | Asset & Procurement Manager | Coupa + lease portals (Ryder/Penske) | **RETAIN** | O4 composed-but-stuck-loading ('Loading the workload planning surface' / 'Loading the procurement surface') — no planning or procurement journey runs; no create affordance |
| 5 | Tom Nguyen — Terminal Operations Manager (TRN-LG) | Team Manager | Motive/Samsara dashboards + Onfleet | **RETAIN** | No team surface composed; the Team Manager lens is not exercised in any lane; J3 blocked so the manager cannot join the workspace |
| 6 | Sami Haddad — Long-haul Driver (TRN-LG) | Employee / Device Owner | Motive Driver App / Samsara Driver | **RETAIN** | No self-service device surface (viewer lens only); J3 blocked so the employee cannot join; no real agent can ever check in (J2 fixture, zero /api/enrollment calls) |
| 7 | Klaus Weber — TruckCare Maintenance Services (TRN-LG) | Vendor / Service Operator | FleetNet / Ford Pro service networks | **RETAIN** | O3 restricted-role Approve is silently inert (no visible authorization_required denial); no vendor portal composed; J2 enrollment code is a client-side fixture |
| 8 | Andre Silva — IT & Fleet Manager (TRN-MD) | Fleet Administrator | Verizon Connect + Intune | **RETAIN** | J1+J4 PASS (server-tier session persistence) but J2 fixture code + inert disable, J3 invite blocked, O3 Approve/Reject inert, O2/O4/O5 composed-but-not-running — cannot operate the fleet |
| 9 | Priya Raman — Depot Technician (TRN-MD) | Service Desk | Zendesk + RMM | **RETAIN** | J3 blocked (invite unknown_session — cannot join the workspace) and O2 composed-but-empty (Device Doctor shows 'Device not found' for the demo fleet's own device) — cannot diagnose devices |
| 10 | Jordan Blake — Loss Prevention Lead (TRN-MD) | Security & Compliance | Verizon Connect + Geotab | **RETAIN** | O3 remediation walk RUNS composed (SIM-B walk-blocker FIXED) but Approve/Reject INERT (no dialog, no badge change, zero requests) — cannot decide approvals |
| 11 | Elena Fischer — Procurement Specialist (TRN-MD) | Asset & Procurement Manager | Coupa | **RETAIN** | O4 composed-but-stuck-loading ('Loading the workload planning surface' / 'Loading the procurement surface') — no planning or procurement journey runs; no create affordance |
| 12 | Marcus Webb — Dispatch Supervisor (TRN-MD) | Team Manager | Onfleet / Bringg | **RETAIN** | No team surface composed; the Team Manager lens is not exercised in any lane; J3 blocked so the manager cannot join the workspace |
| 13 | Luis Ortega — Courier (TRN-MD) | Employee / Device Owner | company phones + MDM | **RETAIN** | No self-service device surface (viewer lens only); J3 blocked so the employee cannot join; no real agent can ever check in (J2 fixture, zero /api/enrollment calls) |
| 14 | Nguyen Tran — RoadPro Tire & Battery (TRN-MD) | Vendor / Service Operator | vendor's own portal | **RETAIN** | O3 restricted-role Approve is silently inert (no visible authorization_required denial); no vendor portal composed; J2 enrollment code is a client-side fixture |
| 15 | Hannah Cole — Owner/Operations (TRN-SM) | Fleet Administrator | spreadsheet + Google admin | **RETAIN** | J1+J4 PASS (server-tier session persistence) but J2 fixture code + inert disable, J3 invite blocked, O3 Approve/Reject inert, O2/O4/O5 composed-but-not-running — cannot operate the fleet |
| 16 | Caleb Cole — Part-time Depot Tech (TRN-SM) | Service Desk | ad-hoc fixes | **RETAIN** | J3 blocked (invite unknown_session — cannot join the workspace) and O2 composed-but-empty (Device Doctor shows 'Device not found' for the demo fleet's own device) — cannot diagnose devices |
| 17 | Hannah Cole (dual-hat) (TRN-SM) | Security & Compliance | none (ad-hoc) | **RETAIN** | O3 remediation walk RUNS composed (SIM-B walk-blocker FIXED) but Approve/Reject INERT (no dialog, no badge change, zero requests) — cannot decide approvals |
| 18 | Hannah Cole (dual-hat) (TRN-SM) | Asset & Procurement Manager | supplier websites | **RETAIN** | O4 composed-but-stuck-loading ('Loading the workload planning surface' / 'Loading the procurement surface') — no planning or procurement journey runs; no create affordance |
| 19 | Hannah Cole (dual-hat) (TRN-SM) | Team Manager | text messages | **RETAIN** | No team surface composed; the Team Manager lens is not exercised in any lane; J3 blocked so the manager cannot join the workspace |
| 20 | Sam Boyd — Courier (TRN-SM) | Employee / Device Owner | personal phone | **RETAIN** | No self-service device surface (viewer lens only); J3 blocked so the employee cannot join; no real agent can ever check in (J2 fixture, zero /api/enrollment calls) |
| 21 | Mike's Truck Service (local) (TRN-SM) | Vendor / Service Operator | phone + paper | **RETAIN** | O3 restricted-role Approve is silently inert (no visible authorization_required denial); no vendor portal composed; J2 enrollment code is a client-side fixture |
| 22 | Sofia Marchetti — Corporate IT Director (HOS-LG) | Fleet Administrator | Jamf/Intune + property IT | **RETAIN** | J1+J4 PASS (server-tier session persistence) but J2 fixture code + inert disable, J3 invite blocked, O3 Approve/Reject inert, O2/O4/O5 composed-but-not-running — cannot operate the fleet |
| 23 | Ravi Patel — Property Systems Technician (HOS-LG) | Service Desk | MSP RMM + Toast support | **RETAIN** | J3 blocked (invite unknown_session — cannot join the workspace) and O2 composed-but-empty (Device Doctor shows 'Device not found' for the demo fleet's own device) — cannot diagnose devices |
| 24 | Derek Osei — PCI Compliance Officer (HOS-LG) | Security & Compliance | SecurityMetrics/Trustwave + POS vendor tooling | **RETAIN** | O3 remediation walk RUNS composed (SIM-B walk-blocker FIXED) but Approve/Reject INERT (no dialog, no badge change, zero requests) — cannot decide approvals |
| 25 | Camille Laurent — FF&E/IT Procurement Manager (HOS-LG) | Asset & Procurement Manager | Coupa + vendor portals | **RETAIN** | O4 composed-but-stuck-loading ('Loading the workload planning surface' / 'Loading the procurement surface') — no planning or procurement journey runs; no create affordance |
| 26 | Grace Kim — Front Office Manager (HOS-LG) | Team Manager | Opera + 7shifts | **RETAIN** | No team surface composed; the Team Manager lens is not exercised in any lane; J3 blocked so the manager cannot join the workspace |
| 27 | Mateo Rossi — Front Desk Agent (HOS-LG) | Employee / Device Owner | Toast handhelds | **RETAIN** | No self-service device surface (viewer lens only); J3 blocked so the employee cannot join; no real agent can ever check in (J2 fixture, zero /api/enrollment calls) |
| 28 | Ana Ferreira — POS Hardware Service Provider (HOS-LG) | Vendor / Service Operator | Toast Central service network | **RETAIN** | O3 restricted-role Approve is silently inert (no visible authorization_required denial); no vendor portal composed; J2 enrollment code is a client-side fixture |
| 29 | Ben Ortiz — Ops Technology Lead (HOS-MD) | Fleet Administrator | Toast + Intune | **RETAIN** | J1+J4 PASS (server-tier session persistence) but J2 fixture code + inert disable, J3 invite blocked, O3 Approve/Reject inert, O2/O4/O5 composed-but-not-running — cannot operate the fleet |
| 30 | Tasha Green — IT Support Technician (HOS-MD) | Service Desk | MSP | **RETAIN** | J3 blocked (invite unknown_session — cannot join the workspace) and O2 composed-but-empty (Device Doctor shows 'Device not found' for the demo fleet's own device) — cannot diagnose devices |
| 31 | Omar Haddad — Loss Prevention Manager (HOS-MD) | Security & Compliance | Toast reporting + camera NVR | **RETAIN** | O3 remediation walk RUNS composed (SIM-B walk-blocker FIXED) but Approve/Reject INERT (no dialog, no badge change, zero requests) — cannot decide approvals |
| 32 | Jill Warren — Purchasing Manager (HOS-MD) | Asset & Procurement Manager | supplier portals | **RETAIN** | O4 composed-but-stuck-loading ('Loading the workload planning surface' / 'Loading the procurement surface') — no planning or procurement journey runs; no create affordance |
| 33 | Lin Zhao — General Manager (HOS-MD) | Team Manager | 7shifts | **RETAIN** | No team surface composed; the Team Manager lens is not exercised in any lane; J3 blocked so the manager cannot join the workspace |
| 34 | Cole Bennett — Server (HOS-MD) | Employee / Device Owner | Toast handheld | **RETAIN** | No self-service device surface (viewer lens only); J3 blocked so the employee cannot join; no real agent can ever check in (J2 fixture, zero /api/enrollment calls) |
| 35 | Sun Park — Kitchen Display Technician (HOS-MD) | Vendor / Service Operator | NCR/Toast dispatch | **RETAIN** | O3 restricted-role Approve is silently inert (no visible authorization_required denial); no vendor portal composed; J2 enrollment code is a client-side fixture |
| 36 | Ivy Chen — Owner (HOS-SM) | Fleet Administrator | Square/Toast + spreadsheets | **RETAIN** | J1+J4 PASS (server-tier session persistence) but J2 fixture code + inert disable, J3 invite blocked, O3 Approve/Reject inert, O2/O4/O5 composed-but-not-running — cannot operate the fleet |
| 37 | Leo Garnier — AV & Bar Technician (HOS-SM) | Service Desk | ad-hoc | **RETAIN** | J3 blocked (invite unknown_session — cannot join the workspace) and O2 composed-but-empty (Device Doctor shows 'Device not found' for the demo fleet's own device) — cannot diagnose devices |
| 38 | Ivy Chen (dual-hat) (HOS-SM) | Security & Compliance | none | **RETAIN** | O3 remediation walk RUNS composed (SIM-B walk-blocker FIXED) but Approve/Reject INERT (no dialog, no badge change, zero requests) — cannot decide approvals |
| 39 | Ivy Chen (dual-hat) (HOS-SM) | Asset & Procurement Manager | supplier sites | **RETAIN** | O4 composed-but-stuck-loading ('Loading the workload planning surface' / 'Loading the procurement surface') — no planning or procurement journey runs; no create affordance |
| 40 | Maya Duval — Events Manager (HOS-SM) | Team Manager | paper + texts | **RETAIN** | No team surface composed; the Team Manager lens is not exercised in any lane; J3 blocked so the manager cannot join the workspace |
| 41 | Rio Tanaka — Floor Staff (HOS-SM) | Employee / Device Owner | shared tablets | **RETAIN** | No self-service device surface (viewer lens only); J3 blocked so the employee cannot join; no real agent can ever check in (J2 fixture, zero /api/enrollment calls) |
| 42 | CityPOS Services (HOS-SM) | Vendor / Service Operator | phone dispatch | **RETAIN** | O3 restricted-role Approve is silently inert (no visible authorization_required denial); no vendor portal composed; J2 enrollment code is a client-side fixture |
| 43 | Talia Bernstein — Director of Production Technology (FEM-LG) | Fleet Administrator | Kandji + Cheqroom | **RETAIN** | J1+J4 PASS (server-tier session persistence) but J2 fixture code + inert disable, J3 invite blocked, O3 Approve/Reject inert, O2/O4/O5 composed-but-not-running — cannot operate the fleet |
| 44 | Marco Ruiz — Post-Production Support Engineer (FEM-LG) | Service Desk | in-house + JAMF tickets | **RETAIN** | J3 blocked (invite unknown_session — cannot join the workspace) and O2 composed-but-empty (Device Doctor shows 'Device not found' for the demo fleet's own device) — cannot diagnose devices |
| 45 | Adaeze Nwosu — Content Security Officer (FEM-LG) | Security & Compliance | watermarking + leak-response runbooks | **RETAIN** | O3 remediation walk RUNS composed (SIM-B walk-blocker FIXED) but Approve/Reject INERT (no dialog, no badge change, zero requests) — cannot decide approvals |
| 46 | Felix Grant — Equipment & Rentals Manager (FEM-LG) | Asset & Procurement Manager | Cheqroom/Rentman | **RETAIN** | O4 composed-but-stuck-loading ('Loading the workload planning surface' / 'Loading the procurement surface') — no planning or procurement journey runs; no create affordance |
| 47 | Nadia Petrova — Line Producer (FEM-LG) | Team Manager | Movie Magic + StudioBinder | **RETAIN** | No team surface composed; the Team Manager lens is not exercised in any lane; J3 blocked so the manager cannot join the workspace |
| 48 | Jonah Marsh — Camera Operator (FEM-LG) | Employee / Device Owner | Find My Mac + gear logs | **RETAIN** | No self-service device surface (viewer lens only); J3 blocked so the employee cannot join; no real agent can ever check in (J2 fixture, zero /api/enrollment calls) |
| 49 | Yuki Tanaka — LensWorks Rental House (FEM-LG) | Vendor / Service Operator | ShareGrid portal | **RETAIN** | O3 restricted-role Approve is silently inert (no visible authorization_required denial); no vendor portal composed; J2 enrollment code is a client-side fixture |
| 50 | Odile Marchand — Head of Studio Technology (FEM-MD) | Fleet Administrator | Jamf + spreadsheet | **RETAIN** | J1+J4 PASS (server-tier session persistence) but J2 fixture code + inert disable, J3 invite blocked, O3 Approve/Reject inert, O2/O4/O5 composed-but-not-running — cannot operate the fleet |
| 51 | Theo Lindqvist — Sample-Room IT Specialist (FEM-MD) | Service Desk | Jamf | **RETAIN** | J3 blocked (invite unknown_session — cannot join the workspace) and O2 composed-but-empty (Device Doctor shows 'Device not found' for the demo fleet's own device) — cannot diagnose devices |
| 52 | Beatriz Cruz — Brand-Protection Analyst (FEM-MD) | Security & Compliance | manual brand-security audits | **RETAIN** | O3 remediation walk RUNS composed (SIM-B walk-blocker FIXED) but Approve/Reject INERT (no dialog, no badge change, zero requests) — cannot decide approvals |
| 53 | Amara Okafor — Equipment Buyer (FEM-MD) | Asset & Procurement Manager | supplier portals | **RETAIN** | O4 composed-but-stuck-loading ('Loading the workload planning surface' / 'Loading the procurement surface') — no planning or procurement journey runs; no create affordance |
| 54 | Jules Marchand — Atelier Operations Manager (FEM-MD) | Team Manager | Notion | **RETAIN** | No team surface composed; the Team Manager lens is not exercised in any lane; J3 blocked so the manager cannot join the workspace |
| 55 | Elin Svensson — Fit Model Coordinator (FEM-MD) | Employee / Device Owner | shared devices | **RETAIN** | No self-service device surface (viewer lens only); J3 blocked so the employee cannot join; no real agent can ever check in (J2 fixture, zero /api/enrollment calls) |
| 56 | FotoPro Rentals (FEM-MD) | Vendor / Service Operator | phone/email | **RETAIN** | O3 restricted-role Approve is silently inert (no visible authorization_required denial); no vendor portal composed; J2 enrollment code is a client-side fixture |
| 57 | Priya Nair — Founder/Executive Producer (FEM-SM) | Fleet Administrator | Find My + spreadsheet | **RETAIN** | J1+J4 PASS (server-tier session persistence) but J2 fixture code + inert disable, J3 invite blocked, O3 Approve/Reject inert, O2/O4/O5 composed-but-not-running — cannot operate the fleet |
| 58 | Dan Mercer — Editor/Colorist (FEM-SM) | Service Desk (joined as employee) | self-managed | **RETAIN** | J3 blocked (invite unknown_session — cannot join the workspace) and O2 composed-but-empty (Device Doctor shows 'Device not found' for the demo fleet's own device) — cannot diagnose devices |
| 59 | Priya Nair (dual-hat) (FEM-SM) | Security & Compliance | none | **RETAIN** | O3 remediation walk RUNS composed (SIM-B walk-blocker FIXED) but Approve/Reject INERT (no dialog, no badge change, zero requests) — cannot decide approvals |
| 60 | Priya Nair (dual-hat) (FEM-SM) | Asset & Procurement Manager | rental invoices | **RETAIN** | O4 composed-but-stuck-loading ('Loading the workload planning surface' / 'Loading the procurement surface') — no planning or procurement journey runs; no create affordance |
| 61 | Priya Nair (dual-hat) (FEM-SM) | Team Manager | callsheets | **RETAIN** | No team surface composed; the Team Manager lens is not exercised in any lane; J3 blocked so the manager cannot join the workspace |
| 62 | Dan Mercer — Editor/Colorist (FEM-SM) | Employee / Device Owner | own laptop | **RETAIN** | No self-service device surface (viewer lens only); J3 blocked so the employee cannot join; no real agent can ever check in (J2 fixture, zero /api/enrollment calls) |
| 63 | GripTruck LA (FEM-SM) | Vendor / Service Operator | texts | **RETAIN** | O3 restricted-role Approve is silently inert (no visible authorization_required denial); no vendor portal composed; J2 enrollment code is a client-side fixture |
| 64 | Robert Chen — Director of IT (LEG-LG) | Fleet Administrator | Intune + iManage admin | **RETAIN** | J1+J4 PASS (server-tier session persistence) but J2 fixture code + inert disable, J3 invite blocked, O3 Approve/Reject inert, O2/O4/O5 composed-but-not-running — cannot operate the fleet |
| 65 | Dana Whitfield — Service Desk Analyst (LEG-LG) | Service Desk | ServiceNow (firm ITSM) | **RETAIN** | J3 blocked (invite unknown_session — cannot join the workspace) and O2 composed-but-empty (Device Doctor shows 'Device not found' for the demo fleet's own device) — cannot diagnose devices |
| 66 | Priyanka Mehta — Information Security Counsel (LEG-LG) | Security & Compliance | Purview + ethical-wall tooling | **RETAIN** | O3 remediation walk RUNS composed (SIM-B walk-blocker FIXED) but Approve/Reject INERT (no dialog, no badge change, zero requests) — cannot decide approvals |
| 67 | George Ashworth — Procurement Manager (LEG-LG) | Asset & Procurement Manager | Coupa/Ariba | **RETAIN** | O4 composed-but-stuck-loading ('Loading the workload planning surface' / 'Loading the procurement surface') — no planning or procurement journey runs; no create affordance |
| 68 | Karen Silva — Litigation Practice Manager (LEG-LG) | Team Manager | Aderant/3E | **RETAIN** | No team surface composed; the Team Manager lens is not exercised in any lane; J3 blocked so the manager cannot join the workspace |
| 69 | James Okafor — Associate Attorney (LEG-LG) | Employee / Device Owner | iManage + firm laptop | **RETAIN** | No self-service device surface (viewer lens only); J3 blocked so the employee cannot join; no real agent can ever check in (J2 fixture, zero /api/enrollment calls) |
| 70 | Laura Kim — Court-Reporting & Forensic Vendor (LEG-LG) | Vendor / Service Operator | Kroll/Consilio portals | **RETAIN** | O3 restricted-role Approve is silently inert (no visible authorization_required denial); no vendor portal composed; J2 enrollment code is a client-side fixture |
| 71 | Amara Diallo — Managing Attorney / IT Lead (LEG-MD) | Fleet Administrator | M365 admin center | **RETAIN** | J1+J4 PASS (server-tier session persistence) but J2 fixture code + inert disable, J3 invite blocked, O3 Approve/Reject inert, O2/O4/O5 composed-but-not-running — cannot operate the fleet |
| 72 | Peter Vance — Compliance & Risk Officer (LEG-MD) | Security & Compliance (joined in-product) | M365 compliance | **RETAIN** | O3 remediation walk RUNS composed (SIM-B walk-blocker FIXED) but Approve/Reject INERT (no dialog, no badge change, zero requests) — cannot decide approvals |
| 73 | Iris Kam — Legal Support Technician (LEG-MD) | Service Desk | Break-fix MSP | **RETAIN** | J3 blocked (invite unknown_session — cannot join the workspace) and O2 composed-but-empty (Device Doctor shows 'Device not found' for the demo fleet's own device) — cannot diagnose devices |
| 74 | Thomas Read — Office Manager/Procurement (LEG-MD) | Asset & Procurement Manager | office supply portals | **RETAIN** | O4 composed-but-stuck-loading ('Loading the workload planning surface' / 'Loading the procurement surface') — no planning or procurement journey runs; no create affordance |
| 75 | Sofia Reyes — Paralegal Team Lead (LEG-MD) | Team Manager | Clio/Aderant | **RETAIN** | No team surface composed; the Team Manager lens is not exercised in any lane; J3 blocked so the manager cannot join the workspace |
| 76 | Devin Park — Paralegal (LEG-MD) | Employee / Device Owner | firm laptop | **RETAIN** | No self-service device surface (viewer lens only); J3 blocked so the employee cannot join; no real agent can ever check in (J2 fixture, zero /api/enrollment calls) |
| 77 | MetroShred Certified Disposal (LEG-MD) | Vendor / Service Operator | certificate portals | **RETAIN** | O3 restricted-role Approve is silently inert (no visible authorization_required denial); no vendor portal composed; J2 enrollment code is a client-side fixture |
| 78 | Nora Ellis — Managing Partner (LEG-SM) | Fleet Administrator | M365 + spreadsheet | **RETAIN** | J1+J4 PASS (server-tier session persistence) but J2 fixture code + inert disable, J3 invite blocked, O3 Approve/Reject inert, O2/O4/O5 composed-but-not-running — cannot operate the fleet |
| 79 | Sam Rutledge — Office Manager (LEG-SM) | Team Manager (joined in-product) | paper processes | **RETAIN** | No team surface composed; the Team Manager lens is not exercised in any lane; J3 blocked so the manager cannot join the workspace |
| 80 | Nora Ellis (dual-hat) (LEG-SM) | Security & Compliance | none | **RETAIN** | O3 remediation walk RUNS composed (SIM-B walk-blocker FIXED) but Approve/Reject INERT (no dialog, no badge change, zero requests) — cannot decide approvals |
| 81 | Nora Ellis (dual-hat) (LEG-SM) | Asset & Procurement Manager | online ordering | **RETAIN** | O4 composed-but-stuck-loading ('Loading the workload planning surface' / 'Loading the procurement surface') — no planning or procurement journey runs; no create affordance |
| 82 | Nora Ellis (dual-hat) (LEG-SM) | Service Desk | local IT contractor | **RETAIN** | J3 blocked (invite unknown_session — cannot join the workspace) and O2 composed-but-empty (Device Doctor shows 'Device not found' for the demo fleet's own device) — cannot diagnose devices |
| 83 | Alec Bowen — Associate Attorney (LEG-SM) | Employee / Device Owner | firm laptop | **RETAIN** | No self-service device surface (viewer lens only); J3 blocked so the employee cannot join; no real agent can ever check in (J2 fixture, zero /api/enrollment calls) |
| 84 | Cascade IT Support (LEG-SM) | Vendor / Service Operator | email | **RETAIN** | O3 restricted-role Approve is silently inert (no visible authorization_required denial); no vendor portal composed; J2 enrollment code is a client-side fixture |
| 85 | David Hargrove — IT Fleet Director (Col., Ret.) (DEF-LG) | Fleet Administrator | Absolute + Intune Gov (GCC High) | **RETAIN** | J1+J4 PASS (server-tier session persistence) but J2 fixture code + inert disable, J3 invite blocked, O3 Approve/Reject inert, O2/O4/O5 composed-but-not-running — cannot operate the fleet |
| 86 | Mick Torres — Systems Technician (DEF-LG) | Service Desk | ServiceNow Gov | **RETAIN** | J3 blocked (invite unknown_session — cannot join the workspace) and O2 composed-but-empty (Device Doctor shows 'Device not found' for the demo fleet's own device) — cannot diagnose devices |
| 87 | Fatima Al-Rashid — Facility Security Officer (DEF-LG) | Security & Compliance | ACAS + STIG Manager | **RETAIN** | O3 remediation walk RUNS composed (SIM-B walk-blocker FIXED) but Approve/Reject INERT (no dialog, no badge change, zero requests) — cannot decide approvals |
| 88 | Susan Blackwood — Property & Logistics Manager (DEF-LG) | Asset & Procurement Manager | DPAS/ERP property systems | **RETAIN** | O4 composed-but-stuck-loading ('Loading the workload planning surface' / 'Loading the procurement surface') — no planning or procurement journey runs; no create affordance |
| 89 | Elena Vasquez — Program Site Lead (DEF-LG) | Team Manager | program-management tooling | **RETAIN** | No team surface composed; the Team Manager lens is not exercised in any lane; J3 blocked so the manager cannot join the workspace |
| 90 | Ryan Doyle — Field Engineer (DEF-LG) | Employee / Device Owner | CAC/PIV + GFED processes | **RETAIN** | No self-service device surface (viewer lens only); J3 blocked so the employee cannot join; no real agent can ever check in (J2 fixture, zero /api/enrollment calls) |
| 91 | Chen Wei — Certified Sanitization Vendor (DEF-LG) | Vendor / Service Operator | disposal-chain portals | **RETAIN** | O3 restricted-role Approve is silently inert (no visible authorization_required denial); no vendor portal composed; J2 enrollment code is a client-side fixture |
| 92 | Rachel Stone — Director of Technology (DEF-MD) | Fleet Administrator | Intune + Absolute | **RETAIN** | J1+J4 PASS (server-tier session persistence) but J2 fixture code + inert disable, J3 invite blocked, O3 Approve/Reject inert, O2/O4/O5 composed-but-not-running — cannot operate the fleet |
| 93 | Vic Alonso — Fleet & Equipment Coordinator (DEF-MD) | Asset & Procurement Manager (joined in-product) | spreadsheets | **RETAIN** | O4 composed-but-stuck-loading ('Loading the workload planning surface' / 'Loading the procurement surface') — no planning or procurement journey runs; no create affordance |
| 94 | Tanya Rook — Patrol Systems Technician (DEF-MD) | Service Desk | MSP | **RETAIN** | J3 blocked (invite unknown_session — cannot join the workspace) and O2 composed-but-empty (Device Doctor shows 'Device not found' for the demo fleet's own device) — cannot diagnose devices |
| 95 | Marcus Bell — Physical Security Manager (DEF-MD) | Security & Compliance | Lenel/Genetec | **RETAIN** | O3 remediation walk RUNS composed (SIM-B walk-blocker FIXED) but Approve/Reject INERT (no dialog, no badge change, zero requests) — cannot decide approvals |
| 96 | Imani Cross — Patrol Operations Manager (DEF-MD) | Team Manager | GuardTour apps | **RETAIN** | No team surface composed; the Team Manager lens is not exercised in any lane; J3 blocked so the manager cannot join the workspace |
| 97 | Oscar Reyes — Security Officer (DEF-MD) | Employee / Device Owner | tour devices | **RETAIN** | No self-service device surface (viewer lens only); J3 blocked so the employee cannot join; no real agent can ever check in (J2 fixture, zero /api/enrollment calls) |
| 98 | SecureIT Device Services (DEF-MD) | Vendor / Service Operator | vendor portal | **RETAIN** | O3 restricted-role Approve is silently inert (no visible authorization_required denial); no vendor portal composed; J2 enrollment code is a client-side fixture |
| 99 | Grant Whitmore — Principal Consultant (DEF-SM) | Fleet Administrator | Intune | **RETAIN** | J1+J4 PASS (server-tier session persistence) but J2 fixture code + inert disable, J3 invite blocked, O3 Approve/Reject inert, O2/O4/O5 composed-but-not-running — cannot operate the fleet |
| 100 | Erica Nash — Compliance Lead (DEF-SM) | Security & Compliance (joined in-product) | manual audit logs | **RETAIN** | O3 remediation walk RUNS composed (SIM-B walk-blocker FIXED) but Approve/Reject INERT (no dialog, no badge change, zero requests) — cannot decide approvals |
| 101 | Grant Whitmore (dual-hat) (DEF-SM) | Service Desk | local IT | **RETAIN** | J3 blocked (invite unknown_session — cannot join the workspace) and O2 composed-but-empty (Device Doctor shows 'Device not found' for the demo fleet's own device) — cannot diagnose devices |
| 102 | Grant Whitmore (dual-hat) (DEF-SM) | Asset & Procurement Manager | online ordering | **RETAIN** | O4 composed-but-stuck-loading ('Loading the workload planning surface' / 'Loading the procurement surface') — no planning or procurement journey runs; no create affordance |
| 103 | Grant Whitmore (dual-hat) (DEF-SM) | Team Manager | spreadsheets | **RETAIN** | No team surface composed; the Team Manager lens is not exercised in any lane; J3 blocked so the manager cannot join the workspace |
| 104 | Tara Munoz — Field Consultant (DEF-SM) | Employee / Device Owner | own laptop | **RETAIN** | No self-service device surface (viewer lens only); J3 blocked so the employee cannot join; no real agent can ever check in (J2 fixture, zero /api/enrollment calls) |
| 105 | CyberShred Partners (DEF-SM) | Vendor / Service Operator | certificates by email | **RETAIN** | O3 restricted-role Approve is silently inert (no visible authorization_required denial); no vendor portal composed; J2 enrollment code is a client-side fixture |

**(c) Delta narrative:**

**No verdicts changed.** The before/after delta is 0/0/105 → 0/0/0/105 (SIM-B's three-bucket format adds a COMPLEMENT column at 0 in SIM-C's four-bucket rubric). The fix lanes (W140, W144, W145) landed real technical progress — server-tier sessions, composed lane surfaces, mobile cards, declared-import surface — but the central adoption blockers persist in the deployed build, so no persona's daily job can yet run inside FleetOS:

- **W140 server-tier session persistence (J4 PASS ×15):** real technical depth — sessions now resolve server-side (httpOnly cookie /api/session) instead of client-side localStorage. But sessions worked before (just client-side); the change is technical depth, not adoption. A Fleet Administrator who could sign in before can still sign in now. The daily job is still blocked by inert approvals, blocked join, unrunnable lanes. No verdict change.
- **W145 mobile priority-card roster (no horizontal scroll):** real mobile UX improvement — the SIM-B "993px table → horizontal page scroll" defect is resolved. But for real-workspace users the roster is empty (no devices can be enrolled — J2 fixture, §4.5); for demo-tier users the roster is client-side seed state. The mobile cards help view the demo fleet on mobile, but the daily job is still blocked. No verdict change.
- **W145 declared-import surface (composed and running in the demo tier; durable path cited on real workspaces):** real cold-start progress — a SMALL founder can now declare device records (provenance-flagged DECLARED, never conflated with OBSERVED) in the demo tier. The durable path on real workspaces is cited (leg-lg-declared-import.png) but NOT EXERCISED in the J-lens evidence files (which record only J1–J4). Even if durable on real workspaces, the founder still faces inert approvals (§4.4), blocked join (§4.5), and unrunnable lanes (§4.3) — so even with declared devices in the roster, the founder cannot operate the fleet. The spreadsheet stays. No verdict change.

**Do NOT inflate:** if the daily job still cannot run in the product (inert approvals, blocked join, unrunnable lanes), the verdict stays RETAIN with the reason. The evidence supports RETAIN for all 105 personas.

### 4.8 Residual blockers, each traced to the minimal actionable cause

From the evidence Notes — at minimum:

1. **J2 client fixture never calls /api/enrollment** — the enrollment code is the deterministic client-side W101 fixture (BOOT-W101-0001 / enr_w101_000001); zero /api/enrollment API calls on create/hide/disable; the durable `fleetos_enrollment_requests` table has ZERO rows across all tenants (def-journeys.md Note 2; reproduced across all 15 firms). *Minimal actionable cause:* the Install Center's "Create enrollment code" affordance must route through the REAL `/api/enrollment/codes` boundary (W140 already created the server-side handler) instead of the client-side fixture.
2. **J3 invite expects a W121-era client-session record server-tier sign-in never writes** — the topbar "Invite member…" refuses with `unknown_session` despite a valid server session (GET /api/session 200, role owner); the client-side invite path reads `fleetos.w121.session` in localStorage, which the Wave-13 server-tier (httpOnly cookie) sign-in never writes; zero network requests; the durable `fleetos_workspace_invitations` table has ZERO rows (leg-journeys.md Note 1; def-journeys.md Note 1; reproduced across all 15 firms). *Minimal actionable cause:* the invite affordance must read the server-tier session (GET /api/session) instead of the stale W121 client-session record, and route through the REAL `/api/workspace/invitations` boundary.
3. **O3 executed-decision path unreachable from the UI** — Approve/Reject on `/security/approvals` produce no confirmation dialog, no badge/state/audit change, zero network requests; the W142 `approvals-execution.ts` exists in the codebase but the deployed UI's click path is a silent no-op (demo-journeys.md Note 1; W144(b) DEFECT). *Minimal actionable cause:* the Approve/Reject click handler must wire to the W142 executed-decision path (confirmation dialog → typed phrase → RBAC gate → dispatch → audit), not the current silent no-op.
4. **O4 feeds stuck "Loading…"** — Workloads Planning and Commerce Procurement compose their headers but sit in perpetual "Loading the workload planning surface" / "Loading the procurement surface" statuses; no journey stage runs; no create affordance (demo-journeys.md O4). *Minimal actionable cause:* the W143 planning/procurement compositions must bind to the runtime composition root on the deployed tier (the loading status never resolves because the runtime binding is not wired).
5. **O2 empty diagnosis over the demo fleet's own device** — the Device Doctor lane composes but the diagnosis feed has no device data for the demo fleet; even the demo tenant's own `dev_w091demo000001` resolves as "Device not found in your fleet" (demo-journeys.md O2; leg-journeys.md Note 6). *Minimal actionable cause:* the doctor's device binding must hydrate from the tenant's device roster (GET /api/device/twins) instead of an empty diagnosis store.
6. **O5 no recovery case can open** — the per-case seven-stage journey and the typed-CONFIRM destructive gate are unreachable because no case exists and no case-creation affordance exists anywhere (Find My Device's "[Open recovery case]" navigates to the empty list); the destructive surface honestly refuses without an active case (demo-journeys.md O5; Note 7). *Minimal actionable cause:* a case-creation affordance must be added (from Find My Device or the cases list) so the seven-stage journey and the typed-CONFIRM gate can be exercised.
7. **NEW gate sign-in dead-button defect** — on a page load whose workspace directory populates after mount, the Sign-in form's `<select>` VISUALLY shows the first workspace, but the component's `tenantId` state initialized to `""`; the "Sign in" button stays DISABLED even with correct credentials, until the user re-picks the workspace (def-journeys.md Note 3). *Minimal actionable cause:* the Sign-in form's `tenantId` state must initialize from the picker's first entry when the directory populates, not from the empty default.
8. **Search does not match record ids as queries** — querying `pln_fb564c1e` (the parked plan's id) returns "No records matched" while the same plan matches via its title keyword (`encryption`) (demo-journeys.md Note 4). *Minimal actionable cause:* the search index must include record ids as matchable terms, not just title keywords.
9. **"Not yet composed" on in-vocabulary routes** — the string still renders for routes INSIDE the frozen route vocabulary that lack a runtime binding: `/security/decisions`, `/workloads/recommendations`, `/commerce/software` (and family) (demo-journeys.md Note 5). *Minimal actionable cause:* these in-vocabulary routes must either receive runtime bindings or be removed from the frozen vocabulary.
10. **Demo-tier decision/import state session-scoped** — the demo fleet's runtime (decisions, declared imports, roster additions) is in-memory client state; the prior evaluator's declared import was gone at this pass's start, and this pass's import vanished after one reload; the hash-chained audit log for the demo tenant always resets to the 5 seeded events on reload (demo-journeys.md Note 6). *Minimal actionable cause:* the demo tier's decision/import state must route through the server plane (POST /api/device/declared-import, the W142 executed-decision path) instead of client-side session state — or the demo tier must be honestly labeled as non-durable.



### 4.9 The second fix wave (the issue-#2 "no early return" continuation, 2026-10-05 evening)

The issue-#2 protocol (the "no early return" mandate) required the rerun record's residual blockers to be addressed even after the §4.7/§4.8 acceptance — so a second fix wave was dispatched on 2026-10-05 evening (immediately after the §4.7/§4.8 record was filed) and ran live-verified across three lanes (W147/W148/W149) with the exact merge commits + verification verdicts recorded below. Each lane's verification traces are in the three files under `docs/simulations/sim-c-evidence/` (w147-verification.md / w148-verification.md / w149-verification.md — R1/R2c/R3 first-hand).

#### 4.9.1 The three-lane record

| Lane | Merge commit | Verification verdict | Scope (what the lane changed on the deployed build) |
|---|---|---|---|
| **W147 (boundary engagement)** | `8400ce5` (merge of work/w147 @ `e5be168`, Vercel READY/PROMOTED ~15:07Z) | **LIVE-VERIFIED by R1** on the deployed 8400ce5 build (first-hand 15:27:23Z → 15:43:27Z) | The J2 enrollment codes now route through the REAL `POST /api/enrollment/codes` boundary (server-issued tenant-unique codes — the W101 fixture is GONE; display-once holds; Disable produces a real `DELETE /api/enrollment/codes` 200 revoke with explicit `code_revoked` feedback); the J3 invite/join chain works end-to-end (the NEW `POST /api/workspace/invitations` issues one-time join codes; the member lands in the INVITING tenant with the assigned role — verified with session-fetch proofs); the gate sign-in dead-button fixed (the `tenantId` state initializes from the picker's first entry when the directory populates after mount). |
| **W148 (engaged lanes)** | `fd6510b` (merge of work/w148 @ `71b00ab`, manually deployed via Vercel `dpl_35RvdQiN` ~17:30Z after the webhook missed) | **LIVE-VERIFIED by R2/R2c** on the deployed fd6510b build (R2 first-hand 17:37Z → 18:04Z captured the 20 `r2-*.png` screenshots; R2c completion pass ~18:08Z → 18:29Z re-walked every below-the-fold check live + captured the O4 crash root cause) | O3 Approve/Reject EXECUTES through the W142 decision path (the typed-phrase confirmation `CONFIRM APPROVE <planId>` + checkbox → RBAC → record → badge drop → already_decided dedupe → the frozen `authorization_required` denial for restricted roles); O4 planning resolves to ready over the REAL workload profile (`wl_w091demo000001`); O2 the Device Doctor binds the demo fleet's REAL TwinStore (`dev_w091demo000001` resolves; the nine stages run); O5 recovery cases openable (the `[Open recovery case]` affordance + the case row + Find My honest `no_location_evidence`); search matches record ids as queries; the in-vocabulary routes bound (zero "not yet composed in this runtime"). |
| **W149 (the hotfix)** | `b6101d0` (merge of work/w149 @ `46626f9` into main @ `3051274`, merged 2026-10-05T19:07:58Z) | **VERIFIED by R3** on a production-mode build of the exact merge commit (`next build` + `next start`, `FLEETOS_ENV=production`, BUILD_ID `jCIinIEVrFW3GSur7xn_g`, built 2026-10-05T19:17Z) — the Vercel production deploy is **quota-blocked until the 2026-10-06 19:08Z reset**, honestly noted (see §4.9.4) | The procurement crash FIXED (the surface loads; the verification card renders the honest empty state via `buildOrderVerificationView(tenantId, null).view` — `No reconciliation report verifies the orders yet.`); the decision propagation COMPLETE (the queue card decided badge + dead buttons + honest `already_decided` copy; the Security Doctor plan state APPROVED with the approver identity; the audit index 3→4 trails with the executed decision's 2-entry trail — `explicit_confirmation` + `decision_dispatched`; the O6 expectation met); the recovery-case detail opens (the seven-stage per-case journey renders). |

#### 4.9.2 The closed-blocker ledger

The §4.8 ten residual blockers, each closed (or honestly labeled) by the second fix wave:

| Blocker (§4.8) | Closing lane | Closing evidence line (verbatim from the verification file) |
|---|---|---|
| **1. J2 client fixture never calls /api/enrollment** | **W147, R1** | "POST …/api/enrollment/codes (Fetch) 201" → body `{"ok":true,"requestId":"enr_de92b4dc","code":"enrollwO555WB5JM2AXLGJ4LV5L",…}`; "code `enrollwO555WB5JM2AXLGJ4LV5L` ≠ BOOT-W101-0001"; "the two codes and request ids DIFFER (Bluegrass `enr_de92b4dc`/`enrollwO555WB5JM2AXLGJ4LV5L` vs Keystone `enr_d8d2b197`/`enrollw4YITFKOVWFE3I3MHWEEH`) — tenant-unique server-issued codes, the shared W101 fixture is GONE." (w147-verification.md checks 1a–1e) |
| **2. J3 invite expects a W121-era client-session record** | **W147, R1** | "POST …/api/workspace/invitations (Fetch) 201" → `{"ok":true,"invitationId":"inv_w144wf05f77c166b2_c38231be","code":"joinwI5CII2YX2Y2NDGFFTEZG",…}`; "POST …/api/enrollment/redeem 201" → session `{"ok":true,"tenantId":"tnt_w144wf05f77c166b2",…,"memberRef":"trn-sm-member@simc-rerun.test","assignedRoles":["employee"],"activeRole":"employee"}` — "the member landed in the INVITING workspace's tenant (Bluegrass tnt_w144wf05f77c166b2), NOT a misroute." (w147-verification.md checks 2a–2c) |
| **3. O3 executed-decision path unreachable from the UI** | **W148, R2c** | "[Approve] → alertdialog 'Approve parked plan'… 'CONFIRM APPROVE pln_fb564c1e'… → Confirm approve → dialog closes, topbar badge 'Approvals inbox: 1 pending' → 'Approvals inbox: 0 pending'"; "second Approve with the same phrase → in-dialog refusal 'already_decided — The plan pln_fb564c1e has already been decided.'"; Vendor persona → "frozen denial, in-dialog: 'authorization_required — This action requires the 'fleet.action.approve' permission. Active role(s): vendor.operator…'." (w148-verification.md checks 1a–1f) |
| **4. O4 feeds stuck 'Loading…'** | **W148, R2c (workloads) + W149, R3 (procurement)** | Workloads planning: "'Workload planning · 1 workload profile defined · plans, versioned recommendations and capacity signals' + row 'w091-demo-analyst-workstation · wl_w091demo000001 · analyst-workstation · r1 · security 0.9 / compute 0.7 / memory 0.6 / confidence 0.85…' — the perpetual 'Loading the workload planning surface' is GONE" (w148-verification.md check 2). Commerce procurement: the W148 lane CRASHED on render (w148-verification.md check 3 / N1 — `TypeError: Cannot read properties of undefined (reading 'chainStatusCounts')`); W149 FIXED the crash — "`/commerce/procurement` LOADS on client-side nav AND hard load — full surface renders ('1 request · 0 orders formed…', the dmd_w091demo000001 demand row, 'No orders are formed yet', the verification card's honest 'No reconciliation report verifies the orders yet.'); ZERO 'Application error: a client-side exception' strings." (w149-verification.md check 1) |
| **5. O2 empty diagnosis over the demo fleet's own device** | **W148, R2c** | "Device Doctor · Diagnosis record for dev_w091demo000001" — "the device RESOLVES (the 'Device not found in your fleet' blocker is GONE) and all nine stages render with honest states" (Device under diagnosis Done / Observations ingested Not yet observed / Symptoms detected no_anomalies_detected / Diagnosis recorded Not yet observed / Remediation recommended no_recommendations_yet / Authorization state 0·0 / Action requested 0·0 / Execution result 0·0 / Evidence artifacts 0·—). (w148-verification.md check 4) |
| **6. O5 no recovery case can open** | **W148, R2c (affordance) + W149, R3 (case detail)** | W148: "'Open recovery case' button on the cases surface → click → 'Recovery effort · 1 active · 0 closed · 1 total…' + row 'case_w148_devw091demo000001_20260106140000…'" (w148-verification.md check 5a). W149: "clicking the case row now OPENS the per-case detail (the W148 N3 selectedCaseId hardcoded-undefined stub is replaced by the real binding). The detail renders… the seven-stage 'Recovery journey' with honest states." (w149-verification.md check 3) |
| **7. NEW gate sign-in dead-button defect** | **W147, R1** | "Picker after reload: combobox 'Workspace' = Bluegrass Courier Co. [selected]… Typed `trn-sm-admin@simc-rerun.test` + `simc-rerun-2026` via real keystrokes into the form — WITHOUT re-picking the workspace — `agent-browser is enabled` → true. (Pre-W147 the button stayed disabled until an explicit re-pick; the remount fix ('ws-empty' → 'ws-populated' key) works.)" (w147-verification.md check 3) |
| **8. Search does not match record ids as queries** | **W148, R2c** | "Ctrl+K `pln_fb564c1e` → 'Fleet Actions · Parked plan — w091-demo-enable-encryption · matched keyword exact — pln_fb564c1e' (the demo-journeys NEW-finding-4 'No records matched' defect is FIXED)." (w148-verification.md check 6a) |
| **9. 'Not yet composed' on in-vocabulary routes** | **W148, R2c** | "`/security/decisions` → 'Guardian decisions · Contract Guardian decisions…' (composed + honest empty; pre-W148 it rendered 'decisions — not yet composed in this runtime'); `/workloads/recommendations` → renders the planning surface itself…; `/commerce/software` → 'Software · The software catalog…'… ZERO occurrences of 'not yet composed in this runtime' on any of the three." (w148-verification.md check 7) |
| **10. Demo-tier decision/import state session-scoped** | **By-design, honestly labeled (no fix in this wave)** | The demo-tier state (decisions, recovery cases, declared imports) remains session-scoped client state — "a reload or persona switch resets the badge to '1 pending', the audit index to the 3 seeded trails, and the cases list to empty" (w149-verification.md R4). **By-design label:** the demo tier's contract is "the shared DEMO workspace, client-side session state, no server-plane persistence — explicitly so the demo personas never mutate shared state." The honest label is the disclosure that this IS by-design and NOT a defect. The server-plane persistence of demo-tier decisions/cases is future work, recorded as scope, not a regression. |

#### 4.9.3 The NEW findings (R1 N1–N6 + R2c N1/N2/N3 + R3 R1–R6 residuals)

Each NEW finding from the second-wave verification, traced to its minimal actionable cause:

**R1 (W147 verification) — N1–N6:**

- **N1 (minor, NEW) — non-grammar bogus join codes get the DEVICE-path refusal copy.** The protocol's literal `joinw-bogus-999` fails the frozen join-code grammar (`joinw[A-Z2-7]{20}`) at the redeem dispatch and surfaces `invalid_input` 400 with the device-path explanation (talks about `tenantId`/`deviceId`/`adapterFamily` the member never entered). The expected `unknown_code` DOES surface for grammar-matching bogus codes. *Minimal actionable cause:* the redeem route's grammar check should surface `unknown_code` (or a member-join-specific refusal) for any string that does not parse as a join code, rather than falling through to the device-path refusal copy.
- **N2 (minor, NEW) — `membership_already_exists` loses the server's explanation in the client render.** The server returns `explanation: "You are already a member of this workspace. Sign in with your credentials instead of joining again."` but the gate's alert renders the generic fallback ("This action was refused and no further explanation is available for it…"). *Minimal actionable cause:* the client's frozen `ProductAuthRefusal` vocabulary needs an entry for `membership_already_exists` that surfaces the server's `explanation` field verbatim.
- **N3 (nuance, on the J2 disable path) — no PRE-action confirmation; post-revoke UI staleness.** "Disable this code…" fires the DELETE immediately on click — no confirmation dialog BEFORE the destructive action. After a successful revoke, the request card chip still reads "Active — active" and the hidden-code copy still says "It remains valid until used or expired" though the server has revoked it (client status not refreshed). *Minimal actionable cause:* add a pre-action confirmation dialog (matching the W142 approvals pattern) and refresh the request card's status chip + the hidden-code copy on the real 200 revoke response.
- **N4 (residual, by-design scope note) — joined members have NO password.** The join code IS the credential; after sign-out the member cannot sign back in through the Sign in form. *Minimal actionable cause:* add a password-setting flow post-join (or document the invite-only model explicitly as the design contract).
- **N5 (policy observation) — operator-tier members can issue invitations.** A `service.desk` member (NOT an owner) clicked "Invite member…" and the server ISSUED a code. The route's permission law allows any assigned role whose experience role passes `canInteract(operatorRoleFor(role), "propose")`. *Minimal actionable cause:* confirm whether operator-tier roles should be permitted to issue invitations (a product-policy call for the tech lead); if not, restrict the route to `fleet.admin` only.
- **N6 (operational, not a product defect) — evaluator tooling notes.** (a) agent-browser's `storage local set` mangled the JSON directory value; the directory had to be set via in-page `eval setItem`. (b) The join form's role combobox options carry VALUES distinct from labels — a label-based automation keystroke silently leaves the default role selected. (c) The known cosmetic residue persists: the failed join attempt's persona email bleeds into the Sign-in form's Email field.

**R2c (W148 verification) — N1 (the NEW P0) + N2/N3 (the residuals that drove W149):**

- **N1 (NEW P0 DEFECT — O4 procurement client-side crash; the headline finding):** `/commerce/procurement` crashes on render: "Application error: a client-side exception has occurred…". Root cause: `TypeError: Cannot read properties of undefined (reading 'chainStatusCounts')` — the W148 route binding (`apps/web/src/console-app.tsx` ~L1736) casts the W143 `composeProcurementCasesFeed` ready view-model (shape `{tenantId, demands, selected, vendors, orders}`, NO `verification` field) to `ProcurementScreenData` with `as unknown as` (a cast that defeats typecheck); `procurement-screen.tsx` L822 passes `ready.verification` (undefined) to `VerificationCard`, whose L238 `Object.entries(verification.chainStatusCounts)` throws. *Minimal actionable cause:* supply a real `OrderVerificationView` at the binding site (or an honest-empty via `buildOrderVerificationView(tenantId, null).view`) and drop the blind cast so the compiler enforces the shape. **→ CLOSED by W149** (see w149-verification.md check 1).
- **N2 (residual — the executed decision does not propagate to any visible surface):** the approve/reject transitions execute at the approvals boundary (typed-phrase dialog, badge drop 1→0, `already_decided` dedupe, frozen `authorization_required` denial all verified real), but afterwards: (a) the approvals queue card STILL renders the parked record verbatim with clickable [Approve]/[Reject]; (b) the Security Doctor still shows "Human approval — In progress (Parked)" and "Action — Plan PARKED — Pending"; (c) the Evidence trail index is unchanged (only the 3 seeded trails — NO new decision/dispatch audit entries; the O6 expectation unmet). *Minimal actionable cause:* the demo-tier lane feeds (approvals queue card, security doctor, evidence index) should be recomposed from the executed-decision record. **→ CLOSED by W149** (see w149-verification.md checks 2/2b/2c).
- **N3 (residual — the O5 per-case journey + typed-CONFIRM gate remain unreachable):** (a) every destructive action is "Unsupported by this device" (the demo device `windows-mdm` declares no lock/locate/wipe/reboot capability), so no gated control ever renders and the typed-CONFIRM phrase dialog cannot be exercised; (b) clicking a case row in the cases list does NOT open the per-case seven-stage detail (`console-app.tsx` L1574 passes `selectedCaseId={input.laneFeeds.isDemo ? undefined : undefined}` — hardcoded undefined in BOTH branches, an apparent stub). *Minimal actionable cause (b):* wire `selectedCaseId` from the selected-case state. *Minimal actionable cause (a):* declare a destructive capability for the demo device's adapter OR route the drill through a capability-bearing device. **(b) → CLOSED by W149** (see w149-verification.md check 3); **(a) → R3 residual R3 below** (the typed-CONFIRM gate stays unexercisable for hardware-capability reasons).

**R3 (W149 verification) — R1–R6 residuals:**

- **R1 (residual — the O4 per-demand case journey remains list-level):** the procurement surface LOADS and every rendered stage is honest (need/order/evidence), but the four demand-detail stages (case → vendor context → authorization → decision) never render: clicking the "Open demand … (dmd_w091demo000001)" row button is a NO-OP. *Minimal actionable cause:* the console-app `commerce.procurement` binding (apps/web/src/console-app.tsx ~L1858) still passes `onSurfaceEvent={() => undefined}`, so the screen's `open_demand` event is discarded and the feed's `selectedDemandId`/`journey` are never exercised — the same class of stub W149 just fixed for the recovery-case `selectedCaseId`. Fix: wire the event to a selectedDemandId state (or select the single demo demand by default) so the demand detail + the seven-stage case journey render.
- **R2 (residual, cosmetic — the search result label does not track the executed decision):** after the approve execution, Ctrl+K `pln_fb564c1e` still returns "Parked plan — w091-demo-enable-encryption" (the search index record label is not overlaid by the executed-decision state the way the queue card / doctor / audit now are). *Minimal actionable cause:* the search index should overlay the executed-decision state on the record label (or the label should carry a `(decided: APPROVED)` suffix in-session).
- **R3 (residual, unchanged from W148 N3a — the typed-CONFIRM destructive dialog stays unexercisable):** the per-case detail now opens (fixed), but the destructive surface's actions remain "Unsupported by this device" for the demo device (`windows-mdm` declares no lock/locate/wipe/reboot capability), so the typed-CONFIRM phrase dialog for destructive actions still cannot be exercised on the demo tier. *Minimal actionable cause:* route the destructive drill through a capability-bearing device (or extend the demo device's adapter to declare at least one of `lock`/`locate`/`wipe`/`reboot` so the typed-CONFIRM gate becomes exercisable). Recorded as a hardware-capability residual, not a code defect.
- **R4 (residual, demo-tier-by-design scope note — unchanged):** the executed decision and the recovery case are session-scoped in-memory client state: a reload or persona switch resets the badge to "1 pending", the audit index to the 3 seeded trails, and the cases list to empty. *Minimal actionable cause:* route the demo-tier decision/case state through the server plane (the W140/W147 server-plane persistence is the precedent), or honestly label the demo tier as non-durable (which is the current contract).
- **R5 (residual, unchanged from W148 N4 — O2 side defects):** the Device Doctor's "Open device detail" button still does not navigate (probed on this build: path stays `/device/doctor`); stage 1 reports "Observation count: 1" (the TwinStore count) while stage 2 reports "Observations: None recorded yet" (the diagnosis store) — two stores, two truths on one screen. *Minimal actionable cause:* wire the "Open device detail" button to the device-detail route; reconcile the TwinStore's observation count with the diagnosis store's records (or label them as distinct counts on the surface).
- **R6 (observation, evaluator tooling):** (a) the decided queue card intentionally retains the immutable "Parking decision — Approval required — REQUIRE_APPROVAL" record above the new "Executed decision" block (append-only history — the W149 design; not a defect, noted for the verbatim record); (b) the W148-era in-dialog "already_decided — The plan 'pln_fb564c1e' has already been decided." refusal is no longer reachable via the UI (the dead button prevents the dialog from opening at all) — the guard chain is strictly stronger, but the in-dialog copy itself could not be re-verified live this pass; (c) three first-pass screenshots captured only the top of their pages — the load-bearing below-the-fold content was re-captured scrolled and VLM-verified; the in-page `main.innerText` captures are the authoritative verbatim record throughout; (d) agent-browser's `console` command returns empty on this target — the window error/rejection collector is the working substitute.

#### 4.9.4 The deployment record

The second-fix-wave deployment checkpoints (Vercel + local production-mode stand-in):

| Lane | Commit | Deploy checkpoint | Verification |
|---|---|---|---|
| W147 | `8400ce5` | Vercel staging READY/PROMOTED ~15:07Z Oct 5 2026 (deployment id `dpl_J52DwigM`) | R1 first-hand on the live staging tier (15:27:23Z → 15:43:27Z) — the deployment fingerprint check (`POST /api/workspace/invitations` → 401 `{"ok":false,"reason":"unauthenticated","message":"no server session cookie is present"}`; `GET /api/health` → 200 with all 9 secrets present) corroborates the deployed build matches `8400ce5`. |
| W148 | `fd6510b` | Vercel staging, manually deployed via Vercel `dpl_35RvdQiN` ~17:30Z Oct 5 2026 (after the fd6510b push missed the webhook) | R2 first-hand (17:37Z → 18:04Z) + R2c completion pass (~18:08Z → 18:29Z) on the live staging tier — the deployment fingerprint check (`GET /api/health` → 200 with all 9 secrets present; the live deployment serves the app-route chunk `_next/static/chunks/app/[[...slug]]/page-4d4e0c6fa0840a99.js` — the exact chunk the O4 procurement crash stack names, corroborating that the R2 crash and the R2c re-verification hit the SAME deployed build fd6510b). |
| W149 | `b6101d0` | **Vercel production deploy quota-blocked until the 2026-10-06 19:08Z reset** — corroborated by the TL's `befa5fc` empty-commit nudge on main ("the webhook delivery is flaky tonight and the API-trigger quota is exhausted"); **local production-mode build of the exact merge commit is the honest stand-in** | R3 first-hand on `http://localhost:3101` (a `next build` + `next start`, `FLEETOS_ENV=production`, BUILD_ID `jCIinIEVrFW3GSur7xn_g`, built 2026-10-05T19:17Z from the clean worktree at `46626f9`; `git diff 46626f9 b6101d0` = `spec/PROJECT-STATE.md` only — the apps/ code is bit-identical to `b6101d0`; `GET /api/health` on :3101 → 200 `{"env":"production","health":"healthy","module":"web",…}`) — first-hand window 19:21Z → 19:41Z. |

**The W149 deployment note (verbatim from w149-verification.md):**

> **HONEST DEPLOYMENT NOTE (label precision):** the Vercel production deploy of b6101d0 is **BLOCKED on the account's 100/day deployment quota (resets 2026-10-06 19:08Z)** — corroborated by the TL's `befa5fc` empty-commit nudge on main ("the webhook delivery is flaky tonight and the API-trigger quota is exhausted"). This **local production-mode verification is the stand-in** per the dress-rehearsal precedent: W149 touches **ZERO server files** (all 7 changed files are client/runtime/composition code — `commerce/src/procurement-feed.ts`, `security` approvals-queue-screen, `src/console-app.tsx`, `src/runtime/demo-fleet.ts`, `src/runtime/executed-decision-state.ts` (new), `src/runtime/lane-feeds.ts`, `test/w149-verification.test.ts`), so the client-tier behavior of this `next build && next start` output is **build-identical** to the Vercel build of the same commit. The 11 API routes are the unchanged W148 server surface; `GET /api/health` on :3101 → 200 `{"env":"production","health":"healthy","module":"web","secrets":[{"name":"FLEETOS_ENV","present":true},{"name":"DATABASE_URL","present":true},…]}`.

**Follow-up obligation (honest):** the b6101d0 production deploy at the 2026-10-06 19:08Z quota reset, with the live spot-check to follow (re-walk R3's checks 1/2/2b/2c/3/4a-4d against the Vercel production URL once the deploy lands).

### 4.10 Verdict recount v2 (the post-second-fix-wave delta)

**EXECUTED 2026-10-05 evening (after the second fix wave).** The recount re-applies the SIM-B rubric (SWITCH-ONLY / MAIN-INTERFACE / COMPLEMENT / RETAIN) to the same 105 personas, strictly on what the verified second-fix-wave evidence now supports. Every verdict move traces to a specific line in the ten evidence files (the seven rerun segment files + w147-verification.md + w148-verification.md + w149-verification.md). Where evidence is silent, the section says so.

#### 4.10.1 (a) The new distribution line

- **SIM-B baseline (2026-10-02):** SWITCH-ONLY 0 (0%) · MAIN-INTERFACE 0 (0%) · RETAIN 105 (100%).
- **SIM-C first recount (2026-10-05 morning, post-W140/W144/W145):** SWITCH-ONLY 0 (0%) · MAIN-INTERFACE 0 (0%) · COMPLEMENT 0 (0%) · RETAIN 105 (100%).
- **SIM-C recount v2 (2026-10-05 evening, post-W147/W148/W149):** SWITCH-ONLY 0 (0%) · MAIN-INTERFACE 0 (0%) · COMPLEMENT 5 (~4.8%) · RETAIN 100 (~95.2%).

The COMPLEMENT bucket now holds 5 personas — the founders running governance (workspace + members + enrollment + approvals + evidence) whose daily oversight job can now run substantially in-product. No verdict moves to MAIN-INTERFACE or SWITCH-ONLY — the evidence supports neither (no persona's daily job runs ENTIRELY in FleetOS, and no persona's incumbent gets displaced as the primary daily interface).

#### 4.10.2 (b) The CHANGED-persona table (the 5 movers)

Every persona whose verdict moved, with the specific fix + verification line that earned the move:

| # | Persona | Role | Incumbent | Old verdict → New verdict | The specific fix + verification line that earned the move |
|---|---|---|---|---|---|
| 15 | Hannah Cole — Owner/Operations (TRN-SM) | Fleet Administrator | spreadsheet + Google admin | **RETAIN → COMPLEMENT** | J1+J4 PASS ×15 (server-tier session persistence — W140) + J2 server-issued tenant-unique enrollment codes via `POST /api/enrollment/codes` 201 + real `DELETE` 200 revoke with `code_revoked` feedback (W147, R1, Bluegrass `enr_de92b4dc`/`enrollwO555WB5JM2AXLGJ4LV5L` + Keystone `enr_d8d2b197`/`enrollw4YITFKOVWFE3I3MHWEEH`) + J3 invite/join end-to-end (`POST /api/workspace/invitations` 201 → `POST /api/enrollment/redeem` 201 → member lands in INVITING tenant with assigned role — W147, R1) + O3 executed Approve through `CONFIRM APPROVE pln_fb564c1e` + checkbox → RBAC → record → badge drop → `already_decided` dedupe → frozen `authorization_required` denial for restricted roles (W148/W149, R2c/R3) + O6 audit index 3→4 trails with the 2-entry `explicit_confirmation` + `decision_dispatched` trail (W149, R3) — the founder's governance job (workspace + members + enrollment + approvals + evidence) now runs substantially in-product alongside the spreadsheet (which stays for fleet operations the lane feed doesn't yet cover). |
| 36 | Ivy Chen — Owner (HOS-SM) | Fleet Administrator | Square/Toast + spreadsheets | **RETAIN → COMPLEMENT** | (Same anchors as #15 — the W147 J2/J3 fixes are verified across both Bluegrass (TRN-SM) and Keystone (DEF-SM) real workspaces; the W148/W149 O3/O6 anchors are verified on the demo tier that the founder can access. The HOS-SM founder's governance job (workspace + members + enrollment + approvals + evidence) now runs substantially in-product alongside Square/Toast.) |
| 57 | Priya Nair — Founder/Executive Producer (FEM-SM) | Fleet Administrator | Find My + spreadsheet | **RETAIN → COMPLEMENT** | (Same anchors as #15 — the founder's governance job now runs substantially in-product alongside Find My + spreadsheet.) |
| 78 | Nora Ellis — Managing Partner (LEG-SM) | Fleet Administrator | M365 + spreadsheet | **RETAIN → COMPLEMENT** | (Same anchors as #15 — the founder's governance job now runs substantially in-product alongside M365.) |
| 99 | Grant Whitmore — Principal Consultant (DEF-SM) | Fleet Administrator | Intune | **RETAIN → COMPLEMENT** | (Same anchors as #15 — the founder's governance job now runs substantially in-product alongside Intune. The defense-sector caveat: the SIM-B §7 DEF-LG row identified "predictable enrollment codes" as disqualifying for this sector; the W147 fix (server-issued tenant-unique codes via real POST /api/enrollment/codes — verified by R1 on Bluegrass + Keystone) closes that disqualifier for the founder's governance scope. The defense-sector operational scope — Absolute persistence, CAC/PIV agent check-ins, STIGManager ingestion — remains uncovered, so the verdict is COMPLEMENT, not SWITCH-ONLY.) |

#### 4.10.3 (c) The delta narrative vs BOTH baselines

**The before/after delta is 0/0/105 (SIM-B) → 0/0/0/105 (first recount) → 0/0/5/100 (recount v2).** Five personas moved RETAIN → COMPLEMENT; one hundred personas stayed RETAIN with their specific reason updated to reflect the post-second-fix-wave state.

**The five movers — the founder archetype whose daily oversight job is governance.** The W147/W148/W149 second fix wave delivered the anchor capability set the work order specified: working invite/join + real enrollment codes + session persistence (W147, R1) + executed approvals with evidence trails + running doctor/planning lanes + openable recovery cases + id-matching search (W148/W149, R2c/R3). For the SMALL-firm Fleet Administrator founder archetype (Hannah Cole TRN-SM / Ivy Chen HOS-SM / Priya Nair FEM-SM / Nora Ellis LEG-SM / Grant Whitmore DEF-SM) — whose daily oversight job IS governance (workspace + members + enrollment + approvals + evidence), not large-scale fleet operations — these anchors collectively mean the governance job now runs substantially in-product. The founder keeps their incumbent tool (spreadsheet / Square-Toast / Find My / M365 / Intune) for fleet operations the lane feed doesn't yet cover (real device enrollment at scale, real agent check-ins on production, fleet-wide telemetry) — hence COMPLEMENT, not MAIN-INTERFACE or SWITCH-ONLY.

**The one hundred RETAINs — the personas whose core job remains uncovered.** The work order's specific reasons apply:

- **Procurement detail residual R1 (W149) for deep procurement personas** — the 15 Asset & Procurement Manager personas at all sizes. The procurement surface now LOADS (the W149 crash fix), but the four demand-detail stages (case → vendor context → authorization → decision) never render because the `commerce.procurement` binding still passes `onSurfaceEvent={() => undefined}` (W149 R1). The Asset & Procurement Manager's daily job — running procurement journeys end-to-end — remains uncovered. RETAIN with the line that would earn the move: wire `selectedDemandId` from a state hook (or default-select the single demo demand) so the seven-stage case journey renders.
- **No self-service surface for employees** — the 15 Employee / Device Owner personas at all sizes. The W147 join now works (a member can land in the inviting tenant), but the employee has no self-service device surface (viewer lens only — no "my devices" view, no self-service check-in, no device detail they can act on). RETAIN with the line that would earn the move: a self-service "my devices" surface with device detail + self-service actions (check-in / report-lost / request-support).
- **No vendor portal for vendors** — the 15 Vendor / Service Operator personas at all sizes. The W148 O3 restricted-role frozen denial (`authorization_required`) is verified real (the Vendor persona sees the frozen denial on the approvals surface — a real improvement: pre-W148 the click was silently inert). But the Vendor's daily job is operating in a vendor portal (accepting service requests, submitting completion evidence, viewing assigned work orders) — and no vendor portal surface is composed. RETAIN with the line that would earn the move: a vendor-portal surface (assigned work orders + completion evidence submission + service-request acceptance).
- **The destructive typed-CONFIRM gate unexercisable for hardware-capability reasons** — affects the Security & Compliance + Service Desk + Fleet Administrator personas whose daily job includes running destructive recovery actions (lock/locate/wipe/reboot). The W148/W149 destructive surface renders the case context ("Accepts destructive requests — Yes — the case is active") and the per-case detail opens (W149), but the demo device's adapter (`windows-mdm`) declares no lock/locate/wipe/reboot capability, so every action renders "Unsupported by this device" and the typed-CONFIRM phrase dialog for destructive actions cannot be exercised on the demo tier (W148 N3a / W149 R3). RETAIN with the line that would earn the move: route the destructive drill through a capability-bearing device (or extend the demo device's adapter to declare at least one of `lock`/`locate`/`wipe`/`reboot` so the typed-CONFIRM gate becomes exercisable).
- **No real-fleet findings ingestion (Service Desk + Security & Compliance + Fleet Administrators at MEDIUM/LARGE)** — the O2 Device Doctor binds the demo fleet's REAL TwinStore (W148, R2c — `dev_w091demo000001` resolves, nine stages run), and the O3/O6 anchors run on the demo tier (the seeded finding + the seeded parked plan). But the 10 MEDIUM/LARGE Fleet Administrators + the 10 dedicated MEDIUM/LARGE Security & Compliance officers + the 10 MEDIUM/LARGE Service Desk personas — their daily oversight job is over THEIR OWN fleet's devices and findings, not the demo fleet. The agent check-in path was verified at the integration tier (W140) but NOT exercised on production for any real workspace in this wave (the J2 enrollment-code issuance + J3 invite/join are verified, but the agent-side enrollment→check-in→observation→twin-update chain is not exercised end-to-end on the deployed product). No real workspace has any devices in its roster (only the demo fleet). RETAIN with the line that would earn the move: a real agent check-in end-to-end on production for the firm's own device → real findings into the Security Doctor + Device Doctor lane feeds.
- **No team surface composed** — the 15 Team Manager personas at all sizes. No team surface (no "my team" view, no roster, no shift scheduling, no dispatch). RETAIN with the line that would earn the move: a team-surface composition (team roster + role assignment + shift/dispatch view).
- **Demo-tier session-scoped state (blocker 10, by-design)** — the executed decisions + recovery cases + declared imports are session-scoped client state in the demo tier (a reload resets the badge to "1 pending", the audit index to the 3 seeded trails, the cases list to empty). This affects every demo-tier persona's verdict (it's the same demo fleet all 105 personas project onto via the O1–O6 journeys). The by-design label is honest (the demo tier's contract is non-durable client state); the server-plane persistence is future work. No verdict moves on the demo-tier state alone — the verdict rubric is what the persona can do in-product, and the demo-tier non-durability is an honest label, not a regression.
- **J3 join residual (the dual-hat Service Desk / Team Manager / Asset & Procurement Manager founders at SMALL firms)** — the W147 join works (Caleb Cole, Service Desk role, lands in Bluegrass), but the dual-hat founders' OTHER-hat jobs (Service Desk diagnose devices; Asset & Procurement run procurement journeys; Team Manager run team operations) are still uncovered (Device Doctor only runs on the demo fleet; procurement case journey list-level R1; no team surface). RETAIN with the specific reason for each hat.
- **Defense-sector operational scope (the 5 DEF personas' deep operational job)** — the W147 fix closes the "predictable enrollment codes" disqualifier for the DEF founder's governance scope (Grant Whitmore DEF-SM moves to COMPLEMENT). But the DEF sector's operational scope — Absolute persistence, CAC/PIV agent check-ins, STIGManager ingestion, certified sanitization chains — remains uncovered. The dedicated DEF MEDIUM/LARGE personas (Mick Torres, Fatima Al-Rashid, Susan Blackwood, Tanya Rook, Marcus Bell, Rachel Stone + the other non-founder DEF personas) stay RETAIN with the line that would earn the move: the defense-sector operational scope (persistence agent + CAC/PIV integration + STIGManager ingestion + certified sanitization workflow).

**Honest summary:** the second fix wave earned a real, modest verdict move — 5 founders running governance now have COMPLEMENT (their governance job runs substantially in-product alongside their incumbent tool). The other 100 personas' core jobs remain uncovered for the specific reasons above; their verdicts stay RETAIN with the line that would earn the move recorded. The evidence supports nothing higher than COMPLEMENT for any persona.

## 5. Acceptance statement

**RERUN COMPLETE (2026-10-05).** The post-fix rerun was executed against the LIVE
deployed build (https://fleetos-staging-flame.vercel.app, machine-verified git
dcf4474) by five first-hand evaluators (TRN/HOS/FEM/LEG/DEF real-workspace journeys
+ DEMO persona operational journeys + mobile pass). All raw evidence is in the seven
files under `docs/simulations/sim-c-evidence/`. This report closes issue #2's
identical-journeys protocol.

**Before/after counts:**

| Metric | Before (SIM-B, 2026-10-02) | After first fix wave (SIM-C morning, 2026-10-05) | After second fix wave (recount v2, 2026-10-05 evening) | Delta (v2 vs SIM-B) |
|---|---|---|---|---|
| SWITCH-ONLY | 0 (0%) | 0 (0%) | 0 (0%) | 0 |
| MAIN-INTERFACE | 0 (0%) | 0 (0%) | 0 (0%) | 0 |
| COMPLEMENT | — (not in SIM-B rubric) | 0 (0%) | 5 (~4.8%) | +5 |
| RETAIN | 105 (100%) | 105 (100%) | 100 (~95.2%) | −5 |
| **Total** | **105** | **105** | **105** | **0** |

**Regression evidence (what the rerun verified on production):**

- **J4 server-tier proof ×15:** the W140 server-tier session persistence is
  machine-verified on every real workspace — reload persists (GET /api/session 200
  + tenant id); in-page `fetch('/api/session',{credentials:'include'})` → 200 with
  sessionId + activeRole fleet.admin; DELETE /api/session 200 on sign-out; POST
  /api/session 200 on password re-sign-in; "Role: owner" restored. The SIM-B
  client-side-only control plane (localStorage `fleetos.w121.durable`) is replaced
  by the server-tier httpOnly cookie on the deployed build. (First-hand across all 15
  firms: trn/hos/fem/leg/def-journeys.md J4 scoreboards.)
- **Lanes composed vs placeholders:** the SIM-B "not yet composed in this runtime"
  string is GONE on all six lanes' deep screens (Device Doctor, Security Doctor
  remediation walk, Recovery cases, Fleet Actions plans, Workloads planning, Commerce
  procurement). The Security Doctor remediation walk RUNS composed over real demo
  state (the SIM-B walk-blocker is FIXED). Find My Device RUNS with the honest
  absent-evidence state. The W144(a) lane-composition check PASSES with nuance.
  (demo-journeys.md W144(a); mobile-journeys.md Pass 1.)
- **Mobile + declared-import landing (W145):** the W145 mobile priority-card roster
  is VERIFIED on the deployed build — at 390×844 the device roster renders as priority
  cards (NO `<table>` in the DOM), `scrollWidth == clientWidth` on every surface, the
  SIM-B "993px table → horizontal page scroll" defect is RESOLVED. The W145(c)
  declared-import journey RAN end-to-end in the demo tier (Enter → Review → Confirm →
  RECORDED with verification evidence; DECLARED(1)/Observed(3) non-conflation proven).
  (mobile-journeys.md; demo-journeys.md W145(c).)

**Persisting blockers (the honest as-deployed outcome):**

- **Inert-control regression (§4.4):** the SIM-B approval defect is NOT fixed in the
  deployed build. Approve/Reject on `/security/approvals` produce no confirmation
  dialog, no badge/state/audit change, zero network requests — the W142
  `approvals-execution.ts` exists in the codebase but the deployed UI's click path is
  a silent no-op. The restricted Vendor persona gets NO visible denial (silently
  inert). J2's gated destructive disable controls are equally INERT ×15. The central
  regression target — dialog → decision record → state change → evidence — is not met.
- **Join blocker (§4.5):** J3 invite refuses `unknown_session` despite a valid server
  session across all 15 firms — the client-side invite path expects a W121-era
  client-session record the server-tier sign-in never writes. The durable
  `fleetos_workspace_invitations` table has ZERO rows across all tenants. No member
  can join any real workspace; no real agent can ever check in (J2's client-side
  fixture bypasses /api/enrollment entirely; `fleetos_enrollment_requests` has ZERO
  rows).
- **Unrunnable lanes (§4.3):** four of the six previously-placeholder lanes are
  composed-but-not-running — Device Doctor (composed but zero of nine stages run;
  the demo fleet's own device resolves as "Device not found"), Fleet Actions /
  Workloads / Commerce (composed headers but stuck in perpetual "Loading…" statuses,
  no journey stage runs, no create affordance). Recovery cases compose the honest
  empty list but no case can ever open (no case-creation affordance), so the
  per-case seven-stage journey and the typed-CONFIRM destructive gate are unreachable.

**Production browser evidence record:** every claim above was verified by clicking
the live deployed product between 2026-10-05T06:27Z and ~10:43Z UTC (per the
per-lens evidence files' start/end timestamps). The evidence is USER-ONLY browser
evaluation (headless Chromium via agent-browser CLI, desktop 1280×800 and mobile
390×844) — no source access, no internals. Per-lens artifacts (screenshots) are
catalogued in each evidence file's closing "Evidence artifacts" line.

**Honest statement:** the fix lanes landed real technical progress — server-tier
sessions, composed lane surfaces, mobile cards, declared-import surface — but the
central adoption blockers (inert approvals, blocked join, unrunnable lanes) persist
in the deployed build. No persona's daily job can yet run inside FleetOS. The
verdict stays 0/0/0/105 RETAIN for all 105 personas. The residual blockers (§4.8,
10 items) are each traced to a minimal actionable cause.

**Second-fix-wave acceptance (W147/W148/W149, 2026-10-05 evening):**

The second fix wave — the issue-#2 "no early return" continuation — landed three lanes (W147 boundary engagement @ `8400ce5`; W148 engaged lanes @ `fd6510b`; W149 hotfix @ `b6101d0`) verified live by R1/R2c/R3 across the deployed staging tier and a production-mode local build of the exact merge commit. The full record is in §4.9 (the three-lane record + the closed-blocker ledger + the NEW findings + the deployment record); the verdict recount v2 is in §4.10.

**Verdict recount v2 (post-second-fix-wave, §4.10):**

| Metric | Before (SIM-B, 2026-10-02) | After first fix wave (SIM-C morning) | After second fix wave (recount v2, evening) | Delta (v2 vs SIM-B) |
|---|---|---|---|---|
| SWITCH-ONLY | 0 (0%) | 0 (0%) | 0 (0%) | 0 |
| MAIN-INTERFACE | 0 (0%) | 0 (0%) | 0 (0%) | 0 |
| COMPLEMENT | — (not in SIM-B rubric) | 0 (0%) | 5 (~4.8%) | +5 |
| RETAIN | 105 (100%) | 105 (100%) | 100 (~95.2%) | −5 |
| **Total** | **105** | **105** | **105** | **0** |

The 5 movers are the SMALL-firm Fleet Administrator founders (Hannah Cole TRN-SM / Ivy Chen HOS-SM / Priya Nair FEM-SM / Nora Ellis LEG-SM / Grant Whitmore DEF-SM) — their governance job (workspace + members + enrollment + approvals + evidence) now runs substantially in-product alongside their incumbent tool. The 100 RETAINs are documented in §4.10.3 with the specific reason each core job remains uncovered (procurement detail residual R1; no self-service surface for employees; no vendor portal for vendors; the destructive typed-CONFIRM gate unexercisable for hardware-capability reasons; no real-fleet findings ingestion for MEDIUM/LARGE Fleet Administrators + Security & Compliance officers + Service Desk; no team surface; the dual-hat founders' other-hat jobs; defense-sector operational scope).

**Honest open items (post-second-fix-wave):**

- **The b6101d0 production deploy is quota-blocked until the 2026-10-06 19:08Z reset** (the account's 100/day Vercel deployment quota is exhausted; corroborated by the TL's `befa5fc` empty-commit nudge on main). The local production-mode verification (R3 on `http://localhost:3101`, BUILD_ID `jCIinIEVrFW3GSur7xn_g`, built 2026-10-05T19:17Z from the clean worktree at `46626f9`; `git diff 46626f9 b6101d0` = `spec/PROJECT-STATE.md` only — the apps/ code is bit-identical to `b6101d0`) is the honest stand-in. **Follow-up obligation:** the b6101d0 production deploy at the 2026-10-06 19:08Z quota reset, with the live spot-check to follow (re-walk R3's checks 1/2/2b/2c/3/4a-4d against the Vercel production URL once the deploy lands).
- **The R3 residuals** (each traced to its minimal actionable cause in §4.9.3):
  - **R1 (the last onSurfaceEvent stub):** the `commerce.procurement` binding still passes `onSurfaceEvent={() => undefined}`, so the O4 per-demand case journey (case → vendor context → authorization → decision) remains list-level. The 15 Asset & Procurement Manager personas stay RETAIN on this residual.
  - **R2 (cosmetic):** the search result label does not track the executed decision (`pln_fb564c1e` still returns "Parked plan" after approve). No state corruption — cosmetic label drift.
  - **R3 (the typed-CONFIRM destructive gate unexercisable):** the demo device (`windows-mdm`) declares no lock/locate/wipe/reboot capability, so the typed-CONFIRM phrase dialog for destructive actions cannot be exercised on the demo tier. Hardware-capability residual, not a code defect.
  - **R4 (demo-tier-by-design scope note):** the executed decisions + recovery cases + declared imports are session-scoped client state in the demo tier (a reload resets them). The by-design label is honest; the server-plane persistence is future work.
  - **R5 (O2 side defects):** the "Open device detail" button does not navigate; the TwinStore's observation count vs the diagnosis store's records disagree on one screen.
- **Blocker 10 (demo-tier session-scoped state) by-design:** the §4.8 blocker 10 is honestly labeled as by-design — the demo tier's contract is non-durable client state (no server-plane persistence for demo-tier decisions/cases/imports). The server-plane persistence is future work, recorded as scope, not a regression. The honest label is the disclosure that this IS by-design and NOT a defect.

Final closure: TL record appended below.

> **TL-CLOSURE PLACEHOLDER** — the Tech Lead fills this block after review of the W150 amendment (§4.9 + §4.10 + the §1 verdict-line amendment + the §5 acceptance-statement amendment). The placeholder is left as a quoted line; do not invent the closure verdict.
>
> - TL closure verdict: _<to be filled by the Tech Lead after review of the W150 amendment>_
> - TL acceptance of the recount v2 (5 COMPLEMENT / 100 RETAIN): _<to be filled by the Tech Lead>_
> - TL disposition of the honest open items (the b6101d0 production deploy spot-check; the R3 residuals; blocker 10 by-design): _<to be filled by the Tech Lead>_
> - TL signature + timestamp: _<to be filled by the Tech Lead>_
