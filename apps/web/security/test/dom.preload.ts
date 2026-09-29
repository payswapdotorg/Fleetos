/**
 * @fleetos/web-security — browser-facing test preload (happy-dom).
 *
 * Installs a happy-dom browser environment on the Bun test global scope
 * BEFORE any test module (and therefore any library module it imports)
 * is evaluated. This matters because several testing libraries capture
 * browser globals at module-load time (e.g. `@testing-library/dom`'s
 * `screen` binds `document.body` while its module body runs, and
 * `@testing-library/user-event` captures `globalThis.document` into its
 * default options at load). The W090A work order established exactly
 * this mechanism for the device/recovery lanes; W090B ships the same
 * guarded preload for the learning/security/actions lanes.
 *
 * Wired in via the repository-root `bunfig.toml` `[test] preload` list.
 * Guarded by a global marker so installing twice (every lane ships the
 * same preload) is a no-op — every test file in the process shares one
 * deterministic happy-dom window.
 *
 * Test infrastructure only; never imported by src/. No framework code,
 * no domain code — pure environment setup.
 */

import { Window } from "happy-dom";

const MARKER = "__fleetosHappyDomInstalled" as const;

const g = globalThis as unknown as Record<string, unknown>;

if (g[MARKER] !== true) {
  g[MARKER] = true;

  const win = new Window();
  const doc = win.document;

  // The browser globals the testing libraries + React DOM expect.
  g.window = win;
  g.document = doc;
  g.navigator = win.navigator;
  g.location = win.location;
  g.history = win.history;
  g.HTMLElement = win.HTMLElement;
  g.HTMLInputElement = win.HTMLInputElement;
  g.HTMLTextAreaElement = win.HTMLTextAreaElement;
  g.HTMLButtonElement = win.HTMLButtonElement;
  g.HTMLSelectElement = win.HTMLSelectElement;
  g.HTMLAnchorElement = win.HTMLAnchorElement;
  g.Element = win.Element;
  g.Node = win.Node;
  g.NodeList = win.NodeList;
  g.Event = win.Event;
  g.CustomEvent = win.CustomEvent;
  g.KeyboardEvent = win.KeyboardEvent;
  g.MouseEvent = win.MouseEvent;
  g.FocusEvent = win.FocusEvent;
  g.InputEvent = win.InputEvent;
  g.MutationObserver = win.MutationObserver;
  g.getComputedStyle = win.getComputedStyle.bind(win);
  g.getSelection = win.getSelection.bind(win);

  // React 19 act() environment (no async act warnings in tests).
  g.IS_REACT_ACT_ENVIRONMENT = true;

  // Keep the window reference reachable for tests that need it.
  g.__fleetosHappyDomWindow = win;
}

export {};
