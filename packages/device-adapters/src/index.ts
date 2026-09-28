/**
 * @fleetos/device-adapters — Public API.
 *
 * Lane A (worker-a) implementation of the device-side agent runtime
 * contract (W010) and the endpoint adapter SDK (W020). The lane builds
 * against the frozen `@fleetos/contracts` surface:
 *
 *   checkin.ts        D1 — agent check-in / registration handshake
 *                          (identity, version, session token, ack)
 *   capabilities.ts   D2 — capability discovery + negotiation; REFUSES
 *                          unsupported destructive behavior (never
 *                          emulates it; offline default-deny for
 *                          destructive actions on a stale policy cache)
 *   observations.ts   D3 — agent-side observation collector that
 *                          assembles valid ObservationBatch values
 *                          (contracts shape) with deterministic
 *                          sequencing; the producer never emits a batch
 *                          the contracts invariants would reject
 *   commands.ts       D4 — command receipt + execution result for
 *                          CommandEnvelope delivery; status
 *                          (accepted/executing/succeeded/failed/rejected),
 *                          evidence fields, FleetError mapping from the
 *                          contracts taxonomy; idempotent by command
 *                          idempotency key (contracts duplicate-
 *                          suppression contract)
 *   policy-cache.ts   D5 — local signed-policy cache: versioned policy
 *                          document (opaque payload ok), signature
 *                          verification seam (verify function injected —
 *                          no crypto runtime dep), staleness rules
 *                          (max-age, must-refetch semantics), and
 *                          default-deny for consequential actions when
 *                          stale/offline
 *   internal.ts       — internal helpers (NOT re-exported): canonical
 *                          JSON, FNV-1a digest, ISO sanity, frozen
 *                          helpers, FleetError constructors mapped onto
 *                          the contracts taxonomy, stable error codes
 *
 * W020 — endpoint adapter SDK (built on the W010 runtime pieces):
 *
 *   seams.ts          D2 — Windows/macOS/Linux platform seam TYPES:
 *                          typed per-platform command execution surfaces
 *                          (PowerShell / shell+MDM profiles / shell+pkg
 *                          manager), observation sources (WMI+event log /
 *                          system_profiler+unified log / procfs+journald)
 *                          and capability probes, each extending the
 *                          normalized boundaries the adapter routes
 *                          through
 *   seams-inmemory.ts D2 — in-memory deterministic reference
 *                          implementations of the platform seams (fakes
 *                          for tests; no real OS integration)
 *   adapter.ts        D1/D3 — the normalized EndpointAdapter contract:
 *                          one platform-agnostic interface (one method
 *                          per normalized capability + the invoke
 *                          router) the platform seams implement; every
 *                          method enforces capability negotiation and
 *                          REFUSES unsupported / unauthorized
 *                          destructive commands before any seam call
 *   registry.ts       D4 — tenant-scoped adapter registry:
 *                          registration (structural validation +
 *                          conflict detection), lookup by
 *                          adapter/device/platform
 *   dispatch.ts       D4 — capability-aware command dispatch: command
 *                          type -> capability mapping, adapter
 *                          resolution, idempotent receipt (replay never
 *                          re-executes), status lifecycle transitions,
 *                          result envelope with FleetError mapping
 *
 * Cross-lane domain types come from @fleetos/contracts only
 * (`tools/check-ownership.mjs` enforced). No `any` in public signatures.
 * No runtime dependencies. No clock reads — every timestamp is injected
 * by the caller.
 */

// D1 — Agent check-in / registration handshake
export * from "./checkin";

// D2 — Capability discovery + negotiation
export * from "./capabilities";

// D3 — Agent-side observation batching
export * from "./observations";

// D4 — Command receipt + execution result
export * from "./commands";

// D5 — Local signed-policy cache
export * from "./policy-cache";

// W020 D2 — Platform seams (Windows/macOS/Linux typed boundary interfaces)
export * from "./seams";

// W020 D2 — In-memory deterministic reference seam implementations (fakes)
export * from "./seams-inmemory";

// W020 D1/D3 — Normalized endpoint adapter contract (capability
// negotiation + refusal inside every method; never emulates unsupported
// destructive behavior)
export * from "./adapter";

// W020 D4 — Adapter registry (tenant-scoped registration + lookup)
export * from "./registry";

// W020 D4 — Capability-aware command dispatch (idempotent receipt +
// result envelope with FleetError mapping)
export * from "./dispatch";

// W030 D1/D2 — Adapter family descriptors + capability profiles
// (mobile + printer/copier; explicit, typed, never-emulated refusals)
export * from "./families";

// W030 — Payload validation primitives (the family payload vocabulary)
export * from "./payload-validation";

// W030 D1 — Mobile family command payload contracts (MDM-shaped)
export * from "./mobile-commands";

// W030 D1 — Mobile observation source contracts (battery, OS version,
// compliance, geolocation-as-evidence)
export * from "./mobile-observations";

// W030 D2 — Printer/copier command payload contracts (SNMP + vendor)
export * from "./printer-commands";

// W030 D2 — Printer/copier consumable/usage observation contracts
export * from "./printer-observations";

// W030 D1/D2 — Mobile + printer/copier family seam TYPES
export * from "./seams-mobile";
export * from "./seams-printer";

// W030 D3 — Shared in-memory family seam machinery (scripting,
// recording, content-addressed evidence)
export * from "./inmemory-shared";

// W030 D3 — In-memory reference mobile family seams (fakes)
export * from "./seams-inmemory-mobile";

// W030 D3 — In-memory reference printer/copier family seam (fake)
export * from "./seams-inmemory-printer";

// W030 D3/D4 — Family adapter factories (family profile -> construction
// envelope validation -> W020 negotiation inside every method)
export * from "./family-adapters";

// W071 — The signature-verified policy cache wrapper (entries carry a
// deterministic content digest + an injected HMAC-style verifier seam;
// unsigned/mismatched entries are refused machine-stably and never
// served; the existing cache's staleness behavior delegated verbatim).
export * from "./signed-policy-cache";

// W071 — Enrollment security + BYOD scoping (typed ownership classes
// riding the check-in validation; BYOD refuses capabilities outside
// the allow-set; replayed enrollments refused by enrollment digest).
export * from "./enrollment-security";

// W001 placeholder markers (kept for the baseline tests; required by
// tools/verify-skeleton.mjs and tools/check-contracts.mjs).
export const MODULE_NAME = "device-adapters" as const;
export const MODULE_VERSION = "0.1.0" as const;
