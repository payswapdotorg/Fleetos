Wave 0 - Tech Lead only
W001 -> W002 -> W003

Wave 1 - all three workers in parallel
W002,W003 -> W010 [A] device agent/runtime contract
W002,W003 -> W011 [B] Device Twin + observation ingestion
W002 -> W012 [C] tenant/auth/audit foundations

Wave 2 - all three workers in parallel
W010,W011 -> W020 [A] endpoint adapter SDK
W011,W012 -> W021 [B] health + diagnosis
W002,W012 -> W022 [C] workload profiles + recommendations

Wave 3 - all three workers in parallel
W020 -> W030 [A] mobile + printer/copier adapter contracts
W021 -> W031 [B] Security Doctor + Contract Guardian
W022 -> W032 [C] procurement/vendor/software exchange

Wave 4 - all three workers in parallel
W030 -> W040 [A] recovery + Find My Device
W031 -> W041 [B] Fleet Actions + Print orchestration
W032 -> W042 [C] maintenance exchange + deadline aggregation

Wave 5 - all three workers in parallel
W031,W042 -> W050A [A] ADCOS adapter
W002,W003 -> W050B [B] Arena adapter
W032 -> W050C [C] Aurum adapter
W050A,W050B,W050C -> W051 [TL] integration convergence

Wave 6 - all three workers in parallel
W021,W031,W040 -> W060A [A] device/recovery UI surfaces
W031,W041 -> W060B [B] security/policy/action UI surfaces
W022,W032,W042,W050A,W050C -> W060C [C] workload/commerce/connectivity UI surfaces
W060A,W060B,W060C,W051 -> W061 [TL] Control Tower/journey convergence

Wave 7 - three lanes
W061 -> W070 [B] learning/evaluation + Arena adoption
W061 -> W071 [A] privacy/security/tenant hardening
W061 -> W072 [C] vendor/commercial outcome quality and reconciliation
W070,W071,W072 -> W080 [TL] production readiness

Rule: never activate more than one item per worker unless the Tech Lead records a justified split. Every active item has one owner and a disjoint file scope. A/B/C work consumes frozen shared contracts rather than editing them.

Wave 8 - rendered console, parallel workers
W061,W080 -> W090A [A] rendered Device/Recovery/Enrollment console
W061,W080 -> W090B [B] rendered Security/Policies/Actions/Learning console
W061,W080 -> W090C [C] rendered Workload/Commerce console
W090A,W090B,W090C -> W091 [TL] rendered Control Tower + journey convergence
W091,W080 -> W092 [TL] free-tier staging deployment + release rehearsal

Wave 8 rule: W090A/B/C may run concurrently on disjoint worker-owned UI packages. The Tech Lead owns the Next.js root runtime, cross-surface composition, shared design system, Evidence & Audit composition, deployment configuration and release acceptance.


Wave 9 - productization, all three workers in parallel
W080,W091,W092 -> W100A [A] installable agent + real enrollment
W080,W091 -> W100B [B] role-shaped security/action/learning experiences
W012,W091,W092 -> W100C [C] durable identity/session/role switching + workload/commerce + optional Apify

Wave 10 - Tech Lead convergence
W100A,W100B,W100C -> W101 [TL] product shell + auth/onboarding convergence
W101,W092,W100C -> W102 [TL] durable free-tier staging deployment
W101,W102 -> W103 [TL] UX operational simulation + final product acceptance

Wave 9 rule: W100A/B/C may run concurrently on the existing disjoint worker scopes. Shared role/session contracts that cross ownership boundaries are TL-owned and must be exposed as public seams rather than imported internals.

Wave 12 - Operator product directives (2026-10-01): real auth, demo accounts, Stripe-adapted UX
W120 -> W122 ; W121 -> W122
W120 [worker, TL-scope grant] Stripe-adapted design system (tokens + shell + chrome; visual language only, no logic, no auth screens)
W121 [worker, C-scope + shell grant] proper authentication: account credentials (sign-up/sign-in/sign-out with passwords through the identity seam), persistent browser sessions
W122 [worker, after W120+W121] demo accounts with quick links + strict demo-data isolation (demo records render ONLY in demo tenants)

Wave 12 rule: W120 and W121 run concurrently on disjoint files (W120 owns every .css file and the shell/chrome visual layer; W121 owns identity + the gate/session logic files and styles ONLY through existing fos-* classes). W122 dispatches on the merged W120+W121 tree.
