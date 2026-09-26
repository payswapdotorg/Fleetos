# @fleetos/agent

Device agent runtime; runs OUTSIDE the web runtime. The agent is not trusted business truth: it authenticates, reports normalized observations, discovers capabilities and executes only authorized commands it can prove it is allowed to execute.

## Ownership

Lane: `worker-a` (per `spec/worker-ownership.yaml`).

## Frozen spec source

apps/agent/README.md; spec/ARCHITECTURE-LOCK.md item 5.

## W001 state

Placeholder package established by W001. The `src/index.ts` file exports only
`MODULE_NAME` and `MODULE_VERSION`. Real domain types, event schemas and contracts
arrive with the owning work item. Do not import internals across module boundaries
(see `tools/check-ownership.mjs`).
