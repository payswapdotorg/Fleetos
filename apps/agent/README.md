# @fleetos/agent

Device agent runtime; runs OUTSIDE the web runtime. The agent is not trusted business truth: it authenticates, reports normalized observations, discovers capabilities and executes only authorized commands it can prove it is allowed to execute.

## Composition

A thin composition layer over `@fleetos/device-adapters`:

- W010: identity, declared capabilities, observation collector, command receipt tracker, local signed-policy cache, check-in command composition/ack projection, capability negotiation, consequential-action authorization.
- W020: an endpoint adapter `AdapterRegistry` (construction-time or late registration) and `dispatchCommand` — capability-aware, idempotent command dispatch to the registered adapters, with the runtime-injected defaults: target device = the runtime's identity device; policy-cache readiness derived from the runtime's own signed-policy cache at `executedAt`; policy grant fail-closed (false) unless the caller passes one.

The runtime owns no domain logic; every operation delegates to a device-adapters module.

## Ownership

Lane: `worker-a` (per `spec/worker-ownership.yaml`).

## Frozen spec source

apps/agent/README.md; spec/ARCHITECTURE-LOCK.md item 5; spec/ARCHITECTURE.md § Device adapters.

## Binding protocol

Declares `"@fleetos/contracts": "workspace:*"` and `"@fleetos/device-adapters": "workspace:*"` in package.json dependencies (same lane; bun workspace linking).
