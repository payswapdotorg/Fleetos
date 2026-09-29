/**
 * @fleetos/web-device — D1 rendered: the DeviceFleetScreen (W090A).
 *
 * The React component layer over the EXISTING pure roster view-model
 * (`device-list.ts` — logic untouched): a semantic roster `<table>`
 * with facet filters, deterministic ordering, pagination, selection,
 * and per-device status indicators drawn from the design contract's
 * status vocabulary (state is NEVER conveyed by color alone — every
 * indicator carries its text label).
 *
 * Discipline: PRESENTATIONAL + FULLY CONTROLLED. The filter, sort,
 * page, search text and selection ALL arrive as props (view-model
 * output + the parent's current query state); every user intent flows
 * out through callbacks that the shell routes through the established
 * view-model functions (`toggleSelection`, `selectVisible`, the
 * `DeviceListQuery` rebuild). No business truth in React state.
 *
 * Exact states (first-class): loading skeletons, instructive zero
 * states (no devices enrolled yet vs. no matches for the filters),
 * actionable error alerts, and the invalid-build failure list.
 *
 * Deterministic: same props -> byte-identical JSX (asserted by test);
 * no clock, no randomness, no I/O — instants arrive from the
 * view-model.
 */

import type { JSX, ReactNode } from "react";
import type { DeviceId, DeviceLifecycleState } from "@fleetos/contracts";
import { isDeviceSelected, selectionDeviceIds } from "../device-list";
import type {
  DeviceListFacets,
  DeviceListFilter,
  DeviceListSort,
  DeviceListSortField,
  DeviceListViewModel,
  DeviceSelection,
  StalenessBand,
} from "../device-list";
import { ConsoleStyles } from "../ui/tokens";
import {
  Badge,
  Breadcrumb,
  Button,
  Card,
  EmptyState,
  PhasePresentation,
  Skeleton,
  StatusIndicator,
  Tooltip,
} from "../ui/primitives";
import type { ScreenPhase } from "../ui/primitives";
import { CONSOLE_STATUS_LABEL, postureConsoleStatus, stalenessConsoleStatus } from "../ui/status";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** The screen's controlled query state (owned by the shell, derived by the VMs). */
export interface DeviceFleetQueryState {
  readonly search: string;
  readonly facet: DeviceListFilter;
  readonly sort: DeviceListSort;
  readonly page: { readonly offset: number; readonly limit: number };
}

export interface DeviceFleetScreenProps {
  readonly phase: ScreenPhase<DeviceListViewModel>;
  readonly query: DeviceFleetQueryState;
  readonly selection: DeviceSelection;
  readonly onSearchChange: (text: string) => void;
  readonly onFacetChange: (facet: DeviceListFilter) => void;
  readonly onSortChange: (sort: DeviceListSort) => void;
  readonly onPageChange: (page: { offset: number; limit: number }) => void;
  readonly onToggleDevice: (deviceId: DeviceId) => void;
  readonly onSelectVisible: () => void;
  readonly onClearSelection: () => void;
  readonly onOpenDevice: (deviceId: DeviceId) => void;
  /** The enrollment journey entry point (the UX journey gap's fix). */
  readonly onEnroll: () => void;
}

// ---------------------------------------------------------------------------
// Facet chips (single-select toggle per facet family)
// ---------------------------------------------------------------------------

interface FacetGroupProps {
  readonly legend: string;
  readonly facetKind: "lifecycle" | "posture" | "ownership" | "staleness";
  readonly entries: readonly { readonly value: string; readonly count: number }[];
  readonly facet: DeviceListFilter;
  readonly onChange: (facet: DeviceListFilter) => void;
}

function lifecycleFacetMatches(facet: DeviceListFilter, value: string): boolean {
  return facet.kind === "lifecycle" && facet.state === (value as DeviceLifecycleState);
}
function postureFacetMatches(facet: DeviceListFilter, value: string): boolean {
  return facet.kind === "posture" && facet.summary === value;
}
function ownershipFacetMatches(facet: DeviceListFilter, value: string): boolean {
  return facet.kind === "ownership" && facet.ownerType === value;
}
function stalenessFacetMatches(facet: DeviceListFilter, value: string): boolean {
  return facet.kind === "observed" && facet.band === (value as StalenessBand);
}

const FACET_MATCHERS: Readonly<
  Record<FacetGroupProps["facetKind"], (facet: DeviceListFilter, value: string) => boolean>
> = Object.freeze({
  lifecycle: lifecycleFacetMatches,
  posture: postureFacetMatches,
  ownership: ownershipFacetMatches,
  staleness: stalenessFacetMatches,
});

const STALENESS_DISPLAY: Readonly<Record<StalenessBand, string>> = Object.freeze({
  never_observed: "Never observed",
  fresh: "Fresh",
  unknown: "Indeterminate",
  stale: "Stale",
} as const);

function FacetGroup({ legend, facetKind, entries, facet, onChange }: FacetGroupProps): JSX.Element | null {
  if (entries.length === 0) return null;
  const isPressed = FACET_MATCHERS[facetKind];
  return (
    <fieldset className="fos-fieldset">
      <legend>{legend}</legend>
      <div className="fos-chipbar">
        {entries.map((entry) => {
          const pressed = isPressed(facet, entry.value);
          return (
            <button
              key={entry.value}
              type="button"
              className="fos-chip"
              aria-pressed={pressed}
              aria-label={`${legend}: ${entry.value} (${entry.count} device${entry.count === 1 ? "" : "s"})`}
              onClick={(): void => {
                if (pressed) {
                  onChange({ kind: "all" });
                } else if (facetKind === "lifecycle") {
                  onChange({ kind: "lifecycle", state: entry.value as DeviceLifecycleState });
                } else if (facetKind === "posture") {
                  onChange({ kind: "posture", summary: entry.value });
                } else if (facetKind === "ownership") {
                  onChange({ kind: "ownership", ownerType: entry.value });
                } else {
                  onChange({ kind: "observed", band: entry.value as StalenessBand });
                }
              }}
            >
              {facetKind === "staleness"
                ? STALENESS_DISPLAY[entry.value as StalenessBand]
                : entry.value}{" "}
              ({entry.count})
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Sortable header
// ---------------------------------------------------------------------------

interface SortHeaderProps {
  readonly field: DeviceListSortField;
  readonly label: string;
  readonly sort: DeviceListSort;
  readonly onSortChange: (sort: DeviceListSort) => void;
}

function SortHeader({ field, label, sort, onSortChange }: SortHeaderProps): JSX.Element {
  const active = sort.field === field;
  const ariaSort = active ? (sort.direction === "asc" ? "ascending" : "descending") : "none";
  const nextDirection = active && sort.direction === "asc" ? "desc" : "asc";
  return (
    <th scope="col" aria-sort={ariaSort} data-testid={`sort-${field}`}>
      <button
        type="button"
        className="fos-th-sort"
        aria-label={`Sort by ${label}${active ? ` (${sort.direction === "asc" ? "ascending" : "descending"})` : ""}`}
        onClick={(): void => onSortChange({ field, direction: nextDirection })}
      >
        {label}
        <span aria-hidden="true">{active ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span>
      </button>
    </th>
  );
}

// ---------------------------------------------------------------------------
// The roster table
// ---------------------------------------------------------------------------

interface FleetTableProps {
  readonly view: DeviceListViewModel;
  readonly selection: DeviceSelection;
  readonly sort: DeviceListSort;
  readonly onSortChange: (sort: DeviceListSort) => void;
  readonly onToggleDevice: (deviceId: DeviceId) => void;
  readonly onOpenDevice: (deviceId: DeviceId) => void;
}

function FleetTable({ view, selection, sort, onSortChange, onToggleDevice, onOpenDevice }: FleetTableProps): JSX.Element {
  return (
    <div className="fos-table-wrap">
      <table className="fos-table">
        <caption>Device fleet roster — {view.totalMatches} of {view.totalDevices} devices match the current filters</caption>
        <thead>
          <tr>
            <th scope="col">Select</th>
            <SortHeader field="deviceId" label="Device" sort={sort} onSortChange={onSortChange} />
            <SortHeader field="lifecycle" label="Lifecycle" sort={sort} onSortChange={onSortChange} />
            <SortHeader field="posture" label="Posture" sort={sort} onSortChange={onSortChange} />
            <th scope="col">Ownership</th>
            <SortHeader field="lastObservedAt" label="Last observed" sort={sort} onSortChange={onSortChange} />
            <th scope="col">Staleness</th>
            <th scope="col">Findings</th>
            <th scope="col">Workloads</th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row) => {
            const selected = isDeviceSelected(selection, row.deviceId);
            return (
              <tr key={row.deviceId} aria-selected={selected} data-device-id={row.deviceId}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected}
                    aria-label={`Select ${row.displayName} (${row.deviceId})`}
                    onChange={(): void => onToggleDevice(row.deviceId)}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="fos-linklike"
                    onClick={(): void => onOpenDevice(row.deviceId)}
                  >
                    {row.displayName}
                  </button>
                  <br />
                  <span className="fos-mono fos-meta">{row.deviceId}</span>
                </td>
                <td>
                  <Badge>{row.lifecycleState}</Badge>
                </td>
                <td>
                  <StatusIndicator
                    status={postureConsoleStatus(row.postureSummary)}
                    label={`${row.postureSummary} — ${CONSOLE_STATUS_LABEL[postureConsoleStatus(row.postureSummary)]}`}
                  />
                </td>
                <td>
                  {row.ownership.ownerType}
                  {row.ownership.assignedTeam !== undefined && row.ownership.assignedTeam.length > 0 && (
                    <>
                      <br />
                      <span className="fos-meta">{row.ownership.assignedTeam}</span>
                    </>
                  )}
                </td>
                <td>
                  {row.lastObservedAt === null ? (
                    <span className="fos-meta">No observation yet</span>
                  ) : (
                    <Tooltip text="The observation instant, exactly as recorded">
                      <span className="fos-mono fos-meta">{row.lastObservedAt}</span>
                    </Tooltip>
                  )}
                </td>
                <td>
                  <StatusIndicator
                    status={stalenessConsoleStatus(row.staleness)}
                    label={`${STALENESS_DISPLAY[row.staleness]} — ${CONSOLE_STATUS_LABEL[stalenessConsoleStatus(row.staleness)]}`}
                  />
                </td>
                <td>
                  <span className="fos-meta">{row.findingCount}</span>
                  <br />
                  <span className="fos-meta">{row.workloadCount} workloads</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

interface PaginationProps {
  readonly view: DeviceListViewModel;
  readonly page: { readonly offset: number; readonly limit: number };
  readonly onPageChange: (page: { offset: number; limit: number }) => void;
}

function Pagination({ view, page, onPageChange }: PaginationProps): JSX.Element | null {
  if (view.page === "all" || page.limit >= view.totalMatches) {
    return view.totalMatches > 0 ? (
      <p className="fos-meta" role="status">
        Showing all {view.totalMatches} of {view.totalMatches} matched devices.
      </p>
    ) : null;
  }
  const from = view.rows.length === 0 ? 0 : page.offset + 1;
  const to = page.offset + view.rows.length;
  const hasPrev = page.offset > 0;
  const hasNext = page.offset + page.limit < view.totalMatches;
  return (
    <nav className="fos-spread" aria-label="Device roster pagination">
      <p className="fos-meta" role="status">
        Showing {from}–{to} of {view.totalMatches} matched devices ({view.totalDevices} in the fleet).
      </p>
      <div className="fos-row">
        <Button
          disabled={!hasPrev}
          onClick={(): void => onPageChange({ offset: Math.max(0, page.offset - page.limit), limit: page.limit })}
          ariaLabel="Previous page"
        >
          ← Previous
        </Button>
        <Button
          disabled={!hasNext}
          onClick={(): void => onPageChange({ offset: page.offset + page.limit, limit: page.limit })}
          ariaLabel="Next page"
        >
          Next →
        </Button>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// The empty-state discriminators (exact, instructive zero states)
// ---------------------------------------------------------------------------

function FleetEmptyState({
  view,
  onEnroll,
  onFacetChange,
  onSearchChange,
}: {
  readonly view: DeviceListViewModel;
  readonly onEnroll: () => void;
  readonly onFacetChange: (facet: DeviceListFilter) => void;
  readonly onSearchChange: (text: string) => void;
}): JSX.Element {
  if (view.totalDevices === 0) {
    return (
      <EmptyState
        title="No devices are enrolled yet"
        hint="Enroll your existing fleet to bring devices under management. The enrollment journey verifies device identity, records the telemetry scope, and lands on the first observation."
        action={{ label: "Enroll devices", onClick: onEnroll }}
      />
    );
  }
  return (
    <EmptyState
      title="No devices match the current filters"
      hint="Every device was filtered out. Clear the facet filters or the search text to see the roster again."
      action={{
        label: "Clear filters",
        onClick: (): void => {
          onFacetChange({ kind: "all" });
          onSearchChange("");
        },
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

const FLEET_COLUMNS_HINT = "Columns: selection, device, lifecycle, posture, ownership, last observed, staleness, findings.";

/** The rendered device fleet (roster) screen. */
export function DeviceFleetScreen(props: DeviceFleetScreenProps): JSX.Element {
  const { phase, query, selection } = props;
  const selectedIds = phase.kind === "ready" ? selectionDeviceIds(selection) : [];

  let body: ReactNode;
  if (phase.kind === "loading") {
    body = (
      <Card title="Device roster">
        <Skeleton label="Loading the device roster" rows={7} />
      </Card>
    );
  } else if (phase.kind === "error" || phase.kind === "invalid") {
    body = <PhasePresentation phase={phase} loadingLabel="Loading the device roster" />;
  } else {
    const view = phase.view;
    const facets: DeviceListFacets = view.facets;
    body = (
      <>
        {selectedIds.length > 0 && (
          <Card>
            <div className="fos-spread">
              <p className="fos-meta" role="status">
                {selectedIds.length} device{selectedIds.length === 1 ? "" : "s"} selected.
              </p>
              <div className="fos-row">
                <Button onClick={props.onSelectVisible}>Select all on this page</Button>
                <Button variant="ghost" onClick={props.onClearSelection} ariaLabel="Clear the device selection">
                  Clear selection
                </Button>
              </div>
            </div>
          </Card>
        )}
        <Card
          title="Filters"
          subtitle={`Facet counts cover the ${view.totalMatches} matched device${view.totalMatches === 1 ? "" : "s"} (before pagination).`}
        >
          <div className="fos-field">
            <label htmlFor="fos-fleet-search">Search devices</label>
            <input
              id="fos-fleet-search"
              type="search"
              value={query.search}
              placeholder="Manufacturer, model, serial, asset tag, or device id"
              onChange={(event: React.ChangeEvent<HTMLInputElement>): void =>
                props.onSearchChange(event.target.value)
              }
            />
            <span className="fos-field__hint">
              The search matches identity and hardware fields, case-insensitively.
            </span>
          </div>
          <div className="fos-stack" style={{ marginTop: "0.75rem" }}>
            <FacetGroup
              legend="Lifecycle"
              facetKind="lifecycle"
              entries={facets.byLifecycle}
              facet={query.facet}
              onChange={props.onFacetChange}
            />
            <FacetGroup
              legend="Posture"
              facetKind="posture"
              entries={facets.byPosture}
              facet={query.facet}
              onChange={props.onFacetChange}
            />
            <FacetGroup
              legend="Ownership"
              facetKind="ownership"
              entries={facets.byOwnership}
              facet={query.facet}
              onChange={props.onFacetChange}
            />
            <FacetGroup
              legend="Observation freshness"
              facetKind="staleness"
              entries={facets.byStaleness}
              facet={query.facet}
              onChange={props.onFacetChange}
            />
          </div>
        </Card>
        {view.rows.length === 0 ? (
          <FleetEmptyState
            view={view}
            onEnroll={props.onEnroll}
            onFacetChange={props.onFacetChange}
            onSearchChange={props.onSearchChange}
          />
        ) : (
          <Card
            title="Device roster"
            subtitle={FLEET_COLUMNS_HINT}
            actions={
              <Button variant="primary" onClick={props.onEnroll}>Enroll devices</Button>
            }
          >
            <FleetTable
              view={view}
              selection={selection}
              sort={query.sort}
              onSortChange={props.onSortChange}
              onToggleDevice={props.onToggleDevice}
              onOpenDevice={props.onOpenDevice}
            />
            <div style={{ marginTop: "0.75rem" }}>
              <Pagination view={view} page={query.page} onPageChange={props.onPageChange} />
            </div>
          </Card>
        )}
      </>
    );
  }

  return (
    <section className="fos-scope fos-screen" aria-label="Devices — fleet list">
      <ConsoleStyles />
      <Breadcrumb items={[{ label: "Devices" }, { label: "Fleet list", current: true }]} />
      <header className="fos-screen-header">
        <div>
          <h1 className="fos-screen-title">Devices</h1>
          <p className="fos-screen-subtitle">
            {phase.kind === "ready"
              ? `${phase.view.totalDevices} device${phase.view.totalDevices === 1 ? "" : "s"} in your fleet · roster as of ${phase.view.asOf}`
              : "The fleet roster, filters, and selection."}
          </p>
        </div>
        {phase.kind === "ready" && (
          <Button variant="primary" onClick={props.onEnroll}>Enroll devices</Button>
        )}
      </header>
      {body}
    </section>
  );
}
