import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { SEVERITIES } from "./config";
import type { PreparedFile } from "./chunk";
import type { Finding, PullRequestInfo, TokenUsage } from "./types";

export interface ReviewBatchInput {
  pr: Pick<PullRequestInfo, "title" | "body">;
  files: PreparedFile[];
  instructions?: string;
}

export interface ReviewBatchOutput {
  summary: string;
  findings: Finding[];
  usage: TokenUsage;
}

/** Anything that can review a batch of diffs. OpenAI in production, a fake in tests. */
export interface ReviewModel {
  readonly name: string;
  reviewBatch(input: ReviewBatchInput): Promise<ReviewBatchOutput>;
}

// OpenAI strict structured outputs require every key present; optional values are nullable instead.
const findingSchema = z.object({
  path: z.string().describe("File path exactly as given in the diff header"),
  line: z.number().int().describe("New-file line number from the left gutter; for ranges, the last line"),
  start_line: z.number().int().nullable().describe("First line of a multi-line range, or null"),
  severity: z.enum(SEVERITIES),
  category: z.enum(["bug", "security", "performance", "correctness", "maintainability", "style", "testing"]),
  title: z.string().describe("One short sentence naming the problem"),
  body: z.string().describe("Why it matters and how to fix it. Markdown, 1-4 sentences."),
  suggestion: z
    .string()
    .nullable()
    .describe("Exact replacement code for lines start_line..line (no fences), or null if not a direct fix"),
});

export const reviewResponseSchema = z.object({
  summary: z.string().describe("2-4 sentence overview of what this change does and its main risks"),
  findings: z.array(findingSchema),
});

export const SYSTEM_PROMPT = `You are PullPanda, a senior software engineer reviewing a GitHub pull request.

You receive unified diffs annotated with new-file line numbers in the left gutter:
  "  42 + code" is an added line 42, "  43   code" is unchanged context line 43, "      - code" is a removed line (no number; cannot be commented on).

Rules:
- Only report real problems a careful senior reviewer would raise: bugs, security issues, data loss, race conditions, broken error handling, performance traps, missing edge cases, misleading names, and missing tests for risky logic.
- Prefer findings on added lines. Never invent line numbers; use only numbers shown in the gutter for that file.
- Do not comment on formatting a linter would catch, and do not praise the code.
- severity: critical = will break or is exploitable; warning = likely bug or real risk; suggestion = worthwhile improvement; nit = minor.
- Provide "suggestion" only when it is a complete drop-in replacement for exactly the lines start_line..line.
- If nothing is worth raising, return an empty findings array.`;

export function renderBatchPrompt({ pr, files, instructions }: ReviewBatchInput): string {
  const parts = [`# Pull request: ${pr.title}`];
  if (pr.body?.trim()) parts.push(`## Description\n${pr.body.slice(0, 2000)}`);
  if (instructions?.trim()) parts.push(`## Repository review guidelines\n${instructions}`);
  parts.push("## Changed files");
  for (const f of files) {
    parts.push(`### ${f.path} (${f.status}${f.truncated ? ", truncated" : ""})\n\`\`\`diff\n${f.rendered}\n\`\`\``);
  }
  return parts.join("\n\n");
}

export class OpenAIReviewModel implements ReviewModel {
  readonly name: string;
  private client: OpenAI;

  constructor(opts: { apiKey: string; model?: string; client?: OpenAI }) {
    this.client = opts.client ?? new OpenAI({ apiKey: opts.apiKey, maxRetries: 3, timeout: 120_000 });
    this.name = opts.model ?? "gpt-5.4-mini";
  }

  async reviewBatch(input: ReviewBatchInput): Promise<ReviewBatchOutput> {
    const response = await this.client.responses.parse({
      model: this.name,
      instructions: SYSTEM_PROMPT,
      input: renderBatchPrompt(input),
      text: { format: zodTextFormat(reviewResponseSchema, "code_review") },
    });
    const parsed = response.output_parsed;
    if (!parsed) throw new Error("Model returned no parseable review");
    return {
      summary: parsed.summary,
      findings: parsed.findings.map((f) => ({
        path: f.path,
        line: f.line,
        startLine: f.start_line ?? undefined,
        severity: f.severity,
        category: f.category,
        title: f.title,
        body: f.body,
        suggestion: f.suggestion ?? undefined,
      })),
      usage: {
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      },
    };
  }
}

/** USD per million tokens, configured per deployment since prices change. */
export function estimateCostUsd(usage: TokenUsage, prices = {
  input: Number(process.env.OPENAI_INPUT_USD_PER_MTOK ?? 0),
  output: Number(process.env.OPENAI_OUTPUT_USD_PER_MTOK ?? 0),
}): number {
  return (usage.inputTokens * prices.input + usage.outputTokens * prices.output) / 1_000_000;
}
