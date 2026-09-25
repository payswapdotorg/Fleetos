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