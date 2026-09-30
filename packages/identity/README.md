# @fleetos/identity

Tenant isolation, actor identity and scoped authorization primitives. Worker-C bootstraps this in W012.

## Ownership

Lane: `worker-c` (per `spec/worker-ownership.yaml`).

## Frozen spec source

spec/work-items/WORK-ITEM-CATALOG.md W012; spec/MODULE-DEPENDENCY-MAP.md Foundation layer.

## W001 state

Placeholder package established by W001. The `src/index.ts` file exports only
`MODULE_NAME` and `MODULE_VERSION`. Real domain types, event schemas and contracts
arrive with the owning work item. Do not import internals across module boundaries
(see `tools/check-ownership.mjs`).

## W100C — durable identity lifecycle

Wave 9 added the durable persistence + lifecycle layer (see
`src/durable/`, `src/workspace.ts`, `src/session.ts`,
`src/role-switch.ts`, `src/identity-audit-seam.ts`):

- **`src/durable/`** — the Neon-bound seam: typed table definitions
  (`tables.ts`), DERIVED deterministic DDL (`ddl.ts`), the flat
  `DurableRecordStore` interface (`seam.ts`, TenantContext-first, tenant
  partitioned by construction) and the in-memory reference
  implementation (`memory.ts`). The W102 [TL] Neon migration binding
  implements the seam over the real database; the repositories
  (`repositories.ts`) translate domain records <-> rows on top of it.
- **`src/workspace.ts`** — the create/join lifecycle: create a workspace
  (tenant + founder principal + initial roles, audited); issue single-use
  join invitations (only the deterministic code HASH is persisted); join
  by redeeming a code (the invitation resolves the TARGET tenant — never
  caller-supplied; fail-closed expiry; the code never burns on refusal).
- **`src/session.ts`** — the durable session service: open / resolve /
  revoke with the fail-closed time discipline; the active-role SELECTOR
  is session presentation state only.
- **`src/role-switch.ts`** — the auditable active-role switch: validates
  the target role against the CURRENT tenant's assignments (frozen
  `resolvePermissions` fold), writes ONLY the selector + lastSeenAt,
  NEVER changes tenant, and audits every switch AND every refusal.
- **`src/identity-audit-seam.ts`** — the lane-C audit sink seam,
  structurally satisfied by `@fleetos/audit`'s sink adapter (proven by
  `test/durable/audit-bridge.test.ts`).

The matrix rules from `spec/ui/ROLE-EXPERIENCE-MATRIX.yaml` are encoded
as the frozen `ACTIVE_ROLE_MATRIX_RULES` constant and proven by test.
