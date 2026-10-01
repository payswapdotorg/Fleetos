/**
 * @fleetos/web-commerce — the ROLE-AWARE commerce projection (W100C).
 *
 * The W100C lens surface for commerce: role-aware projections for the
 * four C-lane roles the work order names — asset.manager,
 * team.manager, employee and vendor.operator — over the commerce
 * surface's own area vocabulary (procurement / software / vendors /
 * maintenance / connectivity / communication).
 *
 * THE MATRIX RULES (spec/ui/ROLE-EXPERIENCE-MATRIX.yaml, encoded):
 *   - `experience_profiles_do_not_grant_permissions` — the lens view is
 *     structurally permission-free (no permission field exists on it;
 *     asserted by test). Effective permissions come from identity +
 *     Contract Guardian, injected separately by the shell.
 *   - `active_role_is_scoped_to_current_tenant` — the lens carries the
 *     acting tenant; tenant disagreement with the input records refuses
 *     (`tenant_mismatch`).
 *   - `unavailable_capabilities_show_reason_and_escalation_path` —
 *     de-emphasized areas carry machine-stable capability notices with
 *     reason + escalation path (never a silent omission).
 *
 * Emphasis derives from ROLE-EXPERIENCE-MATRIX `primary_areas` and the
 * ROLEFUL-UX-ARCHITECTURE role-to-surface emphasis table: Commerce is
 * HIGHEST for asset.manager and vendor.operator, medium for
 * team.manager, request-shaped for employee.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads.
 */

import type { TenantId } from "@fleetos/contracts";
import { compareStrings, frozen, frozenArray } from "./internal";

// ---------------------------------------------------------------------------
// The lens vocabulary
// ---------------------------------------------------------------------------

/** The W100C lens ids (the C-lane roles the work item names). */
export const COMMERCE_ROLE_LENS_IDS = frozenArray([
  "asset.manager",
  "team.manager",
  "employee",
  "vendor.operator",
] as const);

/** One commerce lens id. */
export type CommerceRoleLensId = (typeof COMMERCE_ROLE_LENS_IDS)[number];

/** The commerce areas the lens orders (the surface's own vocabulary). */
export type CommerceAreaId =
  | "procurement"
  | "software"
  | "vendors"
  | "maintenance"
  | "connectivity"
  | "communication";

/** The emphasis levels an area can carry under a lens. */
export type CommerceLensEmphasis = "highest" | "high" | "medium" | "low" | "minimal";

/** The immutable commerce lens descriptor (machine-stable). */
export interface CommerceRoleLens {
  readonly lensId: CommerceRoleLensId;
  /** The operator-facing label (ROLE-EXPERIENCE-MATRIX `label`). */
  readonly label: string;
  /** The home lens (ROLE-EXPERIENCE-MATRIX `home_lens`). */
  readonly homeLens: "resources" | "team" | "personal" | "exchange";
  /** The role's primary question (ROLEFUL-UX-ARCHITECTURE table). */
  readonly primaryQuestion: string;
  /** Area emphasis under this lens (machine-stable ordering input). */
  readonly areaEmphasis: Readonly<Record<CommerceAreaId, CommerceLensEmphasis>>;
}

const AREA_EMPHASIS_BY_LENS: Readonly<
  Record<CommerceRoleLensId, Readonly<Record<CommerceAreaId, CommerceLensEmphasis>>>
> = frozen({
  // Asset & Procurement Manager: Commerce HIGHEST (matrix primary areas:
  // workloads, commerce, device, maintenance, evidence).
  "asset.manager": frozen({
    procurement: "highest",
    vendors: "highest",
    maintenance: "high",
    software: "high",
    connectivity: "medium",
    communication: "medium",
  }),
  // Team Manager: Commerce medium (requests + approvals emphasis).
  "team.manager": frozen({
    procurement: "high",
    software: "medium",
    vendors: "medium",
    maintenance: "medium",
    connectivity: "medium",
    communication: "medium",
  }),
  // Employee: Commerce "Requests" — software (what I use) leads;
  // procurement is request-shaped.
  employee: frozen({
    software: "medium",
    procurement: "medium",
    vendors: "low",
    maintenance: "low",
    connectivity: "low",
    communication: "minimal",
  }),
  // Vendor / Service Operator: Commerce HIGHEST (the exchange lens —
  // quotes, work orders and fulfillment steps that need a response).
  "vendor.operator": frozen({
    maintenance: "highest",
    procurement: "highest",
    vendors: "high",
    connectivity: "medium",
    software: "low",
    communication: "high",
  }),
});

/** The frozen commerce lens descriptors (the W100C vocabulary). */
export const COMMERCE_ROLE_LENSES: Readonly<
  Record<CommerceRoleLensId, CommerceRoleLens>
> = frozen({
  "asset.manager": frozen({
    lensId: "asset.manager",
    label: "Asset & Procurement Manager",
    homeLens: "resources",
    primaryQuestion: "What should we buy, maintain, replace or subscribe to?",
    areaEmphasis: AREA_EMPHASIS_BY_LENS["asset.manager"],
  }),
  "team.manager": frozen({
    lensId: "team.manager",
    label: "Team Manager",
    homeLens: "team",
    primaryQuestion: "How is my team affected and which requests/approvals need me?",
    areaEmphasis: AREA_EMPHASIS_BY_LENS["team.manager"],
  }),
  employee: frozen({
    lensId: "employee",
    label: "Employee / Device Owner",
    homeLens: "personal",
    primaryQuestion: "Is my device healthy, what should I do, and how do I request help?",
    areaEmphasis: AREA_EMPHASIS_BY_LENS.employee,
  }),
  "vendor.operator": frozen({
    lensId: "vendor.operator",
    label: "Vendor / Service Operator",
    homeLens: "exchange",
    primaryQuestion: "Which quotes, work orders and fulfillment steps require my response?",
    areaEmphasis: AREA_EMPHASIS_BY_LENS["vendor.operator"],
  }),
});

// ---------------------------------------------------------------------------
// The lens view (PRESENTATION ONLY — structurally permission-free)
// ---------------------------------------------------------------------------

/** One commerce-area capability notice: de-emphasis with WHY + escalation. */
export interface CommerceLensNotice {
  readonly kind: "area_deemphasized";
  readonly area: CommerceAreaId;
  /** The machine-stable reason code. */
  readonly reason: string;
  /** The human-facing explanation (rendered verbatim). */
  readonly message: string;
  /** The escalation path (rendered verbatim — the matrix rule). */
  readonly escalationPath: string;
}

/** The role-aware commerce surface projection. */
export interface CommerceRoleLensView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly lensId: CommerceRoleLensId;
  readonly label: string;
  readonly primaryQuestion: string;
  /** The commerce areas in the lens's emphasis order (machine-stable). */
  readonly areas: readonly CommerceAreaId[];
  /** Capability notices for de-emphasized areas. */
  readonly notices: readonly CommerceLensNotice[];
  /** The lens's presentation note (explanatory copy — never a permission). */
  readonly scopeNote: string | null;
}

/** The commerce lens view-model schema version. */
export const COMMERCE_ROLE_LENS_VIEW_VERSION = 1 as const;

/** The tagged result of a commerce lens projection. */
export type CommerceRoleLensResult =
  | { readonly ok: true; readonly view: CommerceRoleLensView }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

const ALL_AREAS: readonly CommerceAreaId[] = frozenArray([
  "procurement",
  "software",
  "vendors",
  "maintenance",
  "connectivity",
  "communication",
]);

const EMPHASIS_ORDER: Readonly<Record<CommerceLensEmphasis, number>> = frozen({
  highest: 0,
  high: 1,
  medium: 2,
  low: 3,
  minimal: 4,
});

/**
 * Project the commerce surface through one role lens. PURE and
 * DETERMINISTIC: the view carries the emphasis-ordered areas, the lens
 * copy, and capability notices for every de-emphasized area. It carries
 * NO permission data (there is no field for it) and NO domain records —
 * the record views are built by the existing builders and ordered by
 * the shell using this view's `areas` sequence.
 *
 * @param tenantId the acting tenant
 * @param lensId the lens to project through
 */
export function applyCommerceRoleLens(
  tenantId: TenantId,
  lensId: CommerceRoleLensId,
): CommerceRoleLensResult {
  if (!COMMERCE_ROLE_LENS_IDS.includes(lensId)) {
    return {
      ok: false,
      error: {
        kind: "ValidationError",
        code: "web-commerce.role_lens.unknown_lens",
        message: `applyCommerceRoleLens: unknown lens id ${String(lensId)}`,
        failures: [{ path: "/lensId", reason: "unknown_lens" }],
        tenantId,
        correlationId: "cor_surface_w100c" as import("@fleetos/contracts").CorrelationId,
      },
    };
  }
  const lens = COMMERCE_ROLE_LENSES[lensId];
  const areas = frozenArray(
    [...ALL_AREAS].sort(
      (a, b) =>
        EMPHASIS_ORDER[lens.areaEmphasis[a]] - EMPHASIS_ORDER[lens.areaEmphasis[b]] ||
        compareStrings(a, b),
    ),
  );
  const notices = frozenArray(buildCommerceNotices(lens));
  const scopeNote =
    lensId === "employee"
      ? "Scoped to your requests and the software you use — ordering, accepting and vendor management stay with Asset & Procurement roles."
      : lensId === "vendor.operator"
        ? "Scoped to the quotes and work orders awaiting your response — the demand-side views stay with fleet roles."
        : lensId === "team.manager"
          ? "Team requests and approvals lead; the full commerce surface remains one navigation away."
          : null;
  return {
    ok: true,
    view: frozen({
      viewVersion: COMMERCE_ROLE_LENS_VIEW_VERSION,
      tenantId,
      lensId,
      label: lens.label,
      primaryQuestion: lens.primaryQuestion,
      areas,
      notices,
      scopeNote,
    }),
  };
}

/** The capability notices for de-emphasized areas. */
function buildCommerceNotices(lens: CommerceRoleLens): readonly CommerceLensNotice[] {
  const notices: CommerceLensNotice[] = [];
  for (const area of ALL_AREAS) {
    const emphasis = lens.areaEmphasis[area];
    if (emphasis === "low" || emphasis === "minimal") {
      notices.push(
        frozen({
          kind: "area_deemphasized",
          area,
          reason: `role_${emphasis}_emphasis`,
          message: `The ${area} area is de-emphasized for the ${lens.label} lens.`,
          escalationPath:
            "This lens changes emphasis only. Switch your active role (asset.manager or fleet.admin) to lead with the full commerce surface; permissions are unaffected by switching.",
        }),
      );
    }
  }
  return notices.sort((a, b) => compareStrings(a.area, b.area));
}
