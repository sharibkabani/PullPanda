/** Build-time links. The landing page is static, so these are baked in by `next build`. */
const slug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;
export const DASHBOARD_URL = "/dashboard/";
/** Without an app slug (local dev) the main action falls back to the dashboard, which explains setup. */
export const INSTALL_URL = slug ? `https://github.com/apps/${slug}/installations/new` : DASHBOARD_URL;
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
