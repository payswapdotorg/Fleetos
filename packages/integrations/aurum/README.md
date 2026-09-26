# @fleetos/integration-aurum

Aurum integration adapter. Emits normalized communication intents and consumes delivery/outcome metadata. Aurum is a communication/intelligence channel; FleetOS remains operational authority.

## Ownership

Lane: `worker-c` (per `spec/worker-ownership.yaml`).

## Frozen spec source

spec/integration/AURUM.md; spec/ARCHITECTURE-LOCK.md item 10; spec/work-items/WORK-ITEM-CATALOG.md W050C.

## W001 state

Placeholder package established by W001. The `src/index.ts` file exports only
`MODULE_NAME` and `MODULE_VERSION`. Real domain types, event schemas and contracts
arrive with the owning work item. Do not import internals across module boundaries
(see `tools/check-ownership.mjs`).
