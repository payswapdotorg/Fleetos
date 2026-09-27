# @fleetos/integration-aurum

The Aurum adapter: FleetOS's provider-neutral communication/intelligence
channel.

## Ownership

Lane: `worker-c` (per `spec/worker-ownership.yaml`), work item W050C.

## Spec source

`spec/integration/AURUM.md`; `spec/ARCHITECTURE-LOCK.md` items 6-7
(provider-neutral integration), 10 (Aurum is a communication channel;
FleetOS remains operational authority), 17 (tenant isolation).

## The authority boundary (the AURUM.md invariant)

Aurum returns delivery/outcome metadata and cannot mutate FleetOS truth
except through explicitly authorized FleetOS action APIs. This package's
public surface is, exhaustively:

- PURE intent builders — the six provider-neutral message kinds
  (maintenance notices, incident warnings, approval requests, recovery
  messages, procurement updates, manager briefings), derived
  deterministically from injected STRUCTURAL seams (never free text);
- EMISSION into the adapter's OWN append-only outbox ledger through an
  injected transport seam (no real network I/O);
- METADATA-ONLY delivery/outcome ingestion into the adapter's OWN
  append-only delivery ledger;
- READ-ONLY queries/summaries, the injected seams (audit sink,
  transport) and the in-memory reference ledgers.

There is NO API that mutates any FleetOS domain store, executes any
action, or dispatches any intent. The authority-boundary test asserts
the exact export allowlist byte-for-byte.

## Module map

- `src/content.ts` — derived content (title/summary + typed fields with
  sensitivity classes) + the typed redaction policy (machine fields are
  non-redactable; title/summary never embed redactable values — the
  redaction-soundness invariant).
- `src/intents.ts` — the six builders + the structural seams the real
  domain records (W042 `ServiceWorkOrder`, W031 `SecurityFinding`, the
  W031/W040/W041 parked-decision records, W040 `RecoveryCaseRecord`,
  W032 `Quote`/`ProcurementDemand`) satisfy at the binding site.
- `src/outbox.ts` — the versioned append-only outbox ledger
  (per-tenant gapless sequences; content-addressed deterministic ids;
  idempotent duplicates; forged-collision digest guard).
- `src/transport.ts` — the injected emission transport seam + the
  in-memory deterministic reference.
- `src/emission.ts` — the emission boundary (guard → append →
  transport → audit).
- `src/delivery.ts` — the delivery/outcome metadata lifecycle + the
  ingestion boundary (idempotent by (message ref, delivery attempt);
  unknown refs refused; terminal states absorb).
- `src/audit-seam.ts` — the injected audit seam (structurally satisfied
  by `@fleetos/audit`'s sink adapter; proven by test).

## Design rules

No runtime dependencies (typescript is a dev-dep only). No `any` in
public signatures. Strict TS. No clock reads, no entropy, no network
I/O — every timestamp is injected; all transport is an injected seam.
Tenant isolation by construction (TenantContext-first, partitioned
stores, W012's reusable isolation harness over the raw KV views).
