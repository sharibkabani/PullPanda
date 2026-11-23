/** Parsing of the review comments DiffPanda posts (packages/core/src/review.ts renderComment). */

const SEVERITY_BY_ICON: Record<string, string> = { "🔴": "critical", "🟠": "warning", "🔵": "suggestion", "⚪": "nit" };

export function splitRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`repo must be owner/name, got "${repo}"`);
  return { owner, name };
}

export interface ParsedFinding {
  severity: string;
  title: string;
  category: string | null;
  explanation: string;
  suggestion: string | null;
}

/** "🔴 **Title** · _category_\n\nbody\n\n```suggestion\ncode\n```" back into its parts. */
export function parseFinding(body: string): ParsedFinding {
  const [head = "", ...rest] = body.split("\n\n");
  const icon = [...head][0] ?? "";
  const title = /\*\*(.+?)\*\*/.exec(head)?.[1] ?? head.trim();
  const category = /·\s*_(.+?)_/.exec(head)?.[1] ?? null;
  const restText = rest.join("\n\n");
  const fence = /(`{3,})suggestion\n([\s\S]*?)\n\1/.exec(restText);
  return {
    severity: SEVERITY_BY_ICON[icon] ?? "unknown",
    title,
    category,
    explanation: (fence ? restText.slice(0, fence.index) : restText).trim(),
    suggestion: fence ? fence[2]! : null,
  };
}

interface ReviewLike {
  id: number;
  body: string | null;
  submitted_at?: string | null;
  user: { login: string } | null;
}

/** The newest review written by the DiffPanda app (or one carrying its header, for reviews posted by the CLI). */
export function pickDiffPandaReview<R extends ReviewLike>(reviews: R[], botLogin: string): R | undefined {
  return reviews
    .filter((r) => r.user?.login === botLogin || /(DiffPanda|PullPanda) review/.test(r.body ?? ""))
    .sort((a, b) => (b.submitted_at ?? "").localeCompare(a.submitted_at ?? ""))[0];
}
