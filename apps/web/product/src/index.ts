/**
 * @fleetos/web-product — the product shell (W101 [TL]).
 *
 * The composition-only product experience over the W100C durable
 * identity services and the W091 rendered shell: the session gate
 * (sign-in / workspace create / join / expiry recovery), the first-run
 * onboarding rail, the active-role switcher (audited, assigned-only),
 * the approval inbox affordance, role-aware search result context,
 * and the frozen experience->operator role bridge.
 *
 * View-models and screens are presentational and fully controlled
 * (the W090 pattern); the business truth stays in the application/
 * domain packages (identity + the shell's frozen contracts).
 */

export * from "./role-bridge";
export * from "./product-session-types";
export * from "./session-screens";
export * from "./session-chrome";
export * from "./search-context";
