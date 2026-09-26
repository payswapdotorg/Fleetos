# @fleetos/contracts

Versioned public contracts for IDs, tenant scope, events, intents, commands/results, observations, health/security findings, workload requirements, commerce demand and external integrations. Primary parallel-work seam; Tech-Lead-owned during active waves.

## Ownership

Lane: `tech-lead` (per `spec/worker-ownership.yaml`).

## Frozen spec source

`packages/contracts/README.md` (original placeholder); `spec/worker-ownership.yaml` `shared_contract_owner: tech-lead`; `spec/ARCHITECTURE.md` § Canonical model, § Intent model, § Device adapters, § Contract Guardian; `spec/ARCHITECTURE-LOCK.md` items 2-4, 6-7, 11.

## W002 state — REAL CONTRACTS

The placeholder exports from W001 (`MODULE_NAME`, `MODULE_VERSION`) are
preserved for backward compatibility, but the package now contains the
real FleetOS shared contract surface:

- `src/ids.ts` — branded IDs (TenantId, DeviceId, ObservationId, EventId,
  IntentId, ActionId, CommandId, UserId, VendorId, WorkloadId, PolicyId,
  AuditRecordId, CorrelationId, CausationId, IdempotencyKey) + `brand<T,B>()`
  helper + `isBranded()` type guard + `asXxx()` convenience constructors.
- `src/tenant.ts` — `TenantScoped` base shape, `TenantRef` validation
  helper, `validateTenantRef()` tagged-result validator.
- `src/events.ts` — `EventEnvelope<P>`, `EventCause` discriminated union,
  `makeEnvelope()` pure constructor with correlation/causation rules,
  `validateEnvelope()` invariant validator, `serializeEnvelope()`
  deterministic serializer.
- `src/commands.ts` — `CommandEnvelope<P>` with idempotency-key contract,
  `makeCommand()` pure constructor, `validateCommand()` invariant validator.
- `src/intents.ts` — the nine durable Fleet Intents as a discriminated
  union (per `spec/ARCHITECTURE.md` § Intent model), `IntentEnvelope<P>`,
  `IntentStatus` lifecycle (REQUESTED -> AUTHORIZED -> DISPATCHED ->
  EXECUTING -> VERIFIED -> COMPLETED plus REJECTED | FAILED | CANCELLED),
  `INTENT_TRANSITIONS` table, `canTransition()` predicate.
- `src/device.ts` — `DeviceLifecycleState` (verbatim from
  `spec/ARCHITECTURE.md` § Device lifecycle), `DEVICE_LIFECYCLE_TRANSITIONS`
  table, `AdapterCapabilities` flags type, `DESTRUCTIVE_CAPABILITIES`,
  `assertSupported()` capability gate (unsupported destructive behavior
  may never be emulated).
- `src/observations.ts` — `Observation`, `ObservationBatch` (check-in
  contract), `validateObservationBatch()` invariant validator,
  `ObservationKind` open string union.
- `src/policy.ts` — `GuardianDecisionType` (ALLOW | WARN |
  REQUIRE_APPROVAL | BLOCK), `GuardianDecision` result shape with rule
  ids and evidence refs, `makeGuardianDecision()` constructor,
  `isBlockingDecision()` predicate.
- `src/errors.ts` — `FleetError` discriminated union (DomainError,
  PolicyError, AuthorizationError, AdapterError, ConflictError,
  ValidationError), `ApiError` wire shape, `toApiError()` translator.
- `src/versioning.ts` — `Versioned<T>` wrapper, `assertVersion()` guard,
  `makeVersioned()` constructor, `MIN_SCHEMA_VERSION` constant.
- `src/index.ts` — re-exports the full public API.

## Tests

Tests live in `test/*.test.ts` (not `src/`):

- `test/ids.test.ts` — branded id roundtrips, type-guard behavior.
- `test/events.test.ts` — envelope invariants, correlation/causation
  rules, deterministic serialization.
- `test/intents.test.ts` — legal and illegal transitions, terminal
  states, the nine intent kinds.
- `test/device.test.ts` — lifecycle order, linear-progression invariant,
  capability assertion (supported/unsupported/destructive-authorized/
  destructive-unauthorized).
- `test/policy.test.ts` — Guardian decision types, blocking predicates,
  frozen-record invariants.
- `test/errors.test.ts` — error taxonomy shape, `toApiError()` HTTP status
  mapping for all six error kinds.
- `test/versioning.test.ts` — version guard (below-one, unknown-to-consumer,
  known-version happy path).

## Hard constraints honored

- Zero runtime dependencies. devDependencies: typescript only.
- No `any` in public signatures (strict TS).
- Cross-lane imports: this package imports nothing from other `@fleetos/*`
  packages. It IS the shared seam that other packages import.
- Frozen spec semantics preserved: no frozen spec file was modified in
  W002 (the two confirmed ownership path claims from W001 are unchanged).

## Do-not-import-across-boundaries

Workers may import the public API of `@fleetos/contracts` (the shared
seam) but may NOT import internals of other workers' packages (see
`tools/check-ownership.mjs`).
