/**
 * @fleetos/audit — Public API.
 *
 * Lane C (worker-c) implementation of the FleetOS append-only audit
 * foundation (W012 D3): every consequential action is audited
 * (`spec/ARCHITECTURE.md` § Control plane; ARCHITECTURE-LOCK item 4).
 *
 * Module map (all pure, zero runtime dependencies, strict TS, no clock
 * reads — every timestamp is injected by the caller):
 *
 *   record.ts         D3 — the AuditRecord (who/what/when/where/outcome,
 *                          correlation to EventEnvelope ids, optional
 *                          GuardianDecision correlation) + the pure
 *                          hash-chain helpers: computeRecordHash and the
 *                          verifyAuditChain tampering-detection walk.
 *   hash.ts           D3 — the injectable HashFn seam (no crypto runtime
 *                          dep) + the deterministic FNV-1a reference hash
 *                          + the genesis sentinel.
 *   log.ts            D3 — the append-only AuditLog abstraction: append /
 *                          records / head / verify / size — NO update or
 *                          delete API AT ALL; per-tenant hash chains; the
 *                          in-memory reference implementation.
 *   sink-adapter.ts   D3 — adapts an AuditLog to lane-local audit-sink
 *                          seams (structural typing — e.g. device-model's
 *                          W011 AuditSink) without cross-lane imports.
 *   errors.ts         — FleetError-shaped audit validation errors.
 *
 * Cross-lane domain types come from @fleetos/contracts only. The
 * TenantContext (mandatory first parameter of every store operation in this
 * lane) is imported from @fleetos/identity — a SAME-LANE import (both
 * packages are worker-c paths in spec/worker-ownership.yaml), permitted by
 * the ownership gate. No `any` in public signatures.
 */

// D3 — Append-only audit
export * from "./record";
export * from "./hash";
export * from "./log";
export * from "./sink-adapter";

// FleetError-shaped audit errors
export * from "./errors";

// W001 placeholder markers (kept for the baseline tests; required by
// tools/verify-skeleton.mjs and tools/check-contracts.mjs).
export const MODULE_NAME = "audit" as const;
export const MODULE_VERSION = "0.1.0" as const;
