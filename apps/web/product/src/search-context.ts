/**
 * @fleetos/web-product — the role-aware search result context (W101 [TL]).
 *
 * The global search's role context projection: every result carries the
 * ACTIVE EXPERIENCE LENS's context line for that result class — a
 * presentation hint (which lens sees this record class and why), never
 * a permission change. Unknown record classes render the neutral
 * context (fail-visible: no guessed context), and restricted roles see
 * their restricted-surface note.
 */

import type { ProductExperienceRole } from "./role-bridge";
import { isRestrictedExperienceRole, PRODUCT_HOME_LENS } from "./role-bridge";

/** The shell's search result class (the record-class summary kind). */
export type SearchRecordClass =
  | "device"
  | "finding"
  | "policy"
  | "action-plan"
  | "workload"
  | "procurement"
  | "vendor"
  | "evidence"
  | "evaluation-case"
  | "recovery-case";

/** The per-lens context line for each record class (frozen total map). */
const CLASS_CONTEXT: Readonly<Record<SearchRecordClass, string>> = Object.freeze({
  device: "Your fleet's devices — observations, health, and enrollment.",
  finding: "Security findings with evidence trails and remediation.",
  policy: "The contract guardian's enforceable obligations.",
  "action-plan": "Fleet actions — approvals, distribution, and outcomes.",
  workload: "Workload profiles and fit recommendations.",
  procurement: "Procurement intents and the exchange lifecycle.",
  vendor: "Vendors, scorecards, and service records.",
  evidence: "The append-only evidence and audit trail.",
  "evaluation-case": "Learning cases and capability adoption.",
  "recovery-case": "Recovery cases for lost or compromised devices.",
});

/** The role-aware context for a search result (pure, deterministic). */
export function searchResultContextFor(
  role: ProductExperienceRole | null,
  recordClass: SearchRecordClass,
): string {
  if (role === null) {
    return "Sign in with a product role to see role-shaped context.";
  }
  if (isRestrictedExperienceRole(role)) {
    return `${CLASS_CONTEXT[recordClass]} (restricted view — ${PRODUCT_HOME_LENS[role]} lens)`;
  }
  return `${CLASS_CONTEXT[recordClass]} (${PRODUCT_HOME_LENS[role]} lens)`;
}
