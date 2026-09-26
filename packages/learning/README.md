# @fleetos/learning

Convert outcomes into evaluation cases and capability adoption records. Arena owns capability learning/certification; FleetOS owns operational adoption.

## Ownership

Lane: `worker-b` (per `spec/worker-ownership.yaml`).

## Frozen spec source

spec/work-items/WORK-ITEM-CATALOG.md W070; spec/ARCHITECTURE-LOCK.md item 9.

## W001 state

Placeholder package established by W001. The `src/index.ts` file exports only
`MODULE_NAME` and `MODULE_VERSION`. Real domain types, event schemas and contracts
arrive with the owning work item. Do not import internals across module boundaries
(see `tools/check-ownership.mjs`).
