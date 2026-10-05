# W148 Verification — the engaged-lanes fixes on the live deployment

- Evaluator: R2 (browser-verification worker, FleetOS tech-lead dispatch; ran the full drill set 17:37–18:04Z and captured the screenshots, but ran out of time before writing this file) — **completed by R2c** (evidence-completion worker; EVALUATION ONLY — zero product-code changes; all mutations were the expected journey drills: one approve execution, one reject execution, duplicate/ restricted-role probes, one recovery-case creation, one enrollment code, one invitation)
- Artifact-count note: the dispatch listed "19 screenshots" but enumerates 20 filenames; **all 20 `r2-*.png` files are on disk and every one is cited below** (the same brief-miscount pattern as the demo-journeys prior-evaluator note).
- Target: https://fleetos-staging-flame.vercel.app (Vercel staging tier)
- Deployed build: **fd6510b** (merge of work/w148 @ 71b00ab, manually deployed via Vercel dpl_35RvdQiN ~17:30Z Oct 5 2026 after the fd6510b push missed the webhook)
- Session: `agent-browser --session r2` (R2) / `agent-browser --session r2c` (R2c completion pass; retry wrapper /home/z/ab-r2c, desktop viewport 1280×~577)
- First-hand windows: **R2 2026-10-05T17:37Z → 18:04Z** (the 20 `r2-*.png` screenshots) + **R2c re-verification 2026-10-05T~18:08Z → 18:29Z** (live re-walk of every check whose screenshot was below-the-fold or ambiguous, plus the O4 crash root-cause capture)
- Defect record this pass targets: demo-journeys.md O2–O6 (Scoreboard: O2/O4 DEFECT, O3/O5 DEFECT-PARTIAL, O6 audit-entry expectation; Notes 1–5, 7)
- Honesty note: R2's screenshots for the four below-the-fold surfaces (`r2-o2-doctor-nine-stages.png`, `r2-o5-cases-create-affordance.png`, `r2-o5-findmy-no-location-evidence.png`, `r2-o4-planning-ready.png`) captured only the page header + onboarding rail — every load-bearing fact for those checks was re-verified first-hand by R2c on the live product and is marked **[R2c live]** below. All other facts are R2's screenshots corroborated by R2c where cheap.

## Verification table

| # | Check | Verdict | Evidence (one line) |
|---|---|---|---|
| 0 | Deployment fingerprint | PASS | `GET /api/health` → 200 `{"env":"staging","health":"healthy","module":"web","secrets":[…all 9 present…]}`; live app-route chunk `_next/static/chunks/app/[[...slug]]/page-4d4e0c6fa0840a99.js` — the same chunk the O4 crash stack names (build-fingerprint corroboration) |
| 1a | O3 Approve opens a REAL typed-phrase confirmation dialog | PASS | [Approve] → alertdialog "Approve parked plan": "Approving "w091-demo-enable-encryption" releases the plan for downstream dispatch. This transition is gated on a human decision and is audited." + acknowledgment checkbox + "Type the exact confirmation phrase to unlock the dispatch: CONFIRM APPROVE pln_fb564c1e"; Confirm button disabled until checkbox+phrase (`r2-o3-approve-dialog.png` + [R2c live]) |
| 1b | Approve EXECUTES — badge drops | PASS | typed phrase + acknowledgment → Confirm approve → dialog closes, topbar badge "Approvals inbox: 1 pending" → **"Approvals inbox: 0 pending"** (`r2-o3-executed-badge-zero.png` + [R2c live]) |
| 1c | Duplicate-decision safety on approve | PASS | second Approve with the same phrase → in-dialog refusal **"already_decided — The plan 'pln_fb564c1e' has already been decided."** (`r2-o3-already-decided.png` + [R2c live]) |
| 1d | Reject dialog records a reason (typed phrase + textarea) | PASS | alertdialog "Reject parked plan": "Rejecting "w091-demo-enable-encryption" ends the plan as REJECTED — the plan does NOT execute…" + "CONFIRM REJECT pln_fb564c1e" + "Rejection reason (recorded by the boundary; the plan does NOT execute):" [textarea] (`r2-o3-reject-dialog.png` + [R2c live]) |
| 1e | Reject executes (badge drop) + duplicate reject refused | PASS | reason "r2c-live-reject-probe" + phrase → Confirm reject → badge → **0 pending**; duplicate → **"already_decided — The plan 'pln_fb564c1e' has already been decided."** (`r2-o3-reject-already-decided.png` + [R2c live]) |
| 1f | Restricted role gets the FROZEN authorization_required denial | PASS | Vendor persona, full phrase+ack typed → **"authorization_required — This action requires the "fleet.action.approve" permission. Active role(s): vendor.operator. Request the role assignment from your Fleet Administrator."**; badge stays "1 pending" (`r2-o3-vendor-authorization-required.png` + [R2c live]) |
| 1g | Executed decision → record/state/audit propagation | **PARTIAL** | The decision executes at the approvals boundary (badge drop, already_decided, frozen denial all real) but NO surface reflects it: the queue card still reads "Parking decision · Approval required · REQUIRE_APPROVAL" with live-looking [Approve]/[Reject]; Security Doctor still "Human approval — In progress (Parked at 2026-01-06T11:00:00Z)" / "Action — Plan PARKED — Pending"; Evidence index unchanged (only the 3 seeded trails — NO new decision/dispatch audit entries). The O6 post-fix expectation stays unmet (see Notes N2) |
| 2 | O4 Workload planning resolves to ready over the REAL profile | PASS | [R2c live] "Workload planning · 1 workload profile defined · plans, versioned recommendations and capacity signals" + row "w091-demo-analyst-workstation · wl_w091demo000001 · analyst-workstation · r1 · security 0.9 / compute 0.7 / memory 0.6 / confidence 0.85 · 1 app · 1 env · 0 peripherals · internal · 1 links · 09:00–18:00" — the perpetual "Loading the workload planning surface" is GONE (`r2-o4-planning-ready.png` headline + [R2c live]) |
| 3 | O4 Commerce → procurement surface | **FAIL — NEW DEFECT (client-side crash)** | `/commerce/procurement` renders **"Application error: a client-side exception has occurred while loading fleetos-staging-flame.vercel.app (see the browser console for more information)."** (12 KB screenshot `r2-o4-procurement-crash.png`; re-verified live twice by R2c incl. the captured root cause — see Notes N1) |
| 4 | O2 Device Doctor nine-stage journey over the REAL TwinStore | PASS | [R2c live] "Device Doctor · Diagnosis record for dev_w091demo000001" — the device RESOLVES (the "Device not found in your fleet" blocker is GONE) and all nine stages render with honest states: Device under diagnosis **Done** (Device: dev_w091demo000001 · Lifecycle: ENROLL · Adapter family: windows-mdm · Observation count: 1), Observations ingested "None recorded yet / Not yet observed", Symptoms detected "no_anomalies_detected · 0/0 / Nothing to show — honest empty", Diagnosis recorded "Not yet observed", Remediation recommended "no_recommendations_yet · Proposals: 0", Authorization state "0 · 0", Action requested "0 · 0", Execution result "0 · 0", Evidence artifacts "0 · —" (`r2-o2-doctor-nine-stages.png` header only + [R2c live] full surface) |
| 5a | O5 case-creation affordance + case opens | PASS | [R2c live] "Open recovery case" button on the cases surface → click → "Recovery effort · 1 active · 0 closed · 1 total. Active cases are listed first." + row "case_w148_devw091demo000001_20260106140000 · dev_w091demo000001 · OPEN — Needs attention · lost_device_report · 2026-01-06T14:00:00Z · v1" (`r2-o5-cases-create-affordance.png` header only, `r2-o5-case-created-list.png` + [R2c live]) |
| 5b | O5 typed-CONFIRM gate reachable (destructive precondition) | PARTIAL | [R2c live] with the session case active, `/recovery/destructive` renders "Recovery case context … Accepts destructive requests · **Yes — the case is active**" (the honest no-case refusal is GONE in-session) — but every action is "Unsupported by this device — The device's adapter does not declare the lock/locate/wipe/reboot capability", so NO gated control and the typed-CONFIRM phrase dialog itself remains unexercisable; the per-case seven-stage detail also never opens (see Notes N3) |
| 5c | O5 Find My honest no_location_evidence | PASS | [R2c live] "Last seen · The evidence ledger for this device is empty. · No last-seen evidence yet … an absence of evidence is never treated as freshness." + "Last-known location … **No location evidence — Unknown** — This device has not reported location-bearing evidence. … never interpolated, never guessed." + "Evidence ledger (append-only) · 0 revisions · 0 carried location evidence · The ledger is empty" (`r2-o5-findmy-no-location-evidence.png` header only + [R2c live]) |
| 6a | Search matches a record id AS QUERY | PASS | Ctrl+K `pln_fb564c1e` → "Fleet Actions · Parked plan — w091-demo-enable-encryption · matched keyword exact — pln_fb564c1e" (the demo-journeys NEW-finding-4 "No records matched" defect is FIXED) (`r2-search-planid-match.png` + [R2c live]) |
| 6b | Search keyword match, deterministic order | PASS | `encryption` → "Fleet Actions · Parked plan — w091-demo-enable-encryption · matched keyword exact — pln_fb564c1e" then "Security · CRITICAL — Disk encryption is disabled · matched keyword exact — sec_042000b6"; footer "↑↓ to move · Enter to open · Esc to close — search semantics are deterministic (W061 contract)." (`r2-search-keyword-encryption.png` + [R2c live]) |
| 7 | In-vocabulary routes bound (no "not yet composed in this runtime") | PASS | `/security/decisions` → "Guardian decisions · Contract Guardian decisions · Every decision the deterministic policy layer has made…" (honest "No Guardian decisions recorded"); `/workloads/recommendations` → the planning surface (same ready content as check 2); `/commerce/software` → "Software · The software catalog: workload needs, allocated entitlements and verified outcomes." — ZERO "not yet composed" strings (the demo-journeys NEW-finding-5 residue is FIXED) (`r2-route-*.png` ×3 + [R2c live]) |
| 8 | J2/J3 regression spot-check (W147 fixes intact after W148) | PASS | J2 [R2c live]: "3. Your one-time enrollment code · Created 2026-10-05T18:25:26.931Z — expires 2026-10-06T18:25:26.931Z · Active — active · Request **enr_f03b5b2e** · Corporate-owned · **enrollwVDQJT2U44SXZJK6W3354** · Shown once — copy it now…" + REAL `[POST /api/enrollment/codes 201]`; J3 [R2c live]: one-time join code **joinwPU36CJB5CH3WM73WN2AR** + display-once copy + REAL `[POST /api/workspace/invitations 201]` (R2's 18:02Z screenshots: enr_f0c2cd5f/enrollwZTX72N4WATNLFP0FKJIT + joinwGKUSENWD6V66ZQGQGXBH) — server-issued, tenant-unique, current clock (no fixture regression) |

## Per-check verbatim detail

### 0. Deployment fingerprint (curl + live chunk, R2c 18:1xZ)

- `GET /api/health` → 200: `{"env":"staging","health":"healthy","module":"web","secrets":[{"name":"FLEETOS_ENV","present":true},…{"name":"R2_BUCKET","present":true}]}` (all 9 present) — same body R1 recorded on 8400ce5.
- The live deployment serves the app-route chunk `_next/static/chunks/app/%5B%5D...slug%5D%5D/page-4d4e0c6fa0840a99.js` — the exact chunk the O4 procurement crash stack names (see N1), corroborating that the R2 crash (17:52Z) and the R2c re-verification (18:0x–18:2xZ) hit the SAME deployed build (fd6510b; no newer deploy in between — identical chunk hash + identical verbatim failure).

### 1. O3 — the approvals decision path (owner walk, [R2c live] unless noted)

Approvals queue (owner, `usr:demo.fleet.admin@fleetos.demo`), badge "Approvals inbox: 1 pending":

- "Approvals queue · Consequential actions the Contract Guardian parked for a human decision — parked first, decided by an owner, never auto-promoted. | Acting approver: usr:demo.fleet.admin@fleetos.demo | w091-demo-enable-encryption | Plan pln_fb564c1e v2 · parked 2026-01-06T11:00:00Z | Capability lock | Targets 1 device(s) | Requested by unknown | Parking decision Approval required REQUIRE_APPROVAL | Parking reasons (machine-stable, verbatim) policy.rule.matched (rule pol_051a7934) | Evidence: 0 opaque artifact(s) · no direct-execution path exists on this surface. | [Approve] [Reject] | Both transitions are gated on a human decision and require confirmation — they are never one-click."

**(a) Approve dialog** (button accessible name: "Approve the parked plan w091-demo-enable-encryption (gated on human_decision, confirmation required)"; `r2-o3-approve-dialog.png` + live):

- Status line: "A approve confirmation is open for this plan."
- "Approve parked plan | Approving "w091-demo-enable-encryption" releases the plan for downstream dispatch. This transition is gated on a human decision and is audited. | Plan pln_fb564c1e | Capability lock | Targets 1 device(s) | Gate human_decision | Confirmation typed phrase required (never one-click)"
- Checkbox: "I acknowledge the consequences of this approve decision. The boundary will record an audit entry; the plan's state will change."
- "Type the exact confirmation phrase to unlock the dispatch: **CONFIRM APPROVE pln_fb564c1e**" (input) — the [Confirm approve] button is disabled until BOTH the checkbox and the exact phrase are supplied (verified: `is enabled` false→true).

**(b) Execution**: checked the box, typed the phrase, clicked "Confirm approve" → the dialog closes and the topbar badge drops "Approvals inbox: 1 pending" → **"Approvals inbox: 0 pending"** (`r2-o3-executed-badge-zero.png` at 18:04Z shows the same end state).

**(c) Duplicate-decision safety**: reopening the Approve dialog and re-confirming with the same phrase renders IN-DIALOG: **"already_decided — The plan 'pln_fb564c1e' has already been decided."** (`r2-o3-already-decided.png` + live re-run; the R2 screenshot also shows the phrase typed and the checkbox ticked).

**(d) Reject dialog** (`r2-o3-reject-dialog.png` + live):

- Status line: "A reject confirmation is open for this plan."
- "Reject parked plan | Rejecting "w091-demo-enable-encryption" ends the plan as REJECTED — the plan does NOT execute. This transition is gated on a human decision and is audited. | Plan pln_fb564c1e | Capability lock | Targets 1 device(s) | Gate human_decision | Confirmation typed phrase required (never one-click)"
- Checkbox: "I acknowledge the consequences of this reject decision. The boundary will record an audit entry; the plan's state will change."
- "Type the exact confirmation phrase to unlock the dispatch: **CONFIRM REJECT pln_fb564c1e**"
- "Rejection reason (recorded by the boundary; the plan does NOT execute):" [textarea] — R2 filled "duplicate-probe"; R2c filled "r2c-live-reject-probe".
- Execution: badge → **0 pending**; a second Reject with the same phrase → in-dialog **"already_decided — The plan 'pln_fb564c1e' has already been decided."** (`r2-o3-reject-already-decided.png` + live).

**(e) Restricted role** (Demo — Vendor / Service Operator, "Role: viewer", `r2-o3-vendor-authorization-required.png` + [R2c live]): the vendor sees the same queue ("Acting approver: usr:demo.vendor.operator@fleetos.demo"), opens the Approve dialog, checks the box, types the full phrase, clicks Confirm approve → **frozen denial, in-dialog**:

> **authorization_required — This action requires the "fleet.action.approve" permission. Active role(s): vendor.operator. Request the role assignment from your Fleet Administrator.**

The badge stays "Approvals inbox: 1 pending" (no state change). The pre-W148 "silently inert" restricted-role defect (demo-journeys Note 1) is GONE.

**(f) The propagation gap (check 1g — PARTIAL)**: after BOTH an executed approve and an executed reject (separate sessions), the visible surfaces do not change:

- Approvals queue card: STILL "Parking decision · Approval required · REQUIRE_APPROVAL" with both [Approve]/[Reject] buttons present and clickable (only the in-dialog already_decided guard stops a re-decision).
- Security Doctor (`/security/doctor`): "Human approval · Parked at 2026-01-06T11:00:00Z — held for a human decision · **In progress**"; "Action · Plan PARKED · **Pending**"; "Current state … Approval required REQUIRE_APPROVAL · Approval required PARKED".
- Evidence trail index (`/evidence`): unchanged — exactly the 3 seeded trails ("Approved plan — w091-demo-lock-lost-device pln_61004cf8 / W091-DEMO-0001 — Lenovo ThinkPad T14 dev_w091demo000001 / CRITICAL — Disk encryption is disabled sec_042000b6"), no pln_fb564c1e trail, no new decision/dispatch steps. The W148 machine-test claim of a "2-entry audit" does NOT surface in the demo-tier UI (see Notes N2).

### 2. O4 — workload planning resolve (Asset & Procurement Manager persona, [R2c live])

`/workloads/planning`: "Workload planning · **1 workload profile defined** · plans, versioned recommendations and capacity signals | Workload plans | Columns: workload, kind, revision, requirement highlights, constraints, evidence, working hours. | Workload profiles — 1 defined, ordered by workload id" and the profile row:

- "w091-demo-analyst-workstation | **wl_w091demo000001** | analyst-workstation | r1 | security: 0.9 / compute: 0.7 / memory: 0.6 / confidence 0.85 | 1 app / 1 env · 0 peripherals / internal / 1 links — The evidence observation links behind this revision | 09:00–18:00"

The pre-W148 perpetual `status` "Loading the workload planning surface" is GONE — the lane resolves to ready over the REAL workload profile. Screenshot: `r2-o4-planning-ready.png` (R2, headline) + `r2c-o4-planning-ready.png` (full surface).

### 3. O4 — commerce procurement: **the crash** (R2 17:52Z + R2c live ×2)

- Hard load of `/commerce/procurement` renders ONLY: **"Application error: a client-side exception has occurred while loading fleetos-staging-flame.vercel.app (see the browser console for more information)."** — the Next.js production global-error page; nothing else renders (`r2-o4-procurement-crash.png`, 12 KB; R2c re-verified identically at ~18:1xZ and again at ~18:2xZ).
- Client-side navigation to the route (sidebar → Commerce, which lands on procurement) throws the render exception while leaving the URL at /commerce/procurement with the previous screen's content — the route content never renders.
- Root cause captured live by R2c via a pre-installed window error collector on the client-side navigation:

> **TypeError: Cannot read properties of undefined (reading 'chainStatusCounts')** — at `…/_next/static/chunks/app/[[...slug]]/page-4d4e0c6fa0840a99.js:1:703965` (+ the React render stack).

- Source-level minimal actionable cause (read-only code inspection of fd6510b): `apps/web/src/console-app.tsx` (~L1736) binds the route with `view: feed.phase.view as unknown as ProcurementScreenData` — a BLIND double-cast of the W143 `composeProcurementCasesFeed` view-model (`{tenantId, demands, selected, vendors, orders}` — **no `verification` field**, see `apps/web/commerce/src/procurement-feed.ts` empty/ready/unsupported view builders) onto the screen's `ProcurementScreenData` (which REQUIRES `verification: OrderVerificationView`); `apps/web/commerce/src/screens/procurement-screen.tsx` L822 then renders `<VerificationCard verification={ready.verification} />` with `ready.verification === undefined`, and L238 `Object.entries(verification.chainStatusCounts)` throws. The same blind cast also hides the missing `selected.evaluations` field. **Fix**: build a real (or honest-empty via `buildOrderVerificationView(tenantId, null)`) `OrderVerificationView` at the binding site and remove the `as unknown as` cast so typecheck catches the shape drift. See Notes N1.

### 4. O2 — the Device Doctor nine-stage journey (Service Desk persona, [R2c live])

`/device/doctor` — "Device Doctor | Diagnosis record for dev_w091demo000001 — summary, current state, recommended actions, evidence, and history." — **the demo tenant's own device RESOLVES** (pre-W148: "Device not found in your fleet | The device is not enrolled in your tenant, or the identifier is wrong…"). Summary: "Diagnosis surface as of 2026-01-06T14:00:00Z | Device dev_w091demo000001 | Signal kinds 0 | Anomalies 0 critical · 0 warning | Active diagnoses 0 | Active treatment proposals 0 | Evidence artifacts 0 | No health signals have been derived for this device yet. Observations must be ingested before the doctor can interpret anything — an absence of evidence is not evidence of health."

The diagnosis journey — "The full operator walk as of 2026-01-06T14:00:00Z — device, observations, symptoms, diagnosis, remediation, authorization, action, result, evidence. Every stage reflects real runtime state; stages the runtime has no records for say so.":

1. "Device under diagnosis — Device: dev_w091demo000001 · Lifecycle: ENROLL · Adapter family: windows-mdm · Observation count: 1 — **Done**"
2. "Observations ingested — Observations: None recorded yet — **Not yet observed**"
3. "Symptoms detected — State: no_anomalies_detected · Critical / warning: 0 / 0 — **Nothing to show — honest empty**"
4. "Diagnosis recorded — Diagnoses: None recorded yet — **Not yet observed**"
5. "Remediation recommended — State: no_recommendations_yet · Proposals: 0 — **Nothing to show — honest empty**"
6. "Authorization state — Evaluated requests: 0 · Parked: 0 — **Not yet observed**"
7. "Action requested — Durable requests: 0 · Accepted proposals: 0 — **Not yet observed**"
8. "Execution result — Executed: 0 · Failed: 0 — **Not yet observed**"
9. "Evidence artifacts — Artifacts: 0 · Algorithms: — — **Not yet observed**"

Plus the honest walks: Symptom walk "No anomalies detected — Nothing crossed a detection rule in the current window. The walk stays empty — no symptom is ever invented…"; Remediation walk "No treatment recommendations — Treatments are proposed once a diagnosis identifies a remediable cause. Until then this walk stays honestly empty…"; Current state "Signals (0) Baselines (0) Anomalies (0) Diagnoses (0) Treatments (0) · No signals derived yet…"; Evidence "No evidence artifacts — Evidence refs appear when observations back a diagnosis."; History "0 diagnosis versions and 0 treatment versions are recorded in the interpretation ledger…". Residual: the "Open device detail" button still does NOT navigate (path stays /device/doctor — pre-existing side defect, unchanged); stage 1 says "Observation count: 1" while stage 2 says "Observations: None recorded yet" (TwinStore count vs the diagnosis store — see Notes N4). Screenshot: `r2-o2-doctor-nine-stages.png` (header only) + `r2c-o2-doctor-nine-stages.png`.

### 5. O5 — recovery cases + the destructive gate (owner persona, [R2c live])

**(a) The create affordance** (`/recovery/cases`): "Recovery cases | The durable, versioned context for lost-device and posture-escalation recovery. | No recovery cases | Cases open from lost-device reports or posture escalations. A case is the durable context that gates every destructive recovery action. | **[Open recovery case]**" — the affordance the pre-W148 runtime lacked (demo-journeys Note 7).

**(b) Case creation** (click): "Recovery effort | 1 active · 0 closed · 1 total. Active cases are listed first." + "Recovery cases — active recovery first | CASE DEVICE STATUS TRIGGER OPENED AT VERSION | **case_w148_devw091demo000001_20260106140000 | dev_w091demo000001 | OPEN — Needs attention | lost_device_report | 2026-01-06T14:00:00Z | v1**" (`r2-o5-case-created-list.png` + live). R2's 18:00Z search screenshots (taken after a reload) show "No recovery cases" behind the dialog — the case is session-scoped client state (dies on reload; demo-tier-by-design, Notes N5).

**(c) The destructive gate with an active case** (client-side navigation so the session case persists): "Destructive actions | Gated recovery actions for dev_w091demo000001 — lock, locate, wipe, and reboot through the full authorization path. | **Recovery case context** | The gate's precondition, visible. | Case case_w148_devw091demo000001_20260106140000 — OPEN — Needs attention | Device dev_w091demo000001 | Trigger lost_device_report | Case version v1 | **Accepts destructive requests — Yes — the case is active**" — the honest "No active recovery case… there is no ungated path" refusal is GONE in-session. BUT the typed-CONFIRM gate itself stays out of reach: every action renders "Unsupported by this device — The device's adapter does not declare the lock/locate/wipe/reboot capability. Unsupported destructive behavior is never emulated." and "There is no direct-execution control on this screen: the surface contracts make one-click destructive execution unrepresentable. Requests route through the domain boundary…". The Lost-device flow renders its stages (Last-seen evidence "No last-seen evidence recorded yet — Pending"; Recovery case opened — In progress; Locate/Lock/Destructive action (wipe) — Unsupported; Verification — Pending; Replacement escalation — Pending). Also: clicking a case row in the list does NOT open the per-case seven-stage detail (see Notes N3).

**(d) Find My Device** (`/recovery/find-my`): "Last seen | The evidence ledger for this device is empty. | No last-seen evidence yet | Last-seen records appear when the device reports observations. Until then, this device's recency is Unknown — an absence of evidence is never treated as freshness. | Last-known location | The machine-stable absent-evidence state. | **No location evidence — Unknown** | This device has not reported location-bearing evidence. The state is presented exactly as the domain asserts it — never interpolated, never guessed. Location appears only when a location-bearing observation arrives. | Evidence ledger (append-only) | 0 revisions · 0 carried location evidence | The ledger is empty | Next step | A lost device needs a recovery case: the durable, versioned context that gates every destructive recovery action (locate, lock, wipe, reboot) behind the Contract Guardian and human approval. | [Open recovery case] [View recovery cases]" — byte-equivalent to the pre-W148 honest states (no regression; the R2 screenshot captured only the header, re-verified live).

### 6. Search (owner persona; `r2-search-*.png` + [R2c live])

- Query `pln_fb564c1e` (the parked plan's id AS QUERY): exactly one result — "Fleet Actions | Parked plan — w091-demo-enable-encryption | **matched keyword exact — pln_fb564c1e**". The pre-W148 honest-no-match ("No records matched "pln_fb564c1e". Try a device name, a finding title, a vendor, or a capability.") is GONE — W148's id-matching works.
- Query `encryption`: two results in stable order — "Fleet Actions | Parked plan — w091-demo-enable-encryption | matched keyword exact — pln_fb564c1e" then "Security | CRITICAL — Disk encryption is disabled | matched keyword exact — sec_042000b6".
- Dialog footer: "↑↓ to move · Enter to open · Esc to close — search semantics are deterministic (W061 contract)."

### 7. In-vocabulary routes (owner persona; `r2-route-*.png` ×3 + [R2c live])

- `/security/decisions` → "Security / Guardian decisions | Contract Guardian decisions | Every decision the deterministic policy layer has made — the reasons are machine-stable and presented verbatim. | Decisions (0) · BLOCK history (0) | No Guardian decisions recorded | The Contract Guardian evaluates every consequential action request. Decisions appear here once the fleet acts. … This surface is read-only — approvals are taken in the approvals queue." (composed + honest empty; pre-W148 it rendered "decisions — not yet composed in this runtime").
- `/workloads/recommendations` → renders the planning surface itself ("Workload planning · 1 workload profile defined…", the same ready content as check 2 — no placeholder).
- `/commerce/software` → "Software | The software catalog: workload needs, allocated entitlements and verified outcomes. | Software entitlements" (composed; loads clean — NOT affected by the procurement crash).
- Zero occurrences of "not yet composed in this runtime" on any of the three (probed live via full-text scan) — demo-journeys NEW finding 5 is FIXED.

### 8. J2/J3 regression spot-check (Bluegrass Courier Co., trn-sm-admin@simc-rerun.test; R2 18:02Z screenshots + [R2c live] 18:25Z)

- J2 (Install center → Windows/x64 → Corporate-owned → Create enrollment code): R2c run — "3. Your one-time enrollment code | Created **2026-10-05T18:25:26.931Z** — expires 2026-10-06T18:25:26.931Z. | Active — active | Request **enr_f03b5b2e** | Ownership scope Corporate-owned | Enroller roles Any role in this workspace | **enrollwVDQJT2U44SXZJK6W3354** | Shown once — copy it now. The console stores only a verifier; this code cannot be shown again. | [I copied the code — hide it] [Disable this code…] | Disabling an enrollment code is an authorized operator action. The console routes it through the existing approval model — this surface never revokes by itself." + REAL network `[POST …/api/enrollment/codes (Fetch) 201]`. R2's screenshots: enr_f0c2cd5f / enrollwZTX72N4WATNLFP0FKJIT / Created 2026-10-05T18:02:25.316Z.
- J3 (topbar "Invite member…"): R2c run — one-time join code **joinwPU36CJB5CH3WM73WN2AR** with "Your one-time join code | shown once | … | Shown once — the console stores only a verifier; this code cannot be shown again. Expires 24 hours after the code is issued. Give it to the person you are inviting to this workspace; they redeem it from the gate's Join tab. | [Copy join code] [I copied it — hide it]" + REAL network `[POST …/api/workspace/invitations (Fetch) 201]`. R2's screenshot: joinwGKUSENWD6V66ZQGQGXBH.
- Server-issued, tenant-unique, current-clock codes on both planes — **no W148 regression to the W147 boundary fixes**.

## Notes — new defects / residual issues (verbatim, they are data)

1. **N1 (NEW DEFECT — O4 procurement client-side crash; the headline finding of this pass):** `/commerce/procurement` crashes on render: "Application error: a client-side exception has occurred while loading fleetos-staging-flame.vercel.app (see the browser console for more information)." Root cause (captured live): `TypeError: Cannot read properties of undefined (reading 'chainStatusCounts')` in the `[[...slug]]` page chunk `page-4d4e0c6fa0840a99.js`. **Minimal actionable cause:** the W148 route binding (apps/web/src/console-app.tsx ~L1736) casts the W143 `composeProcurementCasesFeed` ready view-model — shape `{tenantId, demands, selected, vendors, orders}`, NO `verification` field (procurement-feed.ts L206–212/L516–544) — to `ProcurementScreenData` with `as unknown as` (a cast that defeats typecheck); procurement-screen.tsx L822 passes `ready.verification` (undefined) to `VerificationCard`, whose L238 `Object.entries(verification.chainStatusCounts)` throws. The same blind cast also conceals the missing `selected.evaluations`. **Fix:** supply a real `OrderVerificationView` at the binding site (e.g. `buildOrderVerificationView(tenantId, null).view` — the honest empty "No reconciliation report verifies the orders yet." state — or a real report when one exists) and drop the blind cast so the compiler enforces the shape. Impact: the whole procurement surface (the O4 seven-stage journey, its demand/quote/order content) is unreachable — worse than the pre-W148 perpetual "Loading the procurement surface", and the sidebar's Commerce button lands directly on the crashed route.
2. **N2 (residual — the executed decision does not propagate to any visible surface):** the approve/reject transitions execute at the approvals boundary (typed-phrase dialog, badge drop 1→0, `already_decided` dedupe, frozen `authorization_required` denial all verified real), but afterwards: (a) the approvals queue card STILL renders the parked record verbatim ("Parking decision · Approval required · REQUIRE_APPROVAL" with clickable [Approve]/[Reject] — only the in-dialog already_decided guard prevents a re-decision); (b) the Security Doctor journey still shows "Human approval — In progress (Parked at 2026-01-06T11:00:00Z)" and "Action — Plan PARKED — Pending"; (c) the Evidence trail index is unchanged (only the 3 seeded trails — NO new decision/dispatch audit entries, so the O6 post-fix expectation "new decision/dispatch entries must appear" is STILL unmet on the live UI even after a successful execution). Minimal actionable cause: the W148 approval-decision execution updates the approvals-boundary record but the demo-tier lane feeds (approvals queue card, security doctor, evidence index) are not recomposed from the decision record (and the reject reason is recorded but never displayed); the queue card should re-label/remove the decided item and the audit feed should append the decision/dispatch entries the W148 unit tests assert.
3. **N3 (residual — the O5 per-case journey + typed-CONFIRM gate remain unreachable):** with a session case active the destructive surface renders the case context ("Accepts destructive requests — Yes — the case is active"), but (a) every destructive action is "Unsupported by this device — The device's adapter does not declare the lock/locate/wipe/reboot capability" — the demo device (windows-mdm) declares no destructive capability, so no gated control ever renders and the typed-CONFIRM phrase dialog cannot be exercised (the W148 "typed-CONFIRM gate reachable" claim holds only at the precondition level); (b) clicking a case row in the cases list does NOT open the per-case seven-stage detail — console-app.tsx L1574 passes `selectedCaseId={input.laneFeeds.isDemo ? undefined : undefined}` (hardcoded undefined in BOTH branches, an apparent stub), so `onSelectCase` state is never consumed. Minimal actionable cause: wire `selectedCaseId` from the selected-case state and either declare a destructive capability for the demo device's adapter or route the drill through a capability-bearing device.
4. **N4 (residual — O2 side defects):** the "Open device detail" button still does not navigate (path stays `/device/doctor`) — the same pre-W148 side defect (consistent with the LEG/mobile lenses); and the journey's stage 1 reports "Observation count: 1" while stage 2 reports "Observations: None recorded yet" (the TwinStore's device-twin observation count vs the doctor's diagnosis-store records — two stores, two truths shown on one screen).
5. **N5 (residual, demo-tier-by-design scope note):** the W148 recovery case and executed decisions are session-scoped in-memory client state — a full reload resets both (R2's own artifact sequence: case created 17:59Z → "No recovery cases" behind the 18:00Z search screenshots; badge 0 at 17:38/18:04Z vs badge 1 at 17:41Z after an intervening reload). No demo-tier exercise is durable; the audit log always resets to the seeded trails. Recorded as scope (the deployed-tier server-plane persistence is future work), not a regression.
6. **N6 (operational, evaluator tooling notes):** (a) R2's screenshots for four surfaces captured only the header + onboarding rail (the doctor stages, the cases affordance, Find My, and the planning profile were below the fold) — every load-bearing fact for those checks was re-verified live by R2c and is marked [R2c live] above; (b) the VLM transcription of `r2-o3-reject-already-decided.png` reads the card line as "Parking decision REJECTED", but the live re-run shows the card unchanged ("Approval required REQUIRE_APPROVAL") after both approve and reject executions — the live walk is authoritative (N2); (c) agent-browser's `console` command captured nothing for the crash — the root cause was captured by installing a window error/errorrejection collector on a working page and then client-side navigating to the crashed route; (d) the demo tier's client-side session survives page reloads (localStorage `fleetos.w121.session`) — persona switches require an explicit Sign out.

## Scoreboard (this verification pass)

| Check | Verdict |
|---|---|
| 0 deployment fingerprint (health + chunk) | PASS |
| 1 O3 Approve/Reject execution (dialog → typed phrase → execution → badge drop → dedupe → frozen denial) | PASS (record/state/audit propagation: **PARTIAL** — see N2) |
| 2 O4 workload planning resolve | PASS |
| 3 O4 commerce procurement | **FAIL — NEW DEFECT (client-side crash; N1)** |
| 4 O2 Device Doctor nine-stage journey | PASS (side defects N4) |
| 5 O5 case creation + typed-CONFIRM gate + Find My | PARTIAL (affordance/case/Find My PASS; per-case detail + typed-CONFIRM dialog unreachable — N3) |
| 6 search id-match + keyword-match | PASS |
| 7 in-vocabulary routes bound | PASS |
| 8 J2/J3 regression (W147 intact) | PASS |

**Overall: the W148 engaged-lanes fixes MOSTLY WORK on the live deployment (fd6510b)** — the O3 approvals execute through a real typed-phrase gate with dedupe + RBAC denials, the O2 doctor binds the real TwinStore, O5 cases open, search matches ids, the in-vocabulary routes bind, and the W147 J2/J3 chain regressed nothing — **but the O4 procurement surface CRASHES client-side (N1, a NEW defect that makes the O4 procurement journey unreachable), and the executed-decision record/state/audit does not propagate to any visible surface (N2), leaving the O6 new-audit-entry expectation unmet.**

## Artifacts

R2's pass (17:37–18:04Z, first-hand, in simc-evidence/):

- r2-gate-quicklinks.png — the gate with the 7 demo quick-links (17:37)
- r2-o3-approve-dialog.png — the Approve typed-phrase confirmation dialog (17:37)
- r2-o3-already-decided.png — duplicate-approve safety: "already_decided — The plan 'pln_fb564c1e' has already been decided." (17:38)
- r2-o3-reject-dialog.png — the Reject dialog with the reason textarea (17:41)
- r2-o3-reject-already-decided.png — duplicate-reject safety (17:43)
- r2-o3-vendor-authorization-required.png — the Vendor persona's frozen authorization_required denial (17:45)
- r2-o4-planning-ready.png — workload planning resolved ("1 workload profile defined") (17:46)
- r2-o4-procurement-crash.png — **the O4 procurement client-side crash** (17:52)
- r2-o2-doctor-nine-stages.png — the doctor surface header (stages below the fold; re-verified live) (17:53)
- r2-o5-cases-create-affordance.png — the cases surface header (affordance below the fold; re-verified live) (17:53)
- r2-o5-case-created-list.png — the created case row (case_w148_devw091demo000001_20260106140000) (17:59)
- r2-o5-findmy-no-location-evidence.png — Find My header (content below the fold; re-verified live) (17:59)
- r2-search-planid-match.png — search: plan id as query matches (18:00)
- r2-search-keyword-encryption.png — search: keyword match, two results (18:00)
- r2-route-security-decisions.png / r2-route-workloads-recommendations.png / r2-route-commerce-software.png — the three in-vocabulary routes composed (18:00)
- r2-j2-bluegrass-code-regression.png — J2 server-issued enrollment code on Bluegrass (enr_f0c2cd5f) (18:02)
- r2-j3-invite-regression.png — J3 one-time join code on Bluegrass (joinwGKUSENWD6V66ZQGQGXBH) (18:02)
- r2-o3-executed-badge-zero.png — the approvals badge after execution ("Approvals inbox: 0 pending") (18:04)

R2c's completion pass (~18:08–18:29Z, first-hand, in simc-evidence/):

- r2c-o2-doctor-nine-stages.png — the full nine-stage diagnosis journey (check 4)
- r2c-o4-planning-ready.png — the planning surface with the wl_w091demo000001 profile row (check 2)
- r2c-o4-procurement-crash.png — the procurement crash re-verified live (check 3 / N1)
- r2c-o5-cases-create-affordance.png — the cases surface with the "Open recovery case" affordance (check 5a)
- r2c-o5-case-created-list.png — the created case in the list (check 5a)
- r2c-o5-destructive-gate.png — the destructive surface with the ACTIVE case context ("Accepts destructive requests — Yes — the case is active"; all four actions adapter-unsupported) (check 5b / N3)
- r2c-o5-findmy-no-location-evidence.png — Find My honest no_location_evidence states (check 5c)
- r2c-search-planid-match.png / r2c-search-keyword-encryption.png — the search checks re-verified live (checks 6a/6b)
- r2c-route-security-decisions.png / r2c-route-workloads-recommendations.png / r2c-route-commerce-software.png — the three routes re-verified live (check 7)
- r2c-j2-bluegrass-code-regression.png — the J2 regression drill's server-issued code (enr_f03b5b2e / enrollwVDQJT2U44SXZJK6W3354) (check 8)
- r2c-j3-invite-regression.png — the J3 regression drill's one-time join code (joinwPU36CJB5CH3WM73WN2AR) (check 8)
- r2c-o3-already-decided.png — duplicate-approve safety re-verified live (check 1c)
- r2c-o3-reject-already-decided.png — duplicate-reject safety re-verified live (check 1e)
- r2c-o3-vendor-authorization-required.png — the Vendor frozen denial re-verified live (check 1f)
