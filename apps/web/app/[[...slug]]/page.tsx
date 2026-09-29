"use client";
/**
 * The console's single catch-all route (W091 [TL]).
 *
 * Every URL maps onto the shell's frozen route vocabulary (/{area}/
 * {view}; Control Tower at /). Unknown paths match THIS route too —
 * and fail SAFELY inside the ConsoleApp (the machine-stable
 * unknown-route state with search + home links, never a crash).
 */
import { use } from "react";
import { ConsoleApp, pathToRoute } from "../../src/console-app";
import type { ShellRoute } from "@fleetos/web-shell";

interface PageProps {
  readonly params: Promise<{ readonly slug?: readonly string[] }>;
}

export default function Page({ params }: PageProps): React.JSX.Element {
  const { slug } = use(params);
  const check = pathToRoute(slug ?? []);
  const initial: ShellRoute = check.ok ? check.route : { area: "overview", view: "home" };
  return <ConsoleApp initialRoute={initial} />;
}
