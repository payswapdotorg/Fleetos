# @fleetos/agent

Device agent runtime; runs OUTSIDE the web runtime. The agent is not trusted business truth: it authenticates, reports normalized observations, discovers capabilities and executes only authorized commands it can prove it is allowed to execute.

## Composition

A thin composition layer over `@fleetos/device-adapters`:

- W010: identity, declared capabilities, observation collector, command receipt tracker, local signed-policy cache, check-in command composition/ack projection, capability negotiation, consequential-action authorization.
- W020: an endpoint adapter `AdapterRegistry` (construction-time or late registration) and `dispatchCommand` — capability-aware, idempotent command dispatch to the registered adapters, with the runtime-injected defaults: target device = the runtime's identity device; policy-cache readiness derived from the runtime's own signed-policy cache at `executedAt`; policy grant fail-closed (false) unless the caller passes one.

The runtime owns no domain logic; every operation delegates to a device-adapters module.

## W100A — install + release + enrollment journey

- `src/release.ts` — reproducible agent release packaging (the install contract's Windows/macOS/Linux artifacts): a PURE `buildAgentRelease` producing versioned manifests with content-derived checksums (`fnv1a64`, algorithm recorded per artifact), release notes, install commands, uninstall steps and rollback/revoke instructions; canonical target ordering (byte-identical manifests for identical inputs); the FAIL-CLOSED credential-free installer scanner (`scanInstallerPayload` — a forbidden credential pattern refuses the whole build); deterministic per-platform installer script generation (the control-plane endpoint arrives through the environment, the one-time code is entered at run time, never embedded).
- `src/enrollment-client.ts` — the agent-side enrollment journey (`selectInstallerArtifact` → `bootstrap` (one-time code exchange for the device-scoped trust record) → `firstCheckIn` (composed through the frozen `wrapCheckInCommand`/`validateCheckInCommand`/`projectCheckInAck`) → `firstObservation` (canonical frozen-contracts batch, deterministic idempotency key) → `confirmTwin`): a thin stateful machine over injected seams; the trust's session token lives in the client closure and is never projected; control-plane refusals propagate VERBATIM (machine reason + human explanation); a throwing or shape-invalid seam is `control_plane_unreachable` — fail-closed, never a fabricated success.

## Ownership

Lane: `worker-a` (per `spec/worker-ownership.yaml`).

## Frozen spec source

apps/agent/README.md; spec/ARCHITECTURE-LOCK.md item 5; spec/ARCHITECTURE.md § Device adapters.

## Binding protocol

Declares `"@fleetos/contracts": "workspace:*"` and `"@fleetos/device-adapters": "workspace:*"` in package.json dependencies (same lane; bun workspace linking).
