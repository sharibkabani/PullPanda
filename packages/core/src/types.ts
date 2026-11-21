import type { Severity } from "./config";

export interface PullRequestRef {
  installationId: number;
  owner: string;
  repo: string;
  repositoryId: number;
  prNumber: number;
  headSha: string;
}

export interface PullRequestInfo {
  title: string;
  body: string | null;
  draft: boolean;
  state: "open" | "closed";
  headSha: string;
  baseRef: string;
}

export interface ChangedFile {
  path: string;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  additions: number;
  deletions: number;
  /** Missing for binary files and for diffs GitHub considers too large. */
  patch?: string;
}

export interface Finding {
  path: string;
  /** New-file line the comment anchors to (end line for ranges). */
  line: number;
  startLine?: number;
  severity: Severity;
  category: "bug" | "security" | "performance" | "correctness" | "maintainability" | "style" | "testing";
  title: string;
  body: string;
  /** Replacement code for lines [startLine ?? line, line]; rendered as a GitHub suggestion. */
  suggestion?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}
