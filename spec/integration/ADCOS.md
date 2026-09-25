# ADCOS Integration Contract

FleetOS requests connectivity outcomes; ADCOS owns network-native execution/optimization.

FleetOS -> ADCOS:
ConnectivityIntent containing tenant, target device/workload, required properties, hard constraints, duration, budget/policy and security requirements.

Examples:
- low-latency local device group;
- secure private connectivity;
- high-throughput transfer;
- resilient connectivity.

ADCOS -> FleetOS:
normalized connectivity contract/status with ID, accepted requirements, execution state, evidence/measurements, degradation/failure and termination.

Invariant:
provider topology, native credentials and provider SDK objects never enter FleetOS core packages.