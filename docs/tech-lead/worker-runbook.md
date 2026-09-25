# Worker Runbook

Before coding:
1. Read the work item.
2. Read its owning module contract.
3. Read upstream contracts.
4. Confirm file ownership.
5. Identify provider dependencies.

During coding:
- test invariants early;
- preserve public contract semantics;
- isolate provider details;
- use correlation, causation and idempotency;
- audit consequential actions.

Before PR:
- run architecture checks;
- run unit/integration checks;
- verify forbidden imports;
- update docs;
- attach evidence;
- record deviations.

Do not solve neighboring work items opportunistically.