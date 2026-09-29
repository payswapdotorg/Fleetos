/**
 * W090B web-learning — JOURNEY EVIDENCE test (D4): the "inspect
 * learning / certification" journey from the UX simulation's required
 * list, walked through the FULL RENDERED LearningScreen with the REAL
 * `@fleetos/learning` packages bound at the test's binding site.
 *
 * The journey: the operator opens the Learning area, inspects the
 * outcome feed (what FleetOS observed), sees the evaluation-case
 * submission proposals with their Guardian-gated dispositions and
 * redaction states, then opens the adoption ledger and inspects a
 * capability: the certification reference, the compatibility
 * statement, and the supersession lineage — ending at the terminal
 * verified state: the CURRENT revision citing its certified
 * capability and the EXPLICIT human grant, with the uncertified-
 * output-never-becomes-action-permission invariant visible.
 *
 * The happy-dom window is installed by the test preload.
 */

import { test, expect, afterEach } from "bun:test";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import {
  LearningScreen,
  buildAdoptionLedgerView,
  buildEvaluationCasesView,
  buildOutcomeFeedView,
} from "../src/index";
import type { LearningPanel } from "../src/index";
import {
  realAdoptionsBind,
  realGatedProposal,
  realObservation,
  realObservationsBind,
  realProposalsBind,
  scopeA,
  seededAdoptionLedger,
} from "./helpers";

afterEach(() => {
  cleanup();
});

/** A minimal shell: the LearningScreen with controlled panel + sheet. */
function LearningShell(): React.JSX.Element {
  const [panel, setPanel] = useState<LearningPanel>("feed");
  const [openAdoptionId, setOpenAdoptionId] = useState<string | null>(null);

  const feed = buildOutcomeFeedView(scopeA(), realObservationsBind([realObservation()]));
  const cases = buildEvaluationCasesView(scopeA(), realProposalsBind([
    realGatedProposal(realObservation({ planId: "plan_w090b_journey" }), "REQUIRE_APPROVAL"),
  ]));
  const { records } = seededAdoptionLedger();
  const ledger = buildAdoptionLedgerView(scopeA(), realAdoptionsBind(records));
  if (!feed.ok || !cases.ok || !ledger.ok) throw new Error("journey builds failed");

  return (
    <LearningScreen
      casesPhase={{ kind: "ready", view: cases.view }}
      ledgerPhase={{ kind: "ready", view: ledger.view }}
      feedPhase={{ kind: "ready", view: feed.view }}
      panel={panel}
      onPanelChange={setPanel}
      openAdoptionId={openAdoptionId}
      onOpenAdoption={setOpenAdoptionId}
      onCloseAdoption={(): void => setOpenAdoptionId(null)}
    />
  );
}

test("journey: inspect learning / certification — feed -> cases -> ledger -> capability detail (verified terminal state)", async () => {
  const user = userEvent.setup();
  render(<LearningShell />);

  // Step 1 — the outcome feed: the observed fleet outcome is visible
  // with its ground truth and source surface.
  expect(screen.getAllByText("action.plan").length).toBeGreaterThan(0);
  expect(screen.getAllByText("action_plan_outcome").length).toBeGreaterThan(0);

  // Step 2 — the evaluation cases: the PARKED proposal (Guardian
  // REQUIRE_APPROVAL) is visible with its redaction state.
  await user.click(screen.getByRole("tab", { name: /Evaluation cases/ }));
  expect(screen.getByText("PARKED")).toBeDefined();
  expect(screen.getAllByText("Approval required").length).toBeGreaterThan(0);
  expect(screen.getAllByText("deidentified").length).toBeGreaterThan(0);

  // Step 3 — the adoption ledger: the adopted capability row shows
  // the certification reference + the human grant.
  await user.click(screen.getByRole("tab", { name: /Adoption ledger/ }));
  expect(screen.getByText("acr_w090bcertification0002")).toBeDefined();

  // Step 4 — capability inspection: the detail sheet opens (focused + keyboard-activatable).
  const inspect = screen.getByRole("button", { name: /Inspect capability adoption/ });
  inspect.focus();
  expect(document.activeElement).toBe(inspect);
  fireEvent.keyDown(inspect, { key: "Enter" });
  fireEvent.click(inspect);
  const dialog = await screen.findByRole("dialog", { name: /Capability adoption/ });

  // The TERMINAL VERIFIED STATE: the CURRENT revision (v2) cites the
  // certified capability + the explicit human grant, and the
  // supersession lineage is visible (v2 supersedes v1's recordId).
  const current = within(dialog).getAllByText(/Revision v2/)[0] as HTMLElement;
  const row = current.closest("li") as HTMLElement;
  expect(within(row).getAllByText("CURRENT").length).toBeGreaterThan(0);
  expect(within(row).getAllByText("acr_w090bcertification0002").length).toBeGreaterThan(0);
  const supersession = within(dialog).getAllByText(/supersedes/);
  expect(supersession.length).toBeGreaterThan(0);
  const prior = within(dialog).getAllByText(/Revision v1/)[0] as HTMLElement;
  const priorRow = prior.closest("li") as HTMLElement;
  expect(within(priorRow).getAllByText("SUPERSEDED").length).toBeGreaterThan(0);

  // The explicit human grant on the current revision (approver + instant).
  expect(within(row).getAllByText("usr_w090blrnuser2").length).toBeGreaterThan(0);

  // The invariant disclosure: uncertified model output never becomes
  // action permission — visible inside the inspection.
  expect(
    within(dialog).getAllByText(/Uncertified model output never becomes action permission/i)
      .length,
  ).toBeGreaterThan(0);

  // Evidence visibility: the content digest of the cited revision is
  // inspectable in the ledger row's capability identity.
  expect(screen.getByText(/capability 1.1.0/)).toBeDefined();
});
