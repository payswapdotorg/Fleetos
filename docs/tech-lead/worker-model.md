Tech Lead + 3 Worker Model

Tech Lead:
architecture, ADRs, assignment, dependency graph, shared contracts, integration convergence, CI, release and acceptance.

Worker A - Device Edge:
agent/runtime, platform adapters, recovery, device/recovery UI and privacy/device-agent hardening.
Typical paths: apps/agent, packages/device-adapters, packages/recovery, apps/web/device, apps/web/recovery.

Worker B - Intelligence + Control:
Device/observation control-plane work assigned to B, health, diagnosis, security, Contract Guardian, Fleet Actions, printing, Arena integration, learning adoption and security/policy/action UI.
Typical paths: packages/device-model, packages/health, packages/security, packages/policy, packages/actions, packages/learning, packages/integrations/arena, apps/web/security, apps/web/actions.

Worker C - Workload + Commerce:
tenant/auth/audit bootstrap during W012, workload models, vendors, procurement, software subscriptions, maintenance, Aurum integration, commercial quality and workload/commerce/connectivity UI.
Typical paths: packages/identity, packages/audit, packages/workloads, packages/vendors, packages/procurement, packages/software, packages/maintenance, packages/integrations/aurum, apps/web/workloads, apps/web/commerce.

Shared seam:
packages/contracts is shared but Tech Lead-owned during active waves. Workers may add local types behind module boundaries but may not change a public cross-module contract without Tech Lead approval.

Every worker PR contains implementation, tests, module documentation, contract evidence, known limitations and no unrelated refactor.