import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendAttestation,
  attestationLogPath,
  computeDiffHash,
  readAttestations,
  reviewAttestationSchema,
} from "../src/review-attestation.js";

describe("computeDiffHash", () => {
  it("is deterministic for identical diff content", () => {
    const fakeGit = () => "diff --git a/x b/x\n+hello\n";
    expect(computeDiffHash("main..HEAD", "/repo", fakeGit)).toBe(
      computeDiffHash("main..HEAD", "/repo", fakeGit),
    );
  });

  it("changes when the diff content changes by one character", () => {
    const a = computeDiffHash("main..HEAD", "/repo", () => "+hello\n");
    const b = computeDiffHash("main..HEAD", "/repo", () => "+hellO\n");
    expect(a).not.toBe(b);
  });

  it("returns a 64-char hex string", () => {
    const hash = computeDiffHash("main..HEAD", "/repo", () => "anything");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("passes the exact range and cwd through to execGit as a git diff invocation", () => {
    const spy = vi.fn(() => "");
    computeDiffHash("main..HEAD", "/my/repo", spy);
    expect(spy).toHaveBeenCalledWith(["diff", "--no-color", "main..HEAD"], "/my/repo");
  });
});

describe("appendAttestation / readAttestations", () => {
  let storeRoot: string;
  beforeEach(() => {
    storeRoot = mkdtempSync(join(tmpdir(), "review-attest-test-"));
  });
  afterEach(() => {
    rmSync(storeRoot, { recursive: true, force: true });
  });

  const RECORD = reviewAttestationSchema.parse({
    diffHash: "a".repeat(64),
    baseRef: "main",
    headRef: "HEAD",
    verdict: "approve",
    reviewerLabel: "code-reviewer",
    createdAt: "2026-08-08T00:00:00.000Z",
  });

  it("round-trips every field", () => {
    appendAttestation(storeRoot, "proj1", RECORD);
    const rows = readAttestations(storeRoot, "proj1");
    expect(rows).toEqual([RECORD]);
  });

  it("skips a malformed line without throwing", () => {
    appendAttestation(storeRoot, "proj1", RECORD);
    appendFileSync(attestationLogPath(storeRoot, "proj1"), "not-json\n");
    const rows = readAttestations(storeRoot, "proj1");
    expect(rows).toEqual([RECORD]);
  });

  it("throws on a write failure instead of swallowing it", () => {
    const fileAsRoot = join(storeRoot, "blocker-file");
    writeFileSync(fileAsRoot, "not a directory");
    expect(() => appendAttestation(fileAsRoot, "proj1", RECORD)).toThrow();
  });
});
