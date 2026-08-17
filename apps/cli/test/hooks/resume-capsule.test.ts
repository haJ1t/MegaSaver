import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type ResumeCapsule,
  RESUME_CAPSULE_MAX_AGE_MS,
  consumeResumeCapsule,
  resumeCapsulePath,
  writeResumeCapsule,
} from "../../src/hooks/resume-capsule.js";

const WK = "1a2b3c4d5e6f7a8b";
const NOW = Date.parse("2026-08-06T10:00:00.000Z");
const roots: string[] = [];

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "megasaver-resume-capsule-"));
  roots.push(root);
  return root;
}

function capsule(overrides: Partial<ResumeCapsule> = {}): ResumeCapsule {
  return {
    version: 1,
    sourceSessionId: "dead-session-1",
    text: "# Session resurrection — demo\npointer body\n",
    tokenCount: 12,
    createdAt: NOW - 60_000,
    ...overrides,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("resume capsule store", () => {
  it("round-trips write then consume; second consume returns null", () => {
    const root = createRoot();
    writeResumeCapsule(root, WK, capsule());
    expect(existsSync(resumeCapsulePath(root, WK))).toBe(true);

    const consumed = consumeResumeCapsule(root, WK, "next-session-1", () => NOW);
    expect(consumed?.sourceSessionId).toBe("dead-session-1");
    expect(existsSync(resumeCapsulePath(root, WK))).toBe(false);
    expect(consumeResumeCapsule(root, WK, "next-session-2", () => NOW)).toBeNull();
  });

  it("discards a capsule older than RESUME_CAPSULE_MAX_AGE_MS", () => {
    const root = createRoot();
    writeResumeCapsule(root, WK, capsule({ createdAt: NOW - RESUME_CAPSULE_MAX_AGE_MS - 1 }));
    expect(consumeResumeCapsule(root, WK, "next-session-1", () => NOW)).toBeNull();
    expect(existsSync(resumeCapsulePath(root, WK))).toBe(false);
  });

  it("discards a malformed capsule file and returns null", () => {
    const root = createRoot();
    writeResumeCapsule(root, WK, capsule());
    writeFileSync(resumeCapsulePath(root, WK), "{not json");
    expect(consumeResumeCapsule(root, WK, "next-session-1", () => NOW)).toBeNull();
    expect(existsSync(resumeCapsulePath(root, WK))).toBe(false);
  });

  it("returns null without creating files when nothing is pending", () => {
    const root = createRoot();
    expect(consumeResumeCapsule(root, WK, "next-session-1", () => NOW)).toBeNull();
  });

  it("rejects an unsafe claiming session id without touching the capsule", () => {
    const root = createRoot();
    writeResumeCapsule(root, WK, capsule());
    expect(consumeResumeCapsule(root, WK, "../evil", () => NOW)).toBeNull();
    expect(existsSync(resumeCapsulePath(root, WK))).toBe(true);
  });

  it("leaves no stray tmp files behind after a consume", () => {
    const root = createRoot();
    writeResumeCapsule(root, WK, capsule());
    consumeResumeCapsule(root, WK, "next-session-1", () => NOW);
    expect(readdirSync(dirname(resumeCapsulePath(root, WK)))).not.toContainEqual(
      expect.stringContaining(".tmp"),
    );
  });
});
