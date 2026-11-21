import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies GitHub's `X-Hub-Signature-256` header against the raw request body.
 * Uses a constant-time comparison so the check doesn't leak timing information.
 */
export function verifyGithubSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | null | undefined,
): boolean {
  if (!secret || !signatureHeader?.startsWith("sha256=")) return false;
  const expected = Buffer.from(
    `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`,
  );
  const received = Buffer.from(signatureHeader);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function signGithubPayload(secret: string, rawBody: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
}
