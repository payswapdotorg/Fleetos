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

## W100C — the durable audit log

Wave 9 added `src/durable-log.ts`: a `DurableRecordStore`-backed
implementation of the frozen `AuditLog` interface (append / records /
head / verify / size — still NO update, no delete, no truncation).
Records persist into `fleetos_audit_records` (DDL derived from the table
definition; nested fields as canonical JSON). Restart continuity: a new
log over the same store continues each tenant's hash chain; tampering
with a persisted row breaks `verify`. The seam is shared with the
identity durable repositories — the W102 Neon binding implements it
once for both.
