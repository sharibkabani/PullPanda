import { expect, test } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import { AnthropicReviewModel, isPermanentError, prepareFile } from "../src";
import { PATCH } from "./fakes";

const file = prepareFile({ path: "src/users.ts", status: "modified", additions: 2, deletions: 1, patch: PATCH }, 6000)!;

function stub(response: Record<string, unknown>, seen: unknown[] = []) {
  return { beta: { messages: { parse: async (req: unknown) => (seen.push(req), response) } } } as unknown as Anthropic;
}

test("maps Claude's structured review and sends the configured request", async () => {
  const seen: any[] = [];
  const model = new AnthropicReviewModel({
    client: stub(
      {
        stop_reason: "end_turn",
        parsed_output: {
          summary: "Adds a lookup.",
          findings: [{ path: "src/users.ts", line: 3, start_line: null, severity: "critical", category: "security", title: "SQL injection", body: "Parameterize.", suggestion: null }],
        },
        usage: { input_tokens: 900, output_tokens: 120, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 },
      },
      seen,
    ),
  });
  const out = await model.reviewBatch({ pr: { title: "Lookup", body: null }, files: [file] });
  expect(out.findings[0]).toMatchObject({ path: "src/users.ts", line: 3, severity: "critical" });
  expect(out.findings[0]!.startLine).toBeUndefined();
  expect(out.usage).toEqual({ inputTokens: 1000, outputTokens: 120 });
  expect(seen[0]).toMatchObject({ model: "claude-sonnet-5-5", thinking: { type: "adaptive" }, fallbacks: "default" });
  expect(seen[0].output_config.effort).toBe("high");
});

test("a refusal is a permanent failure, not a retry", async () => {
  const model = new AnthropicReviewModel({
    client: stub({ stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber" }, parsed_output: null, usage: {} }),
  });
  const err = await model.reviewBatch({ pr: { title: "x", body: null }, files: [file] }).catch((e) => e);
  expect(err.message).toContain("cyber");
  expect(isPermanentError(err)).toBe(true);
});
