# Undisclosed-Change Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `mega session disclosure <id> --text-file <f>` reconciles an agent's end-of-turn FILE-CHANGE narrative against the observed git tree delta with pure set arithmetic — deterministic linear-time path extraction on the claim side, `gatherDirtyState` ∪ commits-in-session-window on the record side, both diffs (`undisclosed` = touched-but-never-mentioned, `phantom` = mentioned-but-untouched) persisted as a per-session receipt and reported as table or `--json`. No LLM judging, no hooks touched, no blocking.
**Architecture:** All new code in `apps/cli` (spec Non-Goal: no new package). Pure modules under `apps/cli/src/commands/session/disclosure/` (`path-claims.ts`, `normalize.ts`, `reconcile.ts`, `observe.ts`, `receipt-store.ts`, `disclosure.ts`) plus one new export in the existing `apps/cli/src/git-delta.ts`. Command registered in the `session` citty group. Spec: `docs/superpowers/specs/2026-08-06-undisclosed-change-audit-design.md`.
**Tech Stack:** TypeScript strict ESM, Zod, Vitest (mkdtemp temp stores, injected fake `ExecGit`, fixture clocks — no timing-tight assertions), Citty CLI ([[workflows/cli-test-pattern]]), `redact` (`@megasaver/policy`, already a cli dependency), tmp+rename atomic write (cli precedent `apps/cli/src/hooks/intent-run.ts:111`).

## Global Constraints

- Risk MEDIUM (§12): worktree, TDD red→green per task, `code-reviewer` before merge. Escalate to HIGH if the extractor moves into a hook hot path, receipts gate/block anything, or `apps/cli/src/hooks/logger.ts` `TOOL_CATEGORY` / `ingestHookLog` (`packages/stats/src/metrics.ts:85`) must change.
- The PreToolUse hook log is NOT a data source here (verified: the logger skips Write/Edit and Bash lines carry no target). Record side is git only, via the injectable `ExecGit` seam (`apps/cli/src/git-delta.ts:4`). Tests NEVER shell out to real git — always a fake `ExecGit`.
- Every regex quantifier bounded ([[concepts/unbounded-run-redos]]); input capped at `MAX_DISCLOSURE_INPUT_BYTES = 8_388_608`; ReDoS growth-ratio guard mandatory ([[concepts/redos-guard-testing]], [[concepts/redos-growth-ratio-measurement]]): non-vacuity minimum match count, min-of-repeats timing, ratio assertion (never a lower runtime bound), explicit vitest timeout, each bound proven red alone before commit.
- Nothing from the narrative is persisted or echoed except normalized repo-relative paths; any candidate `redact()` would alter (`count > 0`) is dropped. Receipts carry paths and counts only.
- CLI error policy: message → stderr, empty stdout, exit 1; success exit 0. `CliMessage = { message; exitCode: 1 }` helpers live in `apps/cli/src/errors.ts`. Session/store failures reuse `mapErrorToCliMessage` / `sessionNotFoundMessage`.
- §3c is trivially honored: this feature imports NOTHING from `@megasaver/stats`; do not add such an import.
- Toolchain: `process.env["HOME"]`-style bracket access with the `biome-ignore lint/complexity/useLiteralKeys` line; `sessionIdSchema` (`@megasaver/shared`) is a branded lowercase UUID — filename-safe; store tests use `mkdtemp` + `rm(recursive)` per [[workflows/cli-test-pattern]].
- Conventional commits, subject ≤ 50 chars, one logical change per commit.

---

### Task 1: `gatherCommittedPaths` window scan in git-delta

**Files:**
- `apps/cli/src/git-delta.ts` (add one export)
- `apps/cli/test/git-delta.test.ts` (extend; create if the fake-`ExecGit` tests live elsewhere — search `apps/cli/test` for `gatherDirtyState` first and co-locate)

**Interfaces:**
```ts
export function gatherCommittedPaths(
  cwd: string,
  sinceIso: string,
  untilIso: string | null,
  execGit?: ExecGit,
): string[] | null;
```

Steps:

- [ ] RED — write the failing test (fake `ExecGit` records args; no real git):
```ts
import { describe, expect, it } from "vitest";
import { type ExecGit, gatherCommittedPaths } from "../src/git-delta.js";

describe("gatherCommittedPaths", () => {
  it("passes since/until, dedups paths, skips blank lines", () => {
    const calls: string[][] = [];
    const fake: ExecGit = (args) => {
      calls.push(args);
      return "src/a.ts\n\nsrc/a.ts\npnpm-lock.yaml\n";
    };
    const paths = gatherCommittedPaths(
      "/repo", "2026-08-06T10:00:00.000Z", "2026-08-06T11:00:00.000Z", fake,
    );
    expect(paths).toEqual(["src/a.ts", "pnpm-lock.yaml"]);
    expect(calls[0]).toEqual([
      "log", "--name-only", "--since=2026-08-06T10:00:00.000Z",
      "--until=2026-08-06T11:00:00.000Z", "--format=",
    ]);
  });

  it("omits --until for an open session and returns null on git failure", () => {
    const openCalls: string[][] = [];
    const open: ExecGit = (args) => {
      openCalls.push(args);
      return "";
    };
    expect(gatherCommittedPaths("/repo", "2026-08-06T10:00:00.000Z", null, open)).toEqual([]);
    expect(openCalls[0]).toEqual([
      "log", "--name-only", "--since=2026-08-06T10:00:00.000Z", "--format=",
    ]);
    const broken: ExecGit = () => {
      throw new Error("not a git repository");
    };
    expect(gatherCommittedPaths("/repo", "2026-08-06T10:00:00.000Z", null, broken)).toBeNull();
  });
});
```
- [ ] GREEN — implement in `apps/cli/src/git-delta.ts`, reusing the module's `tryGit` and `defaultExecGit`:
```ts
// Commit-window scan for the disclosure audit: repo-relative paths named by
// commits inside [sinceIso, untilIso]. null = git unavailable (fail-soft to
// the caller; an unborn HEAD also lands here and callers treat it as []).
export function gatherCommittedPaths(
  cwd: string,
  sinceIso: string,
  untilIso: string | null,
  execGit: ExecGit = defaultExecGit,
): string[] | null {
  const args = ["log", "--name-only", `--since=${sinceIso}`];
  if (untilIso !== null) args.push(`--until=${untilIso}`);
  args.push("--format=");
  const out = tryGit(execGit, args, cwd);
  if (out === null) return null;
  const paths = new Set<string>();
  for (const line of out.split("\n")) {
    const path = line.trim();
    if (path === "" || path.includes("\t")) continue;
    paths.add(path);
  }
  return [...paths];
}
```
- [ ] `pnpm --filter @megasaver/cli test` green; `pnpm --filter @megasaver/cli typecheck` green.
- [ ] Commit: `feat(cli): add gatherCommittedPaths window scan`

---

### Task 2: Claimed-path extractor

**Files:**
- `apps/cli/src/commands/session/disclosure/path-claims.ts` (new)
- `apps/cli/test/session-disclosure-path-claims.test.ts` (new)

**Interfaces:**
```ts
export const MAX_DISCLOSURE_INPUT_BYTES = 8_388_608;
export const MAX_CLAIMED_PATHS = 512;
export type ClaimMatchKind = "backtick" | "diff-header" | "bare";
export type ClaimedPath = { path: string; matchKind: ClaimMatchKind };
export function extractClaimedPaths(text: string): ClaimedPath[];
```

Steps:

- [ ] RED — failing test with per-kind positives and negatives:
```ts
import { describe, expect, it } from "vitest";
import {
  MAX_CLAIMED_PATHS,
  extractClaimedPaths,
} from "../src/commands/session/disclosure/path-claims.js";

describe("extractClaimedPaths", () => {
  it("extracts backtick paths and rejects backtick non-paths", () => {
    const text = "Updated `src/auth/login.ts` and `package.json`; ran `pnpm verify`.";
    expect(extractClaimedPaths(text)).toEqual([
      { path: "src/auth/login.ts", matchKind: "backtick" },
      { path: "package.json", matchKind: "backtick" },
    ]);
  });

  it("extracts diff headers and bare slash paths", () => {
    const text = [
      "diff --git a/src/core/session.ts b/src/core/session.ts",
      "+++ b/apps/cli/src/main.ts",
      "--- a/docs/readme.md",
      "also touched packages/policy/src/redact.ts in passing",
    ].join("\n");
    expect(extractClaimedPaths(text).map((c) => c.path)).toEqual([
      "src/core/session.ts",
      "apps/cli/src/main.ts",
      "docs/readme.md",
      "packages/policy/src/redact.ts",
    ]);
  });

  it("dedups first-kind-wins and caps at MAX_CLAIMED_PATHS", () => {
    const dup = "`src/a.ts` and then src/a.ts again";
    expect(extractClaimedPaths(dup)).toEqual([{ path: "src/a.ts", matchKind: "backtick" }]);
    const many = Array.from({ length: 600 }, (_, i) => `touched src/gen/f${i}.ts`).join("\n");
    expect(extractClaimedPaths(many)).toHaveLength(MAX_CLAIMED_PATHS);
  });

  it("does not match prose abbreviations or bare words", () => {
    expect(extractClaimedPaths("e.g. run tests, i.e. verify, no paths here")).toEqual([]);
  });
});
```
Note the last case: `e.g.`/`i.e.` must NOT match — bare-kind requires a `/`; backtick-kind filenames require a real extension shape AND backticks.
- [ ] GREEN — implement. Every quantifier bounded; no unbounded run before a required literal:
```ts
export const MAX_DISCLOSURE_INPUT_BYTES = 8_388_608;
export const MAX_CLAIMED_PATHS = 512;

export type ClaimMatchKind = "backtick" | "diff-header" | "bare";
export type ClaimedPath = { path: string; matchKind: ClaimMatchKind };

const BACKTICK_SPAN = /`([^`\n]{1,256})`/g;
const DIFF_HEADER =
  /^(?:diff --git a\/(\S{1,512}) b\/\S{1,512}|\+\+\+ b\/(\S{1,512})|--- a\/(\S{1,512}))$/gm;
// Non-global twin of DIFF_HEADER: diff-header lines are excluded from the
// bare scan, or `a/<path>` / `b/<path>` would leak in as extra bare claims.
const DIFF_LINE = /^(?:diff --git a\/\S{1,512} b\/\S{1,512}|\+\+\+ b\/\S{1,512}|--- a\/\S{1,512})$/;
const BARE_PATH = /(?<![\w.@/-])(?:[\w.@-]{1,64}\/){1,8}[\w.@-]{1,64}(?![\w.@/-])/g;
const FILENAME_SHAPE = /^[\w@-][\w.@-]{0,63}\.[A-Za-z0-9]{1,12}$/;

function backtickCandidateIsPath(span: string): boolean {
  if (/\s/.test(span)) return false;
  return span.includes("/") || FILENAME_SHAPE.test(span);
}

export function extractClaimedPaths(text: string): ClaimedPath[] {
  const seen = new Map<string, ClaimMatchKind>();
  const add = (path: string, matchKind: ClaimMatchKind): boolean => {
    if (seen.size >= MAX_CLAIMED_PATHS) return false;
    if (!seen.has(path)) seen.set(path, matchKind);
    return true;
  };
  for (const m of text.matchAll(BACKTICK_SPAN)) {
    const span = m[1];
    if (span !== undefined && backtickCandidateIsPath(span) && !add(span, "backtick")) break;
  }
  for (const m of text.matchAll(DIFF_HEADER)) {
    const path = m[1] ?? m[2] ?? m[3];
    if (path !== undefined && !add(path, "diff-header")) break;
  }
  const bareSource = text
    .split("\n")
    .filter((line) => !DIFF_LINE.test(line))
    .join("\n");
  for (const m of bareSource.matchAll(BARE_PATH)) {
    if (!add(m[0], "bare")) break;
  }
  return [...seen].map(([path, matchKind]) => ({ path, matchKind }));
}
```
`noUncheckedIndexedAccess` is why every group access is `undefined`-guarded.
Bare matches inside backtick spans are harmless: the backtick loop runs first
and dedup is first-kind-wins.
- [ ] Self-check the negative case actually passes (bare `e.g.` has no `/`; `pnpm verify` has a space) — adjust the test fixtures, never the bounds, if a fixture was wrong.
- [ ] `pnpm --filter @megasaver/cli test` green; typecheck green; `pnpm exec biome check` clean.
- [ ] Commit: `feat(cli): claimed-path extractor for disclosure`

---

### Task 3: ReDoS growth-ratio guard for the extractor

**Files:**
- `apps/cli/test/session-disclosure-redos-guard.test.ts` (new)

Steps:

- [ ] Write the guard per [[concepts/redos-growth-ratio-measurement]]: adversarial NON-matching filler dominates (a superlinear engine chokes on non-matches; matches are cheap), a small fixed number of real anchors defeats vacuity, and the result count stays BELOW `MAX_CLAIMED_PATHS` so the output cap cannot mask growth:
```ts
import { describe, expect, it } from "vitest";
import {
  MAX_CLAIMED_PATHS,
  MAX_DISCLOSURE_INPUT_BYTES,
  extractClaimedPaths,
} from "../src/commands/session/disclosure/path-claims.js";

// Guard recipe ([[concepts/redos-guard-testing]]): size at the shipped cap,
// n-vs-4n growth ratio on min-of-repeats, non-vacuity match floor, no lower
// runtime bound. Revert-proof: relaxing any bound ({1,256} -> *, {1,64} -> +,
// dropping the {1,8} segment cap) must turn THIS test red alone —
// proven manually before commit, one bound at a time.
const REPEATS = 5; // ASSUMPTION: calibrate at impl time per the wiki page (raise until minSmall >= 5ms floor)
const RATIO_LIMIT = 8; // linear scan at 4x input ~= 4x time; superlinear blows past 8

function adversarialBlock(): string {
  const anchors = [
    "`src/real/anchor.ts`",
    "+++ b/apps/cli/src/main.ts",
    "touched packages/policy/src/redact.ts",
  ].join("\n");
  const backtickTease = "`".repeat(512);
  const slashTease = `${"a/".repeat(2048)}${"-".repeat(64)}`;
  const headerTease = `diff --git a/${"x".repeat(4096)} `;
  return [anchors, backtickTease, slashTease, headerTease].join("\n");
}

function corpusOfBytes(target: number): string {
  const block = `${adversarialBlock()}\n`;
  return block.repeat(Math.ceil(target / Buffer.byteLength(block))).slice(0, target);
}

function minRuntimeMs(text: string): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < REPEATS; i += 1) {
    const start = performance.now();
    extractClaimedPaths(text);
    min = Math.min(min, performance.now() - start);
  }
  return min;
}

describe("path-claims ReDoS guard", () => {
  it(
    "scales linearly from n to 4n at the shipped cap",
    () => {
      const small = corpusOfBytes(MAX_DISCLOSURE_INPUT_BYTES / 4);
      const large = corpusOfBytes(MAX_DISCLOSURE_INPUT_BYTES);
      const smallCount = extractClaimedPaths(small).length;
      const largeCount = extractClaimedPaths(large).length;
      expect(smallCount).toBeGreaterThanOrEqual(3); // non-vacuity: anchors matched
      expect(largeCount).toBeLessThan(MAX_CLAIMED_PATHS); // cap must not short-circuit the scan
      const tSmall = minRuntimeMs(small);
      const tLarge = minRuntimeMs(large);
      expect(tLarge / Math.max(tSmall, 5)).toBeLessThan(RATIO_LIMIT);
    },
    120_000,
  );
});
```
- [ ] Prove the guard non-vacuous: temporarily change `[^`\n]{1,256}` to `[^`\n]*` plus `(\S{1,512})` to `(\S+)` (one at a time), run the guard, confirm red each time, restore. Record the observed reverted ratios in the test comment.
- [ ] Confirm `largeCount < MAX_CLAIMED_PATHS` actually holds: repeated blocks re-add the SAME anchor paths, so dedup keeps `seen` at a handful of entries and the output cap can never short-circuit the scan. If the cap is ever hit, reduce corpus anchors — never the cap.
- [ ] `pnpm --filter @megasaver/cli test` green (twice, to shake flake); no timing-tight assertions beyond the ratio.
- [ ] Commit: `test(cli): redos growth-ratio guard for extractor`

---

### Task 4: Normalization + reconciliation (pure)

**Files:**
- `apps/cli/src/commands/session/disclosure/normalize.ts` (new)
- `apps/cli/src/commands/session/disclosure/reconcile.ts` (new)
- `apps/cli/test/session-disclosure-reconcile.test.ts` (new)

**Interfaces:**
```ts
export function normalizeClaimedPath(raw: string, cwd: string): string | null;
export type DisclosureReport = {
  claimed: string[];
  observed: string[];
  undisclosed: string[];
  phantom: string[];
};
export function reconcileDisclosure(input: {
  claimed: readonly string[];
  observed: readonly string[];
}): DisclosureReport;
```

Steps:

- [ ] RED — failing tests:
```ts
import { describe, expect, it } from "vitest";
import { normalizeClaimedPath } from "../src/commands/session/disclosure/normalize.js";
import { reconcileDisclosure } from "../src/commands/session/disclosure/reconcile.js";

describe("normalizeClaimedPath", () => {
  const CWD = "/Users/dev/repo";
  it("strips quotes, line:col suffixes, ./ and backslashes", () => {
    expect(normalizeClaimedPath("./src/a.ts:12:5", CWD)).toBe("src/a.ts");
    expect(normalizeClaimedPath('"src\\b.ts"', CWD)).toBe("src/b.ts");
  });
  it("relativizes cwd-absolute, drops foreign absolute and escapes", () => {
    expect(normalizeClaimedPath("/Users/dev/repo/src/a.ts", CWD)).toBe("src/a.ts");
    expect(normalizeClaimedPath("/etc/passwd", CWD)).toBeNull();
    expect(normalizeClaimedPath("../outside.ts", CWD)).toBeNull();
    expect(normalizeClaimedPath("C:/other/x.ts", CWD)).toBeNull();
  });
  it("drops secret-shaped candidates via redact", () => {
    const jwtish =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    expect(normalizeClaimedPath(`config/${jwtish}.pem`, CWD)).toBeNull();
  });
});

describe("reconcileDisclosure", () => {
  it("computes both diffs, sorted and deduped", () => {
    const report = reconcileDisclosure({
      claimed: ["src/b.ts", "src/a.ts", "src/a.ts", "docs/x.md"],
      observed: ["src/a.ts", "pnpm-lock.yaml", "src/c.ts"],
    });
    expect(report).toEqual({
      claimed: ["docs/x.md", "src/a.ts", "src/b.ts"],
      observed: ["pnpm-lock.yaml", "src/a.ts", "src/c.ts"],
      undisclosed: ["pnpm-lock.yaml", "src/c.ts"],
      phantom: ["docs/x.md", "src/b.ts"],
    });
  });
});
```
- [ ] GREEN — `normalize.ts`:
```ts
import { redact } from "@megasaver/policy";

const LINE_COL_SUFFIX = /:\d{1,6}(?::\d{1,6})?$/;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:\//;

export function normalizeClaimedPath(raw: string, cwd: string): string | null {
  let p = raw.trim();
  if (p.length >= 2 && ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'")))) {
    p = p.slice(1, -1);
  }
  p = p.replace(LINE_COL_SUFFIX, "").replaceAll("\\", "/");
  const cwdPosix = cwd.replaceAll("\\", "/").replace(/\/{1,4}$/, "");
  if (p.startsWith(`${cwdPosix}/`)) p = p.slice(cwdPosix.length + 1);
  else if (p.startsWith("/") || WINDOWS_ABSOLUTE.test(p)) return null;
  while (p.startsWith("./")) p = p.slice(2);
  if (p === "" || p.length > 512 || /\s/.test(p)) return null;
  for (const segment of p.split("/")) {
    if (segment === "" || segment === "." || segment === "..") return null;
  }
  if (redact(p).count > 0) return null;
  return p;
}
```
`reconcile.ts`:
```ts
export type DisclosureReport = {
  claimed: string[];
  observed: string[];
  undisclosed: string[];
  phantom: string[];
};

export function reconcileDisclosure(input: {
  claimed: readonly string[];
  observed: readonly string[];
}): DisclosureReport {
  const claimed = [...new Set(input.claimed)].sort();
  const observed = [...new Set(input.observed)].sort();
  const claimedSet = new Set(claimed);
  const observedSet = new Set(observed);
  return {
    claimed,
    observed,
    undisclosed: observed.filter((p) => !claimedSet.has(p)),
    phantom: claimed.filter((p) => !observedSet.has(p)),
  };
}
```
The redact-drop fixture must be invisible to no earlier transformation (the JWT shape is a real `redact` detector — if the fixture survives, pick a shape `redact` demonstrably rewrites, and assert `redact(fixture).count > 0` inside the test so the fixture can never go stale silently).
- [ ] Tests green; typecheck; biome.
- [ ] Commit: `feat(cli): normalize and reconcile disclosure sets`

---

### Task 5: Observed tree delta

**Files:**
- `apps/cli/src/commands/session/disclosure/observe.ts` (new)
- `apps/cli/test/session-disclosure-observe.test.ts` (new)

**Interfaces:**
```ts
export type ObservedDelta = { paths: string[]; dirtyCount: number; committedCount: number };
export function observeTreeDelta(input: {
  cwd: string;
  startedAt: string;
  endedAt: string | null;
  execGit?: ExecGit;
}): ObservedDelta | null;
```

Steps:

- [ ] RED — fake `ExecGit` dispatching on `args[0]`:
```ts
import { describe, expect, it } from "vitest";
import type { ExecGit } from "../src/git-delta.js";
import { observeTreeDelta } from "../src/commands/session/disclosure/observe.js";

function fakeGit(status: string, log: string | null): ExecGit {
  return (args) => {
    if (args[0] === "status") return status;
    if (args[0] === "log") {
      if (log === null) throw new Error("unborn HEAD");
      return log;
    }
    if (args[0] === "rev-parse") return "abc123\n";
    if (args[0] === "diff") return "";
    throw new Error(`unexpected git ${args[0] ?? "<none>"}`);
  };
}

describe("observeTreeDelta", () => {
  const WINDOW = { startedAt: "2026-08-06T10:00:00.000Z", endedAt: null };

  it("unions dirty worktree paths with committed-window paths", () => {
    const status = " M src/a.ts\0?? pnpm-lock.yaml\0";
    const delta = observeTreeDelta({
      cwd: "/repo", ...WINDOW, execGit: fakeGit(status, "src/committed.ts\n"),
    });
    expect(delta).toEqual({
      paths: ["src/a.ts", "pnpm-lock.yaml", "src/committed.ts"],
      dirtyCount: 2,
      committedCount: 1,
    });
  });

  it("treats a failed log as empty but a failed status as not-a-repo", () => {
    const delta = observeTreeDelta({
      cwd: "/repo", ...WINDOW, execGit: fakeGit(" M src/a.ts\0", null),
    });
    expect(delta?.paths).toEqual(["src/a.ts"]);
    const broken: ExecGit = () => {
      throw new Error("not a git repository");
    };
    expect(observeTreeDelta({ cwd: "/repo", ...WINDOW, execGit: broken })).toBeNull();
  });
});
```
- [ ] GREEN — `observe.ts` (reuses Task 1 + the shipped `gatherDirtyState`):
```ts
import { type ExecGit, gatherCommittedPaths, gatherDirtyState } from "../../../git-delta.js";

export type ObservedDelta = { paths: string[]; dirtyCount: number; committedCount: number };

export function observeTreeDelta(input: {
  cwd: string;
  startedAt: string;
  endedAt: string | null;
  execGit?: ExecGit;
}): ObservedDelta | null {
  const dirty =
    input.execGit === undefined
      ? gatherDirtyState(input.cwd)
      : gatherDirtyState(input.cwd, input.execGit);
  if (dirty === null) return null;
  const committed =
    (input.execGit === undefined
      ? gatherCommittedPaths(input.cwd, input.startedAt, input.endedAt)
      : gatherCommittedPaths(input.cwd, input.startedAt, input.endedAt, input.execGit)) ?? [];
  const dirtyPaths = dirty.statusPaths.map((entry) => entry.path);
  return {
    paths: [...new Set([...dirtyPaths, ...committed])],
    dirtyCount: dirtyPaths.length,
    committedCount: committed.length,
  };
}
```
Note `gatherDirtyState` issues `rev-parse HEAD` and `diff` calls too — the fake must answer them (it does above).
- [ ] Tests green; typecheck; biome.
- [ ] Commit: `feat(cli): observe session tree delta`

---

### Task 6: Receipt schema + atomic store

**Files:**
- `apps/cli/src/commands/session/disclosure/receipt-store.ts` (new)
- `apps/cli/test/session-disclosure-receipt-store.test.ts` (new)

**Interfaces:**
```ts
export const DISCLOSURE_DIR = "disclosure";
export const disclosureReceiptSchema: z.ZodType<DisclosureReceipt>; // .strict() object
export type DisclosureReceipt = {
  sessionId: string;
  generatedAt: string;
  claimed: string[];
  observed: string[];
  undisclosed: string[];
  phantom: string[];
  droppedCandidates: number;
  inputBytes: number;
};
export function disclosureReceiptPath(storeRoot: string, sessionId: string): string;
export function writeDisclosureReceipt(storeRoot: string, receipt: DisclosureReceipt): void;
export function readDisclosureReceipt(storeRoot: string, sessionId: string): DisclosureReceipt | null;
```

Steps:

- [ ] RED — round-trip, malformed→null, no `.tmp` residue:
```ts
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readDisclosureReceipt,
  writeDisclosureReceipt,
} from "../src/commands/session/disclosure/receipt-store.js";

const RECEIPT = {
  sessionId: "0f8fad5b-d9cb-469f-a165-70867728950e",
  generatedAt: "2026-08-06T12:00:00.000Z",
  claimed: ["src/a.ts"],
  observed: ["src/a.ts", "pnpm-lock.yaml"],
  undisclosed: ["pnpm-lock.yaml"],
  phantom: [],
  droppedCandidates: 1,
  inputBytes: 2048,
};

describe("disclosure receipt store", () => {
  let root = "";
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "megasaver-disclosure-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("round-trips atomically with no tmp residue", async () => {
    writeDisclosureReceipt(root, RECEIPT);
    expect(readDisclosureReceipt(root, RECEIPT.sessionId)).toEqual(RECEIPT);
    const entries = await readdir(join(root, "disclosure"));
    expect(entries).toEqual([`${RECEIPT.sessionId}.json`]);
  });

  it("reads missing and malformed receipts as null", async () => {
    expect(readDisclosureReceipt(root, RECEIPT.sessionId)).toBeNull();
    writeDisclosureReceipt(root, RECEIPT);
    await writeFile(join(root, "disclosure", `${RECEIPT.sessionId}.json`), "{not json");
    expect(readDisclosureReceipt(root, RECEIPT.sessionId)).toBeNull();
  });
});
```
- [ ] GREEN — implement with Zod `.strict()` and tmp+rename (sync fs, mirroring `intent-run.ts:111`):
```ts
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const DISCLOSURE_DIR = "disclosure";

export const disclosureReceiptSchema = z
  .object({
    sessionId: z.string().min(1),
    generatedAt: z.string().min(1),
    claimed: z.array(z.string()),
    observed: z.array(z.string()),
    undisclosed: z.array(z.string()),
    phantom: z.array(z.string()),
    droppedCandidates: z.number().int().nonnegative(),
    inputBytes: z.number().int().nonnegative(),
  })
  .strict();

export type DisclosureReceipt = z.infer<typeof disclosureReceiptSchema>;

export function disclosureReceiptPath(storeRoot: string, sessionId: string): string {
  return join(storeRoot, DISCLOSURE_DIR, `${sessionId}.json`);
}

export function writeDisclosureReceipt(storeRoot: string, receipt: DisclosureReceipt): void {
  const path = disclosureReceiptPath(storeRoot, receipt.sessionId);
  mkdirSync(join(storeRoot, DISCLOSURE_DIR), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

export function readDisclosureReceipt(storeRoot: string, sessionId: string): DisclosureReceipt | null {
  try {
    const raw = readFileSync(disclosureReceiptPath(storeRoot, sessionId), "utf8");
    const parsed = disclosureReceiptSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
```
- [ ] Tests green; typecheck; biome.
- [ ] Commit: `feat(cli): persist disclosure receipts atomically`

---

### Task 7: `mega session disclosure` command + errors + registration

**Files:**
- `apps/cli/src/commands/session/disclosure/disclosure.ts` (new)
- `apps/cli/src/commands/session/index.ts` (register subcommand + re-export)
- `apps/cli/src/errors.ts` (four helpers)
- `apps/cli/test/session-disclosure.test.ts` (new)

**Interfaces:**
```ts
// errors.ts additions — message strings PINNED here (the `error:` prefix
// convention of sessionNotFoundMessage, apps/cli/src/errors.ts:57):
export function disclosureInputTooLargeMessage(): CliMessage;
// -> `error: input file exceeds ${MAX_DISCLOSURE_INPUT_BYTES} bytes`
//    i.e. "error: input file exceeds 8388608 bytes"
export function disclosureInputUnreadableMessage(path: string): CliMessage;
// -> `error: cannot read input file "${path}"`
export function disclosureReceiptNotFoundMessage(id: string): CliMessage;
// -> `error: no disclosure receipt for session "${id}" (run with --text-file first)`
export function notAGitRepoMessage(): CliMessage;
// -> "error: not a git repository"

// disclosure.ts
export type RunSessionDisclosureInput = {
  sessionId: string;
  textFile: string | undefined;
  json: boolean;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  execGit?: ExecGit;
  now?: () => string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};
export function runSessionDisclosure(input: RunSessionDisclosureInput): Promise<0 | 1>;
export const sessionDisclosureCommand: /* citty */ unknown;
```

Steps:

- [ ] RED — [[workflows/cli-test-pattern]]: exercise `runSessionDisclosure` directly with mkdtemp store, fake `ExecGit`, fixed `now`. Session seeding mirrors `apps/cli/test/session.test.ts` (`seedProject`: write `projects.json` + `sessions.json` straight into the store root — record fields `id`/`projectId`/`agentId`/`riskLevel`/`title`/`startedAt`/`endedAt`). Core shape (compute-mode happy path + oversize error path shown; extend, don't diverge):
```ts
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_DISCLOSURE_INPUT_BYTES } from "../src/commands/session/disclosure/path-claims.js";
import { readDisclosureReceipt } from "../src/commands/session/disclosure/receipt-store.js";
import { runSessionDisclosure } from "../src/commands/session/index.js";
import type { ExecGit } from "../src/git-delta.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-08-06T12:00:00.000Z";

let root: string;
let work: string;

const fakeGit: ExecGit = (args) => {
  if (args[0] === "status") return " M src/a.ts\0?? pnpm-lock.yaml\0";
  if (args[0] === "log") return "src/committed.ts\n";
  if (args[0] === "rev-parse") return "abc123\n";
  if (args[0] === "diff") return "";
  throw new Error(`unexpected git ${args[0] ?? "<none>"}`);
};

async function seedSession(): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "projects.json"),
    JSON.stringify([
      { id: PROJECT_ID, name: "demo", rootPath: "/tmp/demo", createdAt: NOW, updatedAt: NOW },
    ]),
  );
  await writeFile(
    join(root, "sessions.json"),
    JSON.stringify([
      {
        id: SESSION_ID,
        projectId: PROJECT_ID,
        agentId: "claude-code",
        riskLevel: "medium",
        title: null,
        startedAt: "2026-08-06T10:00:00.000Z",
        endedAt: null,
      },
    ]),
  );
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "megasaver-disclosure-cmd-"));
  work = await mkdtemp(join(tmpdir(), "megasaver-disclosure-work-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
});

async function run(input: { sessionId?: string; textFile?: string | undefined; json?: boolean }) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runSessionDisclosure({
    sessionId: input.sessionId ?? SESSION_ID,
    textFile: input.textFile,
    json: input.json === true,
    storeFlag: root,
    cwd: work,
    home: "/home/u",
    xdgDataHome: undefined,
    platform: "linux",
    localAppData: undefined,
    execGit: fakeGit,
    now: () => NOW,
    stdout: (l) => out.push(l),
    stderr: (l) => err.push(l),
  });
  return { code, out, err };
}

describe("mega session disclosure", () => {
  it("compute mode reconciles the narrative against the delta and persists the receipt", async () => {
    await seedSession();
    const narrative = join(work, "narrative.md");
    await writeFile(narrative, "Updated `src/a.ts` and `docs/ghost.md`.");
    const { code, out, err } = await run({ textFile: narrative });
    expect(code).toBe(0);
    expect(err).toEqual([]);
    expect(readDisclosureReceipt(root, SESSION_ID)).toMatchObject({
      sessionId: SESSION_ID,
      generatedAt: NOW,
      claimed: ["docs/ghost.md", "src/a.ts"],
      observed: ["pnpm-lock.yaml", "src/a.ts", "src/committed.ts"],
      undisclosed: ["pnpm-lock.yaml", "src/committed.ts"],
      phantom: ["docs/ghost.md"],
    });
    const text = out.join("\n");
    expect(text).toContain("undisclosed (touched, never mentioned): 2");
    expect(text).toContain("phantom (mentioned, untouched): 1");
  });

  it("rejects an oversize narrative with the pinned message and empty stdout", async () => {
    await seedSession();
    const big = join(work, "big.md");
    await writeFile(big, Buffer.alloc(MAX_DISCLOSURE_INPUT_BYTES + 1, 0x61));
    const { code, out, err } = await run({ textFile: big });
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err).toEqual(["error: input file exceeds 8388608 bytes"]);
  });
});
```
  Extend the same suite with: report-mode replay (run once with `--text-file`, again without — the persisted receipt renders identically), `--json` shape (`JSON.parse` of captured stdout equals the receipt), and the remaining error paths (unknown session via `sessionNotFoundMessage`, unreadable file via `disclosureInputUnreadableMessage`, no-receipt report mode via `disclosureReceiptNotFoundMessage`, throwing `ExecGit` via `notAGitRepoMessage`). Assert stderr got the exact pinned message and stdout stayed empty on every failure path.
- [ ] GREEN — implement `runSessionDisclosure` mirroring `runSessionShow` (`apps/cli/src/commands/session/show.ts`) end to end: `resolveStorePath` → `sessionIdSchema.parse` → `ensureStoreReady` → `registry.getSession`. Session gives the window: `startedAt` / `endedAt` (fields verified in `formatShowLines`, `apps/cli/src/commands/session/shared.ts`). Compute mode:
```ts
const stat = statSync(input.textFile);            // wrap in try/catch -> disclosureInputUnreadableMessage
if (stat.size > MAX_DISCLOSURE_INPUT_BYTES) { /* disclosureInputTooLargeMessage */ }
const text = readFileSync(input.textFile, "utf8");
const candidates = extractClaimedPaths(text);
const claimed: string[] = [];
let dropped = 0;
for (const candidate of candidates) {
  const normalized = normalizeClaimedPath(candidate.path, input.cwd);
  if (normalized === null) dropped += 1;
  else claimed.push(normalized);
}
const delta = observeTreeDelta({
  cwd: input.cwd,
  startedAt: session.startedAt,
  endedAt: session.endedAt,
  ...(input.execGit !== undefined ? { execGit: input.execGit } : {}),
});
if (delta === null) { /* notAGitRepoMessage */ }
const report = reconcileDisclosure({ claimed, observed: delta.paths });
const receipt: DisclosureReceipt = {
  sessionId: id,
  generatedAt: (input.now ?? (() => new Date().toISOString()))(),
  ...report,
  droppedCandidates: dropped,
  inputBytes: stat.size,
};
writeDisclosureReceipt(rootDir, receipt);
```
Report mode: `readDisclosureReceipt(rootDir, id)` → render or `disclosureReceiptNotFoundMessage`. Render: `--json` → `JSON.stringify(receipt, null, 2)` on stdout; table →
```
session <id> disclosure (<generatedAt>)
  claimed <n> / observed <m> / dropped <d>
  undisclosed (touched, never mentioned): <k>
    <path>…
  phantom (mentioned, untouched): <j>
    <path>…
```
The conditional-spread on `execGit` is required by `exactOptionalPropertyTypes`.
- [ ] Citty wrapper: positional `sessionId`; args `text-file` (string), `json` (boolean, default false — copy `apps/cli/src/commands/project.ts:72` shape), `store`; env-slice via `readStoreEnv` exactly as `show.ts:80`; `now` injected via `readTestEnv("MEGA_TEST_NOW")` (`session/shared.ts`). Kebab flags arrive under their kebab keys — read `args["text-file"]` (verified precedent: `args["applies-to"]` at `apps/cli/src/commands/learn.ts:116`, `args["suffix-audit"]` at `apps/cli/src/commands/cache.ts:277`, `args["install-hook"]` at `apps/cli/src/commands/memory/verify.ts:248`, `args["max-tokens"]` at `apps/cli/src/commands/context/build.ts:97`).
- [ ] Register in `apps/cli/src/commands/session/index.ts`: `disclosure: sessionDisclosureCommand` in `subCommands` + re-export `runSessionDisclosure` / `RunSessionDisclosureInput` alongside the existing pattern. Add the four helpers to `errors.ts` following `sessionNotFoundMessage`'s shape.
- [ ] One citty-level test (invalid session id through `sessionDisclosureCommand.run` with `as never`) proving arg plumbing + exit code.
- [ ] Tests green; typecheck; biome.
- [ ] Commit: `feat(cli): mega session disclosure command`

---

### Task 8: Changeset, verify, smoke evidence

**Files:**
- `.changeset/undisclosed-change-audit.md` (new)

Steps:

- [ ] Changeset (patch, `@megasaver/cli`): "mega session disclosure — reconcile end-of-turn narrative against the observed git delta; per-session receipts, --json report."
- [ ] `pnpm verify` at branch tip — lint + typecheck + all tests green. Paste the tail into the PR body.
- [ ] Smoke evidence (DoD #5, captured terminal session): in a scratch git repo with the store pointed at a temp dir — create a session, edit two files, commit one, write a narrative file mentioning one edited file plus one phantom path, run `mega session disclosure <id> --text-file narrative.txt` and again with `--json`, then replay without `--text-file`. The capture must show a non-empty `undisclosed` (the unmentioned file) and `phantom` list.
- [ ] Self-review the diff against the spec's Locked Decisions 1–6; confirm zero imports from `@megasaver/stats`, zero hook-file edits, all regex quantifiers bounded.
- [ ] Request `code-reviewer` pass (author ≠ reviewer, §9.6); then `verifier` with the smoke capture.
- [ ] Commit: `chore(cli): changeset for session disclosure`
