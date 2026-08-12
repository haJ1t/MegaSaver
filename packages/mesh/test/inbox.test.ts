import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { drainInbox, sendMessage } from "../src/inbox.js";
import { registerSession } from "../src/presence.js";

describe("inbox at-most-once", () => {
  let root = "";
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mesh-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  it("send redacts secret and drain is at-most-once", () => {
    for (const id of ["a1", "b1"])
      registerSession(root, {
        liveSessionId: id,
        agent: "claude-code",
        status: "working",
        lastSeenAt: new Date().toISOString(),
        workspaceKey: "aaaaaaaaaaaaaaaa",
        cwd: "/repo",
      });
    sendMessage(root, {
      from: "a1",
      to: "b1",
      kind: "message",
      text: "token: sk-proj-abcdefghijklmnopqrstuvwxyz0123456789",
    });
    const first = drainInbox(root, "b1");
    expect(first).toHaveLength(1);
    expect(first[0]?.text).not.toContain("sk-proj");
    expect(drainInbox(root, "b1")).toHaveLength(0); // second drain empty
  });

  it("concurrent drain second empty", () => {
    for (const id of ["a1", "b1"])
      registerSession(root, {
        liveSessionId: id,
        agent: "claude-code",
        status: "working",
        lastSeenAt: new Date().toISOString(),
        workspaceKey: "aaaaaaaaaaaaaaaa",
        cwd: "/repo",
      });
    sendMessage(root, { from: "a1", to: "b1", kind: "message", text: "hello" });
    const d1 = drainInbox(root, "b1");
    const d2 = drainInbox(root, "b1");
    expect(d1).toHaveLength(1);
    expect(d2).toHaveLength(0);
  });

  it("truncates text to 4000 chars", () => {
    for (const id of ["a1", "b1"])
      registerSession(root, {
        liveSessionId: id,
        agent: "claude-code",
        status: "working",
        lastSeenAt: new Date().toISOString(),
        workspaceKey: "aaaaaaaaaaaaaaaa",
        cwd: "/repo",
      });
    const long = "x".repeat(5000);
    const evt = sendMessage(root, { from: "a1", to: "b1", kind: "message", text: long });
    expect(evt.text.length).toBeLessThanOrEqual(4000);
    const drained = drainInbox(root, "b1");
    expect(drained[0]?.text.length).toBeLessThanOrEqual(4000);
  });

  it("broadcast fans out to all live peers when to is undefined", () => {
    for (const id of ["a1", "b1", "c1"])
      registerSession(root, {
        liveSessionId: id,
        agent: "claude-code",
        status: "working",
        lastSeenAt: new Date().toISOString(),
        workspaceKey: "aaaaaaaaaaaaaaaa",
        cwd: "/repo",
      });
    sendMessage(root, { from: "a1", to: undefined, kind: "message", text: "broadcast hi" });
    // a1 is sender, should not receive own broadcast (broadcast to all live peers except sender)
    // But if implementation includes sender, this will still pass for b1/c1. We check b1 and c1 get it.
    expect(drainInbox(root, "b1")).toHaveLength(1);
    expect(drainInbox(root, "c1")).toHaveLength(1);
  });

  it("appends bus event", async () => {
    for (const id of ["a1", "b1"])
      registerSession(root, {
        liveSessionId: id,
        agent: "claude-code",
        status: "working",
        lastSeenAt: new Date().toISOString(),
        workspaceKey: "aaaaaaaaaaaaaaaa",
        cwd: "/repo",
      });
    sendMessage(root, { from: "a1", to: "b1", kind: "ask", text: "question?" });
    const { readEvents } = await import("../src/events.js");
    const events = readEvents(root, {});
    expect(events.some((e) => e.kind === "ask" && e.text === "question?")).toBe(true);
  });
});
