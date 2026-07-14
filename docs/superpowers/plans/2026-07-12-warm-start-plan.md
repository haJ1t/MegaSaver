# Warm Start Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A budgeted, deterministic session boot brief assembled from the memory store and injected into every agent — SessionStart hook for Claude Code, sentinel block for the other connectors — with measured (never estimated) reporting.

**Architecture:** One pure assembler in `@megasaver/core` (`assembleWarmStartBrief`) fed by thin gatherers (registry reads + git commands). Delivery adapters reuse existing plumbing: `hook-settings.ts` gains a SessionStart entry, `upsertBlock` gains an optional third sentinel block, stats gains a separate `WarmStartEvent` (own JSONL, `estimated: true`, never a `TokenSaverEvent`). Freshness comes from a per-project `warm-start/<projectId>.json` stamp written by the hook itself — `sessions.json.endedAt` is NOT used (architect BLOCKER: nothing in the hook flow writes it).

**Tech Stack:** TypeScript strict ESM, Zod, Vitest, Citty, pnpm workspaces. Spec: `docs/superpowers/specs/2026-07-12-warm-start-design.md` (risk HIGH).

**Execution preconditions:**
- Work in an isolated worktree (superpowers:using-git-worktrees), branch `feat/warm-start`, base `origin/main`.
- Run `pnpm install` once in the worktree; `pnpm --filter <pkg> test` per task; full `pnpm verify` in Task 14.
- HIGH-risk gauntlet (code-reviewer AND critic, separate contexts) happens in Task 14 — not per task.

**Conventions that bind every task:** no `Date.now()` inside pure core functions (callers pass ISO strings); `exactOptionalPropertyTypes` — never pass `undefined` to an optional field, use conditional spread (`...(x !== undefined ? { x } : {})`); comments only for non-obvious WHY; commits are Conventional Commits, one logical change each.

---

## File map (who owns what)

| File | Action | Responsibility |
|---|---|---|
| `packages/core/src/warm-start-state.ts` | Create | read/stamp per-project `lastSeenAt` freshness file |
| `packages/core/src/warm-start.ts` | Create | pure `assembleWarmStartBrief` + `selectWarmStartMode` |
| `packages/core/src/index.ts` | Modify | re-export the two modules above + stats warm-start fns |
| `packages/core/test/warm-start-state.test.ts` | Create | state read/stamp tests |
| `packages/core/test/warm-start.test.ts` | Create | assembler tests (budget, sections, modes, filters) |
| `packages/stats/src/warm-start-event.ts` | Create | `WarmStartEvent` schema + append/read (own JSONL) |
| `packages/stats/src/index.ts` | Modify | export warm-start-event |
| `packages/stats/test/warm-start-event.test.ts` | Create | schema + persistence tests |
| `apps/cli/src/git-delta.ts` | Create | `gatherGitDelta` with fallback chain (injectable exec) |
| `apps/cli/src/commands/warmup.ts` | Create | `mega warmup` (stdout, --json, --budget, --mode, --write) |
| `apps/cli/src/hooks/warmup-run.ts` | Create | fail-open SessionStart runner (stdin→stdout, stamp, event) |
| `apps/cli/src/commands/hooks/warmup.ts` | Create | thin Citty wrapper `mega hooks warmup` |
| `apps/cli/src/commands/hooks/index.ts` | Modify | register `warmup` subcommand |
| `apps/cli/src/commands/hooks/install.ts` | Modify | `--no-warmup` flag |
| `apps/cli/src/main.ts` | Modify | register `warmup` command |
| `apps/cli/src/commands/savings/shared.ts` | Modify | `readAllWarmStartTotals` reader |
| `apps/cli/src/commands/savings/history.ts` / `insights.ts` | Modify | trailing "Warm start" line |
| `apps/cli/test/git-delta.test.ts` | Create | fallback-chain tests (fake exec) |
| `apps/cli/test/commands/warmup.test.ts` | Create | command tests (temp store) |
| `apps/cli/test/hooks/warmup-run.test.ts` | Create | fail-open + stamp tests |
| `packages/connectors/claude-code/src/hook-settings.ts` | Modify | SessionStart add/has/remove/prune + `"warmup"` subcommand |
| `packages/connectors/claude-code/test/hook-settings.test.ts` | Modify | SessionStart cases |
| `packages/connectors/shared/src/constants.ts` | Modify | WS sentinel pair |
| `packages/connectors/shared/src/sentinel-guard.ts` | Create | extracted `containsSentinel` (shared by context + WS block) |
| `packages/connectors/shared/src/context.ts` | Modify | import guard from sentinel-guard.ts (pure refactor) |
| `packages/connectors/shared/src/warm-start-block.ts` | Create | `renderWarmStartBlockText` |
| `packages/connectors/shared/src/upsert.ts` | Modify | optional `warmStartBlock` third pass |
| `packages/connectors/shared/src/index.ts` | Modify | exports |
| `packages/connectors/shared/test/warm-start-block.test.ts` | Create | render + injection-guard + upsert idempotence |
| `apps/cli/src/commands/connector/sync.ts` | Modify | refresh WS block if present |
| `packages/mcp-bridge/src/tools/get-warm-start-brief.ts` | Create | MCP tool handler |
| `packages/mcp-bridge/src/server.ts` | Modify | TOOL_DEFS entry + dispatch case |
| `packages/mcp-bridge/test/get-warm-start-brief.test.ts` | Create | handler test |
| `.changeset/warm-start.md` | Create | version bumps |

Section priority (fixed, from spec §2): header → rules → decisions → todos → branch-touching failed attempts → git delta → entities. Modes: `micro` <4h (hard 300-token budget), `standard` 4h–14d, `reonboard` >14d. Entity digest is computed INSIDE the assembler from `relatedFiles`/`relatedSymbols` frequency (refinement over spec §1: no core→memory-graph dep needed; same data the graph's `entity-mention` edges encode).

---

### Task 1: Freshness state (`warm-start-state.ts`)

**Files:**
- Create: `packages/core/src/warm-start-state.ts`
- Create: `packages/core/test/warm-start-state.test.ts`
- Modify: `packages/core/src/index.ts` (add exports)

- [ ] **Step 1.1: Write the failing test**

```ts
// packages/core/test/warm-start-state.test.ts
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readWarmStartState, stampWarmStartSeen } from "../src/warm-start-state.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-07-12T10:00:00.000Z";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-warmstate-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("warm-start state", () => {
  it("returns null when no state file exists", () => {
    expect(readWarmStartState(root, PROJECT_ID)).toBeNull();
  });

  it("round-trips a stamp", () => {
    stampWarmStartSeen(root, PROJECT_ID, NOW);
    expect(readWarmStartState(root, PROJECT_ID)).toEqual({ lastSeenAt: NOW });
  });

  it("overwrites a prior stamp", () => {
    stampWarmStartSeen(root, PROJECT_ID, "2026-07-01T00:00:00.000Z");
    stampWarmStartSeen(root, PROJECT_ID, NOW);
    expect(readWarmStartState(root, PROJECT_ID)?.lastSeenAt).toBe(NOW);
  });

  it("returns null on corrupt state instead of throwing", () => {
    mkdirSync(join(root, "warm-start"), { recursive: true });
    writeFileSync(join(root, "warm-start", `${PROJECT_ID}.json`), "{not json");
    expect(readWarmStartState(root, PROJECT_ID)).toBeNull();
  });

  it("never throws when the root is unwritable (best-effort stamp)", () => {
    expect(() => stampWarmStartSeen("/nonexistent/nope", PROJECT_ID, NOW)).not.toThrow();
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test -- warm-start-state`
Expected: FAIL — `Cannot find module '../src/warm-start-state.js'`

- [ ] **Step 1.3: Write minimal implementation**

```ts
// packages/core/src/warm-start-state.ts
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const warmStartStateSchema = z
  .object({ lastSeenAt: z.string().datetime({ offset: true }) })
  .strict();

export type WarmStartState = z.infer<typeof warmStartStateSchema>;

function statePath(rootDir: string, projectId: string): string {
  return join(rootDir, "warm-start", `${projectId}.json`);
}

export function readWarmStartState(rootDir: string, projectId: string): WarmStartState | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(statePath(rootDir, projectId), "utf8"));
    const parsed = warmStartStateSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// Best-effort by contract: the SessionStart hook calls this and must never
// crash or block on a stamp failure — freshness is advisory, not data.
export function stampWarmStartSeen(rootDir: string, projectId: string, now: string): void {
  try {
    const dir = join(rootDir, "warm-start");
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `.${randomUUID()}.tmp`);
    writeFileSync(tmp, JSON.stringify({ lastSeenAt: now }));
    renameSync(tmp, statePath(rootDir, projectId));
  } catch {
    // swallow — see contract above
  }
}
```

Add to `packages/core/src/index.ts` (alongside the other re-exports):

```ts
export { readWarmStartState, stampWarmStartSeen, type WarmStartState } from "./warm-start-state.js";
```

- [ ] **Step 1.4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/core test -- warm-start-state`
Expected: PASS (5 tests)

- [ ] **Step 1.5: Commit**

```bash
git add packages/core/src/warm-start-state.ts packages/core/test/warm-start-state.test.ts packages/core/src/index.ts
git commit -m "feat(core): per-project warm-start freshness stamp"
```

---

### Task 2: Assembler — filtering, sections, budget (standard mode)

**Files:**
- Create: `packages/core/src/warm-start.ts`
- Create: `packages/core/test/warm-start.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 2.1: Write the failing tests**

Fixture helpers mirror `packages/core/test/memory-tier-decay.test.ts` style:

```ts
// packages/core/test/warm-start.test.ts
import { describe, expect, it } from "vitest";
import { estimateTokens } from "@megasaver/output-filter";
import { failedAttemptSchema } from "../src/failed-attempt.js";
import { type MemoryEntry, memoryEntrySchema } from "../src/memory-entry.js";
import { projectRuleSchema } from "../src/project-rule.js";
import {
  type WarmStartInput,
  assembleWarmStartBrief,
  selectWarmStartMode,
} from "../src/warm-start.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-07-12T10:00:00.000Z";
const RECENT = "2026-07-11T10:00:00.000Z";

let seq = 0;
function uuid(): string {
  seq += 1;
  const h = String(seq).padStart(4, "0");
  return `33333333-3333-4333-8333-33333333${h.slice(0, 4)}`;
}

function mem(over: Partial<Record<string, unknown>> = {}): MemoryEntry {
  return memoryEntrySchema.parse({
    id: uuid(),
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "Use JWT middleware",
    content: "Repo uses strict ESM. Second sentence should be clamped away.",
    keywords: ["auth"],
    confidence: "high",
    source: "manual",
    approval: "approved",
    stale: false,
    createdAt: RECENT,
    updatedAt: RECENT,
    ...over,
  });
}

function rule(over: Partial<Record<string, unknown>> = {}) {
  return projectRuleSchema.parse({
    id: uuid(),
    projectId: PROJECT_ID,
    title: "No default exports",
    rule: "Always use named exports.",
    appliesTo: [],
    evidence: [],
    severity: "warning",
    confidence: "high",
    createdFrom: "manual",
    createdAt: RECENT,
    updatedAt: RECENT,
    ...over,
  });
}

function attempt(over: Partial<Record<string, unknown>> = {}) {
  return failedAttemptSchema.parse({
    id: uuid(),
    projectId: PROJECT_ID,
    sessionId: null,
    task: "parse PDF",
    failedStep: "pdfjs import",
    errorOutput: "ERR_MODULE_NOT_FOUND",
    relatedFiles: ["src/pdf.ts"],
    convertedToRule: false,
    createdAt: RECENT,
    ...over,
  });
}

function baseInput(over: Partial<WarmStartInput> = {}): WarmStartInput {
  return {
    projectName: "demo",
    branch: "main",
    now: NOW,
    lastSeenAt: "2026-07-11T09:00:00.000Z", // 25h ago -> standard
    reonboardUnlocked: true,
    timeless: false,
    memories: [],
    rules: [],
    failedAttempts: [],
    gitDelta: null,
    ...over,
  };
}

describe("content filter", () => {
  it("excludes unapproved, archival, stale, and non-current memories", () => {
    const input = baseInput({
      memories: [
        mem({ title: "keep me" }),
        mem({ title: "suggested", approval: "suggested" }),
        mem({ title: "archived", tier: "archival" }),
        mem({ title: "stale one", stale: true }),
        mem({ title: "closed", validTo: "2026-07-01T00:00:00.000Z" }),
      ],
    });
    const brief = assembleWarmStartBrief(input);
    expect(brief.text).toContain("keep me");
    for (const gone of ["suggested", "archived", "stale one", "closed"]) {
      expect(brief.text).not.toContain(gone);
    }
  });
});

describe("budget invariant", () => {
  it("final text never exceeds the budget, even with adversarial inputs", () => {
    const big = "x".repeat(4000);
    const input = baseInput({
      budgetTokens: 500,
      memories: Array.from({ length: 40 }, (_, i) =>
        mem({ title: `huge ${i}`, content: big }),
      ),
      rules: Array.from({ length: 20 }, (_, i) => rule({ title: `rule ${i}`, rule: big })),
    });
    const brief = assembleWarmStartBrief(input);
    expect(estimateTokens(brief.text)).toBeLessThanOrEqual(500);
    expect(brief.tokenEstimate).toBe(estimateTokens(brief.text));
  });
});

describe("section priority", () => {
  it("orders header, rules, decisions, todos", () => {
    const input = baseInput({
      memories: [mem({ type: "decision", title: "DEC-A" }), mem({ type: "todo", title: "TODO-A" })],
      rules: [rule({ title: "RULE-A" })],
    });
    const t = assembleWarmStartBrief(input).text;
    expect(t.indexOf("RULE-A")).toBeGreaterThan(t.indexOf("demo"));
    expect(t.indexOf("DEC-A")).toBeGreaterThan(t.indexOf("RULE-A"));
    expect(t.indexOf("TODO-A")).toBeGreaterThan(t.indexOf("DEC-A"));
  });
});

describe("failed attempts vs git delta", () => {
  it("filters to relatedFiles ∩ changedFiles when gitDelta present", () => {
    const input = baseInput({
      failedAttempts: [
        attempt({ task: "touches-changed", relatedFiles: ["src/pdf.ts"] }),
        attempt({ task: "untouched", relatedFiles: ["src/other.ts"] }),
      ],
      gitDelta: { commits: [], changedFiles: [{ path: "src/pdf.ts", churn: 10 }] },
    });
    const t = assembleWarmStartBrief(input).text;
    expect(t).toContain("touches-changed");
    expect(t).not.toContain("untouched");
  });

  it("falls back to recent attempts when gitDelta is null", () => {
    const input = baseInput({
      failedAttempts: [attempt({ task: "recent-fail" })],
      gitDelta: null,
    });
    expect(assembleWarmStartBrief(input).text).toContain("recent-fail");
  });
});

describe("entity digest", () => {
  it("surfaces top entities by relatedFiles/relatedSymbols frequency", () => {
    const input = baseInput({
      memories: [
        mem({ title: "a", relatedFiles: ["src/auth.ts"] }),
        mem({ title: "b", relatedFiles: ["src/auth.ts"] }),
        mem({ title: "c", relatedSymbols: ["verifyToken"] }),
      ],
    });
    const t = assembleWarmStartBrief(input).text;
    expect(t).toContain("src/auth.ts");
  });
});

describe("determinism", () => {
  it("identical input produces identical output", () => {
    const input = baseInput({ memories: [mem()], rules: [rule()] });
    expect(assembleWarmStartBrief(input)).toEqual(assembleWarmStartBrief(input));
  });
});
```

- [ ] **Step 2.2: Run tests to verify they fail**

Run: `pnpm --filter @megasaver/core test -- test/warm-start.test.ts`
Expected: FAIL — `Cannot find module '../src/warm-start.js'`

- [ ] **Step 2.3: Write the implementation**

```ts
// packages/core/src/warm-start.ts
import { estimateTokens } from "@megasaver/output-filter";
import { searchFailedAttempts } from "./failed-attempt-search.js";
import type { FailedAttempt } from "./failed-attempt.js";
import {
  type MemoryEntry,
  type MemoryType,
  effectiveConfidence,
  isRecallable,
} from "./memory-entry.js";
import { rankApplicableRules } from "./project-rule-ranking.js";
import type { ProjectRule } from "./project-rule.js";

export type WarmStartMode = "micro" | "standard" | "reonboard";

export type GitDelta = {
  commits: { sha: string; subject: string; date: string }[];
  changedFiles: { path: string; churn: number }[];
};

export type WarmStartInput = {
  projectName: string;
  branch: string | null;
  now: string;
  budgetTokens?: number;
  mode?: WarmStartMode;
  lastSeenAt: string | null;
  reonboardUnlocked: boolean;
  timeless: boolean;
  memories: readonly MemoryEntry[];
  rules: readonly ProjectRule[];
  failedAttempts: readonly FailedAttempt[];
  gitDelta: GitDelta | null;
};

export type WarmStartBrief = {
  text: string;
  tokenEstimate: number;
  mode: WarmStartMode;
  sectionCounts: Record<string, number>;
};

export const DEFAULT_WARM_START_BUDGET = 2000;
export const MICRO_BUDGET = 300;
// ponytail: hardcoded thresholds (spec locked decision 3) — only budget is a flag
const MICRO_MS = 4 * 60 * 60 * 1000;
const REONBOARD_MS = 14 * 24 * 60 * 60 * 1000;
const SECTION_ITEM_CAP = 8;
const CLAMP_CHARS = 140;

export const REONBOARD_UPSELL_LINE =
  "Pro: expanded absence diff (what expired/changed while you were away) — mega license activate <key>.";

export function selectWarmStartMode(now: string, lastSeenAt: string | null): WarmStartMode {
  if (lastSeenAt === null) return "standard";
  const gap = Date.parse(now) - Date.parse(lastSeenAt);
  if (Number.isNaN(gap)) return "standard";
  if (gap < MICRO_MS) return "micro";
  if (gap > REONBOARD_MS) return "reonboard";
  return "standard";
}

function ageDays(now: string, iso: string): number {
  return Math.max(0, Math.floor((Date.parse(now) - Date.parse(iso)) / 86_400_000));
}

function clampSentence(content: string): string {
  const first = content.split(/(?<=[.!?])\s/)[0] ?? content;
  return first.length > CLAMP_CHARS ? `${first.slice(0, CLAMP_CHARS - 1)}…` : first;
}

function memLine(m: MemoryEntry, now: string): string {
  return `- [${m.type}] ${m.title} — ${clampSentence(m.content)} (${m.confidence}, ${ageDays(now, m.updatedAt)}d)`;
}

type Section = { key: string; lines: string[] };

function byScore(now: string) {
  return (a: MemoryEntry, b: MemoryEntry): number =>
    effectiveConfidence(b, now) - effectiveConfidence(a, now) || a.id.localeCompare(b.id);
}

function memSection(
  key: string,
  heading: string,
  memories: readonly MemoryEntry[],
  type: MemoryType,
  now: string,
): Section {
  const items = memories
    .filter((m) => m.type === type)
    .sort(byScore(now))
    .slice(0, SECTION_ITEM_CAP)
    .map((m) => memLine(m, now));
  return { key, lines: items.length === 0 ? [] : [``, heading, ...items] };
}

function rulesSection(rules: readonly ProjectRule[]): Section {
  const ranked = rankApplicableRules(rules, { limit: SECTION_ITEM_CAP });
  const items = ranked.map(({ rule }) => `- [${rule.severity}] ${rule.title}: ${clampSentence(rule.rule)}`);
  return { key: "rules", lines: items.length === 0 ? [] : ["", "## Project rules", ...items] };
}

function failuresSection(
  attempts: readonly FailedAttempt[],
  gitDelta: GitDelta | null,
): Section {
  const recent = searchFailedAttempts(attempts, { limit: 20 });
  const changed = gitDelta === null ? null : new Set(gitDelta.changedFiles.map((f) => f.path));
  const relevant =
    changed === null
      ? recent.slice(0, 5)
      : recent.filter((a) => a.relatedFiles.some((f) => changed.has(f))).slice(0, SECTION_ITEM_CAP);
  const items = relevant.map(
    (a) =>
      `- tried: ${a.task} — failed at ${a.failedStep}${a.errorOutput === undefined ? "" : ` (${clampSentence(a.errorOutput)})`}`,
  );
  return {
    key: "failures",
    lines: items.length === 0 ? [] : ["", "## Do not retry (known failures)", ...items],
  };
}

function gitSection(gitDelta: GitDelta | null, expanded: boolean): Section {
  if (gitDelta === null || (gitDelta.commits.length === 0 && gitDelta.changedFiles.length === 0)) {
    return { key: "git", lines: [] };
  }
  const commitCap = expanded ? 15 : 5;
  const commits = gitDelta.commits
    .slice(0, commitCap)
    .map((c) => `- ${c.sha} ${c.subject}`);
  const files = [...gitDelta.changedFiles]
    .sort((a, b) => b.churn - a.churn || a.path.localeCompare(b.path))
    .slice(0, 5)
    .map((f) => f.path)
    .join(", ");
  const lines = ["", `## Since your last visit (${gitDelta.commits.length} commits)`, ...commits];
  if (files.length > 0) lines.push(`- most-churned: ${files}`);
  return { key: "git", lines };
}

function entitiesSection(memories: readonly MemoryEntry[]): Section {
  const counts = new Map<string, number>();
  for (const m of memories) {
    for (const e of [...(m.relatedFiles ?? []), ...(m.relatedSymbols ?? [])]) {
      counts.set(e, (counts.get(e) ?? 0) + 1);
    }
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5);
  if (top.length === 0) return { key: "entities", lines: [] };
  return {
    key: "entities",
    lines: ["", `## Hot spots: ${top.map(([name, n]) => `${name} (${n})`).join(", ")}`],
  };
}

function absenceSection(
  memories: readonly MemoryEntry[],
  rules: readonly ProjectRule[],
  lastSeenAt: string,
  now: string,
): Section {
  const from = Date.parse(lastSeenAt);
  const to = Date.parse(now);
  const inWindow = (iso: string | null | undefined): boolean => {
    if (iso == null) return false;
    const t = Date.parse(iso);
    return t >= from && t < to;
  };
  const expired = memories
    .filter((m) => inWindow(m.validTo) || inWindow(m.expiresAt))
    .slice(0, SECTION_ITEM_CAP)
    .map((m) => `- expired/superseded: [${m.type}] ${m.title}`);
  const newRules = rules
    .filter((r) => inWindow(r.createdAt))
    .slice(0, SECTION_ITEM_CAP)
    .map((r) => `- new rule: ${r.title}`);
  const items = [...expired, ...newRules];
  return {
    key: "absence",
    lines: items.length === 0 ? [] : ["", "## Changed while you were away", ...items],
  };
}

export function assembleWarmStartBrief(input: WarmStartInput): WarmStartBrief {
  const now = input.now;
  const recallable = input.memories.filter((m) => isRecallable(m, now) && !m.stale);
  const mode = input.mode ?? selectWarmStartMode(now, input.lastSeenAt);
  const budget = input.budgetTokens ?? DEFAULT_WARM_START_BUDGET;
  const effectiveBudget = mode === "micro" ? Math.min(budget, MICRO_BUDGET) : budget;

  const visitAge =
    input.lastSeenAt === null ? "first visit" : `last visit ${ageDays(now, input.lastSeenAt)}d ago`;
  const headerLines = input.timeless
    ? [`# Warm Start — ${input.projectName}`]
    : [`# Warm Start — ${input.projectName} (${input.branch ?? "no branch"}, ${visitAge})`];
  if (mode === "reonboard" && !input.reonboardUnlocked) headerLines.push(REONBOARD_UPSELL_LINE);
  const header: Section = { key: "header", lines: headerLines };

  const rules = rulesSection(input.rules);
  const decisions = memSection("decisions", "## Standing decisions", recallable, "decision", now);
  const todos = memSection(
    "todos",
    "## Open todos",
    recallable.filter((m) => !m.stale),
    "todo",
    now,
  );
  const failures = failuresSection(input.failedAttempts, input.gitDelta);
  const git = gitSection(input.gitDelta, mode === "reonboard");
  const entities = entitiesSection(recallable);

  let sections: Section[];
  if (input.timeless) {
    sections = [header, rules, decisions, todos, failuresSection(input.failedAttempts, null)];
  } else if (mode === "micro") {
    sections = [header, rules, todos];
  } else if (mode === "reonboard" && input.reonboardUnlocked && input.lastSeenAt !== null) {
    sections = [
      header,
      absenceSection(input.memories, input.rules, input.lastSeenAt, now),
      git,
      rules,
      decisions,
      todos,
      failures,
    ];
  } else {
    sections = [header, rules, decisions, todos, failures, git, entities];
  }

  // Greedy fill with the invariant checked on the JOINED text after every
  // candidate line — per-item token sums drift from the joined estimate
  // (separators, headings), so this is the only sound check. O(n²) estimate
  // calls over ≤ a few hundred short lines; negligible.
  const kept: string[] = [];
  const sectionCounts: Record<string, number> = {};
  outer: for (const section of sections) {
    let addedInSection = 0;
    for (const line of section.lines) {
      const candidate = [...kept, line].join("\n");
      if (estimateTokens(candidate) > effectiveBudget) {
        if (section.key === "header") break outer;
        break;
      }
      kept.push(line);
      if (line.startsWith("- ")) addedInSection += 1;
    }
    sectionCounts[section.key] = addedInSection;
  }

  const text = kept.join("\n");
  return { text, tokenEstimate: estimateTokens(text), mode, sectionCounts };
}
```

Add to `packages/core/src/index.ts`:

```ts
export {
  DEFAULT_WARM_START_BUDGET,
  MICRO_BUDGET,
  REONBOARD_UPSELL_LINE,
  assembleWarmStartBrief,
  selectWarmStartMode,
  type GitDelta,
  type WarmStartBrief,
  type WarmStartInput,
  type WarmStartMode,
} from "./warm-start.js";
```

- [ ] **Step 2.4: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/core test -- test/warm-start.test.ts`
Expected: PASS

- [ ] **Step 2.5: Commit**

```bash
git add packages/core/src/warm-start.ts packages/core/test/warm-start.test.ts packages/core/src/index.ts
git commit -m "feat(core): pure warm-start brief assembler"
```

---

### Task 3: Assembler — mode boundaries, reonboard, micro clamp

**Files:**
- Modify: `packages/core/test/warm-start.test.ts` (append describe blocks)

The implementation from Task 2 already contains the mode logic; this task pins it with boundary tests. If any test fails, fix `warm-start.ts` — do not weaken the test.

- [ ] **Step 3.1: Write the failing/pinning tests (append to warm-start.test.ts)**

```ts
describe("mode selection", () => {
  it("null lastSeenAt -> standard", () => {
    expect(selectWarmStartMode(NOW, null)).toBe("standard");
  });
  it("boundaries: <4h micro, 4h-14d standard, >14d reonboard", () => {
    expect(selectWarmStartMode(NOW, "2026-07-12T07:00:00.000Z")).toBe("micro"); // 3h
    expect(selectWarmStartMode(NOW, "2026-07-12T06:00:00.000Z")).toBe("standard"); // exactly 4h
    expect(selectWarmStartMode(NOW, "2026-07-01T10:00:00.000Z")).toBe("standard"); // 11d
    expect(selectWarmStartMode(NOW, "2026-06-27T10:00:00.000Z")).toBe("standard"); // exactly 14d
    expect(selectWarmStartMode(NOW, "2026-06-27T09:59:59.000Z")).toBe("reonboard"); // 14d + 1s
  });
});

describe("micro mode", () => {
  it("hard 300 budget overrides a larger --budget", () => {
    const input = baseInput({
      lastSeenAt: "2026-07-12T09:00:00.000Z", // 1h -> micro
      budgetTokens: 8000,
      rules: Array.from({ length: 20 }, (_, i) => rule({ title: `rule ${i}`, rule: "y".repeat(500) })),
    });
    const brief = assembleWarmStartBrief(input);
    expect(brief.mode).toBe("micro");
    expect(estimateTokens(brief.text)).toBeLessThanOrEqual(300);
  });

  it("explicit mode override escapes the micro clamp", () => {
    const input = baseInput({ lastSeenAt: "2026-07-12T09:00:00.000Z", mode: "standard" });
    expect(assembleWarmStartBrief(input).mode).toBe("standard");
  });

  it("micro carries no decisions/failures/git sections", () => {
    const input = baseInput({
      lastSeenAt: "2026-07-12T09:00:00.000Z",
      memories: [mem({ type: "decision", title: "DEC-HIDDEN" })],
      gitDelta: { commits: [{ sha: "abc1234", subject: "wip", date: NOW }], changedFiles: [] },
    });
    const t = assembleWarmStartBrief(input).text;
    expect(t).not.toContain("DEC-HIDDEN");
    expect(t).not.toContain("abc1234");
  });
});

describe("reonboard mode", () => {
  const AWAY_SINCE = "2026-06-01T00:00:00.000Z"; // 41d -> reonboard

  it("surfaces a memory whose validTo fell inside the absence window", () => {
    const input = baseInput({
      lastSeenAt: AWAY_SINCE,
      memories: [mem({ title: "npm decision", validTo: "2026-06-15T00:00:00.000Z" })],
    });
    const t = assembleWarmStartBrief(input).text;
    expect(t).toContain("Changed while you were away");
    expect(t).toContain("npm decision");
  });

  it("surfaces rules added since (createdAt in window)", () => {
    const input = baseInput({
      lastSeenAt: AWAY_SINCE,
      rules: [rule({ title: "fresh rule", createdAt: "2026-06-20T00:00:00.000Z" })],
    });
    expect(assembleWarmStartBrief(input).text).toContain("new rule: fresh rule");
  });

  it("free tier gets the full standard body plus one upsell line", () => {
    const input = baseInput({
      lastSeenAt: AWAY_SINCE,
      reonboardUnlocked: false,
      memories: [mem({ type: "decision", title: "DEC-VISIBLE" })],
    });
    const t = assembleWarmStartBrief(input).text;
    expect(t).toContain("DEC-VISIBLE"); // standard body intact
    expect(t).toContain("Pro: expanded absence diff");
    expect(t).not.toContain("Changed while you were away");
  });
});

describe("timeless (sentinel-block) variant", () => {
  it("omits branch/visit header detail and git sections, keeps rules+decisions+todos+failures", () => {
    const input = baseInput({
      timeless: true,
      memories: [mem({ type: "decision", title: "DEC-T" })],
      rules: [rule({ title: "RULE-T" })],
      failedAttempts: [attempt({ task: "FAIL-T" })],
      gitDelta: { commits: [{ sha: "abc1234", subject: "wip", date: NOW }], changedFiles: [] },
    });
    const t = assembleWarmStartBrief(input).text;
    for (const want of ["DEC-T", "RULE-T", "FAIL-T"]) expect(t).toContain(want);
    expect(t).not.toContain("abc1234");
    expect(t).not.toContain("last visit");
  });
});
```

- [ ] **Step 3.2: Run tests**

Run: `pnpm --filter @megasaver/core test -- test/warm-start.test.ts`
Expected: PASS (mode logic shipped in Task 2). Any FAIL here = fix `warm-start.ts` until green; boundary semantics are `gap < 4h` micro, `gap > 14d` reonboard (both exact boundaries land on standard).

- [ ] **Step 3.3: Commit**

```bash
git add packages/core/test/warm-start.test.ts
git commit -m "test(core): pin warm-start mode boundaries and gating"
```

---

### Task 4: Git delta gatherer (CLI)

**Files:**
- Create: `apps/cli/src/git-delta.ts`
- Create: `apps/cli/test/git-delta.test.ts`

- [ ] **Step 4.1: Write the failing tests**

```ts
// apps/cli/test/git-delta.test.ts
import { describe, expect, it } from "vitest";
import { type ExecGit, gatherGitDelta } from "../src/git-delta.js";

const SINCE = "2026-07-01T00:00:00.000Z";

function fakeGit(responses: Record<string, string | Error>): ExecGit {
  return (args) => {
    const key = args.join(" ");
    for (const [prefix, value] of Object.entries(responses)) {
      if (key.startsWith(prefix)) {
        if (value instanceof Error) throw value;
        return value;
      }
    }
    throw new Error(`unexpected git ${key}`);
  };
}

describe("gatherGitDelta", () => {
  it("uses merge-base diff on a feature branch", () => {
    const delta = gatherGitDelta("/repo", SINCE, fakeGit({
      "rev-parse --abbrev-ref HEAD": "feat/x\n",
      "symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/main\n",
      "merge-base origin/main HEAD": "aaa111\n",
      "log --since": "abc1234\tfix parser\t2026-07-10T00:00:00+00:00\n",
      "diff --numstat": "10\t2\tsrc/parser.ts\n",
    }));
    expect(delta).not.toBeNull();
    expect(delta?.changedFiles).toEqual([{ path: "src/parser.ts", churn: 12 }]);
    expect(delta?.commits[0]).toEqual({
      sha: "abc1234",
      subject: "fix parser",
      date: "2026-07-10T00:00:00+00:00",
    });
  });

  it("falls back to log --name-only on the default branch (empty diff)", () => {
    const delta = gatherGitDelta("/repo", SINCE, fakeGit({
      "rev-parse --abbrev-ref HEAD": "main\n",
      "symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/main\n",
      "log --since": "abc1234\twip\t2026-07-10T00:00:00+00:00\n",
      "log --name-only": "src/a.ts\nsrc/b.ts\nsrc/a.ts\n",
    }));
    expect(delta?.changedFiles.map((f) => f.path).sort()).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("caps --since at 14 days when lastSeenAt is null", () => {
    const seen: string[] = [];
    gatherGitDelta("/repo", null, (args) => {
      seen.push(args.join(" "));
      if (args[0] === "rev-parse") return "main\n";
      if (args[0] === "symbolic-ref") return "refs/remotes/origin/main\n";
      return "";
    }, "2026-07-12T10:00:00.000Z");
    const logCall = seen.find((c) => c.startsWith("log --since"));
    expect(logCall).toContain("2026-06-28"); // 14d before now
  });

  it("returns null when git is unavailable", () => {
    expect(gatherGitDelta("/repo", SINCE, () => { throw new Error("ENOENT"); })).toBeNull();
  });
});
```

- [ ] **Step 4.2: Run tests to verify they fail**

Run: `pnpm --filter @megasaver/cli test -- git-delta`
Expected: FAIL — module not found

- [ ] **Step 4.3: Write the implementation**

```ts
// apps/cli/src/git-delta.ts
import { execFileSync } from "node:child_process";
import type { GitDelta } from "@megasaver/core";

export type ExecGit = (args: string[], cwd: string) => string;

const defaultExecGit: ExecGit = (args, cwd) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

const FALLBACK_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function tryGit(exec: ExecGit, args: string[], cwd: string): string | null {
  try {
    return exec(args, cwd);
  } catch {
    return null;
  }
}

function defaultBranch(exec: ExecGit, cwd: string): string | null {
  const head = tryGit(exec, ["symbolic-ref", "refs/remotes/origin/HEAD"], cwd);
  if (head !== null) {
    const name = head.trim().split("/").pop();
    if (name !== undefined && name.length > 0) return `origin/${name}`;
  }
  for (const candidate of ["main", "master"]) {
    if (tryGit(exec, ["rev-parse", "--verify", candidate], cwd) !== null) return candidate;
  }
  return null;
}

function parseNumstat(out: string): GitDelta["changedFiles"] {
  const files: GitDelta["changedFiles"] = [];
  for (const line of out.split("\n")) {
    const [add, del, path] = line.split("\t");
    if (path === undefined || path.trim() === "") continue;
    const churn = (Number.parseInt(add ?? "0", 10) || 0) + (Number.parseInt(del ?? "0", 10) || 0);
    files.push({ path: path.trim(), churn });
  }
  return files;
}

function parseNameOnly(out: string): GitDelta["changedFiles"] {
  const counts = new Map<string, number>();
  for (const line of out.split("\n")) {
    const path = line.trim();
    if (path === "" || path.includes("\t")) continue;
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return [...counts.entries()].map(([path, churn]) => ({ path, churn }));
}

// Spec §7 fallback chain: merge-base diff on a feature branch; on the default
// branch / detached HEAD / empty diff, fall back to log --name-only since the
// last visit — otherwise the branch-aware failed-attempts section is a
// permanent no-op for the common single-branch workflow.
export function gatherGitDelta(
  cwd: string,
  lastSeenAt: string | null,
  execGit: ExecGit = defaultExecGit,
  nowIso?: string,
): GitDelta | null {
  const branchRaw = tryGit(execGit, ["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  if (branchRaw === null) return null;
  const branch = branchRaw.trim();

  const nowMs = nowIso === undefined ? Date.parse(new Date().toISOString()) : Date.parse(nowIso);
  const since =
    lastSeenAt ?? new Date(nowMs - FALLBACK_WINDOW_MS).toISOString();

  const logOut =
    tryGit(execGit, ["log", `--since=${since}`, "--format=%h%x09%s%x09%cI"], cwd) ?? "";
  const commits: GitDelta["commits"] = [];
  for (const line of logOut.split("\n")) {
    const [sha, subject, date] = line.split("\t");
    if (sha === undefined || sha.trim() === "" || subject === undefined || date === undefined) {
      continue;
    }
    commits.push({ sha: sha.trim(), subject: subject.trim(), date: date.trim() });
  }

  const def = defaultBranch(execGit, cwd);
  let changedFiles: GitDelta["changedFiles"] = [];
  const onFeatureBranch =
    def !== null && branch !== "HEAD" && branch !== def && `origin/${branch}` !== def;
  if (onFeatureBranch) {
    const base = tryGit(execGit, ["merge-base", def, "HEAD"], cwd)?.trim();
    if (base !== undefined && base.length > 0) {
      const out = tryGit(execGit, ["diff", "--numstat", `${base}..HEAD`], cwd);
      if (out !== null) changedFiles = parseNumstat(out);
    }
  }
  if (changedFiles.length === 0) {
    const out = tryGit(execGit, ["log", "--name-only", `--since=${since}`, "--format="], cwd);
    if (out !== null) changedFiles = parseNameOnly(out);
  }

  return { commits, changedFiles };
}
```

- [ ] **Step 4.4: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/cli test -- git-delta`
Expected: PASS

- [ ] **Step 4.5: Commit**

```bash
git add apps/cli/src/git-delta.ts apps/cli/test/git-delta.test.ts
git commit -m "feat(cli): git delta gatherer with default-branch fallback"
```

---

### Task 5: Stats `WarmStartEvent` (schema + JSONL store + core re-export)

**Files:**
- Create: `packages/stats/src/warm-start-event.ts`
- Create: `packages/stats/test/warm-start-event.test.ts`
- Modify: `packages/stats/src/index.ts`, `packages/core/src/index.ts`

- [ ] **Step 5.1: Write the failing tests**

```ts
// packages/stats/test/warm-start-event.test.ts
import { mkdtempSync, rmSync, appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendWarmStartEvent,
  readWarmStartEvents,
  warmStartEventSchema,
} from "../src/warm-start-event.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-wsevent-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function event(over: Partial<Record<string, unknown>> = {}) {
  return warmStartEventSchema.parse({
    id: "e1",
    projectId: PROJECT_ID,
    createdAt: "2026-07-12T10:00:00.000Z",
    mode: "standard",
    briefTokens: 812,
    estimated: true,
    ...over,
  });
}

describe("WarmStartEvent", () => {
  it("is its own schema — TokenSaverEvent byte fields are rejected", () => {
    expect(
      warmStartEventSchema.safeParse({ ...event(), rawBytes: 1 } as unknown).success,
    ).toBe(false);
  });

  it("appends and reads back per project", () => {
    appendWarmStartEvent({ root }, event({ id: "e1" }));
    appendWarmStartEvent({ root }, event({ id: "e2", mode: "micro" }));
    const events = readWarmStartEvents({ root }, PROJECT_ID);
    expect(events.map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("skips torn/garbage lines instead of crashing", () => {
    appendWarmStartEvent({ root }, event({ id: "e1" }));
    const path = join(root, "stats", PROJECT_ID, "warm-start.events.jsonl");
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, "{torn\n");
    expect(readWarmStartEvents({ root }, PROJECT_ID).length).toBe(1);
  });

  it("returns [] when nothing recorded", () => {
    expect(readWarmStartEvents({ root }, PROJECT_ID)).toEqual([]);
  });
});
```

- [ ] **Step 5.2: Run tests to verify they fail**

Run: `pnpm --filter @megasaver/stats test -- warm-start-event`
Expected: FAIL — module not found

- [ ] **Step 5.3: Write the implementation**

```ts
// packages/stats/src/warm-start-event.ts
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { projectIdSchema } from "@megasaver/shared";
import { z } from "zod";

// Deliberately NOT a TokenSaverEvent: warm-start numbers are measured brief
// sizes, not byte-savings measurements — mixing them would poison the honest
// savings pipeline (spec §5). `estimated: true` reserves the future slot for
// counterfactual claims; v1 records measured brief tokens only.
export const warmStartEventSchema = z
  .object({
    id: z.string().min(1),
    projectId: projectIdSchema,
    createdAt: z.string().datetime({ offset: true }),
    mode: z.enum(["micro", "standard", "reonboard"]),
    briefTokens: z.number().int().nonnegative(),
    estimated: z.literal(true),
  })
  .strict();

export type WarmStartEvent = z.infer<typeof warmStartEventSchema>;

type StoreRoot = { root: string };

function warmStartEventsPath(store: StoreRoot, projectId: string): string {
  return join(store.root, "stats", projectId, "warm-start.events.jsonl");
}

export function appendWarmStartEvent(store: StoreRoot, event: WarmStartEvent): void {
  const parsed = warmStartEventSchema.parse(event);
  const path = warmStartEventsPath(store, parsed.projectId);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(parsed)}\n`);
}

export function readWarmStartEvents(store: StoreRoot, projectId: string): WarmStartEvent[] {
  const path = warmStartEventsPath(store, projectId);
  if (!existsSync(path)) return [];
  const events: WarmStartEvent[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = warmStartEventSchema.safeParse(raw);
    if (parsed.success) events.push(parsed.data);
  }
  return events;
}
```

Export from `packages/stats/src/index.ts`, then re-export from `packages/core/src/index.ts` (the CLI reads stats only through core — see comment in `apps/cli/src/commands/savings/shared.ts`):

```ts
// packages/stats/src/index.ts  (add)
export {
  appendWarmStartEvent,
  readWarmStartEvents,
  warmStartEventSchema,
  type WarmStartEvent,
} from "./warm-start-event.js";

// packages/core/src/index.ts  (add, next to the existing readEvents re-export)
export {
  appendWarmStartEvent,
  readWarmStartEvents,
  type WarmStartEvent,
} from "@megasaver/stats";
```

- [ ] **Step 5.4: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/stats test -- warm-start-event` then `pnpm --filter @megasaver/core build`
Expected: PASS; core builds with the re-export.

- [ ] **Step 5.5: Commit**

```bash
git add packages/stats/src/warm-start-event.ts packages/stats/test/warm-start-event.test.ts packages/stats/src/index.ts packages/core/src/index.ts
git commit -m "feat(stats): WarmStartEvent — measured brief-size record"
```

---

### Task 6: `mega warmup` command (stdout path)

**Files:**
- Create: `apps/cli/src/commands/warmup.ts`
- Create: `apps/cli/test/commands/warmup.test.ts`
- Modify: `apps/cli/src/main.ts` (register `warmup`)

- [ ] **Step 6.1: Write the failing tests**

Temp-store pattern mirrors `apps/cli/test/commands/savings-fix.test.ts`. The command is written testable-first: `runWarmup(input)` with injected deps, thin Citty wrapper.

```ts
// apps/cli/test/commands/warmup.test.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findProjectByCwd, runWarmup } from "../../src/commands/warmup.js";
import { ensureStoreReady } from "../../src/store.js";

const NOW = "2026-07-12T10:00:00.000Z";
let root: string;
let out: string[];
let err: string[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-warmup-"));
  out = [];
  err = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function seedProject(rootPath: string) {
  const { registry } = await ensureStoreReady(root);
  const project = registry.createProject({
    id: "11111111-1111-4111-8111-111111111111",
    name: "demo",
    rootPath,
    createdAt: NOW,
  } as never);
  return { registry, project };
}

function baseInput(over: Partial<Parameters<typeof runWarmup>[0]> = {}) {
  return {
    storeRoot: root,
    cwd: "/work/demo",
    now: () => Date.parse(NOW),
    json: false,
    write: false,
    gatherDelta: () => null,
    ensureStore: () => ensureStoreReady(root),
    stdout: (l: string) => out.push(l),
    stderr: (l: string) => err.push(l),
    ...over,
  };
}

describe("findProjectByCwd", () => {
  it("picks the longest rootPath match", () => {
    const projects = [
      { rootPath: "/work" },
      { rootPath: "/work/demo" },
    ] as never[];
    expect(findProjectByCwd(projects as never, "/work/demo/src")).toEqual({
      rootPath: "/work/demo",
    });
    expect(findProjectByCwd(projects as never, "/elsewhere")).toBeNull();
  });
});

describe("runWarmup", () => {
  it("prints a brief for the cwd-resolved project", async () => {
    await seedProject("/work/demo");
    const code = await runWarmup(baseInput());
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("Warm Start — demo");
  });

  it("errors when no project matches cwd", async () => {
    await seedProject("/work/demo");
    const code = await runWarmup(baseInput({ cwd: "/nowhere" }));
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("no project");
  });

  it("--json emits the WarmStartBrief struct", async () => {
    await seedProject("/work/demo");
    await runWarmup(baseInput({ json: true }));
    const parsed = JSON.parse(out.join("\n")) as { mode: string; tokenEstimate: number };
    expect(parsed.mode).toBe("standard");
    expect(parsed.tokenEstimate).toBeGreaterThan(0);
  });

  it("stamps lastSeenAt after printing", async () => {
    await seedProject("/work/demo");
    const { readWarmStartState } = await import("@megasaver/core");
    await runWarmup(baseInput());
    expect(readWarmStartState(root, "11111111-1111-4111-8111-111111111111")).not.toBeNull();
  });

  it("records a WarmStartEvent", async () => {
    await seedProject("/work/demo");
    const { readWarmStartEvents } = await import("@megasaver/core");
    await runWarmup(baseInput());
    const events = readWarmStartEvents({ root }, "11111111-1111-4111-8111-111111111111");
    expect(events.length).toBe(1);
    expect(events[0]?.estimated).toBe(true);
  });
});
```

Note: if `registry.createProject` requires more fields than `{id,name,rootPath,createdAt}`, read `packages/core/src/project.ts` and complete the fixture — do NOT cast blindly; the `as never` above is a placeholder for exactly this check.

- [ ] **Step 6.2: Run tests to verify they fail**

Run: `pnpm --filter @megasaver/cli test -- commands/warmup`
Expected: FAIL — module not found

- [ ] **Step 6.3: Write the implementation**

```ts
// apps/cli/src/commands/warmup.ts
import { randomUUID } from "node:crypto";
import { sep } from "node:path";
import {
  DEFAULT_WARM_START_BUDGET,
  type GitDelta,
  type Project,
  type WarmStartMode,
  appendWarmStartEvent,
  assembleWarmStartBrief,
  readWarmStartState,
  stampWarmStartSeen,
} from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
import { defineCommand } from "citty";
import { gatherGitDelta } from "../git-delta.js";
import {
  type EnsureStoreReadyResult,
  ensureStoreReady,
  readStoreEnv,
  resolveStorePath,
} from "../store.js";

export function findProjectByCwd(projects: readonly Project[], cwd: string): Project | null {
  const matches = projects.filter(
    (p) => cwd === p.rootPath || cwd.startsWith(p.rootPath + sep),
  );
  matches.sort((a, b) => b.rootPath.length - a.rootPath.length);
  return matches[0] ?? null;
}

export type RunWarmupInput = {
  storeRoot: string;
  cwd: string;
  now: () => number;
  budget?: number;
  mode?: WarmStartMode;
  projectName?: string;
  json: boolean;
  write: boolean;
  writeTarget?: string;
  gatherDelta: (cwd: string, lastSeenAt: string | null) => GitDelta | null;
  ensureStore: () => Promise<EnsureStoreReadyResult>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runWarmup(input: RunWarmupInput): Promise<0 | 1> {
  const { registry } = await input.ensureStore();
  const project =
    input.projectName !== undefined
      ? (registry.listProjects().find((p) => p.name === input.projectName) ?? null)
      : findProjectByCwd(registry.listProjects(), input.cwd);
  if (project === null) {
    input.stderr(`error: no project matches ${input.projectName ?? input.cwd} — run: mega init`);
    return 1;
  }

  const nowIso = new Date(input.now()).toISOString();
  const lastSeenAt = readWarmStartState(input.storeRoot, project.id)?.lastSeenAt ?? null;
  const reonboardUnlocked = checkEntitlement("savings-analytics", {
    storeRoot: input.storeRoot,
    now: input.now,
  }).entitled;

  if (input.write) {
    // Task 10 wires the sentinel-block write path; until then --write is a
    // hard error so we never ship a silent no-op flag.
    input.stderr("error: --write not available yet");
    return 1;
  }

  const brief = assembleWarmStartBrief({
    projectName: project.name,
    branch: null,
    now: nowIso,
    ...(input.budget !== undefined ? { budgetTokens: input.budget } : {}),
    ...(input.mode !== undefined ? { mode: input.mode } : {}),
    lastSeenAt,
    reonboardUnlocked,
    timeless: false,
    memories: registry.listMemoryEntries(project.id),
    rules: registry.listProjectRules(project.id),
    failedAttempts: registry.listFailedAttempts(project.id),
    gitDelta: input.gatherDelta(input.cwd, lastSeenAt),
  });

  input.stdout(input.json ? JSON.stringify(brief) : brief.text);
  stampWarmStartSeen(input.storeRoot, project.id, nowIso);
  try {
    appendWarmStartEvent(
      { root: input.storeRoot },
      {
        id: randomUUID(),
        projectId: project.id,
        createdAt: nowIso,
        mode: brief.mode,
        briefTokens: brief.tokenEstimate,
        estimated: true,
      },
    );
  } catch {
    // stats are advisory — never fail the brief over a bad event write
  }
  return 0;
}

const MODES = ["auto", "micro", "standard", "reonboard"] as const;

export const warmupCommand = defineCommand({
  meta: {
    name: "warmup",
    description: "Print a budgeted session boot brief assembled from the project brain.",
  },
  args: {
    budget: { type: "string", description: "Token budget (default 2000, min 300, max 8000)." },
    mode: { type: "string", description: "auto|micro|standard|reonboard (default auto)." },
    project: { type: "string", description: "Project name (default: resolve by cwd)." },
    json: { type: "boolean", default: false, description: "Emit the WarmStartBrief as JSON." },
    write: {
      type: "boolean",
      default: false,
      description: "Upsert the brief as a sentinel block into agent files (Mega Saver Pro).",
    },
    target: { type: "string", description: "With --write: connector target or 'all'." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const budget = args.budget === undefined ? undefined : Number.parseInt(String(args.budget), 10);
    if (budget !== undefined && (Number.isNaN(budget) || budget < 300 || budget > 8000)) {
      console.error("error: --budget must be an integer in [300, 8000]");
      process.exitCode = 1;
      return;
    }
    const modeArg = args.mode === undefined ? "auto" : String(args.mode);
    if (!(MODES as readonly string[]).includes(modeArg)) {
      console.error("error: --mode must be one of auto|micro|standard|reonboard");
      process.exitCode = 1;
      return;
    }
    const storeRoot = resolveStorePath(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    const code = await runWarmup({
      storeRoot,
      cwd: process.cwd(),
      now: () => Date.now(),
      ...(budget !== undefined ? { budget } : {}),
      ...(modeArg !== "auto" ? { mode: modeArg as WarmStartMode } : {}),
      ...(typeof args.project === "string" ? { projectName: args.project } : {}),
      json: !!args.json,
      write: !!args.write,
      ...(typeof args.target === "string" ? { writeTarget: args.target } : {}),
      gatherDelta: (cwd, lastSeenAt) => gatherGitDelta(cwd, lastSeenAt),
      ensureStore: () => ensureStoreReady(storeRoot),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

Register in `apps/cli/src/main.ts`: import `warmupCommand` from `./commands/warmup.js` and add `warmup: warmupCommand,` to the root `subCommands` map. Note: `runWarmup` passes `branch: null`; the branch shown in the header comes into play via `gatherGitDelta` internals only — if you want the branch name in the header, extend `gatherDelta` to also return it in a later polish, not now (YAGNI: the hook path in Task 7 passes branch the same way).

- [ ] **Step 6.4: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/cli test -- commands/warmup`
Expected: PASS

- [ ] **Step 6.5: Smoke by hand**

```bash
pnpm --filter @megasaver/cli build
node apps/cli/dist/main.mjs warmup --store /tmp/ws-smoke || true
```
Expected: "no project matches" error (empty store) — proves wiring; exit code 1.

- [ ] **Step 6.6: Commit**

```bash
git add apps/cli/src/commands/warmup.ts apps/cli/test/commands/warmup.test.ts apps/cli/src/main.ts
git commit -m "feat(cli): mega warmup — budgeted session boot brief"
```

---

### Task 7: SessionStart hook runner (fail-open) + `mega hooks warmup`

**Files:**
- Create: `apps/cli/src/hooks/warmup-run.ts`
- Create: `apps/cli/src/commands/hooks/warmup.ts`
- Create: `apps/cli/test/hooks/warmup-run.test.ts`
- Modify: `apps/cli/src/commands/hooks/index.ts`

- [ ] **Step 7.1: Write the failing tests**

```ts
// apps/cli/test/hooks/warmup-run.test.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildWarmupHookOutput } from "../../src/hooks/warmup-run.js";
import { ensureStoreReady } from "../../src/store.js";

const NOW = "2026-07-12T10:00:00.000Z";
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-warmhook-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("buildWarmupHookOutput", () => {
  it("returns the brief text for a matching project", async () => {
    const { registry } = await ensureStoreReady(root);
    registry.createProject({
      id: "11111111-1111-4111-8111-111111111111",
      name: "demo",
      rootPath: "/work/demo",
      createdAt: NOW,
    } as never);
    const text = await buildWarmupHookOutput({
      payload: { session_id: "s1", cwd: "/work/demo", source: "startup" },
      storeRoot: root,
      now: () => Date.parse(NOW),
      gatherDelta: () => null,
    });
    expect(text).toContain("Warm Start — demo");
  });

  it("returns empty string when no project matches (fail-open)", async () => {
    await ensureStoreReady(root);
    const text = await buildWarmupHookOutput({
      payload: { session_id: "s1", cwd: "/nowhere", source: "startup" },
      storeRoot: root,
      now: () => Date.parse(NOW),
      gatherDelta: () => null,
    });
    expect(text).toBe("");
  });

  it("returns empty string on malformed payload (fail-open)", async () => {
    const text = await buildWarmupHookOutput({
      payload: { nope: true },
      storeRoot: root,
      now: () => Date.parse(NOW),
      gatherDelta: () => null,
    });
    expect(text).toBe("");
  });

  it("stamps lastSeenAt on success", async () => {
    const { registry } = await ensureStoreReady(root);
    registry.createProject({
      id: "11111111-1111-4111-8111-111111111111",
      name: "demo",
      rootPath: "/work/demo",
      createdAt: NOW,
    } as never);
    const { readWarmStartState } = await import("@megasaver/core");
    await buildWarmupHookOutput({
      payload: { session_id: "s1", cwd: "/work/demo", source: "startup" },
      storeRoot: root,
      now: () => Date.parse(NOW),
      gatherDelta: () => null,
    });
    expect(readWarmStartState(root, "11111111-1111-4111-8111-111111111111")?.lastSeenAt).toBe(NOW);
  });
});
```

- [ ] **Step 7.2: Run tests to verify they fail**

Run: `pnpm --filter @megasaver/cli test -- hooks/warmup-run`
Expected: FAIL — module not found

- [ ] **Step 7.3: Write the implementation**

```ts
// apps/cli/src/hooks/warmup-run.ts
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  type GitDelta,
  appendWarmStartEvent,
  assembleWarmStartBrief,
  readWarmStartState,
  stampWarmStartSeen,
} from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
import { z } from "zod";
import { findProjectByCwd } from "../commands/warmup.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../store.js";
import { gatherGitDelta } from "../git-delta.js";

const sessionStartPayloadSchema = z
  .object({ session_id: z.string(), cwd: z.string(), source: z.string() })
  .passthrough();

export type BuildWarmupHookInput = {
  payload: unknown;
  storeRoot: string;
  now: () => number;
  gatherDelta: (cwd: string, lastSeenAt: string | null) => GitDelta | null;
};

// Pure-ish core of the hook, extracted for tests. Contract: NEVER throws —
// every failure returns "" so the SessionStart hook can never block a session.
export async function buildWarmupHookOutput(input: BuildWarmupHookInput): Promise<string> {
  try {
    const parsed = sessionStartPayloadSchema.safeParse(input.payload);
    if (!parsed.success) return "";
    const cwd = parsed.data.cwd;
    const { registry } = await ensureStoreReady(input.storeRoot);
    const project = findProjectByCwd(registry.listProjects(), cwd);
    if (project === null) return "";

    const nowIso = new Date(input.now()).toISOString();
    const lastSeenAt = readWarmStartState(input.storeRoot, project.id)?.lastSeenAt ?? null;
    const reonboardUnlocked = checkEntitlement("savings-analytics", {
      storeRoot: input.storeRoot,
      now: input.now,
    }).entitled;

    const brief = assembleWarmStartBrief({
      projectName: project.name,
      branch: null,
      now: nowIso,
      lastSeenAt,
      reonboardUnlocked,
      timeless: false,
      memories: registry.listMemoryEntries(project.id),
      rules: registry.listProjectRules(project.id),
      failedAttempts: registry.listFailedAttempts(project.id),
      gitDelta: input.gatherDelta(cwd, lastSeenAt),
    });

    stampWarmStartSeen(input.storeRoot, project.id, nowIso);
    try {
      appendWarmStartEvent(
        { root: input.storeRoot },
        {
          id: randomUUID(),
          projectId: project.id,
          createdAt: nowIso,
          mode: brief.mode,
          briefTokens: brief.tokenEstimate,
          estimated: true,
        },
      );
    } catch {
      // advisory
    }
    return brief.text;
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

// Always exits 0; empty stdout on any failure (SessionStart "no output" = no
// injection). A crashing SessionStart hook would block every session — this
// is the one place error handling is not optional (spec, Error handling).
export async function runWarmupHookFromProcess(): Promise<void> {
  process.exitCode = 0;
  try {
    const raw = readStdinSync().trim();
    if (raw === "") return;
    const payload: unknown = JSON.parse(raw);
    const storeRoot = resolveStorePath(readStoreEnv(undefined));
    const text = await buildWarmupHookOutput({
      payload,
      storeRoot,
      now: () => Date.now(),
      gatherDelta: (cwd, lastSeenAt) => gatherGitDelta(cwd, lastSeenAt),
    });
    if (text !== "") process.stdout.write(text);
  } catch {
    // Swallow — fail-open.
  }
}
```

```ts
// apps/cli/src/commands/hooks/warmup.ts
import { defineCommand } from "citty";
import { runWarmupHookFromProcess } from "../../hooks/warmup-run.js";

// The command Claude Code's SessionStart hook invokes. Reads the SessionStart
// payload on stdin and prints the warm-start brief to stdout (Claude Code
// injects stdout into the session context). SAFETY: ALWAYS exits 0; prints
// nothing on any error. Wired by `mega hooks install`, not run by hand.
export const hooksWarmupCommand = defineCommand({
  meta: {
    name: "warmup",
    description: "Internal: print the warm-start brief for a SessionStart hook (stdin payload).",
  },
  async run() {
    await runWarmupHookFromProcess();
  },
});
```

In `apps/cli/src/commands/hooks/index.ts` add `warmup: hooksWarmupCommand` to `subCommands` (import from `./warmup.js`).

- [ ] **Step 7.4: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/cli test -- hooks/warmup-run`
Expected: PASS

- [ ] **Step 7.5: Commit**

```bash
git add apps/cli/src/hooks/warmup-run.ts apps/cli/src/commands/hooks/warmup.ts apps/cli/test/hooks/warmup-run.test.ts apps/cli/src/commands/hooks/index.ts
git commit -m "feat(cli): fail-open SessionStart warmup hook runner"
```

---

### Task 8: hook-settings — SessionStart entry

**Files:**
- Modify: `packages/connectors/claude-code/src/hook-settings.ts`
- Modify: `packages/connectors/claude-code/test/hook-settings.test.ts` (append cases)
- Modify: `apps/cli/src/commands/hooks/install.ts` (`--no-warmup`)

- [ ] **Step 8.1: Write the failing tests (append)**

```ts
// packages/connectors/claude-code/test/hook-settings.test.ts  (append)
import {
  WARMUP_HOOK_COMMAND,
  addSessionStartHook,
  hasSessionStartHook,
  installClaudeCodeHook,
  readClaudeCodeHookStatus,
  removeSessionStartHook,
  uninstallClaudeCodeHook,
} from "../src/hook-settings.js";

describe("SessionStart warmup hook", () => {
  it("adds a matcher-less SessionStart entry with 10s timeout", () => {
    const next = addSessionStartHook({}, WARMUP_HOOK_COMMAND) as {
      hooks: { SessionStart: { matcher?: string; hooks: { command: string; timeout: number }[] }[] };
    };
    const entry = next.hooks.SessionStart[0];
    expect(entry?.matcher).toBeUndefined();
    expect(entry?.hooks[0]).toEqual({
      type: "command",
      command: WARMUP_HOOK_COMMAND,
      timeout: 10,
    });
  });

  it("is idempotent", () => {
    const once = addSessionStartHook({}, WARMUP_HOOK_COMMAND);
    const twice = addSessionStartHook(once, WARMUP_HOOK_COMMAND);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it("has/remove round-trip", () => {
    const added = addSessionStartHook({}, WARMUP_HOOK_COMMAND);
    expect(hasSessionStartHook(added, WARMUP_HOOK_COMMAND)).toBe(true);
    const removed = removeSessionStartHook(added, WARMUP_HOOK_COMMAND);
    expect(hasSessionStartHook(removed, WARMUP_HOOK_COMMAND)).toBe(false);
    expect((removed as { hooks?: unknown }).hooks).toBeUndefined();
  });
});
```

And an install/uninstall/status integration case in the same file, following the existing settings-file fixtures (settings path = temp file, per the file's existing pattern):

```ts
describe("install wires SessionStart", () => {
  it("install adds it, status reports it, uninstall removes it", () => {
    // reuse the file's existing temp settingsPath fixture helpers
    const settingsPath = tmpSettingsPath(); // existing helper in this test file
    installClaudeCodeHook({ settingsPath });
    const status = readClaudeCodeHookStatus({ settingsPath });
    expect(status.warmupInstalled).toBe(true);
    uninstallClaudeCodeHook({ settingsPath });
    expect(readClaudeCodeHookStatus({ settingsPath }).warmupInstalled).toBe(false);
  });

  it("install with warmup:false skips the SessionStart entry", () => {
    const settingsPath = tmpSettingsPath();
    installClaudeCodeHook({ settingsPath, warmup: false });
    expect(readClaudeCodeHookStatus({ settingsPath }).warmupInstalled).toBe(false);
  });
});
```

(If the test file's temp-settings helper has a different name, use that name — read the file first; do not invent a parallel fixture.)

- [ ] **Step 8.2: Run tests to verify they fail**

Run: `pnpm --filter @megasaver/connector-claude-code test`
Expected: FAIL — `addSessionStartHook` not exported

- [ ] **Step 8.3: Implement in `hook-settings.ts`**

Mechanical widening, mirroring the UserPromptSubmit trio exactly:

1. `buildHookCommand` subcommand union: `"log" | "saver" | "intent" | "warmup"`.
2. New constant: `export const WARMUP_HOOK_COMMAND = "mega hooks warmup";`
3. `SettingsObject.hooks` gains `SessionStart?: unknown;`.
4. `pruneHooks` key union gains `"SessionStart"`.
5. `addSessionStartHook` / `hasSessionStartHook` / `removeSessionStartHook`: copy the `addUserPromptSubmitHook` / `hasUserPromptSubmitHook` / `removeUserPromptSubmitHook` bodies, substituting the `SessionStart` key. Matcher-less (Claude Code fires SessionStart on startup/resume/clear; micro mode makes repeat fires cheap — spec §4a). `timeoutFor("warmup")` already yields 10.
6. `InstallClaudeCodeHookInput` gains `warmup?: boolean;`. In `installClaudeCodeHook`, after the intent line:

```ts
  if (input.warmup !== false) {
    next = addSessionStartHook(next, buildHookCommand("warmup", cfg));
  }
```

7. `uninstallClaudeCodeHook`: add `removeSessionStartHook(next, WARMUP_HOOK_COMMAND)` and include `hasSessionStartHook(existing, WARMUP_HOOK_COMMAND)` in the early no-op check.
8. `ClaudeCodeHookStatus` gains `warmupInstalled: boolean` — computed like the others. **Do NOT fold it into `connected`** (that would flip existing fixtures and GUI expectations); `connected` keeps its legacy three-hook meaning.

In `apps/cli/src/commands/hooks/install.ts`: add arg `noWarmup: { type: "boolean", default: false, description: "Skip the SessionStart warm-start hook." }` and thread `warmup: !args.noWarmup` through `runHooksInstall` into `installClaudeCodeHook`.

- [ ] **Step 8.4: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/connector-claude-code test && pnpm --filter @megasaver/cli test -- hooks`
Expected: PASS, including all pre-existing hook-settings tests (drift check: install with default input now also writes SessionStart — existing fixtures asserting the full settings object will need the SessionStart entry added to their expected values; that is a legitimate fixture update, not a test weakening).

- [ ] **Step 8.5: Commit**

```bash
git add packages/connectors/claude-code/src/hook-settings.ts packages/connectors/claude-code/test/hook-settings.test.ts apps/cli/src/commands/hooks/install.ts
git commit -m "feat(connector-claude-code): SessionStart warmup hook entry"
```

---

### Task 9: Savings surfaces — Warm Start line

**Files:**
- Modify: `apps/cli/src/commands/savings/shared.ts`
- Modify: `apps/cli/src/commands/savings/history.ts`, `apps/cli/src/commands/savings/insights.ts`
- Modify: their existing test files (`apps/cli/test/commands/savings-history.test.ts`, `savings-insights.test.ts` — read them first, follow their fixture style)

- [ ] **Step 9.1: Write the failing tests (append to each command's test file)**

```ts
it("appends a Warm Start line when warm-start events exist", async () => {
  // arrange: entitled license fixture per this file's existing pattern, plus:
  const { appendWarmStartEvent } = await import("@megasaver/core");
  appendWarmStartEvent(
    { root },
    {
      id: "w1",
      projectId: PROJECT_ID,
      createdAt: "2026-07-12T10:00:00.000Z",
      mode: "standard",
      briefTokens: 800,
      estimated: true,
    },
  );
  const code = await runSavingsHistory(baseInput({})); // or runSavingsInsights
  expect(code).toBe(0);
  expect(out.join("\n")).toContain("Warm start: 1 sessions warmed, ~800 brief tokens (measured)");
});

it("omits the Warm Start line when no events exist", async () => {
  const code = await runSavingsHistory(baseInput({}));
  expect(code).toBe(0);
  expect(out.join("\n")).not.toContain("Warm start:");
});
```

- [ ] **Step 9.2: Run tests to verify they fail**

Run: `pnpm --filter @megasaver/cli test -- savings-history savings-insights`
Expected: FAIL on the new cases only

- [ ] **Step 9.3: Implement**

`shared.ts` — add after `defaultSavingsEventReader`:

```ts
export type WarmStartTotals = { sessions: number; briefTokens: number };
export type WarmStartTotalsReader = () => WarmStartTotals | Promise<WarmStartTotals>;

export function defaultWarmStartTotalsReader(
  storeInput: ResolveStorePathInput,
): WarmStartTotalsReader {
  return async () => {
    const rootDir = resolveStorePath(storeInput);
    const { registry } = await ensureStoreReady(rootDir);
    let sessions = 0;
    let briefTokens = 0;
    const { readWarmStartEvents } = await import("@megasaver/core");
    for (const project of registry.listProjects()) {
      for (const e of readWarmStartEvents({ root: rootDir }, project.id)) {
        sessions += 1;
        briefTokens += e.briefTokens;
      }
    }
    return { sessions, briefTokens };
  };
}

export function formatWarmStartLine(totals: WarmStartTotals): string | null {
  if (totals.sessions === 0) return null;
  return `Warm start: ${totals.sessions} sessions warmed, ~${totals.briefTokens} brief tokens (measured)`;
}
```

`history.ts` / `insights.ts` — each `Run…Input` type gains `readWarmStartTotals: WarmStartTotalsReader;`; after the existing `rendered` is computed in TEXT mode (not json/csv), append:

```ts
  const warmLine = formatWarmStartLine(await input.readWarmStartTotals());
  if (warmLine !== null) rendered = `${rendered}\n\n${warmLine}`;
```

Wire `readWarmStartTotals: defaultWarmStartTotalsReader(storeInput)` in each command's `run({ args })` wrapper, mirroring how `readAllEvents` is wired. In JSON mode leave output unchanged (measured warm-start numbers land in `--json` in a later slice if asked — YAGNI).

- [ ] **Step 9.4: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/cli test -- savings`
Expected: PASS, all existing savings tests still green (new required input field means existing test fixtures need `readWarmStartTotals: () => ({ sessions: 0, briefTokens: 0 })` added — mechanical fixture update).

- [ ] **Step 9.5: Commit**

```bash
git add apps/cli/src/commands/savings/
git add apps/cli/test/commands/savings-history.test.ts apps/cli/test/commands/savings-insights.test.ts
git commit -m "feat(cli): measured Warm Start line in savings surfaces"
```

---

### Task 10: Connectors-shared — WS sentinel block + upsert third pass

**Files:**
- Modify: `packages/connectors/shared/src/constants.ts`
- Create: `packages/connectors/shared/src/sentinel-guard.ts`
- Modify: `packages/connectors/shared/src/context.ts` (import guard — pure refactor)
- Create: `packages/connectors/shared/src/warm-start-block.ts`
- Modify: `packages/connectors/shared/src/upsert.ts`, `packages/connectors/shared/src/index.ts`
- Create: `packages/connectors/shared/test/warm-start-block.test.ts`

- [ ] **Step 10.1: Write the failing tests**

```ts
// packages/connectors/shared/test/warm-start-block.test.ts
import { describe, expect, it } from "vitest";
import {
  MEGA_SAVER_WS_BLOCK_END,
  MEGA_SAVER_WS_BLOCK_START,
} from "../src/constants.js";
import { upsertBlock } from "../src/upsert.js";
import { renderWarmStartBlockText } from "../src/warm-start-block.js";
import { buildContext } from "./fixtures.js";

const FIELDS = { briefText: "# Warm Start — demo\n- [decision] use pnpm", asOf: "2026-07-12T10:00:00.000Z" };

describe("renderWarmStartBlockText", () => {
  it("wraps the brief in WS sentinels with an as-of refresh line", () => {
    const block = renderWarmStartBlockText(FIELDS);
    expect(block.startsWith(MEGA_SAVER_WS_BLOCK_START)).toBe(true);
    expect(block).toContain("use pnpm");
    expect(block).toContain('As of: 2026-07-12T10:00:00.000Z — run "mega warmup --write" to refresh');
    expect(block.trimEnd().endsWith(MEGA_SAVER_WS_BLOCK_END)).toBe(true);
  });

  it("rejects brief text containing any Mega Saver sentinel", () => {
    expect(() =>
      renderWarmStartBlockText({ ...FIELDS, briefText: `x\n${MEGA_SAVER_WS_BLOCK_END}\ny` }),
    ).toThrow();
    expect(() =>
      renderWarmStartBlockText({ ...FIELDS, briefText: "<!-- MEGA SAVER:BEGIN -->" }),
    ).toThrow();
  });
});

describe("upsertBlock warmStartBlock pass", () => {
  it("inserts, then replaces in place (idempotent, single pair)", () => {
    const block1 = renderWarmStartBlockText(FIELDS);
    const first = upsertBlock({
      existingContent: "intro\n",
      context: buildContext({}),
      warmStartBlock: block1,
    });
    const block2 = renderWarmStartBlockText({ ...FIELDS, briefText: "# Warm Start — v2" });
    const second = upsertBlock({
      existingContent: first,
      context: buildContext({}),
      warmStartBlock: block2,
    });
    expect(second).toContain("Warm Start — v2");
    expect(second).not.toContain("use pnpm");
    expect(second.split(MEGA_SAVER_WS_BLOCK_START).length - 1).toBe(1);
    expect(second).toContain("intro"); // human content preserved
  });

  it("leaves an existing WS block untouched when warmStartBlock is undefined", () => {
    const withBlock = upsertBlock({
      existingContent: "intro\n",
      context: buildContext({}),
      warmStartBlock: renderWarmStartBlockText(FIELDS),
    });
    const resynced = upsertBlock({ existingContent: withBlock, context: buildContext({}) });
    expect(resynced).toContain("use pnpm");
  });

  it("empty-string warmStartBlock removes the block", () => {
    const withBlock = upsertBlock({
      existingContent: "intro\n",
      context: buildContext({}),
      warmStartBlock: renderWarmStartBlockText(FIELDS),
    });
    const removed = upsertBlock({
      existingContent: withBlock,
      context: buildContext({}),
      warmStartBlock: "",
    });
    expect(removed).not.toContain("use pnpm");
    expect(removed).toContain("intro");
  });
});
```

- [ ] **Step 10.2: Run tests to verify they fail**

Run: `pnpm --filter @megasaver/connectors-shared test -- warm-start-block`
Expected: FAIL — missing exports

- [ ] **Step 10.3: Implement**

`constants.ts` (append):

```ts
export const MEGA_SAVER_WS_BLOCK_START = "<!-- MEGA SAVER:WARM_START BEGIN -->";
export const MEGA_SAVER_WS_BLOCK_END = "<!-- MEGA SAVER:WARM_START END -->";
```

`sentinel-guard.ts` — extract VERBATIM the `SENTINEL_INVISIBLE_CHARS` regex, `normalizeForSentinelCheck`, and `containsSentinel` from `context.ts`, generalized over all six sentinel constants:

```ts
// packages/connectors/shared/src/sentinel-guard.ts
import {
  MEGA_SAVER_BLOCK_END,
  MEGA_SAVER_BLOCK_START,
  MEGA_SAVER_CG_BLOCK_END,
  MEGA_SAVER_CG_BLOCK_START,
  MEGA_SAVER_WS_BLOCK_END,
  MEGA_SAVER_WS_BLOCK_START,
} from "./constants.js";

const ALL_SENTINELS = [
  MEGA_SAVER_BLOCK_START,
  MEGA_SAVER_BLOCK_END,
  MEGA_SAVER_CG_BLOCK_START,
  MEGA_SAVER_CG_BLOCK_END,
  MEGA_SAVER_WS_BLOCK_START,
  MEGA_SAVER_WS_BLOCK_END,
] as const;

// Strip zero-width, bidi-control, and BOM characters before NFKC-normalising,
// so visually-identical sentinel lookalikes are rejected the same as exact matches.
const SENTINEL_INVISIBLE_CHARS = /[​-‏‪-‮⁠-⁤﻿]/g;

const normalizeForSentinelCheck = (value: string): string =>
  value.replace(SENTINEL_INVISIBLE_CHARS, "").normalize("NFKC");

export const containsSentinel = (value: string): boolean => {
  const normalized = normalizeForSentinelCheck(value);
  return ALL_SENTINELS.some((sentinel) => normalized.includes(sentinel));
};
```

`context.ts`: delete its private copies of the regex/normalize/contains trio and import `containsSentinel` from `./sentinel-guard.js`. Behavior note: the guard now also rejects CG/WS sentinel strings inside memory content — strictly wider rejection, which is the point. All existing context tests must stay green.

`warm-start-block.ts`:

```ts
// packages/connectors/shared/src/warm-start-block.ts
import { MEGA_SAVER_WS_BLOCK_END, MEGA_SAVER_WS_BLOCK_START } from "./constants.js";
import { ConnectorError } from "./errors.js";
import { containsSentinel } from "./sentinel-guard.js";

export type WarmStartBlockFields = { briefText: string; asOf: string };

export function renderWarmStartBlockText(fields: WarmStartBlockFields): string {
  if (containsSentinel(fields.briefText)) {
    throw new ConnectorError(
      "context_invalid",
      "Warm-start brief cannot contain Mega Saver sentinels.",
    );
  }
  return [
    MEGA_SAVER_WS_BLOCK_START,
    fields.briefText.trimEnd(),
    "",
    `As of: ${fields.asOf} — run "mega warmup --write" to refresh`,
    MEGA_SAVER_WS_BLOCK_END,
    "",
  ].join("\n");
}
```

`upsert.ts` — extend the input and add a third optional pass:

```ts
interface UpsertBlockInput {
  existingContent: string;
  context: ConnectorContext;
  // Pre-rendered WS block. undefined = leave any existing WS block untouched
  // (sync callers that don't manage warm start); "" = remove; text = upsert.
  warmStartBlock?: string;
}

const WS_SENTINELS: SentinelPair = {
  start: MEGA_SAVER_WS_BLOCK_START,
  end: MEGA_SAVER_WS_BLOCK_END,
};
```

and in `upsertBlock`, after the CG pass:

```ts
  const withWs =
    input.warmStartBlock === undefined
      ? result
      : applyOptionalBlock(result, input.warmStartBlock, WS_SENTINELS);

  return eol === "\r\n" ? withWs.replace(/\n/g, "\r\n") : withWs;
```

(rename the old `result` return accordingly; import the new constants). Export `renderWarmStartBlockText`, `containsSentinel`, `MEGA_SAVER_WS_BLOCK_START/END` from `index.ts`.

- [ ] **Step 10.4: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/connectors-shared test`
Expected: PASS — new file AND all pre-existing upsert/context/context-gate tests (the refactor must not change their behavior).

- [ ] **Step 10.5: Commit**

```bash
git add packages/connectors/shared/
git commit -m "feat(connectors-shared): warm-start sentinel block in upsert"
```

---

### Task 11: `mega warmup --write` + `connector sync` refresh

**Files:**
- Modify: `apps/cli/src/commands/warmup.ts` (replace the Task 6 `--write` stub)
- Modify: `apps/cli/src/commands/connector/sync.ts`
- Modify: `apps/cli/test/commands/warmup.test.ts` (append), `apps/cli/test/commands/` connector sync test file (read it first, follow style)

- [ ] **Step 11.1: Write the failing tests (append to warmup.test.ts)**

```ts
describe("--write", () => {
  it("prints the Pro upsell and exits 0 without a license", async () => {
    await seedProject("/work/demo");
    const code = await runWarmup(baseInput({ write: true }));
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("Pro feature");
  });

  it("writes the WS block into an existing AGENTS.md for --target codex (entitled)", async () => {
    // license fixture: follow the entitled-license setup used in
    // apps/cli/test/commands/savings-fix.test.ts (generateKeyPairSync ed25519
    // + written license.json + publicKey injected through input)
    const { project } = await seedProject(projectDir); // projectDir = mkdtemp
    writeFileSync(join(projectDir, "AGENTS.md"), "# hand-written\n");
    const code = await runWarmup(
      baseInput({ cwd: projectDir, write: true, writeTarget: "codex", publicKey: pub }),
    );
    expect(code).toBe(0);
    const content = readFileSync(join(projectDir, "AGENTS.md"), "utf8");
    expect(content).toContain("<!-- MEGA SAVER:WARM_START BEGIN -->");
    expect(content).toContain("# hand-written");
  });
});
```

(The entitled-license fixture requires `RunWarmupInput` to accept an optional `publicKey` exactly like `RunBrainExportInput` does — add it in this task.)

Connector-sync refresh test (append to the existing sync test file):

```ts
it("refreshes an existing WS block on sync, leaves files without one untouched", async () => {
  // seed a target file containing a stale WS block via upsertBlock + renderWarmStartBlockText
  // run runConnectorSync
  // assert: block still present, single sentinel pair, As of: timestamp updated
  // assert: a second target file with no WS block gains none
});
```

- [ ] **Step 11.2: Run tests to verify they fail**

Run: `pnpm --filter @megasaver/cli test -- commands/warmup`
Expected: FAIL — `--write` returns the Task 6 stub error

- [ ] **Step 11.3: Implement `--write` in `warmup.ts`**

Replace the stub with:

```ts
  if (input.write) {
    const ent = checkEntitlement("brain-portability", {
      storeRoot: input.storeRoot,
      now: input.now,
      ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
    });
    if (!ent.entitled) {
      input.stdout(WARMUP_WRITE_UPSELL);
      return 0;
    }
    return runWarmupWrite(input, registry, project, nowIso, reonboardUnlocked);
  }
```

with, in the same file:

```ts
export const WARMUP_WRITE_UPSELL =
  "Cross-agent warm start (--write) is a Mega Saver Pro feature. Activate a key: mega license activate <key>.";

async function runWarmupWrite(
  input: RunWarmupInput,
  registry: CoreRegistry,
  project: Project,
  nowIso: string,
  reonboardUnlocked: boolean,
): Promise<0 | 1> {
  const { renderWarmStartBlockText, upsertBlock, readTargetFile, writeTargetFile } = await import(
    "@megasaver/connectors-shared"
  );
  const { KNOWN_TARGETS } = await import("../known-targets.js");
  const { buildConnectorContext, pickLatestOpenSession } = await import("./connector/shared.js");

  const brief = assembleWarmStartBrief({
    projectName: project.name,
    branch: null,
    now: nowIso,
    lastSeenAt: null,
    reonboardUnlocked,
    timeless: true, // sentinel block carries only timeless sections (spec §4b)
    memories: registry.listMemoryEntries(project.id),
    rules: registry.listProjectRules(project.id),
    failedAttempts: registry.listFailedAttempts(project.id),
    gitDelta: null,
  });
  const block = renderWarmStartBlockText({ briefText: brief.text, asOf: nowIso });

  const targetFilter = input.writeTarget ?? "all";
  const targets = KNOWN_TARGETS.filter((t) => targetFilter === "all" || t.id === targetFilter);
  if (targets.length === 0) {
    input.stderr(`error: unknown target ${targetFilter}`);
    return 1;
  }
  const sessions = registry.listSessions(project.id);
  const memoryEntries = registry.listMemoryEntries(project.id);
  let anyFailed = false;
  for (const target of targets) {
    try {
      const absPath = join(project.rootPath, target.relativePath);
      const existing = await readTargetFile(absPath);
      if (existing === null && targetFilter === "all") {
        input.stdout(`${target.id}: skipped (no ${target.relativePath})`);
        continue; // 'all' never creates files; an explicit --target does
      }
      const context = buildConnectorContext(target, project, sessions, memoryEntries);
      const next = upsertBlock({
        existingContent: existing ?? ("header" in target ? (target.header ?? "") : ""),
        context,
        warmStartBlock: block,
      });
      await writeTargetFile({ absPath, content: next });
      input.stdout(`${target.id}: wrote warm-start block (${brief.tokenEstimate} tokens)`);
    } catch (err) {
      anyFailed = true;
      input.stderr(`${target.id}: error — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return anyFailed ? 1 : 0;
}
```

Add `publicKey?: KeyObject | string;` to `RunWarmupInput` (import `type KeyObject` from `node:crypto`). Also add the missing imports (`join` from `node:path`, `type CoreRegistry` from `@megasaver/core`).

- [ ] **Step 11.4: Implement sync refresh in `sync.ts`**

Inside the target loop, before building `newContent` on the update path (where `existing !== null`):

```ts
        // Refresh an existing warm-start block on sync; never seed one here —
        // creation is Pro-gated behind `mega warmup --write` (spec §4b). The
        // refresh itself is maintenance of already-written Pro output.
        let warmStartBlock: string | undefined;
        if (existing !== null && existing.includes(MEGA_SAVER_WS_BLOCK_START)) {
          const brief = assembleWarmStartBrief({
            projectName: project.name,
            branch: null,
            now: new Date().toISOString(),
            lastSeenAt: null,
            reonboardUnlocked: false,
            timeless: true,
            memories: memoryEntries,
            rules: registry.listProjectRules(project.id),
            failedAttempts: registry.listFailedAttempts(project.id),
            gitDelta: null,
          });
          warmStartBlock = renderWarmStartBlockText({
            briefText: brief.text,
            asOf: new Date().toISOString(),
          });
        }
        const newContent = upsertBlock({
          existingContent: existing,
          context,
          ...(warmStartBlock !== undefined ? { warmStartBlock } : {}),
        });
```

(imports: `assembleWarmStartBrief` from `@megasaver/core`; `MEGA_SAVER_WS_BLOCK_START`, `renderWarmStartBlockText` from `@megasaver/connectors-shared`. The seed path — `existing === null` — passes no `warmStartBlock`.)

- [ ] **Step 11.5: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/cli test -- commands/warmup connector`
Expected: PASS, existing sync tests green (undefined `warmStartBlock` = untouched behavior)

- [ ] **Step 11.6: Commit**

```bash
git add apps/cli/src/commands/warmup.ts apps/cli/src/commands/connector/sync.ts apps/cli/test/
git commit -m "feat(cli): warmup --write cross-agent block + sync refresh"
```

---

### Task 12: MCP `get_warm_start_brief`

**Files:**
- Create: `packages/mcp-bridge/src/tools/get-warm-start-brief.ts`
- Create: `packages/mcp-bridge/test/get-warm-start-brief.test.ts`
- Modify: `packages/mcp-bridge/src/server.ts` (TOOL_DEFS entry + dispatch case + McpToolName union if it is a literal union)

- [ ] **Step 12.1: Write the failing test**

```ts
// packages/mcp-bridge/test/get-warm-start-brief.test.ts
import { describe, expect, it } from "vitest";
import { handleGetWarmStartBrief } from "../src/tools/get-warm-start-brief.js";

// Follow the registry fixture pattern used by the existing search-memory tool
// test in this package (in-memory or temp-dir registry — read that test first).
describe("get_warm_start_brief", () => {
  it("returns a WarmStartBrief for a project", async () => {
    const env = buildEnvWithProject(); // this package's existing fixture helper
    const result = await handleGetWarmStartBrief(env, { projectId: env.projectId });
    expect(result.brief.text).toContain("Warm Start");
    expect(result.brief.tokenEstimate).toBeGreaterThanOrEqual(0);
  });

  it("rejects bad args with validation_failed", async () => {
    const env = buildEnvWithProject();
    await expect(handleGetWarmStartBrief(env, { projectId: 42 })).rejects.toMatchObject({
      code: "validation_failed",
    });
  });
});
```

- [ ] **Step 12.2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/mcp-bridge test -- get-warm-start-brief`
Expected: FAIL — module not found

- [ ] **Step 12.3: Implement (mirror `tools/search-memory.ts` shape exactly)**

```ts
// packages/mcp-bridge/src/tools/get-warm-start-brief.ts
import {
  type CoreRegistry,
  CoreRegistryError,
  type WarmStartBrief,
  assembleWarmStartBrief,
  readWarmStartState,
} from "@megasaver/core";
import type { ProjectId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type GetWarmStartBriefEnv = {
  registry: CoreRegistry;
  storeRoot: string;
  now: () => string;
};

const inputSchema = z
  .object({
    projectId: z.string().min(1),
    budgetTokens: z.number().int().min(300).max(8000).optional(),
  })
  .strict();

export type GetWarmStartBriefResult = { brief: WarmStartBrief };

// Polling agents get the same assembler as the hook, minus git delta (an MCP
// server has no reliable cwd) and minus Pro reonboard (no entitlement dep in
// mcp-bridge) — the brief itself is the free tier anyway (spec §6).
export async function handleGetWarmStartBrief(
  env: GetWarmStartBriefEnv,
  rawArgs: unknown,
): Promise<GetWarmStartBriefResult> {
  const parsed = inputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const projectId = parsed.data.projectId as ProjectId;
  try {
    const project = env.registry.getProject(projectId);
    if (project === null) {
      throw new McpBridgeError("resource_not_found", `project not found: ${projectId}`);
    }
    const nowIso = env.now();
    const brief = assembleWarmStartBrief({
      projectName: project.name,
      branch: null,
      now: nowIso,
      ...(parsed.data.budgetTokens !== undefined
        ? { budgetTokens: parsed.data.budgetTokens }
        : {}),
      lastSeenAt: readWarmStartState(env.storeRoot, projectId)?.lastSeenAt ?? null,
      reonboardUnlocked: false,
      timeless: false,
      memories: env.registry.listMemoryEntries(projectId),
      rules: env.registry.listProjectRules(projectId),
      failedAttempts: env.registry.listFailedAttempts(projectId),
      gitDelta: null,
    });
    return { brief };
  } catch (err) {
    if (err instanceof CoreRegistryError && err.code === "project_not_found") {
      throw new McpBridgeError("resource_not_found", err.message);
    }
    throw err;
  }
}
```

`server.ts`: add `{ id: "get_warm_start_brief", description: "Assemble the budgeted warm-start session brief for a project." }` to `TOOL_DEFS`, add `"get_warm_start_brief"` to the `McpToolName` union (wherever the union lives — grep for `"search_memory"`), and a dispatch case following the `search_memory` case's env-construction pattern (registry comes from the same deps; `storeRoot` = the root the server already resolves for its registry — grep `rootDir`/`storeRoot` in `server.ts`; `now: () => new Date().toISOString()` matches the server's existing `now` dep).

- [ ] **Step 12.4: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/mcp-bridge test`
Expected: PASS (including any tool-count snapshot test — update the expected tool count if one exists)

- [ ] **Step 12.5: Commit**

```bash
git add packages/mcp-bridge/
git commit -m "feat(mcp-bridge): get_warm_start_brief tool"
```

---

### Task 13: Integration — real hook round-trip + fixture git repo

**Files:**
- Create: `apps/cli/test/hooks/warmup-integration.test.ts`

- [ ] **Step 13.1: Write the integration test**

```ts
// apps/cli/test/hooks/warmup-integration.test.ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gatherGitDelta } from "../../src/git-delta.js";
import { buildWarmupHookOutput } from "../../src/hooks/warmup-run.js";
import { ensureStoreReady } from "../../src/store.js";

let root: string;
let repo: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-warmint-store-"));
  repo = mkdtempSync(join(tmpdir(), "megasaver-warmint-repo-"));
  execFileSync("git", ["init"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "init"], { cwd: repo, stdio: "ignore" });
  writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
  execFileSync("git", ["add", "."], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "add a"], { cwd: repo, stdio: "ignore" });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

describe("hook round-trip on a real repo", () => {
  it("default-branch fallback yields non-empty changedFiles", () => {
    const delta = gatherGitDelta(repo, "2020-01-01T00:00:00.000Z");
    expect(delta).not.toBeNull();
    expect(delta?.changedFiles.some((f) => f.path === "a.ts")).toBe(true);
  });

  it("SessionStart payload → brief with git section, second call within 4h → micro", async () => {
    const { registry } = await ensureStoreReady(root);
    registry.createProject({
      id: "11111111-1111-4111-8111-111111111111",
      name: "demo",
      rootPath: repo,
      createdAt: "2026-07-12T09:00:00.000Z",
    } as never);
    const payload = { session_id: "s1", cwd: repo, source: "startup" };
    const first = await buildWarmupHookOutput({
      payload,
      storeRoot: root,
      now: () => Date.now(),
      gatherDelta: (cwd, seen) => gatherGitDelta(cwd, seen),
    });
    expect(first).toContain("Warm Start — demo");
    const second = await buildWarmupHookOutput({
      payload,
      storeRoot: root,
      now: () => Date.now(),
      gatherDelta: (cwd, seen) => gatherGitDelta(cwd, seen),
    });
    // stamped by the first call -> gap < 4h -> micro (short brief, no git section)
    expect(second).not.toContain("Since your last visit");
  });
});
```

- [ ] **Step 13.2: Run, expect green (or fix)**

Run: `pnpm --filter @megasaver/cli test -- warmup-integration`
Expected: PASS. Any failure here is a real integration bug — debug with superpowers:systematic-debugging, do not weaken the test.

- [ ] **Step 13.3: Commit**

```bash
git add apps/cli/test/hooks/warmup-integration.test.ts
git commit -m "test(cli): warm-start hook round-trip on a real git repo"
```

---

### Task 14: Changeset, verify, smoke evidence, wiki, gauntlet

**Files:**
- Create: `.changeset/warm-start.md`
- Modify: `wiki/entities/cli.md` (command surface), `wiki/log.md` (entry), `wiki/syntheses/memory-moat-portfolio.md` (mark i8 shipped→in-review)

- [ ] **Step 14.1: Changeset**

```md
---
"@megasaver/core": minor
"@megasaver/stats": minor
"@megasaver/connectors-shared": minor
"@megasaver/connector-claude-code": minor
"@megasaver/mcp-bridge": minor
"@megasaver/cli": minor
---

Warm Start: budgeted session boot brief for every agent. A pure assembler
(`assembleWarmStartBrief`) renders standing rules, decisions, open todos,
branch-touching failed attempts, git delta, and hot-spot entities into a
hard-budgeted markdown brief (default 2000 tokens; micro <4h = 300; reonboard
>14d shows what changed while you were away). Delivered via a fail-open
Claude Code SessionStart hook (`mega hooks warmup`, installed by
`mega hooks install`, opt-out `--no-warmup`), `mega warmup` on stdout, a
Pro-gated cross-agent sentinel block (`mega warmup --write`, refreshed by
`mega connector sync`), and an MCP `get_warm_start_brief` tool. Reporting is
measured-only: a separate `WarmStartEvent` (never a TokenSaverEvent) feeds a
"Warm start: N sessions warmed" line in savings history/insights.
```

- [ ] **Step 14.2: Full verify**

Run: `pnpm verify`
Expected: lint + typecheck + all tests green. Fix anything red before proceeding (systematic-debugging on failures).

- [ ] **Step 14.3: Smoke evidence (DoD item 5)**

```bash
# 1. real Claude Code injection: install hooks into a throwaway settings file
node apps/cli/dist/main.mjs hooks install claude-code --settings /tmp/ws-smoke-settings.json
cat /tmp/ws-smoke-settings.json   # capture: SessionStart entry present
# 2. seed a project + memory in a temp store, run the hook entrypoint with a
#    synthetic SessionStart payload, capture stdout brief
echo '{"session_id":"s1","cwd":"'$PWD'","source":"startup"}' | node apps/cli/dist/main.mjs --store /tmp/ws-smoke-store hooks warmup
# 3. cross-agent block
node apps/cli/dist/main.mjs warmup --write --target codex --store /tmp/ws-smoke-store
head -30 AGENTS.md   # capture: WARM_START sentinel block
```

Capture all three outputs into the PR description. For step 2/3 to produce a non-trivial brief, first `mega init` + `mega memory create` a decision in the smoke store (exact flags: see `mega memory create --help`).

- [ ] **Step 14.4: Wiki updates**

- `wiki/entities/cli.md`: add `mega warmup` + `mega hooks warmup` to the command surface line.
- `wiki/syntheses/memory-moat-portfolio.md`: i8 status → "implemented (feat/warm-start), pending review gauntlet".
- `wiki/log.md`: timestamped entry (branch, task count, verify result).

- [ ] **Step 14.5: Commit + HIGH-risk gauntlet**

```bash
git add .changeset/warm-start.md wiki/
git commit -m "chore(release): warm-start changeset + wiki"
```

Then per spec Process section: dispatch `code-reviewer` AND `critic` agents (fresh contexts, author ≠ reviewer) on the full branch diff; fix findings RED-first; `superpowers:verification-before-completion` before any "done" claim; then `superpowers:finishing-a-development-branch` (PR against main).

---

## Self-review notes (already applied)

- Spec §3 freshness (BLOCKER fix) → Tasks 1, 6, 7 (stamp on both surfaces). Spec §5 honest stats (BLOCKER fix) → Task 5 (own schema) + Task 9 (explicit readers). Spec §1 `!stale` (S3) → Task 2 filter + test. Spec §3 rules-createdAt (S4) → Task 2 `absenceSection`. Spec §7 git fallbacks (S5) → Task 4 + Task 13 integration proof. Spec §6 free-reonboard (S6) → Task 3 test. Spec §4a matcher-less SessionStart (N8) → Task 8. Spec §4b third-block wiring (N9) → Task 10-11. Budget-on-final-text (N10) → Task 2 algorithm + invariant test. Entity digest without memory-graph dep (N7 resolved harder: no new dep at all) → Task 2.
- Deviation from spec §1: `WarmStartInput` has no `graph` field — entity digest computed from `relatedFiles`/`relatedSymbols` inside the assembler (same signal the graph's `entity-mention` edges encode, zero new dep edges). Update the spec's input type in place when the branch lands if the reviewer agrees.
- Two `as never` casts in test fixtures (Tasks 6, 7, 13) are explicit read-the-real-schema checkpoints, flagged inline — resolve them against `packages/core/src/project.ts` when writing the tests.
