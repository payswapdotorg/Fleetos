# @fleetos/learning

Convert outcomes into evaluation cases and capability adoption records. Arena owns capability learning/certification; FleetOS owns operational adoption.

## Ownership

Lane: `worker-b` (per `spec/worker-ownership.yaml`).

## Frozen spec source

spec/work-items/WORK-ITEM-CATALOG.md W070; spec/ARCHITECTURE-LOCK.md item 9; spec/integration/ARENA.md.

## W070 state

The real learning/evaluation loop (the closed loop that converts FLEET
outCOMES into Arena evaluation cases and capability adoption records):

- `src/outcome-observation.ts` (D1) — typed, provider-neutral OUTCOME
  observation records derived from the four established domain surfaces
  through STRUCTURAL seams (the W040-disclosed pattern): health
  treatment outcomes (W021), action plan outcomes (W041), delivery
  outcomes (W050C aurum), maintenance work-order outcomes (W042). Every
  observation carries tenant scope, subject ref, ground-truth
  label/value, evidence refs, and an INJECTED observedAt instant.
- `src/evaluation-conversion.ts` (D2) — pure, deterministic conversion
  into Arena evaluation-case SUBMISSION PROPOSALS (the W050B submission
  shapes consumed through a structural seam); refuses machine-stably
  when an outcome lacks required ground truth; PROPOSAL-gated by the
  frozen GuardianDecision seam (ALLOW/WARN -> PROPOSED,
  REQUIRE_APPROVAL -> PARKED, BLOCK -> REJECTED). The conversion NEVER
  submits.
- `src/adoption-ledger.ts` (D3) — the versioned append-only capability
  adoption ledger derived from certified capability metadata (the W050B
  adoption boundary consumed structurally): human approver id +
  approved-at instant (the explicit grant), supersession discipline,
  FAIL-CLOSED certification boundary.
- `src/audit-seam.ts` (D4) — the injected audit sink seam
  (W011/W021/W031/W050B pattern; structurally satisfied by
  @fleetos/audit's sink adapter — proven by test into the REAL
  hash-chained log).

src/ imports `@fleetos/contracts` ONLY. Every domain surface (health,
actions, aurum, maintenance, arena, policy, audit) is consumed through
structural seams with the REAL packages injected at the binding sites in
`test/` (the established cross-lane proof pattern; declared as
devDependencies for the test-scope bindings). Do not import internals
across module boundaries (see `tools/check-ownership.mjs`).
