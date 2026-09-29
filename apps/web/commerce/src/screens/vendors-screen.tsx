/**
 * @fleetos/web-commerce — D2.3 rendered: the VendorsScreen (W090C).
 *
 * The React component layer over the EXISTING pure view-models
 * (`catalog.ts` + `outcomes.ts` — logic untouched): the vendor
 * RECORDS (typed terms, capabilities, inventory signals, regions),
 * the W072 SCORECARDS (measured quality dimensions over evaluation
 * windows) and the W072 marketplace QUALITY EVIDENCE packs (PROPOSAL
 * — never auto-published), all rendered READ-ONLY. The vendor record
 * detail opens in a controlled Sheet (contextual detail, not a page
 * stack).
 *
 * Discipline: PRESENTATIONAL + FULLY CONTROLLED. The open vendor id is
 * a prop; no business truth in React state.
 */

import type { JSX, ReactNode } from "react";
import { ConsoleStyles } from "../ui/tokens";
import {
  Breadcrumb,
  Card,
  DefinitionList,
  EmptyState,
  PhasePresentation,
  Sheet,
  Skeleton,
  StatusIndicator,
} from "../ui/primitives";
import type { ScreenPhase } from "../ui/primitives";
import { CONSOLE_STATUS_LABEL } from "../ui/status";
import type { VendorCatalogRowView, VendorCatalogView } from "../catalog";
import type {
  EvidencePacksView,
  VendorScorecardsView,
} from "../outcomes";
import { CommerceJourneyRail } from "./commerce-shared";
import type { CommerceJourneyRailStage } from "./commerce-shared";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** The composed vendors data (built by the shell from the builders). */
export interface VendorsScreenData {
  readonly catalog: VendorCatalogView;
  readonly scorecards: VendorScorecardsView;
  readonly evidencePacks: EvidencePacksView;
}

export interface VendorsScreenProps {
  readonly phase: ScreenPhase<VendorsScreenData>;
  /** The open vendor record (the controlled Sheet selection). */
  readonly openVendorId: string | null;
  readonly onOpenVendor: (vendorId: string | null) => void;
  readonly journey: readonly CommerceJourneyRailStage[] | null;
  readonly onOpenJourneyStage?: (stageId: string) => void;
}

// ---------------------------------------------------------------------------
// The vendors table + the record sheet
// ---------------------------------------------------------------------------

function VendorsTable({
  view,
  onOpenVendor,
}: {
  readonly view: VendorCatalogView;
  readonly onOpenVendor: (vendorId: string) => void;
}): JSX.Element {
  return (
    <div className="fos-table-wrap">
      <table className="fos-table">
        <caption>Tenant-approved vendors — {view.total} records, ordered by vendor id</caption>
        <thead>
          <tr>
            <th scope="col">Vendor</th>
            <th scope="col">Quality</th>
            <th scope="col">SLA</th>
            <th scope="col">Warranty</th>
            <th scope="col">Capabilities</th>
            <th scope="col">Regions</th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row: VendorCatalogRowView) => (
            <tr key={row.vendorId} data-vendor-id={row.vendorId}>
              <td>
                <button
                  type="button"
                  className="fos-linklike"
                  aria-label={`Open vendor record ${row.name} (${row.vendorId})`}
                  onClick={(): void => onOpenVendor(row.vendorId)}
                >
                  {row.name}
                </button>
                <br />
                <span className="fos-mono fos-meta">{row.vendorId}</span>
              </td>
              <td>{row.qualityScore}</td>
              <td>{row.slaCoverage}</td>
              <td>{row.warrantyDays}d</td>
              <td>
                <span className="fos-meta">{row.capabilities.length} declared</span>
              </td>
              <td>
                <span className="fos-meta">{row.regions.join(", ")}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VendorRecordSheet({
  row,
  scorecardText,
  packText,
  onClose,
}: {
  readonly row: VendorCatalogRowView;
  readonly scorecardText: string;
  readonly packText: string;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <Sheet
      open={true}
      title={`Vendor record — ${row.name}`}
      onClose={onClose}
      closeLabel="Close the vendor record panel"
    >
      <DefinitionList
        entries={[
          { term: "Vendor id", value: <span className="fos-mono">{row.vendorId}</span> },
          { term: "Revision", value: `r${row.revision}` },
          { term: "Quality score", value: String(row.qualityScore) },
          { term: "SLA coverage", value: String(row.slaCoverage) },
          { term: "Warranty", value: `${String(row.warrantyDays)}d` },
          { term: "Regions", value: row.regions.join(", ") },
          { term: "Capabilities", value: row.capabilities.join(", ") },
          {
            term: "Inventory signals",
            value:
              row.inventory.length === 0
                ? "None declared"
                : row.inventory
                    .map(
                      (signal) =>
                        `${signal.capabilityId}: availability ${signal.availabilityRatio}, lead ${signal.leadTimeDays}d`,
                    )
                    .join("; "),
          },
          { term: "Content hash", value: <span className="fos-mono">{row.contentHash}</span> },
          { term: "Recorded at", value: <span className="fos-mono">{row.createdAt}</span> },
          { term: "Scorecard", value: scorecardText },
          { term: "Evidence pack", value: packText },
        ]}
      />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// The scorecards + evidence packs (W072, read-only)
// ---------------------------------------------------------------------------

function ScorecardsCard({
  scorecards,
}: {
  readonly scorecards: VendorScorecardsView;
}): JSX.Element | null {
  if (scorecards.rows.length === 0) return null;
  return (
    <Card
      title="Vendor scorecards"
      subtitle="Measured quality over evaluation windows — the W072 surfaces, rendered read-only."
    >
      <div className="fos-table-wrap">
        <table className="fos-table">
          <caption>Vendor scorecards — {scorecards.total} revisions</caption>
          <thead>
            <tr>
              <th scope="col">Vendor</th>
              <th scope="col">Revision</th>
              <th scope="col">Window</th>
              <th scope="col">Dimensions</th>
              <th scope="col">Match summary</th>
            </tr>
          </thead>
          <tbody>
            {scorecards.rows.map((row) => (
              <tr key={`${row.vendorId}-r${row.revision}`}>
                <td>
                  <span className="fos-mono fos-meta">{row.vendorId}</span>
                </td>
                <td>
                  r{row.revision}
                  {row.supersedes !== null ? ` (supersedes ${row.supersedes})` : ""}
                </td>
                <td>
                  <span className="fos-mono fos-meta">
                    {row.windowFrom} → {row.windowTo}
                  </span>
                </td>
                <td>
                  {row.dimensions.map((dimension) => (
                    <span key={dimension.kind} style={{ display: "block" }} className="fos-meta">
                      <span className="fos-mono">{dimension.kind}</span>:{" "}
                      {dimension.value === null
                        ? "not scored (no evidence)"
                        : `${dimension.value} (${dimension.numerator}/${dimension.denominator})`}
                    </span>
                  ))}
                </td>
                <td>
                  <span className="fos-meta">
                    {row.matchTotal} total · {row.matchSatisfiable} satisfiable · {row.matchRejected} rejected
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function EvidencePacksCard({
  packs,
}: {
  readonly packs: EvidencePacksView;
}): JSX.Element | null {
  if (packs.rows.length === 0) return null;
  return (
    <Card
      title="Marketplace quality evidence"
      subtitle="Composed, fully-cited claims — PROPOSAL grade (never auto-published)."
    >
      <div className="fos-table-wrap">
        <table className="fos-table">
          <caption>Marketplace evidence packs — {packs.total} revisions</caption>
          <thead>
            <tr>
              <th scope="col">Vendor</th>
              <th scope="col">Status</th>
              <th scope="col">Claims</th>
              <th scope="col">Sources</th>
            </tr>
          </thead>
          <tbody>
            {packs.rows.map((row) => (
              <tr key={`${row.vendorId}-r${row.revision}`}>
                <td>
                  <span className="fos-mono fos-meta">{row.vendorId}</span>
                  <br />
                  <span className="fos-meta">r{row.revision} · window {row.windowFrom} → {row.windowTo}</span>
                </td>
                <td>
                  <StatusIndicator
                    status="informational"
                    label={`PROPOSAL — ${CONSOLE_STATUS_LABEL.informational}`}
                  />
                </td>
                <td>
                  {row.claims.map((claim, index) => (
                    <span key={`${claim.kind}-${index}`} style={{ display: "block" }} className="fos-meta">
                      <span className="fos-mono">{claim.kind}</span>: {claim.value}{" "}
                      <span className="fos-mono fos-meta">[{claim.sourceRefs.join(", ")}]</span>
                    </span>
                  ))}
                  {row.notApplicableScorecardDimensions.length > 0 && (
                    <span className="fos-meta" style={{ display: "block" }}>
                      not scored: {row.notApplicableScorecardDimensions.join(", ")}
                    </span>
                  )}
                </td>
                <td>
                  <span className="fos-mono fos-meta">{row.sourceRecordIds.join(", ")}</span>
                  <br />
                  <span className="fos-mono fos-meta">{row.contentHash}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

/** The rendered vendors screen (records, scorecards, quality evidence — read-only). */
export function VendorsScreen(props: VendorsScreenProps): JSX.Element {
  const { phase } = props;
  const ready = phase.kind === "ready" ? phase.view : null;

  let body: ReactNode;
  if (phase.kind === "loading") {
    body = (
      <Card title="Vendors">
        <Skeleton label="Loading the vendor surface" rows={6} />
      </Card>
    );
  } else if (phase.kind === "error" || phase.kind === "invalid") {
    body = <PhasePresentation phase={phase} loadingLabel="Loading the vendor surface" />;
  } else if (ready === null) {
    body = null;
  } else {
    body = (
      <>
        {ready.catalog.rows.length === 0 ? (
          <EmptyState
            title="No vendors are enrolled yet"
            hint="Tenant-approved vendor records carry the typed terms (quality, SLA, warranty), capabilities, inventory signals and regions the matching engines consume."
          />
        ) : (
          <Card
            title="Vendor records"
            subtitle="The tenant-approved vendor catalog — typed terms displayed verbatim."
          >
            <VendorsTable
              view={ready.catalog}
              onOpenVendor={(vendorId): void => props.onOpenVendor(vendorId)}
            />
          </Card>
        )}
        <ScorecardsCard scorecards={ready.scorecards} />
        <EvidencePacksCard packs={ready.evidencePacks} />
      </>
    );
  }

  // The open vendor's record sheet (contextual detail, fully controlled).
  let sheet: ReactNode = null;
  if (ready !== null && props.openVendorId !== null) {
    const row = ready.catalog.rows.find((candidate) => candidate.vendorId === props.openVendorId);
    if (row !== undefined) {
      const scorecard = ready.scorecards.rows.find(
        (candidate) => candidate.vendorId === row.vendorId,
      );
      const pack = ready.evidencePacks.rows.find((candidate) => candidate.vendorId === row.vendorId);
      sheet = (
        <VendorRecordSheet
          row={row}
          scorecardText={
            scorecard === undefined
              ? "No scorecard revision is recorded for this vendor."
              : `Scorecard ${scorecard.scorecardId} r${scorecard.revision}: ${scorecard.dimensions
                  .map((dimension) => `${dimension.kind}=${dimension.value ?? "not scored"}`)
                  .join(", ")} (window ${scorecard.windowFrom} → ${scorecard.windowTo}).`
          }
          packText={
            pack === undefined
              ? "No evidence pack is composed for this vendor."
              : `Evidence pack ${pack.packId} r${pack.revision} (${pack.status}): ${String(pack.claims.length)} cited claims over ${String(pack.sourceRecordIds.length)} source records.`
          }
          onClose={(): void => props.onOpenVendor(null)}
        />
      );
    }
  }

  return (
    <section className="fos-scope fos-screen" aria-label="Commerce — vendors">
      <ConsoleStyles />
      <Breadcrumb items={[{ label: "Commerce" }, { label: "Vendors", current: true }]} />
      <header className="fos-screen-header">
        <div>
          <h1 className="fos-screen-title">Vendors</h1>
          <p className="fos-screen-subtitle">
            {phase.kind === "ready"
              ? `${phase.view.catalog.total} vendor record${phase.view.catalog.total === 1 ? "" : "s"} · ${phase.view.scorecards.total} scorecard revision${phase.view.scorecards.total === 1 ? "" : "s"} · ${phase.view.evidencePacks.total} evidence pack${phase.view.evidencePacks.total === 1 ? "" : "s"}`
              : "The vendor records, measured scorecards and marketplace quality evidence — read-only."}
          </p>
        </div>
      </header>
      {props.journey !== null && props.journey.length > 0 && (
        <CommerceJourneyRail stages={props.journey} onOpenStage={props.onOpenJourneyStage} />
      )}
      {body}
      {sheet}
    </section>
  );
}

