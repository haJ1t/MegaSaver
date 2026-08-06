import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOverlayChunkSet } from "@megasaver/content-store";
import { readOverlayEvents, recordAndFilterOverlayOutput } from "@megasaver/core";
import { countTokens } from "@megasaver/output-filter";
import { type TokenSaverMode, encodeWorkspaceKey, modeToBudget } from "@megasaver/shared";
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NEW_SURFACE_MIN_BYTES, buildSaverDecision, minBytesFor } from "../../src/hooks/saver.js";

let stores: string[];

beforeEach(() => {
  stores = [];
});

afterEach(() => {
  for (const s of stores) rmSync(s, { recursive: true, force: true });
});

function tempStore(prefix: string): string {
  const s = mkdtempSync(join(tmpdir(), prefix));
  stores.push(s);
  return s;
}

const FOOTER =
  '\n\n[Mega Saver: compressed 100000→200 B (~25000→50 tokens, 99.8%). Full output recoverable — run: mega output chunk "cs-1" "0" (or MCP proxy_expand_chunk if connected).]';
const RECORDED = {
  decision: "compressed" as const,
  summary: "SUMMARY",
  returnedText: `SHORT${FOOTER}`,
  rawBytes: 100_000,
  returnedBytes: 200,
  bytesSaved: 99_800,
  savingRatio: 0.998,
  chunkSetId: "cs-1",
  chunkCount: 1,
};

function deps(overrides: Partial<Parameters<typeof buildSaverDecision>[1]> = {}) {
  return {
    storeRoot: "/store",
    resolveSettings: () => ({ enabled: true, mode: "balanced" as const }),
    readSessionIntent: () => undefined,
    record: vi.fn().mockResolvedValue(RECORDED),
    recordInvocation: vi.fn(),
    recordCompression: vi.fn(),
    recordFailure: vi.fn(),
    recordCompletion: vi.fn(),
    hasSeenOutput: () => false,
    recordSeenOutput: () => {},
    ...overrides,
  };
}

const bigBash = (text: string) => ({
  tool_name: "Bash",
  tool_input: { command: "echo big" },
  tool_response: { stdout: text, stderr: "", interrupted: false, isImage: false },
  session_id: "live-1",
  cwd: "/Users/x/proj",
});

const compressiblePayload = () => bigBash("X".repeat(50_000));

function evidenceLedgerBashCorpus(): string {
  const source = Array.from(
    { length: 1_400 },
    (_, index) =>
      `line ${index}: export function repairAuth${index}(token: string) { return token.length > ${index % 7}; }`,
  ).join("\n");
  return source.slice(0, 50_000);
}

describe("buildSaverDecision", () => {
  it("compresses an eligible large Bash output and preserves the output shape", async () => {
    const d = deps();
    const out = await buildSaverDecision(bigBash("X".repeat(50_000)), d);
    expect("updatedToolOutput" in out).toBe(true);
    if ("updatedToolOutput" in out) {
      const u = out.updatedToolOutput as { stdout: string; stderr: string; isImage: boolean };
      expect(u.stdout).toContain("SHORT");
      expect(u.stdout).toContain("cs-1");
      expect(u.stderr).toBe("");
      expect(u.isImage).toBe(false);
    }
    expect(d.record).toHaveBeenCalledOnce();
  });

  it("compresses a large Bash output delivered under Claude Code's real `tool_response` field", async () => {
    const d = deps();
    const out = await buildSaverDecision(
      {
        tool_name: "Bash",
        tool_input: { command: "echo big" },
        // Claude Code's PostToolUse hook delivers tool output under `tool_response`, not `tool_output`.
        tool_response: {
          stdout: "X".repeat(50_000),
          stderr: "",
          interrupted: false,
          isImage: false,
        },
        session_id: "live-1",
        cwd: "/Users/x/proj",
      },
      d,
    );
    expect("updatedToolOutput" in out).toBe(true);
    expect(d.record).toHaveBeenCalledOnce();
  });

  it("passes through when Saver Mode is disabled", async () => {
    const out = await buildSaverDecision(
      bigBash("X".repeat(50_000)),
      deps({ resolveSettings: () => null }),
    );
    expect(out).toEqual({ passthrough: true });
  });

  it("passes through ineligible tools (Write)", async () => {
    const out = await buildSaverDecision(
      {
        tool_name: "Write",
        tool_response: { content: "x", isError: false },
        session_id: "s",
        cwd: "/p",
      },
      deps(),
    );
    expect(out).toEqual({ passthrough: true });
  });

  it("passes through small output (below budget)", async () => {
    const out = await buildSaverDecision(bigBash("tiny"), deps());
    expect(out).toEqual({ passthrough: true });
  });

  it("passes through an unknown output shape", async () => {
    const out = await buildSaverDecision(
      { tool_name: "Bash", tool_response: { weird: 1 }, session_id: "s", cwd: "/p" },
      deps(),
    );
    expect(out).toEqual({ passthrough: true });
  });

  it("passes through a malformed payload without throwing", async () => {
    await expect(buildSaverDecision(null, deps())).resolves.toEqual({ passthrough: true });
    await expect(buildSaverDecision({ tool_name: "Bash" }, deps())).resolves.toEqual({
      passthrough: true,
    });
  });

  it("compresses a Read output (content string shape)", async () => {
    const out = await buildSaverDecision(
      {
        tool_name: "Read",
        tool_input: { file_path: "/p/big.txt" },
        tool_response: { content: "Y".repeat(50_000), isError: false },
        session_id: "live-1",
        cwd: "/p",
      },
      deps(),
    );
    expect("updatedToolOutput" in out).toBe(true);
    if ("updatedToolOutput" in out) {
      const u = out.updatedToolOutput as { content: string; isError: boolean };
      expect(u.content).toContain("SHORT");
      expect(u.isError).toBe(false);
    }
  });

  it("compresses a Read output under Claude Code's real `{ type, file: { content } }` shape", async () => {
    const d = deps();
    const out = await buildSaverDecision(
      {
        tool_name: "Read",
        tool_input: { file_path: "/p/big.txt" },
        // Real Claude Code Read payload: text lives at tool_response.file.content, not tool_response.content.
        tool_response: {
          type: "text",
          file: {
            filePath: "/p/big.txt",
            content: "Y".repeat(50_000),
            numLines: 1,
            startLine: 1,
            totalLines: 1,
          },
        },
        session_id: "live-1",
        cwd: "/p",
      },
      d,
    );
    expect("updatedToolOutput" in out).toBe(true);
    if ("updatedToolOutput" in out) {
      const u = out.updatedToolOutput as {
        type: string;
        file: { content: string; filePath: string; totalLines: number };
      };
      expect(u.file.content).toContain("SHORT");
      expect(u.file.filePath).toBe("/p/big.txt");
      expect(u.file.totalLines).toBe(1);
      expect(u.type).toBe("text");
    }
  });

  it("compresses a Grep content-mode output under its real shape", async () => {
    const d = deps();
    const out = await buildSaverDecision(
      {
        tool_name: "Grep",
        tool_input: { pattern: "TODO" },
        // Real Claude Code Grep (content mode): matching lines are a string under `content`.
        tool_response: {
          mode: "content",
          numFiles: 3,
          filenames: [],
          content: "src/a.ts:1:TODO\n".repeat(4_000),
          numLines: 4_000,
        },
        session_id: "live-1",
        cwd: "/p",
      },
      d,
    );
    expect("updatedToolOutput" in out).toBe(true);
    if ("updatedToolOutput" in out) {
      const u = out.updatedToolOutput as { content: string; mode: string; numFiles: number };
      expect(u.content).toContain("SHORT");
      expect(u.mode).toBe("content");
      expect(u.numFiles).toBe(3);
    }
  });

  // Wave 1 (spec 2026-07-09) reverses Glob filenames passthrough — see the
  // "wave-1 shapes" describe block below for the rewritten test.

  it("compresses the text block in a multi-modal content array, keeps the image block intact", async () => {
    // Wave 1 (spec 2026-07-09) reverses mixed-array passthrough: the text
    // block is compressible signal, the image block passes through untouched.
    const image = { type: "image", source: { data: "..." } };
    const out = await buildSaverDecision(
      {
        tool_name: "Read",
        tool_input: { file_path: "/p/doc.pdf" },
        tool_response: {
          content: [{ type: "text", text: "Z".repeat(50_000) }, image],
          isError: false,
        },
        session_id: "live-1",
        cwd: "/p",
      },
      deps(),
    );
    expect("updatedToolOutput" in out).toBe(true);
    if ("updatedToolOutput" in out) {
      const u = out.updatedToolOutput as { content: unknown[] };
      expect(u.content).toHaveLength(2);
      expect(u.content[0]).toEqual({ type: "text", text: expect.stringContaining("SHORT") });
      expect(u.content[1]).toEqual(image);
    }
  });

  it("compresses a pure-text content array", async () => {
    const out = await buildSaverDecision(
      {
        tool_name: "Read",
        tool_input: { file_path: "/p/big.txt" },
        tool_response: { content: [{ type: "text", text: "Y".repeat(50_000) }], isError: false },
        session_id: "live-1",
        cwd: "/p",
      },
      deps(),
    );
    expect("updatedToolOutput" in out).toBe(true);
    if ("updatedToolOutput" in out) {
      const u = out.updatedToolOutput as { content: Array<{ type: string; text: string }> };
      expect(u.content[0]?.text).toContain("SHORT");
    }
  });

  it("passes evidenceStoreRoot (the base store root) to record() on compress", async () => {
    const d = deps();
    await buildSaverDecision(bigBash("X".repeat(50_000)), d);
    expect(d.record).toHaveBeenCalledWith(expect.objectContaining({ evidenceStoreRoot: "/store" }));
  });

  // Truncation → PARTIAL / normal-vs-truncated footer wording now lives in
  // record()/context-gate; see packages/context-gate/test/recovery-footer.test.ts.

  it("inline pointer reports a token figure from the @megasaver/stats estimator", async () => {
    // RECORDED: rawBytes 100_000, returnedBytes 200 → tokensFromBytes (ceil/4)
    // gives 25_000 raw, 50 returned, so 1 - 50/25_000 = 99.8% token reduction.
    const out = await buildSaverDecision(bigBash("X".repeat(50_000)), deps());
    expect("updatedToolOutput" in out).toBe(true);
    if ("updatedToolOutput" in out) {
      const u = out.updatedToolOutput as { stdout: string };
      expect(u.stdout).toContain("25000");
      expect(u.stdout).toContain("50 tokens");
      expect(u.stdout).toContain("99.8%");
      // Byte figures + recovery pointer must remain.
      expect(u.stdout).toContain("100000");
      expect(u.stdout).toContain("cs-1");
      expect(u.stdout).toContain("proxy_expand_chunk");
    }
  });
});

describe("buildSaverDecision evidence-ledger wiring (real record)", () => {
  const realDeps = (storeRoot: string) => ({
    storeRoot,
    resolveSettings: () => ({ enabled: true, mode: "balanced" as const }),
    readSessionIntent: () => undefined,
    record: recordAndFilterOverlayOutput,
    recordInvocation: () => {},
    recordCompression: () => {},
    recordFailure: () => {},
    recordCompletion: () => {},
    hasSeenOutput: () => false,
    recordSeenOutput: () => {},
  });

  function evidenceRecords(storeRoot: string, cwd: string): unknown[] {
    const dir = join(storeRoot, "evidence", encodeWorkspaceKey(cwd));
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return [];
    }
    return names
      .filter((n) => n.endsWith(".json"))
      .map((n) => JSON.parse(readFileSync(join(dir, n), "utf8")));
  }

  it("writes a real evidence record with a redaction report for a compressed output", async () => {
    const storeRoot = tempStore("saver-evidence-");
    const cwd = "/Users/x/proj";
    const raw = evidenceLedgerBashCorpus();
    expect(Buffer.byteLength(raw, "utf8")).toBe(50_000);
    const lines = raw.split("\n");
    expect(new Set(lines).size).toBe(lines.length);
    // The event's measured fields have a real 500 ms product deadline. Warm
    // the lazy BPE loader outside that deadline; this still exercises the
    // actual counter for both persisted event values below.
    expect(await countTokens("warm token counter")).toBeGreaterThan(0);
    const out = await buildSaverDecision(bigBash(raw), {
      ...realDeps(storeRoot),
      resolveSettings: () => ({ enabled: true, mode: "balanced" }),
    });
    expect("updatedToolOutput" in out).toBe(true);
    const workspaceKey = encodeWorkspaceKey(cwd);
    const events = readOverlayEvents({ root: storeRoot }, workspaceKey, "live-1");
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event).toMatchObject({
      rawBytes: 50_000,
      rawTokens: expect.any(Number),
      returnedTokens: expect.any(Number),
    });
    expect(event?.returnedBytes).toBeLessThan(50_000);
    expect(event?.rawTokens).toBeGreaterThan(event?.returnedTokens ?? 0);
    expect(event?.deltaTokens).toBe((event?.rawTokens ?? 0) - (event?.returnedTokens ?? 0));
    expect(event?.chunksStored).toBeGreaterThan(0);
    expect(event?.chunkSetId).toEqual(expect.any(String));
    const chunkSet = await loadOverlayChunkSet({
      storeRoot,
      workspaceKey,
      liveSessionId: "live-1",
      chunkSetId: event?.chunkSetId ?? "",
    });
    expect(chunkSet.rawBytes).toBe(50_000);
    expect(chunkSet.chunks.length).toBeGreaterThan(0);
    expect(event?.chunksStored).toBe(chunkSet.chunks.length);
    const records = evidenceRecords(storeRoot, cwd) as Array<{
      redactionReport?: { redacted: boolean };
      redactedRawChunkSetId?: string;
      returnedChunkRefs?: Array<{ chunkSetId: string; chunkId: string }>;
    }>;
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      redactionReport: { redacted: false },
      redactedRawChunkSetId: event?.chunkSetId,
    });
    const returnedChunkRefs = records[0]?.returnedChunkRefs;
    expect(returnedChunkRefs).toHaveLength(chunkSet.chunks.length);
    expect(returnedChunkRefs).toEqual(
      chunkSet.chunks.map((chunk) => ({ chunkSetId: event?.chunkSetId, chunkId: chunk.id })),
    );
  });

  it("writes NO evidence record on passthrough (below budget)", async () => {
    const storeRoot = tempStore("saver-evidence-");
    const cwd = "/Users/x/proj";
    const out = await buildSaverDecision(bigBash("tiny"), realDeps(storeRoot));
    expect(out).toEqual({ passthrough: true });
    expect(evidenceRecords(storeRoot, cwd).length).toBe(0);
  });

  it("still returns compressed output when the evidence write throws", async () => {
    const storeRoot = tempStore("saver-evidence-");
    // A record() that compresses normally but whose injected evidence append throws
    // mirrors recordAndFilterOverlayOutput's best-effort swallow: compression must
    // survive an evidence-store failure.
    const record = vi.fn(async (input: Parameters<typeof recordAndFilterOverlayOutput>[0]) => {
      expect(input.evidenceStoreRoot).toBe(storeRoot);
      return recordAndFilterOverlayOutput({
        ...input,
        evidenceStoreRoot: join(storeRoot, "\0bad-evidence-root"),
      });
    });
    const raw = evidenceLedgerBashCorpus();
    expect(Buffer.byteLength(raw, "utf8")).toBe(50_000);
    const out = await buildSaverDecision(bigBash(raw), {
      storeRoot,
      resolveSettings: () => ({ enabled: true, mode: "balanced" }),
      readSessionIntent: () => undefined,
      record,
      recordInvocation: () => {},
      recordCompression: () => {},
      recordFailure: () => {},
      recordCompletion: () => {},
      hasSeenOutput: () => false,
      recordSeenOutput: () => {},
    });
    expect("updatedToolOutput" in out).toBe(true);
    if ("updatedToolOutput" in out) {
      const u = out.updatedToolOutput as { stdout: string };
      expect(u.stdout).toContain("Mega Saver: compressed");
    }
    const events = readOverlayEvents(
      { root: storeRoot },
      encodeWorkspaceKey("/Users/x/proj"),
      "live-1",
    );
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event).toMatchObject({
      rawBytes: 50_000,
      rawTokens: expect.any(Number),
      returnedTokens: expect.any(Number),
    });
    expect(event?.chunksStored).toBeGreaterThan(0);
    expect(event?.chunkSetId).toEqual(expect.any(String));
    const chunkSet = await loadOverlayChunkSet({
      storeRoot,
      workspaceKey: encodeWorkspaceKey("/Users/x/proj"),
      liveSessionId: "live-1",
      chunkSetId: event?.chunkSetId ?? "",
    });
    expect(chunkSet.rawBytes).toBe(50_000);
    expect(chunkSet.chunks.length).toBeGreaterThan(0);
    expect(event?.chunksStored).toBe(chunkSet.chunks.length);
    expect(evidenceRecords(storeRoot, "/Users/x/proj")).toEqual([]);
  });

  it("compresses a large WebFetch result object and preserves the string shape", async () => {
    const d = deps();
    const out = await buildSaverDecision(
      {
        tool_name: "WebFetch",
        tool_input: { url: "https://example.com", prompt: "summarize" },
        tool_response: { result: "Y".repeat(50_000) },
        session_id: "live-1",
        cwd: "/Users/x/proj",
      },
      d,
    );
    expect("updatedToolOutput" in out).toBe(true);
    if ("updatedToolOutput" in out) {
      const u = out.updatedToolOutput as { result: string };
      expect(u.result).toContain("SHORT");
      expect(u.result).toContain("cs-1");
    }
    expect(d.record).toHaveBeenCalledOnce();
    // The fetch chunk-set source validates the label as a URL — it must be the
    // request url, not the "WebFetch" tool-name fallback.
    expect(d.record).toHaveBeenCalledWith(
      expect.objectContaining({ sourceKind: "fetch", label: "https://example.com" }),
    );
  });

  it("compresses a large WebFetch bare-string response, keeping it a string", async () => {
    const d = deps();
    const out = await buildSaverDecision(
      {
        tool_name: "WebFetch",
        tool_input: { url: "https://example.com", prompt: "summarize" },
        tool_response: "Z".repeat(50_000),
        session_id: "live-1",
        cwd: "/Users/x/proj",
      },
      d,
    );
    expect("updatedToolOutput" in out).toBe(true);
    if ("updatedToolOutput" in out) {
      expect(typeof out.updatedToolOutput).toBe("string");
      expect(out.updatedToolOutput as string).toContain("SHORT");
    }
    expect(d.record).toHaveBeenCalledOnce();
  });
});

describe("buildSaverDecision intent fill-gap", () => {
  const validPayload = {
    tool_name: "Bash",
    tool_input: { command: "echo big" },
    tool_response: { stdout: "X".repeat(50_000), stderr: "", interrupted: false, isImage: false },
    session_id: "live-1",
    cwd: "/Users/x/proj",
  };

  it("sets intent from readSessionIntent when present", async () => {
    let captured: { intent?: string } | undefined;
    const d = {
      storeRoot: "/store",
      resolveSettings: () => ({ enabled: true, mode: "safe" as const }),
      readSessionIntent: () => "refactor the auth module",
      recordInvocation: () => {},
      recordCompression: () => {},
      hasSeenOutput: () => false,
      recordSeenOutput: () => {},
      record: async (input: { intent?: string }) => {
        captured = input;
        return {
          decision: "compressed" as const,
          summary: "s",
          returnedText: "s",
          rawBytes: 10_000,
          returnedBytes: 100,
          bytesSaved: 9_900,
          savingRatio: 0.99,
          chunkSetId: "c1",
        };
      },
    };
    await buildSaverDecision(validPayload, d as never);
    expect(captured?.intent).toBe("refactor the auth module");
  });

  it("omits intent when readSessionIntent returns undefined", async () => {
    let captured: Record<string, unknown> | undefined;
    const d = {
      storeRoot: "/store",
      resolveSettings: () => ({ enabled: true, mode: "safe" as const }),
      readSessionIntent: () => undefined,
      recordInvocation: () => {},
      recordCompression: () => {},
      hasSeenOutput: () => false,
      recordSeenOutput: () => {},
      record: async (input: Record<string, unknown>) => {
        captured = input;
        return {
          decision: "compressed" as const,
          summary: "s",
          returnedText: "s",
          rawBytes: 10_000,
          returnedBytes: 100,
          bytesSaved: 9_900,
          savingRatio: 0.99,
          chunkSetId: "c1",
        };
      },
    };
    await buildSaverDecision(validPayload, d as never);
    expect(captured && "intent" in captured).toBe(false);
  });
});

describe("recovery footer + expansion guard", () => {
  it("footer points at the Bash-callable mega output chunk", async () => {
    const d = deps();
    const out = await buildSaverDecision(bigBash("X".repeat(50_000)), d);
    expect("updatedToolOutput" in out).toBe(true);
    const u = (out as { updatedToolOutput: { stdout: string } }).updatedToolOutput;
    expect(u.stdout).toContain('run: mega output chunk "cs-1" "0"');
    expect(u.stdout).toContain("proxy_expand_chunk");
  });

  it("never re-compresses a mega output chunk expansion (C13)", async () => {
    const d = deps();
    const payload = {
      tool_name: "Bash",
      tool_input: { command: 'mega output chunk "cs-1" "0"' },
      tool_response: { stdout: "Y".repeat(50_000), stderr: "", interrupted: false, isImage: false },
      session_id: "live-1",
      cwd: "/Users/x/proj",
    };
    const out = await buildSaverDecision(payload, d);
    expect(out).toEqual({ passthrough: true });
    expect(d.record).not.toHaveBeenCalled();
  });
});

describe("wave-1 tool coverage", () => {
  const big = "Z".repeat(50_000);
  const cases: Array<{ tool: string; input: Record<string, unknown>; response: unknown }> = [
    {
      tool: "Task",
      input: { description: "explore auth" },
      response: { content: [{ type: "text", text: big }] },
    },
    { tool: "BashOutput", input: {}, response: { stdout: big, stderr: "" } },
    { tool: "Monitor", input: {}, response: { stdout: big, stderr: "" } },
    { tool: "WebSearch", input: { query: "vitest flaky" }, response: big },
    { tool: "ToolSearch", input: { query: "select:Read" }, response: big },
    {
      tool: "mcp__somevendor__get_page",
      input: {},
      response: { content: [{ type: "text", text: big }] },
    },
  ];

  it.each(cases)(
    "compresses $tool above the new-surface floor",
    async ({ tool, input, response }) => {
      const d = deps();
      const out = await buildSaverDecision(
        {
          tool_name: tool,
          tool_input: input,
          tool_response: response,
          session_id: "live-1",
          cwd: "/Users/x/proj",
        },
        d,
      );
      expect("updatedToolOutput" in out).toBe(true);
      expect(d.record).toHaveBeenCalledOnce();
    },
  );

  it("gates new surfaces at max(modeBudget, floor): NEW_SURFACE_MIN_BYTES passes through", async () => {
    const d = deps();
    const out = await buildSaverDecision(
      {
        tool_name: "WebSearch",
        tool_input: { query: "q" },
        tool_response: "W".repeat(NEW_SURFACE_MIN_BYTES),
        session_id: "live-1",
        cwd: "/Users/x/proj",
      },
      d,
    );
    expect(out).toEqual({ passthrough: true });
    expect(d.record).not.toHaveBeenCalled();
  });

  it("compresses a new surface one byte over the floor", async () => {
    const d = deps();
    const out = await buildSaverDecision(
      {
        tool_name: "WebSearch",
        tool_input: { query: "q" },
        tool_response: "W".repeat(NEW_SURFACE_MIN_BYTES + 1),
        session_id: "live-1",
        cwd: "/Users/x/proj",
      },
      d,
    );
    expect("updatedToolOutput" in out).toBe(true);
  });

  it("existing tools keep the plain mode budget (13000 B on Bash compresses in balanced)", async () => {
    const d = deps();
    const out = await buildSaverDecision(bigBash("B".repeat(13_000)), d);
    expect("updatedToolOutput" in out).toBe(true);
  });

  it("mega's own MCP tools pass through (no self-compression)", async () => {
    const d = deps();
    const out = await buildSaverDecision(
      {
        tool_name: "mcp__megasaver__proxy_read_file",
        tool_input: {},
        tool_response: "M".repeat(50_000),
        session_id: "live-1",
        cwd: "/Users/x/proj",
      },
      d,
    );
    expect(out).toEqual({ passthrough: true });
    expect(d.record).not.toHaveBeenCalled();
  });

  it("compresses a third-party mega-prefixed MCP tool (not self-excluded)", async () => {
    const d = deps();
    const out = await buildSaverDecision(
      {
        tool_name: "mcp__megatools__get",
        tool_input: {},
        tool_response: "M".repeat(50_000),
        session_id: "live-1",
        cwd: "/Users/x/proj",
      },
      d,
    );
    expect("updatedToolOutput" in out).toBe(true);
    expect(d.record).toHaveBeenCalledOnce();
  });

  it("labels WebSearch by query (grep kind) and Task by description (command kind)", async () => {
    const d = deps();
    await buildSaverDecision(
      {
        tool_name: "WebSearch",
        tool_input: { query: "vitest flaky" },
        tool_response: "Q".repeat(50_000),
        session_id: "live-1",
        cwd: "/Users/x/proj",
      },
      d,
    );
    expect(d.record).toHaveBeenCalledWith(
      expect.objectContaining({ label: "vitest flaky", sourceKind: "grep" }),
    );
    vi.mocked(d.record).mockClear();
    await buildSaverDecision(
      {
        tool_name: "Task",
        tool_input: { description: "explore auth" },
        tool_response: { content: [{ type: "text", text: "T".repeat(50_000) }] },
        session_id: "live-1",
        cwd: "/Users/x/proj",
      },
      d,
    );
    expect(d.record).toHaveBeenCalledWith(
      expect.objectContaining({ label: "explore auth", sourceKind: "command" }),
    );
  });
});

describe("wave-1 shapes", () => {
  it("compresses a Glob filenames array and rebuilds it as string[] (spec 2026-07-09 reverses the v1 passthrough)", async () => {
    const d = deps({
      record: vi.fn().mockResolvedValue({ ...RECORDED, returnedText: `src/file-0.ts${FOOTER}` }),
    });
    const out = await buildSaverDecision(
      {
        tool_name: "Glob",
        tool_input: { pattern: "**/*.ts" },
        tool_response: {
          filenames: Array.from({ length: 2_000 }, (_, i) => `src/file-${i}.ts`),
          durationMs: 12,
          numFiles: 2_000,
          truncated: false,
        },
        session_id: "live-1",
        cwd: "/Users/x/proj",
      },
      d,
    );
    expect("updatedToolOutput" in out).toBe(true);
    const u = (out as { updatedToolOutput: { filenames: string[]; numFiles: number } })
      .updatedToolOutput;
    expect(Array.isArray(u.filenames)).toBe(true);
    expect(u.filenames[0]).toBe("src/file-0.ts");
    expect(u.numFiles).toBe(1);
    expect(u.filenames).toContain("… [Mega Saver: 1999 of 2000 paths omitted]");
    expect(u.filenames.some((f) => f.includes('mega output chunk "cs-1"'))).toBe(true);
  });

  it("compresses Grep files_with_matches filenames", async () => {
    const d = deps();
    const out = await buildSaverDecision(
      {
        tool_name: "Grep",
        tool_input: { pattern: "TODO" },
        tool_response: {
          mode: "files_with_matches",
          filenames: Array.from({ length: 2_000 }, (_, i) => `src/f-${i}.ts`),
          numFiles: 2_000,
        },
        session_id: "live-1",
        cwd: "/Users/x/proj",
      },
      d,
    );
    expect("updatedToolOutput" in out).toBe(true);
  });

  it("rebuilds Glob/Grep filenames with paths verbatim and every non-path entry behind the … sentinel", async () => {
    const tmpDir = tempStore("saver-c1-");
    const paths = Array.from({ length: 2_000 }, (_, i) => `src/file-${i}.ts`);
    const origSet = new Set(paths);
    const d = {
      ...deps(),
      storeRoot: tmpDir,
      record: recordAndFilterOverlayOutput,
    };
    const out = await buildSaverDecision(
      {
        tool_name: "Glob",
        tool_input: { pattern: "**/*.ts" },
        tool_response: {
          filenames: paths,
          durationMs: 12,
          numFiles: 2_000,
          truncated: false,
        },
        session_id: "live-1",
        cwd: "/Users/x/proj",
      },
      d,
    );
    expect("updatedToolOutput" in out).toBe(true);
    const u = (out as { updatedToolOutput: { filenames: string[]; numFiles: number } })
      .updatedToolOutput;
    expect(Array.isArray(u.filenames)).toBe(true);

    // B6 still holds: nothing that is not a real result path may be mistakable
    // for one — every synthetic entry starts with the "… " sentinel.
    const pathEntries = u.filenames.filter((f) => origSet.has(f));
    for (const f of u.filenames) {
      if (!origSet.has(f)) expect(f.startsWith("… ")).toBe(true);
    }
    expect(pathEntries.length).toBeGreaterThan(0);
    expect(u.numFiles).toBe(pathEntries.length);
  });

  it("delivers a truncation marker and the recovery handle through the filenames rebuild (W4)", async () => {
    const tmpDir = tempStore("saver-w4-files-");
    const paths = Array.from({ length: 2_000 }, (_, i) => `src/pkg-${i % 40}/module-${i}.ts`);
    const origSet = new Set(paths);
    const d = {
      ...deps(),
      storeRoot: tmpDir,
      record: recordAndFilterOverlayOutput,
    };
    const out = await buildSaverDecision(
      {
        tool_name: "Grep",
        tool_input: { pattern: "TODO" },
        tool_response: { mode: "files_with_matches", filenames: paths, numFiles: 2_000 },
        session_id: "live-1",
        cwd: "/Users/x/proj",
      },
      d,
    );
    expect("updatedToolOutput" in out).toBe(true);
    const u = (out as { updatedToolOutput: { filenames: string[]; numFiles: number } })
      .updatedToolOutput;
    const delivered = u.filenames.filter((f) => origSet.has(f));
    const extras = u.filenames.filter((f) => !origSet.has(f));
    expect(delivered.length).toBeGreaterThan(0);
    expect(delivered.length).toBeLessThan(2_000);
    const marker = extras.find((f) => /^… \[Mega Saver: \d+ of 2000 paths omitted\]$/.test(f));
    expect(marker).toBe(`… [Mega Saver: ${2_000 - delivered.length} of 2000 paths omitted]`);
    expect(extras.some((f) => f.includes('mega output chunk "cs-'))).toBe(true);
    for (const f of extras) {
      expect(f.startsWith("… ")).toBe(true);
    }
    expect(u.numFiles).toBe(delivered.length);
  });

  it("records each stream separately, gated on combined size, each landing in its own slot (C5/B8)", async () => {
    const calls: Array<{ raw: string; compressFloorBytes?: number; streamSlot?: string }> = [];
    const record = vi.fn(
      async (input: { raw: string; compressFloorBytes?: number; streamSlot?: string }) => {
        calls.push(input);
        return calls.length === 1
          ? { ...RECORDED, returnedText: `OUT-EXCERPT${FOOTER}` }
          : { ...RECORDED, returnedText: `ERR-EXCERPT${FOOTER}` };
      },
    );
    const d = deps({ record });
    // 8KB + 8KB: each stream alone is below the 12000 balanced floor; only the
    // combined size clears it (the B8 win the split must not lose).
    const out = await buildSaverDecision(
      {
        tool_name: "Bash",
        tool_input: { command: "pnpm build" },
        tool_response: {
          stdout: "O".repeat(8_000),
          stderr: "E".repeat(8_000),
          interrupted: false,
          isImage: false,
        },
        session_id: "live-1",
        cwd: "/Users/x/proj",
      },
      d,
    );
    expect("updatedToolOutput" in out).toBe(true);
    const u = (out as { updatedToolOutput: { stdout: string; stderr: string } }).updatedToolOutput;
    expect(u.stdout).toContain("OUT-EXCERPT");
    expect(u.stderr).toContain("ERR-EXCERPT");
    expect(record).toHaveBeenCalledTimes(2);
    expect(calls[0]?.raw).toBe("O".repeat(8_000));
    expect(calls[1]?.raw).toBe("E".repeat(8_000));
    expect(calls.map((c) => c.compressFloorBytes)).toEqual([6_000, 6_000]);
    // Stream discriminator: byte-identical parts on both streams would derive
    // the same overlay event id without it (second event absorbed), so each
    // dual-stream part must name its slot for record()'s identity hash.
    expect(calls.map((c) => c.streamSlot)).toEqual(["stdout", "stderr"]);
  });

  it("dual-stream part boundaries cannot alias in the seen-ledger hash", async () => {
    const X = "x".repeat(8_000);
    const Y = "y".repeat(8_000);
    const Z = "z".repeat(8_000);
    const payload = (stdout: string, stderr: string) => ({
      tool_name: "Bash",
      tool_input: { command: "pnpm build" },
      tool_response: { stdout, stderr, interrupted: false, isImage: false },
      session_id: "live-1",
      cwd: "/Users/x/proj",
    });
    const seen: string[] = [];
    const d1 = deps({
      recordSeenOutput: (_root: string, _wk: string, _sid: string, hash: string) => {
        seen.push(hash);
      },
    });
    const out1 = await buildSaverDecision(payload(`${X}\n${Y}`, Z), d1);
    expect("updatedToolOutput" in out1).toBe(true);
    expect(seen).toHaveLength(1);

    // {X\nY, Z} and {X, Y\nZ} are DIFFERENT responses, but a ledger that
    // joined parts with "\n" hashed both to hash("X\nY\nZ") — the sibling
    // was treated as already seen and passed through uncompressed.
    const d2 = deps({
      hasSeenOutput: (_root: string, _wk: string, _sid: string, hash: string) => hash === seen[0],
    });
    const out2 = await buildSaverDecision(payload(X, `${Y}\n${Z}`), d2);
    expect("updatedToolOutput" in out2).toBe(true);
  });

  it("passes no streamSlot for a single-stream response (old event identity)", async () => {
    const calls: Array<{ streamSlot?: string }> = [];
    const record = vi.fn(async (input: { streamSlot?: string }) => {
      calls.push(input);
      return RECORDED;
    });
    const d = deps({ record });
    await buildSaverDecision(compressiblePayload(), d);
    expect(record).toHaveBeenCalledTimes(1);
    expect(calls[0] !== undefined && "streamSlot" in calls[0]).toBe(false);
  });

  it("compresses text blocks in a mixed content array and preserves non-text blocks byte-identical", async () => {
    const d = deps();
    const image = { type: "image", source: { type: "base64", data: "AAAA" } };
    const out = await buildSaverDecision(
      {
        tool_name: "Read",
        tool_input: { file_path: "/x/doc.pdf" },
        tool_response: {
          content: [
            { type: "text", text: "T".repeat(50_000) },
            image,
            { type: "text", text: "tail" },
          ],
        },
        session_id: "live-1",
        cwd: "/Users/x/proj",
      },
      d,
    );
    expect("updatedToolOutput" in out).toBe(true);
    const u = (out as { updatedToolOutput: { content: unknown[] } }).updatedToolOutput;
    expect(u.content).toHaveLength(2);
    expect(u.content[0]).toEqual({ type: "text", text: expect.stringContaining("SHORT") });
    expect(u.content[1]).toEqual(image);
  });

  it("still passes through an all-non-text content array", async () => {
    const d = deps();
    const out = await buildSaverDecision(
      {
        tool_name: "Read",
        tool_input: { file_path: "/x/img.png" },
        tool_response: { content: [{ type: "image", source: { data: "AAAA" } }] },
        session_id: "live-1",
        cwd: "/Users/x/proj",
      },
      d,
    );
    expect(out).toEqual({ passthrough: true });
  });
});

describe("footer comes from record (F30)", () => {
  it("emits recorded.returnedText verbatim — no hook-side footer appending", async () => {
    const d = deps();
    const out = await buildSaverDecision(bigBash("X".repeat(50_000)), d);
    const u = (out as { updatedToolOutput: { stdout: string } }).updatedToolOutput;
    expect(u.stdout).toBe(RECORDED.returnedText);
  });

  it("asks record() to include the footer", async () => {
    const d = deps();
    await buildSaverDecision(bigBash("X".repeat(50_000)), d);
    expect(d.record).toHaveBeenCalledWith(expect.objectContaining({ includeFooter: true }));
  });
});

describe("B9: safe mode compresses Bash below Claude Code's output ceiling", () => {
  it("a 25KB Bash output in safe mode reaches record() with the 24000 Bash floor", async () => {
    const captured: Array<{ compressFloorBytes?: number }> = [];
    const d = deps({
      resolveSettings: () => ({ enabled: true, mode: "safe" as const }),
      record: vi.fn(async (input: { compressFloorBytes?: number }) => {
        captured.push(input);
        return RECORDED;
      }),
    });
    const decision = await buildSaverDecision(bigBash("x".repeat(25_000)), d);
    expect("updatedToolOutput" in decision).toBe(true);
    expect(captured[0]?.compressFloorBytes).toBe(24_000);
  });

  it("safe mode still passes a 26KB Read through (32KB Read gate intact)", async () => {
    const d = deps({ resolveSettings: () => ({ enabled: true, mode: "safe" as const }) });
    const decision = await buildSaverDecision(
      {
        tool_name: "Read",
        tool_input: { file_path: "/Users/x/proj/big.txt" },
        tool_response: { file: { content: "x".repeat(26_000) } },
        session_id: "live-1",
        cwd: "/Users/x/proj",
      },
      d,
    );
    expect(decision).toEqual({ passthrough: true });
  });
});

describe("B8: hook forwards its gate as compressFloorBytes", () => {
  it("aggressive Read forwards the 4000 B gate", async () => {
    const captured: Array<{ compressFloorBytes?: number }> = [];
    const d = deps({
      resolveSettings: () => ({ enabled: true, mode: "aggressive" as const }),
      record: vi.fn(async (input: { compressFloorBytes?: number }) => {
        captured.push(input);
        return RECORDED;
      }),
    });
    await buildSaverDecision(
      {
        tool_name: "Read",
        tool_input: { file_path: "/Users/x/proj/big.txt" },
        tool_response: { file: { content: "x".repeat(5_000) } },
        session_id: "live-1",
        cwd: "/Users/x/proj",
      },
      d,
    );
    expect(captured[0]?.compressFloorBytes).toBe(4_000);
  });
});

describe("B9 follow-up: background-shell retrieval shares Bash's ceiling", () => {
  const shellPayload = (tool: string, text: string) => ({
    tool_name: tool,
    tool_input: { bash_id: "bg-1" },
    tool_response: { stdout: text, stderr: "", interrupted: false, isImage: false },
    session_id: "live-1",
    cwd: "/Users/x/proj",
  });

  it("safe mode compresses a 26KB BashOutput with the 24000 floor", async () => {
    const captured: Array<{ compressFloorBytes?: number }> = [];
    const d = deps({
      resolveSettings: () => ({ enabled: true, mode: "safe" as const }),
      record: vi.fn(async (i: { compressFloorBytes?: number }) => {
        captured.push(i);
        return RECORDED;
      }),
    });
    const decision = await buildSaverDecision(shellPayload("BashOutput", "x".repeat(26_000)), d);
    expect("updatedToolOutput" in decision).toBe(true);
    expect(captured[0]?.compressFloorBytes).toBe(24_000);
  });

  it("safe mode compresses a 26KB Monitor with the 24000 floor", async () => {
    const captured: Array<{ compressFloorBytes?: number }> = [];
    const d = deps({
      resolveSettings: () => ({ enabled: true, mode: "safe" as const }),
      record: vi.fn(async (i: { compressFloorBytes?: number }) => {
        captured.push(i);
        return RECORDED;
      }),
    });
    const decision = await buildSaverDecision(shellPayload("Monitor", "x".repeat(26_000)), d);
    expect("updatedToolOutput" in decision).toBe(true);
    expect(captured[0]?.compressFloorBytes).toBe(24_000);
  });

  it("aggressive BashOutput keeps the 16384 new-surface floor (not lowered to 4000)", async () => {
    const captured: Array<{ compressFloorBytes?: number }> = [];
    const d = deps({
      resolveSettings: () => ({ enabled: true, mode: "aggressive" as const }),
      record: vi.fn(async (i: { compressFloorBytes?: number }) => {
        captured.push(i);
        return RECORDED;
      }),
    });
    // 17KB > 16384 floor -> compresses; floor must be 16384, not 4000
    await buildSaverDecision(shellPayload("BashOutput", "x".repeat(17_000)), d);
    expect(captured[0]?.compressFloorBytes).toBe(16_384);
  });

  it("Task (subagent report, not shell-truncated) is left at the 32000 safe floor", async () => {
    const d = deps({ resolveSettings: () => ({ enabled: true, mode: "safe" as const }) });
    const decision = await buildSaverDecision(shellPayload("Task", "x".repeat(26_000)), d);
    expect(decision).toEqual({ passthrough: true }); // 26000 < 32000 -> passthrough (documented: Task is unbounded, big reports still compress)
  });
});

describe("E21 failure + completion ledger", () => {
  it("records a completion after a successful run", async () => {
    const d = deps();
    const out = await buildSaverDecision(bigBash("X".repeat(50_000)), d);
    expect("updatedToolOutput" in out).toBe(true);
    expect(d.recordCompletion).toHaveBeenCalledOnce();
    const [storeRoot, wk, ts] = (d.recordCompletion as unknown as Mock).mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(storeRoot).toBe("/store");
    expect(wk).toBe(encodeWorkspaceKey("/Users/x/proj"));
    expect(Number.isNaN(Date.parse(ts))).toBe(false);
    expect(d.recordFailure).not.toHaveBeenCalled();
  });

  it('a throwing record dep stays passthrough AND records a failure with kind "record"', async () => {
    const d = deps({ record: vi.fn().mockRejectedValue(new Error("disk full")) });
    const out = await buildSaverDecision(bigBash("X".repeat(50_000)), d);
    expect(out).toEqual({ passthrough: true });
    expect(d.recordFailure).toHaveBeenCalledOnce();
    const [, wk, kind] = (d.recordFailure as unknown as Mock).mock.calls[0] as [
      string,
      string,
      string,
      string,
    ];
    expect(wk).toBe(encodeWorkspaceKey("/Users/x/proj"));
    expect(kind).toBe("record");
    expect(d.recordCompletion).not.toHaveBeenCalled();
  });

  it('a payload that explodes during parsing records kind "payload" with a cwd-derived key', async () => {
    const d = deps();
    const bomb = {
      get tool_name(): string {
        throw new Error("boom");
      },
    };
    const out = await buildSaverDecision(bomb, d);
    expect(out).toEqual({ passthrough: true });
    expect(d.recordFailure).toHaveBeenCalledOnce();
    const [, wk, kind] = (d.recordFailure as unknown as Mock).mock.calls[0] as [
      string,
      string,
      string,
      string,
    ];
    expect(kind).toBe("payload");
    expect(wk).toBe(encodeWorkspaceKey(process.cwd()));
  });

  it("a tool the saver never processes records neither an invocation nor a completion", async () => {
    const d = deps();
    const out = await buildSaverDecision(
      {
        tool_name: "Write",
        tool_input: { file_path: "/Users/x/proj/a.ts" },
        tool_response: { filePath: "/Users/x/proj/a.ts", success: true },
        session_id: "live-1",
        cwd: "/Users/x/proj",
      },
      d,
    );
    expect(out).toEqual({ passthrough: true });
    expect(d.recordInvocation).not.toHaveBeenCalled();
    // A completion without a matching invocation clears a genuinely failing
    // hook from doctor's liveness FAIL (fail-open inversion).
    expect(d.recordCompletion).not.toHaveBeenCalled();
  });

  it("a throwing ledger write never breaks the decision", async () => {
    const d = deps({
      recordCompletion: vi.fn(() => {
        throw new Error("ledger io");
      }),
    });
    const out = await buildSaverDecision(bigBash("X".repeat(50_000)), d);
    expect("updatedToolOutput" in out).toBe(true);
  });
});

describe("net-effect verdict", () => {
  // The verdict is an unattributed dispersion advisory (@megasaver/stats
  // net-effect.ts) — the hook must have no knob for it to switch off.
  it("cannot gate compression: the hook takes no pause dependency", async () => {
    const d = deps();
    expect(Object.keys(d).filter((k) => /paus/i.test(k))).toEqual([]);
    const decision = await buildSaverDecision(compressiblePayload(), d);
    expect("updatedToolOutput" in decision).toBe(true);
  });
});

describe("first-sight gate + stable chunk id", () => {
  it("second sight of identical output passes through untouched (no rewrite, no churn)", async () => {
    const seen = new Set<string>();
    const d = deps({
      hasSeenOutput: (_s, _w, _sid, h) => seen.has(h),
      recordSeenOutput: (_s, _w, _sid, h) => {
        seen.add(h);
      },
    });
    const first = await buildSaverDecision(compressiblePayload(), d);
    expect("updatedToolOutput" in first).toBe(true);
    const second = await buildSaverDecision(compressiblePayload(), d);
    expect(second).toEqual({ passthrough: true });
  });

  it("aggressive mode also never rewrites seen output", async () => {
    const d = deps({
      resolveSettings: () => ({ enabled: true, mode: "aggressive" as const }),
      hasSeenOutput: () => true,
    });
    expect(await buildSaverDecision(compressiblePayload(), d)).toEqual({ passthrough: true });
  });

  it("chunk-set id derives from content: identical raw output yields an identical id", async () => {
    const recordedIds: string[] = [];
    const makeDeps = () =>
      deps({
        record: async (input) => {
          recordedIds.push(input.newId?.() ?? "missing");
          return RECORDED;
        },
      });
    await buildSaverDecision(compressiblePayload(), makeDeps());
    await buildSaverDecision(compressiblePayload(), makeDeps());
    expect(recordedIds[0]).toBe(recordedIds[1]);
    expect(recordedIds[0]).not.toBe("missing");
  });
});

describe("safe-mode Bash floor stays below the truncation ceiling (C4 rewrite)", () => {
  const modes: TokenSaverMode[] = ["aggressive", "balanced", "safe"];

  it("caps minBytesFor('Bash', mode) at min(budget, BASH_COMPRESS_FLOOR)", () => {
    expect(minBytesFor("Bash", "safe")).toBe(24_000);
    expect(minBytesFor("Bash", "balanced")).toBe(12_000);
    expect(minBytesFor("Bash", "aggressive")).toBe(4_000);
    for (const mode of modes) {
      expect(minBytesFor("Bash", mode)).toBeLessThanOrEqual(modeToBudget(mode));
    }
  });

  it("compresses a production-reachable 25KB safe-mode Bash output end-to-end", async () => {
    const tmpDir = tempStore("saver-c4-");
    const raw = Array.from({ length: 501 }, (_, i) =>
      `build step ${i} finished with status ok`.padEnd(49, "."),
    ).join("\n");
    const rawBytes = Buffer.byteLength(raw, "utf8");
    expect(rawBytes).toBeGreaterThan(24_000);
    expect(rawBytes).toBeLessThan(30_000);
    const d = {
      ...deps({
        resolveSettings: () => ({ enabled: true, mode: "safe" as const }),
      }),
      storeRoot: tmpDir,
      record: recordAndFilterOverlayOutput,
    };
    const out = await buildSaverDecision(
      {
        tool_name: "Bash",
        tool_input: { command: "run build" },
        tool_response: { stdout: raw, stderr: "" },
        session_id: "live-1",
        cwd: "/Users/x/proj",
      },
      d,
    );
    expect("updatedToolOutput" in out).toBe(true);
    const u = (out as { updatedToolOutput: { stdout: string } }).updatedToolOutput;
    expect(u.stdout.length).toBeLessThan(raw.length);
    expect(u.stdout).toContain("mega output chunk");
  });
});

describe("combined stdout/stderr stream compression (Task C5)", () => {
  it("compresses when combined stdout and stderr clear the floor, shortening both fields and preserving extra keys", async () => {
    const tmpDir = tempStore("saver-c5-");
    const stdout15k = "stdout line content here\n".repeat(600); // ~15 KB
    const stderr15k = "stderr error line here\n".repeat(600); // ~15 KB
    const d = {
      ...deps({
        resolveSettings: () => ({ enabled: true, mode: "balanced" as const }),
      }),
      storeRoot: tmpDir,
      record: recordAndFilterOverlayOutput,
    };
    const out = await buildSaverDecision(
      {
        tool_name: "Bash",
        tool_input: { command: "build.sh" },
        tool_response: {
          stdout: stdout15k,
          stderr: stderr15k,
          exitCode: 1,
          interrupted: false,
        },
        session_id: "live-1",
        cwd: "/Users/x/proj",
      },
      d,
    );
    expect("updatedToolOutput" in out).toBe(true);
    const u = (
      out as {
        updatedToolOutput: {
          stdout?: string;
          stderr?: string;
          exitCode?: number;
          interrupted?: boolean;
        };
      }
    ).updatedToolOutput;
    expect(typeof u.stdout).toBe("string");
    expect(typeof u.stderr).toBe("string");
    expect((u.stdout as string).length).toBeLessThan(stdout15k.length);
    expect((u.stderr as string).length).toBeLessThan(stderr15k.length);
    expect(u.exitCode).toBe(1);
    expect(u.interrupted).toBe(false);
  });

  it("stdout-only response compresses stdout and preserves stdout key", async () => {
    const tmpDir = tempStore("saver-c5-");
    const stdout50k = "stdout line\n".repeat(4000);
    const d = {
      ...deps({
        resolveSettings: () => ({ enabled: true, mode: "balanced" as const }),
      }),
      storeRoot: tmpDir,
      record: recordAndFilterOverlayOutput,
    };
    const out = await buildSaverDecision(
      {
        tool_name: "Bash",
        tool_input: { command: "run.sh" },
        tool_response: { stdout: stdout50k },
        session_id: "live-1",
        cwd: "/Users/x/proj",
      },
      d,
    );
    expect("updatedToolOutput" in out).toBe(true);
    const u = (out as { updatedToolOutput: { stdout?: string } }).updatedToolOutput;
    expect(typeof u.stdout).toBe("string");
    expect((u.stdout as string).length).toBeLessThan(stdout50k.length);
  });

  it("stderr-only response compresses stderr and preserves stderr key", async () => {
    const tmpDir = tempStore("saver-c5-");
    const stderr50k = "stderr error line\n".repeat(4000);
    const d = {
      ...deps({
        resolveSettings: () => ({ enabled: true, mode: "balanced" as const }),
      }),
      storeRoot: tmpDir,
      record: recordAndFilterOverlayOutput,
    };
    const out = await buildSaverDecision(
      {
        tool_name: "Bash",
        tool_input: { command: "run.sh" },
        tool_response: { stderr: stderr50k },
        session_id: "live-1",
        cwd: "/Users/x/proj",
      },
      d,
    );
    expect("updatedToolOutput" in out).toBe(true);
    const u = (out as { updatedToolOutput: { stderr?: string } }).updatedToolOutput;
    expect(typeof u.stderr).toBe("string");
    expect((u.stderr as string).length).toBeLessThan(stderr50k.length);
  });
});

describe("stderr split is carried out-of-band (HOOK-4)", () => {
  function evidenceRawContents(storeRoot: string, cwd: string): string[] {
    const dir = join(storeRoot, "evidence", encodeWorkspaceKey(cwd));
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return [];
    }
    return names
      .filter((n) => n.endsWith(".json"))
      .map(
        (n) =>
          (JSON.parse(readFileSync(join(dir, n), "utf8")) as { redactedRawContent?: string })
            .redactedRawContent ?? "",
      );
  }

  it("keeps stderr evidence in the stderr slot even when budget pressure drops every boundary-area chunk", async () => {
    const tmpDir = tempStore("saver-hook4-");
    const cwd = "/Users/x/proj";
    // Filler lines are unique, volatile-free and ~400 B wide so every 40-line
    // chunk around the stream boundary weighs ~16 KB — over any balanced fit
    // budget, so fitBudget can never afford the chunk holding an in-band
    // boundary line. The short sentinel block is the only affordable stderr
    // evidence and must still be delivered AS stderr.
    const pad = (s: string) => s.padEnd(400, ".");
    const stdoutText = Array.from({ length: 60 }, (_, i) =>
      pad(`out line ${i} routine progress detail`),
    ).join("\n");
    const stderrText = [
      ...Array.from({ length: 40 }, (_, i) => pad(`err line ${i} verbose trace detail`)),
      ...Array.from({ length: 6 }, (_, i) => `SENTINEL-STDERR-EVIDENCE error segment ${i}`),
    ].join("\n");
    const d = {
      ...deps({
        resolveSettings: () => ({ enabled: true, mode: "balanced" as const }),
      }),
      storeRoot: tmpDir,
      record: recordAndFilterOverlayOutput,
    };
    const out = await buildSaverDecision(
      {
        tool_name: "Bash",
        tool_input: { command: "make release" },
        tool_response: { stdout: stdoutText, stderr: stderrText, interrupted: false },
        session_id: "live-1",
        cwd,
      },
      d,
    );
    expect("updatedToolOutput" in out).toBe(true);
    const u = (out as { updatedToolOutput: { stdout: string; stderr: string } }).updatedToolOutput;
    expect(u.stderr).toContain("SENTINEL-STDERR-EVIDENCE");
    expect(u.stdout).not.toContain("SENTINEL-STDERR-EVIDENCE");
    expect(u.stdout).not.toContain("STDERR error boundary");
    expect(u.stderr).not.toContain("STDERR error boundary");
    // Persisted raw evidence holds only what the command actually printed —
    // never a synthetic boundary line.
    const persisted = evidenceRawContents(tmpDir, cwd);
    expect(persisted.length).toBeGreaterThan(0);
    for (const raw of persisted) {
      expect(raw).not.toContain("STDERR error boundary");
    }
  });
});
