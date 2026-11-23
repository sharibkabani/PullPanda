import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./dashboard.css";

const PALETTE = `:root {
  --p-bg: #18191b; --p-surface: #222427; --p-ink: #eff0f1; --p-muted: #9c9ea3;
  --p-accent: #ff4a1f; --p-accent-ink: #18191b; --p-action: #ff4a1f; --p-action-ink: #18191b;
  --font-display: "Onest", system-ui, sans-serif;
  --font-text: "Onest", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, Menlo, monospace;
  --display-weight: 400;
  --display-tracking: -0.035em;
}`;

export const metadata: Metadata = {
  title: "Dashboard: DiffPanda",
  description: "Your repositories, review history and billing.",
  icons: { icon: { url: "/favicon.svg", type: "image/svg+xml" } },
};

/** The app shell: the same kit tokens as the landing page, without its marketing scripts. */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-type="software" data-radius="sharp" data-buttons="solid">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Onest:wght@400..700&family=JetBrains+Mono:wght@400..500&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="/assets/system.css" />
        {/* after system.css, so the page palette wins over the kit defaults */}
        <style dangerouslySetInnerHTML={{ __html: PALETTE }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
