# @fleetos/policy

Contract Guardian policy semantics, compilation and decision records. Decision types: ALLOW, WARN, REQUIRE_APPROVAL, BLOCK. Never asserts unobservable employee intent.

## Ownership

Lane: `worker-b` (per `spec/worker-ownership.yaml`).

## Frozen spec source

packages/policy/README.md; spec/ARCHITECTURE.md § Contract Guardian; spec/ARCHITECTURE-LOCK.md item 11.

## W001 state

Placeholder package established by W001. The `src/index.ts` file exports only
`MODULE_NAME` and `MODULE_VERSION`. Real domain types, event schemas and contracts
arrive with the owning work item. Do not import internals across module boundaries
(see `tools/check-ownership.mjs`).
