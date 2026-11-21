import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { renderBatchPrompt, reviewResponseSchema, SYSTEM_PROMPT, type ReviewBatchInput, type ReviewBatchOutput, type ReviewModel } from "./llm";

/** The model declined (safety classifier) even after the server-side fallback; retrying won't help. */
export class ReviewRefusedError extends Error {
  readonly permanent = true;
  constructor(public readonly category: string | null) {
    super(`model declined to review this batch${category ? ` (${category})` : ""}`);
  }
}

/** Sonnet: half Opus 5.5's price and strong at everyday code review. ANTHROPIC_MODEL overrides it. */
export const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-5-5";

/**
 * Reviews a batch with Claude. Structured outputs constrain the reply to the review schema, so no JSON
 * repair is needed; adaptive thinking at high effort (Sonnet's default; ANTHROPIC_EFFORT to tune); and the
 * server-side fallback re-runs a refused request on another model inside the same call.
 */
export class AnthropicReviewModel implements ReviewModel {
  readonly name: string;
  private client: Anthropic;
  private effort: "low" | "medium" | "high" | "xhigh" | "max";

  constructor(opts: { apiKey?: string; model?: string; effort?: AnthropicReviewModel["effort"]; client?: Anthropic }) {
    // No key: the SDK resolves ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile.
    this.client = opts.client ?? new Anthropic({ ...(opts.apiKey ? { apiKey: opts.apiKey } : {}), maxRetries: 3, timeout: 300_000 });
    this.name = opts.model ?? ANTHROPIC_DEFAULT_MODEL;
    this.effort = opts.effort ?? "high";
  }

  async reviewBatch(input: ReviewBatchInput): Promise<ReviewBatchOutput> {
    const response = await this.client.beta.messages.parse({
      model: this.name,
      max_tokens: 16_000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: this.effort, format: betaZodOutputFormat(reviewResponseSchema) },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: renderBatchPrompt(input) }],
    });

    if (response.stop_reason === "refusal") throw new ReviewRefusedError(response.stop_details?.category ?? null);
    if (response.stop_reason === "max_tokens") throw new Error("review hit max_tokens before finishing");
    const parsed = response.parsed_output;
    if (!parsed) throw new Error("model returned no parseable review");

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
        inputTokens: response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0),
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}

/** True for failures that will happen again on retry (refusals, and anything flagged permanent). */
export const isPermanentError = (err: unknown) => Boolean((err as { permanent?: boolean })?.permanent);
