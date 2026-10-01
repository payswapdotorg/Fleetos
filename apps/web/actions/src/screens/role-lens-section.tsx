/**
 * @fleetos/web-actions — W100B rendered: the RoleLensSection.
 *
 * The role banner every actions-lane screen may render: the active
 * role + home lens, the primary question, the lens lead, the surface
 * emphasis badges, the AUTHORITY ECHO line (effective permissions come
 * from identity and the Contract Guardian — this lens changes
 * emphasis, never authority), and the RESTRICTED-CAPABILITY cards
 * (reason + escalation path + the lens-switch affordance ONLY for an
 * assigned emphasizing role).
 *
 * Presentational and fully controlled; deterministic.
 */

import type { JSX } from "react";
import type { ActionsRoleLensView, RestrictedCapabilityView } from "../role-lens";
import { Badge, Card, DefinitionList } from "../ui/primitives";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** One emphasis entry the banner displays (surface label + level). */
export interface LensEmphasisEntry {
  /** The surface label (displayed). */
  readonly label: string;
  /** The emphasis level (the matrix table's token, verbatim). */
  readonly value: string;
}

export interface RoleLensSectionProps {
  /** The role lens view (from `buildActionsRoleLens`). */
  readonly lens: ActionsRoleLensView;
  /** The surface emphasis entries (composed by the screen). */
  readonly emphasis: readonly LensEmphasisEntry[];
}

// ---------------------------------------------------------------------------
// The restricted-capability card (reason + escalation path)
// ---------------------------------------------------------------------------

function RestrictedCapabilityCard(props: {
  readonly restricted: RestrictedCapabilityView;
}): JSX.Element {
  const { restricted } = props;
  return (
    <Card
      title={`Restricted: ${restricted.label}`}
      subtitle={`Capability ${restricted.capability} is unavailable in this session`}
    >
      <DefinitionList
        entries={[
          { term: "Reason", value: <span className="fos-mono">{restricted.reason}</span> },
          {
            term: "Required permission",
            value: <span className="fos-mono">{restricted.requiredPermission}</span>,
          },
          {
            term: "Emphasized by",
            value: restricted.emphasisRoles.join(", "),
          },
          {
            term: "Escalation path",
            value: `${restricted.escalation.action} — ${restricted.escalation.requestLabel}`,
          },
        ]}
      />
      {restricted.switchToRole !== null ? (
        <p className="fos-meta" style={{ margin: "0.5rem 0 0" }}>
          The <strong>{restricted.switchToRole}</strong> lens emphasizes this capability. Switching
          the lens changes what FleetOS emphasizes — it never changes what you may do.
        </p>
      ) : (
        <p className="fos-meta" style={{ margin: "0.5rem 0 0" }}>
          None of your assigned roles emphasize this capability. Request the role assignment from
          your {restricted.escalation.requestLabel}.
        </p>
      )}
      <p className="fos-meta" style={{ margin: "0.35rem 0 0" }} data-testid="restricted-grants-nothing">
        This explanation grants nothing (grantsAnything: {String(restricted.grantsNothing)}).
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The section
// ---------------------------------------------------------------------------

/**
 * The RoleLensSection: the role banner + the restricted-capability
 * explanations. Rendered by the lane's screens when a role lens is
 * active (optional — screens without one render exactly as before).
 */
export function RoleLensSection(props: RoleLensSectionProps): JSX.Element {
  const { lens } = props;
  return (
    <section aria-label={`Role lens: ${lens.roleLabel}`} data-testid={`role-lens-${lens.activeRole}`}>
      <Card
        title={`Viewing as ${lens.roleLabel}`}
        subtitle={`${lens.homeLens} lens · ${lens.primaryQuestion}`}
      >
        <p style={{ margin: "0 0 0.5rem", fontSize: "0.875rem" }}>{lens.lensLead}</p>
        <div className="fos-row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
          {props.emphasis.map((entry) => (
            <Badge key={entry.label}>
              {entry.label}: {entry.value}
            </Badge>
          ))}
        </div>
        <p className="fos-meta" style={{ margin: "0.75rem 0 0" }} data-testid="role-lens-authority">
          Effective permissions come from identity and the Contract Guardian — this lens changes
          emphasis, never authority. This session holds {lens.authority.permissions.length}{" "}
          effective permission(s) as principal <span className="fos-mono">{lens.authority.principalId}</span>.
        </p>
        {lens.assignedRoles.length > 1 && (
          <p className="fos-meta" style={{ margin: "0.35rem 0 0" }}>
            Assigned roles in this workspace: {lens.assignedRoles.join(", ")}.
          </p>
        )}
      </Card>
      {lens.restricted.map((restricted) => (
        <RestrictedCapabilityCard key={restricted.capability} restricted={restricted} />
      ))}
    </section>
  );
}
