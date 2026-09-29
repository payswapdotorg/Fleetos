/**
 * @fleetos/web-shell — the SHARED shadcn-style component vocabulary
 * (W091 [TL]).
 *
 * Plain React + the shared CSS tokens (spec/ui/CONSOLE-DESIGN.md
 * "Design-system rules"): a small local vocabulary the app chrome and
 * the W091 screens are built from — no external UI library dependency.
 * The lane packages ship their own local copies for their screens
 * (W090 pattern); this is the canonical chrome-level set.
 *
 * Presentational and fully controlled: no business truth in React
 * state, no data fetching, no effects beyond presentation concerns
 * (focus management and Escape handling in the overlay primitives).
 */
import type { JSX, ReactNode } from "react";
import { useEffect, useRef } from "react";
import {
  CONSOLE_STATUS_LABEL,
  statusClass,
  type ConsoleStatus,
} from "./status";

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

export type ButtonVariant = "primary" | "secondary" | "ghost";

export interface ButtonProps {
  readonly variant?: ButtonVariant;
  readonly disabled?: boolean;
  readonly onClick?: () => void;
  readonly children: ReactNode;
  readonly ariaLabel?: string;
  readonly title?: string;
  readonly type?: "button" | "submit";
}

export function Button({
  variant = "secondary",
  disabled = false,
  onClick,
  children,
  ariaLabel,
  title,
  type = "button",
}: ButtonProps): JSX.Element {
  return (
    <button
      type={type}
      className={`fos-btn fos-btn--${variant}`}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      title={title}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Badge + StatusIndicator (never color alone: the label is always present)
// ---------------------------------------------------------------------------

export interface BadgeProps {
  readonly status?: ConsoleStatus;
  readonly children: ReactNode;
}

export function Badge({ status, children }: BadgeProps): JSX.Element {
  const cls = status ? `fos-badge fos-badge--${status}` : "fos-badge";
  return <span className={cls}>{children}</span>;
}

export interface StatusIndicatorProps {
  readonly status: ConsoleStatus;
  /** Override label; defaults to the operator-facing vocabulary label. */
  readonly label?: string;
}

export function StatusIndicator({ status, label }: StatusIndicatorProps): JSX.Element {
  return (
    <span className={statusClass(status)}>
      <span className="fos-status__dot" aria-hidden="true" />
      <span>{label ?? CONSOLE_STATUS_LABEL[status]}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export interface CardProps {
  readonly title?: string;
  readonly subtitle?: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}

export function Card({ title, subtitle, actions, children }: CardProps): JSX.Element {
  return (
    <section className="fos-card">
      {(title !== undefined || actions !== undefined) && (
        <div className="fos-spread">
          <div>
            {title !== undefined && <h2 className="fos-card-title">{title}</h2>}
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
// Breadcrumb
// ---------------------------------------------------------------------------

export interface Crumb {
  readonly label: string;
  readonly ariaLabel?: string;
}

export function Breadcrumb({ items }: { readonly items: readonly Crumb[] }): JSX.Element {
  return (
    <nav className="fos-breadcrumb" aria-label="Breadcrumb">
      <ol>
        {items.map((item, index) => {
          const isCurrent = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`}>
              {index > 0 && <span aria-hidden="true">/</span>}
              <span aria-current={isCurrent ? "page" : undefined}>{item.label}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Skeleton (loading), EmptyState, AlertError
// ---------------------------------------------------------------------------

export interface SkeletonProps {
  readonly label: string;
  readonly rows?: number;
}

export function Skeleton({ label, rows = 4 }: SkeletonProps): JSX.Element {
  const pattern = ["wide", "mid", "wide", "narrow"] as const;
  return (
    <div className="fos-skeleton" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`fos-skeleton__bar fos-skeleton__bar--${pattern[i % pattern.length]}`} />
      ))}
    </div>
  );
}

export interface EmptyStateProps {
  readonly title: string;
  readonly hint?: string;
  readonly action?: ReactNode;
}

export function EmptyState({ title, hint, action }: EmptyStateProps): JSX.Element {
  return (
    <div className="fos-empty">
      <p className="fos-empty__title">{title}</p>
      {hint !== undefined && <p className="fos-empty__hint">{hint}</p>}
      {action !== undefined && <div className="fos-row">{action}</div>}
    </div>
  );
}

export interface AlertErrorProps {
  readonly title: string;
  readonly message?: string;
}

export function AlertError({ title, message }: AlertErrorProps): JSX.Element {
  return (
    <div className="fos-alert" role="alert">
      <p className="fos-alert__title">{title}</p>
      {message !== undefined && <p className="fos-alert__message">{message}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sheet (drawer) — focus management + Escape to close
// ---------------------------------------------------------------------------

export interface SheetProps {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly closeLabel?: string;
}

export function Sheet({
  open,
  title,
  onClose,
  children,
  closeLabel = "Close panel",
}: SheetProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fos-scrim fos-scrim--end" onClick={onClose}>
      <div
        className="fos-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panelRef}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="fos-sheet__header">
          <h2 className="fos-sheet__title">{title}</h2>
          <Button variant="ghost" onClick={onClose} ariaLabel={closeLabel}>
            {closeLabel}
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline (evidence trail, journeys)
// ---------------------------------------------------------------------------

export interface TimelineEntry {
  readonly label: string;
  readonly detail?: string;
  readonly status?: ConsoleStatus;
}

export function Timeline({ entries }: { readonly entries: readonly TimelineEntry[] }): JSX.Element {
  return (
    <ul className="fos-timeline">
      {entries.map((entry, index) => (
        <li key={`${entry.label}-${index}`}>
          <span
            className={`fos-timeline__marker${entry.status === "succeeded" ? " fos-timeline__marker--done" : ""}${entry.status === "failed" || entry.status === "blocked" ? " fos-timeline__marker--blocked" : ""}`}
            aria-hidden="true"
          />
          <span className="fos-timeline__body">
            <span className="fos-timeline__label">
              {entry.label}
              {entry.status !== undefined && (
                <>
                  {" — "}
                  <StatusIndicator status={entry.status} />
                </>
              )}
            </span>
            {entry.detail !== undefined && (
              <span className="fos-timeline__detail">{entry.detail}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
