/**
 * @fleetos/web-device — the SERVER entry point.
 *
 * W144 deploy convergence (TL scope, additive): the Next.js server routes
 * (the W140 server-side control plane) need this lane's DOMAIN bindings —
 * but the package ROOT barrel also re-exports the lane's UI surface
 * (screens + React-hook primitives), and a server route importing the
 * barrel pulls client-side React hooks into the server bundle (the
 * Next.js server/client boundary violation that broke every Vercel build
 * since the W141 merge).
 *
 * This entry re-exports ONLY the server-safe domain bindings — pure
 * TypeScript over @fleetos/contracts + @fleetos/device-adapters, zero
 * React, zero UI. It is a DECLARED package export ("./server" in
 * package.json exports): a public API point the server may import —
 * never an internal deep path.
 */
export * from "./install-center-binding";
