/**
 * @fleetos/integration-aurum — public API.
 *
 * The Aurum adapter (W050C, lane C). Aurum is a communication/
 * intelligence channel; FleetOS remains operational authority
 * (`spec/ARCHITECTURE-LOCK.md` item 10; `spec/integration/AURUM.md`).
 *
 * THE AUTHORITY BOUNDARY (the AURUM.md invariant — "Aurum returns
 * delivery/outcome metadata and cannot mutate FleetOS truth except
 * through explicitly authorized FleetOS action APIs"): this package's
 * public surface contains ONLY
 *
 *   1. PURE intent builders (the six provider-neutral message kinds,
 *      derived deterministically from injected structural inputs);
 *   2. EMISSION into the adapter's OWN append-only outbox ledger
 *      through the injected transport seam;
 *   3. METADATA-ONLY delivery/outcome ingestion into the adapter's OWN
 *      append-only delivery ledger;
 *   4. READ-ONLY queries and pure summaries of those two ledgers;
 *   5. the injected seams themselves (audit sink, transport) and the
 *      in-memory reference ledgers.
 *
 * There is NO API here that mutates any FleetOS domain store, executes
 * any action, or dispatches any intent — any FleetOS-side mutation a
 * delivery outcome might prompt flows exclusively through the existing
 * authorized action/intent surfaces (W041/W040). The authority-boundary
 * test asserts the exact export surface byte-for-byte.
 *
 * src/ imports ONLY `@fleetos/contracts` (the shared seam) and
 * `@fleetos/identity` (the same worker-c lane — the W042 precedent);
 * every domain surface is consumed through STRUCTURAL seams with the
 * real packages injected at the binding site and proven by test (the
 * W040 disclosed pattern). `@fleetos/audit`'s sink adapter satisfies
 * the audit seam structurally (proven by test).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

// D1 — derived content + the typed redaction policy
export * from "./content";

// D1 — the six communication-intent builders + structural seams
export * from "./intents";

// D1 — the versioned append-only outbox ledger
export * from "./outbox";

// D3 — the injected emission transport seam
export * from "./transport";

// D1/D3/D4 — the emission boundary (append + transport + audit)
export * from "./emission";

// D2 — delivery/outcome metadata ingestion (the metadata-only return path)
export * from "./delivery";

// D4 — the audit emission seam (structurally satisfied by @fleetos/audit)
export * from "./audit-seam";

// W001 placeholder markers (kept for the baseline; the real contracts
// are the exports above).
export const MODULE_NAME = "integration-aurum" as const;
export const MODULE_VERSION = "0.1.0" as const;
