# @fleetos/identity

Tenant isolation, actor identity and scoped authorization primitives. Worker-C bootstraps this in W012.

## Ownership

Lane: `worker-c` (per `spec/worker-ownership.yaml`).

## Frozen spec source

spec/work-items/WORK-ITEM-CATALOG.md W012; spec/MODULE-DEPENDENCY-MAP.md Foundation layer.

## W001 state

Placeholder package established by W001. The `src/index.ts` file exports only
`MODULE_NAME` and `MODULE_VERSION`. Real domain types, event schemas and contracts
arrive with the owning work item. Do not import internals across module boundaries
(see `tools/check-ownership.mjs`).
