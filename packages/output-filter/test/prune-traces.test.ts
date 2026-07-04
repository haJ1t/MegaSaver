import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_TRACE_SESSIONS, pruneTraceSessions } from "../src/prune-traces.js";

const PROJECT = "11111111-1111-4111-8111-111111111111";

// Seed `count` `<sess>-traces/` dirs plus a `.events.jsonl` and `.json` sibling
// per session. Older sessions get older mtimes so the sort is deterministic.
function seed(count: number): { root: string; sessions: string[] } {
  const root = mkdtempSync(join(tmpdir(), "prune-traces-"));
  const statsDir = join(root, "stats", PROJECT);
  mkdirSync(statsDir, { recursive: true });
  const sessions: string[] = [];
  const base = Date.UTC(2026, 0, 1) / 1000;
  for (let i = 0; i < count; i += 1) {
    const sess = `session-${i}`;
    sessions.push(sess);
    const traceDir = join(statsDir, `${sess}-traces`);
    mkdirSync(traceDir, { recursive: true });
    writeFileSync(join(traceDir, "replay-traces.jsonl"), "{}\n");
    // Sibling token-saver stat files the GUI reads — must survive prune.
    writeFileSync(join(statsDir, `${sess}.events.jsonl`), "{}\n");
    writeFileSync(join(statsDir, `${sess}.json`), "{}\n");
    // Session i is `i` hours newer than session 0.
    const t = base + i * 3600;
    utimesSync(traceDir, t, t);
  }
  return { root, sessions };
}

describe("pruneTraceSessions", () => {
  it("keeps the newest N -traces dirs, prunes older, leaves stats files", () => {
    const { root, sessions } = seed(5);
    pruneTraceSessions(root, PROJECT, 3);

    const statsDir = join(root, "stats", PROJECT);
    // sessions 2,3,4 are newest (largest mtime) → survive; 0,1 pruned.
    expect(existsSync(join(statsDir, "session-0-traces"))).toBe(false);
    expect(existsSync(join(statsDir, "session-1-traces"))).toBe(false);
    expect(existsSync(join(statsDir, "session-2-traces"))).toBe(true);
    expect(existsSync(join(statsDir, "session-3-traces"))).toBe(true);
    expect(existsSync(join(statsDir, "session-4-traces"))).toBe(true);

    // BOTH sibling stat files survive for EVERY session — including the pruned ones.
    for (const sess of sessions) {
      expect(existsSync(join(statsDir, `${sess}.events.jsonl`))).toBe(true);
      expect(existsSync(join(statsDir, `${sess}.json`))).toBe(true);
    }
  });

  it("is a no-op on a nonexistent stats dir (never throws)", () => {
    const root = mkdtempSync(join(tmpdir(), "prune-traces-empty-"));
    expect(() => pruneTraceSessions(root, "nope")).not.toThrow();
  });

  it("MAX_TRACE_SESSIONS is 20", () => {
    expect(MAX_TRACE_SESSIONS).toBe(20);
  });
});
