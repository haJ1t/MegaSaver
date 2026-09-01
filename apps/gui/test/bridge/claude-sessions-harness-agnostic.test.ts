import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TestServer, startTestBridge } from "./test-helpers.js";

const requireForNodeBuiltins = createRequire(import.meta.url);

function codexSessionMeta(id: string, cwd: string): string {
  return JSON.stringify({
    timestamp: "2026-08-26T10:00:00.000Z",
    type: "session_meta",
    payload: {
      session_id: id,
      cwd,
      base_instructions: { text: "x".repeat(60000) },
    },
  });
}
function codexThreadSettings(model = "gpt-5"): string {
  return JSON.stringify({
    timestamp: "2026-08-26T10:00:00.500Z",
    type: "event_msg",
    payload: {
      type: "thread_settings_applied",
      thread_settings: { model },
    },
  });
}
function codexMsg(role: "user" | "assistant", text: string): string {
  return JSON.stringify({
    type: "response_item",
    timestamp: "2026-08-26T10:00:01.000Z",
    payload: { type: "message", role, content: [{ type: "input_text", text }] },
  });
}
function codexTokenCount(
  input_tokens = 1000,
  output_tokens = 200,
  cached_input_tokens = 500,
): string {
  return JSON.stringify({
    timestamp: "2026-08-26T10:00:02.000Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        last_token_usage: {
          input_tokens,
          output_tokens,
          cached_input_tokens,
          cache_write_input_tokens: 0,
          total_tokens: input_tokens + output_tokens,
        },
      },
    },
  });
}
function piHeader(id: string, cwd: string): string {
  return JSON.stringify({ id, cwd, timestamp: "2026-08-26T10:00:00.000Z" });
}
function piMsg(
  role: "user" | "assistant",
  text: string,
  thinking?: string,
  usage?: { in: number; out: number; cr: number },
  model?: string,
): string {
  const content: unknown[] = thinking ? [{ type: "thinking", thinking }] : [];
  content.push({ type: "text", text });
  return JSON.stringify({
    type: "message",
    timestamp: "2026-08-26T10:00:01.000Z",
    message: {
      role,
      content,
      ...(model ? { model } : {}),
      ...(usage
        ? { usage: { input: usage.in, output: usage.out, cacheRead: usage.cr, cacheWrite: 0 } }
        : {}),
    },
  });
}

describe("harness-agnostic session routes", () => {
  let server: TestServer;
  let homeDir: string;
  let codexId: string;
  let piId: string;
  let openCodeId: string;
  let claudeDir: string;
  let claudeMeta: string;

  beforeEach(async () => {
    homeDir = mkdtempSync(join(tmpdir(), "megasaver-home-"));
    claudeDir = mkdtempSync(join(tmpdir(), "cc-agnostic-"));
    claudeMeta = mkdtempSync(join(tmpdir(), "cc-agnostic-meta-"));
    codexId = "01a99000-0000-7000-8000-000000000001";
    piId = "01a99000-0000-7000-8000-000000000002";
    openCodeId = "ses_opencode_test_001";

    // Codex harness file with huge first line (>8KB) to exercise RC1
    const codexBase = join(homeDir, ".codex", "sessions", "2026", "08", "26");
    mkdirSync(codexBase, { recursive: true });
    writeFileSync(
      join(codexBase, `rollout-2026-08-26T10-00-00-${codexId}.jsonl`),
      `${[
        codexSessionMeta(codexId, "/tmp/ws-codex"),
        codexThreadSettings("gpt-5"),
        codexMsg("user", "hello from codex"),
        codexMsg("assistant", "hi from codex assistant"),
        codexTokenCount(1200, 300, 400),
      ].join("\n")}\n`,
    );

    // Pi harness file
    const piBase = join(homeDir, ".pi", "agent", "sessions", "--tmp-ws-pi--");
    mkdirSync(piBase, { recursive: true });
    writeFileSync(
      join(piBase, `2026-08-26T10-00-00-000Z_${piId}.jsonl`),
      `${[
        piHeader(piId, "/tmp/ws-pi"),
        piMsg("user", "hello from pi"),
        piMsg(
          "assistant",
          "hi from pi",
          "inner reasoning",
          { in: 800, out: 150, cr: 250 },
          "kimi-k2.6",
        ),
      ].join("\n")}\n`,
    );

    // OpenCode SQLite DB
    const opencodeDir = join(homeDir, ".local", "share", "opencode");
    mkdirSync(opencodeDir, { recursive: true });
    const { DatabaseSync } = requireForNodeBuiltins("node:sqlite") as typeof import("node:sqlite");
    const db = new DatabaseSync(join(opencodeDir, "opencode.db"));
    db.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, time_updated INTEGER);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
    `);
    db.prepare("INSERT INTO session (id, title, directory, time_updated) VALUES (?, ?, ?, ?)").run(
      openCodeId,
      "OpenCode Session",
      "/tmp/ws-opencode",
      Date.now(),
    );
    db.prepare("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)").run(
      "msg_user_1",
      openCodeId,
      1788200000000,
      JSON.stringify({ role: "user" }),
    );
    db.prepare(
      "INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)",
    ).run(
      "prt_user_1",
      "msg_user_1",
      openCodeId,
      1788200000000,
      JSON.stringify({ type: "text", text: "hello from opencode user" }),
    );
    db.prepare("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)").run(
      "msg_asst_1",
      openCodeId,
      1788200001000,
      JSON.stringify({
        role: "assistant",
        modelID: "ag/gemini-3.7-flash-high",
        tokens: { input: 2000, output: 500, cache: { write: 100, read: 1500 } },
      }),
    );
    db.prepare(
      "INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)",
    ).run(
      "prt_asst_1",
      "msg_asst_1",
      openCodeId,
      1788200001000,
      JSON.stringify({ type: "text", text: "hi from opencode assistant" }),
    );
    db.close();

    server = await startTestBridge({
      homeDir,
      claudeProjectsDir: claudeDir,
      claudeSessionsMetaDir: claudeMeta,
    });
  });

  afterEach(async () => {
    if (server) await server.close();
    rmSync(homeDir, { recursive: true, force: true });
    rmSync(claudeDir, { recursive: true, force: true });
    rmSync(claudeMeta, { recursive: true, force: true });
  });

  it("GET /api/claude-sessions lists codex+pi+opencode harnesses via the multi-harness scanner", async () => {
    const res = await fetch(`${server.baseUrl}/api/claude-sessions`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; harness?: string }[];
    const ids = body.map((s) => s.id);
    expect(ids).toContain(codexId);
    expect(ids).toContain(piId);
    expect(ids).toContain(openCodeId);
  });

  it("fallback transcript returns >1 message for codex (not the placeholder)", async () => {
    // dir is dash-encoded cwd; the handler falls back to harness transcript
    const res = await fetch(`${server.baseUrl}/api/claude-sessions/-tmp-ws-codex/${codexId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      messages: { blocks: { kind: string }[] }[];
      projectLabel: string;
    };
    expect(body.messages.length).toBeGreaterThan(1);
    expect(body.projectLabel).toBe("/tmp/ws-codex");
  });

  it("fallback transcript returns >1 message for pi with thinking block preserved", async () => {
    const res = await fetch(`${server.baseUrl}/api/claude-sessions/pi/${piId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: { blocks: { kind: string; text: string }[] }[] };
    expect(body.messages.length).toBeGreaterThan(1);
    const hasThinking = body.messages.some((m) => m.blocks.some((b) => b.kind === "thinking"));
    expect(hasThinking).toBe(true);
  });

  it("fallback transcript returns >1 message for opencode", async () => {
    const res = await fetch(`${server.baseUrl}/api/claude-sessions/opencode/${openCodeId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: { blocks: { kind: string; text: string }[] }[] };
    expect(body.messages.length).toBeGreaterThan(1);
  });

  it("telemetry returns real token counts, assistant turns, and models for codex", async () => {
    const res = await fetch(
      `${server.baseUrl}/api/claude-sessions/-tmp-ws-codex/${codexId}/telemetry`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      turnCount: number;
      assistantTurns: number;
      totals: { inputTokens: number; outputTokens: number; cacheReadInputTokens: number };
      models: { model: string; turns: number; inputTokens: number; outputTokens: number }[];
    };
    expect(body.turnCount).toBeGreaterThan(1);
    expect(body.assistantTurns).toBe(1);
    expect(body.totals.inputTokens).toBe(1200);
    expect(body.totals.outputTokens).toBe(300);
    expect(body.totals.cacheReadInputTokens).toBe(400);
    expect(body.models.length).toBeGreaterThan(0);
    expect(body.models[0]?.model).toBe("gpt-5");
  });

  it("telemetry returns real token counts, assistant turns, and models for pi", async () => {
    const res = await fetch(`${server.baseUrl}/api/claude-sessions/pi/${piId}/telemetry`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      turnCount: number;
      assistantTurns: number;
      totals: { inputTokens: number; outputTokens: number; cacheReadInputTokens: number };
      models: { model: string; turns: number; inputTokens: number; outputTokens: number }[];
    };
    expect(body.turnCount).toBeGreaterThan(1);
    expect(body.assistantTurns).toBe(1);
    expect(body.totals.inputTokens).toBe(800);
    expect(body.totals.outputTokens).toBe(150);
    expect(body.totals.cacheReadInputTokens).toBe(250);
    expect(body.models.length).toBeGreaterThan(0);
    expect(body.models[0]?.model).toBe("kimi-k2.6");
  });

  it("telemetry returns real token counts, assistant turns, and models for opencode", async () => {
    const res = await fetch(
      `${server.baseUrl}/api/claude-sessions/opencode/${openCodeId}/telemetry`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      turnCount: number;
      assistantTurns: number;
      totals: {
        inputTokens: number;
        outputTokens: number;
        cacheCreationInputTokens: number;
        cacheReadInputTokens: number;
      };
      models: { model: string; turns: number; inputTokens: number; outputTokens: number }[];
    };
    expect(body.turnCount).toBeGreaterThan(1);
    expect(body.assistantTurns).toBe(1);
    expect(body.totals.inputTokens).toBe(2000);
    expect(body.totals.outputTokens).toBe(500);
    expect(body.totals.cacheCreationInputTokens).toBe(100);
    expect(body.totals.cacheReadInputTokens).toBe(1500);
    expect(body.models.length).toBeGreaterThan(0);
    expect(body.models[0]?.model).toBe("ag/gemini-3.7-flash-high");
  });

  it("SSE stream emits snapshot>1 for a harness session", async () => {
    const res = await fetch(
      `${server.baseUrl}/api/claude-sessions/-tmp-ws-codex/${codexId}/stream`,
      {
        headers: { accept: "text/event-stream" },
      },
    );
    expect(res.status).toBe(200);
    const reader = res.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buf = "";
    // Collect until snapshot event seen, then abort.
    const deadline = Date.now() + 4000;
    let snapshotMessages = -1;
    try {
      // @ts-ignore -- Node reader type
      while (Date.now() < deadline) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        if (buf.includes("event: snapshot")) {
          // snapshot data line: data: {"projectLabel":...,"messages":[...]}
          for (const line of buf.split("\n")) {
            if (line.startsWith("data: ") && line.includes("messages")) {
              try {
                const obj = JSON.parse(line.slice(6));
                if (Array.isArray(obj.messages)) snapshotMessages = obj.messages.length;
              } catch {}
            }
          }
          if (snapshotMessages > 1) break;
        }
      }
    } finally {
      try {
        await reader.cancel();
      } catch {}
    }
    expect(snapshotMessages).toBeGreaterThan(1);
  });
});
