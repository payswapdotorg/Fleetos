# FleetOS Agent Governance

Authority:
1. spec/ARCHITECTURE.md
2. spec/ARCHITECTURE-LOCK.md
3. spec/MODULE-DEPENDENCY-MAP.md
4. spec/WORK-ITEM-DEPENDENCY-GRAPH.md
5. spec/work-items/WORK-ITEM-CATALOG.md
6. Tech Lead handoff/runbook
7. Code

Mandatory rules:
- Architecture first; code second.
- A work item is the maximum scope a worker may implement.
- Workers may not silently change frozen contracts, state machines, event schemas, security rules or ownership boundaries.
- Cross-module imports use public contracts only.
- Provider-specific APIs/types never enter core domain contracts.
- Domain truth is PostgreSQL-owned; Redis is queue/cache/lock only; object storage stores artifacts.
- Consequential actions are authorization-checked, idempotent, auditable and verified.
- Device agents are untrusted inputs to the control plane.
- Every observation and command is authenticated, tenant-scoped and schema-validated.
- No worker modifies another worker's owned files without explicit Tech Lead reassignment.
- Shared contract changes happen in the Tech Lead lane and require an ADR.
- External products integrate through provider-neutral contracts.
- Privacy, tenant isolation and destructive-action gates are acceptance criteria, not optional hardening.

Parallelism:
Exactly three implementation workers may be active concurrently. The Tech Lead is the fourth coordination role and owns integration, architecture, acceptance and merge.

Stop-the-line:
- requirement contradicts a frozen lock;
- two work items need the same domain-owned files;
- provider cannot satisfy a provider-neutral contract;
- destructive action lacks authorization;
- telemetry cannot prove device identity;
- implementation requires a new dependency not in the graph.