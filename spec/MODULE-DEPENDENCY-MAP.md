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
- TL: foundation, shared contracts, API composition, UI shell, integration wiring, CI and merge