/**
 * @fleetos/integration-convergence — Public API.
 *
 * Tech-Lead owned (W051 [TL] integration convergence). The convergence
 * layer over the three Wave 5 integration adapters:
 *
 *   - `@fleetos/integration-adcos`  (W050A, lane A) — connectivity intents;
 *   - `@fleetos/integration-arena`  (W050B, lane B) — evaluation cases;
 *   - `@fleetos/integration-aurum`  (W050C, lane C) — communication.
 *
 * Per the frozen ownership model this package's src/ imports from
 * `@fleetos/contracts` ONLY — every REAL cross-lane edge is bound at
 * the test/ binding site (the D1 suite), which injects:
 *   - the REAL W031 Contract Guardian engine (`@fleetos/policy`'s
 *     `evaluateGuardianRequest` + compiled rule sets) into BOTH
 *     guardian-gated adapters — proving BLOCK refuses and
 *     REQUIRE_APPROVAL parks, never auto-executes;
 *   - the REAL `@fleetos/identity` TenantContext;
 *   - the REAL `@fleetos/audit` hash-chained AuditLog + sink adapter
 *     (and the digest-compatibility proof against this package's
 *     FNV-1a);
 *   - the REAL adapter in-memory stores/transports (adcos submission
 *     gate, arena evaluation-case store, aurum outbox + emission).
 *
 * Module map (all pure, zero runtime dependencies, strict TS, no clock
 * reads — every timestamp is injected by the caller):
 *
 *   internal.ts  shared helpers: frozen/frozenArray, the STRUCTURAL
 *               ConvergenceTenantScope (satisfied by the REAL identity
 *               TenantContext — proven by the D1 binding tests), the
 *               FNV-1a digest + canonical JSON.
 *   retry.ts     D2 — RetryPolicy, the deterministic exponential
 *               backoff ladder, the neutral IntegrationOutcome
 *               classification, the classifyRetry fold (ACCEPTED/
 *               DUPLICATE stop OK; REFUSED/UNKNOWN stop fail-closed —
 *               never retried blind), the driveWithRetry driver, and
 *               the namespaced deriveIdempotencyKey digest.
 *   health.ts    D3 — AdapterHealth + the injected AdapterHealthProbe
 *               seams + the fail-closed aggregateIntegrationHealth
 *               (worst-wins; unbound → UNKNOWN → snapshot DEGRADED;
 *               throwing/shape-invalid probes → DEGRADED; never
 *               silently healthy).
 *   evidence.ts  D4 — the append-only, per-tenant, hash-chained
 *               integration-evidence ledger (recorderFor/readerFor —
 *               isolation by construction, no foreign-tenant API),
 *               FNV-1a canonical-JSON digests, verifyEvidenceChain
 *               tamper detection.
 */

// The structural tenant scope (satisfied by @fleetos/identity's REAL TenantContext).
export type { ConvergenceTenantScope, ConvergenceScopeCheck } from "./internal";
export { checkConvergenceTenantScope } from "./internal";
export { canonicalJson, fnv1a32Hex } from "./internal";

// D2 — retries + idempotency.
export * from "./retry";

// D3 — adapter health.
export * from "./health";

// D4 — integration evidence.
export * from "./evidence";

export const MODULE_NAME = "integration-convergence" as const;
export const MODULE_VERSION = "0.1.0" as const;
