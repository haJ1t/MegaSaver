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
    const statsDir = join(root, "stats", PROJECT);
    // A non-`-traces` sibling DIRECTORY must never match the prune filter.
    const otherDir = join(statsDir, "other-feature");
    mkdirSync(otherDir, { recursive: true });
    writeFileSync(join(otherDir, "keep.txt"), "keep\n");

    pruneTraceSessions(root, PROJECT, 3);

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

    // The non-`-traces` sibling directory is untouched.
    expect(existsSync(join(otherDir, "keep.txt"))).toBe(true);
  });

  it("ranks by replay-traces.jsonl mtime so a still-appending session survives", () => {
    // A session that keeps APPENDING advances its jsonl file mtime but NOT its
    // parent dir mtime (dir mtime freezes at first-write). Ranking by dir mtime
    // would wrongly prune the active session; ranking by file mtime keeps it.
    const root = mkdtempSync(join(tmpdir(), "prune-traces-append-"));
    const statsDir = join(root, "stats", PROJECT);
    mkdirSync(statsDir, { recursive: true });
    const base = Date.UTC(2026, 0, 1) / 1000;

    // Session A: dir created FIRST (oldest dir mtime), but its jsonl is appended
    // LAST (newest file mtime). It must survive.
    const aDir = join(statsDir, "session-a-traces");
    mkdirSync(aDir, { recursive: true });
    const aJsonl = join(aDir, "replay-traces.jsonl");
    writeFileSync(aJsonl, "{}\n");

    // Write-once sessions: dirs created AFTER A (newer dir mtime), each with a
    // single jsonl write whose file mtime sits BELOW A's appended mtime.
    const writeOnce = ["session-b", "session-c"];
    writeOnce.forEach((sess, i) => {
      const dir = join(statsDir, `${sess}-traces`);
      mkdirSync(dir, { recursive: true });
      const jsonl = join(dir, "replay-traces.jsonl");
      writeFileSync(jsonl, "{}\n");
      // Dir mtime NEWER than A's dir; file mtime OLDER than A's appended file.
      const dirT = base + (i + 2) * 3600;
      const fileT = base + (i + 1) * 3600;
      utimesSync(dir, dirT, dirT);
      utimesSync(jsonl, fileT, fileT);
    });

    // A's dir mtime is the OLDEST; A's appended jsonl mtime is the NEWEST.
    utimesSync(aDir, base, base);
    utimesSync(aJsonl, base + 100 * 3600, base + 100 * 3600);

    pruneTraceSessions(root, PROJECT, 1);

    // File-mtime ranking keeps A (most-recently-written) and prunes the rest.
    expect(existsSync(aDir)).toBe(true);
    expect(existsSync(join(statsDir, "session-b-traces"))).toBe(false);
    expect(existsSync(join(statsDir, "session-c-traces"))).toBe(false);
  });

  it("is a no-op on a nonexistent stats dir (never throws)", () => {
    const root = mkdtempSync(join(tmpdir(), "prune-traces-empty-"));
    expect(() => pruneTraceSessions(root, "nope")).not.toThrow();
  });

  it("MAX_TRACE_SESSIONS is 20", () => {
    expect(MAX_TRACE_SESSIONS).toBe(20);
  });
});
