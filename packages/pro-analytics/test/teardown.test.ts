import { describe, expect, it } from "vitest";
import { composeTeardown, renderTeardownCardSvg, renderTeardownMarkdown } from "../src/teardown.js";

// tokensFromBytes is ceil(bytes/4); INPUT_PRICE_PER_MTOK_USD = 3.0.
function ev(
  i: number,
  over: Partial<{
    sourceKind: string;
    label: string;
    rawBytes: number;
    returnedBytes: number;
    bytesSaved: number;
  }> = {},
) {
  const returnedBytes = over.returnedBytes ?? 1_000;
  const bytesSaved = over.bytesSaved ?? 0;
  return {
    id: `e${i}`,
    sessionId: "s1",
    projectId: "p1",
    createdAt: "2026-07-05T00:00:00.000Z",
    sourceKind: over.sourceKind ?? "file",
    label: over.label ?? "read",
    rawBytes: over.rawBytes ?? returnedBytes + bytesSaved,
    returnedBytes,
    bytesSaved,
    savingRatio: 0,
    summary: "",
    mode: "safe",
  } as never;
}

function events(n: number, over: Parameters<typeof ev>[1] = {}) {
  return Array.from({ length: n }, (_, i) => ev(i, over));
}

const SAVER_ON = { enabled: true, mode: "balanced" as const };

describe("composeTeardown — culprits", () => {
  it("computes per-turn averages and sorts by returned share desc", () => {
    // fetch: 4 × 40_000 = 160_000 bytes → 40_000 tokens → avg 10_000/turn.
    // file: 10 × 4_000 = 40_000 bytes → 10_000 tokens → avg 1_000/turn.
    const mixed = [
      ...events(4, { sourceKind: "fetch", returnedBytes: 40_000 }),
      ...events(10, { sourceKind: "file", returnedBytes: 4_000 }),
    ];
    const r = composeTeardown(mixed, { saver: SAVER_ON, memoryFiles: [] });
    expect(r.culprits[0]?.key).toBe("fetch");
    expect(r.culprits[0]?.avgTokensPerTurn).toBe(10_000);
    expect(r.culprits[1]?.key).toBe("file");
    expect(r.culprits[1]?.avgTokensPerTurn).toBe(1_000);
  });

  it("caps culprits at 5", () => {
    const six = ["a", "b", "c", "d", "e", "f"].flatMap((k, idx) =>
      events(2, { sourceKind: k, returnedBytes: (idx + 1) * 1_000 }),
    );
    const r = composeTeardown(six, { saver: SAVER_ON, memoryFiles: [] });
    expect(r.culprits).toHaveLength(5);
    expect(r.culprits.map((c) => c.key)).not.toContain("a"); // smallest share dropped
  });

  it("ties in returned share break alphabetically by key", () => {
    const tied = [
      ...events(2, { sourceKind: "zeta", returnedBytes: 5_000 }),
      ...events(2, { sourceKind: "alpha", returnedBytes: 5_000 }),
    ];
    const r = composeTeardown(tied, { saver: SAVER_ON, memoryFiles: [] });
    expect(r.culprits.map((c) => c.key)).toEqual(["alpha", "zeta"]);
  });

  it("empty events → zero headline, no culprits, no NaN", () => {
    const r = composeTeardown([], { saver: SAVER_ON, memoryFiles: [] });
    expect(r.culprits).toHaveLength(0);
    expect(r.savedTokens).toBe(0);
    expect(Number.isFinite(r.savedDollars)).toBe(true);
  });
});

describe("composeTeardown — advice mapping", () => {
  it("appliable actions become the literal one-command fix", () => {
    const r = composeTeardown(events(3), { saver: null, memoryFiles: [] });
    const enable = r.advice.find((a) => a.title.includes("Token saver is off"));
    expect(enable?.command).toBe("mega savings fix --apply");
  });

  it("advice actions keep their own command", () => {
    // chatty source: 20 events, no savings, dominant share → R3 fires.
    const r = composeTeardown(events(20, { returnedBytes: 10_000 }), {
      saver: SAVER_ON,
      memoryFiles: [],
    });
    const route = r.advice.find((a) => a.command?.includes("mega tools add"));
    expect(route).toBeDefined();
  });
});

describe("renderTeardownMarkdown", () => {
  it("renders all six fixed headings, (est.) labels, and the $3 methodology line", () => {
    const md = renderTeardownMarkdown(
      composeTeardown(events(20, { returnedBytes: 10_000 }), {
        saver: SAVER_ON,
        memoryFiles: [],
      }),
    );
    for (const h of [
      "# Where the tokens went — a Mega Saver teardown",
      "## The bill",
      "## The culprits",
      "## What Mega Saver clawed back",
      "## The treatments",
      "## Methodology",
    ]) {
      expect(md).toContain(h);
    }
    expect(md).toContain("(est.)");
    expect(md).toContain("$3");
    expect(md).toContain("| file |");
  });

  it("zero events → honest empty lines instead of tables", () => {
    const md = renderTeardownMarkdown(composeTeardown([], { saver: SAVER_ON, memoryFiles: [] }));
    expect(md).toContain("No recorded events yet");
    expect(md).not.toContain("| file |");
  });

  it("all-zero-returned events → bill, culprits, and svg card agree on the empty state", () => {
    const report = composeTeardown(
      events(5, { returnedBytes: 0, rawBytes: 5_000, bytesSaved: 5_000 }),
      { saver: SAVER_ON, memoryFiles: [] },
    );
    const md = renderTeardownMarkdown(report);
    expect(md).toContain("No recorded events yet");
    expect(md).not.toContain("| source |");
    const svg = renderTeardownCardSvg(report);
    expect(svg).toContain("no recorded events yet");
    expect(svg).not.toContain("tokens/turn");
  });
});

describe("privacy sweep — hostile inputs never leak", () => {
  const HOSTILE_LABEL = "/Users/secret-project/passwords.txt</svg><script>alert(1)</script>";

  it("labels, paths and markup never appear in md or svg", () => {
    const report = composeTeardown(events(25, { label: HOSTILE_LABEL, returnedBytes: 10_000 }), {
      saver: null,
      memoryFiles: [{ path: "CLAUDE.md", bytes: 20_000 }],
    });
    const md = renderTeardownMarkdown(report);
    const svg = renderTeardownCardSvg(report);
    for (const out of [md, svg]) {
      expect(out).not.toContain("secret-project");
      expect(out).not.toContain("passwords");
      expect(out).not.toContain("<script>");
    }
  });

  it("a memory-file advice title shows only the basename, never the directory", () => {
    const report = composeTeardown(events(3), {
      saver: SAVER_ON,
      memoryFiles: [{ path: "/Users/victim/secret-proj/CLAUDE.md", bytes: 20_000 }],
    });
    const md = renderTeardownMarkdown(report);
    expect(md).not.toContain("secret-proj");
    expect(md).toContain("CLAUDE.md");
  });

  it("a hostile sourceKind is XML-escaped in the SVG (defense in depth)", () => {
    const report = composeTeardown(events(3, { sourceKind: '<x>&"evil"' }), {
      saver: SAVER_ON,
      memoryFiles: [],
    });
    const svg = renderTeardownCardSvg(report);
    expect(svg).not.toContain('<x>&"evil"');
    expect(svg).toContain("&lt;x&gt;&amp;&quot;evil&quot;");
  });
});

describe("renderTeardownCardSvg", () => {
  it("is a well-formed svg with the big number and top culprit", () => {
    const svg = renderTeardownCardSvg(
      composeTeardown(events(4, { sourceKind: "fetch", returnedBytes: 40_000 }), {
        saver: SAVER_ON,
        memoryFiles: [],
      }),
    );
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg).toContain("fetch");
    expect(svg).toContain("tokens/turn");
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
  });
});
