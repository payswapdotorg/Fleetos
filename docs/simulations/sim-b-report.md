# FleetOS Industry Adoption Simulation — SIM-B Report

**Worker:** SIM-B (industries 6–10)
**Product under evaluation (as implemented):** https://fleetos-staging-flame.vercel.app
**Method:** USER-ONLY browser evaluation (headless Chromium via agent-browser CLI, desktop 1280×800 and mobile 390×844). No source access, no internals — every claim below was verified by clicking the live product between 2026-10-02 ~08:06Z and ~09:25Z UTC.
**Panel:** 5 industries × 3 firms (LARGE 500+ devices / MEDIUM 50–150 / SMALL 5–25) = **15 real workspaces** created through the real sign-up flow, plus the shared DEMO workspace (7 one-click personas) used for the "fleet under management" operational journeys.
**Executed project journeys: 150** (10 per firm — every firm at or above the LARGE bar; minimums 10/7/5 exceeded). One-line-per-project evidence log: section 8 (verbatim snippets incl. refusals and empty states).
**Personas simulated: 105** (7 product roles × 15 firms), each mapped to a named industry professional.
**Mobile:** core pass repeated at 390×844 for at least one firm per industry (7 mobile passes recorded).

---

## 1. Executive summary

FleetOS as implemented is an **identity/RBAC/evidence skeleton with honest, well-labeled empty surfaces** — not yet an operational fleet product:

- **What works live:** workspace sign-up with password; sign-in/sign-out; persistent sessions; the 7 honest DEMO quick links over a rich demo fleet (3 devices, 1 CRITICAL finding, 1 Guardian-parked plan, 1 policy set, 3 evidence trails, 5 audit events); role-shaped Control Tower lenses (owner / operator / approver / viewer); severity-ordered needs-attention stream; device roster with facets; Install Center with genuinely enforced one-time enrollment codes ("display-once" law held in every test); security findings with inspect dialog, remediation proposal and immutable evidence refs; approvals-queue VIEW with machine-stable parking reasons; read-only Policies; Evidence & Audit trails; Learning (evaluation cases / adoption ledger / outcome feed); deterministic global search (W061 contract); a working mobile shell (hamburger drawer with all 10 areas + bottom nav).
- **What does not exist in the runtime:** six of ten lanes are explicit placeholders — Device Doctor (`/device/doctor`), Security Doctor remediation walk (`/security/doctor`), Recovery (`/recovery/cases`), Fleet Actions plans (`/action/plans`), Workloads planning (`/workload/planning`), Commerce procurement (`/commerce/procurement`). Each says verbatim: *"not yet composed in this runtime … the runtime binding for this view arrives with the lane composition work."*
- **Inert controls:** Approve/Reject on the parked plan produced **no dialog, no network request, no state change** (badge stayed "Approvals inbox: 1 pending" in every one of 15 sweeps + manual attempts as admin and service desk). The gated destructive controls ("Disable the enrollment code…", "Revoke the device's trust…") are equally inert — labeled and gated in copy, but a click yields no confirmation flow and no feedback.
- **The control plane is entirely client-side:** all state lives in `localStorage` (`fleetos.w121.durable`); clicking consequential buttons emits zero network requests. A real agent can never check in — enrollment verification remains *"unbootstrapped — waiting"* forever. No real fleet data can enter any workspace.
- **Cross-tenant join-code defect:** every workspace's first invite code is the same string (`joinw10100000001`). A member invited to workspace A landed as a principal in the **shared DEMO tenant** (Dwayne Carter, invited to SIMB-TRN-LG, verifiably created under `tnt_w091demo000001`), and the next workspace's join then **failed silently with an empty `<alert>`**.

**Verdict distribution (105 personas): SWITCH-ONLY 0 (0%) · MAIN-INTERFACE 0 (0%) · RETAIN 105 (100%).** As implemented, no persona in any of the five industries can run their daily job inside FleetOS: the lanes their jobs live in are placeholders, the action controls are inert, and no real device can ever be enrolled. The verdict is not a judgment of the model — the approvals/evidence/RBAC design is the strongest part of what exists — it is the honest as-implemented outcome the experiment requires.

---

## 2. As-implemented surface map (verified live)

| Surface | State as implemented | Evidence (verbatim) |
|---|---|---|
| Gate: Sign in / Create workspace / Join workspace | **WORKS** | password sign-in verified for 15 workspaces |
| DEMO quick links (7 personas, honest labels) | **WORKS** | "One click opens the shared demo workspace as that persona — clearly labeled sample data." |
| Sign-out / session persistence | **WORKS** | sessions survive reload; unauthenticated URL access returns to gate |
| Control Tower home (per-role lens) | **WORKS** | needs-attention stream, fleet health, counters, recent activity, onboarding rail |
| Onboarding rail (5 steps) | **WORKS** | "Workspace created → Role assigned → Install the agent → First check-in → Device Doctor" |
| Invite member + join + role assignment | **WORKS single-workspace** (defect multi-workspace, see §7) | join code "shown once"; "fleet.admin and vendor.operator are not offered here — elevated roles are granted by workspace operators" |
| Devices → Fleet list | **WORKS** | roster + facet counts + search + sort |
| Devices → Install Center | **WORKS** | 6 installers with checksums; one-time code display-once held; journey stages |
| Device Doctor | **PLACEHOLDER** | "doctor — not yet composed in this runtime" |
| Security findings + inspect dialog | **WORKS** (view + proposal) | "SecurityRemediationIntent … No direct-execution path exists on this surface" |
| Security Doctor (remediation walk) | **PLACEHOLDER** | "doctor — not yet composed in this runtime" |
| Approvals queue view | **WORKS** (view only) | "parked first, decided by an owner, never auto-promoted" |
| Approve / Reject controls | **INERT** | click → no dialog/request/DOM change; badge stays "1 pending" |
| Policies | **WORKS** (read-only) | "The Contract Guardian's frozen policy surfaces … Read-only." |
| Fleet Actions plans | **PLACEHOLDER** | "plans — not yet composed in this runtime" |
| Recovery cases | **PLACEHOLDER** | "cases — not yet composed in this runtime" |
| Workloads planning | **PLACEHOLDER** | "planning — not yet composed in this runtime" |
| Commerce procurement | **PLACEHOLDER** | "procurement — not yet composed in this runtime" |
| Evidence & Audit | **WORKS** | index + per-record trails; "Opaque content-addressed references, verbatim — never interpreted by the console." |
| Learning | **WORKS** | evaluation cases "Held for human review — never auto-submitted"; adoption ledger; outcome feed |
| Global search (Ctrl+K) | **WORKS** | "search semantics are deterministic (W061 contract)"; "matched keyword exact" |
| Gated destructive actions (Install Center) | **INERT** (labeled, gated in copy, no flow on click) | "A destructive action: it requires an explicit policy grant and leaves an evidence trail." |
| Mobile (390×844) | **WORKS shell** | hamburger drawer (10 areas) + bottom nav; roster table 993px wide → horizontal page scroll |
| Vendor (viewer) enrollment-code creation | **SILENT DENIAL** | click → nothing, no explanation |

**Role model observed in-product:** Fleet Administrator → `owner`; Service Desk, Asset & Procurement Manager → `operator`; Security & Compliance, Team Manager → `approver`; Employee / Device Owner, Vendor / Service Operator → `viewer`. Role switcher in the user menu is labeled "Role switches are audited and never change your permissions."

---

## 3. Industry 6 — Transportation / Delivery

**Firms simulated:** SIMB-TRN-LG "Meridian Freight Systems" (LARGE, ~820 devices: ELD rugged laptops, dashcams, depot workstations, multi-state), SIMB-TRN-MD "Capitol Last-Mile Logistics" (MEDIUM, ~95 devices), SIMB-TRN-SM "Bluegrass Courier Co." (SMALL, 12 devices).
**Incumbent set named by this panel:** Samsara / Verizon Connect / Motive / Geotab (telematics, ELD/HOS compliance, dashcams), SOTI / Microsoft Intune (device management), ServiceNow / Zendesk + depot RMM (service desk), Onfleet / Bringg (dispatch), fleet-maintenance vendor networks.

### SIMB-TRN-LG — Meridian Freight Systems (LARGE)

| Persona (name — title) | Product role | Incumbent covering needs today | Verdict | Why (grounded in live experience) |
|---|---|---|---|---|
| Marta Kowalski — VP Fleet Operations | Fleet Administrator | Samsara (fleet-wide ops dashboard) | **RETAIN** | Control Tower triage works, but six lanes incl. Recovery/Fleet Actions are placeholders and Approve is inert — she cannot run a fleet in it; Samsara stays the daily interface. |
| Dwayne Carter — Depot Technician Lead | Service Desk | ServiceNow + depot RMM (Datto/ConnectWise) | **RETAIN** | Device Doctor is "not yet composed in this runtime"; his join even misrouted into the demo tenant (cross-tenant code defect). |
| Ingrid Svensson — Cargo Security Officer | Security & Compliance | Samsara Safety + Geotab compliance | **RETAIN** | Finding inspect + evidence refs are genuinely good, but there is no real data ingestion and the remediation walk + approval click are blocked/inert. |
| Rosa Delgado — Fleet Procurement Director | Asset & Procurement Manager | Coupa + lease portals (Ryder/Penske) | **RETAIN** | Workloads and Commerce are both placeholders — zero procurement surface exists. |
| Tom Nguyen — Terminal Operations Manager | Team Manager | Motive/Samsara dashboards + Onfleet | **RETAIN** | No team view composed; only the shared needs-attention stream, over demo data. |
| Sami Haddad — Long-haul Driver | Employee / Device Owner | Motive Driver App / Samsara Driver | **RETAIN** | No self-service device surface exists (viewer lens; Device Doctor not composed). |
| Klaus Weber — TruckCare Maintenance Services | Vendor / Service Operator | FleetNet / Ford Pro service networks | **RETAIN** | No vendor portal composed; enrollment-code creation silently does nothing for viewer role. |

### SIMB-TRN-MD — Capitol Last-Mile Logistics (MEDIUM)

| Persona | Product role | Incumbent | Verdict | Why |
|---|---|---|---|---|
| Andre Silva — IT & Fleet Manager | Fleet Administrator | Verizon Connect + Intune | **RETAIN** | Signup/code drill/password sign-in all pass, but no lane exists to operate a 95-device courier fleet. |
| Priya Raman — Depot Technician | Service Desk | Zendesk + RMM | **RETAIN** | Join attempt hit the silent empty-alert failure (code collision); Device Doctor not composed. |
| Jordan Blake — Loss Prevention Lead | Security & Compliance | Verizon Connect + Geotab | **RETAIN** | Findings view works over demo data only; approvals cannot be decided (inert). |
| Elena Fischer — Procurement Specialist | Asset & Procurement Manager | Coupa | **RETAIN** | Commerce placeholder — "procurement — not yet composed in this runtime". |
| Marcus Webb — Dispatch Supervisor | Team Manager | Onfleet / Bringg | **RETAIN** | Nothing role-specific composed. |
| Luis Ortega — Courier | Employee / Device Owner | company phones + MDM | **RETAIN** | No employee self-service surface. |
| Nguyen Tran — RoadPro Tire & Battery | Vendor / Service Operator | vendor's own portal | **RETAIN** | No vendor portal; silent denial on code creation. |

### SIMB-TRN-SM — Bluegrass Courier Co. (SMALL)

| Persona | Product role | Incumbent | Verdict | Why |
|---|---|---|---|---|
| Hannah Cole — Owner/Operations | Fleet Administrator | spreadsheet + Google admin | **RETAIN** | Even for 12 devices: a fresh workspace owns no records and no device can ever check in (client-side-only control plane), so the spreadsheet stays. |
| Caleb Cole — Part-time Depot Tech | Service Desk | ad-hoc fixes | **RETAIN** | No diagnosis surface exists (placeholder). |
| Hannah Cole (dual-hat) | Security & Compliance | none (ad-hoc) | **RETAIN** | The findings/evidence MODEL is exactly what a small fleet lacks — but with no data ingestion it stays a demo. |
| Hannah Cole (dual-hat) | Asset & Procurement Manager | supplier websites | **RETAIN** | Commerce lane not composed. |
| Hannah Cole (dual-hat) | Team Manager | text messages | **RETAIN** | No team surface. |
| Sam Boyd — Courier | Employee / Device Owner | personal phone | **RETAIN** | No self-service. |
| Mike's Truck Service (local) | Vendor / Service Operator | phone + paper | **RETAIN** | No vendor portal. |

**Mobile pass (TRN, 390×844, incl. Marta's real workspace + demo fleet):** sign-in, Control Tower, findings, approvals, search all reachable; hamburger drawer lists all 10 areas, bottom nav present; device roster table renders 993px wide → horizontal page scrolling; Device Doctor placeholder identical to desktop.

**Industry synthesis:** fleet telematics incumbents own the operational ground (GPS, ELD, video, maintenance). FleetOS's differentiation here would have to be the Guardian/approvals/evidence layer on top of device fleets — which exists as a model but not as an operable runtime.

---

## 4. Industry 7 — Hospitality

**Firms simulated:** SIMB-HOS-LG "Aurelia Hotel Group" (LARGE, ~640 devices: POS terminals, front-desk, housekeeping tablets, kitchen displays across 14 properties), SIMB-HOS-MD "Harborline Restaurants" (MEDIUM, ~78), SIMB-HOS-SM "Veranda Venue Co." (SMALL, 18).
**Incumbents:** Toast / NCR Aloha / Oracle MICROS (POS + device fleets), Jamf / Kandji / Intune (property MDM), 7shifts / HotSchedules (ops), hotel PMS (Opera), PCI-DSS tooling (SecurityMetrics / Trustwave).

### SIMB-HOS-LG — Aurelia Hotel Group (LARGE)

| Persona | Product role | Incumbent | Verdict | Why |
|---|---|---|---|---|
| Sofia Marchetti — Corporate IT Director | Fleet Administrator | Jamf/Intune + property IT | **RETAIN** | Multi-property triage shape exists (needs-attention), but device actions, recovery, actions, workloads, commerce are placeholders; no POS/PMS integrations exist. |
| Ravi Patel — Property Systems Technician | Service Desk | MSP RMM + Toast support | **RETAIN** | Device Doctor placeholder; cannot diagnose the POS terminals he supports. |
| Derek Osei — PCI Compliance Officer | Security & Compliance | SecurityMetrics/Trustwave + POS vendor tooling | **RETAIN** | Findings/evidence model fits PCI evidence pulls nicely, but no real observations can ever flow in; approval inert. |
| Camille Laurent — FF&E/IT Procurement Manager | Asset & Procurement Manager | Coupa + vendor portals | **RETAIN** | Commerce placeholder. |
| Grace Kim — Front Office Manager | Team Manager | Opera + 7shifts | **RETAIN** | No team surface composed. |
| Mateo Rossi — Front Desk Agent | Employee / Device Owner | Toast handhelds | **RETAIN** | No self-service device view. |
| Ana Ferreira — POS Hardware Service Provider | Vendor / Service Operator | Toast Central service network | **RETAIN** | No vendor portal; silent denial on enrollment-code creation. |

### SIMB-HOS-MD — Harborline Restaurants (MEDIUM)

| Persona | Product role | Incumbent | Verdict | Why |
|---|---|---|---|---|
| Ben Ortiz — Ops Technology Lead | Fleet Administrator | Toast + Intune | **RETAIN** | Setup journeys all pass (incl. Omar's security-compliance join), but operations lanes placeholders. |
| Tasha Green — IT Support Technician | Service Desk | MSP | **RETAIN** | No diagnosis surface. |
| Omar Haddad — Loss Prevention Manager | Security & Compliance | Toast reporting + camera NVR | **RETAIN** | Findings view over demo data only; cannot decide approvals. |
| Jill Warren — Purchasing Manager | Asset & Procurement Manager | supplier portals | **RETAIN** | Commerce not composed. |
| Lin Zhao — General Manager | Team Manager | 7shifts | **RETAIN** | No team surface. |
| Cole Bennett — Server | Employee / Device Owner | Toast handheld | **RETAIN** | No self-service. |
| Sun Park — Kitchen Display Technician | Vendor / Service Operator | NCR/Toast dispatch | **RETAIN** | No vendor portal. |

### SIMB-HOS-SM — Veranda Venue Co. (SMALL)

| Persona | Product role | Incumbent | Verdict | Why |
|---|---|---|---|---|
| Ivy Chen — Owner | Fleet Administrator | Square/Toast + spreadsheets | **RETAIN** | Cannot get her 18 devices in: enrollment stays "unbootstrapped — waiting" with no manual path. |
| Leo Garnier — AV & Bar Technician | Service Desk | ad-hoc | **RETAIN** | Device Doctor placeholder. |
| Ivy Chen (dual-hat) | Security & Compliance | none | **RETAIN** | Evidence-trail model attractive for incident record-keeping; no ingestion. |
| Ivy Chen (dual-hat) | Asset & Procurement Manager | supplier sites | **RETAIN** | Commerce placeholder. |
| Maya Duval — Events Manager | Team Manager | paper + texts | **RETAIN** | No team surface. |
| Rio Tanaka — Floor Staff | Employee / Device Owner | shared tablets | **RETAIN** | No self-service. |
| CityPOS Services | Vendor / Service Operator | phone dispatch | **RETAIN** | No vendor portal. |

**Mobile pass (HOS, 390×844, Ben's real workspace + demo fleet):** same as TRN — solid shell, drawer + bottom nav, table overflow, placeholders unchanged.

**Industry synthesis:** POS/MDM incumbents and the PMS own the surfaces; a "device compliance + evidence" layer is a real gap in hospitality (PCI evidence pulls are painful today), which is exactly the FleetOS model — but as implemented it cannot ingest a single real POS terminal.

---

## 5. Industry 8 — Fashion / Entertainment / Media

**Firms simulated:** SIMB-FEM-LG "Northstar Media Group" (LARGE, ~580 devices: production laptops, camera kits, edit bays, event tablets), SIMB-FEM-MD "Atelier Nine" (MEDIUM, 88), SIMB-FEM-SM "Punchlist Studios" (SMALL, 15).
**Incumbents:** Jamf/Kandji/SimpleMDM (MDM), Cheqroom / Rentman / Aspire (equipment & rental asset management), StudioBinder / Movie Magic (production), ShareGrid/Lensrentals (rental vendor portals), forensic watermarking/content-security tools.

### SIMB-FEM-LG — Northstar Media Group (LARGE)

| Persona | Product role | Incumbent | Verdict | Why |
|---|---|---|---|---|
| Talia Bernstein — Director of Production Technology | Fleet Administrator | Kandji + Cheqroom | **RETAIN** | Control Tower shape is right (severity-ordered stream) but every operational lane her teams need (doctor, actions, recovery, workloads, commerce) is a placeholder. |
| Marco Ruiz — Post-Production Support Engineer | Service Desk | in-house + JAMF tickets | **RETAIN** | Cannot diagnose edit-bay machines — Device Doctor placeholder. |
| Adaeze Nwosu — Content Security Officer | Security & Compliance | watermarking + leak-response runbooks | **RETAIN** | "immutable observations, opaque references" evidence model is a great fit for leak investigations; no real observations, inert approvals. |
| Felix Grant — Equipment & Rentals Manager | Asset & Procurement Manager | Cheqroom/Rentman | **RETAIN** | Commerce/procurement placeholder; no rental workflows. |
| Nadia Petrova — Line Producer | Team Manager | Movie Magic + StudioBinder | **RETAIN** | No team surface; production workflows absent. |
| Jonah Marsh — Camera Operator | Employee / Device Owner | Find My Mac + gear logs | **RETAIN** | No self-service device view. |
| Yuki Tanaka — LensWorks Rental House | Vendor / Service Operator | ShareGrid portal | **RETAIN** | No vendor portal; silent code-creation denial. |

### SIMB-FEM-MD — Atelier Nine (MEDIUM)

| Persona | Product role | Incumbent | Verdict | Why |
|---|---|---|---|---|
| Odile Marchand — Head of Studio Technology | Fleet Administrator | Jamf + spreadsheet | **RETAIN** | Signup/persistence solid; operations placeholders. |
| Theo Lindqvist — Sample-Room IT Specialist | Service Desk | Jamf | **RETAIN** | Joined as asset-manager role in product; no diagnosis surface. |
| Beatriz Cruz — Brand-Protection Analyst | Security & Compliance | manual brand-security audits | **RETAIN** | Findings view over demo data only. |
| Amara Okafor — Equipment Buyer | Asset & Procurement Manager | supplier portals | **RETAIN** | Commerce not composed. |
| Jules Marchand — Atelier Operations Manager | Team Manager | Notion | **RETAIN** | No team surface. |
| Elin Svensson — Fit Model Coordinator | Employee / Device Owner | shared devices | **RETAIN** | No self-service. |
| FotoPro Rentals | Vendor / Service Operator | phone/email | **RETAIN** | No vendor portal. |

### SIMB-FEM-SM — Punchlist Studios (SMALL)

| Persona | Product role | Incumbent | Verdict | Why |
|---|---|---|---|---|
| Priya Nair — Founder/Executive Producer | Fleet Administrator | Find My + spreadsheet | **RETAIN** | 15 devices can never enter the product (no agent check-in, no import). |
| Dan Mercer — Editor/Colorist | Service Desk (joined as employee in-product) | self-managed | **RETAIN** | Joined fine (viewer lens); no diagnosis surface. |
| Priya Nair (dual-hat) | Security & Compliance | none | **RETAIN** | Model without data. |
| Priya Nair (dual-hat) | Asset & Procurement Manager | rental invoices | **RETAIN** | Commerce placeholder. |
| Priya Nair (dual-hat) | Team Manager | callsheets | **RETAIN** | No team surface. |
| Dan Mercer — Editor/Colorist | Employee / Device Owner | own laptop | **RETAIN** | No self-service. |
| GripTruck LA | Vendor / Service Operator | texts | **RETAIN** | No vendor portal. |

**Mobile pass (FEM, 390×844, demo fleet in Atelier Nine's session):** identical pattern — reachable areas, table overflow, placeholders unchanged.

**Industry synthesis:** equipment/rental management is the beating heart here (Cheqroom/Rentman), and it maps to Workloads+Commerce — both placeholders. Content-security evidence is FleetOS's plausible wedge, but only as a model today.

---

## 6. Industry 9 — Legal

**Firms simulated:** SIMB-LEG-LG "Hartwell & Cross LLP" (LARGE, ~520 devices), SIMB-LEG-MD "Beacon Legal Services" (MEDIUM, 65), SIMB-LEG-SM "Two Rivers Family Law" (SMALL, 9).
**Incumbents:** iManage / NetDocuments (DMS), Microsoft 365 + Intune + Purview (device/compliance), Litera, Aderant/Elite 3E (practice management), e-discovery vendors (Kroll, Consilio).

### SIMB-LEG-LG — Hartwell & Cross LLP (LARGE)

| Persona | Product role | Incumbent | Verdict | Why |
|---|---|---|---|---|
| Robert Chen — Director of IT | Fleet Administrator | Intune + iManage admin | **RETAIN** | No real MDM functions exist as implemented; Intune stays. |
| Dana Whitfield — Service Desk Analyst | Service Desk | ServiceNow (firm ITSM) | **RETAIN** | No ticketing, no diagnosis surface (Device Doctor placeholder). |
| Priyanka Mehta — Information Security Counsel | Security & Compliance | Purview + ethical-wall tooling | **RETAIN** | Evidence trails with opaque refs would be litigation-grade if real observations existed; they cannot enter. |
| George Ashworth — Procurement Manager | Asset & Procurement Manager | Coupa/Ariba | **RETAIN** | Commerce placeholder. |
| Karen Silva — Litigation Practice Manager | Team Manager | Aderant/3E | **RETAIN** | No team surface. |
| James Okafor — Associate Attorney | Employee / Device Owner | iManage + firm laptop | **RETAIN** | No self-service device surface. |
| Laura Kim — Court-Reporting & Forensic Vendor | Vendor / Service Operator | Kroll/Consilio portals | **RETAIN** | No vendor portal. |

### SIMB-LEG-MD — Beacon Legal Services (MEDIUM)

| Persona | Product role | Incumbent | Verdict | Why |
|---|---|---|---|---|
| Amara Diallo — Managing Attorney / IT Lead | Fleet Administrator | M365 admin center | **RETAIN** | Setup works; operations placeholders. |
| Peter Vance — Compliance & Risk Officer | Security & Compliance (joined in-product) | M365 compliance | **RETAIN** | Approver lens works as a view; approvals inert. |
| Iris Kam — Legal Support Technician | Service Desk | Break-fix MSP | **RETAIN** | No diagnosis surface. |
| Thomas Read — Office Manager/Procurement | Asset & Procurement Manager | office supply portals | **RETAIN** | Commerce placeholder. |
| Sofia Reyes — Paralegal Team Lead | Team Manager | Clio/Aderant | **RETAIN** | No team surface. |
| Devin Park — Paralegal | Employee / Device Owner | firm laptop | **RETAIN** | No self-service. |
| MetroShred Certified Disposal | Vendor / Service Operator | certificate portals | **RETAIN** | No vendor portal. |

### SIMB-LEG-SM — Two Rivers Family Law (SMALL)

| Persona | Product role | Incumbent | Verdict | Why |
|---|---|---|---|---|
| Nora Ellis — Managing Partner | Fleet Administrator | M365 + spreadsheet | **RETAIN** | 9 devices cannot be enrolled (no real agent path). |
| Sam Rutledge — Office Manager | Team Manager (joined in-product) | paper processes | **RETAIN** | Joined with approver console role; no team surface to use. |
| Nora Ellis (dual-hat) | Security & Compliance | none | **RETAIN** | Evidence model without ingestion. |
| Nora Ellis (dual-hat) | Asset & Procurement Manager | online ordering | **RETAIN** | Commerce placeholder. |
| Nora Ellis (dual-hat) | Service Desk | local IT contractor | **RETAIN** | Device Doctor placeholder. |
| Alec Bowen — Associate Attorney | Employee / Device Owner | firm laptop | **RETAIN** | No self-service. |
| Cascade IT Support | Vendor / Service Operator | email | **RETAIN** | No vendor portal. |

**Mobile pass (LEG, 390×844, demo fleet):** same pattern; search returns "W091-DEMO-0001 — Lenovo ThinkPad T14 matched title prefix" — deterministic behavior identical on mobile.

**Industry synthesis:** legal needs audit-grade evidence and controlled device actions — the FleetOS MODEL (immutable refs, verbatim parking reasons, never auto-promoted approvals) speaks this language better than any other industry in the panel. But iManage/Intune incumbents are untouchable while zero real devices and zero executable actions exist.

---

## 7. Industry 10 — Defense / Security

**Firms simulated:** SIMB-DEF-LG "Sentinel Ridge Defense Systems" (LARGE, ~750 devices, government-adjacent contractor), SIMB-DEF-MD "Ironclad Protective Services" (MEDIUM, 110), SIMB-DEF-SM "Keystone Risk Group" (SMALL, 16).
**Incumbents:** Absolute (Persistence/Resilience), Microsoft Intune Government (GCC High) + Defender for Endpoint, Trellix/ACAS (Tenable) + STIG Manager, DISA-adjacent processes, LanScope Cat, certified sanitization/disposal chains.

### SIMB-DEF-LG — Sentinel Ridge Defense Systems (LARGE)

| Persona | Product role | Incumbent | Verdict | Why |
|---|---|---|---|---|
| David Hargrove — IT Fleet Director (Col., Ret.) | Fleet Administrator | Absolute + Intune Gov (GCC High) | **RETAIN** | No persistence agent, no real control plane (client-side localStorage), predictable enrollment codes — disqualifying for this sector as implemented. |
| Mick Torres — Systems Technician | Service Desk | ServiceNow Gov | **RETAIN** | No diagnosis surface. |
| Fatima Al-Rashid — Facility Security Officer | Security & Compliance | ACAS + STIG Manager | **RETAIN** | The Guardian/approvals/evidence pattern is close to what an FSO wants for action authorization — but findings come only from the demo seed and approvals are inert. |
| Susan Blackwood — Property & Logistics Manager | Asset & Procurement Manager | DPAS/ERP property systems | **RETAIN** | Commerce placeholder; no property accountability workflows. |
| Elena Vasquez — Program Site Lead | Team Manager | program-management tooling | **RETAIN** | No team surface. |
| Ryan Doyle — Field Engineer | Employee / Device Owner | CAC/PIV + GFED processes | **RETAIN** | No self-service. |
| Chen Wei — Certified Sanitization Vendor | Vendor / Service Operator | disposal-chain portals | **RETAIN** | No vendor portal; silent denial on code creation as viewer. |

### SIMB-DEF-MD — Ironclad Protective Services (MEDIUM)

| Persona | Product role | Incumbent | Verdict | Why |
|---|---|---|---|---|
| Rachel Stone — Director of Technology | Fleet Administrator | Intune + Absolute | **RETAIN** | Same blockers; setup journeys pass, operations do not exist. |
| Vic Alonso — Fleet & Equipment Coordinator | Asset & Procurement Manager (joined in-product) | spreadsheets | **RETAIN** | Commerce placeholder. |
| Tanya Rook — Patrol Systems Technician | Service Desk | MSP | **RETAIN** | No diagnosis surface. |
| Marcus Bell — Physical Security Manager | Security & Compliance | Lenel/Genetec | **RETAIN** | Findings view over demo data only. |
| Imani Cross — Patrol Operations Manager | Team Manager | GuardTour apps | **RETAIN** | No team surface. |
| Oscar Reyes — Security Officer | Employee / Device Owner | tour devices | **RETAIN** | No self-service. |
| SecureIT Device Services | Vendor / Service Operator | vendor portal | **RETAIN** | No vendor portal. |

### SIMB-DEF-SM — Keystone Risk Group (SMALL)

| Persona | Product role | Incumbent | Verdict | Why |
|---|---|---|---|---|
| Grant Whitmore — Principal Consultant | Fleet Administrator | Intune | **RETAIN** | 16 devices cannot be enrolled. |
| Erica Nash — Compliance Lead | Security & Compliance (joined in-product) | manual audit logs | **RETAIN** | Approver lens + evidence trails are the right shape; no real data or decisions. |
| Grant Whitmore (dual-hat) | Service Desk | local IT | **RETAIN** | Device Doctor placeholder. |
| Grant Whitmore (dual-hat) | Asset & Procurement Manager | online ordering | **RETAIN** | Commerce placeholder. |
| Grant Whitmore (dual-hat) | Team Manager | spreadsheets | **RETAIN** | No team surface. |
| Tara Munoz — Field Consultant | Employee / Device Owner | own laptop | **RETAIN** | No self-service. |
| CyberShred Partners | Vendor / Service Operator | certificates by email | **RETAIN** | No vendor portal. |

**Mobile pass (DEF, 390×844, demo fleet):** identical to other industries; gated-destructive labels visible on mobile, clicks equally inert.

**Industry synthesis:** defense/security is simultaneously the best fit for FleetOS's authorization-first doctrine and the least tolerant of its as-implemented gaps (client-side trust store, deterministic codes, inert revocation). No defense adoption is possible until the control plane is server-side, codes are high-entropy, and revoke/approve actually execute.


---

## 8. Full executed-projects evidence log (150 journeys)

Format: `FIRM | persona (product role) | journey | outcome | verbatim snippet`. J1–J4 = real-workspace journeys executed with the firm's own admin/member through the real sign-up flow; O1–O6 = operational journeys executed through the seven DEMO personas over the shared demo fleet, projected onto each industry. Raw per-firm logs with timestamps are archived in the simulation workspace alongside this report's generation scripts.


1. TRN-LG | Marta Kowalski — VP Fleet Operations (Fleet Administrator) | J1 Workspace provisioning + onboarding rail | PASS — workspace created via real signup; honest empty state | "Nothing needs your attention right now" / "No records yet." (all areas) — honest empty states
2. TRN-LG | Marta Kowalski — VP Fleet Operations (Fleet Administrator) | J2 Device lifecycle — Install Center enrollment code drill + gated destructive attempt | PASS — code issued, display-once held; revoke/disable gated, click yields no dialog | code BOOT-W101-0001; "The console stores only a verifier; this code cannot be shown again."; "A destructive action: it requires an explicit policy grant and leaves an evidence trail."
3. TRN-LG | Dwayne Carter — Depot Technician Lead (Service Desk) | J3 Invite + join + role assignment | DEFECT — member joined with Service Desk lens BUT principal landed in the shared DEMO tenant, not SIMB-TRN-LG (cross-tenant join-code misroute) | join code joinw10100000001 issued "shown once"; Dwayne Carter appears under tnt_w091demo000001 principals; SIMB-TRN-LG invitation used_at=null
4. TRN-LG | Marta Kowalski — VP Fleet Operations (Fleet Administrator) | J4 Session persistence + sign-out + password sign-in | PASS — session survives reload; password sign-in restores owner role | role=owner after password sign-in
5. TRN-LG | Marta Kowalski — VP Fleet Operations (Fleet Administrator, demo lens) | O1 Control Tower triage over fleet under management | PASS — severity-ordered needs-attention stream, counters, recent activity | "CRITICAL — Disk encryption is disabled … Remediation proposal drafted — approval required"
6. TRN-LG | Service Desk persona (demo lens) | O2 Device Doctor diagnosis | BLOCKED — lane placeholder | "doctor — not yet composed in this runtime"
7. TRN-LG | Security & Compliance persona (demo lens) | O3 Security-incident response: finding -> Guardian decision -> approval -> action | PARTIAL — finding inspect + proposal + evidence view PASS; remediation walk BLOCKED; approval click INERT | "SecurityRemediationIntent … No direct-execution path exists on this surface"; after Approve click badge still "Approvals inbox: 1 pending"
8. TRN-LG | Asset & Procurement persona (demo lens) | O4 Procurement cycle: workload planning -> recommendation -> vendor quote | BLOCKED — lanes placeholders | "planning — not yet composed in this runtime"; "procurement — not yet composed in this runtime"
9. TRN-LG | Marta Kowalski — VP Fleet Operations (Fleet Administrator, demo lens) | O5 Lost-device recovery drill incl. gated destructive attempt | BLOCKED — recovery lane placeholder; gated revoke click INERT | "cases — not yet composed in this runtime"; "Revoke the device's trust (requires authorization)" -> INERT-no-change
10. TRN-LG | Security & Compliance persona (demo lens) | O6 Audit/evidence pull + deterministic global search | PASS — evidence trail index, per-record chains with opaque refs; search deterministic | "Every consequential record with an audit trail — approvals, recoveries, enrollments, commerce decisions."; "matched keyword exact — pln_fb564c1e"; "search semantics are deterministic (W061 contract)"
11. TRN-MD | Andre Silva — IT & Fleet Manager (Fleet Administrator) | J1 Workspace provisioning + onboarding rail | PASS — workspace created via real signup; honest empty state | "Nothing needs your attention right now" (Control Tower, verified while signed in as Andre Silva)
12. TRN-MD | Andre Silva — IT & Fleet Manager (Fleet Administrator) | J2 Device lifecycle — Install Center enrollment code drill + gated destructive attempt | PASS — code issued, display-once held; revoke/disable gated, click yields no dialog | code BOOT-W101-0001; "The console stores only a verifier; this code cannot be shown again."; "A destructive action: it requires an explicit policy grant and leaves an evidence trail."
13. TRN-MD | Priya Raman — Depot Technician (Service Desk) | J3 Invite + join + role assignment | BLOCKED — join redemption silently failed: page alert empty, no error text, no navigation (code-string collision with already-consumed demo-workspace invitation) | joinw10100000001; empty <alert> on gate after click
14. TRN-MD | Andre Silva — IT & Fleet Manager (Fleet Administrator) | J4 Session persistence + sign-out + password sign-in | PARTIAL — session survives reload; password sign-in restores owner role | role=owner after password sign-in
15. TRN-MD | Andre Silva — IT & Fleet Manager (Fleet Administrator, demo lens) | O1 Control Tower triage over fleet under management | PASS — severity-ordered needs-attention stream, counters, recent activity | "CRITICAL — Disk encryption is disabled … Remediation proposal drafted — approval required"
16. TRN-MD | Service Desk persona (demo lens) | O2 Device Doctor diagnosis | BLOCKED — lane placeholder | "doctor — not yet composed in this runtime"
17. TRN-MD | Security & Compliance persona (demo lens) | O3 Security-incident response: finding -> Guardian decision -> approval -> action | PARTIAL — finding inspect + proposal + evidence view PASS; remediation walk BLOCKED; approval click INERT | "SecurityRemediationIntent … No direct-execution path exists on this surface"; after Approve click badge still "Approvals inbox: 1 pending"
18. TRN-MD | Asset & Procurement persona (demo lens) | O4 Procurement cycle: workload planning -> recommendation -> vendor quote | BLOCKED — lanes placeholders | "planning — not yet composed in this runtime"; "procurement — not yet composed in this runtime"
19. TRN-MD | Andre Silva — IT & Fleet Manager (Fleet Administrator, demo lens) | O5 Lost-device recovery drill incl. gated destructive attempt | BLOCKED — recovery lane placeholder; gated revoke click INERT | "cases — not yet composed in this runtime"; "Revoke the device's trust (requires authorization)" -> INERT-no-change
20. TRN-MD | Security & Compliance persona (demo lens) | O6 Audit/evidence pull + deterministic global search | PASS — evidence trail index, per-record chains with opaque refs; search deterministic | "Every consequential record with an audit trail — approvals, recoveries, enrollments, commerce decisions."; "matched keyword exact — pln_fb564c1e"; "search semantics are deterministic (W061 contract)"
21. TRN-SM | Hannah Cole — Owner/Operations (Fleet Administrator) | J1 Workspace provisioning + onboarding rail | PASS — workspace created via real signup; honest empty state | - StaticText "Nothing needs your attention right now"
22. TRN-SM | Hannah Cole — Owner/Operations (Fleet Administrator) | J2 Device lifecycle — Install Center enrollment code drill + gated destructive attempt | PASS — code issued, display-once held; revoke/disable gated, click yields no dialog | code BOOT-W101-0001; "The console stores only a verifier; this code cannot be shown again."; "A destructive action: it requires an explicit policy grant and leaves an evidence trail."
23. TRN-SM | Caleb Cole — Part-time Depot Tech | J3 Invite + join + role assignment | PASS — one-time join code redeemed, role lens + console role assigned | lens=Service role=operator; "Joining with a role sets your starting role assignment… fleet.admin and vendor.operator are not offered here"
24. TRN-SM | Hannah Cole — Owner/Operations (Fleet Administrator) | J4 Session persistence + sign-out + password sign-in | PASS — session survives reload; password sign-in restores owner role | role=owner after password sign-in
25. TRN-SM | Hannah Cole — Owner/Operations (Fleet Administrator, demo lens) | O1 Control Tower triage over fleet under management | PASS — severity-ordered needs-attention stream, counters, recent activity | "CRITICAL — Disk encryption is disabled … Remediation proposal drafted — approval required"
26. TRN-SM | Service Desk persona (demo lens) | O2 Device Doctor diagnosis | BLOCKED — lane placeholder | "doctor — not yet composed in this runtime"
27. TRN-SM | Security & Compliance persona (demo lens) | O3 Security-incident response: finding -> Guardian decision -> approval -> action | PARTIAL — finding inspect + proposal + evidence view PASS; remediation walk BLOCKED; approval click INERT | "SecurityRemediationIntent … No direct-execution path exists on this surface"; after Approve click badge still "Approvals inbox: 1 pending"
28. TRN-SM | Asset & Procurement persona (demo lens) | O4 Procurement cycle: workload planning -> recommendation -> vendor quote | BLOCKED — lanes placeholders | "planning — not yet composed in this runtime"; "procurement — not yet composed in this runtime"
29. TRN-SM | Hannah Cole — Owner/Operations (Fleet Administrator, demo lens) | O5 Lost-device recovery drill incl. gated destructive attempt | BLOCKED — recovery lane placeholder; gated revoke click INERT | "cases — not yet composed in this runtime"; "Revoke the device's trust (requires authorization)" -> INERT-no-change
30. TRN-SM | Security & Compliance persona (demo lens) | O6 Audit/evidence pull + deterministic global search | PASS — evidence trail index, per-record chains with opaque refs; search deterministic | "Every consequential record with an audit trail — approvals, recoveries, enrollments, commerce decisions."; "matched keyword exact — pln_fb564c1e"; "search semantics are deterministic (W061 contract)"
31. HOS-LG | Sofia Marchetti — Corporate IT Director (Fleet Administrator) | J1 Workspace provisioning + onboarding rail | PASS — workspace created via real signup; honest empty state | - StaticText "Nothing needs your attention right now"
32. HOS-LG | Sofia Marchetti — Corporate IT Director (Fleet Administrator) | J2 Device lifecycle — Install Center enrollment code drill + gated destructive attempt | PASS — code issued, display-once held; revoke/disable gated, click yields no dialog | code BOOT-W101-0001; "The console stores only a verifier; this code cannot be shown again."; "A destructive action: it requires an explicit policy grant and leaves an evidence trail."
33. HOS-LG | Ravi Patel — Property Systems Technician | J3 Invite + join + role assignment | PASS — one-time join code redeemed, role lens + console role assigned | lens=Service role=operator; "Joining with a role sets your starting role assignment… fleet.admin and vendor.operator are not offered here"
34. HOS-LG | Sofia Marchetti — Corporate IT Director (Fleet Administrator) | J4 Session persistence + sign-out + password sign-in | PASS — session survives reload; password sign-in restores owner role | role=owner after password sign-in
35. HOS-LG | Sofia Marchetti — Corporate IT Director (Fleet Administrator, demo lens) | O1 Control Tower triage over fleet under management | PASS — severity-ordered needs-attention stream, counters, recent activity | "CRITICAL — Disk encryption is disabled … Remediation proposal drafted — approval required"
36. HOS-LG | Service Desk persona (demo lens) | O2 Device Doctor diagnosis | BLOCKED — lane placeholder | "doctor — not yet composed in this runtime"
37. HOS-LG | Security & Compliance persona (demo lens) | O3 Security-incident response: finding -> Guardian decision -> approval -> action | PARTIAL — finding inspect + proposal + evidence view PASS; remediation walk BLOCKED; approval click INERT | "SecurityRemediationIntent … No direct-execution path exists on this surface"; after Approve click badge still "Approvals inbox: 1 pending"
38. HOS-LG | Asset & Procurement persona (demo lens) | O4 Procurement cycle: workload planning -> recommendation -> vendor quote | BLOCKED — lanes placeholders | "planning — not yet composed in this runtime"; "procurement — not yet composed in this runtime"
39. HOS-LG | Sofia Marchetti — Corporate IT Director (Fleet Administrator, demo lens) | O5 Lost-device recovery drill incl. gated destructive attempt | BLOCKED — recovery lane placeholder; gated revoke click INERT | "cases — not yet composed in this runtime"; "Revoke the device's trust (requires authorization)" -> INERT-no-change
40. HOS-LG | Security & Compliance persona (demo lens) | O6 Audit/evidence pull + deterministic global search | PASS — evidence trail index, per-record chains with opaque refs; search deterministic | "Every consequential record with an audit trail — approvals, recoveries, enrollments, commerce decisions."; "matched keyword exact — pln_fb564c1e"; "search semantics are deterministic (W061 contract)"
41. HOS-MD | Ben Ortiz — Ops Technology Lead (Fleet Administrator) | J1 Workspace provisioning + onboarding rail | PASS — workspace created via real signup; honest empty state | - StaticText "Nothing needs your attention right now"
42. HOS-MD | Ben Ortiz — Ops Technology Lead (Fleet Administrator) | J2 Device lifecycle — Install Center enrollment code drill + gated destructive attempt | PASS — code issued, display-once held; revoke/disable gated, click yields no dialog | code BOOT-W101-0001; "The console stores only a verifier; this code cannot be shown again."; "A destructive action: it requires an explicit policy grant and leaves an evidence trail."
43. HOS-MD | Omar Haddad — Loss Prevention Manager | J3 Invite + join + role assignment | PASS — one-time join code redeemed, role lens + console role assigned | lens=Security role=approver; "Joining with a role sets your starting role assignment… fleet.admin and vendor.operator are not offered here"
44. HOS-MD | Ben Ortiz — Ops Technology Lead (Fleet Administrator) | J4 Session persistence + sign-out + password sign-in | PASS — session survives reload; password sign-in restores owner role | role=owner after password sign-in
45. HOS-MD | Ben Ortiz — Ops Technology Lead (Fleet Administrator, demo lens) | O1 Control Tower triage over fleet under management | PASS — severity-ordered needs-attention stream, counters, recent activity | "CRITICAL — Disk encryption is disabled … Remediation proposal drafted — approval required"
46. HOS-MD | Service Desk persona (demo lens) | O2 Device Doctor diagnosis | BLOCKED — lane placeholder | "doctor — not yet composed in this runtime"
47. HOS-MD | Security & Compliance persona (demo lens) | O3 Security-incident response: finding -> Guardian decision -> approval -> action | PARTIAL — finding inspect + proposal + evidence view PASS; remediation walk BLOCKED; approval click INERT | "SecurityRemediationIntent … No direct-execution path exists on this surface"; after Approve click badge still "Approvals inbox: 1 pending"
48. HOS-MD | Asset & Procurement persona (demo lens) | O4 Procurement cycle: workload planning -> recommendation -> vendor quote | BLOCKED — lanes placeholders | "planning — not yet composed in this runtime"; "procurement — not yet composed in this runtime"
49. HOS-MD | Ben Ortiz — Ops Technology Lead (Fleet Administrator, demo lens) | O5 Lost-device recovery drill incl. gated destructive attempt | BLOCKED — recovery lane placeholder; gated revoke click INERT | "cases — not yet composed in this runtime"; "Revoke the device's trust (requires authorization)" -> INERT-no-change
50. HOS-MD | Security & Compliance persona (demo lens) | O6 Audit/evidence pull + deterministic global search | PASS — evidence trail index, per-record chains with opaque refs; search deterministic | "Every consequential record with an audit trail — approvals, recoveries, enrollments, commerce decisions."; "matched keyword exact — pln_fb564c1e"; "search semantics are deterministic (W061 contract)"
51. HOS-SM | Ivy Chen — Owner (Fleet Administrator) | J1 Workspace provisioning + onboarding rail | PASS — workspace created via real signup; honest empty state | - StaticText "Nothing needs your attention right now"
52. HOS-SM | Ivy Chen — Owner (Fleet Administrator) | J2 Device lifecycle — Install Center enrollment code drill + gated destructive attempt | PASS — code issued, display-once held; revoke/disable gated, click yields no dialog | code BOOT-W101-0001; "The console stores only a verifier; this code cannot be shown again."; "A destructive action: it requires an explicit policy grant and leaves an evidence trail."
53. HOS-SM | Leo Garnier — AV & Bar Technician | J3 Invite + join + role assignment | PASS — one-time join code redeemed, role lens + console role assigned | lens=Service role=operator; "Joining with a role sets your starting role assignment… fleet.admin and vendor.operator are not offered here"
54. HOS-SM | Ivy Chen — Owner (Fleet Administrator) | J4 Session persistence + sign-out + password sign-in | PASS — session survives reload; password sign-in restores owner role | role=owner after password sign-in
55. HOS-SM | Ivy Chen — Owner (Fleet Administrator, demo lens) | O1 Control Tower triage over fleet under management | PASS — severity-ordered needs-attention stream, counters, recent activity | "CRITICAL — Disk encryption is disabled … Remediation proposal drafted — approval required"
56. HOS-SM | Service Desk persona (demo lens) | O2 Device Doctor diagnosis | BLOCKED — lane placeholder | "doctor — not yet composed in this runtime"
57. HOS-SM | Security & Compliance persona (demo lens) | O3 Security-incident response: finding -> Guardian decision -> approval -> action | PARTIAL — finding inspect + proposal + evidence view PASS; remediation walk BLOCKED; approval click INERT | "SecurityRemediationIntent … No direct-execution path exists on this surface"; after Approve click badge still "Approvals inbox: 1 pending"
58. HOS-SM | Asset & Procurement persona (demo lens) | O4 Procurement cycle: workload planning -> recommendation -> vendor quote | BLOCKED — lanes placeholders | "planning — not yet composed in this runtime"; "procurement — not yet composed in this runtime"
59. HOS-SM | Ivy Chen — Owner (Fleet Administrator, demo lens) | O5 Lost-device recovery drill incl. gated destructive attempt | BLOCKED — recovery lane placeholder; gated revoke click INERT | "cases — not yet composed in this runtime"; "Revoke the device's trust (requires authorization)" -> INERT-no-change
60. HOS-SM | Security & Compliance persona (demo lens) | O6 Audit/evidence pull + deterministic global search | PASS — evidence trail index, per-record chains with opaque refs; search deterministic | "Every consequential record with an audit trail — approvals, recoveries, enrollments, commerce decisions."; "matched keyword exact — pln_fb564c1e"; "search semantics are deterministic (W061 contract)"
61. FEM-LG | Talia Bernstein — Director of Production Technology (Fleet Administrator) | J1 Workspace provisioning + onboarding rail | PASS — workspace created via real signup; honest empty state | - StaticText "Nothing needs your attention right now"
62. FEM-LG | Talia Bernstein — Director of Production Technology (Fleet Administrator) | J2 Device lifecycle — Install Center enrollment code drill + gated destructive attempt | PASS — code issued, display-once held; revoke/disable gated, click yields no dialog | code BOOT-W101-0001; "The console stores only a verifier; this code cannot be shown again."; "A destructive action: it requires an explicit policy grant and leaves an evidence trail."
63. FEM-LG | Marco Ruiz — Post-Production Support Engineer | J3 Invite + join + role assignment | PASS — one-time join code redeemed, role lens + console role assigned | lens=Service role=operator; "Joining with a role sets your starting role assignment… fleet.admin and vendor.operator are not offered here"
64. FEM-LG | Talia Bernstein — Director of Production Technology (Fleet Administrator) | J4 Session persistence + sign-out + password sign-in | PASS — session survives reload; password sign-in restores owner role | role=owner after password sign-in
65. FEM-LG | Talia Bernstein — Director of Production Technology (Fleet Administrator, demo lens) | O1 Control Tower triage over fleet under management | PASS — severity-ordered needs-attention stream, counters, recent activity | "CRITICAL — Disk encryption is disabled … Remediation proposal drafted — approval required"
66. FEM-LG | Service Desk persona (demo lens) | O2 Device Doctor diagnosis | BLOCKED — lane placeholder | "doctor — not yet composed in this runtime"
67. FEM-LG | Security & Compliance persona (demo lens) | O3 Security-incident response: finding -> Guardian decision -> approval -> action | PARTIAL — finding inspect + proposal + evidence view PASS; remediation walk BLOCKED; approval click INERT | "SecurityRemediationIntent … No direct-execution path exists on this surface"; after Approve click badge still "Approvals inbox: 1 pending"
68. FEM-LG | Asset & Procurement persona (demo lens) | O4 Procurement cycle: workload planning -> recommendation -> vendor quote | BLOCKED — lanes placeholders | "planning — not yet composed in this runtime"; "procurement — not yet composed in this runtime"
69. FEM-LG | Talia Bernstein — Director of Production Technology (Fleet Administrator, demo lens) | O5 Lost-device recovery drill incl. gated destructive attempt | BLOCKED — recovery lane placeholder; gated revoke click INERT | "cases — not yet composed in this runtime"; "Revoke the device's trust (requires authorization)" -> INERT-no-change
70. FEM-LG | Security & Compliance persona (demo lens) | O6 Audit/evidence pull + deterministic global search | PASS — evidence trail index, per-record chains with opaque refs; search deterministic | "Every consequential record with an audit trail — approvals, recoveries, enrollments, commerce decisions."; "matched keyword exact — pln_fb564c1e"; "search semantics are deterministic (W061 contract)"
71. FEM-MD | Odile Marchand — Head of Studio Technology (Fleet Administrator) | J1 Workspace provisioning + onboarding rail | PASS — workspace created via real signup; honest empty state | - StaticText "Nothing needs your attention right now"
72. FEM-MD | Odile Marchand — Head of Studio Technology (Fleet Administrator) | J2 Device lifecycle — Install Center enrollment code drill + gated destructive attempt | PASS — code issued, display-once held; revoke/disable gated, click yields no dialog | code BOOT-W101-0001; "The console stores only a verifier; this code cannot be shown again."; "A destructive action: it requires an explicit policy grant and leaves an evidence trail."
73. FEM-MD | Theo Lindqvist — Sample-Room IT Specialist | J3 Invite + join + role assignment | PASS — one-time join code redeemed, role lens + console role assigned | lens=Asset role=operator; "Joining with a role sets your starting role assignment… fleet.admin and vendor.operator are not offered here"
74. FEM-MD | Odile Marchand — Head of Studio Technology (Fleet Administrator) | J4 Session persistence + sign-out + password sign-in | PASS — session survives reload; password sign-in restores owner role | role=owner after password sign-in
75. FEM-MD | Odile Marchand — Head of Studio Technology (Fleet Administrator, demo lens) | O1 Control Tower triage over fleet under management | PASS — severity-ordered needs-attention stream, counters, recent activity | "CRITICAL — Disk encryption is disabled … Remediation proposal drafted — approval required"
76. FEM-MD | Service Desk persona (demo lens) | O2 Device Doctor diagnosis | BLOCKED — lane placeholder | "doctor — not yet composed in this runtime"
77. FEM-MD | Security & Compliance persona (demo lens) | O3 Security-incident response: finding -> Guardian decision -> approval -> action | PARTIAL — finding inspect + proposal + evidence view PASS; remediation walk BLOCKED; approval click INERT | "SecurityRemediationIntent … No direct-execution path exists on this surface"; after Approve click badge still "Approvals inbox: 1 pending"
78. FEM-MD | Asset & Procurement persona (demo lens) | O4 Procurement cycle: workload planning -> recommendation -> vendor quote | BLOCKED — lanes placeholders | "planning — not yet composed in this runtime"; "procurement — not yet composed in this runtime"
79. FEM-MD | Odile Marchand — Head of Studio Technology (Fleet Administrator, demo lens) | O5 Lost-device recovery drill incl. gated destructive attempt | BLOCKED — recovery lane placeholder; gated revoke click INERT | "cases — not yet composed in this runtime"; "Revoke the device's trust (requires authorization)" -> INERT-no-change
80. FEM-MD | Security & Compliance persona (demo lens) | O6 Audit/evidence pull + deterministic global search | PASS — evidence trail index, per-record chains with opaque refs; search deterministic | "Every consequential record with an audit trail — approvals, recoveries, enrollments, commerce decisions."; "matched keyword exact — pln_fb564c1e"; "search semantics are deterministic (W061 contract)"
81. FEM-SM | Priya Nair — Founder/Executive Producer (Fleet Administrator) | J1 Workspace provisioning + onboarding rail | PASS — workspace created via real signup; honest empty state | - StaticText "Nothing needs your attention right now"
82. FEM-SM | Priya Nair — Founder/Executive Producer (Fleet Administrator) | J2 Device lifecycle — Install Center enrollment code drill + gated destructive attempt | PASS — code issued, display-once held; revoke/disable gated, click yields no dialog | code BOOT-W101-0001; "The console stores only a verifier; this code cannot be shown again."; "A destructive action: it requires an explicit policy grant and leaves an evidence trail."
83. FEM-SM | Dan Mercer — Editor/Colorist | J3 Invite + join + role assignment | PASS — one-time join code redeemed, role lens + console role assigned | lens=Employee role=viewer; "Joining with a role sets your starting role assignment… fleet.admin and vendor.operator are not offered here"
84. FEM-SM | Priya Nair — Founder/Executive Producer (Fleet Administrator) | J4 Session persistence + sign-out + password sign-in | PASS — session survives reload; password sign-in restores owner role | role=owner after password sign-in
85. FEM-SM | Priya Nair — Founder/Executive Producer (Fleet Administrator, demo lens) | O1 Control Tower triage over fleet under management | PASS — severity-ordered needs-attention stream, counters, recent activity | "CRITICAL — Disk encryption is disabled … Remediation proposal drafted — approval required"
86. FEM-SM | Service Desk persona (demo lens) | O2 Device Doctor diagnosis | BLOCKED — lane placeholder | "doctor — not yet composed in this runtime"
87. FEM-SM | Security & Compliance persona (demo lens) | O3 Security-incident response: finding -> Guardian decision -> approval -> action | PARTIAL — finding inspect + proposal + evidence view PASS; remediation walk BLOCKED; approval click INERT | "SecurityRemediationIntent … No direct-execution path exists on this surface"; after Approve click badge still "Approvals inbox: 1 pending"
88. FEM-SM | Asset & Procurement persona (demo lens) | O4 Procurement cycle: workload planning -> recommendation -> vendor quote | BLOCKED — lanes placeholders | "planning — not yet composed in this runtime"; "procurement — not yet composed in this runtime"
89. FEM-SM | Priya Nair — Founder/Executive Producer (Fleet Administrator, demo lens) | O5 Lost-device recovery drill incl. gated destructive attempt | BLOCKED — recovery lane placeholder; gated revoke click INERT | "cases — not yet composed in this runtime"; "Revoke the device's trust (requires authorization)" -> INERT-no-change
90. FEM-SM | Security & Compliance persona (demo lens) | O6 Audit/evidence pull + deterministic global search | PASS — evidence trail index, per-record chains with opaque refs; search deterministic | "Every consequential record with an audit trail — approvals, recoveries, enrollments, commerce decisions."; "matched keyword exact — pln_fb564c1e"; "search semantics are deterministic (W061 contract)"
91. LEG-LG | Robert Chen — Director of IT (Fleet Administrator) | J1 Workspace provisioning + onboarding rail | PASS — workspace created via real signup; honest empty state | - StaticText "Nothing needs your attention right now"
92. LEG-LG | Robert Chen — Director of IT (Fleet Administrator) | J2 Device lifecycle — Install Center enrollment code drill + gated destructive attempt | PASS — code issued, display-once held; revoke/disable gated, click yields no dialog | code BOOT-W101-0001; "The console stores only a verifier; this code cannot be shown again."; "A destructive action: it requires an explicit policy grant and leaves an evidence trail."
93. LEG-LG | Dana Whitfield — Service Desk Analyst | J3 Invite + join + role assignment | PASS — one-time join code redeemed, role lens + console role assigned | lens=Service role=operator; "Joining with a role sets your starting role assignment… fleet.admin and vendor.operator are not offered here"
94. LEG-LG | Robert Chen — Director of IT (Fleet Administrator) | J4 Session persistence + sign-out + password sign-in | PASS — session survives reload; password sign-in restores owner role | role=owner after password sign-in
95. LEG-LG | Robert Chen — Director of IT (Fleet Administrator, demo lens) | O1 Control Tower triage over fleet under management | PASS — severity-ordered needs-attention stream, counters, recent activity | "CRITICAL — Disk encryption is disabled … Remediation proposal drafted — approval required"
96. LEG-LG | Service Desk persona (demo lens) | O2 Device Doctor diagnosis | BLOCKED — lane placeholder | "doctor — not yet composed in this runtime"
97. LEG-LG | Security & Compliance persona (demo lens) | O3 Security-incident response: finding -> Guardian decision -> approval -> action | PARTIAL — finding inspect + proposal + evidence view PASS; remediation walk BLOCKED; approval click INERT | "SecurityRemediationIntent … No direct-execution path exists on this surface"; after Approve click badge still "Approvals inbox: 1 pending"
98. LEG-LG | Asset & Procurement persona (demo lens) | O4 Procurement cycle: workload planning -> recommendation -> vendor quote | BLOCKED — lanes placeholders | "planning — not yet composed in this runtime"; "procurement — not yet composed in this runtime"
99. LEG-LG | Robert Chen — Director of IT (Fleet Administrator, demo lens) | O5 Lost-device recovery drill incl. gated destructive attempt | BLOCKED — recovery lane placeholder; gated revoke click INERT | "cases — not yet composed in this runtime"; "Revoke the device's trust (requires authorization)" -> INERT-no-change
100. LEG-LG | Security & Compliance persona (demo lens) | O6 Audit/evidence pull + deterministic global search | PASS — evidence trail index, per-record chains with opaque refs; search deterministic | "Every consequential record with an audit trail — approvals, recoveries, enrollments, commerce decisions."; "matched keyword exact — pln_fb564c1e"; "search semantics are deterministic (W061 contract)"
101. LEG-MD | Amara Diallo — Managing Attorney / IT Lead (Fleet Administrator) | J1 Workspace provisioning + onboarding rail | PASS — workspace created via real signup; honest empty state | - StaticText "Nothing needs your attention right now"
102. LEG-MD | Amara Diallo — Managing Attorney / IT Lead (Fleet Administrator) | J2 Device lifecycle — Install Center enrollment code drill + gated destructive attempt | PASS — code issued, display-once held; revoke/disable gated, click yields no dialog | code BOOT-W101-0001; "The console stores only a verifier; this code cannot be shown again."; "A destructive action: it requires an explicit policy grant and leaves an evidence trail."
103. LEG-MD | Peter Vance — Compliance & Risk Officer | J3 Invite + join + role assignment | PASS — one-time join code redeemed, role lens + console role assigned | lens=Security role=approver; "Joining with a role sets your starting role assignment… fleet.admin and vendor.operator are not offered here"
104. LEG-MD | Amara Diallo — Managing Attorney / IT Lead (Fleet Administrator) | J4 Session persistence + sign-out + password sign-in | PASS — session survives reload; password sign-in restores owner role | role=owner after password sign-in
105. LEG-MD | Amara Diallo — Managing Attorney / IT Lead (Fleet Administrator, demo lens) | O1 Control Tower triage over fleet under management | PASS — severity-ordered needs-attention stream, counters, recent activity | "CRITICAL — Disk encryption is disabled … Remediation proposal drafted — approval required"
106. LEG-MD | Service Desk persona (demo lens) | O2 Device Doctor diagnosis | BLOCKED — lane placeholder | "doctor — not yet composed in this runtime"
107. LEG-MD | Security & Compliance persona (demo lens) | O3 Security-incident response: finding -> Guardian decision -> approval -> action | PARTIAL — finding inspect + proposal + evidence view PASS; remediation walk BLOCKED; approval click INERT | "SecurityRemediationIntent … No direct-execution path exists on this surface"; after Approve click badge still "Approvals inbox: 1 pending"
108. LEG-MD | Asset & Procurement persona (demo lens) | O4 Procurement cycle: workload planning -> recommendation -> vendor quote | BLOCKED — lanes placeholders | "planning — not yet composed in this runtime"; "procurement — not yet composed in this runtime"
109. LEG-MD | Amara Diallo — Managing Attorney / IT Lead (Fleet Administrator, demo lens) | O5 Lost-device recovery drill incl. gated destructive attempt | BLOCKED — recovery lane placeholder; gated revoke click INERT | "cases — not yet composed in this runtime"; "Revoke the device's trust (requires authorization)" -> INERT-no-change
110. LEG-MD | Security & Compliance persona (demo lens) | O6 Audit/evidence pull + deterministic global search | PASS — evidence trail index, per-record chains with opaque refs; search deterministic | "Every consequential record with an audit trail — approvals, recoveries, enrollments, commerce decisions."; "matched keyword exact — pln_fb564c1e"; "search semantics are deterministic (W061 contract)"
111. LEG-SM | Nora Ellis — Managing Partner (Fleet Administrator) | J1 Workspace provisioning + onboarding rail | PASS — workspace created via real signup; honest empty state | - StaticText "Nothing needs your attention right now"
112. LEG-SM | Nora Ellis — Managing Partner (Fleet Administrator) | J2 Device lifecycle — Install Center enrollment code drill + gated destructive attempt | PASS — code issued, display-once held; revoke/disable gated, click yields no dialog | code BOOT-W101-0001; "The console stores only a verifier; this code cannot be shown again."; "A destructive action: it requires an explicit policy grant and leaves an evidence trail."
113. LEG-SM | Sam Rutledge — Office Manager | J3 Invite + join + role assignment | PASS — one-time join code redeemed, role lens + console role assigned | lens=Team role=approver; "Joining with a role sets your starting role assignment… fleet.admin and vendor.operator are not offered here"
114. LEG-SM | Nora Ellis — Managing Partner (Fleet Administrator) | J4 Session persistence + sign-out + password sign-in | PASS — session survives reload; password sign-in restores owner role | role=owner after password sign-in
115. LEG-SM | Nora Ellis — Managing Partner (Fleet Administrator, demo lens) | O1 Control Tower triage over fleet under management | PASS — severity-ordered needs-attention stream, counters, recent activity | "CRITICAL — Disk encryption is disabled … Remediation proposal drafted — approval required"
116. LEG-SM | Service Desk persona (demo lens) | O2 Device Doctor diagnosis | BLOCKED — lane placeholder | "doctor — not yet composed in this runtime"
117. LEG-SM | Security & Compliance persona (demo lens) | O3 Security-incident response: finding -> Guardian decision -> approval -> action | PARTIAL — finding inspect + proposal + evidence view PASS; remediation walk BLOCKED; approval click INERT | "SecurityRemediationIntent … No direct-execution path exists on this surface"; after Approve click badge still "Approvals inbox: 1 pending"
118. LEG-SM | Asset & Procurement persona (demo lens) | O4 Procurement cycle: workload planning -> recommendation -> vendor quote | BLOCKED — lanes placeholders | "planning — not yet composed in this runtime"; "procurement — not yet composed in this runtime"
119. LEG-SM | Nora Ellis — Managing Partner (Fleet Administrator, demo lens) | O5 Lost-device recovery drill incl. gated destructive attempt | BLOCKED — recovery lane placeholder; gated revoke click INERT | "cases — not yet composed in this runtime"; "Revoke the device's trust (requires authorization)" -> INERT-no-change
120. LEG-SM | Security & Compliance persona (demo lens) | O6 Audit/evidence pull + deterministic global search | PASS — evidence trail index, per-record chains with opaque refs; search deterministic | "Every consequential record with an audit trail — approvals, recoveries, enrollments, commerce decisions."; "matched keyword exact — pln_fb564c1e"; "search semantics are deterministic (W061 contract)"
121. DEF-LG | David Hargrove — IT Fleet Director (Col., Ret.) (Fleet Administrator) | J1 Workspace provisioning + onboarding rail | PASS — workspace created via real signup; honest empty state | - StaticText "Nothing needs your attention right now"
122. DEF-LG | David Hargrove — IT Fleet Director (Col., Ret.) (Fleet Administrator) | J2 Device lifecycle — Install Center enrollment code drill + gated destructive attempt | PASS — code issued, display-once held; revoke/disable gated, click yields no dialog | code BOOT-W101-0001; "The console stores only a verifier; this code cannot be shown again."; "A destructive action: it requires an explicit policy grant and leaves an evidence trail."
123. DEF-LG | Mick Torres — Systems Technician | J3 Invite + join + role assignment | PASS — one-time join code redeemed, role lens + console role assigned | lens=Service role=operator; "Joining with a role sets your starting role assignment… fleet.admin and vendor.operator are not offered here"
124. DEF-LG | David Hargrove — IT Fleet Director (Col., Ret.) (Fleet Administrator) | J4 Session persistence + sign-out + password sign-in | PASS — session survives reload; password sign-in restores owner role | role=owner after password sign-in
125. DEF-LG | David Hargrove — IT Fleet Director (Col., Ret.) (Fleet Administrator, demo lens) | O1 Control Tower triage over fleet under management | PASS — severity-ordered needs-attention stream, counters, recent activity | "CRITICAL — Disk encryption is disabled … Remediation proposal drafted — approval required"
126. DEF-LG | Service Desk persona (demo lens) | O2 Device Doctor diagnosis | BLOCKED — lane placeholder | "doctor — not yet composed in this runtime"
127. DEF-LG | Security & Compliance persona (demo lens) | O3 Security-incident response: finding -> Guardian decision -> approval -> action | PARTIAL — finding inspect + proposal + evidence view PASS; remediation walk BLOCKED; approval click INERT | "SecurityRemediationIntent … No direct-execution path exists on this surface"; after Approve click badge still "Approvals inbox: 1 pending"
128. DEF-LG | Asset & Procurement persona (demo lens) | O4 Procurement cycle: workload planning -> recommendation -> vendor quote | BLOCKED — lanes placeholders | "planning — not yet composed in this runtime"; "procurement — not yet composed in this runtime"
129. DEF-LG | David Hargrove — IT Fleet Director (Col., Ret.) (Fleet Administrator, demo lens) | O5 Lost-device recovery drill incl. gated destructive attempt | BLOCKED — recovery lane placeholder; gated revoke click INERT | "cases — not yet composed in this runtime"; "Revoke the device's trust (requires authorization)" -> INERT-no-change
130. DEF-LG | Security & Compliance persona (demo lens) | O6 Audit/evidence pull + deterministic global search | PASS — evidence trail index, per-record chains with opaque refs; search deterministic | "Every consequential record with an audit trail — approvals, recoveries, enrollments, commerce decisions."; "matched keyword exact — pln_fb564c1e"; "search semantics are deterministic (W061 contract)"
131. DEF-MD | Rachel Stone — Director of Technology (Fleet Administrator) | J1 Workspace provisioning + onboarding rail | PASS — workspace created via real signup; honest empty state | - StaticText "Nothing needs your attention right now"
132. DEF-MD | Rachel Stone — Director of Technology (Fleet Administrator) | J2 Device lifecycle — Install Center enrollment code drill + gated destructive attempt | PASS — code issued, display-once held; revoke/disable gated, click yields no dialog | code BOOT-W101-0001; "The console stores only a verifier; this code cannot be shown again."; "A destructive action: it requires an explicit policy grant and leaves an evidence trail."
133. DEF-MD | Vic Alonso — Fleet & Equipment Coordinator | J3 Invite + join + role assignment | PASS — one-time join code redeemed, role lens + console role assigned | lens=Asset role=operator; "Joining with a role sets your starting role assignment… fleet.admin and vendor.operator are not offered here"
134. DEF-MD | Rachel Stone — Director of Technology (Fleet Administrator) | J4 Session persistence + sign-out + password sign-in | PASS — session survives reload; password sign-in restores owner role | role=owner after password sign-in
135. DEF-MD | Rachel Stone — Director of Technology (Fleet Administrator, demo lens) | O1 Control Tower triage over fleet under management | PASS — severity-ordered needs-attention stream, counters, recent activity | "CRITICAL — Disk encryption is disabled … Remediation proposal drafted — approval required"
136. DEF-MD | Service Desk persona (demo lens) | O2 Device Doctor diagnosis | BLOCKED — lane placeholder | "doctor — not yet composed in this runtime"
137. DEF-MD | Security & Compliance persona (demo lens) | O3 Security-incident response: finding -> Guardian decision -> approval -> action | PARTIAL — finding inspect + proposal + evidence view PASS; remediation walk BLOCKED; approval click INERT | "SecurityRemediationIntent … No direct-execution path exists on this surface"; after Approve click badge still "Approvals inbox: 1 pending"
138. DEF-MD | Asset & Procurement persona (demo lens) | O4 Procurement cycle: workload planning -> recommendation -> vendor quote | BLOCKED — lanes placeholders | "planning — not yet composed in this runtime"; "procurement — not yet composed in this runtime"
139. DEF-MD | Rachel Stone — Director of Technology (Fleet Administrator, demo lens) | O5 Lost-device recovery drill incl. gated destructive attempt | BLOCKED — recovery lane placeholder; gated revoke click INERT | "cases — not yet composed in this runtime"; "Revoke the device's trust (requires authorization)" -> INERT-no-change
140. DEF-MD | Security & Compliance persona (demo lens) | O6 Audit/evidence pull + deterministic global search | PASS — evidence trail index, per-record chains with opaque refs; search deterministic | "Every consequential record with an audit trail — approvals, recoveries, enrollments, commerce decisions."; "matched keyword exact — pln_fb564c1e"; "search semantics are deterministic (W061 contract)"
141. DEF-SM | Grant Whitmore — Principal Consultant (Fleet Administrator) | J1 Workspace provisioning + onboarding rail | PASS — workspace created via real signup; honest empty state | - StaticText "Nothing needs your attention right now"
142. DEF-SM | Grant Whitmore — Principal Consultant (Fleet Administrator) | J2 Device lifecycle — Install Center enrollment code drill + gated destructive attempt | PASS — code issued, display-once held; revoke/disable gated, click yields no dialog | code BOOT-W101-0001; "The console stores only a verifier; this code cannot be shown again."; "A destructive action: it requires an explicit policy grant and leaves an evidence trail."
143. DEF-SM | Erica Nash — Compliance Lead | J3 Invite + join + role assignment | PASS — one-time join code redeemed, role lens + console role assigned | lens=Security role=approver; "Joining with a role sets your starting role assignment… fleet.admin and vendor.operator are not offered here"
144. DEF-SM | Grant Whitmore — Principal Consultant (Fleet Administrator) | J4 Session persistence + sign-out + password sign-in | PASS — session survives reload; password sign-in restores owner role | role=owner after password sign-in
145. DEF-SM | Grant Whitmore — Principal Consultant (Fleet Administrator, demo lens) | O1 Control Tower triage over fleet under management | PASS — severity-ordered needs-attention stream, counters, recent activity | "CRITICAL — Disk encryption is disabled … Remediation proposal drafted — approval required"
146. DEF-SM | Service Desk persona (demo lens) | O2 Device Doctor diagnosis | BLOCKED — lane placeholder | "doctor — not yet composed in this runtime"
147. DEF-SM | Security & Compliance persona (demo lens) | O3 Security-incident response: finding -> Guardian decision -> approval -> action | PARTIAL — finding inspect + proposal + evidence view PASS; remediation walk BLOCKED; approval click INERT | "SecurityRemediationIntent … No direct-execution path exists on this surface"; after Approve click badge still "Approvals inbox: 1 pending"
148. DEF-SM | Asset & Procurement persona (demo lens) | O4 Procurement cycle: workload planning -> recommendation -> vendor quote | BLOCKED — lanes placeholders | "planning — not yet composed in this runtime"; "procurement — not yet composed in this runtime"
149. DEF-SM | Grant Whitmore — Principal Consultant (Fleet Administrator, demo lens) | O5 Lost-device recovery drill incl. gated destructive attempt | BLOCKED — recovery lane placeholder; gated revoke click INERT | "cases — not yet composed in this runtime"; "Revoke the device's trust (requires authorization)" -> INERT-no-change
150. DEF-SM | Security & Compliance persona (demo lens) | O6 Audit/evidence pull + deterministic global search | PASS — evidence trail index, per-record chains with opaque refs; search deterministic | "Every consequential record with an audit trail — approvals, recoveries, enrollments, commerce decisions."; "matched keyword exact — pln_fb564c1e"; "search semantics are deterministic (W061 contract)"

---

## 9. Aggregate numbers

| Metric | Count |
|---|---|
| Industries simulated | 5 (Transportation, Hospitality, Fashion/Ent/Media, Legal, Defense/Security) |
| Firms simulated (real workspaces created via real signup) | 15 (5 LARGE, 5 MEDIUM, 5 SMALL) |
| Personas simulated | 105 (7 product roles × 15 firms; SMALL firms dual-hat, noted in tables) |
| Executed project journeys | **150** (10 per firm; every firm at/above its size minimum of 10/7/5) |
| Mobile passes at 390×844 | 7 recorded (≥1 per industry, incl. 2 on real workspaces) |
| **SWITCH-ONLY** | **0 (0% of personas)** |
| **MAIN-INTERFACE** | **0 (0% of personas)** |
| **RETAIN incumbent** | **105 (100% of personas)** |

Journey outcome tally (per-journey outcomes across the 150 executions):
- J1 provisioning: 15/15 PASS (all real workspaces created; honest empty states recorded).
- J2 enrollment-code drill: 15/15 PASS (display-once held; gated destructive ATTEMPTED each time — click produced no dialog in all 15).
- J3 invite/join/role: 13 PASS, 1 DEFECT (TRN-LG: member created in wrong tenant), 1 BLOCKED (TRN-MD: silent empty-alert failure).
- J4 persistence + sign-in: 15/15 PASS.
- O1 Control Tower triage: 15/15 PASS (over the demo fleet — the only fleet data that exists).
- O2 Device Doctor: 15/15 BLOCKED (placeholder).
- O3 finding → Guardian → approval → action: 15/15 PARTIAL (view passes; walk BLOCKED; approval INERT — badge unchanged in all 15).
- O4 workload → procurement → vendor quote: 15/15 BLOCKED (both lanes placeholders).
- O5 recovery drill + gated destructive: 15/15 BLOCKED (recovery placeholder; revoke INERT).
- O6 evidence pull + deterministic search: 15/15 PASS.

---

## 10. Honest blockers list (as implemented, all verified live)

1. **Six of ten lanes are runtime placeholders** — Device Doctor, Security Doctor remediation walk, Recovery, Fleet Actions plans, Workloads planning, Commerce procurement. Verbatim: "not yet composed in this runtime … the runtime binding for this view arrives with the lane composition work." No credit given for roadmap.
2. **No real control plane** — all state is client-side `localStorage`; consequential clicks emit zero network requests; enrollment verification stays "unbootstrapped — waiting" forever. No real device can ever be enrolled, so no real fleet data can exist. This alone caps every persona at RETAIN.
3. **Approval decision controls are inert** — Approve/Reject on the parked plan produce no dialog, no request, no state change ("Approvals inbox: 1 pending" unchanged across 15 sweeps + repeated manual attempts as admin and service desk). The product's best differentiator is un-actionable.
4. **Gated destructive controls are inert without feedback** — "Disable the enrollment code…" and "Revoke the device's trust…" are correctly labeled and gated in copy, but clicking them yields no confirmation flow, no error, no audit entry.
5. **Cross-tenant join-code collision (defect)** — every workspace's first invite code is the same string (`joinw10100000001`); a member invited to SIMB-TRN-LG was created as a principal in the shared DEMO tenant, and the next firm's join failed silently with an empty `<alert>` (no error message).
6. **No manual data entry or import** — a fresh workspace is permanently empty ("No devices are enrolled yet"); SMALL firms without an agent path (i.e., all of them, given #2) cannot start.
7. **Vendor role silent denial** — a viewer-role vendor clicking "Create enrollment code" gets no code and no explanation.
8. **Mobile table overflow** — device roster is ~993px wide at 390px viewport; usable via horizontal page scroll, but not comfortable for field use.
9. **Deterministic, predictable codes** — enrollment code `BOOT-W101-0001` and join code `joinw10100000001` are sequence-generated and identical across workspaces/sessions; unacceptable for security-sensitive buyers (esp. Defense).

## 11. Improvement asks ranked by adoption impact

1. **Compose the six runtime lanes** (Device Doctor, Security Doctor walk, Recovery, Fleet Actions, Workloads, Commerce). This is the single unlock between 0% and any adoption at all; the honest placeholders are already the best-behaved empty states in the industry, but empty is still empty.
2. **Put the control plane server-side** — server-issued sessions and verifiers, real agent check-in endpoint, high-entropy scoped codes. Without a path for real devices to report in, no persona in any industry can adopt, ever.
3. **Make Approve/Reject actually execute** through the already-designed confirmation + audit path. The approvals model ("parked first, decided by an owner, never auto-promoted") is the product's most differentiated, defensible surface — currently unreachable.
4. **Fix join-code uniqueness and error surfacing** — tenant-scoped high-entropy codes; replace the silent empty alert with an explicit redemption error; prevent cross-tenant principal creation.
5. **Add a declared-import path for device records** (clearly provenance-flagged) so SMALL firms can begin tracking before agent rollout — respecting the "real observations only" doctrine by marking declared vs observed records.
6. **Explain denials at the UI for restricted roles** (vendor/viewer): a single toast would convert silent no-ops into learnable RBAC.
7. **Mobile priority columns or card layout for the device roster** below ~480px.

## 12. Methodology & honesty notes

- USER-ONLY: every interaction above happened through the live site in a browser (headless Chromium driven by the agent-browser CLI). The FleetOS repository was cloned solely to deliver this report to branch `sim/sim-b`; no source files were read or modified.
- AS-IMPLEMENTED: placeholders that self-describe as "not yet composed in this runtime" are recorded as BLOCKED, not as fail-closed breakage; honest empty states ("No records yet") in fresh workspaces are recorded as correct product behavior, not bugs — their effect on adoption (an empty product cannot be a daily interface) is nonetheless real and counted.
- HONEST NUMBERS: 0/0/105 is the verdict the evidence supports. It is harsh; it is not sandbagging — the strongest working surfaces (identity, RBAC lenses, Install Center display-once codes, evidence trails, deterministic search) are genuinely excellent, but none of them constitutes a daily workflow for any of the 105 personas while the operational lanes are placeholders and no real device can ever check in.
- Demo-persona journeys used the shared demo fleet (the only fleet data that exists in the product today); real-workspace journeys used each firm's own credentials. One browser session per firm (isolated localStorage) after the join-code collision was discovered; TRN-LG and TRN-MD were executed in the shared default session before that workaround, which is precisely what exposed the cross-tenant defect.
