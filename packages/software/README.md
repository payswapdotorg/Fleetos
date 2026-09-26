# @fleetos/software

Software catalog, subscriptions, entitlements and seat allocation semantics.

## Ownership

Lane: `worker-c` (per `spec/worker-ownership.yaml`).

## Frozen spec source

packages/software/README.md; spec/MODULE-DEPENDENCY-MAP.md Commerce layer.

## W001 state

Placeholder package established by W001. The `src/index.ts` file exports only
`MODULE_NAME` and `MODULE_VERSION`. Real domain types, event schemas and contracts
arrive with the owning work item. Do not import internals across module boundaries
(see `tools/check-ownership.mjs`).
