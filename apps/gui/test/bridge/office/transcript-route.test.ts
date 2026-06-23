import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendTranscript, createLauncherRegistry } from "@megasaver/agent-office";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import { type AgentId, encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteContext } from "../../../bridge/route-context.js";
import { publishTranscript, transcriptKey } from "../../../bridge/office-transcript-bus.js";
import { handleListTranscript, handleTranscriptStream } from "../../../bridge/routes/office.js";

const WORKDIR = "/tmp/office-transcript-wk";
const WK = encodeWorkspaceKey(WORKDIR);
const AID = "11111111-1111-4111-8111-111111111111";

let storeRoot: string;

type Captured = {
  json: { status: number; body: unknown }[];
  err: { status: number; code: string }[];
  writes: string[];
  closeListeners: (() => void)[];
};

function makeCtx(): RouteContext & Captured {
  const json: { status: number; body: unknown }[] = [];
  const err: { status: number; code: string }[] = [];
  const writes: string[] = [];
  const closeListeners: (() => void)[] = [];

  const res = {
    write: (chunk: string) => {
      writes.push(chunk);
      return true;
    },
    writeHead: vi.fn(),
    end: vi.fn(),
    headersSent: false,
  } as unknown as ServerResponse;

  const req = {
    on: (event: string, cb: () => void) => {
      if (event === "close") closeListeners.push(cb);
    },
  } as unknown as IncomingMessage;

  const ctx: RouteContext = {
    req,
    res,
    mcpOps: {} as RouteContext["mcpOps"],
    origin: "http://localhost:5173",
    query: new URLSearchParams(),
    storeRoot,
    claudeProjectsDir: "/tmp/projects",
    claudeSessionsMetaDir: "/tmp/meta",
    claudeSettingsPath: "/tmp/settings.json",
    resolveWorkspace: (cwd: string) => ({ workspaceKey: WK, label: cwd, cwd }),
    newId: () => "00000000-0000-4000-8000-000000000000",
    now: () => "2026-06-23T12:00:00.000Z",
    sendJson: (_res, status, body) => {
      json.push({ status, body });
    },
    sendError: (_res, status, code) => {
      err.push({ status, code });
    },
    sendText: vi.fn(),
    office: {
      coreRegistry: createInMemoryCoreRegistry(),
      registry: createLauncherRegistry([
        { kind: "claude-code" as AgentId, launch: () => ({ sessionId: "x", onEvent() {}, onExit() {}, cancel() {} }) },
      ]),
      allowFull: false,
    },
  } as unknown as RouteContext;

  return Object.assign(ctx, { json, err, writes, closeListeners });
}

function entry(seq: number) {
  return {
    id: `33333333-3333-4333-8333-3333333333${String(seq).padStart(2, "0")}`,
    seq,
    ts: `2026-06-23T12:00:0${seq}.000Z`,
    role: "assistant" as const,
    text: `entry ${seq}`,
  };
}

describe("handleListTranscript", () => {
  beforeEach(() => {
    storeRoot = mkdtempSync(join(tmpdir(), "office-tr-route-"));
  });
  afterEach(() => {
    rmSync(storeRoot, { recursive: true, force: true });
  });

  it("returns stored entries", async () => {
    await appendTranscript({ storeRoot, workspaceKey: WK, officeAgentId: AID, entry: entry(0) });
    await appendTranscript({ storeRoot, workspaceKey: WK, officeAgentId: AID, entry: entry(1) });
    const ctx = makeCtx();
    await handleListTranscript(ctx, WK, AID);
    expect(ctx.json[0]?.status).toBe(200);
    expect((ctx.json[0]?.body as unknown[]).length).toBe(2);
  });

  it("empty when none", async () => {
    const ctx = makeCtx();
    await handleListTranscript(ctx, WK, AID);
    expect(ctx.json[0]).toEqual({ status: 200, body: [] });
  });

  it("bad agentId → 404", async () => {
    const ctx = makeCtx();
    await handleListTranscript(ctx, WK, "not-a-uuid");
    expect(ctx.err[0]?.status).toBe(404);
  });

  it("bad wk → 400", async () => {
    const ctx = makeCtx();
    await handleListTranscript(ctx, "BADWK", AID);
    expect(ctx.err[0]?.status).toBe(400);
  });
});

describe("handleTranscriptStream", () => {
  beforeEach(() => {
    storeRoot = mkdtempSync(join(tmpdir(), "office-tr-stream-"));
  });
  afterEach(() => {
    rmSync(storeRoot, { recursive: true, force: true });
  });

  it("pushes a published entry as an SSE transcript frame", async () => {
    const ctx = makeCtx();
    await handleTranscriptStream(ctx, WK, AID);
    publishTranscript(transcriptKey(WK, AID), entry(0) as never);
    const frame = ctx.writes.find((w) => w.includes("event: transcript"));
    expect(frame).toBeDefined();
    expect(frame).toContain("entry 0");
    // cleanup: trigger close listener to clear the heartbeat timer
    for (const cb of ctx.closeListeners) cb();
  });

  it("bad agentId → 404 (no stream)", async () => {
    const ctx = makeCtx();
    await handleTranscriptStream(ctx, WK, "nope");
    expect(ctx.err[0]?.status).toBe(404);
  });
});
