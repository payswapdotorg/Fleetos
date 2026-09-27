# @fleetos/integration-adcos

ADCOS integration adapter (W050A, lane A). Translates FleetOS
ConnectivityIntent into the typed, provider-neutral ADCOS request,
normalizes ADCOS-reported status/evidence into versioned FleetOS-visible
records, and policy-gates every consequential submission through the
W031 Contract Guardian. ADCOS owns network-native topology/path
execution; FleetOS owns fleet connectivity intent and device/workload
policy (`spec/ARCHITECTURE-LOCK.md` items 7-8).

## Ownership

Lane: `worker-a` (per `spec/worker-ownership.yaml`).

## Frozen spec source

spec/integration/ADCOS.md; spec/ARCHITECTURE-LOCK.md items 7-8;
spec/WORK-ITEM-DEPENDENCY-GRAPH.md W050A.

## Module map (W050A)

| Module | Deliverable | Purpose |
| --- | --- | --- |
| `src/outcomes.ts` | D1 | The canonical connectivity-outcome vocabulary (the four spec examples; unknown outcomes refused `unsupported_outcome`). |
| `src/request-model.ts` | D1 | The typed provider-neutral request model + requirement-profile validation (machine-stable refusals). |
| `src/translation.ts` | D1 | Forward translation: the FROZEN ConnectivityIntent envelope + requirements -> `AdcosConnectivityRequest` (deterministic digest). |
| `src/status-model.ts` | D1 | Reverse typed shapes: execution lifecycle, evidence-carrying measurements, degradation/failure taxonomies, termination, accepted-requirements echo + report validation/normalization. |
| `src/provider-boundary.ts` | D2 | The opaque `AdcosProviderHandle` + the provider-neutral plain-data boundary checks (denied-key denylist; enforced at runtime). |
| `src/transport-seam.ts` | D2 | The injected `AdcosTransportPort` (typed request/response; machine-stable provider-refusal taxonomy). |
| `src/inmemory-transport.ts` | D2 | The in-memory deterministic reference transport (invocation recording, programmed refusals; no network, no clock). |
| `src/policy-seam.ts` | D3a | The injected Contract Guardian evaluation seam (structural twin of `@fleetos/policy`'s engine types; the REAL engine is injected at the binding site, proven by test). |
| `src/submission.ts` | D3b | The submission record model (PROPOSED -> SUBMITTED / PARKED / REJECTED; PARKED -> APPROVED / REJECTED) + the tenant-partitioned store. |
| `src/submission-gate.ts` | D3c | The policy-gated submission flow: ALLOW/WARN submit, REQUIRE_APPROVAL parks, BLOCK rejects — NEVER auto-submit; human approval dispatches. |
| `src/adoption.ts` | D3d | The versioned append-only connectivity-record store + status adoption (idempotent by content digest), termination flows, the unmet-requirements diff. |
| `src/audit-seam.ts` | D4 | The injected audit sink (the W011/W021/W022/W031/W040/W041 pattern; structurally satisfied by `@fleetos/audit`'s sink adapter — proven by test into the hash-chained AuditLog). |

## Design invariants

- The frozen `ConnectivityIntentPayload` (`sourceDeviceId?`,
  `targetDeviceId?`, `outcome`) is consumed VERBATIM — never re-declared,
  never widened.
- Provider topology, native credentials and provider SDK objects NEVER
  cross the transport seam: the only provider-originated value type is
  the opaque `AdcosProviderHandle` (a branded string); everything else
  is provider-neutral plain data, checked at runtime
  (`isProviderNeutral`) and asserted by tests.
- No clock reads, no entropy, no network I/O: every timestamp is
  injected; identities and digests are deterministic (FNV-1a over
  canonical JSON).
- Zero runtime dependencies (typescript dev-dep only). No `any` in
  public signatures. Strict TS.
- Cross-lane imports: `src/` imports only `@fleetos/contracts` (the
  shared seam); the cross-lane binding proofs (the REAL policy engine,
  the REAL audit log, the REAL identity TenantContext) live in `test/`
  (outside the ownership gate's src/ scan — the W040-disclosed pattern)
  with `@fleetos/policy`, `@fleetos/audit` and `@fleetos/identity`
  declared as dev-dependencies for those test-side structural proofs.
