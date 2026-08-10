# Filter Matrix Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ten new structured command filters (git-status, git-log, docker-ps, docker-build, kubectl-get, gh-pr-list, npm-install, pip-install, cargo-build, terraform-plan) in `@megasaver/output-filter`, each behind the W4 reconstruct-or-declare integrity gate, plus the registry + conformance harness + checklist that make the next 20 filters mechanical. Spec: `docs/superpowers/specs/2026-08-06-filter-matrix-expansion-design.md`.

**Architecture:** A new additive registry `packages/output-filter/src/filters/` (ordered `COMMAND_FILTERS`, first-match-wins) is consulted by `filterOutput` (`src/types.ts`) in the compressed band for command-sourced output, BEFORE the existing category-compressor eligibility check. A matched filter owns the output (safe no-op on unrecognized shape — returns input verbatim, `compressor` stays `generic`). The existing 5-category dispatch (`classify.ts` + `compressByCategory`) is untouched. Every filter is `integrity: "line-subset"`: delivered non-marker lines appear verbatim in the input; every collapse is a counted `… [<n> <label>]` marker declared on the registry entry and aggregated as `COMMAND_FILTER_MARKERS` for the W4 no-fabrication allowlist. Recovery is unconditional: context-gate persists the full redacted raw independent of the compressor (`packages/context-gate/src/record-output.ts`).

**Tech Stack:** TypeScript strict ESM, Vitest, Biome. No new dependencies.

## Global Constraints

- Append-only published contracts: new `CompressorName` members are appended after the existing last member only (`packages/output-filter/src/compress/index.ts`); `OutputCategory` is untouched; `COMMAND_FILTERS` array order is itself append-only (first-match-wins is observable).
- `src/classify.ts` is not edited. If an edit there becomes necessary, STOP — spec escalation trigger (re-classify HIGH).
- Filter modules are pure, no IO, never throw; unrecognized shape → return input verbatim. No new deps; never import `@megasaver/indexer` or `js-tiktoken` from `src/filters/` — the lazy-import guards (`test/no-eager-typescript.test.ts`, `test/tokens-real.test.ts`) must stay green (hot-path precedent).
- Marker grammar: every collapse marker is `… [<n> <label>]` (the `EVIDENCE_MARKER` prefix contract, `src/markers.ts`); declared marker regexes are anchored `^… \[` … `\]$`, flagless (no `/g` anywhere — stateless `.test`), all quantifiers bounded (no `^\s*` under `m`; see `wiki/concepts/unbounded-run-redos.md`).
- No timing-tight tests: ReDoS discipline is structural (bounded patterns), never throughput assertions.
- All fixtures are synthetic — fabricated shas/ids/image/pod names, no secrets. Redaction runs before filters (pipeline §11b), so filters only ever see redacted text.
- Per-package test configs: run tests as `pnpm --filter @megasaver/output-filter exec vitest run <file>` (context-gate likewise).
- Line-subset comparison is trim-based, matching the W4 evidence-line comparison in `packages/context-gate/test/save-integrity.property.test.ts`.
- §8: strict TS, files ≤ 300 LOC, comments only for non-obvious WHY. §10: conventional commits, subject ≤ 50 chars. `apps/cli` untouched.

---

### Task 1: Registry + conformance harness + git-status (proving filter) + wiring

**Files:**
- `packages/output-filter/src/filters/index.ts` (new)
- `packages/output-filter/src/filters/git-status.ts` (new)
- `packages/output-filter/src/compress/index.ts` (edit — append `CompressorName` member)
- `packages/output-filter/src/types.ts` (edit — wiring)
- `packages/output-filter/src/index.ts` (edit — exports)
- `packages/output-filter/test/filters/conformance.ts` (new — helper, not a test file)
- `packages/output-filter/test/filters/git-status.test.ts` (new)
- `packages/output-filter/test/filters/wiring.test.ts` (new)

**Interfaces:**

```ts
// src/filters/index.ts
export type CommandFilterIntegrity = "line-subset" | "rewrite";
export interface CommandFilter {
  name: CompressorName;
  command: RegExp;
  integrity: CommandFilterIntegrity;
  markers: readonly RegExp[];
  compress(text: string): string;
}
export const COMMAND_FILTERS: readonly CommandFilter[];
export const COMMAND_FILTER_MARKERS: readonly RegExp[];
export function matchCommandFilter(command: string): CommandFilter | undefined;
```

**Steps:**

- [ ] Write the failing tests. `packages/output-filter/test/filters/conformance.ts`:

```ts
import { expect } from "vitest";
import type { CommandFilter } from "../../src/filters/index.js";

// Shared gate every registry filter passes before it ships (spec D5/D6):
// determinism, empty-input no-op, the line-subset claim, declared-marker
// grammar, and real compression on the fixture. Returns the compressed text
// so callers add filter-specific assertions on the same output.
export function assertFilterConformance(filter: CommandFilter, fixture: string): string {
  expect(filter.integrity).toBe("line-subset");
  const out = filter.compress(fixture);
  expect(filter.compress(fixture), "filter must be deterministic").toBe(out);
  expect(filter.compress(""), "empty input must be a no-op").toBe("");
  for (const m of filter.markers) {
    expect(m.source.startsWith("^… \\["), `marker not anchored to '… [': ${m}`).toBe(true);
    expect(m.source.endsWith("\\]$"), `marker not closed: ${m}`).toBe(true);
    expect(m.flags, `marker regexes must be flagless: ${m}`).toBe("");
  }
  const inputLines = new Set(fixture.split("\n").map((l) => l.trim()));
  for (const line of out.split("\n")) {
    const t = line.trim();
    if (t === "" || inputLines.has(t)) continue;
    expect(
      filter.markers.some((m) => m.test(t)),
      `synthesized line is not a declared marker: ${JSON.stringify(line)}`,
    ).toBe(true);
  }
  expect(
    Buffer.byteLength(out, "utf8"),
    "the conformance fixture must actually compress",
  ).toBeLessThan(Buffer.byteLength(fixture, "utf8"));
  return out;
}
```

- [ ] `packages/output-filter/test/filters/git-status.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compressGitStatus } from "../../src/filters/git-status.js";
import { COMMAND_FILTERS } from "../../src/filters/index.js";
import { assertFilterConformance } from "./conformance.js";

const filter = COMMAND_FILTERS.find((f) => f.name === "git-status");
if (filter === undefined) throw new Error("git-status not registered");

const HUMAN = [
  "On branch main",
  "Your branch is up to date with 'origin/main'.",
  "",
  "Changes not staged for commit:",
  '  (use "git add <file>..." to update what will be committed)',
  '  (use "git restore <file>..." to discard changes in working directory)',
  "\tmodified:   src/index.ts",
  "\tmodified:   package.json",
  "",
  "Untracked files:",
  '  (use "git add <file>..." to include in what will be committed)',
  "\tcoverage/lcov.info",
  "",
  'no changes added to commit (use "git add" and/or "git commit -a")',
].join("\n");

const PORCELAIN = [
  "## main...origin/main [ahead 2]",
  " M src/index.ts",
  " M src/filters/git-status.ts",
  "A  src/filters/index.ts",
  ...Array.from({ length: 24 }, (_, i) => `?? dist/assets/chunk-${i}.js`),
].join("\n");

describe("git-status filter", () => {
  it("drops coaching hint lines behind a counted marker", () => {
    const out = assertFilterConformance(filter, HUMAN);
    expect(out).not.toContain('(use "git add <file>..." to update');
    expect(out).toContain("\tmodified:   src/index.ts");
    expect(out).toContain('no changes added to commit (use "git add" and/or "git commit -a")');
    expect(out).toContain("… [3 hint lines]");
  });

  it("caps a porcelain same-status run and counts the fold", () => {
    const out = assertFilterConformance(filter, PORCELAIN);
    expect(out).toContain(" M src/index.ts");
    expect(out).toContain("?? dist/assets/chunk-19.js");
    expect(out).not.toContain("?? dist/assets/chunk-20.js");
    expect(out).toContain("… [4 more ??]");
  });

  it("returns unrecognized text verbatim", () => {
    expect(compressGitStatus("plain output\nno status shape")).toBe(
      "plain output\nno status shape",
    );
  });
});
```

- [ ] `packages/output-filter/test/filters/wiring.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { filterOutput } from "../../src/index.js";

// Force the compressed band on modest fixtures (schema fields verified in
// filterOutputInputSchema): rawTokens >= 1 always lands in "compressed".
const FORCE = { passthroughThresholdTokens: 1, hardWrapThresholdTokens: 1 } as const;

const STATUS = [
  "On branch main",
  "Changes not staged for commit:",
  '  (use "git add <file>..." to update what will be committed)',
  ...Array.from({ length: 80 }, (_, i) => `\tmodified:   src/mod-${i}.ts`),
].join("\n");

describe("command-filter registry wiring", () => {
  it("registry preempts the diff category compressor for git status", async () => {
    const res = await filterOutput({
      raw: STATUS,
      mode: "balanced",
      ...FORCE,
      source: { kind: "command", command: "git", args: ["status"] },
    });
    expect(res.classification.category).toBe("diff");
    expect(res.compressor).toBe("git-status");
    // a filter rewrites lines — raw coordinates are no longer promised
    expect(res.excerpts.every((e) => e.rawStartLine === undefined)).toBe(true);
  });

  it("passthrough band never invokes a filter", async () => {
    const res = await filterOutput({
      raw: "On branch main\nnothing to commit, working tree clean",
      mode: "balanced",
      source: { kind: "command", command: "git", args: ["status"] },
    });
    expect(res.decision).toBe("passthrough");
    expect(res.compressor).toBe("generic");
  });
});
```

- [ ] RED: `pnpm --filter @megasaver/output-filter exec vitest run test/filters/git-status.test.ts test/filters/wiring.test.ts` — expect FAIL (modules missing).
- [ ] Append to the `CompressorName` union in `packages/output-filter/src/compress/index.ts` (append-only, after `"generic"`): `| "git-status"`.
- [ ] Implement `packages/output-filter/src/filters/git-status.ts`:

```ts
const HINT = /^ {0,8}\(use "git [^"\n]{1,120}"[^)\n]{0,80}\)$/;
const PORCELAIN = /^[ MADRCU?!]{2} \S/;
const MAX_PER_STATUS = 20;

// Human format: the `(use "git …")` coaching lines are pure boilerplate — the
// agent knows git. Porcelain: a same-status run past the cap is inventory,
// not evidence; the cap keeps the head and counts the rest.
export function compressGitStatus(text: string): string {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const out: string[] = [];
  let hints = 0;
  let runCode = "";
  let run: string[] = [];
  const flushRun = (): void => {
    out.push(...run.slice(0, MAX_PER_STATUS));
    if (run.length > MAX_PER_STATUS) {
      out.push(`… [${run.length - MAX_PER_STATUS} more ${runCode.trim()}]`);
    }
    run = [];
    runCode = "";
  };
  for (const line of lines) {
    if (HINT.test(line)) {
      hints += 1;
      continue;
    }
    const code = PORCELAIN.test(line) ? line.slice(0, 2) : "";
    if (code !== "" && code === runCode) {
      run.push(line);
      continue;
    }
    flushRun();
    if (code !== "") {
      runCode = code;
      run = [line];
      continue;
    }
    out.push(line);
  }
  flushRun();
  if (hints > 0) out.push(`… [${hints} hint lines]`);
  return out.join("\n");
}
```

- [ ] Implement `packages/output-filter/src/filters/index.ts`:

```ts
import type { CompressorName } from "../compress/index.js";
import { compressGitStatus } from "./git-status.js";

export type CommandFilterIntegrity = "line-subset" | "rewrite";

export interface CommandFilter {
  name: CompressorName;
  command: RegExp;
  integrity: CommandFilterIntegrity;
  // The exact structural forms this filter may synthesize. Declared at the
  // emitter and consumed by both the conformance harness and the W4
  // no-fabrication allowlist, so the two can never drift apart.
  markers: readonly RegExp[];
  compress(text: string): string;
}

// Ordered, first-match-wins; the order is append-only (observable contract).
export const COMMAND_FILTERS: readonly CommandFilter[] = [
  {
    name: "git-status",
    command: /\bgit\s+status\b/,
    integrity: "line-subset",
    markers: [/^… \[\d+ more [MADRCU?!]{1,2}\]$/, /^… \[\d+ hint lines\]$/],
    compress: compressGitStatus,
  },
];

export const COMMAND_FILTER_MARKERS: readonly RegExp[] = COMMAND_FILTERS.flatMap(
  (f) => f.markers,
);

export function matchCommandFilter(command: string): CommandFilter | undefined {
  return COMMAND_FILTERS.find((f) => f.command.test(command));
}
```

- [ ] Wire into `packages/output-filter/src/types.ts`. Add `import { matchCommandFilter } from "./filters/index.js";` to the imports. Replace the compressor-eligibility block (verified anchors: `let compressor: CompressorName = "generic";` … through the `if (compressorEligible) { … }` close) with:

```ts
  let compressor: CompressorName = "generic";
  let textForChunks = normalized;
  const isFileSource = source?.kind === "file";
  // Registry precedence (spec D2/D3): a matched command filter owns the
  // output and never falls back to a category compressor — its own shape
  // guard already chose between compressing and the verbatim no-op.
  const commandFilter =
    decision === "compressed" && command !== undefined ? matchCommandFilter(command) : undefined;
  // Source-code file reads route to semantic AST chunking, not a category
  // compressor. The structured (JSON) compressor is exempt: a *.json read is
  // exactly its target, and semantic chunking ignores non-code files anyway.
  const compressorEligible =
    commandFilter === undefined &&
    decision === "compressed" &&
    (!isFileSource || classification.category === "structured") &&
    isConfidentClassification(classification);
  let provenance: LineSpan[] | null = normalizedSpans;
  let commandFilterApplied = false;
  if (commandFilter !== undefined) {
    const compressed = commandFilter.compress(normalized);
    if (compressed !== normalized) {
      compressor = commandFilter.name;
      textForChunks = compressed;
      commandFilterApplied = true;
      // A compressor rewrites lines; chunk line numbers no longer index the
      // normalized text, so no raw line can be named for them.
      provenance = null;
    }
  } else if (compressorEligible) {
    const compressed = compressByCategory(classification.category, normalized, intent);
    compressor = compressed.compressor;
    textForChunks = compressed.text;
    if (textForChunks !== normalized) provenance = null;
  }
```

- [ ] In the same file, extend `skipDedupe` (verified anchor: the `const skipDedupe =` expression) with one more disjunct after `usedDiagnostic ||`: `commandFilterApplied ||` — filtered table rows are near-identical shapes simhash would fold, yet each is distinct evidence (same reasoning as `DIAGNOSTIC_CATEGORIES`).
- [ ] Export from `packages/output-filter/src/index.ts` (append at end of file):

```ts
export {
  COMMAND_FILTERS,
  COMMAND_FILTER_MARKERS,
  matchCommandFilter,
  type CommandFilter,
  type CommandFilterIntegrity,
} from "./filters/index.js";
```

- [ ] GREEN: `pnpm --filter @megasaver/output-filter exec vitest run test/filters/git-status.test.ts test/filters/wiring.test.ts` — expect PASS.
- [ ] Regression + guards: `pnpm --filter @megasaver/output-filter test` — expect PASS (notably `no-eager-typescript.test.ts`, `filter-output.test.ts`, `compress.test.ts`).
- [ ] `pnpm --filter @megasaver/output-filter typecheck && pnpm exec biome check packages/output-filter` — expect clean.
- [ ] Commit: `feat(output-filter): add command-filter registry`

---

### Task 2: git-log + docker-ps

**Files:**
- `packages/output-filter/src/filters/git-log.ts` (new)
- `packages/output-filter/src/filters/docker-ps.ts` (new)
- `packages/output-filter/src/filters/index.ts` (edit — append 2 entries)
- `packages/output-filter/src/compress/index.ts` (edit — append 2 members)
- `packages/output-filter/test/filters/git-log.test.ts` (new)
- `packages/output-filter/test/filters/docker-ps.test.ts` (new)

**Steps:**

- [ ] Write the failing tests. `test/filters/git-log.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compressGitLog } from "../../src/filters/git-log.js";
import { COMMAND_FILTERS } from "../../src/filters/index.js";
import { assertFilterConformance } from "./conformance.js";

const filter = COMMAND_FILTERS.find((f) => f.name === "git-log");
if (filter === undefined) throw new Error("git-log not registered");

const sha = (i: number): string => (0x1abc000 + i * 7919).toString(16).padStart(7, "0");
const LOG = Array.from({ length: 30 }, (_, i) => `${sha(i)} feat(core): change number ${i}`).join(
  "\n",
);

describe("git-log filter", () => {
  it("collapses the middle of a long oneline log, keeps head and tail", () => {
    const out = assertFilterConformance(filter, LOG);
    expect(out).toContain(`${sha(0)} feat(core): change number 0`);
    expect(out).toContain(`${sha(14)} feat(core): change number 14`);
    expect(out).toContain("… [10 commits omitted]");
    expect(out).toContain(`${sha(29)} feat(core): change number 29`);
    expect(out).not.toContain("change number 17");
  });

  it("passes full-format logs through verbatim (shape guard)", () => {
    const full = ["commit 1abc0000", "Author: Dev <dev@example.invalid>", "", "    subject"].join(
      "\n",
    );
    expect(compressGitLog(full)).toBe(full);
  });
});
```

- [ ] `test/filters/docker-ps.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compressDockerPs } from "../../src/filters/docker-ps.js";
import { COMMAND_FILTERS } from "../../src/filters/index.js";
import { assertFilterConformance } from "./conformance.js";

const filter = COMMAND_FILTERS.find((f) => f.name === "docker-ps");
if (filter === undefined) throw new Error("docker-ps not registered");

const HEADER =
  "CONTAINER ID   IMAGE          COMMAND                  CREATED       STATUS       PORTS                    NAMES";
const row = (id: string, image: string, name: string): string =>
  `${id}   ${image.padEnd(12)}   "docker-entrypoint.s…"   2 hours ago   Up 2 hours   0.0.0.0:8080->8080/tcp   ${name}`;
const PS = [
  HEADER,
  row("3f8a12bc9d01", "postgres:16", "ms-db"),
  ...Array.from({ length: 8 }, (_, i) => row(`aa00000000${i}0`, "app:latest", `app-${i}`)),
  row("9c7b44de0e21", "redis:7", "ms-cache"),
].join("\n");

describe("docker-ps filter", () => {
  it("folds consecutive same-image rows beyond the cap", () => {
    const out = assertFilterConformance(filter, PS);
    expect(out).toContain(HEADER);
    expect(out).toContain("app-2");
    expect(out).not.toContain("app-3");
    expect(out).toContain("… [5 similar: app:latest]");
    expect(out).toContain("ms-cache");
  });

  it("passes non-table text through verbatim", () => {
    expect(compressDockerPs("Error response from daemon: dial unix")).toBe(
      "Error response from daemon: dial unix",
    );
  });
});
```

- [ ] RED: `pnpm --filter @megasaver/output-filter exec vitest run test/filters/git-log.test.ts test/filters/docker-ps.test.ts` — expect FAIL.
- [ ] Append `| "git-log" | "docker-ps"` to `CompressorName`.
- [ ] Implement `src/filters/git-log.ts`:

```ts
const ONELINE = /^[0-9a-f]{7,40} \S/;
const HEAD_KEEP = 15;
const TAIL_KEEP = 5;

// Only the oneline shape collapses (recent commits + the oldest tail are the
// evidence an agent acts on); full-format logs pass through verbatim.
export function compressGitLog(text: string): string {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length <= HEAD_KEEP + TAIL_KEEP + 1) return text;
  if (!lines.every((l) => l === "" || ONELINE.test(l))) return text;
  const dropped = lines.length - HEAD_KEEP - TAIL_KEEP;
  return [
    ...lines.slice(0, HEAD_KEEP),
    `… [${dropped} commits omitted]`,
    ...lines.slice(lines.length - TAIL_KEEP),
  ].join("\n");
}
```

- [ ] Implement `src/filters/docker-ps.ts`:

```ts
const HEADER = /^CONTAINER ID\s{2,}IMAGE\s{2,}/;
const MAX_PER_IMAGE = 3;

// Consecutive same-image rows past the cap are replicas, not evidence; each
// distinct image (and any unsorted interleaving) is preserved.
export function compressDockerPs(text: string): string {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 0 || !HEADER.test(lines[0] ?? "")) return text;
  const out: string[] = [lines[0] as string];
  let image = "";
  let kept = 0;
  let folded = 0;
  const flush = (): void => {
    if (folded > 0) out.push(`… [${folded} similar: ${image}]`);
    folded = 0;
  };
  for (const line of lines.slice(1)) {
    const img = line.split(/\s{2,}/)[1] ?? "";
    if (img !== image) {
      flush();
      image = img;
      kept = 0;
    }
    if (kept < MAX_PER_IMAGE) {
      out.push(line);
      kept += 1;
    } else {
      folded += 1;
    }
  }
  flush();
  return out.join("\n");
}
```

- [ ] Append registry entries (at the END of `COMMAND_FILTERS`):

```ts
  {
    name: "git-log",
    command: /\bgit\s+log\b/,
    integrity: "line-subset",
    markers: [/^… \[\d+ commits omitted\]$/],
    compress: compressGitLog,
  },
  {
    name: "docker-ps",
    command: /\bdocker\s+ps\b/,
    integrity: "line-subset",
    markers: [/^… \[\d+ similar: [^\]\n]{1,200}\]$/],
    compress: compressDockerPs,
  },
```

- [ ] Append the no-op and dedupe-skip wiring cases to `test/filters/wiring.test.ts` (these two close the spec Testing rows "no-op keeps `compressor: generic` and provenance" and "registry hit skips dedupe"):

```ts
  it("a matched filter that recognizes nothing stays a generic no-op", async () => {
    const raw = Array.from(
      { length: 400 },
      (_, i) => `commit line ${i} with a full-format body`,
    ).join("\n");
    const res = await filterOutput({
      raw,
      mode: "balanced",
      ...FORCE,
      source: { kind: "command", command: "git", args: ["log"] },
    });
    expect(res.compressor).toBe("generic");
    // Spec Testing row: the no-op path keeps provenance — no filter rewrote
    // lines, so surviving excerpts still carry raw coordinates.
    expect(res.excerpts.length).toBeGreaterThan(0);
    expect(res.excerpts.every((e) => e.rawStartLine !== undefined)).toBe(true);
  });

  it("an applied filter skips simhash dedupe — every distinct row survives", async () => {
    const HEADER = "CONTAINER ID   IMAGE   COMMAND   CREATED   STATUS   PORTS   NAMES";
    const psRow = (image: string, name: string): string =>
      `id-${name}   ${image}   "entry"   long ago   Up long   none   ${name}`;
    const raw = [
      HEADER,
      // 10 consecutive same-image replicas: the filter folds 7 behind its
      // counted marker, so commandFilterApplied is true.
      ...Array.from({ length: 10 }, (_, i) => psRow("noise:1", `noise-${i}`)),
      // 84 near-identical rows with DISTINCT images: the filter keeps every
      // one, they chunk into near-identical 40-line windows, and absent the
      // commandFilterApplied disjunct simhash dedupe would fold the later
      // windows — erasing distinct evidence.
      ...Array.from({ length: 84 }, (_, i) => psRow(`svc-${i}:v1`, `svc-${i}`)),
    ].join("\n");
    const res = await filterOutput({
      raw,
      mode: "balanced",
      ...FORCE,
      // Budget out of the way (an explicit caller cap wins in targetBudget,
      // fit.ts): dedupe is then the ONLY step that could drop a kept row.
      maxReturnedBytes: 64_000,
      source: { kind: "command", command: "docker", args: ["ps"] },
    });
    expect(res.compressor).toBe("docker-ps");
    const delivered = res.excerpts.map((e) => e.text).join("\n");
    expect(delivered).toContain("… [7 similar: noise:1]");
    for (const name of Array.from({ length: 84 }, (_, i) => `svc-${i}`)) {
      expect(delivered).toContain(psRow(`${name}:v1`, name));
    }
  });
```

(Fixture rows carry no timestamps/UUIDs, so `collapseSimilar` in normalize.ts — whose MASKS fold only timestamp/UUID-bearing lines — passes them through to the filter intact.)

- [ ] GREEN: `pnpm --filter @megasaver/output-filter exec vitest run test/filters` — expect PASS. Then `pnpm --filter @megasaver/output-filter typecheck && pnpm exec biome check packages/output-filter` — clean.
- [ ] Commit: `feat(output-filter): add git-log, docker-ps`

---

### Task 3: kubectl-get + gh-pr-list

**Files:**
- `packages/output-filter/src/filters/kubectl-get.ts` (new)
- `packages/output-filter/src/filters/gh-pr-list.ts` (new)
- `packages/output-filter/src/filters/index.ts` / `src/compress/index.ts` (edit — append)
- `packages/output-filter/test/filters/kubectl-get.test.ts` (new)
- `packages/output-filter/test/filters/gh-pr-list.test.ts` (new)

**Steps:**

- [ ] Write the failing tests. `test/filters/kubectl-get.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { COMMAND_FILTERS } from "../../src/filters/index.js";
import { compressKubectlGet } from "../../src/filters/kubectl-get.js";
import { assertFilterConformance } from "./conformance.js";

const filter = COMMAND_FILTERS.find((f) => f.name === "kubectl-get");
if (filter === undefined) throw new Error("kubectl-get not registered");

const pod = (name: string, ready: string, status: string, restarts: string, age: string): string =>
  `${name.padEnd(28)}${ready.padEnd(8)}${status.padEnd(19)}${restarts.padEnd(11)}${age}`;
const PODS = [
  pod("NAME", "READY", "STATUS", "RESTARTS", "AGE"),
  ...Array.from({ length: 17 }, (_, i) => pod(`api-7f9c65d4b8-${i}xkp`, "1/1", "Running", "0", "3d2h")),
  pod("queue-5f6d7c8b9d-a1b2c", "1/1", "Running", "6 (12m ago)", "3d2h"),
  pod("worker-6b7d9c5f4d-9qwzr", "0/1", "CrashLoopBackOff", "12", "3d2h"),
  pod("ingest-5d8f7b6c9d-tk2lm", "0/1", "Pending", "0", "14m"),
].join("\n");

describe("kubectl-get filter", () => {
  it("keeps every anomaly and restarted pod, folds healthy rows", () => {
    const out = assertFilterConformance(filter, PODS);
    expect(out).toContain("CrashLoopBackOff");
    expect(out).toContain("Pending");
    expect(out).toContain("6 (12m ago)"); // restarted-but-Running is evidence
    expect(out).toContain("api-7f9c65d4b8-4xkp");
    expect(out).not.toContain("api-7f9c65d4b8-9xkp");
    expect(out).toContain("… [12 more Running]");
  });

  it("passes tables without a STATUS column through verbatim", () => {
    const svc = "NAME         TYPE        CLUSTER-IP     PORT(S)   AGE\napi   ClusterIP   10.0.0.12   80/TCP    3d";
    expect(compressKubectlGet(svc)).toBe(svc);
  });
});
```

- [ ] `test/filters/gh-pr-list.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compressGhPrList } from "../../src/filters/gh-pr-list.js";
import { COMMAND_FILTERS } from "../../src/filters/index.js";
import { assertFilterConformance } from "./conformance.js";

const filter = COMMAND_FILTERS.find((f) => f.name === "gh-pr-list");
if (filter === undefined) throw new Error("gh-pr-list not registered");

const LIST = Array.from(
  { length: 34 },
  (_, i) => `${100 + i}\tfix: flaky retry in saver ${i}\tfix/flaky-${i}\tOPEN\t2026-08-0${(i % 6) + 1}T10:00:00Z`,
).join("\n");

describe("gh-pr-list filter", () => {
  it("caps the TSV listing and counts the fold", () => {
    const out = assertFilterConformance(filter, LIST);
    expect(out).toContain("100\tfix: flaky retry in saver 0");
    expect(out).toContain("129\tfix: flaky retry in saver 29");
    expect(out).not.toContain("130\tfix: flaky retry in saver 30");
    expect(out).toContain("… [4 more PRs]");
  });

  it("passes non-TSV output through verbatim", () => {
    expect(compressGhPrList("no pull requests match your search")).toBe(
      "no pull requests match your search",
    );
  });
});
```

- [ ] RED: `pnpm --filter @megasaver/output-filter exec vitest run test/filters/kubectl-get.test.ts test/filters/gh-pr-list.test.ts` — expect FAIL.
- [ ] Append `| "kubectl-get" | "gh-pr-list"` to `CompressorName`.
- [ ] Implement `src/filters/kubectl-get.ts`:

```ts
const HEALTHY = new Set(["Running", "Completed", "Succeeded"]);
const MAX_PER_STATUS = 5;

// Anomalies are the whole point of reading `kubectl get`: every non-healthy
// or restarted row is kept; only zero-restart healthy rows fold past the cap.
export function compressKubectlGet(text: string): string {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const header = lines[0] ?? "";
  const cols = header.split(/\s{2,}/);
  const statusIdx = cols.indexOf("STATUS");
  if (statusIdx < 0) return text;
  const restartsIdx = cols.indexOf("RESTARTS");
  const out: string[] = [header];
  const kept = new Map<string, number>();
  const folded = new Map<string, number>();
  for (const line of lines.slice(1)) {
    const parts = line.split(/\s{2,}/);
    const status = parts[statusIdx] ?? "";
    const restarts = restartsIdx >= 0 ? (parts[restartsIdx] ?? "0") : "0";
    const healthy = HEALTHY.has(status) && /^0(\s|$)/.test(restarts);
    if (!healthy) {
      out.push(line);
      continue;
    }
    const n = kept.get(status) ?? 0;
    if (n < MAX_PER_STATUS) {
      kept.set(status, n + 1);
      out.push(line);
      continue;
    }
    folded.set(status, (folded.get(status) ?? 0) + 1);
  }
  for (const [status, n] of folded) out.push(`… [${n} more ${status}]`);
  return out.join("\n");
}
```

- [ ] Implement `src/filters/gh-pr-list.ts` (ASSUMPTION: piped `gh pr list` emits header-less TSV rows starting `<number>\t` — gh v2 behavior; a wrong assumption degrades to the safe no-op, spec open question 3):

```ts
const ROW = /^\d+\t/;
const MAX_ROWS = 30;

export function compressGhPrList(text: string): string {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length <= MAX_ROWS) return text;
  if (!lines.every((l) => l === "" || ROW.test(l))) return text;
  const dropped = lines.length - MAX_ROWS;
  return [...lines.slice(0, MAX_ROWS), `… [${dropped} more PRs]`].join("\n");
}
```

- [ ] Append registry entries (END of array):

```ts
  {
    name: "kubectl-get",
    command: /\bkubectl\s+get\b/,
    integrity: "line-subset",
    markers: [/^… \[\d+ more (?:Running|Completed|Succeeded)\]$/],
    compress: compressKubectlGet,
  },
  {
    name: "gh-pr-list",
    command: /\bgh\s+pr\s+list\b/,
    integrity: "line-subset",
    markers: [/^… \[\d+ more PRs\]$/],
    compress: compressGhPrList,
  },
```

- [ ] GREEN: `pnpm --filter @megasaver/output-filter exec vitest run test/filters` — PASS; typecheck + biome clean.
- [ ] Commit: `feat(output-filter): kubectl-get, gh-pr-list`

---

### Task 4: npm-install + pip-install

**Files:**
- `packages/output-filter/src/filters/npm-install.ts` (new)
- `packages/output-filter/src/filters/pip-install.ts` (new)
- `packages/output-filter/src/filters/index.ts` / `src/compress/index.ts` (edit — append)
- `packages/output-filter/test/filters/npm-install.test.ts` (new)
- `packages/output-filter/test/filters/pip-install.test.ts` (new)

**Steps:**

- [ ] Write the failing tests. `test/filters/npm-install.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { COMMAND_FILTERS } from "../../src/filters/index.js";
import { compressNpmInstall } from "../../src/filters/npm-install.js";
import { assertFilterConformance } from "./conformance.js";

const filter = COMMAND_FILTERS.find((f) => f.name === "npm-install");
if (filter === undefined) throw new Error("npm-install not registered");

const PNPM = [
  "Lockfile is up to date, resolution step is skipped",
  "Packages: +1247",
  "+".repeat(60),
  ...Array.from(
    { length: 40 },
    (_, i) => `Progress: resolved ${i * 30}, reused ${i * 28}, downloaded ${i}, added ${i * 30}`,
  ),
  "Progress: resolved 1247, reused 1180, downloaded 67, added 1247, done",
  "",
  "devDependencies:",
  "+ vitest 3.0.5",
  "",
  " WARN  deprecated glob@7.2.3",
  "Done in 24.8s",
].join("\n");

describe("npm-install filter", () => {
  it("drops progress noise, keeps the final totals line and warnings", () => {
    const out = assertFilterConformance(filter, PNPM);
    expect(out).toContain("Progress: resolved 1247, reused 1180, downloaded 67, added 1247, done");
    expect(out).not.toContain("Progress: resolved 30,");
    expect(out).toContain(" WARN  deprecated glob@7.2.3");
    expect(out).toContain("Done in 24.8s");
    expect(out).toContain("… [41 progress lines]");
  });

  it("passes clean short output through verbatim", () => {
    const quiet = "added 3 packages in 1.2s";
    expect(compressNpmInstall(quiet)).toBe(quiet);
  });
});
```

- [ ] `test/filters/pip-install.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { COMMAND_FILTERS } from "../../src/filters/index.js";
import { compressPipInstall } from "../../src/filters/pip-install.js";
import { assertFilterConformance } from "./conformance.js";

const filter = COMMAND_FILTERS.find((f) => f.name === "pip-install");
if (filter === undefined) throw new Error("pip-install not registered");

const PIP = [
  "Collecting requests==2.32.3",
  "  Downloading requests-2.32.3-py3-none-any.whl (64 kB)",
  ...Array.from(
    { length: 12 },
    (_, i) =>
      `Requirement already satisfied: dep-${i} in ./venv/lib/python3.12/site-packages (1.0.${i})`,
  ),
  "Collecting urllib3<3,>=1.21.1",
  "  Downloading urllib3-2.2.2-py3-none-any.whl (121 kB)",
  "Installing collected packages: urllib3, requests",
  "Successfully installed requests-2.32.3 urllib3-2.2.2",
].join("\n");

describe("pip-install filter", () => {
  it("folds satisfied/download noise, keeps install evidence", () => {
    const out = assertFilterConformance(filter, PIP);
    expect(out).toContain("Requirement already satisfied: dep-0");
    expect(out).not.toContain("dep-7");
    expect(out).toContain("… [11 already satisfied]");
    expect(out).toContain("… [2 download lines]");
    expect(out).toContain("Successfully installed requests-2.32.3 urllib3-2.2.2");
  });
});
```

- [ ] RED: `pnpm --filter @megasaver/output-filter exec vitest run test/filters/npm-install.test.ts test/filters/pip-install.test.ts` — expect FAIL.
- [ ] Append `| "npm-install" | "pip-install"` to `CompressorName`.
- [ ] Implement `src/filters/npm-install.ts`:

```ts
const NOISE =
  /^(?:Progress: resolved \d|reify:|idealTree:|timing |npm timing |npm http fetch |[+.]{8,}$)/;

// Spinner/progress repaints are terminal decoration; the LAST Progress line
// carries the final totals, so it is re-kept and excluded from the count.
export function compressNpmInstall(text: string): string {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const out: string[] = [];
  let dropped = 0;
  let lastProgress: string | undefined;
  for (const line of lines) {
    if (NOISE.test(line)) {
      if (line.startsWith("Progress: ")) lastProgress = line;
      dropped += 1;
      continue;
    }
    out.push(line);
  }
  if (lastProgress !== undefined) {
    out.push(lastProgress);
    dropped -= 1;
  }
  if (dropped > 0) out.push(`… [${dropped} progress lines]`);
  return out.join("\n");
}
```

- [ ] Implement `src/filters/pip-install.ts`:

```ts
const SATISFIED = /^Requirement already satisfied: /;
const DOWNLOAD = /^ {0,8}(?:Downloading|Using cached) \S/;

export function compressPipInstall(text: string): string {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const out: string[] = [];
  let satisfied = 0;
  let downloads = 0;
  for (const line of lines) {
    if (SATISFIED.test(line)) {
      satisfied += 1;
      if (satisfied === 1) out.push(line);
      continue;
    }
    if (DOWNLOAD.test(line)) {
      downloads += 1;
      continue;
    }
    out.push(line);
  }
  if (satisfied > 1) out.push(`… [${satisfied - 1} already satisfied]`);
  if (downloads > 0) out.push(`… [${downloads} download lines]`);
  return out.join("\n");
}
```

- [ ] Append registry entries (END of array):

```ts
  {
    name: "npm-install",
    command: /\b(?:npm|pnpm|yarn)\s+(?:install|add|ci|i)\b/,
    integrity: "line-subset",
    markers: [/^… \[\d+ progress lines\]$/],
    compress: compressNpmInstall,
  },
  {
    name: "pip-install",
    command: /\bpip3?\s+install\b/,
    integrity: "line-subset",
    markers: [/^… \[\d+ already satisfied\]$/, /^… \[\d+ download lines\]$/],
    compress: compressPipInstall,
  },
```

- [ ] GREEN: `pnpm --filter @megasaver/output-filter exec vitest run test/filters` — PASS; typecheck + biome clean.
- [ ] Commit: `feat(output-filter): npm-install, pip-install`

---

### Task 5: cargo-build + docker-build

**Files:**
- `packages/output-filter/src/filters/cargo-build.ts` (new)
- `packages/output-filter/src/filters/docker-build.ts` (new)
- `packages/output-filter/src/filters/index.ts` / `src/compress/index.ts` (edit — append)
- `packages/output-filter/test/filters/cargo-build.test.ts` (new)
- `packages/output-filter/test/filters/docker-build.test.ts` (new)

**Steps:**

- [ ] Write the failing tests. `test/filters/cargo-build.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compressCargoBuild } from "../../src/filters/cargo-build.js";
import { COMMAND_FILTERS } from "../../src/filters/index.js";
import { assertFilterConformance } from "./conformance.js";

const filter = COMMAND_FILTERS.find((f) => f.name === "cargo-build");
if (filter === undefined) throw new Error("cargo-build not registered");

const WARN_BLOCK = [
  "warning: unused variable: `retries`",
  " --> src/net/client.rs:41:9",
  "  |",
  "41 |     let retries = 3;",
  "  |         ^^^^^^^ help: if this is intentional, prefix it with an underscore: `_retries`",
  "  |",
  "  = note: `#[warn(unused_variables)]` on by default",
];
const CARGO = [
  ...Array.from({ length: 30 }, (_, i) => `   Compiling crate-${i} v0.${i}.0`),
  "   Compiling megasaver-net v0.4.2 (/repo/net)",
  ...WARN_BLOCK,
  "",
  "warning: `megasaver-net` (lib) generated 1 warning",
  "",
  ...WARN_BLOCK,
  "",
  'warning: `megasaver-net` (bin "mega-net") generated 1 warning',
  "",
  "    Finished `dev` profile [unoptimized + debuginfo] target(s) in 42.17s",
].join("\n");

describe("cargo-build filter", () => {
  it("caps the crate run and folds exact-duplicate warning blocks", () => {
    const out = assertFilterConformance(filter, CARGO);
    expect(out).toContain("   Compiling crate-2 v0.2.0");
    expect(out).not.toContain("   Compiling crate-3 v0.3.0");
    expect(out).toContain("… [28 crates compiled]");
    expect(out).toContain("warning: unused variable: `retries`");
    expect(out).toContain('warning: `megasaver-net` (bin "mega-net") generated 1 warning');
    expect(out).toContain("… [1 duplicate warnings]");
    expect(out).toContain("Finished `dev` profile");
    expect(out.split("warning: unused variable: `retries`").length).toBe(2);
  });
});
```

- [ ] `test/filters/docker-build.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compressDockerBuild } from "../../src/filters/docker-build.js";
import { COMMAND_FILTERS } from "../../src/filters/index.js";
import { assertFilterConformance } from "./conformance.js";

const filter = COMMAND_FILTERS.find((f) => f.name === "docker-build");
if (filter === undefined) throw new Error("docker-build not registered");

const sha = (n: number): string => n.toString(16).padStart(12, "0");
const BUILD = [
  "#1 [internal] load build definition from Dockerfile",
  "#1 transferring dockerfile: 1.24kB done",
  "#1 DONE 0.1s",
  "#2 [internal] load metadata for docker.io/library/node:22-alpine",
  "#2 DONE 0.8s",
  "#3 [1/5] FROM docker.io/library/node:22-alpine",
  ...Array.from({ length: 18 }, (_, i) => `#3 sha256:${sha(0xabc0 + i)}deadbeef00 4.19MB / 4.19MB done`),
  ...Array.from({ length: 6 }, (_, i) => `#3 extracting sha256:${sha(0xfff0 + i)}cafe00 0.5s done`),
  "#3 DONE 6.4s",
  "#4 [2/5] WORKDIR /app",
  "#4 CACHED",
  "#5 [3/5] COPY package.json pnpm-lock.yaml ./",
  "#5 DONE 0.1s",
  "#6 [4/5] RUN corepack enable && pnpm install --frozen-lockfile",
  "#6 12.31 Lockfile is up to date, resolution step is skipped",
  "#6 14.02  WARN  deprecated glob@7.2.3",
  "#6 DONE 31.2s",
  "#7 [5/5] COPY . .",
  "#7 DONE 0.3s",
  "#8 exporting to image",
  "#8 writing image sha256:1f2e3d4c5b6a7980deadbeefcafe0123 done",
  "#8 naming to docker.io/library/megasaver:dev done",
  "#8 DONE 0.9s",
].join("\n");

describe("docker-build filter", () => {
  it("drops layer transfer noise, keeps steps, run output and result", () => {
    const out = assertFilterConformance(filter, BUILD);
    expect(out).toContain("#6 [4/5] RUN corepack enable && pnpm install --frozen-lockfile");
    expect(out).toContain("#6 14.02  WARN  deprecated glob@7.2.3");
    expect(out).toContain("#4 CACHED");
    expect(out).toContain("#8 writing image sha256:1f2e3d4c5b6a7980deadbeefcafe0123 done");
    expect(out).not.toContain("4.19MB / 4.19MB");
    expect(out).toContain("… [25 layer lines]");
  });
});
```

- [ ] RED: `pnpm --filter @megasaver/output-filter exec vitest run test/filters/cargo-build.test.ts test/filters/docker-build.test.ts` — expect FAIL.
- [ ] Append `| "cargo-build" | "docker-build"` to `CompressorName`.
- [ ] Implement `src/filters/cargo-build.ts`:

```ts
const CRATE = /^ {1,8}(?:Compiling|Checking|Fresh|Downloaded|Downloading) \S/;
const WARNING = /^warning: /;
const MAX_CRATES = 3;

// Duplicate warning blocks come from multi-target builds (lib + bin + test
// re-emit the same diagnostic); the (header, location) pair identifies one.
// Markers are appended at the tail: counts are the contract, positions are
// presentation (single-pass simplicity). error[…] blocks never match WARNING
// and always pass through whole.
export function compressCargoBuild(text: string): string {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const out: string[] = [];
  const seen = new Set<string>();
  let crates = 0;
  let dupes = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    if (CRATE.test(line)) {
      crates += 1;
      if (crates <= MAX_CRATES) out.push(line);
      i += 1;
      continue;
    }
    if (WARNING.test(line)) {
      let end = i + 1;
      while (end < lines.length && (lines[end] as string).trim() !== "") end += 1;
      const key = `${line}\n${lines[i + 1] ?? ""}`;
      if (seen.has(key)) {
        dupes += 1;
      } else {
        seen.add(key);
        out.push(...lines.slice(i, end));
      }
      i = end;
      continue;
    }
    out.push(line);
    i += 1;
  }
  if (crates > MAX_CRATES) out.push(`… [${crates - MAX_CRATES} crates compiled]`);
  if (dupes > 0) out.push(`… [${dupes} duplicate warnings]`);
  return out.join("\n");
}
```

- [ ] Implement `src/filters/docker-build.ts`:

```ts
const NOISE =
  /^#\d{1,4} (?:sha256:[0-9a-f]{8,64}|extracting sha256:|transferring (?:context|dockerfile):|loading metadata for )/;

// BuildKit layer transfer/extract repaints are decoration; step headers,
// CACHED/DONE/ERROR lines, in-step run output and the final image lines are
// the evidence and pass through untouched.
export function compressDockerBuild(text: string): string {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const out: string[] = [];
  let layers = 0;
  for (const line of lines) {
    if (NOISE.test(line)) {
      layers += 1;
      continue;
    }
    out.push(line);
  }
  if (layers > 0) out.push(`… [${layers} layer lines]`);
  return out.join("\n");
}
```

- [ ] Append registry entries (END of array). The cargo command regex is `build|check` ONLY — `cargo test` stays with the existing `src/parsers/cargo-test.ts` path (spec non-goal):

```ts
  {
    name: "cargo-build",
    command: /\bcargo\s+(?:build|check)\b/,
    integrity: "line-subset",
    markers: [/^… \[\d+ crates compiled\]$/, /^… \[\d+ duplicate warnings\]$/],
    compress: compressCargoBuild,
  },
  {
    name: "docker-build",
    command: /\bdocker\s+(?:buildx\s+)?build\b/,
    integrity: "line-subset",
    markers: [/^… \[\d+ layer lines\]$/],
    compress: compressDockerBuild,
  },
```

- [ ] GREEN: `pnpm --filter @megasaver/output-filter exec vitest run test/filters` — PASS; typecheck + biome clean.
- [ ] Commit: `feat(output-filter): cargo-build, docker-build`

---

### Task 6: terraform-plan

**Files:**
- `packages/output-filter/src/filters/terraform-plan.ts` (new)
- `packages/output-filter/src/filters/index.ts` / `src/compress/index.ts` (edit — append)
- `packages/output-filter/test/filters/terraform-plan.test.ts` (new)

**Steps:**

- [ ] Write the failing test `test/filters/terraform-plan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { COMMAND_FILTERS } from "../../src/filters/index.js";
import { compressTerraformPlan } from "../../src/filters/terraform-plan.js";
import { assertFilterConformance } from "./conformance.js";

const filter = COMMAND_FILTERS.find((f) => f.name === "terraform-plan");
if (filter === undefined) throw new Error("terraform-plan not registered");

const attr = (k: string, v: string): string => `      + ${k.padEnd(24)} = ${v}`;
const PLAN = [
  "Terraform will perform the following actions:",
  "",
  "  # aws_instance.web will be created",
  '  + resource "aws_instance" "web" {',
  attr("ami", '"ami-0f1e2d3c4b5a69788"'),
  attr("instance_type", '"t3.micro"'),
  attr("subnet_id", '"subnet-0aa1bb2cc3dd4ee5f"'),
  ...Array.from({ length: 15 }, (_, i) => attr(`attribute_${i}`, "(known after apply)")),
  "    }",
  "",
  "  # aws_security_group.web will be updated in-place",
  '  ~ resource "aws_security_group" "web" {',
  '      ~ description = "old" -> "new"',
  "    }",
  "",
  "Plan: 1 to add, 1 to change, 0 to destroy.",
].join("\n");

describe("terraform-plan filter", () => {
  it("collapses created-resource attribute bodies, keeps updates whole", () => {
    const out = assertFilterConformance(filter, PLAN);
    expect(out).toContain("  # aws_instance.web will be created");
    expect(out).toContain('  + resource "aws_instance" "web" {');
    expect(out).not.toContain("ami-0f1e2d3c4b5a69788");
    expect(out).toContain("… [18 attributes]");
    expect(out).toContain('      ~ description = "old" -> "new"');
    expect(out).toContain("Plan: 1 to add, 1 to change, 0 to destroy.");
  });

  it("passes non-plan text through verbatim", () => {
    expect(compressTerraformPlan("No changes. Your infrastructure matches.")).toBe(
      "No changes. Your infrastructure matches.",
    );
  });
});
```

- [ ] RED: `pnpm --filter @megasaver/output-filter exec vitest run test/filters/terraform-plan.test.ts` — expect FAIL.
- [ ] Append `| "terraform-plan"` to `CompressorName`.
- [ ] Implement `src/filters/terraform-plan.ts`:

```ts
const CREATED = /^ {0,8}# \S{1,200} will be created$/;
const OPENER = /^( {0,8})\+ resource "/;

// A create block's attribute body is derivable intent, not diff evidence;
// update/destroy blocks show real state change and pass through whole. If a
// closer is never found (shape drift) the count runs to EOF — degraded but
// counted, never silently dropped.
export function compressTerraformPlan(text: string): string {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    const open = OPENER.exec(line);
    const prev = i > 0 ? (lines[i - 1] as string) : "";
    if (open !== null && CREATED.test(prev)) {
      const closer = `${open[1] ?? ""}  }`;
      out.push(line);
      i += 1;
      let attrs = 0;
      while (i < lines.length && (lines[i] as string).trimEnd() !== closer) {
        attrs += 1;
        i += 1;
      }
      if (attrs > 0) out.push(`… [${attrs} attributes]`);
      continue;
    }
    out.push(line);
    i += 1;
  }
  return out.join("\n");
}
```

- [ ] Append the registry entry (END of array):

```ts
  {
    name: "terraform-plan",
    command: /\bterraform\s+plan\b/,
    integrity: "line-subset",
    markers: [/^… \[\d+ attributes\]$/],
    compress: compressTerraformPlan,
  },
```

- [ ] GREEN: `pnpm --filter @megasaver/output-filter test` — full package PASS; typecheck + biome clean.
- [ ] Commit: `feat(output-filter): terraform-plan filter`

---

### Task 7: W4 reconstruct-or-declare inclusion (context-gate)

**Files:**
- `packages/context-gate/test/save-integrity-command-filters.test.ts` (new)

**Steps:**

- [ ] Write the test. It mirrors the arrange/act helpers of `packages/context-gate/test/save-integrity.property.test.ts` (`recoverAll` chunk-walk via `fetchChunk` at :109-117; trimmed-line comparison over `redact(raw).redacted` at :122-127). The `recordAndFilterOverlayOutput` field list below is the file's working call (:207-218) with `sourceKind: "command"`, a command-line `label`, and the explicit `compressFloorBytes: 64` opt-in (`RecordOverlayOutputInput`, record-output.ts:91 — `chunkSetSource` turns the label into `{ kind: "command", command: label, args: [] }`, which is what `matchCommandFilter` sees). Skeleton — only the nine remaining fixture constants come from Tasks 2–6:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMAND_FILTER_MARKERS } from "@megasaver/output-filter";
import { redact } from "@megasaver/policy";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchChunk } from "../src/fetch-chunk.js";
import { recordAndFilterOverlayOutput } from "../src/record-output.js";

const WK = "0123456789abcdef";
const LSID = "44444444-4444-4444-8444-444444444444";

// Copied from save-integrity.property.test.ts:88-94 — that file's warning
// comment forbids widening ITS list in place, so this suite carries its own
// copy and adds the registry's declared markers separately.
const STRUCTURAL_LINE: readonly RegExp[] = [
  /^… \[lines \d+-\d+ omitted\]$/,
  /^… \[remainder omitted — recover any part with the chunk ids below\]$/,
  /^… \[repeated \d+ times\]$/,
  /^… \[\d+ similar: .*\]$/,
  /^\[Mega Saver: compressed \d+→\d+ B .*\]$/,
];

// One fixture shown in full; GIT_LOG, DOCKER_PS, KUBECTL_GET, GH_PR_LIST,
// NPM_INSTALL, PIP_INSTALL, CARGO_BUILD, DOCKER_BUILD and TERRAFORM_PLAN are
// compact copies of the exact Task 2-6 test fixtures (same shapes, trimmed
// row counts), each comfortably past compressFloorBytes: 64.
const GIT_STATUS = [
  "On branch main",
  "Changes not staged for commit:",
  '  (use "git add <file>..." to update what will be committed)',
  ...Array.from({ length: 40 }, (_, i) => `\tmodified:   src/w4-mod-${i}.ts`),
].join("\n");

const ROWS: ReadonlyArray<{ command: string; fixture: string }> = [
  { command: "git status", fixture: GIT_STATUS },
  { command: "git log", fixture: GIT_LOG },
  { command: "docker ps", fixture: DOCKER_PS },
  { command: "kubectl get pods", fixture: KUBECTL_GET },
  { command: "gh pr list", fixture: GH_PR_LIST },
  { command: "npm install", fixture: NPM_INSTALL },
  { command: "pip install -r requirements.txt", fixture: PIP_INSTALL },
  { command: "cargo build", fixture: CARGO_BUILD },
  { command: "docker build .", fixture: DOCKER_BUILD },
  { command: "terraform plan", fixture: TERRAFORM_PLAN },
];

function trimmedLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

async function recoverAll(storeRoot: string, chunkSetId: string): Promise<string> {
  const parts: string[] = [];
  for (let i = 0; ; i += 1) {
    const res = await fetchChunk({ storeRoot, chunkSetId, chunkId: String(i) });
    if (!res.ok) break;
    parts.push(res.chunk.text);
  }
  return parts.join("\n");
}

let store: string;
beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "cg-w4-filters-"));
});
afterEach(async () => {
  await rm(store, { recursive: true, force: true });
});

describe("W4 reconstruct-or-declare — command filters", () => {
  for (const [i, row] of ROWS.entries()) {
    it(`loses nothing and fabricates nothing for \`${row.command}\``, async () => {
      const result = await recordAndFilterOverlayOutput({
        storeRoot: store,
        workspaceKey: WK,
        liveSessionId: LSID,
        raw: row.fixture,
        sourceKind: "command",
        label: row.command,
        mode: "balanced",
        storeRawOutput: true,
        includeFooter: true,
        compressFloorBytes: 64,
        newId: () => `cs-w4-${i}`,
      });
      expect(result.decision).toBe("compressed");

      // Reconstruct: the chunk store holds the FULL redacted raw regardless
      // of which filter ran.
      const recovered = await recoverAll(store, `cs-w4-${i}`);
      const universe = `${result.returnedText}\n${recovered}`;
      const missing = trimmedLines(redact(row.fixture).redacted).filter(
        (l) => !universe.includes(l),
      );
      expect(missing.slice(0, 5), `${missing.length} line(s) unrecoverable`).toEqual([]);

      // No fabrication: delivered lines are raw lines, base structural forms,
      // or the registry's own declared markers — nothing else.
      const authentic = new Set([
        ...trimmedLines(row.fixture),
        ...trimmedLines(redact(row.fixture).redacted),
      ]);
      const invented = trimmedLines(result.returnedText.slice(result.summary.length)).filter(
        (l) =>
          !authentic.has(l) &&
          !STRUCTURAL_LINE.some((re) => re.test(l)) &&
          !COMMAND_FILTER_MARKERS.some((re) => re.test(l)),
      );
      expect(invented.slice(0, 5), `${invented.length} fabricated line(s)`).toEqual([]);
    });
  }

  it("honest naming: the git-status filter really ran through the record path", async () => {
    const result = await recordAndFilterOverlayOutput({
      storeRoot: store,
      workspaceKey: WK,
      liveSessionId: LSID,
      raw: GIT_STATUS,
      sourceKind: "command",
      label: "git status",
      mode: "balanced",
      storeRawOutput: true,
      includeFooter: true,
      compressFloorBytes: 64,
      newId: () => "cs-w4-honest",
    });
    expect(result.decision).toBe("compressed");
    expect(result.returnedText).toContain("… [1 hint lines]");
  });
});
```
- [ ] Run: `pnpm --filter @megasaver/context-gate exec vitest run test/save-integrity-command-filters.test.ts` — expect PASS on first run. This task's value is the permanent gate; if it fails, that is a REAL integrity defect — stop and fix the filter (never the test), per superpowers:systematic-debugging.
- [ ] Regression: `pnpm --filter @megasaver/context-gate test` — expect PASS (the existing property test file is untouched).
- [ ] Commit: `test(context-gate): W4 gate covers command filters`

---

### Task 8: Conformance checklist, changeset, DoD closeout

**Files:**
- `packages/output-filter/COMMAND-FILTERS.md` (new)
- `.changeset/filter-matrix-expansion.md` (new)
- `wiki/entities/output-filter.md`, `wiki/index.md`, `wiki/log.md` (edit)

**Steps:**

- [ ] Write `packages/output-filter/COMMAND-FILTERS.md` — the mechanical recipe (scope (d)) with exactly these numbered requirements:
  1. Name: kebab-case `<tool>-<subcommand>`; append to `CompressorName` after the current last member (append-only published contract).
  2. One pure module `src/filters/<name>.ts`: no IO, no deps, never throws; unrecognized shape → return the input verbatim.
  3. Shape guard first; every collapse emits a counted `… [<n> <label>]` marker (the `EVIDENCE_MARKER` prefix, `src/markers.ts`).
  4. Marker regexes: anchored `^… \[` … `\]$`, flagless; all quantifiers bounded — no `^\s*` under `m`, no `/g`; review against `wiki/concepts/unbounded-run-redos.md`.
  5. `integrity: "line-subset"` unless impossible; `"rewrite"` requires a bespoke integrity test (precedent `test/compress-tsc-integrity.test.ts`) and declared synthesized forms — and is excluded from lossless claims.
  6. Registry entry appended at the END of `COMMAND_FILTERS` (a more-specific command may precede a general one only with a WHY comment — order is observable).
  7. Test `test/filters/<name>.test.ts`: realistic SYNTHETIC fixture (fabricated ids, no secrets) + `assertFilterConformance` + behavior assertions.
  8. Add the fixture row to `packages/context-gate/test/save-integrity-command-filters.test.ts`.
  9. Never import `@megasaver/indexer` or `js-tiktoken` from `src/filters/` (hot-path lazy-import guards must stay green).
  10. Changeset (minor) + `wiki/entities/output-filter.md` note.
- [ ] Add `.changeset/filter-matrix-expansion.md`:

```md
---
"@megasaver/output-filter": minor
---

Add the command-filter registry: ten structured command compressors
(git-status, git-log, docker-ps, docker-build, kubectl-get, gh-pr-list,
npm-install, pip-install, cargo-build, terraform-plan) behind the W4
reconstruct-or-declare integrity gate, with a conformance harness and
checklist that make further filters mechanical.
```

- [ ] Commit: `docs(output-filter): filter conformance checklist` then `chore: add filter-matrix changeset`
- [ ] Run `pnpm verify` at the branch tip — expect green (lint + typecheck + all tests + conventions check).
- [ ] Smoke evidence (DoD #5): in a scratch git repo, run `mega output exec -- git status` and capture the terminal session showing the `git-status` compressor and its recovery footer; attach to the task report.
- [ ] Update `wiki/entities/output-filter.md` (new "Command-filter registry" section: registry, ten filters, marker contract, W4 inclusion), mention in `wiki/index.md` entity line, append a timestamped `wiki/log.md` entry.
- [ ] Commit: `docs(wiki): record filter matrix expansion`
- [ ] Request external review per §9.6: `code-reviewer` in a fresh context (author ≠ reviewer), then `verifier` with the smoke capture + `pnpm verify` output as evidence.
