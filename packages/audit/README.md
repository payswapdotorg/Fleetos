# @fleetos/audit

Append-only audit/evidence. Foundation-layer module; cross-cutting audit trail for consequential actions.

## Ownership

Lane: `worker-c` (per `spec/worker-ownership.yaml`).

## Frozen spec source

spec/MODULE-DEPENDENCY-MAP.md Foundation layer; spec/ARCHITECTURE.md § Control plane.

## W001 state

Placeholder package established by W001. The `src/index.ts` file exports only
`MODULE_NAME` and `MODULE_VERSION`. Real domain types, event schemas and contracts
arrive with the owning work item. Do not import internals across module boundaries
(see `tools/check-ownership.mjs`).
