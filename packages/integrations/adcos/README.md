# @fleetos/integration-adcos

ADCOS integration adapter. Translates FleetOS ConnectivityIntent to the normalized ADCOS contract and normalizes status/evidence. ADCOS owns network-native topology/path execution; FleetOS owns fleet connectivity intent.

## Ownership

Lane: `worker-a` (per `spec/worker-ownership.yaml`).

## Frozen spec source

spec/integration/ADCOS.md; spec/ARCHITECTURE-LOCK.md items 7-8; spec/work-items/WORK-ITEM-CATALOG.md W050A.

## W001 state

Placeholder package established by W001. The `src/index.ts` file exports only
`MODULE_NAME` and `MODULE_VERSION`. Real domain types, event schemas and contracts
arrive with the owning work item. Do not import internals across module boundaries
(see `tools/check-ownership.mjs`).
