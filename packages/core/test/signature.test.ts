import { expect, test } from "bun:test";
import { signGithubPayload, verifyGithubSignature } from "../src";

test("accepts a valid signature and rejects tampering", () => {
  const body = JSON.stringify({ action: "opened" });
  const sig = signGithubPayload("s3cret", body);
  expect(verifyGithubSignature("s3cret", body, sig)).toBe(true);
  expect(verifyGithubSignature("s3cret", body + " ", sig)).toBe(false);
  expect(verifyGithubSignature("other", body, sig)).toBe(false);
  expect(verifyGithubSignature("s3cret", body, null)).toBe(false);
  expect(verifyGithubSignature("s3cret", body, "sha256=abc")).toBe(false);
});
