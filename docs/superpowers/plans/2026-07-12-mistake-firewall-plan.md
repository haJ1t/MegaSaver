# Mistake Firewall (guard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PreToolUse hook that intercepts Bash/edit tool calls matching stored failures and warns the agent mid-mistake with the estimated token cost of the original failure; plus durable auto-capture corpus, outcome feedback loop, `mega guard` CLI, `check_approach` MCP tool, and Pro-gated analytics lines.

**Architecture:** Pure matcher in core (`guard-match.ts`, three tiers T1/T2/T3), durable bounded guard corpus in context-gate (written at the existing proxy capture site), guard events JSONL in stats (warm-start-event pattern), guard state JSON in core (warm-start-state pattern), fail-open PreToolUse hook in the CLI, outcome loop hooked into the PostToolUse saver process (above `decide()`'s early returns). Spec: `docs/superpowers/specs/2026-07-12-mistake-firewall-design.md` (rev 2, architect-approved).

**Tech Stack:** TypeScript strict ESM, Zod, Vitest, Citty, pnpm/Turborepo.

---

## Ground rules for every task

- **Base branch:** `feat/warm-start` (worktree `/Users/halitozger/Desktop/MegaSaver/.claude/worktrees/warm-start`). Guard reuses warm-start files (`warm-start-state.ts`, `warm-start-event.ts`, savings shared readers, `warmupInstalled` status) that are NOT on `main` yet (PR #284 pending). Create branch `feat/guard` stacked on `feat/warm-start`. If PR #284 merges mid-work, rebase onto `main`.
- **READ HAZARD:** the local Mega Saver MCP read-proxy SILENTLY TRUNCATES file reads (banner "N kept, M dropped" / "[Mega Saver: compressed…]"), even the native Read tool. Read files with `sed -n 'A,Bp' file` in ≤60-line chunks and `grep -n` to locate. Never trust one big read. Never pass a bare `===` to echo in zsh.
- **Build before tests:** sibling packages resolve from `dist/` — run `pnpm build` at the workspace root before the first test run and after cross-package signature changes, else phantom "cannot resolve entry" failures.
- **Vitest filter caveat:** `pnpm --filter <pkg> test -- <pattern>` does NOT narrow in this repo; the package's full suite runs. Budget accordingly.
- Biome enforces import order; run `pnpm lint:fix` before committing.
- Every commit message: Conventional Commits, subject ≤50 chars, `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.

### Verified API surface used throughout (do not re-derive)

- `estimateTokens(text: string): number` — `@megasaver/output-filter` (`packages/output-filter/src/tokens.ts:17`).
- `rankBm25(input: {query, documents: {id,text}[], topN}): {id, score}[]` — `@megasaver/retrieval`; throws `RetrievalError("invalid_input")` on empty query.
- `atomicWriteFile(path, content)`, `assertSafeSegment(seg)` — `@megasaver/content-store`.
- `extractFailureSignatures(errorOutput: string): string[]` — `packages/context-gate/src/session-hints.ts:41` (NOT yet exported from the package index; Task 8 exports it).
- `CoreRegistry.listFailedAttempts(projectId)`, `.searchFailedAttempts(projectId, {text, limit, includeConverted})`, `.getFailedAttempt(id)`, `.listProjects()` — `packages/core/src/registry.ts:95-99, 71`.
- `FailedAttempt` fields: `id, projectId, sessionId, task, failedStep, errorOutput?, relatedFiles[], suspectedCause?, resolution?, convertedToRule, createdAt` (`packages/core/src/failed-attempt.ts`).
- `checkEntitlement(feature: ProFeature, {storeRoot, now: () => number, publicKey?}): {entitled: boolean, ...}` — `@megasaver/entitlement`; `ProFeature = "savings-analytics" | "brain-portability"`; fail-closed; ignores the feature arg (tier-based) — pre-existing.
- `findProjectByCwd(projects, cwd)` — `apps/cli/src/commands/warmup.ts:27` (exported).
- `resolveStorePath(readStoreEnv(undefined))`, `ensureStoreReady(rootDir): Promise<{registry, initialized}>` — `apps/cli/src/store.ts`.
- Core re-export boundary: CLI never imports `@megasaver/stats` directly — stats exports go through `packages/core/src/context-gate.ts` (see the warm-start-event block at lines 57-61). CLI MAY import `@megasaver/context-gate` directly (precedent: `saver-run.ts`; dependency-graph test forbids only `retrieval` + `stats`).
- Token→USD: `INPUT_PRICE_PER_MTOK_USD`, `formatDollarsSaved(dollars)` re-exported from `@megasaver/core` (context-gate.ts:107-121). Dollars = `(tokens / 1_000_000) * INPUT_PRICE_PER_MTOK_USD`.
- run-command capture sites: registry path `packages/context-gate/src/run-command.ts` (~289-340: `input.storeRoot`, `settings.projectId`, `redactedLabel`, `redactedErrorOutput`, `benignExit`, `now(): string` ISO, `outcome.capture.raw`); overlay path (~540-590) is registry-less (workspaceKey only) — **guard corpus writes on the registry path ONLY**.
- Dependency direction: core → context-gate (never reverse). Guard corpus lives in context-gate.

---

### Task 1: Guard corpus module (context-gate)

**Files:**
- Create: `packages/context-gate/src/guard-corpus.ts`
- Modify: `packages/context-gate/src/index.ts` (add export block)
- Test: `packages/context-gate/test/guard-corpus.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/context-gate/test/guard-corpus.test.ts
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GUARD_CORPUS_MAX,
  appendGuardCorpusRow,
  captureGuardCorpusRow,
  readGuardCorpus,
} from "../src/guard-corpus.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-07-12T10:00:00.000Z";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-guardcorpus-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: crypto.randomUUID(),
    command: "pnpm vitest --shard 2",
    errorOutput: "Error: unknown option '--shard'",
    wastedTokens: 4200,
    createdAt: NOW,
    ...over,
  } as never;
}

describe("guard corpus", () => {
  it("returns [] when nothing recorded", () => {
    expect(readGuardCorpus(root, PROJECT_ID)).toEqual([]);
  });

  it("round-trips an appended row", () => {
    appendGuardCorpusRow(root, PROJECT_ID, row({ id: "11111111-1111-4111-8111-000000000001" }));
    const rows = readGuardCorpus(root, PROJECT_ID);
    expect(rows.length).toBe(1);
    expect(rows[0]?.command).toBe("pnpm vitest --shard 2");
    expect(rows[0]?.wastedTokens).toBe(4200);
  });

  it("keeps only the newest GUARD_CORPUS_MAX rows", () => {
    for (let i = 0; i < GUARD_CORPUS_MAX + 1; i += 1) {
      appendGuardCorpusRow(root, PROJECT_ID, row({ command: `cmd-${i}` }));
    }
    const rows = readGuardCorpus(root, PROJECT_ID);
    expect(rows.length).toBe(GUARD_CORPUS_MAX);
    expect(rows[0]?.command).toBe("cmd-1"); // cmd-0 evicted
  });

  it("skips torn/garbage lines instead of crashing", () => {
    appendGuardCorpusRow(root, PROJECT_ID, row());
    appendFileSync(join(root, "guard", `${PROJECT_ID}.failures.jsonl`), "{torn\n");
    expect(readGuardCorpus(root, PROJECT_ID).length).toBe(1);
  });

  it("rejects a schema-invalid row (negative wastedTokens)", () => {
    expect(() => appendGuardCorpusRow(root, PROJECT_ID, row({ wastedTokens: -1 }))).toThrow();
  });

  it("captureGuardCorpusRow computes wastedTokens from the raw output", () => {
    captureGuardCorpusRow({
      storeRoot: root,
      projectId: PROJECT_ID,
      command: "tsc -b",
      errorOutput: "error TS2322",
      raw: "x".repeat(400), // estimateTokens = ceil(400/4) = 100
      now: NOW,
    });
    expect(readGuardCorpus(root, PROJECT_ID)[0]?.wastedTokens).toBe(100);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @megasaver/context-gate test`
Expected: FAIL — cannot resolve `../src/guard-corpus.js`.

- [ ] **Step 3: Implement**

```typescript
// packages/context-gate/src/guard-corpus.ts
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertSafeSegment, atomicWriteFile } from "@megasaver/content-store";
import { estimateTokens } from "@megasaver/output-filter";
import { z } from "zod";

// Durable, bounded, per-project auto-capture corpus for the Mistake Firewall
// (spec 2026-07-12 §3.1). Unlike SessionFailure (session-scoped, wiped on
// endSession) and overlay failures (per-live-session), these rows survive so
// the guard hook can warn across sessions. Bounded like overlay-failures:
// append keeps only the newest rows in one atomic rewrite.
export const GUARD_CORPUS_MAX = 200;

export const guardCorpusRowSchema = z
  .object({
    id: z.string().uuid(),
    command: z.string().min(1), // redacted label, argv-joined (same value SessionFailure stores)
    errorOutput: z.string(), // redacted, ≤4000 chars (caller slices, same as SessionFailure)
    wastedTokens: z.number().int().nonnegative(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type GuardCorpusRow = z.infer<typeof guardCorpusRowSchema>;

function guardCorpusPath(storeRoot: string, projectId: string): string {
  assertSafeSegment(projectId);
  return join(storeRoot, "guard", `${projectId}.failures.jsonl`);
}

export function readGuardCorpus(storeRoot: string, projectId: string): GuardCorpusRow[] {
  let raw: string;
  try {
    raw = readFileSync(guardCorpusPath(storeRoot, projectId), "utf8");
  } catch {
    return [];
  }
  const rows: GuardCorpusRow[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const checked = guardCorpusRowSchema.safeParse(parsed);
    if (checked.success) rows.push(checked.data);
  }
  return rows;
}

export function appendGuardCorpusRow(
  storeRoot: string,
  projectId: string,
  row: GuardCorpusRow,
): void {
  const checked = guardCorpusRowSchema.parse(row);
  const kept = [...readGuardCorpus(storeRoot, projectId), checked].slice(-GUARD_CORPUS_MAX);
  atomicWriteFile(
    guardCorpusPath(storeRoot, projectId),
    `${kept.map((r) => JSON.stringify(r)).join("\n")}\n`,
  );
}

export type CaptureGuardCorpusInput = {
  storeRoot: string;
  projectId: string;
  command: string; // already redacted by the caller
  errorOutput: string; // already redacted + capped by the caller
  raw: string; // full raw output — wastedTokens is estimated from THIS
  now: string; // ISO
};

// One-call helper for the run-command capture site: prices the failure from
// the full raw output (estimated tokens), not the 4000-char evidence slice.
export function captureGuardCorpusRow(input: CaptureGuardCorpusInput): void {
  appendGuardCorpusRow(input.storeRoot, input.projectId, {
    id: randomUUID(),
    command: input.command,
    errorOutput: input.errorOutput,
    wastedTokens: estimateTokens(input.raw),
    createdAt: input.now,
  });
}
```

Add to `packages/context-gate/src/index.ts` (after the overlay-failures export block that ends at line ~71):

```typescript
export {
  GUARD_CORPUS_MAX,
  type CaptureGuardCorpusInput,
  type GuardCorpusRow,
  appendGuardCorpusRow,
  captureGuardCorpusRow,
  guardCorpusRowSchema,
  readGuardCorpus,
} from "./guard-corpus.js";
```

- [ ] **Step 4: Build + run tests**

Run: `pnpm build && pnpm --filter @megasaver/context-gate test`
Expected: PASS (all 6 new tests + existing suite green).

- [ ] **Step 5: Commit**

```bash
git add packages/context-gate/src/guard-corpus.ts packages/context-gate/src/index.ts packages/context-gate/test/guard-corpus.test.ts
git commit -m "feat(context-gate): durable bounded guard corpus store"
```

---

### Task 2: Capture-site wiring (run-command registry path)

**Files:**
- Modify: `packages/context-gate/src/run-command.ts` (registry path only, inside the existing `if (!benignExit)` block near line 330)
- Test: extend the existing run-command failure-capture test

- [ ] **Step 1: Locate the insertion point and the existing test**

Run: `grep -n "createSessionFailure\|benignExit" packages/context-gate/src/run-command.ts` — the registry-path capture block is the FIRST hit cluster (~lines 310-340; the second cluster ~560-590 is the overlay path — DO NOT touch it, it has no projectId).
Run: `grep -rn "createSessionFailure\|SessionFailure" packages/context-gate/test/*.ts | head` to find the existing test that exercises a failing command through the registry path.

- [ ] **Step 2: Write the failing test**

In the test file found above, locate the existing case that asserts a SessionFailure is captured for a non-zero exit (fixture already builds a registry port + runs a failing command). Duplicate that case (same fixture, new name) and add the corpus assertion:

```typescript
import { readGuardCorpus } from "../src/guard-corpus.js";

// inside the duplicated failing-command test, after the existing SessionFailure assertions:
const corpus = readGuardCorpus(storeRoot, PROJECT_ID); // use the fixture's storeRoot + project id vars
expect(corpus.length).toBe(1);
expect(corpus[0]?.command).toBe(/* the same redacted label the SessionFailure assertion uses */);
expect(corpus[0]?.wastedTokens).toBeGreaterThan(0);
```

Also add one negative case: the benign-exit fixture (exit 1, no output — grep the test file for `benignExit` or "benign") must leave the corpus empty: `expect(readGuardCorpus(storeRoot, PROJECT_ID)).toEqual([]);`

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @megasaver/context-gate test`
Expected: FAIL — corpus length 0.

- [ ] **Step 4: Wire the capture**

In `run-command.ts`, add the import (respect biome import order — it sorts within the relative-import group):

```typescript
import { captureGuardCorpusRow } from "./guard-corpus.js";
```

Inside the registry path's `if (!benignExit) { ... }` block, AFTER the existing `try { input.registry.createSessionFailure({...}) } catch ...` block, add:

```typescript
      // Durable guard-corpus twin of the ephemeral SessionFailure above: the
      // Mistake Firewall matches against this across sessions (spec §3.1).
      // Same best-effort contract — a corpus write failure never breaks
      // command-output delivery.
      try {
        captureGuardCorpusRow({
          storeRoot: input.storeRoot,
          projectId: settings.projectId,
          command: redactedLabel,
          errorOutput: redactedErrorOutput,
          raw: outcome.capture.raw,
          now: now(),
        });
      } catch (err) {
        captureWarnings.push(`guard corpus capture skipped: ${messageOf(err)}`);
      }
```

- [ ] **Step 5: Build + run tests**

Run: `pnpm build && pnpm --filter @megasaver/context-gate test`
Expected: PASS, including both new cases and every pre-existing run-command test.

- [ ] **Step 6: Commit**

```bash
git add packages/context-gate/src/run-command.ts packages/context-gate/test/
git commit -m "feat(context-gate): capture guard corpus rows on proxy failure"
```

---

### Task 3: Pure matcher — guard-match (core)

**Files:**
- Create: `packages/core/src/guard-match.ts`
- Modify: `packages/core/src/index.ts` (export block at end)
- Test: `packages/core/test/guard-match.test.ts`

- [ ] **Step 1: Write the failing table-driven test suite** (this suite is the tuning authority — the matcher tests ARE the spec)

```typescript
// packages/core/test/guard-match.test.ts
import type { GuardCorpusRow } from "@megasaver/context-gate";
import { describe, expect, it } from "vitest";
import type { FailedAttempt } from "../src/failed-attempt.js";
import {
  type GuardCandidate,
  matchGuard,
  normalizeCommand,
} from "../src/guard-match.js";

const ASOF = "2026-07-12T10:00:00.000Z";
const FRESH = "2026-07-01T10:00:00.000Z"; // 11 days old
const STALE = "2026-06-01T10:00:00.000Z"; // 41 days old

function attempt(over: Partial<FailedAttempt> = {}): GuardCandidate {
  return {
    kind: "failed-attempt",
    attempt: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      projectId: "11111111-1111-4111-8111-111111111111",
      sessionId: null,
      task: "run the test shard",
      failedStep: "pnpm vitest --shard 2",
      errorOutput: "Error: unknown option '--shard'",
      relatedFiles: [],
      convertedToRule: false,
      createdAt: FRESH,
      ...over,
    } as FailedAttempt,
  };
}

function corpusRow(over: Partial<GuardCorpusRow> = {}): GuardCandidate {
  return {
    kind: "auto-capture",
    row: {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      command: "pnpm vitest --shard 2",
      errorOutput: "Error: unknown option '--shard'",
      wastedTokens: 4200,
      createdAt: FRESH,
      ...over,
    },
  };
}

function bash(command: string, candidates: GuardCandidate[], over = {}) {
  return matchGuard({
    call: { tool: "Bash", command },
    candidates,
    mutedIds: [],
    firedIds: [],
    asOf: ASOF,
    ...over,
  });
}

describe("normalizeCommand", () => {
  it("collapses whitespace runs and trims", () => {
    expect(normalizeCommand("  pnpm   vitest  --shard 2 ")).toBe("pnpm vitest --shard 2");
  });
  it("strips leading env-assignment prefixes", () => {
    expect(normalizeCommand("CI=1 NODE_ENV=test pnpm vitest")).toBe("pnpm vitest");
  });
  it("does NOT reorder flags (deferred, semantic risk)", () => {
    expect(normalizeCommand("ls -a -l")).not.toBe(normalizeCommand("ls -l -a"));
  });
});

describe("T1 exact", () => {
  it("hits on whitespace + env-prefix variants of a corpus command", () => {
    const m = bash("CI=1  pnpm  vitest --shard 2", [corpusRow()]);
    expect(m?.tier).toBe("t1");
    expect(m?.action).toBe("deny-capable");
  });
  it("hits on a FailedAttempt whose failedStep normalizes to the command", () => {
    const m = bash("pnpm vitest --shard 2", [attempt()]);
    expect(m?.tier).toBe("t1");
  });
  it("misses when the candidate is older than 30 days (falls to T3 at most)", () => {
    const m = bash("pnpm vitest --shard 2", [corpusRow({ createdAt: STALE })]);
    expect(m?.tier).not.toBe("t1");
  });
  it("30-day boundary is strict: exactly 30 days old does NOT T1-match", () => {
    const m = bash("pnpm vitest --shard 2", [
      corpusRow({ createdAt: "2026-06-12T10:00:00.000Z" }),
    ]);
    expect(m?.tier).not.toBe("t1");
  });
  it("resolved FailedAttempt never denies — emits recall instead", () => {
    const m = bash("pnpm vitest --shard 2", [attempt({ resolution: "use --shard=2/2" })]);
    expect(m?.action).toBe("recall");
  });
  it("documented miss: quoting is lost in stored argv-joins", () => {
    // stored corpus command has no quotes; the live command with quotes
    // normalizes differently — expected miss at T1 (may still T3-match).
    const m = bash('grep "foo bar" x', [corpusRow({ command: "grep foo bar x" })]);
    expect(m?.tier).not.toBe("t1");
  });
});

describe("exclusions", () => {
  it("muted ids never match", () => {
    const c = corpusRow();
    const m = bash("pnpm vitest --shard 2", [c], {
      mutedIds: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
    });
    expect(m).toBeNull();
  });
  it("already-fired ids never match (per-session cooldown)", () => {
    const m = bash("pnpm vitest --shard 2", [corpusRow()], {
      firedIds: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
    });
    expect(m).toBeNull();
  });
  it("convertedToRule attempts are excluded everywhere", () => {
    const m = bash("pnpm vitest --shard 2", [attempt({ convertedToRule: true })]);
    expect(m).toBeNull();
  });
});

describe("T2 path (edit tools, two-signal)", () => {
  const editAttempt = attempt({
    failedStep: "edited token refresh to use < instead of <=",
    relatedFiles: ["src/auth/middleware.ts"],
    errorOutput: "TokenExpiredError: jwt expired",
  });
  function edit(filePath: string, text: string) {
    return matchGuard({
      call: { tool: "Edit", filePath, text },
      candidates: [editAttempt],
      mutedIds: [],
      firedIds: [],
      asOf: ASOF,
    });
  }
  it("warns when path intersects relatedFiles AND text BM25-matches", () => {
    const m = edit("/repo/src/auth/middleware.ts", "token refresh expired jwt check");
    expect(m?.tier).toBe("t2");
    expect(m?.action).toBe("warn");
  });
  it("misses on path-only (no text signal)", () => {
    expect(edit("/repo/src/auth/middleware.ts", "completely unrelated edit zzz qqq")).toBeNull();
  });
  it("misses on text-only (no path signal)", () => {
    expect(edit("/repo/src/other/file.ts", "token refresh expired jwt check")).toBeNull();
  });
});

describe("T3 BM25 (Bash, conservative)", () => {
  it("warns on a near-verbatim replay of a stale-but-relevant failure", () => {
    const m = bash("pnpm vitest run --shard 2 --reporter dot", [
      corpusRow({ createdAt: STALE }),
    ]);
    expect(m?.tier).toBe("t3");
    expect(m?.action).toBe("warn");
  });
  it("misses on prose that merely mentions a command word", () => {
    expect(bash("echo done", [corpusRow({ createdAt: STALE })])).toBeNull();
  });
  it("misses when top-1 has no margin over top-2 (ambiguous corpus)", () => {
    const a = corpusRow({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      command: "pnpm vitest run suite-a",
      errorOutput: "timeout in suite-a",
      createdAt: STALE,
    });
    const b = corpusRow({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      command: "pnpm vitest run suite-b",
      errorOutput: "timeout in suite-b",
      createdAt: STALE,
    });
    expect(bash("pnpm vitest run", [a, b])).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @megasaver/core test`
Expected: FAIL — `guard-match.js` not found.

- [ ] **Step 3: Implement the matcher**

```typescript
// packages/core/src/guard-match.ts
import type { GuardCorpusRow } from "@megasaver/context-gate";
import { rankBm25 } from "@megasaver/retrieval";
import type { FailedAttempt } from "./failed-attempt.js";

// Pure, deterministic Mistake Firewall matcher (spec 2026-07-12 §3.2). No
// I/O, no clock reads — the caller passes `asOf`. Three tiers, first hit
// wins. The table-driven test suite in guard-match.test.ts is the tuning
// authority for the constants below.
export const GUARD_T1_MAX_AGE_DAYS = 30;
export const GUARD_T3_MIN_SCORE = 1.5;
export const GUARD_T3_MARGIN = 1.5;

export type GuardCandidate =
  | { kind: "failed-attempt"; attempt: FailedAttempt }
  | { kind: "auto-capture"; row: GuardCorpusRow };

export type GuardToolCall =
  | { tool: "Bash"; command: string }
  | { tool: "Edit" | "Write" | "MultiEdit" | "NotebookEdit"; filePath: string; text: string };

export type GuardMatchInput = {
  call: GuardToolCall;
  candidates: GuardCandidate[];
  mutedIds: string[];
  firedIds: string[];
  asOf: string;
};

export type GuardMatch = {
  candidate: GuardCandidate;
  tier: "t1" | "t2" | "t3";
  action: "warn" | "deny-capable" | "recall";
};

const ENV_PREFIX = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/;

export function normalizeCommand(command: string): string {
  return command.trim().replace(ENV_PREFIX, "").replace(/\s+/g, " ").trim();
}

export function guardCandidateId(candidate: GuardCandidate): string {
  return candidate.kind === "failed-attempt" ? candidate.attempt.id : candidate.row.id;
}

export function guardCandidateCreatedAt(candidate: GuardCandidate): string {
  return candidate.kind === "failed-attempt"
    ? candidate.attempt.createdAt
    : candidate.row.createdAt;
}

export function guardCandidateErrorOutput(candidate: GuardCandidate): string {
  return candidate.kind === "failed-attempt"
    ? (candidate.attempt.errorOutput ?? "")
    : candidate.row.errorOutput;
}

function candidateCommand(candidate: GuardCandidate): string {
  return candidate.kind === "failed-attempt"
    ? candidate.attempt.failedStep
    : candidate.row.command;
}

function candidateResolution(candidate: GuardCandidate): string | undefined {
  return candidate.kind === "failed-attempt" ? candidate.attempt.resolution : undefined;
}

// FailedAttempt text surface mirrors searchFailedAttempts; corpus rows use
// command + errorOutput.
function candidateText(candidate: GuardCandidate): string {
  if (candidate.kind === "auto-capture") {
    return `${candidate.row.command} ${candidate.row.errorOutput}`;
  }
  const a = candidate.attempt;
  return `${a.task} ${a.failedStep} ${a.errorOutput ?? ""} ${a.suspectedCause ?? ""}`;
}

function ageDays(createdAt: string, asOf: string): number {
  return (Date.parse(asOf) - Date.parse(createdAt)) / 86_400_000;
}

// Normalized relative-path suffix match: "/repo/src/auth/x.ts" hits
// "src/auth/x.ts" and vice versa; "auth/x.ts" vs "other/x.ts" misses.
function pathsIntersect(filePath: string, relatedFiles: readonly string[]): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "");
  const a = norm(filePath);
  return relatedFiles.some((rel) => {
    const b = norm(rel);
    const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
    return longer === shorter || longer.endsWith(`/${shorter}`);
  });
}

function bm25Top(
  query: string,
  candidates: GuardCandidate[],
): { first: { candidate: GuardCandidate; score: number } | null; second: number } {
  if (query.trim() === "" || candidates.length === 0) return { first: null, second: 0 };
  const byId = new Map(candidates.map((c) => [guardCandidateId(c), c]));
  const ranked = rankBm25({
    query,
    documents: candidates.map((c) => ({ id: guardCandidateId(c), text: candidateText(c) })),
    topN: 2,
  }).filter((hit) => hit.score > 0);
  const top = ranked[0];
  if (top === undefined) return { first: null, second: 0 };
  const candidate = byId.get(top.id);
  if (candidate === undefined) return { first: null, second: 0 };
  return { first: { candidate, score: top.score }, second: ranked[1]?.score ?? 0 };
}

export function matchGuard(input: GuardMatchInput): GuardMatch | null {
  const excluded = new Set([...input.mutedIds, ...input.firedIds]);
  const candidates = input.candidates.filter(
    (c) =>
      !excluded.has(guardCandidateId(c)) &&
      !(c.kind === "failed-attempt" && c.attempt.convertedToRule),
  );
  if (candidates.length === 0) return null;

  if (input.call.tool === "Bash") {
    const normalized = normalizeCommand(input.call.command);
    // T1 exact: unresolved + younger than 30 days (strict <) → deny-capable;
    // resolved matches emit positive recall instead.
    for (const c of candidates) {
      if (normalizeCommand(candidateCommand(c)) !== normalized) continue;
      if (candidateResolution(c) !== undefined) {
        return { candidate: c, tier: "t1", action: "recall" };
      }
      if (ageDays(guardCandidateCreatedAt(c), input.asOf) < GUARD_T1_MAX_AGE_DAYS) {
        return { candidate: c, tier: "t1", action: "deny-capable" };
      }
    }
    // T3 BM25: conservative threshold + top-1 margin.
    const { first, second } = bm25Top(normalized, candidates);
    if (
      first !== null &&
      first.score >= GUARD_T3_MIN_SCORE &&
      (second === 0 || first.score >= GUARD_T3_MARGIN * second)
    ) {
      const action = candidateResolution(first.candidate) !== undefined ? "recall" : "warn";
      return { candidate: first.candidate, tier: "t3", action };
    }
    return null;
  }

  // T2 path (edit tools): FailedAttempt-only, BOTH signals required.
  const withPath = candidates.filter(
    (c): c is Extract<GuardCandidate, { kind: "failed-attempt" }> =>
      c.kind === "failed-attempt" &&
      c.attempt.relatedFiles.length > 0 &&
      pathsIntersect((input.call as { filePath: string }).filePath, c.attempt.relatedFiles),
  );
  const { first } = bm25Top((input.call as { text: string }).text, withPath);
  if (first !== null) {
    const action = candidateResolution(first.candidate) !== undefined ? "recall" : "warn";
    return { candidate: first.candidate, tier: "t2", action };
  }
  return null;
}
```

Add to `packages/core/src/index.ts` (end of file, after the warm-start block):

```typescript
export {
  GUARD_T1_MAX_AGE_DAYS,
  GUARD_T3_MARGIN,
  GUARD_T3_MIN_SCORE,
  type GuardCandidate,
  type GuardMatch,
  type GuardMatchInput,
  type GuardToolCall,
  guardCandidateCreatedAt,
  guardCandidateErrorOutput,
  guardCandidateId,
  matchGuard,
  normalizeCommand,
} from "./guard-match.js";
```

- [ ] **Step 4: Build + run + tune**

Run: `pnpm build && pnpm --filter @megasaver/core test`
Expected: PASS. If a T3 table case fails, tune `GUARD_T3_MIN_SCORE` / `GUARD_T3_MARGIN` — the table wins, precision beats recall (a miss is acceptable; a false warn is not). Do not weaken a test to make a constant work.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/guard-match.ts packages/core/src/index.ts packages/core/test/guard-match.test.ts
git commit -m "feat(core): three-tier guard matcher with table-driven suite"
```

---

### Task 4: Guard state (core)

**Files:**
- Create: `packages/core/src/guard-state.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/guard-state.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/test/guard-state.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_GUARD_STATE,
  GUARD_STATE_MAX_SESSIONS,
  readGuardState,
  writeGuardState,
} from "../src/guard-state.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-guardstate-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("guard state", () => {
  it("returns null when no state file exists", () => {
    expect(readGuardState(root, PROJECT_ID)).toBeNull();
  });

  it("round-trips a written state", () => {
    const state = {
      ...DEFAULT_GUARD_STATE,
      mode: "strict" as const,
      mutedIds: ["x"],
      sessions: {
        s1: {
          firedIds: ["x"],
          intercepts: { e1: { command: "c", signatures: ["TS2322"], candidateId: "x" } },
        },
      },
    };
    writeGuardState(root, PROJECT_ID, state);
    expect(readGuardState(root, PROJECT_ID)).toEqual(state);
  });

  it("returns null on corrupt/wrong-shape file instead of throwing", () => {
    mkdirSync(join(root, "guard"), { recursive: true });
    writeFileSync(join(root, "guard", `${PROJECT_ID}.json`), "{not json");
    expect(readGuardState(root, PROJECT_ID)).toBeNull();
    writeFileSync(join(root, "guard", `${PROJECT_ID}.json`), JSON.stringify({ mode: "nope" }));
    expect(readGuardState(root, PROJECT_ID)).toBeNull();
  });

  it("evicts the oldest sessions beyond GUARD_STATE_MAX_SESSIONS on write", () => {
    const sessions: Record<string, { firedIds: string[]; intercepts: Record<string, never> }> = {};
    for (let i = 0; i <= GUARD_STATE_MAX_SESSIONS; i += 1) {
      sessions[`s${i}`] = { firedIds: [], intercepts: {} };
    }
    writeGuardState(root, PROJECT_ID, { ...DEFAULT_GUARD_STATE, sessions });
    const read = readGuardState(root, PROJECT_ID);
    expect(Object.keys(read?.sessions ?? {}).length).toBe(GUARD_STATE_MAX_SESSIONS);
    expect(read?.sessions["s0"]).toBeUndefined(); // insertion-order eviction
  });

  it("write never throws on an unwritable root (best-effort)", () => {
    expect(() => writeGuardState("/nonexistent/nope", PROJECT_ID, DEFAULT_GUARD_STATE)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @megasaver/core test` → module not found.

- [ ] **Step 3: Implement**

```typescript
// packages/core/src/guard-state.ts
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

// Small advisory state for the Mistake Firewall (spec §3.4): mode, mutes,
// per-session cooldown, and intercept context for the outcome loop. Pattern
// cloned from warm-start-state.ts: null on missing/corrupt, tmp+rename write,
// no fsync. Concurrent writers (guard hook, saver outcome step, CLI) are
// last-writer-wins by design — a lost strike is advisory, corruption is what
// tmp+rename prevents.
export const GUARD_STATE_MAX_SESSIONS = 20;

const sessionEntrySchema = z
  .object({
    firedIds: z.array(z.string()),
    // intercepts: interceptEventId -> the normalized command, the ORIGINAL
    // failure's signatures (outcome classification), and the matched candidate
    // id (auto-mute strike key) — all captured at intercept time so the
    // PostToolUse outcome step needs no registry/corpus read.
    intercepts: z.record(
      z
        .object({
          command: z.string(),
          signatures: z.array(z.string()),
          candidateId: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

const guardStateSchema = z
  .object({
    mode: z.enum(["warn", "strict"]),
    mutedIds: z.array(z.string()),
    autoMuted: z.record(z.number().int().nonnegative()),
    sessions: z.record(sessionEntrySchema),
  })
  .strict();

export type GuardState = z.infer<typeof guardStateSchema>;

export const DEFAULT_GUARD_STATE: GuardState = {
  mode: "warn",
  mutedIds: [],
  autoMuted: {},
  sessions: {},
};

function statePath(rootDir: string, projectId: string): string {
  return join(rootDir, "guard", `${projectId}.json`);
}

export function readGuardState(rootDir: string, projectId: string): GuardState | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(statePath(rootDir, projectId), "utf8"));
    const parsed = guardStateSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeGuardState(rootDir: string, projectId: string, state: GuardState): void {
  try {
    const keys = Object.keys(state.sessions);
    const kept =
      keys.length > GUARD_STATE_MAX_SESSIONS ? keys.slice(-GUARD_STATE_MAX_SESSIONS) : keys;
    const sessions = Object.fromEntries(kept.map((k) => [k, state.sessions[k] ?? { firedIds: [], intercepts: {} }]));
    const dir = join(rootDir, "guard");
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `.${randomUUID()}.tmp`);
    writeFileSync(tmp, JSON.stringify({ ...state, sessions }));
    renameSync(tmp, statePath(rootDir, projectId));
  } catch {
    // best-effort — advisory state, never blocks a hook
  }
}
```

Add to `packages/core/src/index.ts`:

```typescript
export {
  DEFAULT_GUARD_STATE,
  GUARD_STATE_MAX_SESSIONS,
  type GuardState,
  readGuardState,
  writeGuardState,
} from "./guard-state.js";
```

- [ ] **Step 4: Build + test** — `pnpm build && pnpm --filter @megasaver/core test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/guard-state.ts packages/core/src/index.ts packages/core/test/guard-state.test.ts
git commit -m "feat(core): guard state file with session cooldown"
```

---

### Task 5: Guard events (stats) + core re-export

**Files:**
- Create: `packages/stats/src/guard-event.ts`
- Modify: `packages/stats/src/index.ts` (grep the warm-start-event export line and mirror it), `packages/core/src/context-gate.ts` (extend the stats allow-list block at lines 57-61)
- Test: `packages/stats/test/guard-event.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/stats/test/guard-event.test.ts
import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendGuardEvent,
  guardEventSchema,
  readGuardEvents,
} from "../src/guard-event.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-guardevent-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function intercept(over: Partial<Record<string, unknown>> = {}) {
  return guardEventSchema.parse({
    type: "intercept",
    id: "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1",
    projectId: PROJECT_ID,
    sessionId: "s1",
    matchedId: "f1",
    matchedKind: "auto-capture",
    normalizedCommand: "pnpm vitest --shard 2",
    tier: "t1",
    action: "warn",
    avoidedTokens: 4200,
    estimated: true,
    createdAt: "2026-07-12T10:00:00.000Z",
    ...over,
  });
}

describe("GuardEvent", () => {
  it("append/read round-trips intercept and outcome rows", () => {
    appendGuardEvent({ root }, intercept());
    appendGuardEvent(
      { root },
      guardEventSchema.parse({
        type: "outcome",
        id: "e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2",
        projectId: PROJECT_ID,
        sessionId: "s1",
        interceptId: "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1",
        outcome: "overridden-ok",
        createdAt: "2026-07-12T10:01:00.000Z",
      }),
    );
    const events = readGuardEvents({ root }, PROJECT_ID);
    expect(events.map((e) => e.type)).toEqual(["intercept", "outcome"]);
  });

  it("throws StatsError schema_invalid on a malformed event", () => {
    expect(() =>
      appendGuardEvent({ root }, { type: "intercept", id: "x" } as never),
    ).toThrowError(expect.objectContaining({ code: "schema_invalid" }));
  });

  it("skips torn lines", () => {
    appendGuardEvent({ root }, intercept());
    const path = join(root, "stats", PROJECT_ID, "guard.events.jsonl");
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, "{torn\n");
    expect(readGuardEvents({ root }, PROJECT_ID).length).toBe(1);
  });

  it("rejects estimated:false — guard numbers are estimates by contract", () => {
    expect(guardEventSchema.safeParse({ ...intercept(), estimated: false }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @megasaver/stats test` → module not found.

- [ ] **Step 3: Implement** (clone `warm-start-event.ts` shape exactly — `StatsError` import from `./errors.js`)

```typescript
// packages/stats/src/guard-event.ts
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProjectId } from "@megasaver/shared";
import { projectIdSchema } from "@megasaver/shared";
import { z } from "zod";
import { StatsError } from "./errors.js";

// Mistake Firewall analytics ledger (spec §3.3). Deliberately NOT a
// TokenSaverEvent: avoidedTokens is an ESTIMATE of the original failure's
// output cost, never a measured byte-savings — mixing them would poison the
// honest savings pipeline. Append-only: outcomes are separate rows referencing
// interceptId; `heeded` = an intercept with no outcome row, computed at read
// time. Never read on the PreToolUse hot path (cooldown lives in guard state).
export const guardEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("intercept"),
      id: z.string().uuid(),
      projectId: projectIdSchema,
      sessionId: z.string().min(1),
      matchedId: z.string().min(1),
      matchedKind: z.enum(["failed-attempt", "auto-capture"]),
      normalizedCommand: z.string().nullable(),
      tier: z.enum(["t1", "t2", "t3"]),
      action: z.enum(["warn", "deny", "recall"]),
      avoidedTokens: z.number().int().nonnegative(),
      estimated: z.literal(true),
      createdAt: z.string().datetime({ offset: true }),
    })
    .strict(),
  z
    .object({
      type: z.literal("outcome"),
      id: z.string().uuid(),
      projectId: projectIdSchema,
      sessionId: z.string().min(1),
      interceptId: z.string().uuid(),
      outcome: z.enum(["overridden-ok", "overridden-failed", "overridden"]),
      createdAt: z.string().datetime({ offset: true }),
    })
    .strict(),
]);

export type GuardEvent = z.infer<typeof guardEventSchema>;

type StoreRoot = { root: string };

function guardEventsPath(store: StoreRoot, projectId: ProjectId): string {
  return join(store.root, "stats", projectId, "guard.events.jsonl");
}

export function appendGuardEvent(store: StoreRoot, event: GuardEvent): void {
  const parsed = guardEventSchema.safeParse(event);
  if (!parsed.success) {
    throw new StatsError("schema_invalid");
  }
  const path = guardEventsPath(store, parsed.data.projectId);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(parsed.data)}\n`);
}

export function readGuardEvents(store: StoreRoot, projectId: ProjectId): GuardEvent[] {
  const path = guardEventsPath(store, projectId);
  if (!existsSync(path)) return [];
  const events: GuardEvent[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = guardEventSchema.safeParse(raw);
    if (parsed.success) events.push(parsed.data);
  }
  return events;
}
```

Export from `packages/stats/src/index.ts` (mirror the warm-start-event line — grep `warm-start-event` there):

```typescript
export { appendGuardEvent, guardEventSchema, readGuardEvents, type GuardEvent } from "./guard-event.js";
```

Extend the allow-list block in `packages/core/src/context-gate.ts` (append to the block at lines 57-61):

```typescript
export {
  appendGuardEvent,
  appendWarmStartEvent,
  readGuardEvents,
  readWarmStartEvents,
  type GuardEvent,
  type WarmStartEvent,
} from "@megasaver/stats";
```

- [ ] **Step 4: Build + test** — `pnpm build && pnpm --filter @megasaver/stats test && pnpm --filter @megasaver/core test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/stats/src/guard-event.ts packages/stats/src/index.ts packages/stats/test/guard-event.test.ts packages/core/src/context-gate.ts
git commit -m "feat(stats): guard event ledger with outcome rows"
```

---

### Task 6: Guard PreToolUse hook (CLI)

**Files:**
- Create: `apps/cli/src/hooks/guard-run.ts`, `apps/cli/src/commands/hooks/guard.ts`
- Modify: `apps/cli/src/commands/hooks/index.ts` (import + export + subCommands entry, mirror `warmup`)
- Test: `apps/cli/test/hooks/guard-run.test.ts`

Prerequisite for this task: `extractFailureSignatures` must be importable from `@megasaver/context-gate`. Add to `packages/context-gate/src/index.ts`:

```typescript
export { MAX_SIGNATURES_PER_SESSION, extractFailureSignatures } from "./session-hints.js";
```

- [ ] **Step 1: Write the failing test**

```typescript
// apps/cli/test/hooks/guard-run.test.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendGuardCorpusRow } from "@megasaver/context-gate";
import { readGuardEvents, readGuardState, writeGuardState, DEFAULT_GUARD_STATE } from "@megasaver/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildGuardHookOutput } from "../../src/hooks/guard-run.js";
import { ensureStoreReady } from "../../src/store.js";

const NOW = "2026-07-12T10:00:00.000Z";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-guardhook-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function seed(rootPath: string) {
  const { registry } = await ensureStoreReady(root);
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath,
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
  return registry;
}

function corpusRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    command: "pnpm vitest --shard 2",
    errorOutput: "Error: unknown option '--shard' in src/run.ts",
    wastedTokens: 4200,
    createdAt: "2026-07-11T10:00:00.000Z",
    ...over,
  } as never;
}

function bashPayload(command: string) {
  return {
    session_id: "s1",
    cwd: "/work/demo",
    tool_name: "Bash",
    tool_input: { command },
  };
}

function call(payload: unknown) {
  return buildGuardHookOutput({ payload, storeRoot: root, now: () => Date.parse(NOW) });
}

describe("buildGuardHookOutput", () => {
  it("warns via additionalContext on a T1 corpus match, never permissionDecision", async () => {
    await seed("/work/demo");
    appendGuardCorpusRow(root, PROJECT_ID, corpusRow());
    const out = JSON.parse(await call(bashPayload("pnpm vitest --shard 2")));
    expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(out.hookSpecificOutput.additionalContext).toContain("Mistake Firewall");
    expect(out.hookSpecificOutput.additionalContext).toContain("2026-07-11");
    expect(out.hookSpecificOutput.additionalContext).toContain("4200 tokens");
    expect(out.hookSpecificOutput.permissionDecision).toBeUndefined();
  });

  it("denies only in strict mode on T1", async () => {
    await seed("/work/demo");
    appendGuardCorpusRow(root, PROJECT_ID, corpusRow());
    writeGuardState(root, PROJECT_ID, { ...DEFAULT_GUARD_STATE, mode: "strict" });
    const out = JSON.parse(await call(bashPayload("pnpm vitest --shard 2")));
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("mega guard mode warn");
  });

  it("appends an intercept event and cooldown state on warn", async () => {
    await seed("/work/demo");
    appendGuardCorpusRow(root, PROJECT_ID, corpusRow());
    await call(bashPayload("pnpm vitest --shard 2"));
    const events = readGuardEvents({ root }, PROJECT_ID as never);
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({ type: "intercept", tier: "t1", action: "warn", estimated: true });
    const state = readGuardState(root, PROJECT_ID);
    expect(state?.sessions["s1"]?.firedIds).toContain("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    const interceptEntry = Object.values(state?.sessions["s1"]?.intercepts ?? {})[0];
    expect(interceptEntry?.command).toBe("pnpm vitest --shard 2");
    expect(interceptEntry?.signatures).toContain("src/run.ts");
    expect(interceptEntry?.candidateId).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  });

  it("same candidate fires once per session (cooldown)", async () => {
    await seed("/work/demo");
    appendGuardCorpusRow(root, PROJECT_ID, corpusRow());
    await call(bashPayload("pnpm vitest --shard 2"));
    const second = await call(bashPayload("pnpm vitest --shard 2"));
    expect(second).toBe("");
  });

  it("fail-open: empty output on bad payload, missing project, or mid-flight throw", async () => {
    expect(await call({ nope: true })).toBe("");
    await seed("/work/demo");
    expect(await call({ ...bashPayload("ls"), cwd: "/nowhere" })).toBe("");
    // unreadable store root → internal throw → ""
    expect(
      await buildGuardHookOutput({
        payload: bashPayload("ls"),
        storeRoot: "/nonexistent/nope",
        now: () => Date.parse(NOW),
      }),
    ).toBe("");
  });

  it("ignores non-matched tools and empty stores silently", async () => {
    await seed("/work/demo");
    expect(await call({ ...bashPayload("ls"), tool_name: "Read" })).toBe("");
    expect(await call(bashPayload("ls"))).toBe(""); // empty corpus, no failed attempts
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @megasaver/cli test` (build first: `pnpm build`) → module not found.

- [ ] **Step 3: Implement**

```typescript
// apps/cli/src/hooks/guard-run.ts
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  DEFAULT_GUARD_STATE,
  INPUT_PRICE_PER_MTOK_USD,
  type GuardCandidate,
  type GuardMatch,
  appendGuardEvent,
  formatDollarsSaved,
  guardCandidateCreatedAt,
  guardCandidateErrorOutput,
  guardCandidateId,
  matchGuard,
  normalizeCommand,
  readGuardState,
  writeGuardState,
} from "@megasaver/core";
import { extractFailureSignatures, readGuardCorpus } from "@megasaver/context-gate";
import { estimateTokens } from "@megasaver/output-filter";
import { z } from "zod";
import { findProjectByCwd } from "../commands/warmup.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../store.js";

const GUARDED_EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

const preToolUsePayloadSchema = z
  .object({
    session_id: z.string(),
    cwd: z.string(),
    tool_name: z.string(),
    tool_input: z.unknown(),
  })
  .passthrough();

export type BuildGuardHookInput = {
  payload: unknown;
  storeRoot: string;
  now: () => number;
};

function asStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

// The edit-context text for the T2 BM25 signal: whatever content fields the
// edit tool carries, joined.
function editText(input: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of ["new_string", "content", "old_string"]) {
    const v = asStr(input[key]);
    if (v !== undefined) parts.push(v);
  }
  const edits = input["edits"];
  if (Array.isArray(edits)) {
    for (const e of edits) {
      if (typeof e === "object" && e !== null) {
        const v = asStr((e as Record<string, unknown>)["new_string"]);
        if (v !== undefined) parts.push(v);
      }
    }
  }
  return parts.join(" ");
}

function dollarLine(avoidedTokens: number): string {
  if (avoidedTokens <= 0) return "";
  const dollars = (avoidedTokens / 1_000_000) * INPUT_PRICE_PER_MTOK_USD;
  return ` That failure cost ~${avoidedTokens} tokens (~${formatDollarsSaved(dollars)}, estimated).`;
}

function warnText(match: GuardMatch, avoidedTokens: number): string {
  const c = match.candidate;
  const date = guardCandidateCreatedAt(c).slice(0, 10);
  const tail = guardCandidateErrorOutput(c).trim().slice(-200);
  const cause =
    c.kind === "failed-attempt" && c.attempt.suspectedCause !== undefined
      ? ` Suspected cause: ${c.attempt.suspectedCause}.`
      : "";
  const failed = tail === "" ? "" : ` — failed: ${tail}`;
  return `⛨ Mistake Firewall: you tried this on ${date}${failed}.${cause}${dollarLine(avoidedTokens)} Cumulative retry-cost avoided: mega roi (Pro).`;
}

function recallText(match: GuardMatch): string {
  const resolution =
    match.candidate.kind === "failed-attempt" ? (match.candidate.attempt.resolution ?? "") : "";
  return `⛨ Mistake Firewall: you solved this before: ${resolution}`;
}

function avoidedTokensOf(candidate: GuardCandidate): number {
  if (candidate.kind === "auto-capture") return candidate.row.wastedTokens;
  const err = candidate.attempt.errorOutput;
  return err === undefined ? 0 : estimateTokens(err);
}

// Contract identical to buildWarmupHookOutput: NEVER throws — every failure
// returns "" so a PreToolUse hook can never break a tool call.
export async function buildGuardHookOutput(input: BuildGuardHookInput): Promise<string> {
  try {
    const parsed = preToolUsePayloadSchema.safeParse(input.payload);
    if (!parsed.success) return "";
    const { session_id: sessionId, cwd, tool_name: tool } = parsed.data;
    const ti =
      typeof parsed.data.tool_input === "object" && parsed.data.tool_input !== null
        ? (parsed.data.tool_input as Record<string, unknown>)
        : {};

    let call: import("@megasaver/core").GuardToolCall;
    if (tool === "Bash") {
      const command = asStr(ti["command"]);
      if (command === undefined || command.trim() === "") return "";
      call = { tool: "Bash", command };
    } else if (GUARDED_EDIT_TOOLS.has(tool)) {
      const filePath = asStr(ti["file_path"]) ?? asStr(ti["notebook_path"]);
      if (filePath === undefined) return "";
      call = { tool: tool as "Edit", filePath, text: editText(ti) };
    } else {
      return "";
    }

    const { registry } = await ensureStoreReady(input.storeRoot);
    const project = findProjectByCwd(registry.listProjects(), cwd);
    if (project === null) return "";

    const nowIso = new Date(input.now()).toISOString();
    const state = readGuardState(input.storeRoot, project.id) ?? DEFAULT_GUARD_STATE;
    const session = state.sessions[sessionId] ?? { firedIds: [], intercepts: {} };

    const candidates: GuardCandidate[] = [
      ...registry.listFailedAttempts(project.id).map((attempt) => ({ kind: "failed-attempt" as const, attempt })),
      ...readGuardCorpus(input.storeRoot, project.id).map((row) => ({ kind: "auto-capture" as const, row })),
    ];
    const match = matchGuard({
      call,
      candidates,
      mutedIds: state.mutedIds,
      firedIds: session.firedIds,
      asOf: nowIso,
    });
    if (match === null) return "";

    const deny = state.mode === "strict" && match.action === "deny-capable";
    const avoidedTokens = avoidedTokensOf(match.candidate);
    const text = match.action === "recall" ? recallText(match) : warnText(match, avoidedTokens);
    const eventId = randomUUID();
    const candidateId = guardCandidateId(match.candidate);

    // Best-effort side writes — a ledger/state failure never suppresses the warn.
    try {
      appendGuardEvent(
        { root: input.storeRoot },
        {
          type: "intercept",
          id: eventId,
          projectId: project.id,
          sessionId,
          matchedId: candidateId,
          matchedKind: match.candidate.kind,
          normalizedCommand: call.tool === "Bash" ? normalizeCommand(call.command) : null,
          tier: match.tier,
          action: deny ? "deny" : match.action === "recall" ? "recall" : "warn",
          avoidedTokens,
          estimated: true,
          createdAt: nowIso,
        },
      );
    } catch {
      /* advisory */
    }
    try {
      const intercepts = { ...session.intercepts };
      if (call.tool === "Bash" && match.action !== "recall") {
        intercepts[eventId] = {
          command: normalizeCommand(call.command),
          signatures: extractFailureSignatures(guardCandidateErrorOutput(match.candidate)),
          candidateId,
        };
      }
      writeGuardState(input.storeRoot, project.id, {
        ...state,
        sessions: {
          ...state.sessions,
          [sessionId]: { firedIds: [...session.firedIds, candidateId], intercepts },
        },
      });
    } catch {
      /* advisory */
    }

    if (deny) {
      return JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `${text} Override: mega guard mute ${candidateId} — or mega guard mode warn.`,
        },
      });
    }
    // NEVER "allow" — that would bypass the user's permission system.
    return JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: text },
    });
  } catch {
    return "";
  }
}

function readStdinSync(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

// Always exits 0; empty stdout on any failure (PreToolUse "no output" = no
// injection, tool call proceeds untouched).
export async function runGuardHookFromProcess(): Promise<void> {
  process.exitCode = 0;
  try {
    const raw = readStdinSync().trim();
    if (raw === "") return;
    const payload: unknown = JSON.parse(raw);
    const storeRoot = resolveStorePath(readStoreEnv(undefined));
    const text = await buildGuardHookOutput({ payload, storeRoot, now: () => Date.now() });
    if (text !== "") process.stdout.write(text);
  } catch {
    // Swallow — fail-open.
  }
}
```

```typescript
// apps/cli/src/commands/hooks/guard.ts
import { defineCommand } from "citty";
import { runGuardHookFromProcess } from "../../hooks/guard-run.js";

// The command Claude Code's PreToolUse hook invokes for Bash/edit tools.
// Reads the PreToolUse payload on stdin; prints a hookSpecificOutput JSON
// (warn additionalContext or strict-mode deny) when a stored failure matches.
// SAFETY: ALWAYS exits 0; prints nothing on any error. Wired by
// `mega hooks install`, not run by hand.
export const hooksGuardCommand = defineCommand({
  meta: {
    name: "guard",
    description: "Internal: Mistake Firewall PreToolUse interceptor (stdin payload).",
  },
  async run() {
    await runGuardHookFromProcess();
  },
});
```

In `apps/cli/src/commands/hooks/index.ts`: add `import { hooksGuardCommand } from "./guard.js";`, `export { hooksGuardCommand } from "./guard.js";`, and `guard: hooksGuardCommand,` in `subCommands` (mirror the `warmup` lines exactly).

- [ ] **Step 4: Build + test** — `pnpm build && pnpm --filter @megasaver/cli test` → PASS (full CLI suite; slow, expected).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/hooks/guard-run.ts apps/cli/src/commands/hooks/guard.ts apps/cli/src/commands/hooks/index.ts apps/cli/test/hooks/guard-run.test.ts packages/context-gate/src/index.ts
git commit -m "feat(cli): fail-open guard PreToolUse hook"
```

---

### Task 7: Hook install plumbing (connector + CLI flags)

**Files:**
- Modify: `packages/connectors/claude-code/src/hook-settings.ts`, `apps/cli/src/commands/hooks/install.ts`, `apps/cli/src/commands/hooks/status.ts` (mirror warmup rendering — grep `warmup` in it), `apps/cli/src/commands/hooks/uninstall.ts` only if it names hooks explicitly (grep first; the connector function does the work)
- Test: `packages/connectors/claude-code/test/hook-settings.test.ts` additions; `apps/cli/test/hooks/install.test.ts` additions

- [ ] **Step 1: Write the failing connector tests** (append to `hook-settings.test.ts`, clone the existing warmup describe block found via `grep -n "warmup" packages/connectors/claude-code/test/hook-settings.test.ts`)

```typescript
describe("guard hook", () => {
  it("addGuardHook adds a second PreToolUse entry with the guard matcher", () => {
    const next = addGuardHook(
      addPreToolUseHook({}, "mega hooks log"),
      "mega hooks guard",
    ) as { hooks: { PreToolUse: { matcher?: string; hooks: { command: string }[] }[] } };
    expect(next.hooks.PreToolUse.length).toBe(2);
    expect(next.hooks.PreToolUse[1]?.matcher).toBe(GUARD_HOOK_MATCHER);
    expect(next.hooks.PreToolUse[1]?.hooks[0]?.command).toBe("mega hooks guard");
  });

  it("hasGuardHook does not confuse the log entry for the guard entry", () => {
    const withLog = addPreToolUseHook({}, "mega hooks log");
    expect(hasGuardHook(withLog, GUARD_HOOK_COMMAND)).toBe(false);
    expect(hasGuardHook(addGuardHook(withLog, GUARD_HOOK_COMMAND), GUARD_HOOK_COMMAND)).toBe(true);
  });

  it("install writes guard by default; guard:false skips it; uninstall removes it", () => {
    // clone the existing warmup install/uninstall test bodies, swapping
    // warmup→guard, WARMUP_HOOK_COMMAND→GUARD_HOOK_COMMAND, and asserting
    // via hasGuardHook + readClaudeCodeHookStatus(...).guardInstalled.
  });

  it("status reports guardInstalled without folding it into connected", () => {
    // clone the warmupInstalled status test, asserting guardInstalled and
    // that connected stays pre+post+intent only.
  });
});
```

(The two cloned bodies above must be written out fully by copying the neighbouring warmup tests — they exist in the same file; this is a copy-adapt, not an invention.)

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @megasaver/connector-claude-code test` → symbols not exported.

- [ ] **Step 3: Implement in `hook-settings.ts`**

Constants (next to `WARMUP_HOOK_COMMAND`):

```typescript
export const GUARD_HOOK_COMMAND = "mega hooks guard";
// Guard runs ONLY on mutating tools — never Read/Grep/etc. Anchored for the
// same substring-compile reason as HOOK_MATCHER.
export const GUARD_HOOK_MATCHER = "^(?:Bash|Edit|Write|MultiEdit|NotebookEdit)$";
```

`buildHookCommand` union: `"log" | "saver" | "intent" | "warmup" | "guard"`.

New functions (place after `removeSessionStartHook`; `addPreToolUseHook` hardcodes `HOOK_MATCHER`, so guard gets its own — `repairEntry` keys on the subcommand ("guard" vs "log"), so the two PreToolUse entries never collide):

```typescript
export function hasGuardHook(settings: unknown, command: string): boolean {
  if (typeof settings !== "object" || settings === null) return false;
  const pre = (settings as SettingsObject).hooks?.PreToolUse;
  return Array.isArray(pre) && pre.some((e) => entryMatchesSubcommand(e, subcommandOf(command)));
}

export function addGuardHook(settings: unknown, command: string): SettingsObject {
  const sub = subcommandOf(command);
  const desired: CommandHook = { type: "command", command, timeout: timeoutFor(sub) };
  const next = asSettings(settings);
  const existingPre = next.hooks?.PreToolUse;
  if (Array.isArray(existingPre)) {
    const repaired = repairEntry(existingPre as ToolUseEntry[], sub, GUARD_HOOK_MATCHER, desired);
    if (repaired !== null) {
      next.hooks = { ...next.hooks, PreToolUse: repaired };
      return next;
    }
  }
  const hooks = next.hooks ? { ...next.hooks } : {};
  const pre = Array.isArray(existingPre) ? [...(existingPre as ToolUseEntry[])] : [];
  pre.push({ matcher: GUARD_HOOK_MATCHER, hooks: [desired] });
  next.hooks = { ...hooks, PreToolUse: pre };
  return next;
}

export function removeGuardHook(settings: unknown, command: string): SettingsObject {
  const next = asSettings(settings);
  const existing = next.hooks?.PreToolUse;
  if (!Array.isArray(existing)) return next;
  const kept = stripCommand(existing as ToolUseEntry[], subcommandOf(command));
  return pruneHooks(next, "PreToolUse", kept);
}
```

`InstallClaudeCodeHookInput`: add `guard?: boolean`. In `installClaudeCodeHook`, after the warmup line:

```typescript
  if (input.guard !== false) {
    next = addGuardHook(next, buildHookCommand("guard", cfg));
  }
```

In `uninstallClaudeCodeHook`: add `!hasGuardHook(existing, GUARD_HOOK_COMMAND)` to the no-op condition and `next = removeGuardHook(next, GUARD_HOOK_COMMAND);` to the removal chain.

`ClaudeCodeHookStatus`: add `guardInstalled: boolean`; in `readClaudeCodeHookStatus` compute `const guardInstalled = hasGuardHook(settings, GUARD_HOOK_COMMAND);`, return it, and add `guardInstalled: false` to the catch branch. `connected` stays `pre && post && intent`.

**CLI:** in `install.ts` — `RunHooksInstallInput` gains `guard?: boolean`; pass `...(input.guard !== undefined ? { guard: input.guard } : {})` into `installClaudeCodeHook`; add the arg `noGuard: { type: "boolean", default: false, description: "Skip the Mistake Firewall PreToolUse hook." }` and `guard: !args.noGuard` in the run wrapper (mirror `noWarmup`). In `status.ts`, mirror every `warmupInstalled` render line with `guardInstalled` (grep `warmup` there — both text and json branches). `uninstall.ts` needs no change if it only calls `uninstallClaudeCodeHook` (verify with grep; adjust the printed summary line if it lists hook names).

- [ ] **Step 4: Add the CLI-level install test** — in `apps/cli/test/hooks/install.test.ts`, clone the `--no-warmup` test (grep `noWarmup`) into a `--no-guard` twin asserting `hasGuardHook` false after install with `guard: false` and true by default.

- [ ] **Step 5: Build + test** — `pnpm build && pnpm --filter @megasaver/connector-claude-code test && pnpm --filter @megasaver/cli test` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/connectors/claude-code/src/hook-settings.ts packages/connectors/claude-code/test/hook-settings.test.ts apps/cli/src/commands/hooks/install.ts apps/cli/src/commands/hooks/status.ts apps/cli/test/hooks/install.test.ts
git commit -m "feat(connector): install guard PreToolUse hook by default"
```

---

### Task 8: Outcome loop (saver process extension)

**Files:**
- Create: `apps/cli/src/hooks/guard-outcome.ts`
- Modify: `apps/cli/src/hooks/saver-run.ts` (one call inside `runSaverHookFromProcess`, BEFORE `buildSaverDecision` — above `decide()`'s early returns, spec §4.3)
- Test: `apps/cli/test/hooks/guard-outcome.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/cli/test/hooks/guard-outcome.test.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_GUARD_STATE,
  readGuardEvents,
  readGuardState,
  writeGuardState,
} from "@megasaver/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { maybeRecordGuardOutcome } from "../../src/hooks/guard-outcome.js";
import { ensureStoreReady } from "../../src/store.js";

const NOW = "2026-07-12T10:05:00.000Z";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const INTERCEPT_ID = "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1";
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-guardoutcome-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function seedWithIntercept(signatures: string[]) {
  const { registry } = await ensureStoreReady(root);
  registry.createProject({
    id: PROJECT_ID, name: "demo", rootPath: "/work/demo", createdAt: NOW, updatedAt: NOW,
  } as never);
  writeGuardState(root, PROJECT_ID, {
    ...DEFAULT_GUARD_STATE,
    sessions: {
      s1: {
        firedIds: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
        intercepts: {
          [INTERCEPT_ID]: {
            command: "pnpm vitest --shard 2",
            signatures,
            candidateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          },
        },
      },
    },
  });
}

function payload(command: string, stdout: string, stderr = "") {
  return {
    session_id: "s1",
    cwd: "/work/demo",
    tool_name: "Bash",
    tool_input: { command },
    tool_response: { stdout, stderr, interrupted: false, isImage: false },
  };
}

describe("maybeRecordGuardOutcome", () => {
  it("records overridden-failed when the re-run output contains an original signature", async () => {
    await seedWithIntercept(["src/run.ts"]);
    await maybeRecordGuardOutcome(payload("pnpm vitest --shard 2", "boom at src/run.ts again"), root, () => NOW);
    const events = readGuardEvents({ root }, PROJECT_ID as never);
    expect(events[0]).toMatchObject({ type: "outcome", outcome: "overridden-failed", interceptId: INTERCEPT_ID });
  });

  it("records overridden-ok and counts a strike when no original signature recurs", async () => {
    await seedWithIntercept(["src/run.ts"]);
    await maybeRecordGuardOutcome(payload("pnpm vitest --shard 2", "42 tests passed"), root, () => NOW);
    const events = readGuardEvents({ root }, PROJECT_ID as never);
    expect(events[0]).toMatchObject({ type: "outcome", outcome: "overridden-ok" });
    expect(readGuardState(root, PROJECT_ID)?.autoMuted["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]).toBe(1);
  });

  it("records plain overridden when the original had zero signatures (no strike)", async () => {
    await seedWithIntercept([]);
    await maybeRecordGuardOutcome(payload("pnpm vitest --shard 2", "anything"), root, () => NOW);
    const events = readGuardEvents({ root }, PROJECT_ID as never);
    expect(events[0]).toMatchObject({ type: "outcome", outcome: "overridden" });
    expect(readGuardState(root, PROJECT_ID)?.autoMuted).toEqual({});
  });

  it("auto-mutes after 3 overridden-ok strikes", async () => {
    await seedWithIntercept(["src/run.ts"]);
    const state = readGuardState(root, PROJECT_ID);
    writeGuardState(root, PROJECT_ID, {
      ...(state ?? DEFAULT_GUARD_STATE),
      autoMuted: { "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb": 2 },
    } as never);
    await seedWithIntercept(["src/run.ts"]); // restore the intercept entry
    const s2 = readGuardState(root, PROJECT_ID);
    writeGuardState(root, PROJECT_ID, { ...(s2 as never), autoMuted: { "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb": 2 } } as never);
    await maybeRecordGuardOutcome(payload("pnpm vitest --shard 2", "42 tests passed"), root, () => NOW);
    expect(readGuardState(root, PROJECT_ID)?.mutedIds).toContain("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  });

  it("removes the intercept entry after recording (one outcome per intercept)", async () => {
    await seedWithIntercept(["src/run.ts"]);
    await maybeRecordGuardOutcome(payload("pnpm vitest --shard 2", "boom src/run.ts"), root, () => NOW);
    await maybeRecordGuardOutcome(payload("pnpm vitest --shard 2", "boom src/run.ts"), root, () => NOW);
    expect(readGuardEvents({ root }, PROJECT_ID as never).length).toBe(1);
  });

  it("zero-cost skip: never touches the registry when no guard dir exists, and never throws", async () => {
    await expect(
      maybeRecordGuardOutcome(payload("ls", "ok"), root, () => NOW),
    ).resolves.toBeUndefined();
    await expect(maybeRecordGuardOutcome({ garbage: 1 }, root, () => NOW)).resolves.toBeUndefined();
  });

  it("works on small outputs (below the saver compress floor) — insertion above decide()", async () => {
    await seedWithIntercept(["src/run.ts"]);
    // 10-byte output would PASSTHROUGH in decide(); the outcome step still runs.
    await maybeRecordGuardOutcome(payload("pnpm vitest --shard 2", "tiny"), root, () => NOW);
    expect(readGuardEvents({ root }, PROJECT_ID as never).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — module not found.

- [ ] **Step 3: Implement**

```typescript
// apps/cli/src/hooks/guard-outcome.ts
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { appendGuardEvent, normalizeCommand, readGuardState, writeGuardState } from "@megasaver/core";
import { z } from "zod";
import { findProjectByCwd } from "../commands/warmup.js";
import { ensureStoreReady } from "../store.js";

const AUTO_MUTE_STRIKES = 3;

const postToolUsePayloadSchema = z
  .object({
    session_id: z.string(),
    cwd: z.string(),
    tool_name: z.literal("Bash"),
    tool_input: z.object({ command: z.string() }).passthrough(),
    tool_response: z.unknown(),
  })
  .passthrough();

function responseText(toolResponse: unknown): string {
  if (typeof toolResponse === "string") return toolResponse;
  if (typeof toolResponse !== "object" || toolResponse === null) return "";
  const o = toolResponse as Record<string, unknown>;
  const stdout = typeof o["stdout"] === "string" ? o["stdout"] : "";
  const stderr = typeof o["stderr"] === "string" ? o["stderr"] : "";
  return `${stdout}\n${stderr}`;
}

// Guard outcome labeling (spec §4.3): if a command warned this session is
// re-run, classify the override by overlap with the ORIGINAL failure's stored
// signatures. Best-effort by contract: NEVER throws, and returns before any
// registry read when the store has no guard/ dir (zero cost for non-guard
// users). Runs in runSaverHookFromProcess ABOVE buildSaverDecision — decide()
// early-returns on small outputs and failing re-runs are usually small.
export async function maybeRecordGuardOutcome(
  payload: unknown,
  storeRoot: string,
  now: () => string = () => new Date().toISOString(),
): Promise<void> {
  try {
    if (!existsSync(join(storeRoot, "guard"))) return;
    const parsed = postToolUsePayloadSchema.safeParse(payload);
    if (!parsed.success) return;
    const { session_id: sessionId, cwd } = parsed.data;
    const normalized = normalizeCommand(parsed.data.tool_input.command);
    if (normalized === "") return;

    const { registry } = await ensureStoreReady(storeRoot);
    const project = findProjectByCwd(registry.listProjects(), cwd);
    if (project === null) return;
    const state = readGuardState(storeRoot, project.id);
    const session = state?.sessions[sessionId];
    if (state === null || state === undefined || session === undefined) return;

    const hit = Object.entries(session.intercepts).find(([, v]) => v.command === normalized);
    if (hit === undefined) return;
    const [interceptId, intercept] = hit;

    const output = responseText(parsed.data.tool_response);
    const outcome =
      intercept.signatures.length === 0
        ? "overridden"
        : intercept.signatures.some((sig) => output.includes(sig))
          ? "overridden-failed"
          : "overridden-ok";

    appendGuardEvent(
      { root: storeRoot },
      {
        type: "outcome",
        id: randomUUID(),
        projectId: project.id,
        sessionId,
        interceptId,
        outcome,
        createdAt: now(),
      },
    );

    const intercepts = { ...session.intercepts };
    delete intercepts[interceptId];
    const candidateId = intercept.candidateId;
    let autoMuted = state.autoMuted;
    let mutedIds = state.mutedIds;
    if (outcome === "overridden-ok" && candidateId !== "") {
      const strikes = (state.autoMuted[candidateId] ?? 0) + 1;
      autoMuted = { ...state.autoMuted, [candidateId]: strikes };
      if (strikes >= AUTO_MUTE_STRIKES && !mutedIds.includes(candidateId)) {
        mutedIds = [...mutedIds, candidateId];
      }
    }
    writeGuardState(storeRoot, project.id, {
      ...state,
      mutedIds,
      autoMuted,
      sessions: { ...state.sessions, [sessionId]: { ...session, intercepts } },
    });
  } catch {
    // Swallow — best-effort; the saver's compression path is untouchable.
  }
}
```

(`candidateId` comes from the intercept entry — stored at intercept time in Task 6, schema'd in Task 4 — so the strike always lands on the candidate that actually fired, even with multiple intercepts in one session.)

In `apps/cli/src/hooks/saver-run.ts`, inside `runSaverHookFromProcess` after `const storeRoot = resolveStorePath(readStoreEnv(undefined));` add:

```typescript
    // Guard outcome labeling must run BEFORE buildSaverDecision: decide()
    // passthroughs early on small outputs and failing re-runs are small.
    await maybeRecordGuardOutcome(payload, storeRoot);
```

with import `import { maybeRecordGuardOutcome } from "./guard-outcome.js";`.

Add one regression test to `apps/cli/test/hooks/` (in the existing saver test file or the new guard-outcome file): a saver run over a large compressible payload still compresses identically with a guard state present (assert existing compression test behavior unchanged — cheapest form: run the existing saver suite; it must stay green).

- [ ] **Step 4: Build + test** — `pnpm build && pnpm --filter @megasaver/cli test` → PASS including all pre-existing saver tests.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/hooks/guard-outcome.ts apps/cli/src/hooks/saver-run.ts apps/cli/test/hooks/guard-outcome.test.ts packages/core/src/guard-state.ts packages/core/test/guard-state.test.ts apps/cli/src/hooks/guard-run.ts apps/cli/test/hooks/guard-run.test.ts
git commit -m "feat(cli): guard outcome loop with signature overlap"
```

---

### Task 9: `mega guard` CLI — status / mode / mute / unmute

**Files:**
- Create: `apps/cli/src/commands/guard/index.ts`, `apps/cli/src/commands/guard/status.ts`, `apps/cli/src/commands/guard/mode.ts`, `apps/cli/src/commands/guard/mute.ts`
- Modify: `apps/cli/src/main.ts` (import `guardCommand`, add `guard: guardCommand,` to subCommands — alphabetically after `gui`)
- Test: `apps/cli/test/commands/guard.test.ts`

All four commands follow the `runX(input) + defineCommand wrapper` shape from `commands/warmup.ts` / `commands/roi.ts`. Shared input pattern: `{ storeRoot, cwd, now: () => number, json?: boolean, stdout, stderr }` + command-specific fields; project resolution via `findProjectByCwd(registry.listProjects(), cwd)` with the same "no project → stderr + return 1" behavior as `runWarmup`.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/cli/test/commands/guard.test.ts — fixture header mirrors warmup.test.ts
// (mkdtemp root, out/err arrays, seedProject with updatedAt, signTestLicense +
// activateLicense helper copied verbatim from apps/cli/test/commands/warmup.test.ts:34-42)

describe("mega guard mode", () => {
  it("strict without a license prints the upsell and exits 0, state unchanged", async () => {
    await seedProject("/work/demo");
    const code = await runGuardMode(baseInput({ mode: "strict" }));
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("Pro feature");
    expect(readGuardState(root, PROJECT_ID)?.mode ?? "warn").toBe("warn");
  });
  it("strict with a license writes state.mode=strict; warn always allowed", async () => {
    await seedProject("/work/demo");
    activatePro(); // helper from the warmup fixture
    expect(await runGuardMode(baseInput({ mode: "strict" }))).toBe(0);
    expect(readGuardState(root, PROJECT_ID)?.mode).toBe("strict");
    expect(await runGuardMode(baseInput({ mode: "warn" }))).toBe(0); // no gate
    expect(readGuardState(root, PROJECT_ID)?.mode).toBe("warn");
  });
});

describe("mega guard mute/unmute", () => {
  it("mute adds the id; unmute clears both mutedIds and autoMuted strikes", async () => {
    await seedProject("/work/demo");
    await runGuardMute(baseInput({ failureId: "f1", unmute: false }));
    expect(readGuardState(root, PROJECT_ID)?.mutedIds).toContain("f1");
    await runGuardMute(baseInput({ failureId: "f1", unmute: true }));
    const st = readGuardState(root, PROJECT_ID);
    expect(st?.mutedIds).not.toContain("f1");
    expect(st?.autoMuted["f1"]).toBeUndefined();
  });
});

describe("mega guard status", () => {
  it("prints mode, this-month intercept counts, override counts, and mutes", async () => {
    await seedProject("/work/demo");
    // seed two intercepts (one warned+overridden-ok, one heeded) via appendGuardEvent
    // (imported from @megasaver/core), createdAt inside the current month of NOW.
    await runGuardStatus(baseInput({}));
    const text = out.join("\n");
    expect(text).toContain("mode: warn");
    expect(text).toContain("intercepts this month: 2");
    expect(text).toContain("overridden: 1");
  });
});
```

(Complete the event-seeding literals from the Task 5 test's `intercept()` helper — same fields, `projectId: PROJECT_ID`.)

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

`status.ts` — `runGuardStatus`: resolve project; `readGuardState ?? DEFAULT_GUARD_STATE`; `readGuardEvents({root: storeRoot}, project.id)`; month filter `e.createdAt.slice(0, 7) === new Date(input.now()).toISOString().slice(0, 7)`; counts: intercepts by action, outcomes by kind; `heeded = warn/deny intercepts with no outcome row referencing their id`; print lines:

```
guard mode: warn
intercepts this month: N (warn X · deny Y · recall Z)
heeded: H · overridden: O (ok A · failed B · unclassified C)
false-positive proxy: A/X warns overridden-ok (edit-tool intercepts are never outcome-classified)
muted: M
```

`--json` prints the same as one JSON object. No entitlement gate (free).

`mode.ts` — `runGuardMode({mode})`: `warn` → write state unconditionally. `strict` → gate FIRST:

```typescript
export const GUARD_STRICT_UPSELL =
  "Strict (deny) mode is a Mega Saver Pro feature. Activate a key: mega license activate <key>.";
```

`checkEntitlement("savings-analytics", { storeRoot, now, ...(publicKey…) })`; not entitled → stdout upsell, return 0 (clone the `runWarmup --write` gate shape including the optional `publicKey` input field for tests). Entitled → `writeGuardState(storeRoot, project.id, { ...(readGuardState(...) ?? DEFAULT_GUARD_STATE), mode })`.

`mute.ts` — `runGuardMute({failureId, unmute})`: read-modify-write state; mute appends (dedup); unmute filters `mutedIds` AND deletes `autoMuted[failureId]`. Free.

`index.ts` — citty parent `guardCommand` with `subCommands: { status, mode, mute, unmute, events, check }` (events/check arrive in Task 10 — create the files in Task 10 and register both there; Task 9 registers `status`, `mode`, `mute`, `unmute` only, then Task 10 extends). `mode` takes a positional `mode` arg validated against `["warn","strict"]` at the boundary (stderr + exit 1 otherwise); `mute`/`unmute` take positional `failureId` (non-empty string).

`main.ts`: `import { guardCommand } from "./commands/guard/index.js";` + `guard: guardCommand,` after `gui:`.

- [ ] **Step 4: Build + test** — PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/guard/ apps/cli/src/main.ts apps/cli/test/commands/guard.test.ts
git commit -m "feat(cli): mega guard status/mode/mute commands"
```

---

### Task 10: `mega guard` CLI — events (Pro) + check

**Files:**
- Create: `apps/cli/src/commands/guard/events.ts`, `apps/cli/src/commands/guard/check.ts`
- Modify: `apps/cli/src/commands/guard/index.ts`
- Test: append to `apps/cli/test/commands/guard.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
describe("mega guard events", () => {
  it("is Pro-gated: upsell + exit 0 without a license, no ledger read", async () => {
    await seedProject("/work/demo");
    const code = await runGuardEvents(baseInput({ limit: 20 }));
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("Pro feature");
  });
  it("lists newest-first with tier/action/outcome and estimated tokens", async () => {
    await seedProject("/work/demo");
    activatePro();
    // seed one intercept + its outcome row via appendGuardEvent
    await runGuardEvents(baseInput({ limit: 20 }));
    const text = out.join("\n");
    expect(text).toContain("t1");
    expect(text).toContain("~4200 tokens (estimated)");
    expect(text).toContain("overridden-ok");
  });
});

describe("mega guard check", () => {
  it("dry-runs the matcher and prints the match reason", async () => {
    await seedProject("/work/demo");
    appendGuardCorpusRow(root, PROJECT_ID, corpusRow()); // helper from guard-run.test.ts
    await runGuardCheck(baseInput({ query: "pnpm vitest --shard 2" }));
    expect(out.join("\n")).toContain("t1");
  });
  it("prints 'no match' cleanly on a miss", async () => {
    await seedProject("/work/demo");
    await runGuardCheck(baseInput({ query: "totally novel command" }));
    expect(out.join("\n")).toContain("no match");
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

`events.ts` — gate-first with `PRO_ANALYTICS_UPSELL`-style constant `GUARD_EVENTS_UPSELL = "The guard event ledger is a Mega Saver Pro feature. Activate a key: mega license activate <key>."`; entitled → read events, join outcomes to their intercepts by `interceptId`, sort newest-first by `createdAt`, slice `--limit` (default 20, positive int boundary-parse), text rows:

```
2026-07-12 10:00  t1 warn   pnpm vitest --shard 2  ~4200 tokens (estimated)  → overridden-ok
```

`--json` emits the joined array raw.

`check.ts` — free; resolve project by cwd; build candidates exactly as `buildGuardHookOutput` does (failedAttempts + corpus); run `matchGuard` with `call: { tool: "Bash", command: input.query }`, empty muted/fired, `asOf` from now; print `match: <tier> <action> — <candidate command/failedStep> (<createdAt>)` or `no match`. This is the demo/debug surface — no state writes, no events.

Register both in `guard/index.ts`.

- [ ] **Step 4: Build + test → PASS. Step 5: Commit**

```bash
git add apps/cli/src/commands/guard/ apps/cli/test/commands/guard.test.ts
git commit -m "feat(cli): guard events ledger and check dry-run"
```

---

### Task 11: MCP — `check_approach` + `find_similar_failures` cap + isPro threading

**Files:**
- Create: `packages/mcp-bridge/src/tools/check-approach.ts`
- Modify: `packages/mcp-bridge/src/tool-name.ts` (insert `"check_approach"` alphabetically after `"build_task_plan"`), `packages/mcp-bridge/src/server.ts` (ServerDeps `isPro?: boolean`; TOOL_DEFS entry; dispatch case; pass `isPro`+`now` to find_similar_failures), `packages/mcp-bridge/src/tools/find-similar-failures.ts` (env gains `now: () => string; isPro: boolean`; 7-day filter), `packages/mcp-bridge/src/index.ts` (thread `isPro` through `McpBridgeConfig` → `buildServer` — grep `createBridge` for the config mapping), `apps/cli/src/commands/mcp/serve.ts` (compute + inject)
- Test: `packages/mcp-bridge/test/check-approach.test.ts`; update `tool-name-task.test.ts` (33→34 + add the name to the literal list), `server.e2e.test.ts:537` (`toHaveLength(34)`), `tool-name.test-d.ts:55` (member count text + list); extend `find-similar-failures` test with the cap case; `apps/cli/test/commands/mcp-serve` test for isPro wiring if one exists (grep; otherwise skip — the bridge tests cover behavior)

- [ ] **Step 1: Write the failing test**

```typescript
// packages/mcp-bridge/test/check-approach.test.ts — fixture mirrors get-warm-start-brief.test.ts
import { type CoreRegistry, createInMemoryCoreRegistry } from "@megasaver/core";
import type { ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { handleCheckApproach } from "../src/tools/check-approach.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const NOW = "2026-07-12T10:00:00.000Z";

function buildEnv(isPro: boolean): { registry: CoreRegistry; now: () => string; isPro: boolean } {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({ id: PROJECT_ID, name: "demo", rootPath: "/tmp/demo", createdAt: NOW, updatedAt: NOW });
  registry.createFailedAttempt({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as never,
    projectId: PROJECT_ID, sessionId: null,
    task: "shard vitest run", failedStep: "pnpm vitest --shard 2",
    errorOutput: "unknown option --shard", relatedFiles: ["src/run.ts"],
    convertedToRule: false, createdAt: "2026-07-11T10:00:00.000Z",
  } as never);
  registry.createFailedAttempt({
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" as never,
    projectId: PROJECT_ID, sessionId: null,
    task: "shard vitest run old", failedStep: "pnpm vitest --shard 9",
    errorOutput: "unknown option --shard", relatedFiles: [],
    convertedToRule: false, createdAt: "2026-06-01T10:00:00.000Z", // 41d old
  } as never);
  return { registry, now: () => NOW, isPro };
}

describe("check_approach", () => {
  it("returns matches with resolution fields for a Pro caller (full history)", async () => {
    const res = await handleCheckApproach(buildEnv(true), {
      projectId: PROJECT_ID, description: "vitest shard run",
    });
    expect(res.matches.length).toBe(2);
    expect(res.upsell).toBeUndefined();
  });
  it("caps free callers to the last 7 days and adds the upsell line", async () => {
    const res = await handleCheckApproach(buildEnv(false), {
      projectId: PROJECT_ID, description: "vitest shard run",
    });
    expect(res.matches.length).toBe(1);
    expect(res.upsell).toContain("Pro");
  });
  it("files narrows by relatedFiles intersection", async () => {
    const res = await handleCheckApproach(buildEnv(true), {
      projectId: PROJECT_ID, description: "vitest shard run", files: ["src/run.ts"],
    });
    expect(res.matches.length).toBe(1);
  });
  it("validation_failed on bad args; resource_not_found on unknown project", async () => {
    await expect(handleCheckApproach(buildEnv(true), { projectId: 42 })).rejects.toMatchObject({ code: "validation_failed" });
    await expect(
      handleCheckApproach(buildEnv(true), { projectId: "99999999-9999-4999-8999-999999999999", description: "x" }),
    ).rejects.toMatchObject({ code: "resource_not_found" });
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

```typescript
// packages/mcp-bridge/src/tools/check-approach.ts
import type { CoreRegistry, FailedAttempt } from "@megasaver/core";
import type { ProjectId } from "@megasaver/shared";
import { estimateTokens } from "@megasaver/output-filter";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type CheckApproachEnv = {
  registry: CoreRegistry;
  now: () => string;
  isPro: boolean;
};

const inputSchema = z
  .object({
    projectId: z.string().min(1),
    description: z.string().min(1),
    files: z.array(z.string()).optional(),
  })
  .strict();

const FREE_WINDOW_MS = 7 * 86_400_000;
const MAX_MATCHES = 5;
export const CHECK_APPROACH_UPSELL =
  "Free tier searches the last 7 days of failures. Full history: Mega Saver Pro — mega license activate <key>.";

export type CheckApproachMatch = {
  id: string;
  task: string;
  failedStep: string;
  suspectedCause?: string;
  resolution?: string;
  createdAt: string;
  estimatedWasteTokens?: number;
};

export type CheckApproachResult = { matches: CheckApproachMatch[]; upsell?: string };

function pathsIntersect(files: readonly string[], relatedFiles: readonly string[]): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "");
  return files.some((f) =>
    relatedFiles.some((rel) => {
      const a = norm(f);
      const b = norm(rel);
      const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
      return longer === shorter || longer.endsWith(`/${shorter}`);
    }),
  );
}

function toMatch(a: FailedAttempt): CheckApproachMatch {
  return {
    id: a.id,
    task: a.task,
    failedStep: a.failedStep,
    ...(a.suspectedCause !== undefined ? { suspectedCause: a.suspectedCause } : {}),
    ...(a.resolution !== undefined ? { resolution: a.resolution } : {}),
    createdAt: a.createdAt,
    ...(a.errorOutput !== undefined ? { estimatedWasteTokens: estimateTokens(a.errorOutput) } : {}),
  };
}

// Cross-agent pre-flight check (spec §6): BM25 over the failed-attempt corpus
// plus optional relatedFiles narrowing. Free tier sees the last 7 days only —
// the SAME cap applied to find_similar_failures, so neither tool bypasses the
// other.
export async function handleCheckApproach(
  env: CheckApproachEnv,
  rawArgs: unknown,
): Promise<CheckApproachResult> {
  const parsed = inputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const projectId = parsed.data.projectId as ProjectId;
  if (env.registry.getProject(projectId) === null) {
    throw new McpBridgeError("resource_not_found", `project not found: ${projectId}`);
  }
  let hits = env.registry.searchFailedAttempts(projectId, {
    text: parsed.data.description,
    limit: MAX_MATCHES * 2,
  });
  if (parsed.data.files !== undefined && parsed.data.files.length > 0) {
    const files = parsed.data.files;
    hits = hits.filter((a) => a.relatedFiles.length > 0 && pathsIntersect(files, a.relatedFiles));
  }
  if (!env.isPro) {
    const cutoff = Date.parse(env.now()) - FREE_WINDOW_MS;
    hits = hits.filter((a) => Date.parse(a.createdAt) >= cutoff);
  }
  const matches = hits.slice(0, MAX_MATCHES).map(toMatch);
  return env.isPro ? { matches } : { matches, upsell: CHECK_APPROACH_UPSELL };
}
```

`find-similar-failures.ts`: extend `FindSimilarFailuresEnv` with `now: () => string; isPro: boolean`; after the `searchFailedAttempts` call add the identical 7-day filter when `!env.isPro`. Update its dispatch case in `server.ts` to pass `{ registry: deps.registry, now, isPro: deps.isPro ?? false }`, and extend its existing test with a free-cap case (clone the check-approach one).

`tool-name.ts`: insert `"check_approach"` after `"build_task_plan"` (alphabetic). `server.ts`: `ServerDeps` gains `isPro?: boolean` (comment: `// Entitlement is resolved CLI-side (mega mcp serve) — the bridge keeps zero entitlement deps.`); TOOL_DEFS entry after build_task_plan:

```typescript
  {
    id: "check_approach",
    description: "Check a planned approach against recorded failed attempts before retrying.",
  },
```

dispatch case:

```typescript
      case "check_approach":
        return handleCheckApproach(
          { registry: deps.registry, now, isPro: deps.isPro ?? false },
          args,
        );
```

`packages/mcp-bridge/src/index.ts`: grep `McpBridgeConfig` — add `isPro?: boolean` to the config type and thread it into the `ServerDeps` construction inside `createBridge`.

`apps/cli/src/commands/mcp/serve.ts`: `RunMcpServeDeps` gains `resolveIsPro?: (storeRoot: string) => boolean`. In `runMcpServe`:

```typescript
  const isPro =
    deps.resolveIsPro !== undefined ? deps.resolveIsPro(storeRoot) : false;
  const bridge = deps.createBridge({
    transport: "stdio",
    storeRoot,
    registry,
    isPro,
    ...
```

Production wiring in `mcpServeCommand.run`:

```typescript
      resolveIsPro: (storeRoot) =>
        checkEntitlement("savings-analytics", { storeRoot, now: () => Date.now() }).entitled,
```

with `import { checkEntitlement } from "@megasaver/entitlement";`.

Test-count updates: `tool-name-task.test.ts` describe/it text 33→34 + insert `"check_approach"` into the literal array after `"build_task_plan"`; `server.e2e.test.ts` `toHaveLength(34)`; `tool-name.test-d.ts` header text + list.

- [ ] **Step 4: Build + test** — `pnpm build && pnpm --filter @megasaver/mcp-bridge test && pnpm --filter @megasaver/cli test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-bridge/ apps/cli/src/commands/mcp/serve.ts apps/cli/test/
git commit -m "feat(mcp): check_approach tool + free 7-day failure cap"
```

---

### Task 12: Savings/ROI integration

**Files:**
- Modify: `apps/cli/src/commands/savings/shared.ts` (GuardTotals reader + formatter), `apps/cli/src/commands/roi.ts`, `apps/cli/src/commands/savings/history.ts`, `apps/cli/src/commands/savings/insights.ts` (optional reader + one text line each — clone the `readWarmStartTotals` optional-input pattern already in those files), `mega savings fix` (grep `savings/fix` or `fix` under commands/savings — add a guard-not-installed hint line reading `readClaudeCodeHookStatus`)
- Test: `apps/cli/test/commands/savings.test.ts` additions (find the existing warm-start line tests via `grep -n "Warm start" apps/cli/test/commands/savings.test.ts` and clone them)

- [ ] **Step 1: Write the failing tests** (clone each warm-start-line test in `savings.test.ts` — same seeding style, guard events via `appendGuardEvent` from `@megasaver/core`)

Assertions:
- roi/history/insights text output contains `Retry cost avoided (estimated): ~4200 tokens` when one heeded warn intercept exists.
- Line absent when zero heeded intercepts (recall-only and fully-overridden ledgers render nothing).
- json/csv branches NEVER contain the line (clone the warm-start json-absence tests).

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement in `shared.ts`**

```typescript
export type GuardTotals = { heededIntercepts: number; avoidedTokens: number; overridden: number };
export type GuardTotalsReader = () => GuardTotals | Promise<GuardTotals>;

// Heeded = a warn/deny intercept with no outcome row (spec §3.3): the agent
// did not re-run the matched command this session. Estimated by contract —
// never mixed into TokenSaverEvent totals.
export function defaultGuardTotalsReader(storeInput: ResolveStorePathInput): GuardTotalsReader {
  return async () => {
    const rootDir = resolveStorePath(storeInput);
    const { registry } = await ensureStoreReady(rootDir);
    let heededIntercepts = 0;
    let avoidedTokens = 0;
    let overridden = 0;
    for (const project of registry.listProjects()) {
      const events = readGuardEvents({ root: rootDir }, project.id);
      const outcomeRefs = new Set(
        events.filter((e) => e.type === "outcome").map((e) => (e as { interceptId: string }).interceptId),
      );
      for (const e of events) {
        if (e.type !== "intercept" || e.action === "recall") continue;
        if (outcomeRefs.has(e.id)) {
          overridden += 1;
        } else {
          heededIntercepts += 1;
          avoidedTokens += e.avoidedTokens;
        }
      }
    }
    return { heededIntercepts, avoidedTokens, overridden };
  };
}

export function formatGuardLine(totals: GuardTotals): string | null {
  if (totals.heededIntercepts === 0) return null;
  const dollars = (totals.avoidedTokens / 1_000_000) * INPUT_PRICE_PER_MTOK_USD;
  return `Retry cost avoided (estimated): ~${totals.avoidedTokens} tokens (~${formatDollarsSaved(dollars)}) across ${totals.heededIntercepts} intercepts`;
}
```

(`readGuardEvents`, `INPUT_PRICE_PER_MTOK_USD`, `formatDollarsSaved` import from `@megasaver/core` — extend the existing import line.)

Wiring in roi/history/insights: add optional `readGuardTotals?: GuardTotalsReader` to each Run*Input; in the TEXT branch only, after the existing warm-start line (grep `formatWarmStartLine` call sites in each file and mirror), print `formatGuardLine` result when non-null; wire `defaultGuardTotalsReader(...)` in each `defineCommand` run wrapper exactly where `defaultWarmStartTotalsReader` is wired. `savings fix`: add a suggestion line `enable the Mistake Firewall: mega hooks install claude-code (guard hook)` when `readClaudeCodeHookStatus({settingsPath: resolveClaudeCodeSettingsPath()}).guardInstalled` is false — same optional-dep injection style the command already uses (grep its input type first; if it has no settings-path plumbing, inject `readGuardInstalled?: () => boolean` and default-wire it).

- [ ] **Step 4: Build + test → PASS. Step 5: Commit**

```bash
git add apps/cli/src/commands/savings/ apps/cli/src/commands/roi.ts apps/cli/test/commands/savings.test.ts
git commit -m "feat(cli): retry-cost-avoided line in roi and savings"
```

---

### Task 13: Connector instruction lines

**Files:**
- Modify: `packages/connectors/shared/src/context-gate-block.ts` (two lines before `MEGA_SAVER_CG_BLOCK_END` in `renderContextGateBlockText`)
- Test: the existing block-text tests (grep `get_task_context` in `packages/connectors/shared/test/` and `apps/cli/test/` — every snapshot/contains assertion on the block text may need the two new lines)

- [ ] **Step 1: Write the failing test** — in the shared connectors test file that asserts block content, add:

```typescript
it("instructs failure recording and pre-retry checking (guard cold-start path)", () => {
  const text = renderContextGateBlockText({ sessionId: "s", projectId: "p", mode: "safe", maxReturnedBytes: 1 });
  expect(text).toContain("record_failed_attempt");
  expect(text).toContain("check_approach");
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — in `renderContextGateBlockText`, insert after the `get_edit_impact` line:

```typescript
    "After an approach fails, record it with record_failed_attempt({ projectId, task, failedStep, errorOutput }).",
    "Before retrying something that previously failed, call check_approach({ projectId, description, files }).",
```

Then run the FULL workspace test suite — any test asserting exact block text (connector sync fixtures, GUI bridge fixtures) fails here; update those literals to include the two lines. `grep -rn "get_edit_impact" packages apps --include="*.test.ts" -l` finds every fixture to touch.

- [ ] **Step 4: Build + full test** — `pnpm build && pnpm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/shared/ apps/ packages/
git commit -m "feat(connector): guard seeding + check instructions in block"
```

---

### Task 14: Changeset, verify gate, smoke evidence, latency gate

**Files:**
- Create: `.changeset/mistake-firewall.md`

- [ ] **Step 1: Changeset**

```markdown
---
"@megasaver/context-gate": minor
"@megasaver/core": minor
"@megasaver/stats": minor
"@megasaver/connectors-shared": minor
"@megasaver/connector-claude-code": minor
"@megasaver/mcp-bridge": minor
"@megasaver/cli": minor
---

Mistake Firewall (guard): PreToolUse hook intercepts Bash/edit calls matching stored failures and warns with the estimated original cost. Durable bounded guard corpus captured on the proxy path; three-tier pure matcher (exact / path+text / BM25); outcome feedback loop with signature overlap + auto-mute; `mega guard` CLI (status/mode/events/mute/check); `check_approach` MCP tool with a free 7-day window (also applied to `find_similar_failures`); Pro retry-cost-avoided line in roi/savings surfaces.
```

- [ ] **Step 2: Full verify** — `pnpm verify` → lint + typecheck + full test suite green. Fix anything found; no `--no-verify` ever.

- [ ] **Step 3: Smoke evidence (DoD §9.5)** — capture a terminal session:

```bash
STORE=$(mktemp -d)
node apps/cli/dist-bundle/mega.mjs --store "$STORE" project create demo --root "$PWD" 2>/dev/null || \
  node apps/cli/dist-bundle/mega.mjs project --help  # discover the real project-create syntax first (grep apps/cli/src/commands/project.ts)
node apps/cli/dist-bundle/mega.mjs fail record demo --task "run shard" --failed-step "pnpm vitest --shard 2" --error "unknown option '--shard'" --store "$STORE"
echo '{"session_id":"s1","cwd":"'$PWD'","tool_name":"Bash","tool_input":{"command":"pnpm vitest --shard 2"}}' \
  | MEGASAVER_STORE="$STORE" node apps/cli/dist-bundle/mega.mjs hooks guard
# EXPECT: {"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"⛨ Mistake Firewall: ..."}}
```

(Adjust store-flag mechanics to whatever `mega hooks guard` actually reads — it uses `readStoreEnv(undefined)`, so export the store via the env var the CLI supports or run with the default store; check `resolveStorePath` env handling: `XDG_DATA_HOME=$STORE` is the portable lever.)

- [ ] **Step 4: Latency gate (spec §4.1, pass/fail)** — run the no-match case 10×:

```bash
for i in $(seq 1 10); do /usr/bin/time -p sh -c \
  'echo "{\"session_id\":\"s1\",\"cwd\":\"/nowhere\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"ls\"}}" | node apps/cli/dist-bundle/mega.mjs hooks guard' 2>&1 | grep real; done
```

p50 must be < 0.15s. If it fails, STOP and report — the daemon fast-path decision goes back to the user, do not silently accept.

- [ ] **Step 5: additionalContext real-session validation** — install the hooks into a scratch Claude Code settings file, start a real session in a seeded project, run the failing command, and capture whether the warning reaches the agent. If `additionalContext` is not honored on PreToolUse, STOP and report to the user (spec §4.1 fallback decision).

- [ ] **Step 6: Commit + wiki**

```bash
git add .changeset/mistake-firewall.md
git commit -m "chore: changeset for mistake firewall"
```

Update `wiki/log.md` (timestamped entry) and `wiki/syntheses/memory-moat-portfolio.md` (i7 status) per §0 — on the branch, as part of the final docs commit.

---

## Final gate (after all tasks)

1. `pnpm verify` green — full evidence captured.
2. HIGH-risk gauntlet: `code-reviewer` pass AND adversarial `critic` pass, fresh contexts, author ≠ reviewer (worktree diff vs `feat/warm-start`).
3. Zero pending todos; smoke + latency evidence attached.
4. `superpowers:finishing-a-development-branch` — expect stacked PR onto `feat/warm-start` (or `main` if #284 merged).
