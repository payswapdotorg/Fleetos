# @fleetos/device-adapters

Lane A device-side runtime contract (W010) + endpoint adapter SDK (W020), built against the frozen `@fleetos/contracts` surface.

## Normalized capabilities

Per `spec/ARCHITECTURE.md` § Device adapters, an adapter exposes the normalized capability set: identify, observe, diagnose, enforce, remediate, lock, locate, wipe, reboot, update, health. Capability support is explicit; unsupported destructive behavior may never be emulated (`spec/ARCHITECTURE-LOCK.md` item 16 — destructive actions require an explicit policy grant and evidence trail; the SDK default-denies destructive capabilities when the local signed-policy cache is stale or offline).

## Module map

W010 — device agent / runtime contract:

- `src/checkin.ts` — agent check-in / registration handshake (envelope-compatible payload shapes).
- `src/capabilities.ts` — capability discovery + negotiation with three refusal modes.
- `src/observations.ts` — agent-side observation batching (valid-by-construction `ObservationBatch`).
- `src/commands.ts` — command receipt + execution result (idempotent by idempotency key; `FleetError` taxonomy mapping).
- `src/policy-cache.ts` — local signed-policy cache (injected verifier seam, staleness rules, default-deny).

W020 — endpoint adapter SDK:

- `src/seams.ts` — Windows/macOS/Linux platform seam TYPES (typed per-platform command execution surfaces, observation sources, capability probes; each extends the normalized boundaries).
- `src/seams-inmemory.ts` — in-memory deterministic reference implementations of the platform seams (fakes for tests; no real OS integration).
- `src/adapter.ts` — the normalized `EndpointAdapter` contract: one platform-agnostic interface (one method per normalized capability + the `invoke()` router) built on the W010 runtime pieces; every method enforces capability negotiation and refuses unsupported/unauthorized destructive commands before any seam call.
- `src/registry.ts` — tenant-scoped adapter registry (registration validation + conflict detection; lookup by adapter/device/platform).
- `src/dispatch.ts` — capability-aware command dispatch: command-type → capability mapping, adapter resolution, idempotent receipt, status lifecycle transitions, result envelope with `FleetError` mapping.
- `src/internal.ts` — internal helpers (not re-exported).

## Ownership

Lane: `worker-a` (per `spec/worker-ownership.yaml`).

## Frozen spec source

spec/ARCHITECTURE.md § Device adapters; spec/work-items/WORK-ITEM-CATALOG.md W010, W020.

## Binding protocol

Declares `"@fleetos/contracts": "workspace:*"` in package.json dependencies (bun workspace linking; relative imports crossing a package boundary are forbidden — the ownership gate enforces it).
