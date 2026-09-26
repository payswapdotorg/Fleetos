# @fleetos/health

Normalized health signals, anomalies, diagnoses, predictions and treatment recommendations.

## Ownership

Lane: `worker-b` (per `spec/worker-ownership.yaml`).

## Frozen spec source

packages/health/README.md; spec/MODULE-DEPENDENCY-MAP.md Device truth layer.

## W001 state

Placeholder package established by W001. The `src/index.ts` file exports only
`MODULE_NAME` and `MODULE_VERSION`. Real domain types, event schemas and contracts
arrive with the owning work item. Do not import internals across module boundaries
(see `tools/check-ownership.mjs`).
