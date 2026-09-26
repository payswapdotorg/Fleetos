# @fleetos/contracts

Versioned public contracts for IDs, tenant scope, events, intents, commands/results, observations, health/security findings, workload requirements, commerce demand and external integrations. Primary parallel-work seam; Tech-Lead-owned during active waves.

## Ownership

Lane: `tech-lead` (per `spec/worker-ownership.yaml`).

## Frozen spec source

packages/contracts/README.md; spec/worker-ownership.yaml shared_contract_owner: tech-lead.

## W001 state

Placeholder package established by W001. The `src/index.ts` file exports only
`MODULE_NAME` and `MODULE_VERSION`. Real domain types, event schemas and contracts
arrive with the owning work item. Do not import internals across module boundaries
(see `tools/check-ownership.mjs`).
