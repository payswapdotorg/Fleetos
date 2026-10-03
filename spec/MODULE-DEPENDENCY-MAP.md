# FleetOS Module Dependency Map

A module owns its tables, state machines, invariants and public contract. Other modules consume only the public contract.

Layers:
- Foundation: auth, organizations, audit
- Device truth: devices, observations, health, security
- Business semantics: workloads, policy, actions, maintenance, recovery
- Commerce: vendors, procurement, software
- Network/communication/learning: connectivity, notifications, learning

Key dependencies:
devices -> organizations, auth, audit
observations -> devices, audit
health -> devices, observations, audit
security -> devices, observations, policy, audit
workloads -> devices, observations, audit
policy -> organizations, devices, workloads, audit
actions -> devices, policy, audit
maintenance -> devices, health, actions, vendors, audit
recovery -> devices, security, actions, vendors, audit
procurement -> workloads, vendors, devices, software, maintenance, audit
software -> workloads, vendors, devices, policy, audit
connectivity -> devices, workloads, policy, audit
notifications -> organizations, devices, actions, audit
learning -> health, security, workloads, maintenance, audit

Integrations may depend on module public contracts. Core modules MUST NOT depend on provider SDK packages.

Worker ownership:
- A: device truth/agent boundary
- B: health/security/policy/action control plane
- C: workload/commerce/service surfaces
- TL: foundation, shared contracts, API composition, UI shell, integration wiring, CI and mergeops (TL, production readiness) -> contracts, audit, identity, integration-convergence, web-shell (test-scope bindings; src imports contracts only — the W071 pattern)


Predictive Twin / world-model layer (ADR-0002):
- predictive-representation -> devices, observations, health, security, workloads, maintenance, audit
- predictive-representation MAY consume model-provider adapters only through a provider-neutral seam
- predictive-representation MUST NOT become a source of authoritative business truth
- policy/Guardian -> predictive-representation is advisory context only; authorization remains policy-owned
- learning/Arena -> predictive-representation through evaluation/adoption contracts
- UI surfaces consume predictive outputs as versioned interpretations with provenance/uncertainty; observed facts remain separately addressable
