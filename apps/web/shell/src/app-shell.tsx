/**
 * @fleetos/web-shell — the AppShell (the application chrome, W091 [TL]).
 *
 * The rendered root layout per spec/ui/CONSOLE-DESIGN.md:
 *
 *   Desktop: persistent left navigation (area grouping, concise
 *   labels, active-area indicator), a top bar whose search/command
 *   entry is ALWAYS available, tenant/environment identity visible,
 *   and the current route's breadcrumbs in the content header.
 *
 *   Mobile: a compact top bar, bottom navigation for the
 *   highest-frequency areas, and a sheet for the full secondary
 *   navigation (complete mobile navigation — nothing is desktop-only).
 *
 *   Global search: the deterministic W061 search semantics; results
 *   land directly on the record's route and show WHY they matched.
 *
 * Authorization is visible: routes the acting role cannot navigate are
 * rendered disabled WITH their reason (never a dead link, never a
 * hidden capability). Fully controlled and presentational: no business
 * truth in React state.
 */
import type { JSX, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ShellRecordSummary, ShellSurfaceArea } from "./seams";
import type { ShellRoute } from "./navigation";
import type { ShellOperatorRole } from "./permissions";
import { canNavigate, navigableViews } from "./permissions";
import {
  SHELL_AREA_LABELS,
  SHELL_AREA_ORDER,
  SHELL_AREA_VIEWS,
  breadcrumbsFor,
  labelForRoute,
} from "./navigation";
import { buildSearchIndex, searchIndex } from "./discoverability";
import type { ShellSearchResult } from "./discoverability";
import { ConsoleStyles } from "./ui/tokens";
import { Badge, Breadcrumb, Button, Sheet } from "./ui/primitives";
import { bandConsoleStatus } from "./ui/status";

/** The frozen sidebar grouping (design: area grouping, concise labels). */
const NAV_GROUPS: readonly { readonly label: string; readonly areas: readonly ShellSurfaceArea[] }[] = [
  { label: "Operate", areas: ["overview", "device", "recovery", "security"] },
  { label: "Govern", areas: ["policies", "actions", "evidence"] },
  { label: "Plan & learn", areas: ["workloads", "commerce", "learning"] },
];

/** The highest-frequency areas (mobile bottom navigation). */
const MOBILE_NAV_AREAS: readonly ShellSurfaceArea[] = [
  "overview",
  "device",
  "security",
  "actions",
  "evidence",
];

export interface AppShellProps {
  /** The current route (fully controlled). */
  readonly route: ShellRoute;
  readonly onNavigate: (route: ShellRoute) => void;
  readonly role: ShellOperatorRole;
  /** Operator-facing tenant identity (visible in the chrome). */
  readonly tenantLabel: string;
  /** Operator-facing environment identity (staging/prod, visible). */
  readonly environmentLabel: string;
  /** The searchable record summaries (the W061 index input). */
  readonly records: readonly ShellRecordSummary[];
  /** Landing handler for a search result (lands on the record). */
  readonly onSearchLanding: (result: ShellSearchResult) => void;
  readonly children: ReactNode;
}

interface NavItem {
  readonly area: ShellSurfaceArea;
  readonly label: string;
  readonly route: ShellRoute;
  readonly disabled: boolean;
  readonly disabledReason: string;
}

function navItemsFor(role: ShellOperatorRole): readonly NavItem[] {
  return SHELL_AREA_ORDER.map((area) => {
    const views = navigableViews(role, area);
    const entryView = SHELL_AREA_VIEWS[area].find((view) => views.includes(view)) ??
      SHELL_AREA_VIEWS[area][0]!;
    const nav = canNavigate(role, { area, view: entryView });
    return {
      area,
      label: SHELL_AREA_LABELS[area],
      route: { area, view: entryView },
      disabled: !nav.ok,
      disabledReason: nav.ok ? "" : `Not available to role '${role}'.`,
    };
  });
}

function isActiveArea(route: ShellRoute, area: ShellSurfaceArea): boolean {
  return route.area === area;
}

/** The sidebar (desktop) and the full nav sheet content (mobile). */
function NavList({
  items,
  route,
  onNavigate,
  heading,
}: {
  readonly items: readonly NavItem[];
  readonly route: ShellRoute;
  readonly onNavigate: (route: ShellRoute) => void;
  readonly heading: string;
}): JSX.Element {
  return (
    <nav aria-label={heading}>
      {NAV_GROUPS.map((group) => {
        const groupItems = items.filter((item) => group.areas.includes(item.area));
        if (groupItems.length === 0) return null;
        return (
          <div className="fos-sidebar__group" key={group.label}>
            <span className="fos-sidebar__group-label">{group.label}</span>
            {groupItems.map((item) => (
              <button
                key={item.area}
                type="button"
                className={`fos-sidebar__link${item.disabled ? " fos-sidebar__link--disabled" : ""}`}
                aria-current={isActiveArea(route, item.area) ? "page" : undefined}
                disabled={item.disabled}
                title={item.disabled ? item.disabledReason : item.label}
                onClick={() => onNavigate(item.route)}
              >
                <span>{item.label}</span>
                {item.disabled && (
                  <span className="fos-meta" aria-hidden="true">
                    restricted
                  </span>
                )}
              </button>
            ))}
          </div>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// The command palette (global search)
// ---------------------------------------------------------------------------

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly records: readonly ShellRecordSummary[];
  readonly onSelect: (result: ShellSearchResult) => void;
}

export function CommandPalette({
  open,
  onClose,
  records,
  onSelect,
}: CommandPaletteProps): JSX.Element | null {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const index = useMemo(() => buildSearchIndex(records), [records]);
  const outcome = useMemo(
    () => searchIndex(index, query),
    [index, query],
  );
  const results = outcome.ok ? outcome.results : [];

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      }
      if (event.key === "Enter" && results[activeIndex] !== undefined) {
        event.preventDefault();
        onSelect(results[activeIndex]!);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, onSelect, results, activeIndex]);

  if (!open) return null;

  return (
    <div
      className="fos-cmd-scrim"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="fos-cmd"
        role="dialog"
        aria-modal="true"
        aria-label="Global search"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="fos-cmd__input"
          type="text"
          value={query}
          placeholder="Search records, capabilities, areas…"
          aria-label="Search records, capabilities, areas"
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
        />
        {query.trim().length === 0 ? (
          <div className="fos-cmd__empty">
            Type to search — results land directly on the record. No package or module
            names required.
          </div>
        ) : results.length === 0 ? (
          <div className="fos-cmd__empty">
            No records matched “{query.trim()}”. Try a device name, a finding title, a
            vendor, or a capability.
          </div>
        ) : (
          <ul className="fos-cmd__list" role="listbox" aria-label="Search results">
            {results.map((result, i) => (
              <li key={`${result.entry.area}-${result.entry.recordId}-${i}`} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={i === activeIndex}
                  data-active={i === activeIndex}
                  className="fos-cmd__item"
                  onClick={() => onSelect(result)}
                >
                  <span className="fos-cmd__item-title">
                    <Badge>{SHELL_AREA_LABELS[result.entry.area]}</Badge>
                    <span>{result.entry.title}</span>
                  </span>
                  <span className="fos-cmd__item-sub">
                    matched {result.match.replace(/_/g, " ")} — {result.entry.recordId}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="fos-cmd__hint">
          ↑↓ to move · Enter to open · Esc to close — search semantics are deterministic
          (W061 contract).
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The AppShell
// ---------------------------------------------------------------------------

export function AppShell(props: AppShellProps): JSX.Element {
  const { route, onNavigate, role, tenantLabel, environmentLabel, records, onSearchLanding, children } = props;
  const [searchOpen, setSearchOpen] = useState(false);
  const [navSheetOpen, setNavSheetOpen] = useState(false);
  const navItems = useMemo(() => navItemsFor(role), [role]);
  const crumbs = useMemo(() => breadcrumbsFor(route), [route]);
  const pageTitle = labelForRoute(route.area, route.view);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openRoute = (target: ShellRoute): void => {
    setNavSheetOpen(false);
    onNavigate(target);
  };

  return (
    <div className="fos-scope fos-app">
      <ConsoleStyles />
      <a className="fos-skip" href="#fos-main">
        Skip to main content
      </a>

      <aside className="fos-sidebar" aria-label="Primary">
        <div className="fos-sidebar__brand">
          <span className="fos-sidebar__brand-name">FleetOS</span>
          <span className="fos-sidebar__brand-sub">
            {tenantLabel} · {environmentLabel}
          </span>
        </div>
        <NavList items={navItems} route={route} onNavigate={openRoute} heading="Primary navigation" />
        <div className="fos-sidebar__footer">
          <span>
            Role: <strong>{role}</strong>
          </span>
          <span>Restricted areas are marked and explain why.</span>
        </div>
      </aside>

      <div className="fos-main">
        <header className="fos-mobilebar">
          <button
            type="button"
            className="fos-mobilebar__menu"
            aria-label="Open navigation"
            onClick={() => setNavSheetOpen(true)}
          >
            Menu
          </button>
          <span className="fos-mobilebar__brand">FleetOS</span>
          <button
            type="button"
            className="fos-mobilebar__menu"
            aria-label="Open global search"
            onClick={() => setSearchOpen(true)}
          >
            Search
          </button>
        </header>

        <header className="fos-topbar">
          <h1 className="fos-topbar__title">FleetOS Console</h1>
          <button
            type="button"
            className="fos-search-trigger"
            aria-label="Open global search (Ctrl+K)"
            onClick={() => setSearchOpen(true)}
          >
            <span aria-hidden="true">Search records, capabilities, areas…</span>
            <kbd>Ctrl K</kbd>
          </button>
          <span className="fos-topbar__ident">
            <span className="fos-topbar__ident-dot" aria-hidden="true" />
            <span>
              {tenantLabel} · {environmentLabel} · {role}
            </span>
          </span>
        </header>

        <div className="fos-content" id="fos-main">
          <div className="fos-content-header">
            <Breadcrumb items={crumbs.map((crumb) => ({ label: crumb.label }))} />
            <h2>{pageTitle}</h2>
          </div>
          <main className="fos-content-body" aria-label={pageTitle}>
            {children}
          </main>
        </div>

        <nav className="fos-mobilenav" aria-label="Mobile primary">
          {MOBILE_NAV_AREAS.map((area) => {
            const item = navItems.find((entry) => entry.area === area);
            if (item === undefined) return null;
            return (
              <button
                key={area}
                type="button"
                className="fos-mobilenav__link"
                aria-current={isActiveArea(route, area) ? "page" : undefined}
                disabled={item.disabled}
                title={item.disabled ? item.disabledReason : item.label}
                onClick={() => openRoute(item.route)}
              >
                <span className="fos-mobilenav__link-label">{SHELL_AREA_LABELS[area]}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <Sheet
        open={navSheetOpen}
        title="All areas"
        onClose={() => setNavSheetOpen(false)}
        closeLabel="Close navigation"
      >
        <div className="fos-stack">
          <p className="fos-meta">
            {tenantLabel} · {environmentLabel} · role {role}
          </p>
          <NavList
            items={navItems}
            route={route}
            onNavigate={openRoute}
            heading="Full navigation"
          />
        </div>
      </Sheet>

      <CommandPalette
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        records={records}
        onSelect={(result) => {
          setSearchOpen(false);
          onSearchLanding(result);
        }}
      />
    </div>
  );
}

/** Re-exported for the screens: the coherence-band chrome status. */
export { bandConsoleStatus };
