import { parsePatch, type ParsedPatch } from "./diff";
import { estimateTokens } from "./tokens";
import type { ChangedFile } from "./types";

export interface PreparedFile {
  path: string;
  status: ChangedFile["status"];
  parsed: ParsedPatch;
  /** Text actually sent to the model (may be truncated). */
  rendered: string;
  tokens: number;
  truncated: boolean;
}

export interface ChunkOptions {
  /** Max estimated tokens of diff per model call. */
  batchTokens: number;
  /** Max estimated tokens for a single file before its diff is truncated. */
  fileTokens: number;
  /** Max estimated tokens across the whole review; files past this are skipped. */
  totalTokens: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  batchTokens: 12_000,
  fileTokens: 6_000,
  totalTokens: 60_000,
};

export function prepareFile(file: ChangedFile, fileTokens: number): PreparedFile | null {
  if (!file.patch) return null;
  const parsed = parsePatch(file.patch);
  if (parsed.commentableLines.size === 0) return null;
  let rendered = parsed.annotated;
  let truncated = false;
  if (estimateTokens(rendered) > fileTokens) {
    rendered = `${rendered.slice(0, fileTokens * 4)}\n… [diff truncated]`;
    truncated = true;
  }
  return { path: file.path, status: file.status, parsed, rendered, tokens: estimateTokens(rendered), truncated };
}

const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|swift|scala|c|cc|cpp|h|hpp|sql|sh)$/i;
const DATA = /\.(json|ya?ml|toml|lock|csv|svg|css|scss|html|md|txt)$/i;

/** Review order under a budget: source code first, then everything else, data and assets last. */
export function fileRank(path: string): number {
  if (CODE.test(path)) return 0;
  if (DATA.test(path)) return 2;
  return 1;
}

/**
 * Bin-packs files into model-sized batches under a total budget. Source code goes first and, within a
 * rank, smaller diffs first, so the budget covers as many real changes as possible. (Largest-first spent a
 * 491-file PR's whole budget on six vendored files and skipped all of its application code.)
 */
export function chunkFiles(
  files: PreparedFile[],
  opts: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
): { batches: PreparedFile[][]; skipped: string[] } {
  const sorted = [...files].sort((a, b) => fileRank(a.path) - fileRank(b.path) || a.tokens - b.tokens);
  const batches: { files: PreparedFile[]; tokens: number }[] = [];
  const skipped: string[] = [];
  let total = 0;

  for (const file of sorted) {
    if (total + file.tokens > opts.totalTokens) {
      skipped.push(file.path);
      continue;
    }
    total += file.tokens;
    const target = batches.find((b) => b.tokens + file.tokens <= opts.batchTokens);
    if (target) {
      target.files.push(file);
      target.tokens += file.tokens;
    } else {
      batches.push({ files: [file], tokens: file.tokens });
    }
  }
  return { batches: batches.map((b) => b.files), skipped };
}
