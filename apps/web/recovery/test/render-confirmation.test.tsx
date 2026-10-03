/**
 * W141 web-recovery — the RENDERED destructive-confirmation flow
 * tests: the full operator journey through the composed
 * DestructiveActionScreen + the confirmation machine, over the REAL
 * gated boundary (`@fleetos/recovery`'s requestDestructiveAction with
 * the REAL Guardian rule set + the REAL adapter) and the REAL
 * `@fleetos/audit` log (through its REAL sink adapter).
 *
 * The rendered journey (SIM-B blocker 4's demanded flow):
 *
 *   click "Request wipe" -> the review dialog opens (consequences +
 *   evidence requirement + the required phrase) -> a premature confirm
 *   REFUSES visibly -> acknowledge + type the phrase -> "Confirm and
 *   dispatch" routes through the REAL boundary -> the visible state
 *   change (the boundary's PARKED request renders with its gate
 *   ledger) + the audit entries written in the REAL hash-chained log.
 *
 * The user is NEVER left to infer that a click failed: every refusal,
 * every outcome, and the state change itself render.
 */

import { test, expect, afterEach } from "bun:test";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { createInMemoryAuditLog, createAuditSinkAdapter } from "@fleetos/audit";
import type { AuditLog } from "@fleetos/audit";
import { requestDestructiveAction } from "@fleetos/recovery";
import type { DestructiveRequestStore } from "@fleetos/recovery";
import { asCorrelationId } from "@fleetos/contracts";
import {
  DestructiveActionScreen,
  acknowledgeConsequences,
  beginDestructiveConfirmation,
  cancelDestructiveConfirmation,
  composeDestructiveActionsFeed,
  dispatchConfirmedDestructive,
  enterConfirmationPhrase,
  markExplicitConfirmation,
  requiredConfirmationPhrase,
} from "../src/index";
import type {
  ConfirmationAuditSink,
  ConfirmationContext,
  DestructiveConfirmationState,
  GatedDestructiveBoundary,
} from "../src/index";
import {
  DEV_A1,
  FULLY_CAPABLE,
  REAL_CASE_TABLE,
  REAL_REQUEST_TABLE,
  SCOPE_A,
  TENANT_A,
  T0,
  USER_1,
  adapter,
  approvalRule,
  atHour,
  createInMemoryRecoveryCaseStore,
  createInMemoryDestructiveRequestStore,
  evidenceRef,
  lostTrigger,
  openCaseOrThrow,
  realCaseSource,
  realDestructiveSource,
  realFindMySource,
  realGuardian,
  ruleSet,
  seededLastSeenLedger,
} from "./helpers";
import type { GuardianRule } from "@fleetos/policy";
import type { RecoveryCaseRecord } from "@fleetos/recovery";

afterEach(() => {
  cleanup();
});

const NOW = atHour(4);
const BANDS = { freshWithinMs: 3_600_000, staleAfterMs: 86_400_000 };
const CONFIRM_AT = atHour(3);

/** The composed destructive-confirmation runtime (the binding site). */
function confirmationRuntime(rules: readonly GuardianRule[]): {
  readonly caseStore: ReturnType<typeof createInMemoryRecoveryCaseStore>;
  readonly requestStore: DestructiveRequestStore;
  readonly caseRecord: RecoveryCaseRecord;
  readonly auditLog: AuditLog;
  readonly sink: ConfirmationAuditSink;
  readonly boundary: GatedDestructiveBoundary;
} {
  const caseStore = createInMemoryRecoveryCaseStore();
  const requestStore = createInMemoryDestructiveRequestStore();
  const caseRecord = openCaseOrThrow(
    caseStore,
    DEV_A1,
    lostTrigger(),
    { lastSeenRecordId: "ls_w141r", lastSeenObservedAt: atHour(3) },
    T0,
  );
  const auditLog = createInMemoryAuditLog();
  const adapted = createAuditSinkAdapter(auditLog, {
    source: "web-recovery.confirmation",
  });
  // The structural binding proof: the REAL sink adapter satisfies the
  // lane's ConfirmationAuditSink seam unchanged.
  const sink: ConfirmationAuditSink = adapted;
  const boundary: GatedDestructiveBoundary = (input) => {
    const result = requestDestructiveAction(
      { tenantId: input.tenantId, correlationId: input.correlationId },
      requestStore,
      caseRecord,
      input.action as "wipe",
      {
        ruleSet: ruleSet(input.tenantId, rules),
        evaluator: realGuardian,
        adapter: adapter(input.tenantId, input.deviceId, FULLY_CAPABLE),
        at: input.at,
        correlationId: input.correlationId,
        policyCacheReady: true,
        requestedBy: input.by,
        evidence: [evidenceRef(`evidence/${input.action}-confirmation`)],
      },
    );
    if (!result.ok) {
      const error = result.error as { code: string; message: string; invariant?: string };
      return { ok: false, reason: error.invariant ?? error.code, message: error.message };
    }
    return { ok: true, record: { requestId: result.record.requestId, status: result.record.status } };
  };
  return { caseStore, requestStore, caseRecord, auditLog, sink, boundary };
}

/** The composed screen shell: the feed + the confirmation machine. */
function ConfirmationShell(props: {
  readonly runtime: ReturnType<typeof confirmationRuntime>;
}): React.JSX.Element {
  const { caseStore, requestStore, sink, boundary } = props.runtime;
  const [confirmation, setConfirmation] = useState<DestructiveConfirmationState>({ kind: "idle" });
  const [refusalVisible, setRefusalVisible] = useState<
    import("../src/index").ConfirmationRefusal | undefined
  >(undefined);

  const context: ConfirmationContext = {
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    caseId: props.runtime.caseRecord.caseId,
    action: "wipe",
    by: USER_1 as string,
    correlationId: asCorrelationId("cor_w141render01"),
  };

  // The composed feed over the REAL stores (re-composed per render —
  // no business truth in React state).
  const caseFeed = composeDestructiveActionsFeed(
    SCOPE_A,
    {
      cases: realCaseSource(caseStore),
      requests: realDestructiveSource(requestStore),
      findMy: realFindMySource(seededLastSeenLedger([])),
      capabilities: { capabilities: () => ({ ...FULLY_CAPABLE }) as never },
    },
    REAL_REQUEST_TABLE,
    REAL_CASE_TABLE,
    DEV_A1,
    { now: NOW, ...BANDS },
  );

  return (
    <DestructiveActionScreen
      phase={caseFeed.phase}
      journey={caseFeed.journey}
      deviceId={DEV_A1}
      actions={caseFeed.actions}
      lostFlow={caseFeed.lostFlow}
      onRequestAction={(action): void => {
        // The gated path: a request OPENS the explicit confirmation.
        setConfirmation(
          beginDestructiveConfirmation(
            confirmation,
            SCOPE_A,
            { ...context, action },
            CONFIRM_AT,
          ),
        );
        setRefusalVisible(undefined);
      }}
      onApproveRequest={(): void => {}}
      onOpenCases={(): void => {}}
      onOpenFindMy={(): void => {}}
      confirmation={{
        state: confirmation,
        refusal: refusalVisible,
        onAcknowledge: (): void => setConfirmation(acknowledgeConsequences(confirmation)),
        onPhraseChange: (phrase): void => setConfirmation(enterConfirmationPhrase(confirmation, phrase)),
        onConfirm: (): void => setConfirmation(markExplicitConfirmation(confirmation, CONFIRM_AT)),
        onDispatch: (): void => {
          const result = dispatchConfirmedDestructive(confirmation, {
            at: CONFIRM_AT,
            boundary,
            auditSink: sink,
          });
          setConfirmation(result.state);
          setRefusalVisible(result.refusal === undefined ? undefined : result.refusal);
        },
        onCancel: (): void => {
          setConfirmation(cancelDestructiveConfirmation(confirmation, CONFIRM_AT));
          setRefusalVisible(undefined);
        },
      }}
    />
  );
}

test("RENDER: the destructive confirmation refuses without the explicit confirmation, then dispatches visibly with audit", async () => {
  const user = userEvent.setup();
  // The REAL approval rule: the Guardian holds the wipe for a human.
  const runtime = confirmationRuntime([approvalRule(TENANT_A, "device.wipe")]);

  render(<ConfirmationShell runtime={runtime} />);
  expect(screen.getByRole("region", { name: "Recovery — Destructive actions" })).toBeTruthy();

  // --- Stage 1: no request yet — the wipe card's gate ledger is unmet.
  const wipeCard = screen.getByText(/Erases all data on the device/).closest("section");
  expect(wipeCard).toBeTruthy();
  if (wipeCard === null) throw new Error("unreachable");
  expect(within(wipeCard).getByText(/Guardian: not_evaluated — Unknown/)).toBeTruthy();

  // --- Stage 2: click "Request wipe" -> the explicit review dialog opens.
  await user.click(within(wipeCard).getByRole("button", { name: "Request wipe" }));
  const dialog = screen.getByRole("dialog", { name: /Confirm Wipe — explicit confirmation required/ });
  expect(dialog).toBeTruthy();
  expect(within(dialog).getByText(/Erases all data on the device\. This effect is irreversible\./)).toBeTruthy();
  expect(within(dialog).getByText(`Type exactly: CONFIRM WIPE ${DEV_A1 as string}`)).toBeTruthy();

  // --- Stage 3: a premature confirm REFUSES — visibly, machine-stably.
  await user.click(within(dialog).getByRole("button", { name: "Confirm the phrase" }));
  // The state is unchanged (reviewing) — the dialog stays open and the
  // machine's refusal is visible in the phrase field's error.
  expect(screen.getByRole("dialog", { name: /Confirm Wipe/ })).toBeTruthy();
  // No request was routed yet: no request state in the card.
  expect(within(wipeCard).queryByText(/PROPOSAL in the gated pipeline/i)).toBeNull();

  // --- Stage 4: acknowledge + type the exact phrase -> the gate unlocks.
  await user.click(
    within(dialog).getByRole("checkbox", {
      name: /I understand the expected effect and the evidence requirement/,
    }),
  );
  const phraseInput = within(dialog).getByLabelText(/Type the confirmation phrase/);
  await user.clear(phraseInput);
  await user.type(phraseInput, `CONFIRM WIPE ${DEV_A1 as string}`);
  await user.click(within(dialog).getByRole("button", { name: "Confirm the phrase" }));

  // --- Stage 5: "Confirm and dispatch wipe" routes through the REAL
  // boundary (REQUIRE_APPROVAL -> PARKED — a PROPOSAL, never executed).
  await user.click(within(dialog).getByRole("button", { name: /Confirm and dispatch wipe/ }));
  // The dialog closes (the confirmation reached its terminal feedback).
  expect(screen.queryByRole("dialog", { name: /Confirm Wipe/ })).toBeNull();

  // --- Stage 6: the visible outcome + the state change.
  const outcome = screen.getByText(/The last destructive-confirmation attempt/).closest("section");
  expect(outcome).toBeTruthy();
  if (outcome === null) throw new Error("unreachable");
  expect(within(outcome).getByText(/dispatched — Request /)).toBeTruthy();
  expect(within(outcome).getByText(/status PARKED/)).toBeTruthy();

  // The recomposed screen renders the REAL parked request with its gate.
  const updatedCard = screen.getByText(/Erases all data on the device/).closest("section");
  if (updatedCard === null) throw new Error("updated card missing");
  expect(within(updatedCard).getByText(/Guardian: REQUIRE_APPROVAL — Approval required/)).toBeTruthy();
  expect(within(updatedCard).getByText(/PROPOSAL in the gated pipeline/i)).toBeTruthy();
  expect(within(updatedCard).getByText(/has NOT executed/i)).toBeTruthy();

  // --- Stage 7: the audit entries ARE written in the REAL hash-chained log.
  const records = runtime.auditLog.records({
    tenantId: TENANT_A,
    correlationId: asCorrelationId("cor_w141render01"),
  });
  const actions = records.map((record) => record.action);
  expect(actions).toContain("recovery.destructive.confirmation.explicit");
  expect(actions).toContain("recovery.destructive.confirmation.dispatched");
  expect(
    runtime.auditLog.verify({ tenantId: TENANT_A, correlationId: asCorrelationId("cor_w141render01") }).ok,
  ).toBe(true);
});

test("RENDER: cancelling the confirmation is visible and routes nothing", async () => {
  const user = userEvent.setup();
  const runtime = confirmationRuntime([approvalRule(TENANT_A, "device.wipe")]);

  render(<ConfirmationShell runtime={runtime} />);
  const wipeCard = screen.getByText(/Erases all data on the device/).closest("section");
  if (wipeCard === null) throw new Error("unreachable");

  // Open the review, then cancel.
  await user.click(within(wipeCard).getByRole("button", { name: "Request wipe" }));
  const dialog = screen.getByRole("dialog", { name: /Confirm Wipe/ });
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

  // The cancellation is VISIBLE.
  const outcome = screen.getByText(/The last destructive-confirmation attempt/).closest("section");
  if (outcome === null) throw new Error("outcome card missing");
  expect(within(outcome).getByText(/cancelled — The confirmation was cancelled/)).toBeTruthy();
  expect(within(outcome).getByText(/Nothing was requested/)).toBeTruthy();

  // Nothing was routed; no audit entries exist.
  expect(
    runtime.auditLog
      .records({ tenantId: TENANT_A, correlationId: asCorrelationId("cor_w141render01") })
      .map((record) => record.action),
  ).toEqual([]);
  expect(
    runtime.requestStore.listRequestIds({
      tenantId: TENANT_A,
      correlationId: asCorrelationId("cor_w141render01"),
    }),
  ).toHaveLength(0);
});

test("RENDER: the wrong phrase never unlocks the dispatch (the gate holds)", async () => {
  const user = userEvent.setup();
  const runtime = confirmationRuntime([approvalRule(TENANT_A, "device.wipe")]);

  render(<ConfirmationShell runtime={runtime} />);
  const wipeCard = screen.getByText(/Erases all data on the device/).closest("section");
  if (wipeCard === null) throw new Error("unreachable");

  await user.click(within(wipeCard).getByRole("button", { name: "Request wipe" }));
  const dialog = screen.getByRole("dialog", { name: /Confirm Wipe/ });

  // Acknowledge, type the WRONG phrase, confirm -> still locked.
  await user.click(
    within(dialog).getByRole("checkbox", { name: /I understand the expected effect/ }),
  );
  const phraseInput = within(dialog).getByLabelText(/Type the confirmation phrase/);
  await user.type(phraseInput, "CONFIRM WIPE definitely-not-the-device");
  await user.click(within(dialog).getByRole("button", { name: "Confirm the phrase" }));

  // The dispatch button NEVER appeared (the machine refused the mark).
  expect(within(dialog).queryByRole("button", { name: /Confirm and dispatch/ })).toBeNull();
  // The visible error names the mismatch.
  expect(within(dialog).getByText(/The phrase does not match yet/)).toBeTruthy();
  // Nothing routed, nothing audited.
  expect(
    runtime.requestStore.listRequestIds({
      tenantId: TENANT_A,
      correlationId: asCorrelationId("cor_w141render01"),
    }),
  ).toHaveLength(0);
});
