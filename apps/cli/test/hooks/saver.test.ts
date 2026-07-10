import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordAndFilterOverlayOutput } from "@megasaver/core";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { describe, expect, it, vi } from "vitest";
import { NEW_SURFACE_MIN_BYTES, buildSaverDecision } from "../../src/hooks/saver.js";

const RECORDED = {
  decision: "compressed" as const,
  summary: "SUMMARY",
  returnedText: "SHORT",
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

  it("marks the pointer PARTIAL when the raw output ends with a truncation marker", async () => {
    // The harness can truncate a tool output BEFORE the PostToolUse hook sees it.
    // When the recovered chunk is therefore incomplete, the pointer must not promise
    // "Full output recoverable" — it must say the recovered chunk is PARTIAL.
    const truncated = `${"X".repeat(50_000)}\n[truncated]`;
    const out = await buildSaverDecision(bigBash(truncated), deps());
    expect("updatedToolOutput" in out).toBe(true);
    if ("updatedToolOutput" in out) {
      const u = out.updatedToolOutput as { stdout: string };
      expect(u.stdout).not.toContain("Full output recoverable");
      expect(u.stdout).toContain("PARTIAL");
      expect(u.stdout).toContain("truncated");
      // Recovery hint must stay so the model can still fetch what was stored.
      expect(u.stdout).toContain("proxy_expand_chunk");
      expect(u.stdout).toContain("cs-1");
    }
  });

  it("keeps the normal pointer when the raw output is not truncated", async () => {
    const out = await buildSaverDecision(bigBash("X".repeat(50_000)), deps());
    expect("updatedToolOutput" in out).toBe(true);
    if ("updatedToolOutput" in out) {
      const u = out.updatedToolOutput as { stdout: string };
      expect(u.stdout).toContain("Full output recoverable");
      expect(u.stdout).not.toContain("PARTIAL");
    }
  });

  it("does not trip on a benign 'truncated' word in the middle of the output", async () => {
    // Anchored detection: the marker is meaningful only near the END of the buffer.
    // A mid-text mention of truncation is normal content, not a real cutoff.
    const benign = `the build log was truncated earlier\n${"X".repeat(50_000)}`;
    const out = await buildSaverDecision(bigBash(benign), deps());
    expect("updatedToolOutput" in out).toBe(true);
    if ("updatedToolOutput" in out) {
      const u = out.updatedToolOutput as { stdout: string };
      expect(u.stdout).toContain("Full output recoverable");
      expect(u.stdout).not.toContain("PARTIAL");
    }
  });

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
    const storeRoot = mkdtempSync(join(tmpdir(), "saver-evidence-"));
    const cwd = "/Users/x/proj";
    const out = await buildSaverDecision(bigBash("X".repeat(50_000)), {
      ...realDeps(storeRoot),
      resolveSettings: () => ({ enabled: true, mode: "balanced" }),
    });
    expect("updatedToolOutput" in out).toBe(true);
    const records = evidenceRecords(storeRoot, cwd) as Array<{
      redactionReport?: { redacted: boolean };
    }>;
    expect(records.length).toBe(1);
    expect(records[0]?.redactionReport).toBeDefined();
    expect(records[0]?.redactionReport?.redacted).toBe(false);
  });

  it("writes NO evidence record on passthrough (below budget)", async () => {
    const storeRoot = mkdtempSync(join(tmpdir(), "saver-evidence-"));
    const cwd = "/Users/x/proj";
    const out = await buildSaverDecision(bigBash("tiny"), realDeps(storeRoot));
    expect(out).toEqual({ passthrough: true });
    expect(evidenceRecords(storeRoot, cwd).length).toBe(0);
  });

  it("still returns compressed output when the evidence write throws", async () => {
    const storeRoot = mkdtempSync(join(tmpdir(), "saver-evidence-"));
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
    const out = await buildSaverDecision(bigBash("X".repeat(50_000)), {
      storeRoot,
      resolveSettings: () => ({ enabled: true, mode: "balanced" }),
      readSessionIntent: () => undefined,
      record,
      recordInvocation: () => {},
      recordCompression: () => {},
      recordFailure: () => {},
      recordCompletion: () => {},
    });
    expect("updatedToolOutput" in out).toBe(true);
    if ("updatedToolOutput" in out) {
      const u = out.updatedToolOutput as { stdout: string };
      expect(u.stdout).toContain("Mega Saver: compressed");
    }
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
    const d = deps();
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
    expect(u.filenames.join("\n")).toContain("SHORT");
    expect(u.filenames.every((f) => f.length > 0)).toBe(true);
    expect(u.numFiles).toBe(2_000);
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

  it("compresses the LARGER of stdout/stderr and leaves the other untouched", async () => {
    const d = deps();
    const out = await buildSaverDecision(
      {
        tool_name: "Bash",
        tool_input: { command: "pnpm build" },
        tool_response: {
          stdout: "ok",
          stderr: "E".repeat(50_000),
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
    expect(u.stdout).toBe("ok");
    expect(u.stderr).toContain("SHORT");
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

describe("N-aware recovery footer (C12)", () => {
  it("single chunk keeps today's wording (regression)", async () => {
    const d = deps(); // RECORDED now has chunkCount: 1
    const out = await buildSaverDecision(bigBash("X".repeat(50_000)), d);
    const u = (out as { updatedToolOutput: { stdout: string } }).updatedToolOutput;
    expect(u.stdout).toContain('run: mega output chunk "cs-1" "0"');
    expect(u.stdout).not.toContain("chunks of");
  });

  it("multi chunk advertises N and the id range (no line->id formula)", async () => {
    const d = deps({ record: vi.fn().mockResolvedValue({ ...RECORDED, chunkCount: 5 }) });
    const out = await buildSaverDecision(bigBash("X".repeat(50_000)), d);
    const u = (out as { updatedToolOutput: { stdout: string } }).updatedToolOutput;
    expect(u.stdout).toContain("stored in 5 chunks of ~40 lines each");
    expect(u.stdout).toContain('mega output chunk "cs-1" "<i>" (i = 0..4)');
    // Must NOT advertise a line->id formula (chunks index redacted space, the
    // agent sees original line numbers — they diverge on multi-line redaction).
    expect(u.stdout).not.toContain("covers lines");
  });
});

describe("B9: safe mode compresses Bash below Claude Code's output ceiling", () => {
  it("a 26KB Bash output in safe mode reaches record() with the Bash floor", async () => {
    const captured: Array<{ compressFloorBytes?: number }> = [];
    const d = deps({
      resolveSettings: () => ({ enabled: true, mode: "safe" as const }),
      record: vi.fn(async (input: { compressFloorBytes?: number }) => {
        captured.push(input);
        return RECORDED;
      }),
    });
    const decision = await buildSaverDecision(bigBash("x".repeat(26_000)), d);
    expect("updatedToolOutput" in decision).toBe(true); // today: passthrough (32000 gate)
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
    expect("updatedToolOutput" in decision).toBe(true); // today: passthrough (32000 gate)
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
    const [storeRoot, wk, ts] = d.recordCompletion.mock.calls[0] as [string, string, string];
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
    const [, wk, kind] = d.recordFailure.mock.calls[0] as [string, string, string, string];
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
    const [, wk, kind] = d.recordFailure.mock.calls[0] as [string, string, string, string];
    expect(kind).toBe("payload");
    expect(wk).toBe(encodeWorkspaceKey(process.cwd()));
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
