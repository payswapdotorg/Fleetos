/**
 * @fleetos/identity — Public API.
 *
 * Lane C (worker-c) implementation of the FleetOS tenant/auth foundations
 * (W012): tenant isolation primitives, actor identity, and scoped
 * authorization primitives. The append-only audit foundation lives in the
 * sibling `@fleetos/audit` package (same lane).
 *
 * Module map (all pure, zero runtime dependencies, strict TS, no clock
 * reads — every timestamp is injected by the caller):
 *
 *   tenant-context.ts  D1 — TenantContext (mandatory first parameter of
 *                          every store operation in this lane) + the guards
 *                          that reject context-free and cross-tenant access.
 *   tenant-store.ts    D1 — tenant-scoped store interfaces: every read/write
 *                          keyed by the TenantId on the acting context; the
 *                          in-memory reference implementation partitions by
 *                          tenant so cross-tenant reads are impossible by
 *                          construction.
 *   isolation.ts       D1 — the reusable tenant-isolation test harness
 *                          (consumed via import by same-lane packages;
 *                          the lane-independent isolation contract).
 *   principal.ts       D2 — UserPrincipal / ServicePrincipal /
 *                          AgentPrincipal; every principal is tenant-bound.
 *   credential.ts      D2 — opaque token value type, issued-credential shape
 *                          (issued-at/expiry/tenant binding), injected
 *                          validator/issuer seams (no crypto, no auth
 *                          server), in-memory reference registry.
 *   roles.ts           D2 — role definitions, assignment records
 *                          (principal -> role -> permission set), and the
 *                          deterministic permission resolution fold.
 *   authorization.ts   D4 — scoped authorization PRIMITIVES: resource scope
 *                          model (tenant/device/workload), action catalog
 *                          with the consequential-action flag, explicit
 *                          grants, PermissionCheck -> deterministic
 *                          allow/deny with machine-stable reasons. (The
 *                          Contract Guardian evaluation strategy is W031.)
 *   errors.ts          — FleetError-shaped identity errors (validation +
 *                          authorization projections).
 *
 * Cross-lane domain types come from @fleetos/contracts only
 * (`tools/check-ownership.mjs` enforced). No `any` in public signatures.
 */

// D1 — Tenant isolation primitives
export * from "./tenant-context";
export * from "./tenant-store";
export * from "./isolation";

// D2 — Actor identity: principals, credentials, roles
export * from "./principal";
export * from "./credential";
export * from "./roles";

// D4 — Scoped authorization primitives
export * from "./authorization";

// W100C — The audit emission seam for the durable identity lifecycle
export * from "./identity-audit-seam";

// W100C — Durable persistence: tables + DDL + the record-store seam +
// the in-memory reference implementation
export * from "./durable/tables";
export * from "./durable/ddl";
export * from "./durable/seam";
export * from "./durable/memory";

// W100C — The durable repositories (tenant/principal/assignment/session/
// invitation translation over the seam)
export * from "./durable/repositories";

// W100C — The workspace/tenant create/join lifecycle (audited)
export * from "./workspace";

// W100C — The durable session service + active-role session semantics
export * from "./session";

// W100C — The auditable active-role switch (never changes tenant)
export * from "./role-switch";

// FleetError-shaped identity errors
export * from "./errors";

// W001 placeholder markers (kept for the baseline tests; required by
// tools/verify-skeleton.mjs and tools/check-contracts.mjs).
export const MODULE_NAME = "identity" as const;
export const MODULE_VERSION = "0.1.0" as const;
