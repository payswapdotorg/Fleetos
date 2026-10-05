# SIM-C Rerun Checklist — the identical journeys (from the accepted SIM-B record)

Target: the DEPLOYED post-fix product (https://fleetos-staging-flame.vercel.app) after W144.
Method: USER-ONLY browser evaluation (agent-browser CLI; desktop 1280×800 + mobile 390×844).
Panel: 15 firms (5 industries × 3 sizes) + the shared DEMO workspace (7 personas). 105 personas.
Verdict rubric per persona: SWITCH-ONLY / MAIN-INTERFACE / COMPLEMENT / RETAIN.

## Firms (create through the REAL sign-up flow, exactly as SIM-B)
- TRN: SIMB-TRN-LG "Meridian Freight Systems" (LARGE ~820) / SIMB-TRN-MD "Capitol Last-Mile Logistics" (MEDIUM ~95) / SIMB-TRN-SM "Bluegrass Courier Co." (SMALL 12)
- HOS: SIMB-HOS-LG "Aurelia Hotel Group" / SIMB-HOS-MD "Harborline Restaurants" / SIMB-HOS-SM "Veranda Venue Co."
- FEM: SIMB-FEM-LG "Northstar Media Group" / SIMB-FEM-MD "Atelier Nine" / SIMB-FEM-SM "Punchlist Studios"
- LEG: SIMB-LEG-LG "Hartwell & Cross LLP" / SIMB-LEG-MD "Beacon Legal Services" / SIMB-LEG-SM "Two Rivers Family Law"
- DEF: SIMB-DEF-LG "Sentinel Ridge Defense Systems" / SIMB-DEF-MD "Ironclad Protective Services" / SIMB-DEF-SM "Keystone Risk Group"

## Per-firm journeys (J1–J4, the firm's own admin/member through the real flow)
- J1 Workspace provisioning + onboarding rail — expect honest empty states ("Nothing needs your attention right now" / "No records yet.")
- J2 Install Center enrollment code drill + gated destructive attempt — code display-once MUST hold; POST-FIX: the gated destructive click must produce a confirmation flow + feedback (was inert); record verbatim
- J3 Invite + join + role assignment — POST-FIX REGRESSION (W130): crypto-random tenant-unique codes; the member MUST land in the INVITING workspace's tenant (the cross-tenant DEMO misroute must NOT reproduce); out-of-scope codes get explicit unknown_code; NO silent empty alerts
- J4 Session persistence + sign-out + password sign-in — POST-FIX (W140): the deployed tier resolves sessions server-side (httpOnly cookie /api/session); verify role=owner after password sign-in AND that consequential actions emit REAL network requests (not localStorage-only)

## Per-firm DEMO-persona journeys (O1–O6 over the shared demo fleet)
- O1 Control Tower triage — severity-ordered stream, counters, recent activity (baseline PASS; must not regress)
- O2 Device Doctor diagnosis — WAS "doctor — not yet composed in this runtime". POST-FIX (W141): the nine-stage journey (device → observations → symptoms → diagnosis → remediation → authorization → action → result → evidence) must RUN over REAL runtime state; honest empties only where no data
- O3 Security incident: finding → Guardian decision → approval → action — WAS PARTIAL (remediation walk BLOCKED; Approve INERT). POST-FIX (W142): the remediation walk must run; Approve must produce confirmation dialog → authorization check → decision record → state change → evidence trail → duplicate-decision safety; Reject records reason/state and the plan does NOT execute; restricted roles get frozen denial explanations
- O4 Procurement cycle: workload planning → recommendation → vendor quote — WAS "planning/procurement — not yet composed". POST-FIX (W143): the planning walk (fleet inventory → proposal → recommendation review → decision → plan → evidence) and procurement case journeys (need → case → vendor context → authorization → decision → order → evidence) must run
- O5 Lost-device recovery drill incl. gated destructive — WAS "cases — not yet composed". POST-FIX (W141): recovery case journeys (list + detail + per-case seven-stage); Find My Device honest no_location_evidence; destructive confirmation requires explicit CONFIRM typing
- O6 Audit/evidence pull + deterministic global search — baseline PASS; must not regress; POST-FIX: new decision/dispatch audit entries from O2/O3/O4/O5 must appear in the REAL hash-chained log

## Per-industry mobile pass (390×844, one firm per industry)
- Hamburger drawer (10 areas) + bottom nav reachable
- POST-FIX (W145): the device roster renders as priority CARDS below ~480px (was 993px table → horizontal scroll); same REAL runtime state, no horizontal page scroll
- All six lanes' mobile state recorded verbatim

## Additional post-fix checks (W144/W145 targets)
- The six lanes' deep record screens are COMPOSED (the "not yet composed in this runtime" string must appear ONLY for genuinely unknown routes)
- Approvals inbox wired to the executed decision path (badge count changes on decision)
- Declared-import surface (W145): provenance-flagged DECLARED entries, never conflated with OBSERVED
- Server-tier resolution: /api/session httpOnly cookie; /api/enrollment/* through the real boundary; a real agent check-in/observation if exercisable from the browser

## Evidence format (per journey, same as SIM-B)
`FIRM | persona (product role) | journey | outcome | verbatim snippet` — one line per journey, ~150 journeys total (10 per firm where supported: J1-J4 + O1-O6), plus the 5 mobile passes.

## Verdict comparison table (report section 4)
Before (SIM-B accepted): SWITCH-ONLY 0 · MAIN-INTERFACE 0 · RETAIN 105.
After: recount per persona with the same rubric; the delta narrative traces each changed verdict to the specific fix lane that earned it.
