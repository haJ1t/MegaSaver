import { describe, expect, it } from "vitest";
import { type BenchPass, composeBenchReport, renderBenchMarkdown } from "../src/bench.js";

function pass(over: Partial<BenchPass> = {}): BenchPass {
  return {
    kind: "raw",
    exitCode: 0,
    wallMs: 1_000,
    rawBytes: 4_000_000,
    returnedBytes: null,
    savingRatio: null,
    signal: "vitest",
    ...over,
  };
}

const RAW = pass();
const SAVER = pass({
  kind: "saver",
  wallMs: 1_200,
  returnedBytes: 400_000,
  savingRatio: 0.9,
});

describe("composeBenchReport — parity matrix", () => {
  it("everything matches → ok", () => {
    const r = composeBenchReport("pnpm test", RAW, SAVER);
    expect(r.parity).toEqual({ exitMatch: true, signalMatch: true, ok: true, note: null });
  });

  it("exit differs → broken with nondeterminism note", () => {
    const r = composeBenchReport("pnpm test", RAW, pass({ ...SAVER, exitCode: 1 }));
    expect(r.parity.exitMatch).toBe(false);
    expect(r.parity.ok).toBe(false);
    expect(r.parity.note).toContain("nondeterministic");
  });

  it("signal differs → broken", () => {
    const r = composeBenchReport("pnpm test", RAW, pass({ ...SAVER, signal: "typescript" }));
    expect(r.parity.signalMatch).toBe(false);
    expect(r.parity.ok).toBe(false);
  });

  it("both signals unknown → exit-code-only parity with honesty note", () => {
    const r = composeBenchReport(
      "some-tool",
      pass({ signal: null }),
      pass({ ...SAVER, signal: null }),
    );
    expect(r.parity.signalMatch).toBeNull();
    expect(r.parity.ok).toBe(true);
    expect(r.parity.note).toContain("exit code only");
  });

  it("one unknown, one known → signalMatch false, broken", () => {
    const r = composeBenchReport("pnpm test", pass({ signal: null }), SAVER);
    expect(r.parity.signalMatch).toBe(false);
    expect(r.parity.ok).toBe(false);
  });

  it("either pass incomplete (exitCode null) → no parity claim", () => {
    const r = composeBenchReport("pnpm test", pass({ exitCode: null }), SAVER);
    expect(r.parity.ok).toBe(false);
    expect(r.parity.note).toContain("did not complete");
  });
});

describe("composeBenchReport — math", () => {
  it("token and dollar math from bytes", () => {
    const r = composeBenchReport("pnpm test", RAW, SAVER);
    expect(r.tokensRaw).toBe(1_000_000); // ceil(4_000_000/4)
    expect(r.tokensReturned).toBe(100_000); // ceil(400_000/4)
    expect(r.tokensSaved).toBe(900_000);
    expect(r.dollarsSaved).toBeCloseTo(2.7); // 900k tokens at $3/MTok
  });

  it("overhead incl. negative, and raw.wallMs=0 guard", () => {
    const r = composeBenchReport("x", RAW, SAVER);
    expect(r.overheadMs).toBe(200);
    expect(r.overheadPct).toBeCloseTo(0.2);
    const faster = composeBenchReport("x", RAW, pass({ ...SAVER, wallMs: 900 }));
    expect(faster.overheadMs).toBe(-100);
    const zero = composeBenchReport("x", pass({ wallMs: 0 }), SAVER);
    expect(zero.overheadPct).toBe(0);
    expect(Number.isFinite(zero.overheadPct)).toBe(true);
  });

  it("saver pass missing returnedBytes falls back to its rawBytes (no savings claimed)", () => {
    const r = composeBenchReport("x", RAW, pass({ kind: "saver", returnedBytes: null }));
    expect(r.tokensReturned).toBe(r.tokensRaw);
    expect(r.tokensSaved).toBe(0);
  });

  it("saver returned MORE than raw → clamped to 0 with an honest savingsNote", () => {
    const r = composeBenchReport("x", RAW, pass({ ...SAVER, returnedBytes: 5_000_000 }));
    expect(r.tokensSaved).toBe(0);
    expect(r.savingsNote).toContain("more than raw");
    expect(renderBenchMarkdown(r)).toContain(
      "saver returned more than raw on this pair — no net savings",
    );
  });

  it("normal saving pair → savingsNote is null", () => {
    const r = composeBenchReport("x", RAW, SAVER);
    expect(r.savingsNote).toBeNull();
  });
});

describe("renderBenchMarkdown", () => {
  const md = renderBenchMarkdown(composeBenchReport("pnpm test --run", RAW, SAVER));

  it("renders the fixed sections, ordering disclosure, and (est.) discipline", () => {
    for (const h of [
      "# Same command, twice — a Mega Saver bench",
      "## The pair",
      "## Tokens",
      "## Time",
      "## Outcome parity",
      "## Methodology",
    ]) {
      expect(md).toContain(h);
    }
    expect(md).toContain("pnpm test --run");
    expect(md).toContain("(est.)");
    expect(md).toContain("$3");
    expect(md).toContain("raw first, then saver");
    expect(md).toContain("single pair");
    expect(md).toContain("900.0k");
    expect(md).toContain("$2.70 (est.)");
    expect(md).toContain("(20%)");
  });

  it("a signal with markdown metacharacters renders inside inline code", () => {
    const hostile = composeBenchReport(
      "x",
      pass({ signal: "weird|sig`nal`" }),
      pass({ ...SAVER, signal: "weird|sig`nal`" }),
    );
    const out = renderBenchMarkdown(hostile);
    expect(out).toContain("weird|sig");
    expect(out).not.toContain("``nal``"); // no broken fencing — renderer wraps signals predictably
  });
});
