# W147 Verification — boundary-engagement fixes on the live deployment

- Evaluator: R1 (browser-verification worker, FleetOS tech-lead dispatch; EVALUATION ONLY — zero product-code changes; all mutations were the expected journey drills)
- Target: https://fleetos-staging-flame.vercel.app (Vercel staging tier)
- Deployed build: 8400ce5 (merge of work/w147 @ e5be168; Vercel READY/PROMOTED ~15:07Z Oct 5 2026) — the W147 "engage the server boundary" lane: real enrollment codes via POST /api/enrollment/codes, the invite/join chain via POST /api/workspace/invitations + POST /api/enrollment/redeem, the gate tenantId-init fix
- Session: `agent-browser --session r1` (desktop viewport 1280×800; retry wrapper /home/z/ab-r1)
- First-hand window: 2026-10-05T15:27:23Z → 2026-10-05T15:43:27Z (all facts below observed first-hand in this window)
- Defect record this pass targets: trn-journeys.md J2/J3 (DEFECT ×3, BLOCKED ×3), def-journeys.md Note 3 (gate sign-in dead-button)

## Verification table

| # | Check | Verdict | Evidence (one line) |
|---|---|---|---|
| 0a | Deployment fingerprint — NEW route responds with JSON error, not catch-all HTML | PASS | `curl -X POST /api/workspace/invitations` → **401** `{"ok":false,"reason":"unauthenticated","message":"no server session cookie is present"}` (content-type application/json; charset=utf-8) |
| 0b | Health endpoint | PASS | GET /api/health → 200 `{"env":"staging","health":"healthy","module":"web","secrets":[…all 9 present…]}` |
| 1a | J2 code creation emits a REAL POST /api/enrollment/codes | PASS | `[31917.74] POST …/api/enrollment/codes (Fetch) 201`; body `{"ok":true,"requestId":"enr_de92b4dc","code":"enrollwO555WB5JM2AXLGJ4LV5L",…}` |
| 1b | Code is SERVER-ISSUED (not the W101 fixture) | PASS | code `enrollwO555WB5JM2AXLGJ4LV5L` ≠ BOOT-W101-0001; requestId `enr_de92b4dc` ≠ enr_w101_000001; Created `2026-10-05T15:33:00.773Z` (current clock, not 2026-10-01) |
| 1c | Display-once law still holds | PASS | "I copied the code — hide it" → code string gone, "The code was shown once and is now hidden…", no re-show affordance |
| 1d | "Disable this code…" produces REAL feedback | PASS | click → `DELETE /api/enrollment/codes` **200** `{"ok":true,"requestId":"enr_de92b4dc","status":"revoked","revokedAt":"2026-10-05T15:34:23.089Z"}` + explicit refusal alert "Refusal: code_revoked — The enrollment code was disabled by the operator…"; dialogs 0→1 (see Notes N3: no PRE-action confirmation) |
| 1e | Second workspace code DIFFERS (tenant-unique) | PASS | Keystone `[31917.83] POST 201` → `enr_d8d2b197` / `enrollw4YITFKOVWFE3I3MHWEEH` vs Bluegrass `enr_de92b4dc` / `enrollwO555WB5JM2AXLGJ4LV5L` |
| 2a | Invite issuance works (POST /api/workspace/invitations) | PASS | `[31917.88] POST …/api/workspace/invitations (Fetch) 201`; body `{"ok":true,"invitationId":"inv_w144wf05f77c166b2_c38231be","code":"joinwI5CII2YX2Y2NDGFFTEZG","expiresAt":"2026-10-06T15:37:20.730Z","workspaceName":"Bluegrass Courier Co."}` |
| 2b | Member joins and lands in the INVITING tenant | PASS | `[31917.90] POST …/api/enrollment/redeem 201` → in-page `fetch('/api/session')` → `{"ok":true,"tenantId":"tnt_w144wf05f77c166b2",…,"memberRef":"trn-sm-member@simc-rerun.test","assignedRoles":["employee"],"activeRole":"employee"}` (Bluegrass — no misroute) |
| 2c | Role assignment per join form (Service Desk) | PASS | second join (caleb.cole@simc-rerun.test, role `service.desk`) `[31917.101] POST 201` → session `{"tenantId":"tnt_w144wf05f77c166b2",…,"assignedRoles":["service.desk"],"activeRole":"service.desk"}`, topbar role chip "Service Desk" |
| 2d | Negative path — bogus code → explicit unknown_code | PARTIAL | grammar-matching bogus `joinwBOGUSCODEBOGUSCODE77` → `[31917.95] POST 403` `{"ok":false,"reason":"unknown_code","explanation":"That join code does not match any workspace you can join from here…"}` (verbatim, now SERVER-side) — but the protocol's literal `joinw-bogus-999` → `[31917.94] 400 invalid_input` with the DEVICE-path explanation (Note N1) |
| 3 | Gate dead-button fix (Sign in enabled without re-picking) | PASS | full reload with `fleetos.server.workspaces.v1` populated → picker shows "Bluegrass Courier Co." selected → typed email+password, NO re-pick → `is enabled @button` = **true** → click → `POST /api/session 200` → console restored |

## Per-check verbatim detail

### 0. Deployment fingerprint (curl, 15:27Z)

- `curl -s -o /dev/null -w "%{http_code}" -X POST https://fleetos-staging-flame.vercel.app/api/workspace/invitations` → **401**
- Response body: `{"ok":false,"reason":"unauthenticated","message":"no server session cookie is present"}` — content-type `application/json; charset=utf-8`. This is the NEW route's own JSON error vocabulary (fail-closed on the missing session cookie), NOT the catch-all HTML 200 of the pre-W147 build.
- `GET /api/health` → 200: `{"env":"staging","health":"healthy","module":"web","secrets":[{"name":"FLEETOS_ENV","present":true},{"name":"FLEETOS_BASE_URL","present":true},{"name":"DATABASE_URL","present":true},{"name":"UPSTASH_REDIS_REST_URL","present":true},{"name":"UPSTASH_REDIS_REST_TOKEN","present":true},{"name":"R2_ACCOUNT_ID","present":true},{"name":"R2_ACCESS_KEY_ID","present":true},{"name":"R2_SECRET_ACCESS_KEY","present":true},{"name":"R2_BUCKET","present":true}]}`

### 3. Gate dead-button fix (run first — it doubles as the J2 sign-in)

Fresh `r1` browser profile: gate rendered "No workspaces yet". Restored the documented client-memory workspace directory key `fleetos.server.workspaces.v1` (browser-tier localStorage; stores ONLY {tenantId, name, createdAt} — no credentials) to `[Bluegrass Courier Co. tnt_w144wf05f77c166b2, Keystone Risk Group tnt_w144w035f31f6f261]`, then FULLY RELOADED the gate:

- Picker after reload: combobox "Workspace" = **Bluegrass Courier Co.** [selected] (option list: Bluegrass Courier Co. / Keystone Risk Group) — the select visually shows the first workspace while the directory state populates after mount (the DEF Note-3 defect scenario).
- Button state with empty fields: `button "Sign in" [disabled]` (expected — no credentials).
- Typed `trn-sm-admin@simc-rerun.test` + `simc-rerun-2026` via real keystrokes into the form — **WITHOUT re-picking the workspace** — `agent-browser is enabled` → **true**. (Pre-W147 the button stayed disabled until an explicit re-pick; the remount fix ("ws-empty" → "ws-populated" key) works.)
- Clicked Sign in → `[31917.69] POST https://fleetos-staging-flame.vercel.app/api/session (Fetch) 200` → console restored with the Bluegrass topbar; in-page `fetch('/api/session',{credentials:'include'})` → 200 `{"ok":true,"tenantId":"tnt_w144wf05f77c166b2","workspaceName":"Bluegrass Courier Co.","principalId":"usr:trn-sm-admin@simc-rerun.test","memberRef":"trn-sm-admin@simc-rerun.test","sessionId":"ses_w140s51dcf17beaabeb76","expiresAt":"2026-10-05T23:32:24.891Z","assignedRoles":["fleet.admin"],"activeRole":"fleet.admin"}`.
- **The dead-button defect is GONE.** Screenshot: `r1-gate-deadbutton-fixed.png`.

### 1. J2 — real enrollment code (Bluegrass Courier Co., Devices → Enroll devices → Install Center)

Path walked: Devices → "Enroll devices" → Install center → "1. Choose the platform" Windows/**x64** → "2. Choose the ownership scope" **Corporate-owned** → "3. Create a one-time enrollment code" → **"Create enrollment code"**.

(a) Network line: `[31917.74] POST https://fleetos-staging-flame.vercel.app/api/enrollment/codes (Fetch) 201`
- postData: `{"ownershipKind":"corporate_owned"}`
- responseBody: `{"ok":true,"requestId":"enr_de92b4dc","code":"enrollwO555WB5JM2AXLGJ4LV5L","ownershipKind":"corporate_owned","ownershipClass":"corporate","allowedRoles":[],"createdAt":"2026-10-05T15:33:00.773Z","expiresAt":"2026-10-06T15:33:00.773Z"}` — response headers `server: Vercel`, `x-matched-path: /api/enrollment/codes`, `date: Mon, 05 Oct 2026 15:33:00 GMT`.

(b) Displayed code record (verbatim UI):
- "3. Your one-time enrollment code | Created 2026-10-05T15:33:00.773Z — expires 2026-10-06T15:33:00.773Z. | Active — active | Request | enr_de92b4dc | Ownership scope | Corporate-owned | Enroller roles | Any role in this workspace | enrollwO555WB5JM2AXLGJ4LV5L | Shown once — copy it now. The console stores only a verifier; this code cannot be shown again."
- SERVER-ISSUED proof: visible code `enrollwO555WB5JM2AXLGJ4LV5L` (NOT `BOOT-W101-0001`); request id `enr_de92b4dc` (NOT `enr_w101_000001`); created/expires timestamps are the CURRENT clock (2026-10-05T15:33Z, 24h TTL), NOT the frozen fixture clock 2026-10-01T00:00:00Z.
- Screenshot: `r1-j2-bluegrass-code.png`.

(c) Display-once law (verbatim):
- Clicked "I copied the code — hide it" → the code string is GONE; surface reads "The code was shown once and is now hidden. It remains valid until used or expired — create a new request if you lost it." — no re-show affordance (the hide button disappeared with the code).

(d) Disable attempt (verbatim record of what happens):
- Clicked "Disable this enrollment code (requires authorization)" (visible label "Disable this code…") → **REAL network call**: `[31917.75] DELETE https://fleetos-staging-flame.vercel.app/api/enrollment/codes (Fetch) 200`, postData `{"requestId":"enr_de92b4dc"}`, responseBody `{"ok":true,"requestId":"enr_de92b4dc","status":"revoked","revokedAt":"2026-10-05T15:34:23.089Z"}`.
- Explicit state change + feedback: dialog count 0 → 1; the refusal alert renders "Refusal: code_revoked — The enrollment code was disabled by the operator. Create a new enrollment request if this device should enroll." with button "Dismiss the refusal"; the Next-action rail reads "Resolve the refusal — resolve_refusal / Enrollment was refused (code_revoked). Read the explanation, fix the cause, and retry with a fresh code when ready."
- Screenshot: `r1-j2-bluegrass-disable.png`.
- Repeat disable on the already-revoked code: `[31917.76] DELETE …/api/enrollment/codes (Fetch) 410`, responseBody `{"ok":false,"reason":"code_revoked","explanation":"This enrollment code was revoked by an operator. Create a new enrollment request if this device should enroll. (this enrollment code is already revoked)"}` — honest server-side lifecycle.
- Nuances recorded honestly (Notes N3): there is NO confirmation dialog BEFORE the destructive click (the DELETE fires immediately; feedback is post-hoc); the request card chip still reads "Active — active" after the revoke (the client record's status is not refreshed); the hidden copy still says "It remains valid until used or expired" although the code is now revoked server-side.

(e) Second workspace (Keystone Risk Group, def-sm-admin@simc-rerun.test / simc-rerun-2026):
- `[31917.83] POST https://fleetos-staging-flame.vercel.app/api/enrollment/codes (Fetch) 201`, postData `{"ownershipKind":"corporate_owned"}`, responseBody `{"ok":true,"requestId":"enr_d8d2b197","code":"enrollw4YITFKOVWFE3I3MHWEEH","ownershipKind":"corporate_owned","ownershipClass":"corporate","allowedRoles":[],"createdAt":"2026-10-05T15:36:39.886Z","expiresAt":"2026-10-06T15:36:39.886Z"}`.
- UI: "Created 2026-10-05T15:36:39.886Z — expires 2026-10-06T15:36:39.886Z. | Active — active | Request | enr_d8d2b197 | … | enrollw4YITFKOVWFE3I3MHWEEH | Shown once — copy it now…".
- **The two codes and request ids DIFFER** (Bluegrass `enr_de92b4dc`/`enrollwO555WB5JM2AXLGJ4LV5L` vs Keystone `enr_d8d2b197`/`enrollw4YITFKOVWFE3I3MHWEEH`) — tenant-unique server-issued codes, the shared W101 fixture is GONE.
- Screenshot: `r1-j2-keystone-code.png`.

### 2. J3 — invite + join end-to-end (Bluegrass admin → member Caleb Cole)

(a) Invitation issuance (signed in as trn-sm-admin, Bluegrass owner):
- Clicked topbar "Invite member…" → `[31917.88] POST https://fleetos-staging-flame.vercel.app/api/workspace/invitations (Fetch) 201`, postData `{}`, responseBody `{"ok":true,"invitationId":"inv_w144wf05f77c166b2_c38231be","code":"joinwI5CII2YX2Y2NDGFFTEZG","createdAt":"2026-10-05T15:37:20.730Z","expiresAt":"2026-10-06T15:37:20.730Z","workspaceName":"Bluegrass Courier Co."}`.
- One-time join code display (verbatim): "Your one-time join code | shown once | joinwI5CII2YX2Y2NDGFFTEZG | Shown once — the console stores only a verifier; this code cannot be shown again. Expires 24 hours after the code is issued. Give it to the person you are inviting to this workspace; they redeem it from the gate's Join tab." with buttons "Copy join code" / "I copied it — hide it".
- After "I copied it — hide it": "The join code was shown once and is now hidden. It remains valid until used or expired — issue a new one if you lost it." (display-once law holds on the invitation plane too).
- Screenshot: `r1-j3-invite-issued.png`.

(b) Member join (gate → "Join workspace", form fields: Join code / Your name / Your email / Join as — NO password field; the join code IS the credential):
- Submitted `joinwI5CII2YX2Y2NDGFFTEZG` + "Caleb Cole" + `trn-sm-member@simc-rerun.test` + role `employee` (the role combobox's default — my first select-by-label keystroke failed and the form submitted with the default; recorded honestly) → `[31917.90] POST https://fleetos-staging-flame.vercel.app/api/enrollment/redeem (Fetch) 201`, postData `{"code":"joinwI5CII2YX2Y2NDGFFTEZG","displayName":"Caleb Cole","email":"trn-sm-member@simc-rerun.test","role":"employee"}`, responseBody `{"ok":true,"tenantId":"tnt_w144wf05f77c166b2","workspaceName":"Bluegrass Courier Co.","principalId":"usr:trn-sm-member@simc-rerun.test","memberRef":"trn-sm-member@simc-rerun.test","sessionId":"ses_w147j40167eb8f8b27974","expiresAt":"2026-10-05T23:38:32.241Z","assignedRoles":["employee"],"activeRole":"employee"}`.
- In-page session proof after joining: `fetch('/api/session',{credentials:'include'})` → **200** `{"ok":true,"tenantId":"tnt_w144wf05f77c166b2","workspaceName":"Bluegrass Courier Co.","principalId":"usr:trn-sm-member@simc-rerun.test","memberRef":"trn-sm-member@simc-rerun.test","sessionId":"ses_w147j40167eb8f8b27974","expiresAt":"2026-10-05T23:38:32.241Z","assignedRoles":["employee"],"activeRole":"employee"}` — **the member landed in the INVITING workspace's tenant (Bluegrass tnt_w144wf05f77c166b2), NOT a misroute**; topbar role chip "Employee / Device Owner", sidebar "Role: viewer".
- Screenshot: `r1-j3-member-session.png`.
- Re-join attempt with the same email + role `service.desk` (fresh invitation `joinwQIAPFX3QMHZV6T65B3FR`, issuance `[31917.98] POST /api/workspace/invitations 201` → `{"ok":true,"invitationId":"inv_w144wf05f77c166b2_af1abb5a","code":"joinwQIAPFX3QMHZV6T65B3FR","createdAt":"2026-10-05T15:41:04.636Z","expiresAt":"2026-10-06T15:41:04.636Z","workspaceName":"Bluegrass Courier Co."}`): `[31917.100] POST /api/enrollment/redeem 403`, responseBody `{"ok":false,"reason":"membership_already_exists","explanation":"You are already a member of this workspace. Sign in with your credentials instead of joining again."}` — honest one-membership boundary (client rendering nuance in Note N2).
- Service Desk role proof (persona email `caleb.cole@simc-rerun.test`, the SIM-C TRN-SM J3 persona): `[31917.101] POST /api/enrollment/redeem 201`, postData `{"code":"joinwQIAPFX3QMHZV6T65B3FR","displayName":"Caleb Cole","email":"caleb.cole@simc-rerun.test","role":"service.desk"}`, responseBody `{"ok":true,"tenantId":"tnt_w144wf05f77c166b2","workspaceName":"Bluegrass Courier Co.","principalId":"usr:caleb.cole@simc-rerun.test","memberRef":"caleb.cole@simc-rerun.test","sessionId":"ses_w147jb7509925d9eedef6","expiresAt":"2026-10-05T23:42:08.414Z","assignedRoles":["service.desk"],"activeRole":"service.desk"}` — in-page fetch confirms the same; topbar role chip "Service Desk", member chip "caleb.cole". **Member lands in the inviting tenant with the requested role.**
- Screenshot: `r1-j3-member-servicedesk-session.png`.

(c) Negative path (bogus code):
- `joinw-bogus-999` + Caleb Cole persona: `[31917.94] POST /api/enrollment/redeem (Fetch) 400`, responseBody `{"ok":false,"reason":"invalid_input","explanation":"The enrollment request is malformed. Check the workspace, code, device identity and hardware claims, then try again. (tenantId, requestId, code, deviceId and adapterFamily are required)"}`; UI alert: "invalid_input — Some entered details were missing or invalid. Check the fields and try again." (see Note N1 — the protocol's literal bogus string now surfaces the device-path refusal, not unknown_code).
- Grammar-matching bogus code `joinwBOGUSCODEBOGUSCODE77`: `[31917.95] POST /api/enrollment/redeem (Fetch) 403`, responseBody `{"ok":false,"reason":"unknown_code","explanation":"That join code does not match any workspace you can join from here. Check the code for typos, then ask the inviting workspace's administrator for a fresh invitation."}`; UI alert renders it VERBATIM: "unknown_code — That join code does not match any workspace you can join from here. Check the code for typos, then ask the inviting workspace's administrator for a fresh invitation." — never a silent empty alert; the validation is now SERVER-side (a real POST is emitted, previously client-side).
- Screenshot: `r1-j3-bogus-refusal.png`.

(d) Session lifecycle (all real, this pass): POST /api/session 200 ×4 (Bluegrass admin ×3, Keystone admin ×1); DELETE /api/session 200 ×4 (every sign-out clean, gate returned each time).

## Notes — new defects / residual issues (verbatim, they are data)

1. **N1 (minor, NEW) — non-grammar bogus join codes get the DEVICE-path refusal copy.** The SIM-C protocol's literal bogus string `joinw-bogus-999` fails the frozen join-code grammar (`joinw[A-Z2-7]{20}`) at the redeem route's dispatch, falls through to the device-enrollment path, and surfaces `invalid_input` 400 with the explanation "The enrollment request is malformed. Check the workspace, code, device identity and hardware claims, then try again. (tenantId, requestId, code, deviceId and adapterFamily are required)" — misleading copy for a member-join form (it talks about tenantId/deviceId/adapterFamily the member never entered). The expected `unknown_code` refusal DOES surface for grammar-matching bogus codes (verified). The refusal is still explicit, never silent — but the protocol's historical negative-path string no longer produces the historical error.
2. **N2 (minor, NEW) — `membership_already_exists` loses the server's explanation in the client render.** The server returns `{"ok":false,"reason":"membership_already_exists","explanation":"You are already a member of this workspace. Sign in with your credentials instead of joining again."}` but the gate's alert renders the reason with the GENERIC fallback: "membership_already_exists — This action was refused and no further explanation is available for it. Go back, check what you entered, and try again — or ask an administrator for help." (the client's frozen ProductAuthRefusal vocabulary has no entry for this reason; the server's explanation field is dropped).
3. **N3 (nuance, on the J2 disable path) — no PRE-action confirmation; post-revoke UI staleness.** "Disable this code…" fires the DELETE immediately on click — there is no confirmation dialog BEFORE the destructive action (the W13 "real confirmation flow" reading would want a confirm-gate; the W147 implementation gives real execution + explicit post-hoc feedback instead). After a successful revoke, the request card chip still reads "Active — active" and the hidden-code copy still says "It remains valid until used or expired" though the server has revoked it (client status not refreshed).
4. **N4 (residual, by-design scope note) — joined members have NO password.** The join code IS the credential ("password-setting is a separate flow, out of W147's scope" per the deployed code). After sign-out the member cannot sign back in through the Sign in form (no credential exists) — their only way back is a fresh invitation. Recorded as scope, not a regression.
5. **N5 (policy observation) — operator-tier members can issue invitations.** A service.desk member (caleb.cole, NOT an owner) clicked "Invite member…" and the server ISSUED a code: `[31917.104] POST /api/workspace/invitations 201` → `joinw4ID7FIK756PJ4X7RXQ6U` (unconsumed, expires 24h). The route's permission law allows any assigned role whose experience role passes `canInteract(operatorRoleFor(role), "propose")` — i.e. operator-and-above may issue (mirroring the enrollment plane); viewer roles get the frozen `interaction_forbidden` refusal. Since join-time roles are non-elevated only, the blast radius is bounded, but whether Service Desk should invite members is a product-policy call for the tech lead.
6. **N6 (operational, not a product defect) — evaluator tooling notes.** (a) agent-browser's `storage local set` mangled the JSON directory value (stored a summary form that fails JSON.parse) — the directory had to be set via in-page `eval setItem`; the app's own read is unaffected. (b) The join form's role combobox options carry VALUES (`employee`, `service.desk`, `team.manager`, `asset.manager`, `security.compliance`) distinct from labels — a label-based automation keystroke silently leaves the default role selected (my first join submitted `employee` this way; re-run with the value produced the service.desk proof). (c) The known cosmetic residue persists: the failed join attempt's persona email bleeds into the Sign-in form's Email field (trn-sm-member@… appeared there after the negative path).

## Scoreboard (this verification pass)

| Check | Verdict |
|---|---|
| 0 deployment fingerprint (new route JSON + health) | PASS |
| 1 J2 real enrollment code (create + display-once + disable + tenant-unique ×2) | PASS |
| 2 J3 invite + join end-to-end (+ negative path) | PASS (negative path on the protocol's literal bogus string: PARTIAL — see N1) |
| 3 gate dead-button fix | PASS |

**Overall: the W147 boundary-engagement fixes WORK on the live deployment (8400ce5).** The pre-W147 J2/J3 defects (fixture code, inert disable, unknown_session invite refusal, empty invitations table) are gone; residual minor copy/render issues recorded in Notes N1–N3.

## Artifacts (this pass, first-hand, in simc-evidence/)

- r1-gate-deadbutton-fixed.png — gate after full reload + typed credentials, Sign in enabled without re-pick (check 3)
- r1-j2-bluegrass-code.png — the server-issued enrollment code view on Bluegrass (enrollwO555WB5JM2AXLGJ4LV5L / enr_de92b4dc)
- r1-j2-bluegrass-disable.png — the disable attempt's real feedback (code_revoked refusal after DELETE 200)
- r1-j2-keystone-code.png — the second workspace's distinct code (enrollw4YITFKOVWFE3I3MHWEEH / enr_d8d2b197)
- r1-j3-invite-issued.png — the one-time join code issuance (joinwI5CII2YX2Y2NDGFFTEZG)
- r1-j3-member-session.png — the joined member's session proof in the inviting tenant (trn-sm-member, employee)
- r1-j3-member-servicedesk-session.png — the Service Desk member proof (caleb.cole, service.desk, tenant tnt_w144wf05f77c166b2)
- r1-j3-bogus-refusal.png — the bogus-code refusal (unknown_code, server-side 403)
