import type { NextConfig } from "next";

// Static export: the marketing page and the dashboard are plain files on any CDN.
// The dashboard talks to the Elysia API at NEXT_PUBLIC_API_URL.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
