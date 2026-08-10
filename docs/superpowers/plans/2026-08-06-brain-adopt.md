# Brain Adopt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `mega adopt <project> [--dry-run] [--cap N] [--json] [--store DIR]` — a deterministic, no-LLM scanner that parses a project's existing agent files (`CLAUDE.md`, `AGENTS.md`, `CONVENTIONS.md`, `.cursor/rules/*.mdc`, `.aider.conf.yml` `read:` pointers) into typed `MemoryEntry` rows with `file:line` citations, `source: "manual"`, `scope: "project"`, rubric confidence, and `approval: "suggested"` behind the EXISTING human gate (`mega memory review` / `approve|reject`). Approved rows reach every other agent through the existing `mega connector sync`; adopt itself writes NO agent files.

**Architecture:** Three pure modules in `apps/cli/src/adopt/` — `scan.ts` (line-preserving sentinel/frontmatter strip + unit splitter), `candidates.ts` (imperative rubric, redacted-content hash, title/keyword derivation), `discover.ts` (deterministic file discovery + aider pointer extraction with in-root guard, injected fs) — composed by `apps/cli/src/commands/adopt.ts` (`runAdopt`, Citty command, registered in `apps/cli/src/main.ts` `subCommands`). Entries are built with `memoryEntrySchema.parse` and written per-call via `registry.createMemoryEntry`, mirroring the `importBrain` suggested-gate call site (`packages/core/src/brain-import.ts:57-69`). Dedup is content-hash over `redact()`ed, whitespace-collapsed, lowercased text against ALL existing project-scoped entries (suggested + approved + rejected) plus the intra-run set — rejected adoptions are never re-suggested unless the source text changed. No new packages, no `@megasaver/core` changes, no schema changes.

**Tech Stack:** TypeScript strict/ESM, Zod (existing schemas only), Vitest, Citty, `node:crypto` sha256, @megasaver/core, @megasaver/shared, @megasaver/connectors-shared, @megasaver/policy (all already dependencies of `apps/cli` — `apps/cli/package.json:39,43,53`).

Spec: `docs/superpowers/specs/2026-08-06-brain-adopt-design.md`.

## Global Constraints

- Risk HIGH (spec §Risk & process): worktree `feat/brain-adopt` (no `main` edits), `architect` design pass is pending in the spec frontmatter, and BOTH `code-reviewer` AND `critic` run as separate independent passes before merge. Escalation trigger: any need to mutate agent files from adopt, or to change `memoryEntrySchema`, stops work and returns to spec review.
- Adopt is read-only outside the store: the only write is `registry.createMemoryEntry` (`packages/core/src/registry.ts:83` interface, `:371` impl). Acceptance grep after every task: `grep -rn "writeFile\|appendFile\|createWriteStream\|mkdir" apps/cli/src/adopt apps/cli/src/commands/adopt.ts` returns nothing.
- No new locking. The registry's persistence layer already serializes writes internally (`withDirLock` in `packages/core/src/json-directory-registry.ts:340`); the only sanctioned lock primitive in this repo, should a reviewer ever require one, is `withFileLock` (`packages/shared/src/file-lock.ts:25`, exported via `@megasaver/shared/node`, `packages/shared/src/node.ts:1`) — adopt must not hand-roll any lock.
- Redact BEFORE hash and persist: `redact()` from `@megasaver/policy` (`packages/policy/src/redact.ts:44`, replacements are `[REDACTED…]` strings, `redact.ts:84`) runs on every candidate; dedup keys on the REDACTED content (precedent `packages/core/src/brain-import.ts:46-55`).
- Single-line content invariant: the connector renderer emits `entry.content` verbatim into agent files and relies on single-line content (the CLI `contentSchema` at `apps/cli/src/commands/memory/shared.ts:17-25` blocks C0/C1/DEL/U+2028/U+2029, which includes `\n`). Adopt therefore persists `contentSchema.parse(collapseWhitespace(redacted))` — the §8 parse-on-handoff policy explicitly sanctions re-parsing here because bad content crashes/corrupts a downstream renderer.
- Linear-time parsing only: every new pattern is a literal-anchored alternation with no nested quantifiers (`wiki/concepts/unbounded-run-redos.md`); Task 3 ships the guard test.
- Deterministic: injected `now: () => string` and counter-based `newId: () => string` (the env-var single-id injection at `apps/cli/src/commands/memory/create.ts:236-238` cannot mint N ids — do NOT reuse it); fixed file order then line order; no `Date.now()` / argument-less `new Date()` in new source files.
- Tests follow `wiki/workflows/cli-test-pattern.md`: `mkdtemp` temp store AND temp fixture repo, env-slice input with `stdout`/`stderr` callbacks, flat `apps/cli/test/adopt-*.test.ts` naming (mirrors the `memory-*.test.ts` pool). No timing-tight assertions anywhere except the dedicated, calibrated ReDoS guard (Task 3).
- `apps/cli` imports core symbols only via `@megasaver/core` (it never imports `@megasaver/stats` directly — keep it that way). Internal deps use `workspace:*`; this repo uses no pnpm catalog — do not introduce one.
- Managed-block exclusion is dual: all four sentinel pairs (`packages/connectors/shared/src/constants.ts:1-8`) are stripped before parsing, AND any surviving candidate where `containsSentinel(text)` is true (`packages/connectors/shared/src/sentinel-guard.ts:31`) is skipped and counted. Upstream, `ConnectorContextSchema` independently rejects sentinel-bearing content at sync (`packages/connectors/shared/src/context.ts:61`).
- Error handling per spec: store/project errors via `mapErrorToCliMessage` (`apps/cli/src/errors.ts:126`) / `projectNotFoundMessage` (`apps/cli/src/errors.ts:50`); unreadable file → stderr warn, continue; zero files → exit 0 with empty report; per-entry `memoryEntrySchema` failure → skip, count, continue — never abort the batch mid-write (writes are per-call and non-transactional; dedup makes a partial run self-healing, precedent `brain-import.ts:44`).
- Before requesting review: `pnpm verify` green plus `pnpm --filter @megasaver/cli test`.

## File Structure

| File | Responsibility |
| --- | --- |
| apps/cli/src/adopt/scan.ts | Pure text: line-preserving sentinel-block + frontmatter strip, bullet/paragraph unit splitter with heading trail. |
| apps/cli/src/adopt/candidates.ts | Pure classification: `IMPERATIVE_LINE`, bounds constants, `collapseWhitespace`, `normalizedAdoptHash`, `deriveTitle`, `deriveKeywords`. |
| apps/cli/src/adopt/discover.ts | Deterministic file discovery + `.aider.conf.yml` `read:` pointer extraction + in-root path guard (injected fs). |
| apps/cli/src/commands/adopt.ts | `runAdopt(input): Promise<0 \| 1>` pipeline, report render, Citty `adoptCommand`. |
| apps/cli/src/main.ts | Register `adopt` in `subCommands` (modify; `apps/cli/src/main.ts:60-99`). |
| apps/cli/test/adopt-scan.test.ts | Task 1 tests. |
| apps/cli/test/adopt-candidates.test.ts | Task 2 tests. |
| apps/cli/test/adopt-redos.test.ts | Task 3 growth-ratio guard. |
| apps/cli/test/adopt-discover.test.ts | Task 4 tests. |
| apps/cli/test/adopt.test.ts | Task 5 e2e over a temp fixture repo. |
| apps/cli/test/adopt-gate-sync.test.ts | Task 6 review-gate + connector-sync round-trip. |
| .changeset/brain-adopt.md | Task 7 changeset (`@megasaver/cli` public surface grew). |

---

### Task 1: `adopt/scan.ts` — line-preserving strip + unit splitter

**Files:**
- Create: apps/cli/src/adopt/scan.ts
- Create: apps/cli/test/adopt-scan.test.ts

**Interfaces:**
- Consumes: the four sentinel pairs `MEGA_SAVER_BLOCK_START/END`, `MEGA_SAVER_CG_BLOCK_START/END`, `MEGA_SAVER_WS_BLOCK_START/END`, `MEGA_SAVER_HANDOFF_BLOCK_START/END` (`packages/connectors/shared/src/constants.ts:1-8`, re-exported by `@megasaver/connectors-shared`).
- Produces:

```ts
export type AdoptUnit = {
  text: string;          // unit text, leading list marker stripped, lines joined with "\n", trimmed
  startLine: number;     // 1-based line number in the ORIGINAL file
  headingTrail: string[]; // h1..h3 titles in force at the unit, outermost first
};
export function stripManagedBlocks(text: string): string; // line-count preserving
export function stripFrontmatter(text: string): string;   // line-count preserving
export function splitCandidates(text: string): AdoptUnit[];
```

Design decisions this task locks (both serve the `file:line` citation from spec Locked Decision 9):

- **Strips blank lines instead of removing them.** `stripManagedBlocks` and `stripFrontmatter` replace every stripped line (sentinel lines inclusive) with `""` so `startLine` keeps citing the original file without a line-map sidecar.
- **Unclosed regions blank to EOF.** An opening sentinel with no closing pair blanks the rest of the file (never adopt possibly-generated tails); a `---` frontmatter fence on line 1 with no closing fence yields a fully blanked file. ASSUMPTION: spec is silent on unclosed regions; blank-to-EOF is the conservative reading of "never adopt what conventions-sync/connector-sync generated". Flag to reviewer.
- Splitter rules: a heading `^#{1,3} ` updates the trail (a new `##` replaces the previous h2 AND clears any h3; `####`+ is body text); a list item `^[-*+] ` or `^\d+[.)] ` opens a bullet unit; subsequent indented non-blank, non-heading, non-list lines are its continuation; consecutive plain non-blank lines form a paragraph unit; blank lines terminate units. ASSUMPTION: fenced ``` code blocks get no special handling in v1 (spec is silent); out-of-bounds and human review filter the noise.

- [ ] **Step 1 (RED): write failing tests** — `apps/cli/test/adopt-scan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { splitCandidates, stripFrontmatter, stripManagedBlocks } from "../src/adopt/scan.js";

const CLAUDE_MD = [
  "# Acme Payments — agent notes",
  "",
  "## Testing discipline",
  "",
  "- Always run `pnpm test` before pushing; CI mirrors the same entry point.",
  "- Never mock the payment ledger in integration tests — use the docker",
  "  fixture instead; it seeds deterministic card numbers.",
  "",
  "The staging environment resets nightly at 03:00 UTC, so any long-lived",
  "fixture data must be recreated by the seed script before smoke runs.",
  "",
  "<!-- MEGA SAVER:BEGIN -->",
  "- Planted: managed content that must never round-trip into the store.",
  "<!-- MEGA SAVER:END -->",
].join("\n");

const MDC = [
  "---",
  "description: Frontend style rules",
  "globs:",
  '  - "src/**/*.tsx"',
  "alwaysApply: false",
  "---",
  "",
  "- Prefer function components over class components in every new module.",
  "- Avoid default exports; named exports keep refactors greppable.",
].join("\n");

describe("stripManagedBlocks", () => {
  it.each([
    ["<!-- MEGA SAVER:BEGIN -->", "<!-- MEGA SAVER:END -->"],
    ["<!-- MEGA SAVER:CONTEXT_GATE BEGIN -->", "<!-- MEGA SAVER:CONTEXT_GATE END -->"],
    ["<!-- MEGA SAVER:WARM_START BEGIN -->", "<!-- MEGA SAVER:WARM_START END -->"],
    ["<!-- MEGA SAVER:HANDOFF BEGIN -->", "<!-- MEGA SAVER:HANDOFF END -->"],
  ])("blanks %s..%s inclusive and preserves line count", (start, end) => {
    const text = ["keep me around, a real rule line", start, "- planted rule", end, "tail"].join("\n");
    const out = stripManagedBlocks(text);
    expect(out.split("\n")).toHaveLength(5);
    expect(out).not.toContain("planted");
    expect(out).not.toContain(start);
    expect(out.split("\n")[4]).toBe("tail");
  });

  it("blanks to EOF when a block never closes", () => {
    const out = stripManagedBlocks(["safe", "<!-- MEGA SAVER:BEGIN -->", "generated a", "generated b"].join("\n"));
    expect(out.split("\n")).toEqual(["safe", "", "", ""]);
  });
});

describe("stripFrontmatter", () => {
  it("blanks a --- fence on line 1 through its close, preserving line count", () => {
    const out = stripFrontmatter(MDC);
    expect(out.split("\n")).toHaveLength(MDC.split("\n").length);
    expect(out).not.toContain("alwaysApply");
    expect(out).toContain("Prefer function components");
  });

  it("leaves text without a leading fence untouched", () => {
    expect(stripFrontmatter(CLAUDE_MD)).toBe(CLAUDE_MD);
  });
});

describe("splitCandidates", () => {
  it("chunks bullets (with continuations) and paragraphs with original line numbers", () => {
    const units = splitCandidates(stripManagedBlocks(CLAUDE_MD));
    expect(units.map((u) => u.startLine)).toEqual([5, 6, 9]);
    expect(units[0]?.text).toMatch(/^Always run/);
    expect(units[1]?.text).toContain("fixture instead; it seeds deterministic card numbers.");
    expect(units[2]?.text).toMatch(/^The staging environment/);
    expect(units.some((u) => u.text.includes("Planted"))).toBe(false);
  });

  it("tracks the h1-h3 heading trail per unit", () => {
    const units = splitCandidates(stripManagedBlocks(CLAUDE_MD));
    expect(units[0]?.headingTrail).toEqual(["Acme Payments — agent notes", "Testing discipline"]);
  });

  it("a new h2 replaces the previous h2 in the trail", () => {
    const text = ["# Top", "", "## First", "", "- Never commit generated files to the repo.", "", "## Second", "", "- Always squash before merging to main branch."].join("\n");
    const units = splitCandidates(text);
    expect(units[0]?.headingTrail).toEqual(["Top", "First"]);
    expect(units[1]?.headingTrail).toEqual(["Top", "Second"]);
  });

  it("recognizes ordered-list markers and strips them from unit text", () => {
    const units = splitCandidates("1. Use conventional commits for every change in this repo.\n");
    expect(units[0]?.text).toMatch(/^Use conventional commits/);
    expect(units[0]?.startLine).toBe(1);
  });
});
```

- [ ] **Step 2: run RED** — `pnpm --filter @megasaver/cli test -- adopt-scan` fails (module does not exist).
- [ ] **Step 3 (GREEN): implement `apps/cli/src/adopt/scan.ts`** — pure, no I/O, no regex beyond literal-anchored line classifiers (`/^(#{1,3})\s+(.+)$/`, `/^([-*+]|\d+[.)])\s+/`, `/^---\s*$/`, `/^\s/` for continuation indent). Sentinel matching is `line.includes(startConst)` over the four imported pairs — string search, not regex. Sketch:

```ts
const SENTINEL_PAIRS: ReadonlyArray<readonly [string, string]> = [
  [MEGA_SAVER_BLOCK_START, MEGA_SAVER_BLOCK_END],
  [MEGA_SAVER_CG_BLOCK_START, MEGA_SAVER_CG_BLOCK_END],
  [MEGA_SAVER_WS_BLOCK_START, MEGA_SAVER_WS_BLOCK_END],
  [MEGA_SAVER_HANDOFF_BLOCK_START, MEGA_SAVER_HANDOFF_BLOCK_END],
];

export function stripManagedBlocks(text: string): string {
  const out: string[] = [];
  let closing: string | null = null;
  for (const line of text.split("\n")) {
    if (closing !== null) {
      if (line.includes(closing)) closing = null;
      out.push("");
      continue;
    }
    const pair = SENTINEL_PAIRS.find(([start]) => line.includes(start));
    if (pair !== undefined) {
      closing = pair[1];
      out.push("");
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}
```

  `splitCandidates` is a single forward pass holding `current: { lines: string[]; startLine: number } | null`, flushing on blank line / heading / new list marker; the flush joins lines, strips the leading marker from the first line, trims, and drops empty results.
- [ ] **Step 4: run GREEN** — `pnpm --filter @megasaver/cli test -- adopt-scan` passes; `pnpm --filter @megasaver/cli typecheck`.
- [ ] **Step 5: commit** — `feat(cli): adopt scan + unit splitter`

---

### Task 2: `adopt/candidates.ts` — rubric, hash, title, keywords

**Files:**
- Create: apps/cli/src/adopt/candidates.ts
- Create: apps/cli/test/adopt-candidates.test.ts

**Interfaces:**
- Consumes: `stripReservedKeywords` (`packages/core/src/session-memory.ts:130`, re-exported `packages/core/src/index.ts:92`); `titleSchema` (`packages/shared/src/title.ts:11-17` — trims, rejects C0/C1/DEL/U+2028/U+2029, NFC-normalizes); `createHash` from `node:crypto`.
- Produces:

```ts
export const ADOPT_MIN_CANDIDATE_CHARS = 24;   // spec Locked Decision 5
export const ADOPT_MAX_CANDIDATE_CHARS = 800;  // post-trim bounds
export const IMPERATIVE_LINE: RegExp;          // anchored literal alternation, spec Locked Decision 6
export function classifyConfidence(strippedFirstLine: string): "high" | "medium";
export function collapseWhitespace(text: string): string;
export function normalizedAdoptHash(redactedContent: string): string; // sha256 hex, spec Locked Decision 8
export function deriveTitle(unitText: string, headingTrail: readonly string[]): string; // titleSchema-safe, <=72 chars
export function deriveKeywords(headingTrail: readonly string[]): string[];
```

- [ ] **Step 1 (RED): write failing tests** — `apps/cli/test/adopt-candidates.test.ts`:

```ts
import { titleSchema } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import {
  ADOPT_MAX_CANDIDATE_CHARS,
  ADOPT_MIN_CANDIDATE_CHARS,
  classifyConfidence,
  collapseWhitespace,
  deriveKeywords,
  deriveTitle,
  normalizedAdoptHash,
} from "../src/adopt/candidates.js";

describe("classifyConfidence — spec rubric", () => {
  it.each([
    "Always run `pnpm test` before pushing; CI mirrors the same entry point.",
    "Never mock the payment ledger in integration tests.",
    "Don't hardcode the staging URL anywhere outside config.",
    "Do not bypass the approval gate for adopted entries.",
    "Must keep migrations reversible for one release.",
    "use kebab-case for every new file name.",
    "Prefer function components over class components.",
    "Avoid default exports; named exports keep refactors greppable.",
    "No half-implementations in a merged PR.",
    "Only the sweep command may mutate the tier field.",
    "Keep connector logic out of core.",
    "Run the seed script before smoke tests.",
  ])("imperative lead → high: %s", (line) => {
    expect(classifyConfidence(line)).toBe("high");
  });

  it.each([
    "The staging environment resets nightly at 03:00 UTC.",
    "Nothing is cached between runs by design.",   // "no" must not match inside "Nothing" (\b)
    "Usefulness of a rule decays without citations.", // "use" must not match inside "Usefulness"
  ])("prose observation → medium: %s", (line) => {
    expect(classifyConfidence(line)).toBe("medium");
  });
});

describe("normalizedAdoptHash — stable under case/whitespace", () => {
  it("collapses whitespace (incl. newlines) and lowercases before hashing", () => {
    const a = normalizedAdoptHash("Never mock the payment ledger — use\n  the docker fixture.");
    const b = normalizedAdoptHash("never MOCK the payment ledger — use the docker fixture.");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changed text changes the hash", () => {
    expect(normalizedAdoptHash("Always run pnpm test before pushing.")).not.toBe(
      normalizedAdoptHash("Always run pnpm test locally before pushing."),
    );
  });

  it("NFC-normalizes before hashing (decomposed input matches the persisted NFC comparand)", () => {
    // decomposed (e + U+0301) vs precomposed (U+00E9) — macOS paste often ships decomposed.
    expect(normalizedAdoptHash("Never de\u0301ploy on Fridays without a rollback plan.")).toBe(
      normalizedAdoptHash("Never d\u00e9ploy on Fridays without a rollback plan."),
    );
  });
});

describe("deriveTitle", () => {
  it("clips to 72 chars and stays titleSchema-valid", () => {
    const long = `Always ${"validate ".repeat(20)}inputs at the boundary`;
    const title = deriveTitle(long, ["Repo"]);
    expect(title.length).toBeLessThanOrEqual(72);
    expect(() => titleSchema.parse(title)).not.toThrow();
  });

  it("strips control characters instead of rejecting the unit", () => {
    const title = deriveTitle("Never log\x07 the raw payload to stdout channels.", []);
    expect(() => titleSchema.parse(title)).not.toThrow();
    expect(title).not.toContain("\x07");
  });

  it("falls back to the innermost heading when the first line is empty after cleaning", () => {
    expect(deriveTitle("\x01\x02", ["Acme", "Testing discipline"])).toBe("Testing discipline");
  });
});

describe("deriveKeywords", () => {
  it("tokenizes the heading trail lowercased, deduped, len>=3", () => {
    expect(deriveKeywords(["Acme Payments — agent notes", "Testing discipline"])).toEqual([
      "acme", "payments", "agent", "notes", "testing", "discipline",
    ]);
  });

  it("strips the reserved from-session: ledger namespace", () => {
    const out = deriveKeywords(["from-session:forged-capture heading"]);
    expect(out.some((k) => k.startsWith("from-session:"))).toBe(false);
  });
});

describe("bounds constants", () => {
  it("pins the spec values", () => {
    expect(ADOPT_MIN_CANDIDATE_CHARS).toBe(24);
    expect(ADOPT_MAX_CANDIDATE_CHARS).toBe(800);
  });

  it("collapseWhitespace folds runs and trims", () => {
    expect(collapseWhitespace("  a\n\n  b\tc  ")).toBe("a b c");
  });
});
```

- [ ] **Step 2: run RED** — `pnpm --filter @megasaver/cli test -- adopt-candidates` fails.
- [ ] **Step 3 (GREEN): implement `apps/cli/src/adopt/candidates.ts`**:

```ts
import { createHash } from "node:crypto";
import { stripReservedKeywords } from "@megasaver/core";
import { titleSchema } from "@megasaver/shared";

export const ADOPT_MIN_CANDIDATE_CHARS = 24;
export const ADOPT_MAX_CANDIDATE_CHARS = 800;

// Literal-anchored alternation: `^` + fixed words + `\b`. No nested
// quantifiers, no unbounded runs — linear by construction
// (wiki/concepts/unbounded-run-redos.md). Guarded by adopt-redos.test.ts.
export const IMPERATIVE_LINE =
  /^(?:always|never|don'?t|do not|must|use|prefer|avoid|no|only|keep|run)\b/i;

export function classifyConfidence(strippedFirstLine: string): "high" | "medium" {
  return IMPERATIVE_LINE.test(strippedFirstLine) ? "high" : "medium";
}

// split(/\s+/) never backtracks; the filter drops the empty leading token.
export function collapseWhitespace(text: string): string {
  return text.split(/\s+/).filter((part) => part.length > 0).join(" ");
}

export function normalizedAdoptHash(redactedContent: string): string {
  // NFC before hashing: the persisted comparand is NFC-normalized
  // (contentSchema transform, apps/cli/src/commands/memory/shared.ts:26),
  // so the dedup seed hashes NFC text — hashing raw (possibly decomposed)
  // candidate text would re-suggest already-adopted units forever.
  return createHash("sha256")
    .update(collapseWhitespace(redactedContent).normalize("NFC").toLowerCase())
    .digest("hex");
}

const TITLE_MAX = 72;

export function deriveTitle(unitText: string, headingTrail: readonly string[]): string {
  const firstLine = unitText.split("\n", 1)[0] ?? "";
  // titleSchema (packages/shared/src/title.ts) REJECTS these ranges; adopted
  // text is user prose we must not drop over one bell character, so strip.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional, mirrors titleSchema's blocklist
  const cleaned = collapseWhitespace(firstLine.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g, " "));
  const base = cleaned.length > 0 ? cleaned : (headingTrail.at(-1) ?? "Adopted rule");
  const clipped = base.length <= TITLE_MAX ? base : `${base.slice(0, TITLE_MAX - 1).trimEnd()}…`;
  return titleSchema.parse(clipped);
}

export function deriveKeywords(headingTrail: readonly string[]): string[] {
  const tokens = headingTrail
    .flatMap((heading) => heading.toLowerCase().split(/[^a-z0-9:-]+/))
    .filter((token) => token.length >= 3);
  return stripReservedKeywords([...new Set(tokens)]);
}
```

  Note the tokenizer split class keeps `:`/`-` so a forged `from-session:x` token survives tokenization intact and is then stripped by `stripReservedKeywords` — the same defense as `brain-import.ts:64-67`. (`memoryEntrySchema`'s own `keywords` transform, `packages/core/src/memory-entry.ts:64-75`, re-normalizes at parse time; harmless double-normalization.)
- [ ] **Step 4: run GREEN** — `pnpm --filter @megasaver/cli test -- adopt-candidates`.
- [ ] **Step 5: commit** — `feat(cli): adopt candidate rubric + hash`

---

### Task 3: ReDoS growth-ratio guard for the adopt patterns

**Files:**
- Create: apps/cli/test/adopt-redos.test.ts

**Interfaces:**
- Consumes: `classifyConfidence`, `collapseWhitespace` (Task 2). Instrument per `wiki/concepts/redos-growth-ratio-measurement.md` and the spec's Testing table: growth ratio, **minimise per size then divide** (never min-of-ratios, never a mean), **4x size step**, generous CI-safe bound, calibrated repeat count, explicit per-test timeout. Precedent instrument: `packages/memory-graph/test/parse-wiki-redos.test.ts`.

- [ ] **Step 1 (RED-by-mutation, then GREEN): write the guard** — this task is test-only; its "red" is demonstrated against a deliberately quadratic scratch mutation (see Step 2), its committed state is green against the shipped linear patterns.

```ts
import { describe, expect, it } from "vitest";
import { classifyConfidence, collapseWhitespace } from "../src/adopt/candidates.js";

// Growth-ratio instrument per wiki/concepts/redos-growth-ratio-measurement.md:
// minimise per SIZE across trials, then divide; 4x step so linear predicts 4.0
// and the bound of 8 leaves ~2x margin on both sides; repeat count calibrated
// from one real call (vitest cannot interrupt a synchronous loop); explicit
// timeout so a regression fails on the assertion, not the runner.
const SMALL = 64_000;
const LARGE = SMALL * 4;
const RATIO_BOUND = 8;
const TIMEOUT_MS = 120_000;
const TRIALS = 5;
const TARGET_SAMPLE_MS = 50;

function bestOf(fn: () => void): number {
  fn(); // warm-up: keep JIT compilation out of the sample
  const t0 = performance.now();
  fn();
  const one = Math.max(performance.now() - t0, 0.0001);
  const repeats = Math.max(1, Math.min(5_000, Math.ceil(TARGET_SAMPLE_MS / one)));
  let best = Number.POSITIVE_INFINITY;
  for (let trial = 0; trial < TRIALS; trial += 1) {
    const start = performance.now();
    for (let i = 0; i < repeats; i += 1) fn();
    const elapsed = (performance.now() - start) / repeats;
    if (elapsed < best) best = elapsed;
  }
  return best;
}

const SHAPES: ReadonlyArray<readonly [string, (size: number) => () => void]> = [
  // Non-matching long line: `^`-anchor must fail in O(1); a future unanchored
  // or `.*`-suffixed edit turns this into a per-offset rescan.
  ["classifyConfidence over a non-imperative run", (n) => {
    const line = "x".repeat(n);
    return () => classifyConfidence(line);
  }],
  // Matching lead word followed by a run: `\b` succeeds immediately; a future
  // nested quantifier would rescan the tail.
  ["classifyConfidence over an imperative + long tail", (n) => {
    const line = `never ${"y".repeat(n)}`;
    return () => classifyConfidence(line);
  }],
  // The whitespace-collapse named by the spec's Testing table: an alternating
  // space run is the classic unbounded-run driver.
  ["collapseWhitespace over an alternating space run", (n) => {
    const text = " a".repeat(Math.floor(n / 2));
    return () => collapseWhitespace(text);
  }],
];

describe("adopt patterns stay linear (growth-ratio guard)", () => {
  for (const [label, make] of SHAPES) {
    it(
      `${label}: t(${LARGE / 1000}KB)/t(${SMALL / 1000}KB) < ${RATIO_BOUND}`,
      () => {
        const small = bestOf(make(SMALL));
        const large = bestOf(make(LARGE));
        expect(large / small).toBeLessThan(RATIO_BOUND);
      },
      TIMEOUT_MS,
    );
  }
});
```

- [ ] **Step 2: prove the instrument bites (not committed)** — temporarily replace `IMPERATIVE_LINE` with a deliberately quadratic variant (e.g. append `(?:\s+\S+)*$` — nested quantifier over the tail) and `collapseWhitespace` with `text.replace(/(\s|\s)+/g, " ")`; run `pnpm --filter @megasaver/cli test -- adopt-redos` and record the failing ratios in the test's header comment (house precedent: measured numbers in `parse-wiki-redos.test.ts`). Revert the mutation.
- [ ] **Step 3: run GREEN** — `pnpm --filter @megasaver/cli test -- adopt-redos` passes on the shipped patterns. If the ratio proves load-sensitive under `turbo` fan-out during `pnpm verify`, do NOT loosen `RATIO_BOUND` — convert the shape to the absolute-ceiling instrument at a raised size per `wiki/concepts/redos-growth-ratio-measurement.md` ("first choice is still a ceiling") and flag the switch to the reviewer.
- [ ] **Step 4: commit** — `test(cli): adopt pattern redos guard`

---

### Task 4: `adopt/discover.ts` — deterministic discovery + aider pointers

**Files:**
- Create: apps/cli/src/adopt/discover.ts
- Create: apps/cli/test/adopt-discover.test.ts

**Interfaces:**
- Consumes: `node:path` (`resolve`, `relative`, `isAbsolute`, `sep`, `join`); injected fs for tests (spec Component 3).
- Produces:

```ts
export type AdoptDialect = "claude-md" | "agents-md" | "conventions-md" | "cursor-mdc" | "aider-read";
export type DiscoveredFile = { absPath: string; relPath: string; dialect: AdoptDialect };
export type DiscoverFs = {
  readTextFile: (absPath: string) => Promise<string>; // rejects on missing/unreadable
  listDir: (absPath: string) => Promise<string[]>;    // resolves [] on missing dir
};
export async function discoverAgentFiles(
  rootPath: string,
  fs: DiscoverFs,
  warn: (line: string) => void,
): Promise<DiscoveredFile[]>;
export function extractAiderReadPointers(confText: string): string[]; // relative path strings, order kept
```

Fixed discovery order (spec Locked Decision 10's determinism + Architecture block): `CLAUDE.md`, `AGENTS.md`, `CONVENTIONS.md`, then `.cursor/rules/*.mdc` sorted by filename, then `.aider.conf.yml` `read:` pointers in declaration order. Pointers are line-extracted (no YAML dependency): scalar `read: path.md` or a `read:` line followed by `- path.md` items. Guards: pointer targets must resolve inside `rootPath` (`relative()` result neither absolute nor starting with `..`), must end in `.md` (spec: "pointers … to extra markdown files"), and are deduped against already-discovered files by resolved path. ASSUMPTION: flow-style lists (`read: [a.md, b.md]`) are out of the "minimal line-based extraction" scope — skipped with a stderr warn. ASSUMPTION: `.markdown` extension is not accepted, only `.md` (spec names no extension list).

- [ ] **Step 1 (RED): write failing tests** — `apps/cli/test/adopt-discover.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { discoverAgentFiles, extractAiderReadPointers } from "../src/adopt/discover.js";

const ROOT = "/repo";

function memFs(files: Record<string, string>) {
  return {
    readTextFile: async (absPath: string) => {
      const rel = absPath.startsWith(`${ROOT}/`) ? absPath.slice(ROOT.length + 1) : absPath;
      const hit = files[rel];
      if (hit === undefined) throw Object.assign(new Error(`ENOENT: ${absPath}`), { code: "ENOENT" });
      return hit;
    },
    listDir: async (absPath: string) => {
      const prefix = `${absPath.slice(ROOT.length + 1)}/`;
      const names = Object.keys(files)
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length))
        .filter((k) => !k.includes("/"));
      return names;
    },
  };
}

describe("discoverAgentFiles", () => {
  it("returns the fixed dialect order with sorted .mdc files", async () => {
    const warns: string[] = [];
    const found = await discoverAgentFiles(
      ROOT,
      memFs({
        "CLAUDE.md": "# a",
        "AGENTS.md": "# b",
        "CONVENTIONS.md": "# c",
        ".cursor/rules/zz-api.mdc": "---\n---\n- rule",
        ".cursor/rules/aa-style.mdc": "---\n---\n- rule",
        ".aider.conf.yml": "read: docs/style-guide.md\n",
        "docs/style-guide.md": "- rule",
      }),
      (l) => warns.push(l),
    );
    expect(found.map((f) => f.relPath)).toEqual([
      "CLAUDE.md",
      "AGENTS.md",
      "CONVENTIONS.md",
      ".cursor/rules/aa-style.mdc",
      ".cursor/rules/zz-api.mdc",
      "docs/style-guide.md",
    ]);
    expect(found.at(-1)?.dialect).toBe("aider-read");
    expect(warns).toEqual([]);
  });

  it("tolerates missing files — a lone AGENTS.md is discovered alone", async () => {
    const found = await discoverAgentFiles(ROOT, memFs({ "AGENTS.md": "# only" }), () => {});
    expect(found.map((f) => f.relPath)).toEqual(["AGENTS.md"]);
  });

  it("skips out-of-root and absolute aider pointers with a warning", async () => {
    const warns: string[] = [];
    const found = await discoverAgentFiles(
      ROOT,
      memFs({ ".aider.conf.yml": "read:\n  - ../outside.md\n  - /etc/passwd.md\n  - docs/ok.md\n", "docs/ok.md": "x" }),
      (l) => warns.push(l),
    );
    expect(found.map((f) => f.relPath)).toEqual(["docs/ok.md"]);
    expect(warns).toHaveLength(2);
  });

  it("dedupes a pointer that names an already-discovered file", async () => {
    const found = await discoverAgentFiles(
      ROOT,
      memFs({ "CONVENTIONS.md": "# c", ".aider.conf.yml": "read: CONVENTIONS.md\n" }),
      () => {},
    );
    expect(found.map((f) => f.relPath)).toEqual(["CONVENTIONS.md"]);
  });
});

describe("extractAiderReadPointers", () => {
  it("reads scalar and dash-list forms, keeps declaration order", () => {
    expect(extractAiderReadPointers("model: x\nread: CONVENTIONS.md\n")).toEqual(["CONVENTIONS.md"]);
    expect(extractAiderReadPointers("read:\n  - docs/a.md\n  - docs/b.md\nmodel: x\n")).toEqual([
      "docs/a.md",
      "docs/b.md",
    ]);
  });

  it("ignores non-markdown targets and flow-style lists", () => {
    expect(extractAiderReadPointers("read: script.py\n")).toEqual([]);
    expect(extractAiderReadPointers("read: [a.md, b.md]\n")).toEqual([]);
  });
});
```

- [ ] **Step 2: run RED** — `pnpm --filter @megasaver/cli test -- adopt-discover` fails.
- [ ] **Step 3 (GREEN): implement `apps/cli/src/adopt/discover.ts`** — try/catch per file probe (`readTextFile` at discovery time only for `.aider.conf.yml`; the other entries are emitted as paths and read later by the pipeline, so a candidate file's own read error is Task 5's per-file isolation concern). In-root guard:

```ts
const resolvedRoot = resolve(rootPath);
const target = resolve(resolvedRoot, pointer);
const rel = relative(resolvedRoot, target);
if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) {
  warn(`adopt: skipping out-of-root aider pointer: ${pointer}`);
  continue;
}
```

  Pointer line patterns are anchored and literal: `/^read:\s*(\S.*)$/` (scalar; skip when the capture starts with `[`) and, after a bare `/^read:\s*$/`, consecutive `/^\s*-\s+(\S.*)$/` items.
- [ ] **Step 4: run GREEN** — `pnpm --filter @megasaver/cli test -- adopt-discover`.
- [ ] **Step 5: commit** — `feat(cli): adopt agent-file discovery`

---

### Task 5: `mega adopt` command — pipeline, report, registration, e2e

**Files:**
- Create: apps/cli/src/commands/adopt.ts
- Modify: apps/cli/src/main.ts (add `import { adoptCommand } from "./commands/adopt.js";` and `adopt: adoptCommand,` in `subCommands`, `apps/cli/src/main.ts:60-99`)
- Create: apps/cli/test/adopt.test.ts

**Interfaces:**
- Consumes: `resolveStorePath` / `readStoreEnv` / `ensureStoreReady` (`apps/cli/src/store.ts:17,52,79`); `mapErrorToCliMessage` / `projectNotFoundMessage` (`apps/cli/src/errors.ts:126,50`); `projectNameSchema` (`apps/cli/src/commands/shared/schemas.js`, as used by `review.ts:4,39`); `registry.listMemoryEntries` / `registry.createMemoryEntry` (`packages/core/src/registry.ts:85,83`); `memoryEntrySchema` — `.strict()` object with approval default `"approved"` and the scope↔sessionId superRefine (`packages/core/src/memory-entry.ts:77,121,89,122-138`); `memoryEntryIdSchema` (`@megasaver/shared`); `redact` (`packages/policy/src/redact.ts:44`); `containsSentinel` (`packages/connectors/shared/src/sentinel-guard.ts:31`); `contentSchema` (`apps/cli/src/commands/memory/shared.ts:17`); Tasks 1–4 modules.
- Produces:

```ts
export type RunAdoptInput = {
  projectName: string;
  storeFlag: string | undefined;
  dryRun: boolean;
  capFlag: string | undefined;      // parsed to positive int, default 100 (spec Locked Decision 10)
  jsonFlag: boolean;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  newId?: () => string;             // counter-injectable for multi-entry tests
  now?: () => string;
};
export async function runAdopt(input: RunAdoptInput): Promise<0 | 1>;
export const adoptCommand: ReturnType<typeof defineCommand>;

export type AdoptJsonReport = {
  project: string;
  dryRun: boolean;
  files: Array<{ relPath: string; units: number; suggested: number }>;
  counts: {
    suggested: number;
    deduped: number;
    skippedBounds: number;
    skippedSentinel: number;
    skippedSchema: number;
    capped: number;
  };
  entries: Array<{
    id: string | null;              // null in --dry-run
    title: string;
    confidence: "high" | "medium";
    evidence: string[];             // ["adopt:<relPath>:<line>"]
  }>;
};
```

Pipeline (spec Architecture block, order is normative): resolve store → parse project name → `ensureStoreReady` → project lookup (else `projectNotFoundMessage`, exit 1) → `discoverAgentFiles(project.rootPath, realFs, stderr)` → per file (unreadable → warn, continue): `stripManagedBlocks` → (`.mdc` only, plus any file whose first line is a `---` fence) `stripFrontmatter` → `splitCandidates` → per unit: trim-bounds filter (`< ADOPT_MIN_CANDIDATE_CHARS` or `> ADOPT_MAX_CANDIDATE_CHARS` → `skippedBounds`) → `containsSentinel` belt-and-braces (→ `skippedSentinel`) → `redact(unit.text).redacted` → single-line fold `collapseWhitespace` → `normalizedAdoptHash` → dedup against the seed set AND intra-run set (→ `deduped`) → collect. Then: slice to cap (remainder → `capped`, drained by re-running per spec Locked Decision 10) → for each kept candidate build + `memoryEntrySchema.parse` + `registry.createMemoryEntry` inside try/catch (`ZodError`/`CoreRegistryError` → `skippedSchema`, continue — never abort mid-batch) → render report, exit 0.

Dedup seed (spec Locked Decision 8 — ALL approval states, so a rejected adoption is never re-suggested; precedent `brain-import.ts:32-37`):

```ts
const existing = registry.listMemoryEntries(project.id);
const seen = new Set(
  existing.filter((m) => m.scope === "project").map((m) => normalizedAdoptHash(m.content)),
);
```

Entry construction (spec Locked Decision 9 — house create pattern, NOT `saveMemoryWithLineage`; a suggested row must not auto-close approved rows, supersession/dup handling runs at approve time):

```ts
const timestamp = now();
const entry = memoryEntrySchema.parse({
  id: memoryEntryIdSchema.parse(newId()),
  projectId: project.id,
  sessionId: null,                       // superRefine: project scope forbids sessionId
  scope: "project",
  type: "project_rule",                  // spec Locked Decision 6, all v1 entries
  title: deriveTitle(unit.text, unit.headingTrail),
  content: contentSchema.parse(singleLineRedacted),  // §8 parse-on-handoff: renderer emits this verbatim
  keywords: deriveKeywords(unit.headingTrail),
  confidence: classifyConfidence(unit.text.split("\n", 1)[0] ?? ""),
  source: "manual",                      // keeps the approve gate's human-authored path (approve-memory.ts:102)
  approval: "suggested",                 // explicit — schema defaults to "approved" (memory-entry.ts:89)
  stale: false,
  createdAt: timestamp,
  updatedAt: timestamp,
  evidence: [`adopt:${file.relPath}:${unit.startLine}`],
  relatedFiles: [file.relPath],
});
registry.createMemoryEntry(entry);
```

Human report (exact wording is authoring freedom, lock it in the tests):

```
adopt: 7 suggested, 0 deduped, 1 skipped (bounds 1, sentinel 0, schema 0), 0 capped
  CLAUDE.md: 4 unit(s), 4 suggested
  AGENTS.md: 2 unit(s), 1 suggested
  .cursor/rules/style.mdc: 2 unit(s), 2 suggested
review with: mega memory review <project>
```

- [ ] **Step 1 (RED): write failing e2e tests** — `apps/cli/test/adopt.test.ts`. Fixture helpers mirror `apps/cli/test/memory-review.test.ts:15-79` (temp store seeding) and add a temp fixture REPO whose path becomes `rootPath` in `projects.json`:

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAdopt } from "../src/commands/adopt.js";
import { runMemoryApprove } from "../src/commands/memory/approve.js";
import { runMemoryReview } from "../src/commands/memory/review.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TS = "2026-08-06T00:00:00.000Z";

const CLAUDE_MD = [
  "# Acme Payments — agent notes",
  "",
  "## Testing discipline",
  "",
  "- Always run `pnpm test` before pushing; CI mirrors the same entry point.",
  "- Never mock the payment ledger in integration tests — use the docker fixture instead.",
  "",
  "The staging environment resets nightly at 03:00 UTC, so any long-lived",
  "fixture data must be recreated by the seed script before smoke runs.",
  "",
  "<!-- MEGA SAVER:BEGIN -->",
  "- Planted: managed content that must never round-trip into the store.",
  "<!-- MEGA SAVER:END -->",
  "",
  "## Secrets",
  "",
  "- Use the vault CLI for credentials; the legacy key sk_live_abcdefghijklmnop1234 must never appear in code.",
  "",
].join("\n");

const AGENTS_MD = [
  "# Agent instructions",
  "",
  "## Build",
  "",
  "- Use `make build` for release artifacts; a plain `cargo build` skips codegen.",
  "",
  "Short line.",
  "",
].join("\n");

const STYLE_MDC = [
  "---",
  "description: Frontend style rules",
  "globs:",
  '  - "src/**/*.tsx"',
  "alwaysApply: false",
  "---",
  "",
  "- Prefer function components over class components in every new module.",
  "- Avoid default exports; named exports keep refactors greppable.",
  "",
].join("\n");

describe("runAdopt", () => {
  let store: string;
  let repo: string;
  const lines: string[] = [];
  const errLines: string[] = [];
  let seq = 0;
  const newId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

  function makeInput(over: Partial<Parameters<typeof runAdopt>[0]> = {}) {
    return {
      projectName: "demo",
      storeFlag: store,
      dryRun: false,
      capFlag: undefined,
      jsonFlag: false,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      xdgDataHome: undefined,
      platform: process.platform as NodeJS.Platform,
      localAppData: undefined,
      stdout: (line: string) => lines.push(line),
      stderr: (line: string) => errLines.push(line),
      newId,
      now: () => TS,
      ...over,
    };
  }

  function reviewInput(over: Record<string, unknown> = {}) {
    return {
      projectName: "demo",
      storeFlag: store,
      jsonFlag: true,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      xdgDataHome: undefined,
      platform: process.platform as NodeJS.Platform,
      localAppData: undefined,
      stdout: (line: string) => lines.push(line),
      stderr: (line: string) => errLines.push(line),
      ...over,
    };
  }

  async function adoptJson(over: Partial<Parameters<typeof runAdopt>[0]> = {}) {
    lines.length = 0;
    const code = await runAdopt(makeInput({ jsonFlag: true, ...over }));
    expect(code).toBe(0);
    return JSON.parse(lines.join("\n"));
  }

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-adopt-store-"));
    repo = await mkdtemp(join(tmpdir(), "megasaver-cli-adopt-repo-"));
    await mkdir(join(store, "memory"), { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([{ id: PROJECT_ID, name: "demo", rootPath: repo, createdAt: TS, updatedAt: TS }]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
    await mkdir(join(repo, ".cursor", "rules"), { recursive: true });
    await writeFile(join(repo, "CLAUDE.md"), CLAUDE_MD);
    await writeFile(join(repo, "AGENTS.md"), AGENTS_MD);
    await writeFile(join(repo, ".cursor", "rules", "style.mdc"), STYLE_MDC);
    lines.length = 0;
    errLines.length = 0;
    seq = 0;
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(repo, { recursive: true, force: true });
  });

  it("suggests typed entries with file:line citations across all three dialects", async () => {
    const report = await adoptJson();
    expect(report.counts).toEqual({
      suggested: 7, deduped: 0, skippedBounds: 1, skippedSentinel: 0, skippedSchema: 0, capped: 0,
    });
    const evidence = report.entries.flatMap((e: { evidence: string[] }) => e.evidence);
    expect(evidence).toContain("adopt:CLAUDE.md:5");
    expect(evidence).toContain("adopt:CLAUDE.md:8");   // paragraph unit
    expect(evidence).toContain("adopt:CLAUDE.md:17");
    expect(evidence).toContain("adopt:AGENTS.md:5");
    expect(evidence).toContain("adopt:.cursor/rules/style.mdc:8");
    expect(report.entries.every((e: { id: string | null }) => e.id !== null)).toBe(true);
  });

  it("persists suggested rows with house metadata, redacted single-line content", async () => {
    await adoptJson();
    const raw = await readFile(join(store, "memory", `${PROJECT_ID}.jsonl`), "utf8");
    const rows = raw.trim().split("\n").map((l) => JSON.parse(l));
    expect(rows).toHaveLength(7);
    for (const row of rows) {
      expect(row.approval).toBe("suggested");
      expect(row.source).toBe("manual");
      expect(row.scope).toBe("project");
      expect(row.sessionId).toBeNull();
      expect(row.type).toBe("project_rule");
      expect(row.content).not.toContain("\n");
    }
    expect(raw).not.toContain("sk_live_");            // redact-before-persist
    expect(raw).toContain("[REDACTED]");              // stripe_key replacement (redaction-patterns.ts:223)
    expect(raw).not.toContain("Planted");             // managed block excluded
    expect(raw).not.toContain("alwaysApply");         // .mdc frontmatter excluded
    const paragraph = rows.find((r) => r.evidence?.includes("adopt:CLAUDE.md:8"));
    expect(paragraph?.confidence).toBe("medium");
    const imperative = rows.find((r) => r.evidence?.includes("adopt:CLAUDE.md:5"));
    expect(imperative?.confidence).toBe("high");
    expect(imperative?.keywords).toContain("testing");
    expect(imperative?.relatedFiles).toEqual(["CLAUDE.md"]);
  });

  it("is idempotent: an immediate re-run suggests nothing new", async () => {
    await adoptJson();
    const second = await adoptJson();
    expect(second.counts.suggested).toBe(0);
    expect(second.counts.deduped).toBe(7);
  });

  it("a rejected adoption stays rejected: re-run still suggests 0", async () => {
    const first = await adoptJson();
    const rejectedId = first.entries[0].id as string;
    const code = await runMemoryApprove({
      ...reviewInput(), jsonFlag: false, memoryEntryId: rejectedId, approval: "rejected", now: () => TS,
    } as Parameters<typeof runMemoryApprove>[0]);
    expect(code).toBe(0);
    const rerun = await adoptJson();
    expect(rerun.counts.suggested).toBe(0);
  });

  it("editing a source line re-suggests exactly that unit", async () => {
    await adoptJson();
    await writeFile(
      join(repo, "AGENTS.md"),
      AGENTS_MD.replace("release artifacts", "release AND debug artifacts"),
    );
    const rerun = await adoptJson();
    expect(rerun.counts.suggested).toBe(1);
    expect(rerun.entries[0].evidence).toEqual(["adopt:AGENTS.md:5"]);
  });

  it("--cap writes N and reports the remainder; a re-run drains it", async () => {
    const first = await adoptJson({ capFlag: "2" });
    expect(first.counts.suggested).toBe(2);
    expect(first.counts.capped).toBe(5);
    const drain = await adoptJson();
    expect(drain.counts.suggested).toBe(5);
    expect(drain.counts.capped).toBe(0);
  });

  it("--dry-run writes nothing and reports null ids", async () => {
    const report = await adoptJson({ dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.counts.suggested).toBe(7);
    expect(report.entries.every((e: { id: string | null }) => e.id === null)).toBe(true);
    await expect(readFile(join(store, "memory", `${PROJECT_ID}.jsonl`), "utf8")).rejects.toThrow();
  });

  it("adopted entries surface in mega memory review", async () => {
    await adoptJson();
    lines.length = 0;
    const code = await runMemoryReview(reviewInput() as Parameters<typeof runMemoryReview>[0]);
    expect(code).toBe(0);
    const arr = JSON.parse(lines[0] as string) as Array<{ approval: string }>;
    expect(arr).toHaveLength(7);
    expect(arr.every((e) => e.approval === "suggested")).toBe(true);
  });

  it("an unreadable file warns on stderr and scanning continues", async () => {
    await chmod(join(repo, "CLAUDE.md"), 0o000); // add `chmod` to the node:fs/promises import
    const report = await adoptJson();
    expect(errLines.some((l) => l.includes("CLAUDE.md"))).toBe(true); // spec Error handling: warn, continue
    const evidence = report.entries.flatMap((e: { evidence: string[] }) => e.evidence);
    expect(evidence.some((ev: string) => ev.startsWith("adopt:CLAUDE.md"))).toBe(false);
    expect(report.counts.suggested).toBeGreaterThan(0); // AGENTS.md + style.mdc units still adopted
    await chmod(join(repo, "CLAUDE.md"), 0o644);        // restore so afterEach rm succeeds
  });

  it("empty repo exits 0 with an empty report", async () => {
    await rm(join(repo, "CLAUDE.md"));
    await rm(join(repo, "AGENTS.md"));
    await rm(join(repo, ".cursor"), { recursive: true });
    const report = await adoptJson();
    expect(report.counts.suggested).toBe(0);
  });

  it("returns 1 for unknown project", async () => {
    const code = await runAdopt(makeInput({ projectName: "no-such" }));
    expect(code).toBe(1);
    expect(errLines[0]).toMatch(/not found/);
  });
});
```

  Note on the missing-jsonl assertion in the dry-run test: a project with zero memory writes has no `memory/<id>.jsonl` — the store read path tolerates ENOENT (`packages/core/src/json-directory-store.ts:60`), so asserting the file's absence proves zero writes.
- [ ] **Step 2: run RED** — `pnpm --filter @megasaver/cli test -- adopt.test` fails.
- [ ] **Step 3 (GREEN): implement `apps/cli/src/commands/adopt.ts`** — `runMemoryReview` (`apps/cli/src/commands/memory/review.ts:20-71`) is the structural template for store/name/project prologue and error mapping; the Citty handler mirrors `memoryReviewCommand` (`review.ts:73-93`) with `readStoreEnv` (`store.ts:52`) plus `dry-run` (boolean), `cap` (string), `json` (boolean) args. `capFlag` parses via `z.coerce.number().int().min(1).default(100)`; a bad value maps through `mapErrorToCliMessage` to exit 1. Real fs adapter: `readTextFile: (p) => readFile(p, "utf8")`, `listDir` returning `[]` on ENOENT. Register in `apps/cli/src/main.ts` `subCommands` (alphabetical-ish placement beside `audit`).
- [ ] **Step 4: run GREEN** — `pnpm --filter @megasaver/cli test -- adopt.test`, then the read-only acceptance grep from Global Constraints, then `pnpm --filter @megasaver/cli typecheck && pnpm lint`.
- [ ] **Step 5: commit** — `feat(cli): mega adopt command`

---

### Task 6: gate + sync round-trip — approved entries propagate, loop closes

**Files:**
- Create: apps/cli/test/adopt-gate-sync.test.ts

**Interfaces:**
- Consumes: `runAdopt` (Task 5); `runMemoryApprove` (`apps/cli/src/commands/memory/approve.ts:59`; command wrappers `memoryApproveCommand`/`memoryRejectCommand` at `:134-135`); `runConnectorSync` (`apps/cli/src/commands/connector/sync.ts:47`, input type `:26-38`). Sync emits only recallable rows: `filterMemoryEntriesForSession` gates on `isRecallable` — approved + currently valid + non-archival (`apps/cli/src/commands/connector/shared.ts:43-57`, `packages/core/src/memory-entry.ts:176`) — and the block renders `entry.content` verbatim (`packages/connectors/shared/src/render.ts:32`).

Loop-closure rationale (assert it, don't assume it): a codex sync on an empty root CREATES `AGENTS.md` consisting of the sentinel block (`apps/cli/test/connector.test.ts:194-211` — created file matches `MEGA SAVER:BEGIN/END`), so a subsequent `mega adopt` strips the entire file AND the approved row's hash is already in the dedup seed — belt and braces, both asserted.

- [ ] **Step 1 (RED): write failing tests** — same store/repo scaffold as Task 5 (`store`/`repo`/`lines`/`errLines`, the `adoptJson` helper) but the repo carries ONLY `CLAUDE.md` (so sync's `AGENTS.md` is born managed). Shared input helper for `runMemoryApprove` — the store/env slice; callers spread in `memoryEntryId`/`approval`/`now` per test:

```ts
function baseInput() {
  return {
    projectName: "demo",
    storeFlag: store,
    jsonFlag: false,
    cwd: process.cwd(),
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    home: process.env["HOME"] ?? "",
    xdgDataHome: undefined,
    platform: process.platform as NodeJS.Platform,
    localAppData: undefined,
    stdout: (l: string) => lines.push(l),
    stderr: (l: string) => errLines.push(l),
  };
}

it("an approved adopted entry lands inside the sentinel block via connector sync", async () => {
  const first = await adoptJson();                       // helper as in adopt.test.ts
  const target = first.entries.find((e) => e.evidence[0] === "adopt:CLAUDE.md:6");
  await runMemoryApprove({ ...baseInput(), memoryEntryId: target.id, approval: "approved", now: () => TS });
  const code = await runConnectorSync({
    projectName: "demo", targetFlag: "codex", storeFlag: store,
    cwd: process.cwd(),
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    home: process.env["HOME"] ?? "", xdgDataHome: undefined,
    platform: process.platform as NodeJS.Platform, localAppData: undefined,
    stdout: (l) => lines.push(l), stderr: (l) => errLines.push(l), json: false,
  });
  expect(code).toBe(0);
  const agentsMd = await readFile(join(repo, "AGENTS.md"), "utf8");
  const block = agentsMd.slice(
    agentsMd.indexOf("<!-- MEGA SAVER:BEGIN -->"),
    agentsMd.indexOf("<!-- MEGA SAVER:END -->"),
  );
  expect(block).toContain("docker fixture");            // approved content, inside the block
  expect(agentsMd).not.toContain("staging environment"); // suggested row: never emitted
});

it("rejected rows are never emitted by sync", async () => {
  const first = await adoptJson();
  await runMemoryApprove({ ...baseInput(), memoryEntryId: first.entries[0].id, approval: "rejected", now: () => TS });
  await runSyncCodex();                                  // wrapper over runConnectorSync as above
  const agentsMd = await readFile(join(repo, "AGENTS.md"), "utf8");
  expect(agentsMd).not.toContain("pnpm test");           // rejected CLAUDE.md:5 content absent
});

it("re-adopt after sync suggests 0 — the sync output is not re-ingested", async () => {
  const first = await adoptJson();
  await runMemoryApprove({ ...baseInput(), memoryEntryId: first.entries[0].id, approval: "approved", now: () => TS });
  await runSyncCodex();
  const rerun = await adoptJson();
  expect(rerun.counts.suggested).toBe(0);                // sentinel strip + hash dedup, both in play
});
```

- [ ] **Step 2: run RED** — `pnpm --filter @megasaver/cli test -- adopt-gate-sync` fails only if Task 5 behavior is wrong; if it is green immediately, verify each assertion by temporarily inverting it (evidence, not vibes).
- [ ] **Step 3: run GREEN** — `pnpm --filter @megasaver/cli test -- adopt-gate-sync`; expect zero production-code changes (this task pins the cross-feature contract; any needed change belongs to Task 5 and re-runs its steps).
- [ ] **Step 4: commit** — `test(cli): adopt gate + sync round-trip`

---

### Task 7: changeset, smoke evidence, wiki, DoD gate

**Files:**
- Create: .changeset/brain-adopt.md
- Modify: wiki/log.md (append timestamped entry); wiki page for the adopt surface per wiki/CLAUDE.md ingestion rules

**Interfaces:** none new.

- [ ] **Step 1: changeset** (DoD #9 — `@megasaver/cli` public surface grew):

```md
---
"@megasaver/cli": minor
---

`mega adopt <project>` scans existing agent files (CLAUDE.md, AGENTS.md, CONVENTIONS.md, .cursor/rules/*.mdc, .aider.conf.yml read: pointers) into suggested memory entries behind the human approval gate. Deterministic, no LLM, no agent-file writes.
```

- [ ] **Step 2: full verification** — `pnpm verify` (lint + typecheck + all tests) green; paste the tail of the output into the PR/review request. Re-run the Global Constraints acceptance grep.
- [ ] **Step 3: CLI smoke evidence (§9.5)** — captured terminal session on THIS repo (it carries all three dialects on disk):

```bash
pnpm --filter @megasaver/cli build
STORE="$(mktemp -d)"
node apps/cli/dist/cli.js project create megasaver --root "$PWD" --store "$STORE"
node apps/cli/dist/cli.js adopt megasaver --dry-run --json --store "$STORE" | head -40
node apps/cli/dist/cli.js adopt megasaver --cap 5 --store "$STORE"
node apps/cli/dist/cli.js memory review megasaver --store "$STORE"
```

  Verified entry point: the plain `build` emits `dist/cli.js` — `apps/cli/tsup.config.ts` declares `entry: { cli: "src/cli.ts", "task-kickoff-worker": … }` (there is no `dist/main.js`; `dist-bundle/mega.mjs` is the separate `bundle` script's published bin). Expected: dry-run reports candidates from `CLAUDE.md`/`AGENTS.md`/`.cursor/rules/*.mdc` with `adopt:<file>:<line>` evidence and adopts nothing from any `MEGA SAVER` sentinel block in those files.
- [ ] **Step 4: wiki updates** — append `wiki/log.md` entry; add/refresh the adopt feature page citing the spec and this plan (wiki-first hard rule, CLAUDE.md §0).
- [ ] **Step 5: reviews (HIGH risk)** — request `code-reviewer` pass AND `critic` adversarial pass as separate fresh contexts (author is never reviewer); then `verifier` with the smoke transcript + `pnpm verify` output as evidence. Address feedback via `superpowers:receiving-code-review`.
- [ ] **Step 6: commit** — `chore(cli): brain-adopt changeset`

---

## Execution notes

- Task order is 1 → 2 → 3 → 4 → 5 → 6 → 7; Tasks 1/2 and 4 are mutually independent after Task 2 (3 depends on 2; 5 depends on 1–4; 6 on 5).
- Open questions in the spec (`--llm` mode, per-dialect `type` mapping, adopt MCP tool) are OUT of scope — do not implement, do not stub (§13: no half-implementations).
- If any step requires touching `packages/core`, `memoryEntrySchema`, or writing an agent file, STOP — that is the spec's escalation trigger back to spec review.

## ASSUMPTION register

1. Task 1 — unclosed sentinel block / unclosed frontmatter fence blanks to EOF (conservative; spec silent).
2. Task 1 — fenced ``` code blocks receive no special handling in v1 (spec silent; bounds + human gate filter noise).
3. Task 4 — aider flow-style `read: [a.md]` lists are skipped with a warn ("minimal line-based extraction"); only `.md` targets are accepted.
4. Task 5 — exact human-report wording is authoring freedom; the JSON report shape above is the tested contract.

(Former assumption 5 — the built smoke entry point — is resolved: `dist/cli.js`, verified against `apps/cli/tsup.config.ts`; see Task 7 Step 3.)
