# @fleetos/procurement

Demand aggregation, matching, quote and order semantics. Procurement is an exchange/matching problem, not a hard-coded vendor integration.

## Ownership

Lane: `worker-c` (per `spec/worker-ownership.yaml`).

## Frozen spec source

packages/procurement/README.md; spec/ARCHITECTURE-LOCK.md item 13.

## W001 state

Placeholder package established by W001. The `src/index.ts` file exports only
`MODULE_NAME` and `MODULE_VERSION`. Real domain types, event schemas and contracts
arrive with the owning work item. Do not import internals across module boundaries
(see `tools/check-ownership.mjs`).
