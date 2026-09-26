# @fleetos/device-adapters

Normalized Device Adapter capabilities: identify, observe, diagnose, enforce, remediate, lock, locate, wipe, reboot, update, health. Capability support is explicit; unsupported destructive behavior may never be emulated.

## Ownership

Lane: `worker-a` (per `spec/worker-ownership.yaml`).

## Frozen spec source

spec/ARCHITECTURE.md § Device adapters; spec/work-items/WORK-ITEM-CATALOG.md W020.

## W001 state

Placeholder package established by W001. The `src/index.ts` file exports only
`MODULE_NAME` and `MODULE_VERSION`. Real domain types, event schemas and contracts
arrive with the owning work item. Do not import internals across module boundaries
(see `tools/check-ownership.mjs`).
