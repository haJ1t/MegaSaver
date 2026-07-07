# `mega teardown` (Pro module 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A gated top-level `mega teardown` command that composes a share-safe waste exposé from recorded events and writes `teardown.md` + `teardown.svg` behind an exists-guard.

**Architecture:** Sixth proprietary pure-fn module in `@megasaver/pro-analytics` (`composeTeardown` reusing `computeWasteHeadline`/`computeWasteBreakdown`/`computeFixPlan`, plus two pure renderers) + a CLI command mirroring the m1–m5 shape (entitlement gate FIRST, lazy import, injected fs). Privacy by construction: only the closed `sourceKind` union, fixed literals, and numbers ever render.

**Tech Stack:** TypeScript strict ESM, Vitest, Citty. Spec: `docs/superpowers/specs/2026-07-07-teardown-design.md` (risk MEDIUM).

**Execution notes:**
- Feature worktree, branch `feat/cli-teardown`.
- Fresh-worktree traps (hit twice before): build the gui bridge before full CLI suites (`pnpm --filter @megasaver/gui build`) and rebuild pro-analytics dist before CLI tests that import new exports (`pnpm --filter @megasaver/pro-analytics build`).
- `tokensFromBytes = ceil(bytes/4)`; `INPUT_PRICE_PER_MTOK_USD = 3.0`.
- Module 5 exports reused here: `computeFixPlan`, `FixSaverState`, `FixMemoryFile` (pro-analytics); `defaultSaverReader`, `defaultMemoryFileReader`, `FixSaverReader`, `FixMemoryFileReader` (from `apps/cli/src/commands/savings/index.js`).

---

### Task 1: `composeTeardown` + renderers (TDD)

**Files:**
- Create: `packages/pro-analytics/test/teardown.test.ts`
- Create: `packages/pro-analytics/src/teardown.ts`
- Modify: `packages/pro-analytics/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/pro-analytics/test/teardown.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  composeTeardown,
  renderTeardownCardSvg,
  renderTeardownMarkdown,
} from "../src/teardown.js";

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
});

describe("privacy sweep — hostile inputs never leak", () => {
  const HOSTILE_LABEL = '/Users/secret-project/passwords.txt</svg><script>alert(1)</script>';

  it("labels, paths and markup never appear in md or svg", () => {
    const report = composeTeardown(
      events(25, { label: HOSTILE_LABEL, returnedBytes: 10_000 }),
      { saver: null, memoryFiles: [{ path: "CLAUDE.md", bytes: 20_000 }] },
    );
    const md = renderTeardownMarkdown(report);
    const svg = renderTeardownCardSvg(report);
    for (const out of [md, svg]) {
      expect(out).not.toContain("secret-project");
      expect(out).not.toContain("passwords");
      expect(out).not.toContain("<script>");
    }
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/pro-analytics exec vitest run test/teardown.test.ts`
Expected: FAIL — cannot resolve `../src/teardown.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/pro-analytics/src/teardown.ts`:

```ts
import { INPUT_PRICE_PER_MTOK_USD, type TokenSaverEvent, tokensFromBytes } from "@megasaver/stats";
import { type FixMemoryFile, type FixSaverState, computeFixPlan } from "./fix.js";
import { type WasteHeadline, computeWasteBreakdown, computeWasteHeadline } from "./insights.js";

export interface TeardownCulprit {
  key: string;
  events: number;
  tokensReturned: number;
  avgTokensPerTurn: number;
  dollarsReturned: number;
  returnedShare: number;
}

export interface TeardownAdvice {
  title: string;
  command: string | null;
}

export interface TeardownReport {
  headline: WasteHeadline;
  savedTokens: number;
  savedDollars: number;
  culprits: TeardownCulprit[];
  advice: TeardownAdvice[];
}

const TOP_CULPRITS = 5;

function dollarsFromTokens(tokens: number): number {
  return (tokens / 1_000_000) * INPUT_PRICE_PER_MTOK_USD;
}

export function composeTeardown(
  events: readonly TokenSaverEvent[],
  opts: { saver: FixSaverState | null; memoryFiles: readonly FixMemoryFile[] },
): TeardownReport {
  const headline = computeWasteHeadline(events);
  const savedTokens = tokensFromBytes(headline.totalBytesSaved);
  const culprits = computeWasteBreakdown(events, { by: "source" })
    .sort((a, b) => b.returnedShare - a.returnedShare || (a.key < b.key ? -1 : 1))
    .slice(0, TOP_CULPRITS)
    .map((r) => ({
      key: r.key,
      events: r.events,
      tokensReturned: r.tokensReturned,
      avgTokensPerTurn: Math.round(r.tokensReturned / r.events),
      dollarsReturned: r.dollarsReturned,
      returnedShare: r.returnedShare,
    }));
  // The exposé's treatment list ends with the one-command fix: appliable
  // actions collapse to `mega savings fix --apply`; advice keeps its command.
  const advice = computeFixPlan(events, opts).actions.map((a) => ({
    title: a.title,
    command: a.appliable ? "mega savings fix --apply" : a.command,
  }));
  return {
    headline,
    savedTokens,
    savedDollars: dollarsFromTokens(savedTokens),
    culprits,
    advice,
  };
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function money(n: number): string {
  return `$${n.toFixed(2)} (est.)`;
}

function compactTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

export function renderTeardownMarkdown(report: TeardownReport): string {
  const lines: string[] = [];
  lines.push("# Where the tokens went — a Mega Saver teardown");
  lines.push("");
  lines.push(
    "> Generated by `mega teardown` · figures are measured from this workspace's recorded tool events, not modeled",
  );
  lines.push("");
  lines.push("## The bill");
  lines.push("");
  if (report.headline.totalReturnedBytes === 0) {
    lines.push("No recorded events yet — run some sessions with the saver active and come back.");
  } else {
    lines.push(
      `Tool output returned into context: **${compactTokens(report.headline.tokensReturned)} tokens ≈ ${money(report.headline.dollarsReturned)}**.`,
    );
  }
  lines.push("");
  lines.push("## The culprits");
  lines.push("");
  if (report.culprits.length === 0) {
    lines.push("No recorded events yet.");
  } else {
    lines.push("| source | events | avg tokens/turn | share | $ (est.) |");
    lines.push("|---|---|---|---|---|");
    for (const c of report.culprits) {
      lines.push(
        `| ${c.key} | ${c.events} | ~${compactTokens(c.avgTokensPerTurn)} | ${pct(c.returnedShare)} | ${money(c.dollarsReturned)} |`,
      );
    }
  }
  lines.push("");
  lines.push("## What Mega Saver clawed back");
  lines.push("");
  lines.push(
    `**${compactTokens(report.savedTokens)} tokens ≈ ${money(report.savedDollars)}** never reached the context window (evidence-preserving compression — the originals stay recoverable).`,
  );
  lines.push("");
  lines.push("## The treatments");
  lines.push("");
  if (report.advice.length === 0) {
    lines.push("Nothing to fix — this workspace is already tight.");
  } else {
    for (const a of report.advice) {
      lines.push(a.command === null ? `- ${a.title}` : `- ${a.title} — \`${a.command}\``);
    }
  }
  lines.push("");
  lines.push("## Methodology");
  lines.push("");
  lines.push(
    `Dollar figures use a flat $${INPUT_PRICE_PER_MTOK_USD}/MTok input price and are estimates. Token counts are byte-derived (≈4 bytes/token) from locally recorded events. Sources are generic kinds — no paths, project names, or file contents appear in this document.`,
  );
  lines.push("");
  return lines.join("\n");
}

// XML-escape replicated from stats' savings-card (not exported there); a
// culprit key crosses into SVG text nodes, so metacharacters must not break
// the document.
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const GROUND = "#f6f5f2";
const INK = "#17181a";
const MUTED = "#6b6c70";
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function renderTeardownCardSvg(report: TeardownReport): string {
  const top = report.culprits[0];
  const topLine = top
    ? `${top.key} · ~${compactTokens(top.avgTokensPerTurn)} tokens/turn`
    : "no recorded events yet";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">`,
    `  <rect width="1200" height="630" fill="${GROUND}"/>`,
    `  <text x="80" y="120" font-family="${FONT}" font-size="28" fill="${MUTED}">Where the tokens went — a Mega Saver teardown</text>`,
    `  <text x="80" y="300" font-family="${FONT}" font-size="120" font-weight="700" fill="${INK}">${esc(money(report.headline.dollarsReturned))}</text>`,
    `  <text x="80" y="360" font-family="${FONT}" font-size="30" fill="${MUTED}">returned into context · ${esc(compactTokens(report.headline.tokensReturned))} tokens</text>`,
    `  <text x="80" y="440" font-family="${FONT}" font-size="30" fill="${INK}">top culprit: ${esc(topLine)}</text>`,
    `  <text x="80" y="520" font-family="${FONT}" font-size="26" fill="${MUTED}">clawed back: ${esc(compactTokens(report.savedTokens))} tokens ≈ ${esc(money(report.savedDollars))}</text>`,
    `  <text x="80" y="580" font-family="${FONT}" font-size="20" fill="${MUTED}">measured, not modeled · generated by mega teardown</text>`,
    `</svg>`,
    "",
  ].join("\n");
}
```

Append to `packages/pro-analytics/src/index.ts`:

```ts
export {
  type TeardownAdvice,
  type TeardownCulprit,
  type TeardownReport,
  composeTeardown,
  renderTeardownCardSvg,
  renderTeardownMarkdown,
} from "./teardown.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/pro-analytics exec vitest run test/teardown.test.ts`
Expected: PASS.

- [ ] **Step 5: Full package suite + gates**

Run: `pnpm --filter @megasaver/pro-analytics test && pnpm --filter @megasaver/pro-analytics typecheck && pnpm lint`
Expected: all green (no regressions in the 6 existing suites).

- [ ] **Step 6: Commit**

```bash
git add packages/pro-analytics/src/teardown.ts packages/pro-analytics/src/index.ts packages/pro-analytics/test/teardown.test.ts
git commit -m "feat(pro-analytics): composeTeardown + md/svg renderers"
```

---

### Task 2: gated `runTeardown` CLI (TDD)

**Files:**
- Create: `apps/cli/test/commands/teardown.test.ts`
- Create: `apps/cli/src/commands/teardown.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/commands/teardown.test.ts` (harness mirrors
`apps/cli/test/commands/savings-fix.test.ts`):

```ts
import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TokenSaverEvent } from "@megasaver/core";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runTeardown } from "../../src/commands/teardown.js";
import type { SavingsEventReader } from "../../src/commands/savings/index.js";

const proSpies = vi.hoisted(() => ({ composeTeardown: vi.fn() }));

vi.mock("@megasaver/pro-analytics", async (importActual) => {
  const actual = await importActual<typeof import("@megasaver/pro-analytics")>();
  proSpies.composeTeardown.mockImplementation(actual.composeTeardown);
  return { ...actual, composeTeardown: proSpies.composeTeardown };
});

type Payload = { v: number; tier: string; id: string; iat: number; exp: number | null };

const b64url = (buf: Buffer): string => buf.toString("base64url");

function signTestLicense(privateKey: KeyObject, payload: Payload): string {
  const payloadBytes = Buffer.from(JSON.stringify(payload));
  const sig = sign(null, payloadBytes, privateKey);
  return `msp_${b64url(payloadBytes)}.${b64url(sig)}`;
}

const NOW_MS = 1_700_000_000_000;
const now = () => NOW_MS;

function event(i: number, returnedBytes: number): TokenSaverEvent {
  return {
    id: `e-${i}`,
    sessionId: "sess-1" as TokenSaverEvent["sessionId"],
    projectId: "proj-1" as TokenSaverEvent["projectId"],
    createdAt: "2023-11-05T00:00:00.000Z",
    sourceKind: "file",
    label: "read",
    rawBytes: returnedBytes,
    returnedBytes,
    bytesSaved: 0,
    savingRatio: 0,
    summary: "s",
    mode: "balanced",
  };
}

const tdEvents: TokenSaverEvent[] = Array.from({ length: 25 }, (_, i) => event(i, 100_000));

function tdReader(): SavingsEventReader {
  return () => ({ events: tdEvents, eventsByProject: { "proj-1": tdEvents } });
}

let root: string;
let outDir: string;
let keys: ReturnType<typeof generateKeyPairSync>;
let out: string[];
let err: string[];
const stdout = (l: string) => out.push(l);
const stderr = (l: string) => err.push(l);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-td-"));
  outDir = mkdtempSync(join(tmpdir(), "megasaver-td-out-"));
  keys = generateKeyPairSync("ed25519");
  out = [];
  err = [];
  proSpies.composeTeardown.mockClear();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outDir, { recursive: true, force: true });
});

function activatePro(): void {
  const key = signTestLicense(keys.privateKey, {
    v: 1,
    tier: "pro",
    id: "cust-1",
    iat: 0,
    exp: null,
  });
  const res = activateLicense(root, key, { publicKey: keys.publicKey, now });
  expect(res.ok).toBe(true);
}

function baseInput(over: Partial<Parameters<typeof runTeardown>[0]> = {}) {
  const written = new Map<string, string>();
  return {
    input: {
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: tdReader(),
      readSaver: () => ({ enabled: true, mode: "balanced" as const }),
      readMemoryFileSizes: () => [],
      outDir,
      writeFile: (p: string, c: string) => void written.set(p, c),
      fileExists: () => false,
      stdout,
      stderr,
      ...over,
    },
    written,
  };
}

describe("runTeardown — gating", () => {
  it.each([{}, { json: true }, { force: true }])(
    "with NO license (%o): upsell, exit 0, nothing read/computed/written",
    async (flags) => {
      const readAllEvents = vi.fn(tdReader());
      const readSaver = vi.fn(() => null);
      const readMemoryFileSizes = vi.fn(() => []);
      const writeFile = vi.fn();

      const { input } = baseInput({
        readAllEvents,
        readSaver,
        readMemoryFileSizes,
        writeFile,
        ...flags,
      });
      const code = await runTeardown(input);

      expect(code).toBe(0);
      const text = out.join("\n");
      expect(text).toContain("Mega Saver Pro");
      expect(text).toContain("mega license activate");
      expect(readAllEvents).not.toHaveBeenCalled();
      expect(readSaver).not.toHaveBeenCalled();
      expect(readMemoryFileSizes).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
      expect(proSpies.composeTeardown).not.toHaveBeenCalled();
    },
  );
});

describe("runTeardown — entitled", () => {
  beforeEach(() => activatePro());

  it("--json emits the report and writes NO files", async () => {
    const writeFile = vi.fn();
    const { input } = baseInput({ json: true, writeFile });
    const code = await runTeardown(input);

    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("\n")) as {
      headline: { tokensReturned: number };
      culprits: unknown[];
      advice: unknown[];
    };
    expect(parsed.headline.tokensReturned).toBeGreaterThan(0);
    expect(Array.isArray(parsed.culprits)).toBe(true);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("file mode writes both artifacts and prints their paths", async () => {
    const { input, written } = baseInput();
    const code = await runTeardown(input);

    expect(code).toBe(0);
    const paths = [...written.keys()];
    expect(paths).toHaveLength(2);
    expect(paths.some((p) => p.endsWith("teardown.md"))).toBe(true);
    expect(paths.some((p) => p.endsWith("teardown.svg"))).toBe(true);
    const md = written.get(join(outDir, "teardown.md")) ?? "";
    expect(md).toContain("## The culprits");
    expect(md).toContain("| file |");
    const svg = written.get(join(outDir, "teardown.svg")) ?? "";
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(out.join("\n")).toContain("teardown.md");
  });

  it("exists-guard refuses without --force and writes NEITHER file", async () => {
    const writeFile = vi.fn();
    const { input } = baseInput({
      writeFile,
      fileExists: (p: string) => p.endsWith("teardown.md"),
    });
    const code = await runTeardown(input);

    expect(code).toBe(1);
    expect(err.join("\n")).toContain("--force");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("--force overwrites existing artifacts", async () => {
    const { input, written } = baseInput({ force: true, fileExists: () => true });
    const code = await runTeardown(input);

    expect(code).toBe(0);
    expect(written.size).toBe(2);
  });

  it("real fs round-trip via the default writers", async () => {
    const { defaultTeardownFs } = await import("../../src/commands/teardown.js");
    const fs = defaultTeardownFs();
    const { input } = baseInput({ writeFile: fs.writeFile, fileExists: fs.fileExists });
    const code = await runTeardown(input);

    expect(code).toBe(0);
    expect(readFileSync(join(outDir, "teardown.md"), "utf8")).toContain("Methodology");
    expect(readFileSync(join(outDir, "teardown.svg"), "utf8")).toContain("</svg>");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/cli exec vitest run test/commands/teardown.test.ts`
Expected: FAIL — cannot resolve `../../src/commands/teardown.js`.
(Rebuild pro-analytics dist first if Task 1's exports are missing:
`pnpm --filter @megasaver/pro-analytics build`.)

- [ ] **Step 3: Write minimal implementation**

Create `apps/cli/src/commands/teardown.ts`:

```ts
import type { KeyObject } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkEntitlement } from "@megasaver/entitlement";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../store.js";
import {
  type FixMemoryFileReader,
  type FixSaverReader,
  PRO_ANALYTICS_URL,
  type SavingsEventReader,
  defaultMemoryFileReader,
  defaultSaverReader,
  defaultSavingsEventReader,
} from "./savings/index.js";

// teardown-specific upsell: the shared string says "historical savings
// analytics", which would misname this feature. Same activation mechanics.
export const TEARDOWN_UPSELL = `The waste teardown is a Mega Saver Pro feature. Activate a key: mega license activate <key>. Learn more: ${PRO_ANALYTICS_URL}.`;

export type TeardownWriteFile = (path: string, content: string) => void;
export type TeardownFileExists = (path: string) => boolean;

export function defaultTeardownFs(): {
  writeFile: TeardownWriteFile;
  fileExists: TeardownFileExists;
} {
  return {
    writeFile: (path, content) => writeFileSync(path, content),
    fileExists: (path) => existsSync(path),
  };
}

export type RunTeardownInput = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
  readAllEvents: SavingsEventReader;
  readSaver: FixSaverReader;
  readMemoryFileSizes: FixMemoryFileReader;
  outDir: string;
  force?: boolean;
  json?: boolean;
  writeFile: TeardownWriteFile;
  fileExists: TeardownFileExists;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runTeardown(input: RunTeardownInput): Promise<0 | 1> {
  // The entitlement gate runs FIRST — on the free path nothing is read,
  // composed, or written, whatever flags are set (spy-enforced).
  const ent = checkEntitlement("savings-analytics", {
    storeRoot: input.storeRoot,
    now: input.now,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });
  if (!ent.entitled) {
    input.stdout(TEARDOWN_UPSELL);
    return 0;
  }

  const { composeTeardown, renderTeardownCardSvg, renderTeardownMarkdown } = await import(
    "@megasaver/pro-analytics"
  );
  const { events } = await input.readAllEvents();
  const report = composeTeardown(events, {
    saver: input.readSaver(),
    memoryFiles: input.readMemoryFileSizes(),
  });

  if (input.json) {
    input.stdout(JSON.stringify(report));
    return 0;
  }

  const mdPath = join(input.outDir, "teardown.md");
  const svgPath = join(input.outDir, "teardown.svg");
  // Check BOTH before writing EITHER: a partial exposé is worse than none.
  const existing = [mdPath, svgPath].filter((p) => input.fileExists(p));
  if (existing.length > 0 && input.force !== true) {
    input.stderr(`refusing to overwrite ${existing.join(", ")} (use --force)`);
    return 1;
  }

  input.writeFile(mdPath, renderTeardownMarkdown(report));
  input.writeFile(svgPath, renderTeardownCardSvg(report));
  input.stdout(`wrote ${mdPath}`);
  input.stdout(`wrote ${svgPath}`);
  input.stdout("Share-safe by construction: generic source names and numbers only.");
  return 0;
}

export const teardownCommand = defineCommand({
  meta: {
    name: "teardown",
    description: "Compose a share-safe waste exposé (md + SVG card) from recorded events (Mega Saver Pro).",
  },
  args: {
    out: { type: "string", description: "Output directory (default: current directory)." },
    force: { type: "boolean", default: false, description: "Overwrite existing teardown files." },
    json: { type: "boolean", default: false, description: "Emit the report as JSON (no files)." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeInput = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    const storeRoot = resolveStorePath(storeInput);
    const cwd = process.cwd();
    const fs = defaultTeardownFs();
    const code = await runTeardown({
      storeRoot,
      now: () => Date.now(),
      readAllEvents: defaultSavingsEventReader(storeInput),
      readSaver: defaultSaverReader(storeRoot, cwd),
      readMemoryFileSizes: defaultMemoryFileReader(cwd),
      outDir: typeof args.out === "string" ? resolve(args.out) : cwd,
      force: !!args.force,
      json: !!args.json,
      writeFile: fs.writeFile,
      fileExists: fs.fileExists,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/cli exec vitest run test/commands/teardown.test.ts`
Expected: PASS (3 gating variants + 5 entitled tests).

- [ ] **Step 5: Gates**

Run: `pnpm --filter @megasaver/cli typecheck && pnpm lint`
Expected: exit 0 (both tsc halves; biome clean).

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/teardown.ts apps/cli/test/commands/teardown.test.ts
git commit -m "feat(cli): mega teardown — share-safe waste exposé (gated)"
```

---

### Task 3: register + README + changeset

**Files:**
- Modify: `apps/cli/src/main.ts` (import + subCommands, alphabetical)
- Modify: `README.md` (command table + Pro section)
- Create: `.changeset/teardown.md`

- [ ] **Step 1: Register** — in `apps/cli/src/main.ts` add
`import { teardownCommand } from "./commands/teardown.js";` in import order,
and `teardown: teardownCommand,` in `subCommands` (alphabetical slot).

- [ ] **Step 2: README** — command-table row after the `mega savings` rows:

```md
| `mega teardown` | share-safe waste exposé — md + SVG card (Pro) |
```

Pro code block, after the `mega savings fix` lines:

```sh

mega teardown                     # publish-ready waste exposé (Pro)
mega teardown --out ./posts --force
```

Bullet after the `mega savings fix` bullet:

```md
- `mega teardown [--out <dir>] [--force]` — composes a publish-ready exposé
  (`teardown.md` + `teardown.svg`): the bill, per-source per-turn averages,
  what Mega Saver clawed back, and the treatments. Share-safe by
  construction — generic source names and numbers only, never paths or
  project names. Refuses to overwrite existing files without `--force`.
```

- [ ] **Step 3: Changeset** — create `.changeset/teardown.md`:

```md
---
"@megasaver/cli": minor
---

`mega teardown` — composes a publish-ready, share-safe waste exposé
(markdown + SVG card) from the workspace's recorded events: the bill,
per-source per-turn averages, what was clawed back, and the treatments.
```

- [ ] **Step 4: Full CLI suite + build check**

Run: `pnpm --filter @megasaver/cli exec vitest run` (build gui bridge first
if fresh) and `pnpm --filter @megasaver/cli build && node apps/cli/dist/cli.js --help | grep teardown`
Expected: suite green; help lists `teardown`.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/main.ts README.md .changeset/teardown.md
git commit -m "feat(cli): register mega teardown + README + changeset"
```

---

### Task 4: verification + smoke + reviews

- [ ] **Step 1:** `TURBO_FORCE=true pnpm verify` → all green.

- [ ] **Step 2: E2E smoke** (temp store + temp out dir; test license via
`node scripts/license/issue.mjs <id> --exp <tomorrow> --priv /Users/halitozger/Desktop/MegaSaver/scripts/license/.private-key.pem`;
never print the key):
free → upsell; activate → `mega teardown --out <tmp>` → both files exist,
md has the six headings; re-run → exists-guard exit 1; `--force` → ok;
`--json` → valid report.

- [ ] **Step 3: Reviews** — per-task spec+quality already run task-by-task;
finish with the 3-lens holistic final (code-reviewer + adversarial critic +
honesty/docs — the critic attacks the privacy sweep and the exists-guard),
then `superpowers:finishing-a-development-branch`.
