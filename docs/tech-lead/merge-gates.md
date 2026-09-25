# Merge Gates

Merge only when:
1. work item is authorized;
2. prerequisites are accepted;
3. file ownership is respected;
4. contracts are compatible or an ADR changes them;
5. tenant isolation tests pass;
6. authorization tests cover consequential actions;
7. idempotency/replay tests exist;
8. audit/evidence is produced;
9. provider-specific types do not leak into core;
10. architecture checks pass;
11. unit/integration tests pass;
12. docs and acceptance evidence are updated;
13. user-facing capabilities are discoverable.

Destructive operations additionally require an explicit policy grant, confirmation/pre-authorization and a recovery/rollback story where technically possible.