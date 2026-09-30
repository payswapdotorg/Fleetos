/**
 * @fleetos/web-workloads — the LOCAL shadcn-style component vocabulary
 * (W090C). Implemented in plain React + the local token stylesheet —
 * NO external UI library dependency (the design contract's rule; the
 * Next.js shell/runtime is W091 Tech-Lead work — these are renderable
 * component libraries).
 *
 * Vocabulary (spec/ui/CONSOLE-DESIGN.md): Button, Badge, Card, Table
 * (styling via `fos-table` classes — screens own their semantic
 * tables), Tabs, Drawer/Sheet, Dialog, Dropdown, Breadcrumb, Tooltip,
 * Skeleton, EmptyState, AlertError, Timeline, StatusIndicator.
 *
 * Discipline:
 *   - PRESENTATIONAL ONLY: props in, JSX out. No business truth in
 *     React state — every open/active/selected value arrives as a
 *     prop and every user intent leaves through a callback. The same
 *     props always produce byte-identical output.
 *   - FULLY CONTROLLED compound components (Tabs/Dropdown/Sheet/
 *     Dialog): visibility + selection are props, never internal state.
 *   - Accessibility: keyboard navigation, visible focus (the token
 *     stylesheet's :focus-visible rules), semantic roles, accessible
 *     names for icon-only controls, `aria-*` state mirroring.
 *   - Determinism: no clock, no randomness, no I/O.
 */

import { useEffect, useId, useRef } from "react";
import type { JSX, ReactNode } from "react";
import { CONSOLE_STATUS_LABEL } from "./status";
import type { ConsoleStatus } from "./status";

// ---------------------------------------------------------------------------
// Screen phase (the exact loading / error / ready / invalid states)
// ---------------------------------------------------------------------------

/** A machine-stable build failure (the established {path, reason} shape). */
export interface PhaseFailure {
  readonly path: string;
  readonly reason: string;
}

/**
 * The phase every rendered screen takes: `loading` (skeleton), `error`
 * (actionable alert), `ready` (the view-model arrived), or `invalid`
 * (the view-model BUILD failed — the {path, reason} failures are
 * listed verbatim). First-class, never afterthoughts.
 */
export type ScreenPhase<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string; readonly onRetry?: () => void }
  | { readonly kind: "invalid"; readonly failures: readonly PhaseFailure[] }
  | { readonly kind: "ready"; readonly view: T };

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps {
  readonly variant?: ButtonVariant;
  readonly type?: "button" | "submit";
  readonly disabled?: boolean;
  readonly onClick?: () => void;
  readonly children: ReactNode;
  /** Accessible name when the button carries no visible text. */
  readonly ariaLabel?: string;
  readonly testId?: string;
}

export function Button({
  variant = "secondary",
  type = "button",
  disabled = false,
  onClick,
  children,
  ariaLabel,
  testId,
}: ButtonProps): JSX.Element {
  return (
    <button
      type={type}
      className={`fos-btn fos-btn--${variant}`}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Badge + StatusIndicator (state is NEVER conveyed by color alone)
// ---------------------------------------------------------------------------

export interface BadgeProps {
  readonly status?: ConsoleStatus;
  readonly children: ReactNode;
}

export function Badge({ status, children }: BadgeProps): JSX.Element {
  const cls = status === undefined ? "fos-badge" : `fos-badge fos-badge--${status}`;
  return <span className={cls}>{children}</span>;
}

export interface StatusIndicatorProps {
  readonly status: ConsoleStatus;
  /** Overrides the vocabulary label (e.g. a verbatim domain value). */
  readonly label?: string;
}

export function StatusIndicator({ status, label }: StatusIndicatorProps): JSX.Element {
  const text = label ?? CONSOLE_STATUS_LABEL[status];
  return (
    <span className={`fos-status fos-status--${status}`}>
      <span className="fos-status__dot" aria-hidden="true" />
      <span className="fos-status__text">{text}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export interface CardProps {
  readonly title?: string;
  readonly subtitle?: string;
  readonly children: ReactNode;
  readonly actions?: ReactNode;
}

export function Card({ title, subtitle, children, actions }: CardProps): JSX.Element {
  return (
    <section className="fos-card">
      {(title !== undefined || actions !== undefined) && (
        <div className="fos-spread" style={{ marginBottom: "0.75rem" }}>
          <div>
            {title !== undefined && <h3 className="fos-card-title">{title}</h3>}
            {subtitle !== undefined && <p className="fos-card-subtitle">{subtitle}</p>}
          </div>
          {actions !== undefined && <div className="fos-row">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tabs (WAI-ARIA pattern; roving tabindex; arrows/Home/End)
// ---------------------------------------------------------------------------

export interface TabDescriptor {
  readonly id: string;
  readonly label: string;
  readonly count?: number;
}

export interface TabsProps {
  readonly tabs: readonly TabDescriptor[];
  readonly activeId: string;
  readonly onChange: (id: string) => void;
  readonly ariaLabel: string;
}

export function Tabs({ tabs, activeId, onChange, ariaLabel }: TabsProps): JSX.Element {
  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === activeId),
  );
  const move = (delta: number): void => {
    const next = (activeIndex + delta + tabs.length) % tabs.length;
    onChange(tabs[next].id);
  };
  return (
    <div className="fos-tabs" role="tablist" aria-label={ariaLabel}
      onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>): void => {
        if (event.key === "ArrowRight") { event.preventDefault(); move(1); }
        else if (event.key === "ArrowLeft") { event.preventDefault(); move(-1); }
        else if (event.key === "Home") { event.preventDefault(); onChange(tabs[0].id); }
        else if (event.key === "End") { event.preventDefault(); onChange(tabs[tabs.length - 1].id); }
      }}
    >
      {tabs.map((tab) => {
        const selected = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`fos-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`fos-panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            className="fos-tab"
            onClick={(): void => onChange(tab.id)}
          >
            {tab.label}
            {tab.count !== undefined ? ` (${tab.count})` : ""}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sheet (drawer) + Dialog — controlled; Escape closes; focus moves in
// ---------------------------------------------------------------------------

export interface SheetProps {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** The accessible label of the close (icon-only) control. */
  readonly closeLabel?: string;
}

export function Sheet({ open, title, onClose, children, closeLabel = "Close panel" }: SheetProps): JSX.Element | null {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <div className="fos-scrim fos-scrim--end">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="fos-sheet"
        onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>): void => {
          if (event.key === "Escape") onClose();
        }}
      >
        <div className="fos-sheet__header">
          <h2 className="fos-sheet__title">{title}</h2>
          <button type="button" className="fos-btn fos-btn--ghost" aria-label={closeLabel} onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export interface DialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly closeLabel?: string;
}

export function Dialog({ open, title, onClose, children, closeLabel = "Close dialog" }: DialogProps): JSX.Element | null {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <div className="fos-scrim fos-scrim--center">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="fos-dialog"
        onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>): void => {
          if (event.key === "Escape") onClose();
        }}
      >
        <div className="fos-dialog__header">
          <h2 className="fos-dialog__title">{title}</h2>
          <button type="button" className="fos-btn fos-btn--ghost" aria-label={closeLabel} onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dropdown (controlled menu; ArrowUp/Down + Enter/Space + Escape)
// ---------------------------------------------------------------------------

export interface DropdownItem {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
}

export interface DropdownProps {
  readonly label: string;
  readonly items: readonly DropdownItem[];
  readonly selectedId: string | undefined;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSelect: (id: string) => void;
}

export function Dropdown({ label, items, selectedId, open, onOpenChange, onSelect }: DropdownProps): JSX.Element {
  const activeIndex = items.findIndex((item) => item.id === selectedId);
  const move = (delta: number): void => {
    if (items.length === 0) return;
    const next = (Math.max(0, activeIndex) + delta + items.length) % items.length;
    onSelect(items[next].id);
  };
  const selected = items.find((item) => item.id === selectedId);
  return (
    <div className="fos-menu">
      <button
        type="button"
        className="fos-btn fos-btn--secondary"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={(): void => onOpenChange(!open)}
      >
        {label}
        {selected !== undefined ? `: ${selected.label}` : ""}
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul className="fos-menu__list" role="listbox" aria-label={label}
          onKeyDown={(event: React.KeyboardEvent<HTMLUListElement>): void => {
            if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
            else if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
            else if (event.key === "Escape") { onOpenChange(false); }
          }}
        >
          {items.map((item) => (
            <li key={item.id} role="option" aria-selected={item.id === selectedId}>
              <button
                type="button"
                className="fos-menu__item"
                data-active={item.id === selectedId}
                onClick={(): void => { onSelect(item.id); onOpenChange(false); }}
              >
                {item.label}
                {item.detail !== undefined ? ` — ${item.detail}` : ""}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Breadcrumb
// ---------------------------------------------------------------------------

export interface Crumb {
  readonly label: string;
  readonly current?: boolean;
}

export function Breadcrumb({ items }: { readonly items: readonly Crumb[] }): JSX.Element {
  return (
    <nav className="fos-breadcrumb" aria-label="Breadcrumb">
      <ol>
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`}>
            {index > 0 && <span aria-hidden="true">/</span>}
            {item.current === true ? (
              <span aria-current="page">{item.label}</span>
            ) : (
              <span>{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Tooltip (CSS-only progressive disclosure; the trigger keeps its name)
// ---------------------------------------------------------------------------

export interface TooltipProps {
  readonly text: string;
  readonly children: ReactNode;
}

export function Tooltip({ text, children }: TooltipProps): JSX.Element {
  return (
    <span className="fos-tooltip">
      {children}
      <span className="fos-tooltip__bubble" role="tooltip">
        {text}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Skeleton (loading placeholders)
// ---------------------------------------------------------------------------

export interface SkeletonProps {
  readonly label: string;
  readonly rows?: number;
}

export function Skeleton({ label, rows = 4 }: SkeletonProps): JSX.Element {
  return (
    <div className="fos-skeleton" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className={`fos-skeleton__bar fos-skeleton__bar--${index % 3 === 0 ? "wide" : index % 3 === 1 ? "mid" : "narrow"}`}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmptyState (instructive zero states) + AlertError (actionable alerts)
// ---------------------------------------------------------------------------

export interface EmptyStateProps {
  readonly title: string;
  readonly hint?: string;
  readonly action?: { readonly label: string; readonly onClick: () => void };
}

export function EmptyState({ title, hint, action }: EmptyStateProps): JSX.Element {
  return (
    <div className="fos-empty">
      <p className="fos-empty__title">{title}</p>
      {hint !== undefined && <p className="fos-empty__hint">{hint}</p>}
      {action !== undefined && <Button variant="primary" onClick={action.onClick}>{action.label}</Button>}
    </div>
  );
}

export interface AlertErrorProps {
  readonly title: string;
  readonly message?: string;
  readonly failures?: readonly PhaseFailure[];
  readonly onRetry?: () => void;
}

export function AlertError({ title, message, failures, onRetry }: AlertErrorProps): JSX.Element {
  return (
    <div className="fos-alert" role="alert">
      <p className="fos-alert__title">{title}</p>
      {message !== undefined && <p className="fos-alert__message">{message}</p>}
      {failures !== undefined && failures.length > 0 && (
        <ul>
          {failures.map((failure, index) => (
            <li key={`${failure.path}-${index}`}>
              <span className="fos-mono">{failure.path}</span>: <span>{failure.reason}</span>
            </li>
          ))}
        </ul>
      )}
      {onRetry !== undefined && <Button variant="secondary" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export type TimelineState = "done" | "current" | "pending" | "blocked";

export interface TimelineItem {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly state: TimelineState;
  /** The state's visible text (when it differs from the label). */
  readonly stateLabel?: string;
}

export interface TimelineProps {
  readonly items: readonly TimelineItem[];
  readonly ariaLabel: string;
}

const TIMELINE_STATE_LABEL: Readonly<Record<TimelineState, string>> = Object.freeze({
  done: "Done",
  current: "In progress",
  pending: "Pending",
  blocked: "Blocked",
} as const);

export function Timeline({ items, ariaLabel }: TimelineProps): JSX.Element {
  return (
    <ol className="fos-timeline" aria-label={ariaLabel}>
      {items.map((item) => (
        <li key={item.id}>
          <span className={`fos-timeline__marker fos-timeline__marker--${item.state}`} aria-hidden="true" />
          <span className="fos-timeline__body">
            <span className="fos-timeline__label">{item.label}</span>
            {item.detail !== undefined && <span className="fos-timeline__detail">{item.detail}</span>}
            <span className="fos-timeline__detail">{item.stateLabel ?? TIMELINE_STATE_LABEL[item.state]}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Field (labeled input/select) + CheckField + definition list
// ---------------------------------------------------------------------------

export interface FieldProps {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
  readonly children: (id: string) => ReactNode;
}

export function Field({ label, hint, error, children }: FieldProps): JSX.Element {
  const id = useId();
  return (
    <div className="fos-field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint !== undefined && <span className="fos-field__hint">{hint}</span>}
      {error !== undefined && <span className="fos-field__error">{error}</span>}
    </div>
  );
}

export interface CheckFieldProps {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly description?: string;
}

export function CheckField({ label, checked, onChange, description }: CheckFieldProps): JSX.Element {
  const id = useId();
  return (
    <div className="fos-check">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event: React.ChangeEvent<HTMLInputElement>): void => onChange(event.target.checked)}
      />
      <span>
        <label htmlFor={id}>{label}</label>
        {description !== undefined && <span className="fos-field__hint" style={{ display: "block" }}>{description}</span>}
      </span>
    </div>
  );
}

export interface DefinitionEntry {
  readonly term: string;
  readonly value: ReactNode;
}

export function DefinitionList({ entries }: { readonly entries: readonly DefinitionEntry[] }): JSX.Element {
  return (
    <dl className="fos-definition">
      {entries.map((entry, index) => (
        <div key={`${entry.term}-${index}`} style={{ display: "contents" }}>
          <dt>{entry.term}</dt>
          <dd>{entry.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Stepper (multi-step journey progress)
// ---------------------------------------------------------------------------

export interface StepDescriptor {
  readonly id: string;
  readonly label: string;
}

export interface StepperProps {
  readonly steps: readonly StepDescriptor[];
  readonly currentId: string;
  readonly completedIds: readonly string[];
}

export function Stepper({ steps, currentId, completedIds }: StepperProps): JSX.Element {
  return (
    <ol className="fos-stepper" aria-label="Journey progress">
      {steps.map((step) => {
        const done = completedIds.includes(step.id);
        const current = step.id === currentId;
        const cls = current
          ? "fos-stepper__step fos-stepper__step--current"
          : done
            ? "fos-stepper__step fos-stepper__step--done"
            : "fos-stepper__step";
        return (
          <li key={step.id} className={cls} aria-current={current ? "step" : undefined}>
            <span aria-hidden="true">{done ? "✓" : current ? "▸" : "·"}</span>
            {step.label}
            <span className="fos-meta">{done ? "done" : current ? "current" : "pending"}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// The shared phase presentation (loading skeleton / error / invalid)
// ---------------------------------------------------------------------------

export interface PhasePresentationProps {
  readonly phase: ScreenPhase<unknown>;
  readonly loadingLabel: string;
}

/**
 * The non-ready phase presentation shared by every screen: loading
 * skeletons, actionable error alerts, and the invalid-build failure
 * list (machine-stable {path, reason} pairs, verbatim).
 */
export function PhasePresentation({ phase, loadingLabel }: PhasePresentationProps): JSX.Element | null {
  if (phase.kind === "loading") {
    return (
      <Card>
        <Skeleton label={loadingLabel} rows={6} />
      </Card>
    );
  }
  if (phase.kind === "error") {
    return (
      <AlertError
        title="Something went wrong"
        message={phase.message}
        onRetry={phase.onRetry}
      />
    );
  }
  if (phase.kind === "invalid") {
    return (
      <AlertError
        title="The view could not be built"
        message="The request was invalid. The machine-stable failures are listed below."
        failures={phase.failures}
      />
    );
  }
  return null;
}
