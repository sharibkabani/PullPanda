/**
 * Parses a unified-diff `patch` (as returned by GitHub's PR files API) into
 * the set of new-file lines that can receive a review comment, plus an
 * annotated rendering that gives the model exact line numbers to cite.
 */
export interface ParsedPatch {
  /** New-file line numbers inside a hunk (added or context) — valid targets for RIGHT-side comments. */
  commentableLines: Set<number>;
  /** New-file line numbers that were added in this PR. */
  addedLines: Set<number>;
  /** Diff rendered with new-file line numbers in a gutter. */
  annotated: string;
  /** Hunk index for each commentable line, so multi-line comments never span hunks. */
  hunkOf: Map<number, number>;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

export function parsePatch(patch: string): ParsedPatch {
  const commentableLines = new Set<number>();
  const addedLines = new Set<number>();
  const hunkOf = new Map<number, number>();
  const out: string[] = [];
  let newLine = 0;
  let hunk = -1;
  let inHunk = false;

  const lines = patch.endsWith("\n") ? patch.slice(0, -1).split("\n") : patch.split("\n");
  for (const raw of lines) {
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      newLine = Number(header[3]);
      hunk++;
      inHunk = true;
      out.push(raw);
      continue;
    }
    if (!inHunk) continue;
    const marker = raw[0];
    const text = raw.slice(1);
    if (marker === "+") {
      commentableLines.add(newLine);
      addedLines.add(newLine);
      hunkOf.set(newLine, hunk);
      out.push(`${String(newLine).padStart(5)} + ${text}`);
      newLine++;
    } else if (marker === "-") {
      out.push(`      - ${text}`);
    } else if (marker === " " || raw === "") {
      // Some tools strip the leading space from blank context lines.
      commentableLines.add(newLine);
      hunkOf.set(newLine, hunk);
      out.push(`${String(newLine).padStart(5)}   ${text}`);
      newLine++;
    }
    // "\ No newline at end of file" and anything else is ignored.
  }

  return { commentableLines, addedLines, annotated: out.join("\n"), hunkOf };
}
