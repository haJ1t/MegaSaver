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
  tool_output: { stdout: text, stderr: "", interrupted: false, isImage: false },
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
        tool_output: { content: "x", isError: false },
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
      { tool_name: "Bash", tool_output: { weird: 1 }, session_id: "s", cwd: "/p" },
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
        tool_output: { content: "Y".repeat(50_000), isError: false },
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

  it("passes through a multi-modal content array (never drops image blocks)", async () => {
    const out = await buildSaverDecision(
      {
        tool_name: "Read",
        tool_input: { file_path: "/p/doc.pdf" },
        tool_output: {
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
        tool_output: { content: [{ type: "text", text: "Y".repeat(50_000) }], isError: false },
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
});
