# Tech Lead + 3 Worker Model

Tech Lead:
architecture, ADRs, assignment, dependency graph, shared contracts, integration, CI, release and acceptance.

Worker A - Device Edge:
agent/runtime, Device Twin ingestion, OS/platform adapters, mobile/printer adapters and recovery.
Owned paths: apps/agent, packages/device-model, packages/device-adapters, packages/recovery.

Worker B - Intelligence + Control:
health, diagnosis, security, Contract Guardian, action execution, printing and learning adoption.
Owned paths: packages/health, packages/security, packages/policy, packages/actions, packages/learning.

Worker C - Workload + Commerce:
workload models, recommendations, vendors, procurement, software subscriptions and maintenance.
Owned paths: packages/workloads, packages/vendors, packages/procurement, packages/software, packages/maintenance.

Workers integrate through packages/contracts. The Tech Lead alone changes shared contracts during active waves.

Every worker PR contains implementation, tests, module documentation, contract evidence, known limitations and no unrelated refactor.