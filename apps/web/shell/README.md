# @fleetos/web-shell — the Control Tower (W061 [TL])

Lane: `tech-lead` (per `spec/worker-ownership.yaml`): `apps/web/shell/`.

The Control Tower is the operator console's composition layer over the
six UI surface lanes: **navigation**, **permissions**, **cross-surface
journeys**, **discoverability**, and **end-to-end UX coherence**. Like
every FleetOS UI lane it is pure TypeScript view-models + state
machines — no rendered app, no clock, no entropy, no I/O; the operator
front-end renders these shapes.

## Modules

- `src/navigation.ts` — the frozen area order (`SHELL_AREA_ORDER`), the
  per-area view vocabulary (`SHELL_AREA_VIEWS`), route validation with
  machine-stable refusals (`unknown_area` / `unknown_view`), sections,
  breadcrumbs, the complete route table, and the surface-vocabulary
  integrity check used at the binding site.
- `src/permissions.ts` — the frozen role union, the interaction matrix
  (observe/propose/approve/dispatch/destructive), the owner-only
  destructive surface (the W040/W060 discipline mirrored at the
  presentation layer), and permission summaries.
- `src/journeys.ts` — cross-surface journey descriptors (finding ->
  plan -> approval -> verification; diagnosis -> work order -> vendor
  match; lost-device recovery; connectivity onboarding), deterministic
  digests, and progress derivation. Journeys are DESCRIPTIVE: they
  never mutate truth or bypass a domain gate.
- `src/discoverability.ts` — the deterministic cross-surface search
  index: exact > keyword > prefix > token ranking, ties by
  (area, recordId); blank queries refuse machine-stably.
- `src/coherence.ts` — the uniform presentation contract: the frozen
  status-band vocabulary, the total band -> tone mapping, per-area
  empty states, and `presentationOf` (unknown bands refuse — the
  vocabulary extends only through the Tech Lead).

## Structural seams (the W040-disclosed pattern)

`src/` imports the shared seam `@fleetos/contracts` ONLY. The six
surface lanes are consumed through STRUCTURAL descriptors
(`src/seams.ts` — module identity, area, views, record kinds) and
record-summary seams; the REAL binding is proven by
`test/binding-shell.test.ts`, which imports the six REAL
`@fleetos/web-*` packages and checks:

1. every REAL module constructs a descriptor that agrees with the
   frozen navigation vocabulary;
2. REAL view-model records (e.g. `DeviceRowViewModel`,
   `FindingsListItemView`) project structurally into the
   discoverability/coherence seams;
3. every builtin journey's record kinds are covered by the descriptors;
4. the REAL identity `TenantContext` satisfies the shell tenant scope.

`test/src-discipline.test.ts` mechanically proves the import
discipline (shared seam + intra-surface relative only, no `any`, no
clock/random/IO tokens, no domain re-exports).

## History

W001 placed this directory as an intentionally-empty Tech-Lead
territory; W061 built it. The W060B lanes' normalization
(`apps/web/security` + `apps/web/actions` promoted from plain folders
to workspace packages with specifier imports) also landed in the W061
acceptance — see `docs/tech-lead/SKELETON-NOTES.md` § Wave 6.
