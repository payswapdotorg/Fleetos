# @fleetos/recovery

Last-seen evidence, recovery state, lock/locate and replacement escalation. Destructive recovery actions require explicit policy grant and evidence trail.

## Ownership

Lane: `worker-a` (per `spec/worker-ownership.yaml`).

## Frozen spec source

spec/work-items/WORK-ITEM-CATALOG.md W040; spec/ARCHITECTURE-LOCK.md item 16.

## W001 state

Placeholder package established by W001. The `src/index.ts` file exports only
`MODULE_NAME` and `MODULE_VERSION`. Real domain types, event schemas and contracts
arrive with the owning work item. Do not import internals across module boundaries
(see `tools/check-ownership.mjs`).
