# @fleetos/device-model

Device Twin schemas and invariants. Does not own OS/provider adapters.

## Ownership

Lane: `worker-b` (per `spec/worker-ownership.yaml`).

## W011 — Device Twin + observation ingestion

Implemented by W011 (branch `work/w011`, base `integration/wave0`). The
package is pure TypeScript with zero runtime dependencies: every function
is deterministic, every timestamp is injected by the caller (no clock
reads anywhere in the lane), and every failure is a tagged result —
nothing in the public API throws for domain flows.

### Module map

| Module | Deliverable | Contents |
|---|---|---|
| `src/identity.ts` | D1 | Enrollment record, tenant-scoped `DeviceIdentity` (DeviceId from `@fleetos/contracts`), ownership assignment with provenance (the four spec ownership types), and the lifecycle state machine as a pure transition function with illegal-transition rejection mapped onto the FleetError taxonomy. The transition table itself is the frozen `DEVICE_LIFECYCLE_TRANSITIONS` from contracts. |
| `src/twin.ts` | D2 | The `DeviceTwin` aggregate: the ten joined, composable, tenant-scoped sections (identity/ownership, hardware + adapter capabilities, telemetry, security posture, software, workload, connectivity, maintenance history + versioned predictions, policy scope, actions/recovery). Every mutation appends a `TwinRevision` (new revision + correlation id); history is append-only and never rewritten in place. |
| `src/normalize.ts` | D3 | The normalization pipeline: raw adapter observation payloads → canonical contracts `Observation` values. Injectable unit-normalization seam, duplicate suppression by (deviceId, seq), (deviceId, seq) ordering guarantees, deterministic observation ids, atomic batch rejection with FleetError taxonomy mapping. |
| `src/ingestion.ts` | D4 | The control-plane boundary the device agent posts `ObservationBatch` values to: request/batch validation (frozen contracts invariants + bounds), idempotent admission by (tenantId, idempotencyKey) and by event id, `admitted` / `duplicate` / `shed` ack semantics, back-pressure signal + drain, and audit emission through the injected sink. Closes the lifecycle loop: a LEARN-state twin re-enters OBSERVE on the next admitted observation cycle. |
| `src/audit-seam.ts` | seam | The minimal `AuditSink` interface this lane depends on. The audit package itself is lane C's W012 and adapts to this seam. |
| `src/store.ts` | seam | The tenant-scoped `TwinStore` persistence seam (in-memory reference implementation; keyed by (tenantId, deviceId), no unscoped read path). |
| `src/internal.ts` | — | Internal helpers (not exported from the public API): ISO sanity, canonical JSON, FNV-1a digests, FleetError constructors. |

### Error codes (stable machine codes)

`device.lifecycle.illegal_transition`, `device.lifecycle.not_in_learn`,
`device.unknown`, `device.identity.invalid`, `device.twin.invalid`,
`device.observations.malformed`, `device.ingestion.invalid_request`,
`device.ingestion.tenant_mismatch`, `device.ingestion.idempotency_conflict`.

All errors carry the tenant + correlation ids required by the frozen
`FleetError` taxonomy and translate through the frozen `toApiError`.

### Sections owned by later waves (documented seams)

The aggregate is complete on day one, but these sections hold minimal
default values until their owning waves refine them through
`updateTwinSection`: security posture (W031 `@fleetos/security`), software
inventory (W032 `@fleetos/software`), actions (W041 `@fleetos/actions`),
recovery state (W040 `@fleetos/recovery`), health/diagnosis
interpretations (W021 `@fleetos/health` — the `TwinInterpretation` record
is the versioned-interpretation seam per `spec/data/DEVICE-TWIN.md`).

### Dependency on @fleetos/contracts

Per the TL binding protocol, `package.json` declares
`"@fleetos/contracts": "workspace:*"`; all cross-lane domain types come
from the shared seam only. Relative imports never cross the package
boundary (ownership-gate enforced).

## Frozen spec source

packages/device-model/README.md; spec/ARCHITECTURE.md § Canonical model;
spec/data/DEVICE-TWIN.md; spec/ARCHITECTURE-LOCK.md items 2, 3, 4, 5, 15, 17.
