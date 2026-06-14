import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listSessions,
  readTranscript,
  safeSessionPath,
  tailTranscript,
} from "../../bridge/claude-sessions/reader.js";

const DIR = "-Users-me-proj";

function userLine(text: string, ts: string): string {
  return JSON.stringify({
    type: "user",
    timestamp: ts,
    cwd: "/Users/me/proj",
    message: { role: "user", content: text },
  });
}
function asstLine(text: string, ts: string): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: ts,
    cwd: "/Users/me/proj",
    message: { role: "assistant", content: [{ type: "text", text }] },
  });
}

describe("claude-sessions reader", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cc-projects-"));
    mkdirSync(join(root, DIR), { recursive: true });
    const a = join(root, DIR, "aaaa.jsonl");
    const b = join(root, DIR, "bbbb.jsonl");
    writeFileSync(a, `${userLine("first prompt", "2026-06-14T10:00:00.000Z")}\n`);
    writeFileSync(
      b,
      `${userLine("second prompt", "2026-06-14T11:00:00.000Z")}\n${asstLine("hi", "2026-06-14T11:00:01.000Z")}\n`,
    );
    // Make `bbbb` newer so it sorts first.
    utimesSync(a, new Date("2026-06-14T10:00:00Z"), new Date("2026-06-14T10:00:00Z"));
    utimesSync(b, new Date("2026-06-14T11:00:00Z"), new Date("2026-06-14T11:00:00Z"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("lists sessions most-recent first with title + projectLabel", async () => {
    const sessions = await listSessions(root, { limit: 50, offset: 0 });
    expect(sessions.map((s) => s.id)).toEqual(["bbbb", "aaaa"]);
    expect(sessions[0]?.title).toBe("second prompt");
    expect(sessions[0]?.projectLabel).toBe("/Users/me/proj");
  });

  it("paginates with limit + offset", async () => {
    const page = await listSessions(root, { limit: 1, offset: 1 });
    expect(page.map((s) => s.id)).toEqual(["aaaa"]);
  });

  it("returns [] when the root does not exist", async () => {
    const missing = await listSessions(join(root, "nope"), { limit: 50, offset: 0 });
    expect(missing).toEqual([]);
  });

  it("reads a transcript into normalized messages with byteLength", async () => {
    const t = await readTranscript(root, DIR, "bbbb");
    expect(t?.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(t?.projectLabel).toBe("/Users/me/proj");
    expect(t?.byteLength).toBeGreaterThan(0);
  });

  it("returns null for an unknown session id", async () => {
    expect(await readTranscript(root, DIR, "zzzz")).toBeNull();
  });

  it("rejects path traversal in safeSessionPath", () => {
    expect(safeSessionPath(root, "..", "aaaa")).toBeNull();
    expect(safeSessionPath(root, DIR, "../../etc/passwd")).toBeNull();
    expect(safeSessionPath(root, "a/b", "aaaa")).toBeNull();
    expect(safeSessionPath(root, DIR, "aaaa")).toBe(join(root, DIR, "aaaa.jsonl"));
  });

  it("tails appended lines via tailTranscript", async () => {
    const path = join(root, DIR, "bbbb.jsonl");
    const t = await readTranscript(root, DIR, "bbbb");
    const received: string[] = [];
    const stop = tailTranscript(path, t?.byteLength ?? 0, (m) => {
      received.push(m.blocks.map((b) => b.text).join(""));
    });
    appendFileSync(path, `${asstLine("a fresh reply", "2026-06-14T11:05:00.000Z")}\n`);
    await new Promise((r) => setTimeout(r, 700));
    stop();
    expect(received).toContain("a fresh reply");
  });
});
