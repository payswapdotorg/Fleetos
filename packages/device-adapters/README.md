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

W030 — mobile + printer/copier adapter family contracts:

- `src/families.ts` — D1/D2 family descriptors + EXPLICIT typed capability profiles: the mobile envelope (ios/ipados/android: identify/observe/diagnose/health/enforce/lock/locate/wipe/update), the printer/copier base (identify/observe/diagnose/health/enforce with LIMITED enforce), the FORBIDDEN printer capabilities (lock/locate/wipe — refused, never emulated) and the vendor-model-optional capabilities (reboot/update); vendor-model descriptors; family capability validation.
- `src/payload-validation.ts` — the shared parse-don't-validate vocabulary (`PayloadParseResult<T>`, primitive guards) for the family payload contracts.
- `src/mobile-commands.ts` — D1 MDM-shaped command payload contracts: managed-app commands, OS-update policies, lost-mode with message/phone, device lock, wipe (full/enterprise), locate requests, passcode/restrictions enforcement — with fail-closed validators and the capability → payload-kind map.
- `src/mobile-observations.ts` — D1 mobile observation source contracts: battery, OS version, compliance state, GEOLOCATION-AS-EVIDENCE (observable evidence with provenance — never inferred intent).
- `src/printer-commands.ts` — D2 SNMP + vendor boundary command payload contracts (snmp-get/snmp-set/cancel-job/clear-queue/apply-config/reboot/firmware-update) with capability-aware fail-closed validators.
- `src/printer-observations.ts` — D2 consumable/usage observation contracts: toner levels, page counts, error states.
- `src/seams-mobile.ts` — D1 mobile family seam TYPES (Apple MDM channel for ios/ipados, Android Enterprise channel, shared mobile observation sources).
- `src/seams-printer.ts` — D2 printer/copier seam TYPES (SNMP channel + vendor channel + consumable/usage observation sources; NO lock/locate/wipe surface).
- `src/inmemory-shared.ts` — D3 shared in-memory family seam machinery (scripted outcomes, invocation recording, content-addressed evidence).
- `src/seams-inmemory-mobile.ts` / `src/seams-inmemory-printer.ts` — D3 in-memory deterministic reference seams (payload contracts enforced fail-closed; no real MDM/SNMP I/O).
- `src/family-adapters.ts` — D3/D4 family adapter factories: family profile → construction-time envelope validation (printer lock/locate/wipe REFUSED at construction) → the W020 `createEndpointAdapter` (negotiation inside every method). Family adapters register through the W020 registry and dispatch through the W020 dispatcher unchanged.

W100A — the enrollment-request flow (the install contract's one-time bootstrap code):

- `src/enrollment-request.ts` — tenant-bound, scope-bound, one-time, short-lived, revocable, auditable enrollment requests with VERIFIER-ONLY code storage (the code is echoed once at creation, never stored); the four ownership-kind distinctions (`corporate_owned`/`leased`/`byod`/`third_party_managed`) mapping onto the frozen W071 classes; one-time redemption issuing the device-scoped trust record (the frozen `SessionToken` shape); the machine-stable refusal taxonomy (`code_expired`/`code_already_used`/`code_revoked`/`code_not_found`/`device_already_enrolled`/`tenant_role_mismatch`/`enrollment_refused_by_policy`) each with its human explanation; the in-memory tenant-partitioned reference store (no cross-tenant existence side channel).

## Ownership

Lane: `worker-a` (per `spec/worker-ownership.yaml`).

## Frozen spec source

spec/ARCHITECTURE.md § Device adapters; spec/work-items/WORK-ITEM-CATALOG.md W010, W020.

## Binding protocol

Declares `"@fleetos/contracts": "workspace:*"` in package.json dependencies (bun workspace linking; relative imports crossing a package boundary are forbidden — the ownership gate enforces it).
