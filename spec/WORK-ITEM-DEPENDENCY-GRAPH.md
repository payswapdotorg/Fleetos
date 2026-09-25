# FleetOS Work Item Dependency Graph

Wave 0 - Tech Lead only
W001 -> W002 -> W003

Wave 1 - parallel
W002,W003 -> W010 [A] device agent/runtime contract
W002,W003 -> W011 [A] Device Twin + observation ingestion
W002 -> W012 [TL] tenant/auth/audit foundations

Wave 2 - parallel
W010,W011 -> W020 [A] endpoint adapter SDK
W011,W012 -> W021 [B] health + diagnosis
W002,W012 -> W022 [C] workload profiles + recommendations

Wave 3 - parallel
W020 -> W030 [A] mobile + printer/copier adapter contracts
W021 -> W031 [B] Security Doctor + Contract Guardian
W022 -> W032 [C] procurement/vendor/software exchange

Wave 4 - parallel
W030 -> W040 [A] recovery + Find My Device
W031 -> W041 [B] Fleet Actions + Print orchestration
W032 -> W042 [C] maintenance exchange + deadline aggregation

Wave 5
W040,W041,W042,W031,W032 -> W050 [TL] ADCOS/Arena/Aurum integrations

Wave 6
W021,W031,W040,W041,W042,W050 -> W060 [TL] Control Tower + major journeys

Wave 7
W060 -> W070 [B] learning/evaluation + Arena adoption
W060 -> W071 [A] privacy/security/tenant hardening
W070,W071 -> W080 [TL] production readiness

Rule: never activate more than one item per worker unless the Tech Lead records a justified split. Every active item has one owner and disjoint file scope.