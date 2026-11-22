import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "PullPanda: AI code review for GitHub pull requests",
  description:
    "A GitHub App that reviews every push to a pull request and posts line comments with fixes you commit in one click. Free for public repositories.",
  openGraph: {
    type: "website",
    title: "PullPanda: AI code review for GitHub pull requests",
    description: "Line comments and one-click fixes on every push. Free for public repositories.",
    images: ["/share.jpg"],
  },
  twitter: { card: "summary_large_image" },
  icons: { icon: { url: "/favicon.svg", type: "image/svg+xml" } },
  other: { "site-kind": "software", "page-type": "software" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#18191b",
};

const PALETTE = `:root {
  --p-bg: #18191b; --p-surface: #222427; --p-ink: #eff0f1; --p-muted: #9c9ea3;
  --p-accent: #ff4a1f; --p-accent-ink: #18191b; --p-action: #ff4a1f; --p-action-ink: #18191b;
  --p-inv-bg: #eff0f1; --p-inv-surface: #dedfe0; --p-inv-ink: #18191b; --p-inv-muted: #5b5c5e;
  --p-inv-accent: #18191b; --p-inv-accent-ink: #eff0f1; --p-inv-action: #18191b; --p-inv-action-ink: #eff0f1;
  --font-display: "Onest", system-ui, sans-serif;
  --font-text: "Onest", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  --display-weight: 400;
  --display-tracking: -0.035em;
  --display-tracking-xl: -0.04em;
}`;

const ENTER = "document.documentElement.classList.add('m-enter');setTimeout(()=>document.documentElement.classList.add('m-enter-done'),700)";
const MOMENTS = "document.documentElement.classList.add('mo-js');setTimeout(()=>document.documentElement.classList.add('mo-safe'),2500)";

/** The marketing shell: the taste kit's head, in its required order. The dashboard has its own root layout. */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-type="software" data-radius="sharp" data-ground="sand" data-buttons="solid" data-motion="" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Onest:wght@400..700&family=JetBrains+Mono:wght@400..500&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="/assets/system.css" />
        <link rel="stylesheet" href="/assets/ui/cards.css" />
        <link rel="stylesheet" href="/assets/motion/motion.css" />
        <link rel="stylesheet" href="/assets/backgrounds/backgrounds.css" />
        <link rel="stylesheet" href="/assets/layout/layout.css" />
        <link rel="stylesheet" href="/assets/icons/icon.css" />
        <style dangerouslySetInnerHTML={{ __html: PALETTE }} />
        <link rel="stylesheet" href="/assets/ui/base.css" />
        {["window", "diff-review", "notify", "toggles", "checklist", "code"].map((f) => (
          <link key={f} rel="stylesheet" href={`/assets/ui/${f}/fragment.css`} />
        ))}
        <link rel="stylesheet" href="/assets/diagrams/diagram.css" />
        <link rel="stylesheet" href="/landing.css" />
        <script dangerouslySetInnerHTML={{ __html: ENTER }} />
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/assets/backgrounds/backgrounds.js" />
        <script dangerouslySetInnerHTML={{ __html: MOMENTS }} />
        <link rel="modulepreload" href="/assets/moments/moments.js" />
        <link rel="modulepreload" href="/assets/moments/lib.js" />
        <link rel="modulepreload" href="/assets/moments/liquid-type/moment.js" />
      </head>
      <body suppressHydrationWarning>
        {children}
        <script type="module" src="/assets/system.js" />
        <script type="module" src="/assets/motion/motion.js" />
        <script type="module" src="/assets/layout/layout.js" />
        <script type="module" src="/assets/diagrams/mount.js" />
        <script type="module" src="/bench-charts.js" />
      </body>
    </html>
  );
}
