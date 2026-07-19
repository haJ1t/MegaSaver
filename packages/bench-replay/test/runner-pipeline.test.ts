import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { type Server, createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// End-to-end wiring proof for scripts/bench-replay.mjs against a fake upstream:
// the one test that exercises recording load -> schema parse -> saver subprocess
// -> both-order replay -> SSE usage assembly -> printed verdict, before a cent is
// spent on the real API. Requires `dist/` (the runner imports the built package).
const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const RUNNER = join(REPO_ROOT, "scripts", "bench-replay.mjs");

const RAW_TOOL_OUTPUT = "RAW_OUTPUT_LINE ".repeat(200); // 3200 B, and contains no "SHORT"
const COMPRESSED = "SHORT"; // 5 B

// Scripted so both arms are hand-computable. message_start's output_tokens is 3
// while the final message_delta says 500/400: reading output from message_start
// would score 6 per arm here and every asserted number below would move.
const USAGE = {
  baseline: {
    start: {
      input_tokens: 1000,
      cache_creation_input_tokens: 2000,
      cache_read_input_tokens: 4000,
      output_tokens: 3,
    },
    finalOutput: 500,
  },
  megasaver: {
    start: {
      input_tokens: 500,
      cache_creation_input_tokens: 1000,
      cache_read_input_tokens: 2000,
      output_tokens: 3,
    },
    finalOutput: 400,
  },
};

function sse(arm: "baseline" | "megasaver"): string {
  const { start, finalOutput } = USAGE[arm];
  return [
    "event: message_start",
    `data: ${JSON.stringify({ type: "message_start", message: { usage: start } })}`,
    "",
    "event: message_delta",
    `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: finalOutput } })}`,
    "",
    "event: message_stop",
    `data: ${JSON.stringify({ type: "message_stop" })}`,
    "",
  ].join("\n");
}

function toolResultMessages(content: string) {
  return [
    { role: "user", content: "fix the thing" },
    {
      role: "assistant",
      content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls -la" } }],
    },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content }] },
  ];
}

function writeRecording(root: string, content = RAW_TOOL_OUTPUT): string {
  const dir = join(root, "task_1");
  mkdirSync(dir, { recursive: true });
  const messages = toolResultMessages(content);
  writeFileSync(
    join(dir, "req-001.json"),
    JSON.stringify({ model: "claude-test", stream: true, messages }),
  );
  writeFileSync(
    join(dir, "req-002.json"),
    JSON.stringify({
      model: "claude-test",
      stream: true,
      messages: [
        ...messages,
        { role: "assistant", content: "done" },
        { role: "user", content: "thanks" },
      ],
    }),
  );
  // Same-conversation cost reference: 2000*5 + 4000*10 + 8000*0.5 + 1100*25 per
  // 1e6 = $0.0815, i.e. 3.07% off the replayed baseline — a real, non-zero drift
  // that still passes the 25% smoke tolerance.
  writeFileSync(
    join(dir, "end-to-end.json"),
    JSON.stringify({
      is_error: false,
      num_turns: 4,
      usage: {
        input_tokens: 2000,
        cache_creation_input_tokens: 4000,
        cache_read_input_tokens: 8000,
        output_tokens: 1100,
      },
    }),
  );
  return dir;
}

function writeFakeMega(root: string): string {
  const path = join(root, "mega.cjs");
  writeFileSync(
    path,
    `#!/usr/bin/env node
const { readFileSync } = require("node:fs");
const argv = process.argv.slice(2).join(" ");
if (argv.startsWith("session saver default enable")) process.stdout.write('{"ok":true}\\n');
else if (argv.startsWith("session saver resolve")) process.stdout.write('{"enabled":true,"mode":"balanced"}\\n');
else if (argv.startsWith("hooks saver")) {
  readFileSync(0, "utf8");
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { updatedToolOutput: ${JSON.stringify(COMPRESSED)} } }) + "\\n");
} else { process.stderr.write("fake mega: unexpected args " + argv + "\\n"); process.exit(2); }
`,
    { mode: 0o755 },
  );
  return path;
}

let root: string;
let server: Server;
let baseUrl: string;
const seen: { authed: boolean; stream: unknown }[] = [];

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "bench-replay-pipeline-"));
  mkdirSync(join(root, "repo"), { recursive: true });

  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      seen.push({
        authed: typeof req.headers["x-api-key"] === "string",
        stream: JSON.parse(body).stream,
      });
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(sse(body.includes(COMPRESSED) ? "megasaver" : "baseline"));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr !== null ? addr.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});

// Async, never spawnSync: the fake upstream lives in THIS process, so blocking
// the event loop on the child would deadlock — the runner's fetch would wait for
// a server that cannot accept until the child it is waiting on exits.
function runReplay(
  recordingsRoot: string,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const child = spawn(
    process.execPath,
    [
      RUNNER,
      "replay",
      "--recordings",
      recordingsRoot,
      "--repo",
      join(root, "repo"),
      "--mega-bin",
      writeFakeMega(root),
      "--base-url",
      baseUrl,
      "--mode",
      "balanced",
    ],
    { env: { ...process.env, ANTHROPIC_API_KEY: "not-a-real-key-offline-fixture" } },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (d: string) => {
    stdout += d;
  });
  child.stderr.on("data", (d: string) => {
    stderr += d;
  });
  return new Promise((resolve) => {
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

describe("bench-replay.mjs replay against a fake upstream", () => {
  it("prints a verdict matching the hand-computed numbers", async () => {
    const recordings = join(root, "recordings");
    writeRecording(recordings);
    const run = await runReplay(recordings);
    expect(run.status, run.stderr).toBe(0);
    const out = run.stdout;

    // 2 requests x {1000, 2000, 4000, 500}; 2000*5 + 4000*10 + 8000*0.5 + 1000*25 = $0.079
    expect(out).toContain(
      "input=2,000 cache_creation=4,000 cache_read=8,000 output=1,000 cost=$0.079000",
    );
    // 2 requests x {500, 1000, 2000, 400}; 1000*5 + 2000*10 + 4000*0.5 + 800*25 = $0.047
    expect(out).toContain(
      "input=1,000 cache_creation=2,000 cache_read=4,000 output=800 cost=$0.047000",
    );
    // 0.079 / 0.047
    expect(out).toContain("cost ratio (baseline / megasaver): 1.6809x");
    expect(out).toContain("pooled (geometric mean of 1 order-combined ratios): 1.6809x");

    // Per-request rows, not just the arm totals.
    expect(out).toContain("req   1  input=1,000 cache_creation=2,000 cache_read=4,000 output=500");
    expect(out).toContain("req   2  input=500 cache_creation=1,000 cache_read=2,000 output=400");

    // One tool_use_id, memoized: applied exactly once per arm replay.
    expect(out).toContain("saver applied=1 passthrough=0 failed=0 tool_result bytes 3,200->5");
    expect(out).toContain("integrity: applied=1 bytes 3,200->5 (byteRatio 0.0016) ok=true");

    // Fake upstream is order-blind, so both orders must land on the same ratio.
    expect(out).toContain(
      "order check: baseline-first=1.6809x megasaver-first=1.6809x spread=0.00%",
    );

    // |0.079 - 0.0815| / 0.0815 = 3.07%, inside the 25% smoke tolerance.
    expect(out).toContain("drift check: replayed baseline $0.079000 vs same-conversation");
    expect(out).toContain("end-to-end reference $0.081500 -> ok=true (tolerance 25%)");
    expect(out).toContain("LIMITS:");

    // 2 pair runs x 2 arms x 2 requests, every one authenticated and still
    // streaming — a sender that flipped `stream` would be measuring a different
    // request than the one recorded.
    expect(seen).toHaveLength(8);
    expect(seen.every((r) => r.authed)).toBe(true);
    expect(seen.every((r) => r.stream === true)).toBe(true);
  });

  it("refuses a recording that does not parse as a /v1/messages body", async () => {
    const recordings = join(root, "malformed");
    mkdirSync(join(recordings, "task_1"), { recursive: true });
    writeFileSync(
      join(recordings, "task_1", "req-001.json"),
      JSON.stringify({ model: 42, messages: [] }),
    );
    const run = await runReplay(recordings);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/not a valid recorded \/v1\/messages body/);
  });

  it("refuses a recording captured with the saver already on", async () => {
    const recordings = join(root, "precompressed");
    writeRecording(
      recordings,
      "some output\n[Mega Saver: compressed 900→100 B (~225→25 tokens, 88.9%).]",
    );
    const run = await runReplay(recordings);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/already compressed/);
  });
});
