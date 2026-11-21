import { createAppAuth } from "@octokit/auth-app";
import { retry } from "@octokit/plugin-retry";
import { throttling } from "@octokit/plugin-throttling";
import { Octokit } from "@octokit/rest";
import type { ChangedFile, PullRequestInfo } from "./types";

export interface ReviewCommentInput {
  path: string;
  line: number;
  start_line?: number;
  side: "RIGHT";
  start_side?: "RIGHT";
  body: string;
}

/** The slice of GitHub the review pipeline needs. Real Octokit in prod, in-memory fake in tests. */
export interface GitHubClient {
  getPullRequest(owner: string, repo: string, prNumber: number): Promise<PullRequestInfo>;
  listPullRequestFiles(owner: string, repo: string, prNumber: number): Promise<ChangedFile[]>;
  /** Returns null when the file does not exist at `ref`. */
  getFileText(owner: string, repo: string, path: string, ref: string): Promise<string | null>;
  createReview(input: {
    owner: string;
    repo: string;
    prNumber: number;
    commitId: string;
    body: string;
    comments: ReviewCommentInput[];
  }): Promise<{ id: number }>;
}

const ThrottledOctokit = Octokit.plugin(retry, throttling);

export interface GitHubAppCredentials {
  appId: string;
  privateKey: string;
}

/** Builds an Octokit authenticated as one installation of the GitHub App (tokens auto-refresh). */
export function installationOctokit(creds: GitHubAppCredentials, installationId: number): Octokit {
  return new ThrottledOctokit({
    authStrategy: createAppAuth,
    auth: { appId: creds.appId, privateKey: creds.privateKey, installationId },
    userAgent: "PullPanda",
    throttle: {
      onRateLimit: (_retryAfter, _options, _octokit, retryCount) => retryCount < 2,
      onSecondaryRateLimit: (_retryAfter, _options, _octokit, retryCount) => retryCount < 2,
    },
  });
}

export function appOctokit(creds: GitHubAppCredentials): Octokit {
  return new ThrottledOctokit({
    authStrategy: createAppAuth,
    auth: { appId: creds.appId, privateKey: creds.privateKey },
    userAgent: "PullPanda",
    throttle: { onRateLimit: () => false, onSecondaryRateLimit: () => false },
  });
}

export class OctokitGitHubClient implements GitHubClient {
  constructor(private octokit: Octokit) {}

  static forInstallation(creds: GitHubAppCredentials, installationId: number) {
    return new OctokitGitHubClient(installationOctokit(creds, installationId));
  }

  async getPullRequest(owner: string, repo: string, prNumber: number): Promise<PullRequestInfo> {
    const { data } = await this.octokit.pulls.get({ owner, repo, pull_number: prNumber });
    return {
      title: data.title,
      body: data.body,
      draft: Boolean(data.draft),
      state: data.state as "open" | "closed",
      headSha: data.head.sha,
      baseRef: data.base.ref,
    };
  }

  async listPullRequestFiles(owner: string, repo: string, prNumber: number): Promise<ChangedFile[]> {
    const files = await this.octokit.paginate(this.octokit.pulls.listFiles, {
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
    });
    return files.map((f) => ({
      path: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
    }));
  }

  async getFileText(owner: string, repo: string, path: string, ref: string): Promise<string | null> {
    try {
      const { data } = await this.octokit.repos.getContent({ owner, repo, path, ref });
      if (Array.isArray(data) || data.type !== "file" || !("content" in data)) return null;
      return Buffer.from(data.content, "base64").toString("utf8");
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
  }

  async createReview(input: Parameters<GitHubClient["createReview"]>[0]): Promise<{ id: number }> {
    const { data } = await this.octokit.pulls.createReview({
      owner: input.owner,
      repo: input.repo,
      pull_number: input.prNumber,
      commit_id: input.commitId,
      event: "COMMENT",
      body: input.body,
      comments: input.comments,
    });
    return { id: data.id };
  }
}
