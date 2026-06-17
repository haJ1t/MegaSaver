import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordAndFilterOverlayOutput } from "@megasaver/core";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { describe, expect, it, vi } from "vitest";
import { buildSaverDecision } from "../../src/hooks/saver.js";

const RECORDED = {
  decision: "compressed" as const,
  summary: "SUMMARY",
  returnedText: "SHORT",
  rawBytes: 100_000,
  returnedBytes: 200,
  bytesSaved: 99_800,
  savingRatio: 0.998,
  chunkSetId: "cs-1",
};

function deps(overrides: Partial<Parameters<typeof buildSaverDecision>[1]> = {}) {
  return {
    storeRoot: "/store",
    readSettings: () => ({ enabled: true, mode: "balanced" as const }),
    record: vi.fn().mockResolvedValue(RECORDED),
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
      deps({ readSettings: () => ({ enabled: false, mode: "balanced" }) }),
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

  it("passes through a Glob filenames list (high-signal, never compressed)", async () => {
    // Real Claude Code Glob payload exposes a `filenames` array — every entry is a
    // distinct path the model may need, so it is evidence (§1), not compressible text.
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
        cwd: "/p",
      },
      deps(),
    );
    expect(out).toEqual({ passthrough: true });
  });

  it("passes through a multi-modal content array (never drops image blocks)", async () => {
    const out = await buildSaverDecision(
      {
        tool_name: "Read",
        tool_input: { file_path: "/p/doc.pdf" },
        tool_response: {
          content: [
            { type: "text", text: "Z".repeat(50_000) },
            { type: "image", source: { data: "..." } },
          ],
          isError: false,
        },
        session_id: "live-1",
        cwd: "/p",
      },
      deps(),
    );
    expect(out).toEqual({ passthrough: true });
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
    readSettings: () => ({ enabled: true, mode: "balanced" as const }),
    record: recordAndFilterOverlayOutput,
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
      readSettings: () => ({ enabled: true, mode: "balanced" }),
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
      readSettings: () => ({ enabled: true, mode: "balanced" }),
      record,
    });
    expect("updatedToolOutput" in out).toBe(true);
    if ("updatedToolOutput" in out) {
      const u = out.updatedToolOutput as { stdout: string };
      expect(u.stdout).toContain("Mega Saver: compressed");
    }
  });
});
