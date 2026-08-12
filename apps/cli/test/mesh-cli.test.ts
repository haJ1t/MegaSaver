import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerSession } from "@megasaver/mesh";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMeshClaims } from "../src/commands/mesh/claims.js";
import { runMeshEvents } from "../src/commands/mesh/events.js";
import { runMeshGc } from "../src/commands/mesh/gc.js";
import { runMeshSend } from "../src/commands/mesh/send.js";
import { runMeshStatus } from "../src/commands/mesh/status.js";

describe("mega mesh status", () => {
  let root = "";
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mesh-cli-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("lists live peers table", async () => {
    const out: string[] = [];
    await runMeshStatus({
      storeFlag: root,
      cwd: "/repo",
      json: false,
      all: false,
      follow: false,
      stdout: (l) => out.push(l),
      stderr: () => {},
      execGit: () => {
        throw new Error("no git");
      },
    });
    expect(out.join("\n")).toContain("peers");
  });

  it("lists live peers filtered by workspaceKey", async () => {
    const wsRepo = encodeWorkspaceKey("/repo");
    const wsOther = encodeWorkspaceKey("/other");
    registerSession(root, {
      liveSessionId: "a1",
      agent: "claude-code",
      status: "working",
      lastSeenAt: new Date().toISOString(),
      workspaceKey: wsRepo,
      cwd: "/repo",
    });
    registerSession(root, {
      liveSessionId: "b1",
      agent: "cursor",
      status: "idle",
      lastSeenAt: new Date().toISOString(),
      workspaceKey: wsOther,
      cwd: "/other",
    });
    const out: string[] = [];
    await runMeshStatus({
      storeFlag: root,
      cwd: "/repo",
      json: false,
      all: false,
      follow: false,
      stdout: (l) => out.push(l),
      stderr: () => {},
      execGit: () => {
        throw new Error("no git");
      },
    });
    const joined = out.join("\n");
    expect(joined).toContain("a1");
    expect(joined).not.toContain("b1");
  });

  it("json emits array", async () => {
    const out: string[] = [];
    await runMeshStatus({
      storeFlag: root,
      cwd: "/repo",
      json: true,
      all: true,
      follow: false,
      stdout: (l) => out.push(l),
      stderr: () => {},
    });
    const parsed = JSON.parse(out.join("\n")) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("table header contains required columns when peers present", async () => {
    registerSession(root, {
      liveSessionId: "peer1",
      agent: "claude-code",
      status: "working",
      lastSeenAt: new Date().toISOString(),
      workspaceKey: "cccccccccccccccc",
      cwd: "/repo/packages/foo",
    });
    const out: string[] = [];
    await runMeshStatus({
      storeFlag: root,
      cwd: "/repo/packages/foo",
      json: false,
      all: true,
      follow: false,
      stdout: (l) => out.push(l),
      stderr: () => {},
    });
    const joined = out.join("\n");
    expect(joined).toContain("liveSessionId");
    expect(joined).toContain("agent");
    expect(joined).toContain("cwdShort");
    expect(joined).toContain("status");
    expect(joined).toContain("age");
  });
});

describe("mega mesh send", () => {
  let root = "";
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mesh-cli-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("sends to peer and creates inbox file", async () => {
    registerSession(root, {
      liveSessionId: "a1",
      agent: "claude-code",
      status: "working",
      lastSeenAt: new Date().toISOString(),
      workspaceKey: "aaaaaaaaaaaaaaaa",
      cwd: "/repo",
    });
    registerSession(root, {
      liveSessionId: "b1",
      agent: "cursor",
      status: "working",
      lastSeenAt: new Date().toISOString(),
      workspaceKey: "aaaaaaaaaaaaaaaa",
      cwd: "/repo",
    });
    const out: string[] = [];
    const code = await runMeshSend({
      storeFlag: root,
      cwd: "/repo",
      target: "b1",
      text: "hello world",
      stdout: (l) => out.push(l),
      stderr: () => {},
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("sent");
  });

  it("redacts secret before persist", async () => {
    registerSession(root, {
      liveSessionId: "a1",
      agent: "claude-code",
      status: "working",
      lastSeenAt: new Date().toISOString(),
      workspaceKey: "aaaaaaaaaaaaaaaa",
      cwd: "/repo",
    });
    registerSession(root, {
      liveSessionId: "b1",
      agent: "claude-code",
      status: "working",
      lastSeenAt: new Date().toISOString(),
      workspaceKey: "aaaaaaaaaaaaaaaa",
      cwd: "/repo",
    });
    await runMeshSend({
      storeFlag: root,
      cwd: "/repo",
      target: "b1",
      text: "token: sk-proj-abcdefghijklmnopqrstuvwxyz0123456789",
      stdout: () => {},
      stderr: () => {},
    });
    const { drainInbox } = await import("@megasaver/mesh");
    const events = drainInbox(root, "b1");
    expect(events).toHaveLength(1);
    expect(events[0]?.text).not.toContain("sk-proj");
  });
});

describe("mega mesh claims", () => {
  let root = "";
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mesh-cli-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("lists claims contains word claims", async () => {
    const out: string[] = [];
    await runMeshClaims({
      storeFlag: root,
      cwd: "/repo",
      json: false,
      stdout: (l) => out.push(l),
      stderr: () => {},
    });
    expect(out.join("\n")).toContain("claims");
  });

  it("json emits array", async () => {
    const out: string[] = [];
    await runMeshClaims({
      storeFlag: root,
      cwd: "/repo",
      json: true,
      stdout: (l) => out.push(l),
      stderr: () => {},
    });
    expect(JSON.parse(out.join("\n"))).toEqual([]);
  });
});

describe("mega mesh events", () => {
  let root = "";
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mesh-cli-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("lists events contains word events", async () => {
    const out: string[] = [];
    await runMeshEvents({
      storeFlag: root,
      cwd: "/repo",
      json: false,
      stdout: (l) => out.push(l),
      stderr: () => {},
    });
    expect(out.join("\n")).toContain("events");
  });

  it("filters by since", async () => {
    const { postEvent } = await import("@megasaver/mesh");
    const old = new Date(Date.now() - 60_000).toISOString();
    const now = new Date().toISOString();
    postEvent(root, { id: "1", kind: "message", from: "a1", text: "old", createdAt: old });
    postEvent(root, { id: "2", kind: "message", from: "a1", text: "new", createdAt: now });
    const out: string[] = [];
    await runMeshEvents({
      storeFlag: root,
      cwd: "/repo",
      json: true,
      since: now,
      stdout: (l) => out.push(l),
      stderr: () => {},
    });
    const events = JSON.parse(out.join("\n")) as Array<{ id: string }>;
    expect(events.some((e) => e.id === "2")).toBe(true);
    expect(events.some((e) => e.id === "1")).toBe(false);
  });
});

describe("mega mesh gc", () => {
  let root = "";
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mesh-cli-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("runs and reports gc", async () => {
    const out: string[] = [];
    const code = await runMeshGc({
      storeFlag: root,
      cwd: "/repo",
      json: false,
      stdout: (l) => out.push(l),
      stderr: () => {},
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("gc");
  });

  it("json emits gc result", async () => {
    const out: string[] = [];
    await runMeshGc({
      storeFlag: root,
      cwd: "/repo",
      json: true,
      stdout: (l) => out.push(l),
      stderr: () => {},
    });
    const parsed = JSON.parse(out.join("\n")) as { expiredPresence: number };
    expect(typeof parsed.expiredPresence).toBe("number");
  });
});
