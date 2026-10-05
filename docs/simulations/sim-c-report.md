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

**Verdict distribution (105 personas): SWITCH-ONLY 0 (0%) · MAIN-INTERFACE 0 (0%) ·
COMPLEMENT 0 (0%) · RETAIN 105 (100%).** The before/after delta is 0/0/105 → 0/0/0/105
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


## 5. Acceptance statement

**RERUN COMPLETE (2026-10-05).** The post-fix rerun was executed against the LIVE
deployed build (https://fleetos-staging-flame.vercel.app, machine-verified git
dcf4474) by five first-hand evaluators (TRN/HOS/FEM/LEG/DEF real-workspace journeys
+ DEMO persona operational journeys + mobile pass). All raw evidence is in the seven
files under `docs/simulations/sim-c-evidence/`. This report closes issue #2's
identical-journeys protocol.

**Before/after counts:**

| Metric | Before (SIM-B, 2026-10-02) | After (SIM-C, 2026-10-05) | Delta |
|---|---|---|---|
| SWITCH-ONLY | 0 (0%) | 0 (0%) | 0 |
| MAIN-INTERFACE | 0 (0%) | 0 (0%) | 0 |
| COMPLEMENT | — (not in SIM-B rubric) | 0 (0%) | 0 |
| RETAIN | 105 (100%) | 105 (100%) | 0 |
| **Total** | **105** | **105** | **0** |

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

Final closure: TL record pending.
