import { parse as parseYaml } from "yaml";
import { z } from "zod";

export const SEVERITIES = ["critical", "warning", "suggestion", "nit"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const severityRank: Record<Severity, number> = { critical: 0, warning: 1, suggestion: 2, nit: 3 };

/** Per-repo settings read from `.diffpanda.yml` at the PR's head commit. */
export const repoConfigSchema = z.object({
  enabled: z.boolean().default(true),
  ignore: z.array(z.string()).default([]),
  minSeverity: z.enum(SEVERITIES).default("suggestion"),
  maxComments: z.number().int().min(1).max(50).default(15),
  reviewDrafts: z.boolean().default(false),
  instructions: z.string().max(4000).optional(),
});
export type RepoConfig = z.infer<typeof repoConfigSchema>;

export const DEFAULT_CONFIG: RepoConfig = repoConfigSchema.parse({});
export const CONFIG_PATH = ".diffpanda.yml";
/** Read when CONFIG_PATH is missing: repositories set up before the rename. */
export const LEGACY_CONFIG_PATH = ".pullpanda.yml";

/** Files that are never worth an LLM's attention. */
export const DEFAULT_IGNORES = [
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
  "**/bun.lock",
  "**/bun.lockb",
  "**/Cargo.lock",
  "**/go.sum",
  "**/poetry.lock",
  "**/*.min.js",
  "**/*.min.css",
  "**/*.map",
  "**/*.snap",
  "**/dist/**",
  "**/build/**",
  "**/vendor/**",
  "**/third_party/**",
  "**/public/assets/**",
  "**/migrations/meta/**",
  "**/node_modules/**",
  "**/*.{png,jpg,jpeg,gif,webp,ico,svg,pdf,woff,woff2,ttf,mp4,zip}",
];

export function parseRepoConfig(text: string | null): { config: RepoConfig; error?: string } {
  if (!text) return { config: DEFAULT_CONFIG };
  try {
    const result = repoConfigSchema.safeParse(parseYaml(text) ?? {});
    if (!result.success) {
      return { config: DEFAULT_CONFIG, error: `Invalid ${CONFIG_PATH}: ${result.error.issues[0]?.message}` };
    }
    return { config: result.data };
  } catch (e) {
    return { config: DEFAULT_CONFIG, error: `Could not parse ${CONFIG_PATH}: ${(e as Error).message}` };
  }
}

export function isIgnored(path: string, patterns: string[]): boolean {
  // Bun.Glob does not match "**/" against zero directories, so also try the root-level form.
  return patterns.some((p) => {
    if (new Bun.Glob(p).match(path)) return true;
    return p.startsWith("**/") && new Bun.Glob(p.slice(3)).match(path);
  });
}
