import { API_URL } from "@/lib/site";

export interface Repo {
  id: number;
  fullName: string;
  private: boolean;
  enabled: boolean;
  effectivePlan: "free" | "pro";
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
}
export interface ReviewRow {
  id: string;
  repository: string;
  prNumber: number;
  headSha: string;
  status: "queued" | "running" | "completed" | "failed" | "skipped";
  skipReason: string | null;
  commentsPosted: number;
  filesReviewed: number;
  durationMs: number | null;
  costUsd: number;
  error: string | null;
  createdAt: string;
}
export interface Me {
  user: { login: string; name: string | null; avatarUrl: string | null };
  installations: { id: number; accountLogin: string; suspended: boolean }[];
  repositories: Repo[];
  reviews: ReviewRow[];
  stats: { total: number; comments: number; p50: number | null; p95: number | null; failed: number; costUsd: number };
}
export interface PublicConfig {
  installUrl: string | null;
  loginUrl: string;
  billingEnabled: boolean;
}

export class Unauthorized extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (res.status === 401) throw new Unauthorized();
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  config: () => call<PublicConfig>("/config"),
  me: () => call<Me>("/api/me"),
  setEnabled: (id: number, enabled: boolean) => call(`/api/repositories/${id}`, { method: "PATCH", body: JSON.stringify({ enabled }) }),
  checkout: (repositoryId: number) => call<{ url: string }>("/api/billing/checkout", { method: "POST", body: JSON.stringify({ repositoryId }) }),
  portal: () => call<{ url: string }>("/api/billing/portal", { method: "POST" }),
  logout: () => call("/auth/logout", { method: "POST" }),
};
