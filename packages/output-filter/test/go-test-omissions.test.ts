import { describe, expect, it } from "vitest";
import { chunkByFormat } from "../src/parsers/index.js";
import { filterOutput } from "../src/types.js";

// SC3-5 (W4): parseGoTest kept only failing blocks — passing blocks, the
// pre-RUN preamble (build output) and their line counts vanished with no
// marker and no entry in the dropped count. Every removal must be delivered,
// marked, or counted; parser-level omissions get an explicit counted marker
// line (non-droppable via the fit reservation) plus inclusion in droppedCount.

const GO_TEST_MIXED = [
  "go: downloading example.com/dep v1.2.3",
  "ok  \texample.com/other\t0.011s",
  "=== RUN   TestAdd",
  "--- PASS: TestAdd (0.00s)",
  "=== RUN   TestMul",
  "--- PASS: TestMul (0.00s)",
  "=== RUN   TestDivide",
  "    math_test.go:15: Divide(1, 0) = 0; want error",
  "--- FAIL: TestDivide (0.00s)",
  "FAIL",
  "exit status 1",
  "FAIL\texample.com/math\t0.012s",
].join("\n");

describe("parseGoTest omission accounting (SC3-5)", () => {
  it("names the omitted passing blocks and preamble in a counted marker chunk", async () => {
    const chunks = await chunkByFormat(GO_TEST_MIXED);
    const marker = chunks.find((c) => c.text.startsWith("… ["));
    expect(marker?.text).toBe(
      "… [2 passing test blocks, 2 preamble lines omitted — recoverable via stored chunks]",
    );
    // The marker stands for the omitted region: preamble line 1 through the
    // end of the last omitted passing block.
    expect(marker?.startLine).toBe(1);
    expect(marker?.endLine).toBe(6);
  });

  it("emits no marker when nothing was omitted", async () => {
    const allFailing = [
      "=== RUN   TestDivide",
      "    math_test.go:15: Divide(1, 0) = 0; want error",
      "--- FAIL: TestDivide (0.00s)",
      "FAIL\texample.com/math\t0.012s",
    ].join("\n");
    const chunks = await chunkByFormat(allFailing);
    expect(chunks.some((c) => c.text.startsWith("… ["))).toBe(false);
  });

  it("filterOutput counts parser omissions into the dropped count", async () => {
    const lines: string[] = [
      "go: downloading example.com/scenario v2.0.1",
      "go: downloading example.com/fixtures v1.4.0",
      "building test binary for example.com/scenario",
    ];
    for (let i = 0; i < 50; i += 1) {
      lines.push(`=== RUN   TestScenario${i}`);
      lines.push(`    scenario_test.go:${20 + i}: prepared the ${i} fixture rows for this case`);
      lines.push(`--- PASS: TestScenario${i} (0.0${i % 9}s)`);
    }
    lines.push("=== RUN   TestReconcile");
    lines.push("    reconcile_test.go:88: ledger drift 7 exceeds tolerance 2");
    lines.push("--- FAIL: TestReconcile (0.02s)");
    lines.push("=== RUN   TestRotate");
    lines.push("    rotate_test.go:41: archive target missing after rotation");
    lines.push("--- FAIL: TestRotate (0.01s)");
    lines.push("FAIL");
    lines.push("exit status 1");
    lines.push("FAIL\texample.com/scenario\t0.310s");

    const result = await filterOutput({ raw: lines.join("\n"), mode: "balanced" });

    // Band guard: light delivers every chunk, so the dropped count can only
    // come from the parser's own omissions.
    expect(result.decision).toBe("light");

    const delivered = [result.summary, ...result.excerpts.map((e) => e.text)].join("\n");
    expect(delivered).toContain(
      "[50 passing test blocks, 3 preamble lines omitted — recoverable via stored chunks]",
    );
    // 50 omitted blocks + 1 preamble segment.
    expect(result.summary).toContain("51 dropped");
  });
});
