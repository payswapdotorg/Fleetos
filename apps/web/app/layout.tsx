import type { JSX } from "react";
import type { Metadata } from "next";
import "../src/console-styles.css";

export const metadata: Metadata = {
  title: "FleetOS Console",
  description:
    "The FleetOS operator console — Control Tower, devices, security, policies, actions, workloads, commerce, evidence and learning.",
};

export default function RootLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
