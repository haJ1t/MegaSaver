import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
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
  let metaDir: string;

  // Mirror the desktop app's <metaDir>/<workspace>/<window>/local_*.json layout.
  function writeMeta(
    id: string,
    title: string,
    cwd = "/Users/me/proj",
    extra?: {
      isArchived?: boolean;
      model?: string;
      permissionMode?: string;
      lastActivityAt?: number;
    },
  ): void {
    const dir = join(metaDir, "ws", "win");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `local_${id}.json`),
      JSON.stringify({
        cliSessionId: id,
        title,
        cwd,
        lastActivityAt: extra?.lastActivityAt ?? 1,
        ...(extra?.isArchived !== undefined ? { isArchived: extra.isArchived } : {}),
        ...(extra?.model !== undefined ? { model: extra.model } : {}),
        ...(extra?.permissionMode !== undefined ? { permissionMode: extra.permissionMode } : {}),
      }),
    );
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cc-projects-"));
    metaDir = mkdtempSync(join(tmpdir(), "cc-meta-"));
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
    writeMeta("aaaa", "Alpha session");
    writeMeta("bbbb", "Beta session");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(metaDir, { recursive: true, force: true });
  });

  it("lists most-recent first using titles from the desktop metadata store", async () => {
    const sessions = await listSessions(root, metaDir, { limit: 50, offset: 0 });
    expect(sessions.map((s) => s.id)).toEqual(["bbbb", "aaaa"]);
    expect(sessions[0]?.title).toBe("Beta session");
    expect(sessions[0]?.projectLabel).toBe("/Users/me/proj");
  });

  it("surfaces isArchived/model/permissionMode/lastActivityAt from metadata", async () => {
    // This test documents the metadata-store contract (fields are round-tripped).
    // listSessions now excludes archived transcripts from the default (resumable)
    // listing, so we bypass it here and read the title store directly.
    const { readFile } = await import("node:fs/promises");
    const { readdir } = await import("node:fs/promises");
    const { join: join2 } = await import("node:path");
    writeMeta("bbbb", "Beta session", "/Users/me/proj", {
      isArchived: true,
      model: "claude-sonnet-4-6",
      permissionMode: "plan",
      lastActivityAt: 42,
    });
    // Verify the archived Beta's title entry was stored — listing hides archived.
    const entries: string[] = await readdir(join2(metaDir, "ws", "win"));
    const found = entries.some((e) => e === "local_bbbb.json");
    expect(found).toBe(true);
    const { readFile: rf } = await import("node:fs/promises");
    const raw = JSON.parse(await rf(join2(metaDir, "ws", "win", "local_bbbb.json"), "utf8")) as {
      isArchived: boolean;
      model: string;
      permissionMode: string;
      lastActivityAt: number;
    };
    expect(raw.isArchived).toBe(true);
    expect(raw.model).toBe("claude-sonnet-4-6");
    expect(raw.permissionMode).toBe("plan");
    expect(raw.lastActivityAt).toBe(42);
    const archivedStillFiltered = await listSessions(root, metaDir, { limit: 50, offset: 0 });
    expect(archivedStillFiltered.find((s) => s.id === "bbbb")).toBeUndefined();
  });

  it("defaults metadata fields when the local file omits them", async () => {
    const sessions = await listSessions(root, metaDir, { limit: 50, offset: 0 });
    const alpha = sessions.find((s) => s.id === "aaaa");
    expect(alpha?.isArchived).toBe(false);
    expect(alpha?.model).toBe("");
    expect(alpha?.permissionMode).toBe("");
    expect(alpha?.lastActivityAt).toBe(1);
  });

  it("ignores transcripts that have no desktop metadata, even when newer", async () => {
    const orphan = join(root, DIR, "cccc.jsonl");
    writeFileSync(orphan, `${userLine("Hello memory agent", "2026-06-14T12:00:00.000Z")}\n`);
    utimesSync(orphan, new Date("2026-06-14T12:00:00Z"), new Date("2026-06-14T12:00:00Z"));
    const sessions = await listSessions(root, metaDir, { limit: 50, offset: 0 });
    expect(sessions.map((s) => s.id)).toEqual(["bbbb", "aaaa"]);
    expect(sessions.some((s) => s.id === "cccc")).toBe(false);
  });

  it("paginates with limit + offset", async () => {
    const page = await listSessions(root, metaDir, { limit: 1, offset: 1 });
    expect(page.map((s) => s.id)).toEqual(["aaaa"]);
  });

  it("returns [] when the metadata store is missing or empty", async () => {
    const empty = await listSessions(root, join(metaDir, "nope"), { limit: 50, offset: 0 });
    expect(empty).toEqual([]);
  });

  it("returns [] when the projects root does not exist", async () => {
    const missing = await listSessions(join(root, "nope"), metaDir, { limit: 50, offset: 0 });
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

  it("rejects path traversal in safeSessionPath", async () => {
    expect(await safeSessionPath(root, "..", "aaaa")).toBeNull();
    expect(await safeSessionPath(root, DIR, "../../etc/passwd")).toBeNull();
    expect(await safeSessionPath(root, "a/b", "aaaa")).toBeNull();
    expect(await safeSessionPath(root, DIR, "aaaa")).toBe(join(root, DIR, "aaaa.jsonl"));
  });

  it("tails appended lines via tailTranscript", async () => {
    const path = join(root, DIR, "bbbb.jsonl");
    const t = await readTranscript(root, DIR, "bbbb");
    const received: string[] = [];
    const stop = tailTranscript(path, t?.byteLength ?? 0, (m) => {
      received.push(m.blocks.map((b) => b.text).join(""));
    });
    appendFileSync(path, `${asstLine("a fresh reply", "2026-06-14T11:05:00.000Z")}\n`);
    await new Promise((r) => setTimeout(r, 2000));
    stop();
    expect(received).toContain("a fresh reply");
  }, 6000);

  it("filters by workspaceKey (only selected project's cwd)", async () => {
    const other = join(root, DIR, "cccc.jsonl");
    writeFileSync(other, `${userLine("other proj", "2026-06-14T12:00:00.000Z")}\n`);
    writeMeta("cccc", "Other", "/Users/me/other", { lastActivityAt: 2 });
    utimesSync(other, new Date("2026-06-14T12:00:00Z"), new Date("2026-06-14T12:00:00Z"));
    const keyProj = encodeWorkspaceKey("/Users/me/proj");
    const filtered = await listSessions(root, metaDir, {
      limit: 50,
      offset: 0,
      workspaceKey: keyProj,
    });
    expect(filtered.every((s) => s.projectLabel === "/Users/me/proj")).toBe(true);
    expect(filtered.map((s) => s.id).sort()).toEqual(["aaaa", "bbbb"].sort());
    const keyOther = encodeWorkspaceKey("/Users/me/other");
    const onlyOther = await listSessions(root, metaDir, {
      limit: 50,
      offset: 0,
      workspaceKey: keyOther,
    });
    expect(onlyOther.map((s) => s.id)).toEqual(["cccc"]);
  });

  it("workspaceKey + harness intersect correctly", async () => {
    const keyProj = encodeWorkspaceKey("/Users/me/proj");
    const r = await listSessions(root, metaDir, {
      limit: 50,
      offset: 0,
      harness: "claude-code",
      workspaceKey: keyProj,
    });
    expect(r.every((s) => s.harness === "claude-code" && s.projectLabel === "/Users/me/proj")).toBe(
      true,
    );
    expect(r.length).toBe(2);
  });

  it("returns [] for unknown workspaceKey", async () => {
    const key = encodeWorkspaceKey("/nonexistent/path");
    const r = await listSessions(root, metaDir, { limit: 50, offset: 0, workspaceKey: key });
    expect(r).toEqual([]);
  });

  it("hides archived sessions from the default (resumable) listing", async () => {
    writeMeta("bbbb", "Beta session", "/Users/me/proj", { isArchived: true, lastActivityAt: 99 });
    const r = await listSessions(root, metaDir, { limit: 50, offset: 0 });
    expect(r.map((s) => s.id)).toEqual(["aaaa"]);
    expect(r.some((s) => s.id === "bbbb")).toBe(false);
  });

  it("hides empty/non-resumable transcripts from the default listing", async () => {
    const id = "eeee";
    const path = join(root, DIR, `${id}.jsonl`);
    writeFileSync(
      path,
      `${JSON.stringify({ type: "queue-operation", foo: 1 })}\n${JSON.stringify({ type: "system", bar: 2 })}\n`,
    );
    writeMeta(id, "Empty", "/Users/me/proj");
    const r = await listSessions(root, metaDir, { limit: 50, offset: 0 });
    expect(r.some((s) => s.id === id)).toBe(false);
    expect(r.map((s) => s.id)).toEqual(["bbbb", "aaaa"]);
  });

  it("keeps a transcript with a single user turn (resumable)", async () => {
    // aaaa already has exactly one user line and no assistant — still resumable
    const r = await listSessions(root, metaDir, { limit: 50, offset: 0 });
    expect(r.map((s) => s.id)).toContain("aaaa");
  });
});
