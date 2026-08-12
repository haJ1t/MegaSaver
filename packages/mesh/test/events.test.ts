import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { postEvent, readEvents } from "../src/events.js";
import { gc } from "../src/gc.js";
import { meshPaths } from "../src/paths.js";
import { registerSession } from "../src/presence.js";

describe("events", () => {
  let root = "";
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mesh-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("posts and reads back, skips torn lines, filters by since", () => {
    const now = new Date().toISOString();
    postEvent(root, { id: "1", kind: "message", from: "a1", text: "hi", createdAt: now });
    // inject torn line directly
    const { eventsPath } = meshPaths(root);
    appendFileSync(eventsPath, '{"torn": tru\n');
    postEvent(root, {
      id: "2",
      kind: "message",
      from: "a1",
      text: "hi2",
      createdAt: new Date(Date.now() + 1000).toISOString(),
    });
    const all = readEvents(root, {});
    expect(all).toHaveLength(2);
    expect(all[0]?.id).toBe("1");
    // since filter
    const since = new Date(Date.now() + 500).toISOString();
    const filtered = readEvents(root, { since });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("2");
  });

  it("gc rotates events.jsonl when >5MB", async () => {
    const { eventsPath } = meshPaths(root);
    mkdirSync(join(root, "mesh"), { recursive: true });
    // create a large events file >5MB
    const large = "x".repeat(6 * 1024 * 1024);
    mkdirSync(join(root, "mesh"), { recursive: true });
    // write directly to eventsPath
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      eventsPath,
      `${JSON.stringify({ id: "pad", kind: "message", from: "a1", text: large, createdAt: new Date().toISOString() })}\n`,
    );
    expect(statSync(eventsPath).size).toBeGreaterThan(5 * 1024 * 1024);
    const result = gc(root);
    expect(result.rotated).toBe(true);
    // after rotation, original should be gone or renamed, and new file empty or not exist
    const files = readdirSync(join(root, "mesh")).filter((f) => f.startsWith("events"));
    expect(files.length).toBeGreaterThanOrEqual(2);
    // new events file should be readable and empty (or not contain pad)
    expect(readEvents(root, {})).toHaveLength(0);
  });

  it("gc expires dead presence (>10m) and expired claims (>30m)", async () => {
    const now = Date.now();
    const rec = {
      liveSessionId: "s1",
      agent: "claude-code",
      status: "working" as const,
      lastSeenAt: new Date(now - 11 * 60 * 1000).toISOString(),
      workspaceKey: "aaaaaaaaaaaaaaaa",
      cwd: "/repo",
    };
    registerSession(root, rec);
    // create a claim-like file manually to test expiredClaims (since claim impl is Task 4, we test GC can handle dir missing or empty)
    const { claimsDir } = meshPaths(root);
    mkdirSync(claimsDir, { recursive: true });
    const nowIso = new Date(now).toISOString();
    const expiredIso = new Date(now - 31 * 60 * 1000).toISOString();
    const claim = {
      claimId: "c1",
      liveSessionId: "s1",
      workspaceKey: "aaaaaaaaaaaaaaaa",
      paths: ["src/a.ts"],
      createdAt: expiredIso,
      refreshedAt: expiredIso,
      expiresAt: new Date(now - 1000).toISOString(),
    };
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(claimsDir, "c1.json"), `${JSON.stringify(claim)}\n`);
    const result = gc(root);
    expect(result.expiredPresence).toBe(1);
    expect(result.expiredClaims).toBe(1);
  });
});
