# Brain Autopilot (i14) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The brain grows itself safely — `runAutopilot` distills session failures into memory candidates, auto-approves the allowlisted cross-session-recurring slice under a hard cap with full provenance, and `mega brain digest` drains the whole suggested backlog with single-keystroke y/n/e/s/u/a/q triage.

**Architecture:** Zero MemoryEntry schema change — the digest queue IS `approval === "suggested"`. New core `autopilot.ts` (pure `scoreCandidate` + `runAutopilot` engine reusing `extractSessionMemories` verbatim) + `autopilot-store.ts` (policy/digest-state JSON, guard-state atomic pattern, fail-closed). CLI: `mega brain autopilot status|on|off|run` + `mega brain digest` (raw-mode keystroke loop isolated in `digest-loop.ts` with injected input stream; approve/reject route through the extracted `applyApprovalFlip` core of the existing approve op). The M2 dampener is load-bearing: within-session repetition NEVER auto-approves; only cross-session recurrence (`priorSessionHit`) scores high. Spec: `docs/superpowers/specs/2026-07-14-brain-autopilot-design.md` (rev 2, architect pass applied).

**Tech Stack:** TypeScript strict ESM, Zod, Vitest, citty CLI, pnpm/Turborepo. No LLM, no network — deterministic rule table.

**Worktree:** `/Users/halitozger/Desktop/MegaSaver/.claude/worktrees/brain-autopilot` (branch `feat/brain-autopilot` from origin/main @ eb74c352). Risk HIGH (§12 — machine writes approved rows) — full gauntlet at the end (Task 11).

**Task map:** 1-5 core (Section A) · 6-8 plumbing + autopilot CLI (Section B) · 9-10 digest (Section C) · 11 release/evidence/gauntlet.

**Binding facts discovered at extraction (authors already honor these):**
- The extractor emits candidate types `bug`/`test_behavior`/`decision` — never `failed_attempt` (architect B1).
- `listMemoryEntries(projectId)` is per-project (no store-wide enumeration); pending counts and digest queues are project-scoped.
- The MCP from-session path does NOT capture anchors (CLI path does); autopilot mirrors the CLI path.
- Unentitled PRO surfaces print the upsell to stdout and exit 0 (export.ts precedent).
- `truncate`/`padExplain` in memory/shared.ts are module-private — digest reuses the exported `formatMemoryListLine` or exports what it needs.
- `runMemoryApprove` resolves the store per call — Task 10 extracts `applyApprovalFlip(registry, existing, approval, updatedAt)` and rewires runMemoryApprove byte-identically (regression suites pinned in-plan).

---
# Section A — Core: dedupe-prefix promotion, occurrences, autopilot stores, scoring, engine (Tasks 1–5)

All commands run from the worktree root:
`/Users/halitozger/Desktop/MegaSaver/.claude/worktrees/brain-autopilot`
(branch `feat/brain-autopilot`).

**Environment hazards (apply to every task below):**

- Mega Saver MCP read-proxy SILENTLY TRUNCATES and can REORDER file reads over
  ~4000 bytes (banners "[Mega Saver: compressed ...]" / "… [N paragraphs]").
  Locate with `grep -n`, read with `sed -n 'A,Bp'` in chunks of <=40 lines.
  Re-read a smaller range whenever a banner appears. Never trust an elided read.
- `pnpm build` BEFORE running `@megasaver/cli` or `@megasaver/mcp-bridge` tests
  — workspace deps resolve `@megasaver/core` via `dist/`. Core's own tests
  import `../src/*.js` directly and need no build.
- `pnpm --filter <pkg> test -- <pattern>` does NOT narrow. Narrow with
  `pnpm --filter <pkg> exec vitest run <path-or-substring>`; run the whole
  package suite before each commit.
- Full `pnpm lint:fix && pnpm typecheck` before EVERY commit — package vitest
  does not catch TS4111 (`noPropertyAccessFromIndexSignature`). If TS4111
  fires, use bracket access plus
  `// biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)`.
- tsconfig is `strict` with `exactOptionalPropertyTypes` — never assign an
  explicit `undefined` to an optional property; use conditional spreads
  (`...(x !== undefined ? { x } : {})`), exactly as the code below does.
- Branded IDs: raw UUID string literals in tests need `as ProjectId` /
  `as SessionId` / `as MemoryEntryId` casts (types from `@megasaver/shared`).
- Core tests live in `packages/core/test/`; CLI tests in `apps/cli/test/`.
- Zod schemas are `.strict()` like their siblings; ESM imports carry `.js`
  suffixes (NodeNext).

---

### Task 1: Promote `DEDUPE_KEYWORD_PREFIX` + `dedupeKeywordFor` to core; rewire both consumers

The `"from-session:"` keyword prefix is the cross-writer idempotence ledger
(spec §11 risk 5, architect m6). Today it is a local const duplicated in
`apps/cli/src/commands/memory/from-session.ts:32` AND
`packages/mcp-bridge/src/tools/from-session-memory.ts:27`; autopilot would be
a third copy. Promote it to `packages/core/src/session-memory.ts` (beside
`extractSessionMemories`) together with the composer `dedupeKeywordFor`, and
rewire both existing call sites to import it. Behavior byte-identical;
existing CLI and mcp-bridge from-session tests stay green unchanged.

**Files:**

- Modify: `packages/core/src/session-memory.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `apps/cli/src/commands/memory/from-session.ts`
- Modify: `packages/mcp-bridge/src/tools/from-session-memory.ts`
- Test (modify): `packages/core/test/session-memory.test.ts`

**Steps:**

- [ ] **Step 1: Confirm the worktree.**
  `cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/brain-autopilot && git branch --show-current`
  must print `feat/brain-autopilot`. If not, stop and report — this section
  builds only on that branch.

- [ ] **Step 2: Confirm the two duplicated consts (chunked reads, no proxy).**

```bash
grep -rn 'const DEDUPE_KEYWORD_PREFIX' apps packages
```

  Expect exactly two hits: `apps/cli/src/commands/memory/from-session.ts:32`
  and `packages/mcp-bridge/src/tools/from-session-memory.ts:27`, both
  `= "from-session:"`. Also
  `grep -n 'export function extractSessionMemories' packages/core/src/session-memory.ts`
  (~line 112) — the new exports go right above it. If the shapes drifted,
  report instead of guessing.

- [ ] **Step 3: Write the failing test.** In
  `packages/core/test/session-memory.test.ts`, replace the session-memory
  import line

```ts
import { extractSessionMemories } from "../src/session-memory.js";
```

  with

```ts
import {
  DEDUPE_KEYWORD_PREFIX,
  dedupeKeywordFor,
  extractSessionMemories,
} from "../src/session-memory.js";
```

  and append at the very end of the file (after the closing `});` of the
  existing `describe`):

```ts
describe("dedupe keyword ledger (shared export)", () => {
  it("exports the from-session prefix and composer", () => {
    expect(DEDUPE_KEYWORD_PREFIX).toBe("from-session:");
    expect(dedupeKeywordFor("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:0123456789abcdef")).toBe(
      "from-session:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:0123456789abcdef",
    );
  });
});
```

- [ ] **Step 4: Run to verify FAIL.**

```bash
pnpm --filter @megasaver/core exec vitest run session-memory
```

  Expected failure: a missing-export error —
  `SyntaxError: The requested module '../src/session-memory.js' does not provide an export named 'DEDUPE_KEYWORD_PREFIX'`
  (whole file errors, all tests red).

- [ ] **Step 5: Minimal implementation — core export.** In
  `packages/core/src/session-memory.ts`, insert immediately ABOVE the
  `// Pure: no I/O, no clock, no model.` comment that precedes
  `export function extractSessionMemories`:

```ts
// Idempotence ledger: every memory staged from an extracted candidate carries
// `from-session:<dedupeKey>` as a keyword, so ANY writer (CLI from-session,
// MCP from_session_memory, autopilot) can skip candidates already captured by
// any other. Promoted from duplicated local consts (architect m6) — three
// copies would drift.
export const DEDUPE_KEYWORD_PREFIX = "from-session:";

export function dedupeKeywordFor(dedupeKey: string): string {
  return `${DEDUPE_KEYWORD_PREFIX}${dedupeKey}`;
}
```

- [ ] **Step 6: Export from the core index.** In
  `packages/core/src/index.ts`, replace the session-memory block (~lines
  85–89)

```ts
export {
  type ExtractedCandidate,
  type ExtractSessionMemoriesInput,
  extractSessionMemories,
} from "./session-memory.js";
```

  with

```ts
export {
  DEDUPE_KEYWORD_PREFIX,
  dedupeKeywordFor,
  type ExtractedCandidate,
  type ExtractSessionMemoriesInput,
  extractSessionMemories,
} from "./session-memory.js";
```

- [ ] **Step 7: Rewire the CLI consumer.** In
  `apps/cli/src/commands/memory/from-session.ts`:
  (a) replace the `@megasaver/core` import block (lines 2–8)

```ts
import {
  type MemoryEntry,
  captureCodeAnchor,
  extractSessionMemories,
  memoryEntrySchema,
  saveMemoryWithLineage,
} from "@megasaver/core";
```

  with

```ts
import {
  DEDUPE_KEYWORD_PREFIX,
  type MemoryEntry,
  captureCodeAnchor,
  extractSessionMemories,
  memoryEntrySchema,
  saveMemoryWithLineage,
} from "@megasaver/core";
```

  (b) delete the local comment + const (lines 29–32):

```ts
// Idempotence: each staged memory carries its candidate's dedupeKey as a
// keyword so a re-run can skip already-staged candidates (lossless, never
// deletes). Keywords are already a normalized, searchable surface.
const DEDUPE_KEYWORD_PREFIX = "from-session:";
```

  Both usages (the `.filter((k) => k.startsWith(DEDUPE_KEYWORD_PREFIX))` and
  the `` `${DEDUPE_KEYWORD_PREFIX}${candidate.dedupeKey}` `` template) stay
  untouched — they now resolve to the imported const.

- [ ] **Step 8: Rewire the MCP consumer.** In
  `packages/mcp-bridge/src/tools/from-session-memory.ts`:
  (a) replace the `@megasaver/core` import block (lines 1–8)

```ts
import {
  type CoreRegistry,
  CoreRegistryError,
  type MemoryEntry,
  extractSessionMemories,
  memoryEntrySchema,
  saveMemoryWithLineage,
} from "@megasaver/core";
```

  with

```ts
import {
  type CoreRegistry,
  CoreRegistryError,
  DEDUPE_KEYWORD_PREFIX,
  type MemoryEntry,
  extractSessionMemories,
  memoryEntrySchema,
  saveMemoryWithLineage,
} from "@megasaver/core";
```

  (b) delete the local comment + const (lines 25–27):

```ts
// Idempotence: each staged memory carries its candidate's dedupeKey as a keyword
// so a re-run skips already-staged candidates (lossless; never deletes).
const DEDUPE_KEYWORD_PREFIX = "from-session:";
```

  Usages at lines 58–63 and 67–72 stay untouched.

- [ ] **Step 9: Run to verify PASS (all three packages).**

```bash
pnpm --filter @megasaver/core exec vitest run session-memory
pnpm build
pnpm --filter @megasaver/cli exec vitest run memory-from-session
pnpm --filter @megasaver/mcp-bridge exec vitest run from-session-memory
```

  All green — the CLI and mcp-bridge behavioral tests pin byte-identical
  behavior. Then confirm the promotion left a single definition:

```bash
grep -rn 'DEDUPE_KEYWORD_PREFIX = ' apps packages
```

  Exactly one hit: `packages/core/src/session-memory.ts` (the export).

- [ ] **Step 10: Full package suites.**

```bash
pnpm --filter @megasaver/core test
pnpm --filter @megasaver/cli test
pnpm --filter @megasaver/mcp-bridge test
```

- [ ] **Step 11: Gates.** `pnpm lint:fix && pnpm typecheck` — both clean
  (TS4111 only surfaces here; lint:fix also settles import member ordering).

- [ ] **Step 12: Commit.**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/brain-autopilot && \
git add packages/core/src/session-memory.ts packages/core/src/index.ts \
  apps/cli/src/commands/memory/from-session.ts \
  packages/mcp-bridge/src/tools/from-session-memory.ts \
  packages/core/test/session-memory.test.ts && \
git commit -m "refactor(core): export from-session dedupe prefix"
```

---

### Task 2: `ExtractedCandidate.occurrences` — within-session collapse count

The extractor collapses identical failures by `contentHash`, losing the
repeat count (spec §4.3). Add `occurrences: number` (>=1) to
`ExtractedCandidate` and make the collapse loop count duplicates into the
surviving candidate. It is a DISPLAY signal only (digest renders
"seen N× this session") — NEVER a scoring input (architect M2; Task 4 pins
that). Not a Zod schema; existing consumers (`from-session`, MCP tool) build
entries field-by-field and ignore the extra field. All existing
session-memory tests stay green.

**Files:**

- Modify: `packages/core/src/session-memory.ts`
- Test (modify): `packages/core/test/session-memory.test.ts`

**Steps:**

- [ ] **Step 1: Write the failing test.** In
  `packages/core/test/session-memory.test.ts`, add inside the existing
  `describe("extractSessionMemories", ...)` block, immediately after the
  `it("collapses identical failures within the session to one candidate", ...)`
  test (locate with
  `grep -n 'collapses identical failures' packages/core/test/session-memory.test.ts`):

```ts
  it("counts collapsed duplicates in occurrences", () => {
    const out = extractSessionMemories({
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      failedAttempts: [
        fa(A, { failedStep: "run auth tests", errorOutput: "boom 401" }),
        fa(B, { failedStep: "run auth tests", errorOutput: "boom 401" }),
        fa(C, { failedStep: "run auth tests", errorOutput: "boom 401" }),
      ],
    });

    expect(out).toHaveLength(1);
    expect(out[0]?.occurrences).toBe(3);
  });

  it("a non-duplicated candidate has occurrences 1", () => {
    const out = extractSessionMemories({
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      failedAttempts: [fa(A, { failedStep: "run lint", errorOutput: "no-unused-vars" })],
    });

    expect(out[0]?.occurrences).toBe(1);
  });
```

- [ ] **Step 2: Run to verify FAIL.**

```bash
pnpm --filter @megasaver/core exec vitest run session-memory
```

  Expected: `counts collapsed duplicates in occurrences` fails with
  `expected undefined to be 3` (the field does not exist yet); the
  `occurrences 1` test fails with `expected undefined to be 1`.

- [ ] **Step 3: Minimal implementation.** Three edits in
  `packages/core/src/session-memory.ts`:

  (a) In the `ExtractedCandidate` type, add after the `dedupeKey` member
  (keep the existing comment above `dedupeKey` intact):

```ts
  // Within-session collapse count: how many source failures produced this
  // candidate. Display + storm diagnostics only — NEVER a scoring input
  // (architect M2: single-session retry storms must not look important).
  occurrences: number;
```

  (b) In the `candidate()` factory, add `occurrences: 1,` after
  `approval: "suggested",` (before the `...fields` spread):

```ts
  return {
    scope: "session",
    confidence: "low",
    approval: "suggested",
    occurrences: 1,
    ...fields,
    contentHash,
    dedupeKey: `${failureId}:${contentHash}`,
  };
```

  (c) In `extractSessionMemories`, replace the collapse loop head

```ts
  const out: ExtractedCandidate[] = [];
  const seen = new Set<string>();
  const push = (c: ExtractedCandidate | undefined): void => {
    if (c === undefined || seen.has(c.contentHash)) return;
    seen.add(c.contentHash);
    out.push(c);
  };
```

  with

```ts
  const out: ExtractedCandidate[] = [];
  const seen = new Map<string, ExtractedCandidate>();
  const push = (c: ExtractedCandidate | undefined): void => {
    if (c === undefined) return;
    const survivor = seen.get(c.contentHash);
    if (survivor !== undefined) {
      survivor.occurrences += 1;
      return;
    }
    seen.set(c.contentHash, c);
    out.push(c);
  };
```

- [ ] **Step 4: Run to verify PASS — including every pre-existing test.**

```bash
pnpm --filter @megasaver/core test
```

  The whole core suite green: the collapse-to-one, decision-marker, and
  recallability tests must pass unchanged (spec §4.3 "existing tests must
  stay green").

- [ ] **Step 5: Gates.** `pnpm lint:fix && pnpm typecheck` — both clean.

- [ ] **Step 6: Commit.**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/brain-autopilot && \
git add packages/core/src/session-memory.ts packages/core/test/session-memory.test.ts && \
git commit -m "feat(core): count collapsed candidate occurrences"
```

---

### Task 3: `autopilot-store.ts` — policy + digest-state stores (fail-closed, atomic)

Two store-root JSON files (spec §4.1/§4.2): `<storeRoot>/autopilot.json`
(policy) and `<storeRoot>/digest-state.json`. Same atomic pattern as
`guard-state.ts` (mkdir recursive + `.{uuid}.tmp` write + rename, swallow-all
write catch, no fsync, last-writer-wins) but STORE-ROOT scoped — no
per-project subdirectory or per-project files. Reads are FAIL-CLOSED:
missing/corrupt policy => `DEFAULT_AUTOPILOT_POLICY` (disabled — a corrupt
file can never enable auto-approval); missing/corrupt digest state =>
`{ lastDigestAt: null }`.

**Files:**

- Create: `packages/core/src/autopilot-store.ts`
- Modify: `packages/core/src/index.ts`
- Create (test): `packages/core/test/autopilot-store.test.ts`

**Steps:**

- [ ] **Step 1: Confirm the sibling pattern (chunked reads).**
  `sed -n '1,40p' packages/core/src/guard-state.ts` and
  `sed -n '41,81p' packages/core/src/guard-state.ts` — confirm the
  read (`JSON.parse(readFileSync(...))` + `safeParse`, null on any failure)
  and write (mkdir + tmp + rename inside swallow-all try/catch) shapes.
  Also `grep -n 'from "./guard-match.js";' packages/core/src/index.ts` —
  the LAST export block ends at line 167; the new block appends after it.

- [ ] **Step 2: Write the failing test.** Create
  `packages/core/test/autopilot-store.test.ts` with exactly:

```ts
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_AUTOPILOT_POLICY,
  readAutopilotPolicy,
  readDigestState,
  writeAutopilotPolicy,
  writeDigestState,
} from "../src/autopilot-store.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-autopilot-store-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("autopilot policy store", () => {
  it("defaults to disabled when no file exists (fail-closed)", () => {
    expect(readAutopilotPolicy(root)).toEqual({
      enabled: false,
      autoApproveTypes: ["bug", "test_behavior"],
      autoApproveMinConfidence: "high",
      maxAutoApprovesPerSession: 10,
    });
  });

  it("round-trips a written policy", () => {
    const policy = {
      ...DEFAULT_AUTOPILOT_POLICY,
      enabled: true,
      maxAutoApprovesPerSession: 3,
    };
    writeAutopilotPolicy(root, policy);
    expect(readAutopilotPolicy(root)).toEqual(policy);
  });

  it("falls back to the disabled default on a corrupt or partial file", () => {
    writeAutopilotPolicy(root, { ...DEFAULT_AUTOPILOT_POLICY, enabled: true });
    writeFileSync(join(root, "autopilot.json"), "{not json");
    expect(readAutopilotPolicy(root).enabled).toBe(false);
    // Partial-but-valid JSON must fail the strict schema, not half-apply.
    writeFileSync(join(root, "autopilot.json"), JSON.stringify({ enabled: true }));
    expect(readAutopilotPolicy(root).enabled).toBe(false);
  });

  it("leaves no tmp files behind (atomic rename)", () => {
    writeAutopilotPolicy(root, DEFAULT_AUTOPILOT_POLICY);
    expect(readdirSync(root).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(readdirSync(root)).toContain("autopilot.json");
  });
});

describe("digest state store", () => {
  it("defaults to null lastDigestAt when missing or corrupt", () => {
    expect(readDigestState(root)).toEqual({ lastDigestAt: null });
    writeFileSync(join(root, "digest-state.json"), "nope");
    expect(readDigestState(root)).toEqual({ lastDigestAt: null });
  });

  it("round-trips a written state", () => {
    writeDigestState(root, { lastDigestAt: "2026-07-15T12:00:00.000Z" });
    expect(readDigestState(root)).toEqual({ lastDigestAt: "2026-07-15T12:00:00.000Z" });
  });

  it("creates the store root on write when missing", () => {
    const nested = join(root, "does", "not", "exist");
    writeDigestState(nested, { lastDigestAt: null });
    expect(readDigestState(nested)).toEqual({ lastDigestAt: null });
  });
});
```

- [ ] **Step 3: Run to verify FAIL.**

```bash
pnpm --filter @megasaver/core exec vitest run autopilot-store
```

  Expected: the file fails to load —
  `Error: Failed to resolve import "../src/autopilot-store.js"`
  (module does not exist yet).

- [ ] **Step 4: Minimal implementation.** Create
  `packages/core/src/autopilot-store.ts` with exactly:

```ts
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { memoryTypeSchema } from "./memory-entry.js";

// Store-root policy + digest state for Brain Autopilot (spec §4.1/§4.2).
// Pattern cloned from guard-state.ts: tmp+rename write, no fsync, concurrent
// writers last-writer-wins. One difference: reads FAIL CLOSED to a default
// instead of null — a missing or corrupt policy can never enable
// auto-approval, and a corrupt digest state only widens the "since" header.
export const autopilotPolicySchema = z
  .object({
    enabled: z.boolean(),
    autoApproveTypes: z.array(memoryTypeSchema),
    autoApproveMinConfidence: z.literal("high"),
    maxAutoApprovesPerSession: z.number().int().positive(),
  })
  .strict();

export type AutopilotPolicy = z.infer<typeof autopilotPolicySchema>;

// `decision` is deliberately NOT defaulted — human-stated decisions deserve
// human approval. bug/test_behavior are the only types the extractor emits
// from failures (architect B1: failed_attempt is the SOURCE row kind, never
// a candidate type).
export const DEFAULT_AUTOPILOT_POLICY: AutopilotPolicy = {
  enabled: false,
  autoApproveTypes: ["bug", "test_behavior"],
  autoApproveMinConfidence: "high",
  maxAutoApprovesPerSession: 10,
};

export const digestStateSchema = z
  .object({
    lastDigestAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export type DigestState = z.infer<typeof digestStateSchema>;

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function writeJsonAtomic(storeRoot: string, fileName: string, data: unknown): void {
  try {
    mkdirSync(storeRoot, { recursive: true });
    const tmp = join(storeRoot, `.${randomUUID()}.tmp`);
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, join(storeRoot, fileName));
  } catch {
    // best-effort like guard-state: a lost write fails closed (autopilot
    // stays disabled / digest header falls back to null) — corruption is
    // what tmp+rename prevents.
  }
}

export function readAutopilotPolicy(storeRoot: string): AutopilotPolicy {
  const parsed = autopilotPolicySchema.safeParse(readJsonFile(join(storeRoot, "autopilot.json")));
  return parsed.success ? parsed.data : DEFAULT_AUTOPILOT_POLICY;
}

export function writeAutopilotPolicy(storeRoot: string, policy: AutopilotPolicy): void {
  writeJsonAtomic(storeRoot, "autopilot.json", policy);
}

export function readDigestState(storeRoot: string): DigestState {
  const parsed = digestStateSchema.safeParse(readJsonFile(join(storeRoot, "digest-state.json")));
  return parsed.success ? parsed.data : { lastDigestAt: null };
}

export function writeDigestState(storeRoot: string, state: DigestState): void {
  writeJsonAtomic(storeRoot, "digest-state.json", state);
}
```

- [ ] **Step 5: Export from the core index.** In
  `packages/core/src/index.ts`, append after the `guard-match.js` export
  block (the current end of file, line 167):

```ts
export {
  type AutopilotPolicy,
  autopilotPolicySchema,
  DEFAULT_AUTOPILOT_POLICY,
  type DigestState,
  digestStateSchema,
  readAutopilotPolicy,
  readDigestState,
  writeAutopilotPolicy,
  writeDigestState,
} from "./autopilot-store.js";
```

- [ ] **Step 6: Run to verify PASS.**

```bash
pnpm --filter @megasaver/core exec vitest run autopilot-store
pnpm --filter @megasaver/core test
```

- [ ] **Step 7: Gates.** `pnpm lint:fix && pnpm typecheck` — both clean.

- [ ] **Step 8: Commit.**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/brain-autopilot && \
git add packages/core/src/autopilot-store.ts packages/core/src/index.ts \
  packages/core/test/autopilot-store.test.ts && \
git commit -m "feat(core): autopilot policy and digest stores"
```

---

### Task 4: `scoreCandidate` — pure rule table with the M2 dampener

New `packages/core/src/autopilot.ts` (spec §5.1). Deterministic, no LLM, no
clock, no I/O:

| Rule id | Condition | Result |
|---|---|---|
| `recurring-failure` | `(type === "bug" \|\| type === "test_behavior")` AND `signals.priorSessionHit` | `"high"` |
| `keep-extractor` | everything else | `candidate.confidence` |

The MANDATORY M2 regression pins the dampener: `occurrences: 5` with
`priorSessionHit: false` is NOT high — within-session retry storms (guard
outcome loop, `task step --record-failure`) never qualify. `occurrences` is
not read by the function at all.

**Files:**

- Create: `packages/core/src/autopilot.ts`
- Modify: `packages/core/src/index.ts`
- Create (test): `packages/core/test/autopilot.test.ts`

**Steps:**

- [ ] **Step 1: Write the failing test.** Create
  `packages/core/test/autopilot.test.ts` with exactly:

```ts
import { describe, expect, it } from "vitest";
import { scoreCandidate } from "../src/autopilot.js";
import type { ExtractedCandidate } from "../src/session-memory.js";

function cand(over: Partial<ExtractedCandidate> = {}): ExtractedCandidate {
  return {
    type: "bug",
    source: "test_failure",
    scope: "session",
    confidence: "low",
    approval: "suggested",
    title: "run auth tests",
    content: "Failed step: run auth tests",
    relatedFiles: [],
    contentHash: "0123456789abcdef",
    dedupeKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:0123456789abcdef",
    occurrences: 1,
    ...over,
  };
}

describe("scoreCandidate", () => {
  it("recurring-failure: a cross-session recurring bug scores high", () => {
    expect(scoreCandidate(cand({ type: "bug" }), { priorSessionHit: true })).toBe("high");
  });

  it("recurring-failure: a cross-session recurring test_behavior scores high", () => {
    expect(
      scoreCandidate(cand({ type: "test_behavior", confidence: "medium" }), {
        priorSessionHit: true,
      }),
    ).toBe("high");
  });

  it("keep-extractor: non-failure types keep extractor confidence even on recurrence", () => {
    expect(scoreCandidate(cand({ type: "decision" }), { priorSessionHit: true })).toBe("low");
  });

  it("keep-extractor: no prior-session hit passes the extractor confidence through", () => {
    expect(scoreCandidate(cand({ confidence: "medium" }), { priorSessionHit: false })).toBe(
      "medium",
    );
    expect(scoreCandidate(cand({ confidence: "low" }), { priorSessionHit: false })).toBe("low");
  });

  it("M2 regression: a within-session retry storm NEVER scores high", () => {
    // 5 identical failures in ONE session (occurrences 5) with no cross-session
    // recurrence is a stuck automated loop, not an important memory.
    const storm = scoreCandidate(cand({ occurrences: 5 }), { priorSessionHit: false });
    expect(storm).toBe("low");
    expect(storm).not.toBe("high");
  });
});
```

- [ ] **Step 2: Run to verify FAIL.**

```bash
pnpm --filter @megasaver/core exec vitest run autopilot.test
```

  Expected: `Error: Failed to resolve import "../src/autopilot.js"`
  (module does not exist yet).

- [ ] **Step 3: Minimal implementation.** Create
  `packages/core/src/autopilot.ts` with exactly:

```ts
import type { MemoryConfidence } from "./memory-entry.js";
import type { ExtractedCandidate } from "./session-memory.js";

export type ScoreSignals = { priorSessionHit: boolean };

// Deterministic rule table (spec §5.1) — no LLM, no clock, no I/O.
//   recurring-failure: a failure-derived candidate (bug | test_behavior)
//     whose contentHash also appeared among candidates extracted from a
//     DIFFERENT session's failures => "high".
//   keep-extractor: everything else keeps the extractor's confidence.
// M2 dampener: `occurrences` (within-session repetition) is deliberately NOT
// an input — a retry storm inside one session must never auto-approve.
// The applied rule id is recorded in provenance evidence by runAutopilot.
export function scoreCandidate(
  candidate: ExtractedCandidate,
  signals: ScoreSignals,
): MemoryConfidence {
  const failureDerived = candidate.type === "bug" || candidate.type === "test_behavior";
  if (failureDerived && signals.priorSessionHit) return "high";
  return candidate.confidence;
}
```

- [ ] **Step 4: Export from the core index.** In
  `packages/core/src/index.ts`, append after the `autopilot-store.js` block
  added in Task 3:

```ts
export { type ScoreSignals, scoreCandidate } from "./autopilot.js";
```

- [ ] **Step 5: Run to verify PASS.**

```bash
pnpm --filter @megasaver/core exec vitest run autopilot.test
pnpm --filter @megasaver/core test
```

- [ ] **Step 6: Gates.** `pnpm lint:fix && pnpm typecheck` — both clean.

- [ ] **Step 7: Commit.**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/brain-autopilot && \
git add packages/core/src/autopilot.ts packages/core/src/index.ts \
  packages/core/test/autopilot.test.ts && \
git commit -m "feat(core): scoreCandidate recurrence rule table"
```

---

### Task 5: `runAutopilot` — the capture engine

The engine (spec §5.2, contract T5), in the same
`packages/core/src/autopilot.ts`. Algorithm, EXACTLY in this order:

1. `extractSessionMemories` verbatim over the current session's failures
   (`listFailedAttempts(projectId)` filtered to `sessionId`).
2. Cross-run idempotence: skip any candidate whose
   `dedupeKeywordFor(dedupeKey)` keyword already exists on the project
   (query `listMemoryEntries` — the exact from-session mechanism, so
   autopilot-then-from-session is a no-op and vice versa).
3. Dampener signal: group the project's OTHER sessions' failures by
   `sessionId`, re-extract each group with the same pure extractor;
   `priorSessionHit` = the candidate's `contentHash` is in that set.
4. Score via `scoreCandidate`, split in candidate order under
   `maxAutoApprovesPerSession`. BOTH branches write
   `keywords: [dedupeKeywordFor(dedupeKey)]` (architect M4 — the keyword IS
   the ledger; approved rows without it would duplicate every re-run) and
   capture the same git code anchor from-session captures. Approved branch:
   `approval: "approved"`, `confidence: "high"`, `validFrom: now`,
   `lastActiveAt: now`, evidence
   `"autopilot@1 rule=recurring-failure session=<sessionId>"`. Staged branch:
   `approval: "suggested"`, extractor confidence, no autopilot evidence —
   byte-shape-identical to what from-session writes.
5. Writes via `registry.createMemoryEntry` one row at a time. NEVER
   `updateMemoryEntry`; NO `saveMemoryWithLineage` (detection stays off,
   architect #5). `dryRun` builds both sets (with `newId()`) but performs
   ZERO registry writes. `cappedOut` counts qualified-but-over-cap rows
   (they land in `staged`).

**Files:**

- Modify: `packages/core/src/autopilot.ts`
- Modify: `packages/core/src/index.ts`
- Test (modify): `packages/core/test/autopilot.test.ts`
- Create (test): `apps/cli/test/autopilot-from-session-interop.test.ts`

**Steps:**

- [ ] **Step 1: Confirm the entry-construction template (chunked reads).**
  `grep -n 'memoryEntrySchema.parse' apps/cli/src/commands/memory/from-session.ts`
  then `sed -n '95,130p' apps/cli/src/commands/memory/from-session.ts` —
  the staged branch below must mirror this construction (same fields, same
  conditional spreads). Also
  `grep -n 'getProject\b' packages/core/src/registry.ts` — returns
  `Project | null`.

- [ ] **Step 2: Write the failing core test.** In
  `packages/core/test/autopilot.test.ts`, replace the import block at the
  top of the file with:

```ts
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_AUTOPILOT_POLICY } from "../src/autopilot-store.js";
import { runAutopilot, scoreCandidate } from "../src/autopilot.js";
import { createJsonDirectoryCoreRegistry } from "../src/json-directory-registry.js";
import { type CoreRegistry, createInMemoryCoreRegistry } from "../src/registry.js";
import {
  type ExtractedCandidate,
  dedupeKeywordFor,
  extractSessionMemories,
} from "../src/session-memory.js";
```

  and append at the end of the file (after the `scoreCandidate` describe):

```ts
const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const PRIOR_SESSION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as SessionId;
const CURRENT_SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as SessionId;
const TS = "2026-07-10T00:00:00.000Z";
const NOW = "2026-07-15T12:00:00.000Z";

function idSeq(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  };
}

type AddFailure = (sessionId: SessionId, failedStep: string, errorOutput: string) => void;

function seedBase(registry: CoreRegistry): AddFailure {
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: "/nonexistent/never-a-git-repo",
    createdAt: TS,
    updatedAt: TS,
  } as never);
  for (const [id, startedAt] of [
    [PRIOR_SESSION, TS],
    [CURRENT_SESSION, NOW],
  ] as const) {
    registry.createSession({
      id,
      projectId: PROJECT_ID,
      agentId: "claude-code",
      riskLevel: "medium",
      title: "s",
      startedAt,
      endedAt: null,
    } as never);
  }
  let n = 0;
  return (sessionId, failedStep, errorOutput) => {
    n += 1;
    registry.createFailedAttempt({
      id: `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12, "0")}`,
      projectId: PROJECT_ID,
      sessionId,
      task: "task",
      failedStep,
      errorOutput,
      relatedFiles: [],
      convertedToRule: false,
      createdAt: sessionId === PRIOR_SESSION ? TS : NOW,
    } as never);
  };
}

function run(registry: CoreRegistry, over: { dryRun?: boolean } = {}) {
  return runAutopilot({
    registry,
    projectId: PROJECT_ID,
    sessionId: CURRENT_SESSION,
    policy: DEFAULT_AUTOPILOT_POLICY,
    now: NOW,
    newId: idSeq(),
    ...(over.dryRun !== undefined ? { dryRun: over.dryRun } : {}),
  });
}

describe("runAutopilot", () => {
  it("approves the cross-session recurrence, stages the rest", async () => {
    const registry = createInMemoryCoreRegistry();
    const addFailure = seedBase(registry);
    addFailure(PRIOR_SESSION, "auth middleware crashes", "TypeError: x is undefined");
    addFailure(CURRENT_SESSION, "auth middleware crashes", "TypeError: x is undefined");
    addFailure(CURRENT_SESSION, "build the cli bundle", "ENOENT: missing dist/cli.js");

    const result = await run(registry);

    expect(result.autoApproved).toHaveLength(1);
    expect(result.staged).toHaveLength(1);
    expect(result.skippedExisting).toBe(0);
    expect(result.cappedOut).toBe(0);

    const approved = result.autoApproved[0];
    expect(approved).toBeDefined();
    if (approved === undefined) return;
    expect(approved.approval).toBe("approved");
    expect(approved.confidence).toBe("high");
    expect(approved.validFrom).toBe(NOW);
    expect(approved.lastActiveAt).toBe(NOW);
    expect(approved.evidence).toEqual([
      `autopilot@1 rule=recurring-failure session=${CURRENT_SESSION}`,
    ]);
    expect(approved.title).toBe("auth middleware crashes");

    const staged = result.staged[0];
    expect(staged).toBeDefined();
    if (staged === undefined) return;
    expect(staged.approval).toBe("suggested");
    expect(staged.confidence).toBe("low");
    expect(staged.evidence).toBeUndefined();
    expect(staged.validFrom).toBeUndefined();

    // BOTH branches carry the idempotence ledger keyword (architect M4).
    const candidates = extractSessionMemories({
      sessionId: CURRENT_SESSION,
      projectId: PROJECT_ID,
      failedAttempts: registry
        .listFailedAttempts(PROJECT_ID)
        .filter((f) => f.sessionId === CURRENT_SESSION),
    });
    for (const entry of [approved, staged]) {
      const candidate = candidates.find((c) => c.title === entry.title);
      expect(candidate).toBeDefined();
      if (candidate === undefined) return;
      expect(entry.keywords).toEqual([dedupeKeywordFor(candidate.dedupeKey)]);
    }
    expect(registry.listMemoryEntries(PROJECT_ID)).toHaveLength(2);
  });

  it("storm-negative: a same-session repeat alone approves NOTHING (M2)", async () => {
    const registry = createInMemoryCoreRegistry();
    const addFailure = seedBase(registry);
    addFailure(CURRENT_SESSION, "flaky deploy step", "socket hang up");
    addFailure(CURRENT_SESSION, "flaky deploy step", "socket hang up");
    addFailure(CURRENT_SESSION, "flaky deploy step", "socket hang up");

    const result = await run(registry);

    expect(result.autoApproved).toEqual([]);
    expect(result.staged).toHaveLength(1);
    expect(result.staged[0]?.approval).toBe("suggested");
    expect(result.staged[0]?.confidence).toBe("low");
  });

  it("caps auto-approves per session in candidate order", async () => {
    const registry = createInMemoryCoreRegistry();
    const addFailure = seedBase(registry);
    for (let i = 1; i <= 11; i += 1) {
      addFailure(PRIOR_SESSION, `step ${i} exploded`, `boom ${i}`);
      addFailure(CURRENT_SESSION, `step ${i} exploded`, `boom ${i}`);
    }

    const result = await run(registry); // DEFAULT policy cap: 10

    expect(result.autoApproved).toHaveLength(10);
    expect(result.staged).toHaveLength(1);
    expect(result.cappedOut).toBe(1);
    // The surplus qualified row lands in staged as a plain suggested row.
    expect(result.staged[0]?.approval).toBe("suggested");
    expect(result.staged[0]?.confidence).toBe("low");
    expect(result.staged[0]?.title).toBe("step 11 exploded");
  });

  it("second run skips everything (M4: approved rows carry the ledger keyword)", async () => {
    const registry = createInMemoryCoreRegistry();
    const addFailure = seedBase(registry);
    addFailure(PRIOR_SESSION, "auth middleware crashes", "TypeError: x is undefined");
    addFailure(CURRENT_SESSION, "auth middleware crashes", "TypeError: x is undefined");
    addFailure(CURRENT_SESSION, "build the cli bundle", "ENOENT: missing dist/cli.js");

    const first = await run(registry);
    expect(first.autoApproved).toHaveLength(1);
    // M4 precondition: the APPROVED row itself carries the from-session: keyword.
    expect(first.autoApproved[0]?.keywords.some((k) => k.startsWith("from-session:"))).toBe(true);

    const second = await run(registry);
    expect(second).toEqual({ autoApproved: [], staged: [], skippedExisting: 2, cappedOut: 0 });
    expect(registry.listMemoryEntries(PROJECT_ID)).toHaveLength(2);
  });

  it("stays idempotent when a NEW failure lands between runs (m10 ordering pin)", async () => {
    const registry = createInMemoryCoreRegistry();
    const addFailure = seedBase(registry);
    addFailure(CURRENT_SESSION, "build the cli bundle", "ENOENT: missing dist/cli.js");
    const first = await run(registry);
    expect(first.staged).toHaveLength(1);

    addFailure(CURRENT_SESSION, "run lint", "no-unused-vars");
    const second = await run(registry);
    expect(second.skippedExisting).toBe(1);
    expect(second.staged).toHaveLength(1);
    expect(second.staged[0]?.title).toBe("run lint");
    expect(registry.listMemoryEntries(PROJECT_ID)).toHaveLength(2);
  });
});

describe("runAutopilot --dry-run", () => {
  let rootDir: string;
  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), "megasaver-autopilot-dry-"));
  });
  afterEach(() => rmSync(rootDir, { recursive: true, force: true }));

  function snapshot(dir: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const rel of readdirSync(dir, { recursive: true }) as string[]) {
      const full = join(dir, rel);
      if (statSync(full).isFile()) out.set(rel, readFileSync(full, "utf8"));
    }
    return out;
  }

  it("builds both sets but writes NOTHING (store byte-identical)", async () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir });
    const addFailure = seedBase(registry);
    addFailure(PRIOR_SESSION, "auth middleware crashes", "TypeError: x is undefined");
    addFailure(CURRENT_SESSION, "auth middleware crashes", "TypeError: x is undefined");
    addFailure(CURRENT_SESSION, "build the cli bundle", "ENOENT: missing dist/cli.js");

    const before = snapshot(rootDir);
    const result = await run(registry, { dryRun: true });

    expect(result.autoApproved).toHaveLength(1);
    expect(result.staged).toHaveLength(1);
    expect(result.autoApproved[0]?.approval).toBe("approved");
    expect(snapshot(rootDir)).toEqual(before);
    expect(registry.listMemoryEntries(PROJECT_ID)).toEqual([]);
  });
});
```

  Note: `rootPath` points at a nonexistent dir and every seeded failure has
  `relatedFiles: []`, so `captureCodeAnchor` is never invoked (no git
  spawns; core stays deterministic). If the byte-identical assertion ever
  fails with a `.projects.lock` diff, that is a REAL finding: a write path
  ran during dry-run — debug, do not loosen the snapshot.

- [ ] **Step 3: Run to verify FAIL.**

```bash
pnpm --filter @megasaver/core exec vitest run autopilot.test
```

  Expected: missing-export error —
  `SyntaxError: The requested module '../src/autopilot.js' does not provide an export named 'runAutopilot'`
  (the `scoreCandidate` tests were green in Task 4; the whole file now
  errors at import).

- [ ] **Step 4: Minimal implementation.** In
  `packages/core/src/autopilot.ts`, replace the import block with:

```ts
import type { ProjectId, SessionId } from "@megasaver/shared";
import type { AutopilotPolicy } from "./autopilot-store.js";
import type { FailedAttempt } from "./failed-attempt.js";
import { captureCodeAnchor } from "./memory-anchor.js";
import { type MemoryConfidence, type MemoryEntry, memoryEntrySchema } from "./memory-entry.js";
import type { CoreRegistry } from "./registry.js";
import {
  DEDUPE_KEYWORD_PREFIX,
  type ExtractedCandidate,
  dedupeKeywordFor,
  extractSessionMemories,
} from "./session-memory.js";
```

  and append after `scoreCandidate`:

```ts
export type RunAutopilotResult = {
  autoApproved: MemoryEntry[];
  staged: MemoryEntry[];
  skippedExisting: number;
  cappedOut: number;
};

// The capture engine (spec §5.2): distill the CURRENT session's recorded
// failures into candidates (the from-session extractor, verbatim), skip
// candidates any writer already captured (the from-session: keyword is the
// shared idempotence ledger — architect M4), score with the cross-session
// dampener, split under the per-session cap. Creates NEW rows only — never
// mutates an existing entry; semantic-dup detection stays off (no
// saveMemoryWithLineage — same architect-#5 rationale as from-session).
export async function runAutopilot(opts: {
  registry: CoreRegistry;
  projectId: ProjectId;
  sessionId: SessionId;
  policy: AutopilotPolicy;
  now: string;
  newId: () => string;
  dryRun?: boolean;
}): Promise<RunAutopilotResult> {
  const { registry, projectId, sessionId, policy, now, newId } = opts;
  const dryRun = opts.dryRun === true;

  const allFailures = registry.listFailedAttempts(projectId);
  const candidates = extractSessionMemories({
    sessionId,
    projectId,
    failedAttempts: allFailures.filter((f) => f.sessionId === sessionId),
  });

  const existingKeywords = new Set(
    registry
      .listMemoryEntries(projectId)
      .flatMap((m) => m.keywords)
      .filter((k) => k.startsWith(DEDUPE_KEYWORD_PREFIX)),
  );

  // M2 dampener signal: re-extract the project's OTHER sessions' failures
  // with the same pure extractor and collect their contentHashes. Grouping
  // preserves per-session collapse semantics; the extractor never emits its
  // input sessionId, so passing the current one for every group is safe.
  const bySession = new Map<FailedAttempt["sessionId"], FailedAttempt[]>();
  for (const failureRow of allFailures) {
    if (failureRow.sessionId === sessionId) continue;
    const group = bySession.get(failureRow.sessionId);
    if (group === undefined) bySession.set(failureRow.sessionId, [failureRow]);
    else group.push(failureRow);
  }
  const priorHashes = new Set<string>();
  for (const group of bySession.values()) {
    for (const prior of extractSessionMemories({ sessionId, projectId, failedAttempts: group })) {
      priorHashes.add(prior.contentHash);
    }
  }

  const project = registry.getProject(projectId);
  const result: RunAutopilotResult = {
    autoApproved: [],
    staged: [],
    skippedExisting: 0,
    cappedOut: 0,
  };

  for (const candidate of candidates) {
    const dedupeKeyword = dedupeKeywordFor(candidate.dedupeKey);
    if (existingKeywords.has(dedupeKeyword)) {
      result.skippedExisting += 1;
      continue;
    }

    const score = scoreCandidate(candidate, {
      priorSessionHit: priorHashes.has(candidate.contentHash),
    });
    const qualified = policy.autoApproveTypes.includes(candidate.type) && score === "high";
    const approve = qualified && result.autoApproved.length < policy.maxAutoApprovesPerSession;
    if (qualified && !approve) result.cappedOut += 1;

    // ponytail: one capture (~1 git spawn per cited file) per candidate —
    // same ceiling as from-session; batch through RepoState if volume grows.
    const anchor =
      project === null || candidate.relatedFiles.length === 0
        ? undefined
        : await captureCodeAnchor({
            rootPath: project.rootPath,
            relatedFiles: candidate.relatedFiles,
            now,
          });

    const entry: MemoryEntry = memoryEntrySchema.parse({
      id: newId(),
      projectId,
      sessionId,
      scope: candidate.scope,
      type: candidate.type,
      title: candidate.title,
      content: candidate.content,
      keywords: [dedupeKeyword],
      confidence: approve ? "high" : candidate.confidence,
      source: candidate.source,
      approval: approve ? "approved" : "suggested",
      ...(candidate.relatedFiles.length > 0 ? { relatedFiles: candidate.relatedFiles } : {}),
      ...(anchor !== undefined ? { anchor } : {}),
      ...(approve
        ? {
            validFrom: now,
            lastActiveAt: now,
            evidence: [`autopilot@1 rule=recurring-failure session=${sessionId}`],
          }
        : {}),
      createdAt: now,
      updatedAt: now,
    });

    if (!dryRun) registry.createMemoryEntry(entry);
    (approve ? result.autoApproved : result.staged).push(entry);
  }

  return result;
}
```

- [ ] **Step 5: Widen the core index export.** In
  `packages/core/src/index.ts`, replace the Task 4 line

```ts
export { type ScoreSignals, scoreCandidate } from "./autopilot.js";
```

  with

```ts
export {
  type RunAutopilotResult,
  runAutopilot,
  type ScoreSignals,
  scoreCandidate,
} from "./autopilot.js";
```

- [ ] **Step 6: Run to verify PASS (core).**

```bash
pnpm --filter @megasaver/core exec vitest run autopilot.test
pnpm --filter @megasaver/core test
```

- [ ] **Step 7: Write the from-session interop test (integration pin).**
  Create `apps/cli/test/autopilot-from-session-interop.test.ts` with
  exactly:

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_AUTOPILOT_POLICY,
  createJsonDirectoryCoreRegistry,
  runAutopilot,
} from "@megasaver/core";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMemoryFromSession } from "../src/commands/memory/from-session.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-06-30T00:00:00.000Z";
const NOW = "2026-06-30T12:00:00.000Z";
const FA_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FA_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let store: string;
let out: string[];
let err: string[];

function failure(id: string, over: Record<string, unknown>): string {
  return JSON.stringify({
    id,
    projectId: PROJECT_ID,
    sessionId: SESSION_ID,
    task: "fix login",
    failedStep: "run auth tests",
    relatedFiles: [],
    convertedToRule: false,
    createdAt: TS,
    ...over,
  });
}

function env(over: Record<string, unknown> = {}) {
  return {
    sessionId: SESSION_ID,
    storeFlag: store,
    cwd: store,
    home: store,
    xdgDataHome: undefined,
    platform: process.platform,
    localAppData: undefined,
    jsonFlag: false,
    now: NOW,
    stdout: (l: string) => out.push(l),
    stderr: (l: string) => err.push(l),
    ...over,
  };
}

async function seed(): Promise<void> {
  await mkdir(join(store, "memory"), { recursive: true });
  await mkdir(join(store, "failed-attempts"), { recursive: true });
  await writeFile(
    join(store, "projects.json"),
    JSON.stringify([
      { id: PROJECT_ID, name: "demo", rootPath: "/tmp", createdAt: TS, updatedAt: TS },
    ]),
  );
  await writeFile(
    join(store, "sessions.json"),
    JSON.stringify([
      {
        id: SESSION_ID,
        projectId: PROJECT_ID,
        agentId: "claude-code",
        riskLevel: "medium",
        title: "demo session",
        startedAt: TS,
        endedAt: null,
      },
    ]),
  );
  await writeFile(
    join(store, "failed-attempts", `${PROJECT_ID}.jsonl`),
    `${[
      failure(FA_A, { failedStep: "run auth tests", errorOutput: "boom 401" }),
      failure(FA_B, {
        failedStep: "build the cli bundle",
        errorOutput: "ENOENT: missing dist/cli.js",
      }),
    ].join("\n")}\n`,
  );
}

async function countMemories(): Promise<number> {
  const raw = await readFile(join(store, "memory", `${PROJECT_ID}.jsonl`), "utf8").catch(
    () => "",
  );
  return raw.split("\n").filter((l) => l.trim().length > 0).length;
}

function autopilot() {
  let n = 0;
  return runAutopilot({
    registry: createJsonDirectoryCoreRegistry({ rootDir: store }),
    projectId: PROJECT_ID as ProjectId,
    sessionId: SESSION_ID as SessionId,
    policy: DEFAULT_AUTOPILOT_POLICY,
    now: NOW,
    newId: () => {
      n += 1;
      return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    },
  });
}

beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "mega-cli-autopilot-interop-"));
  out = [];
  err = [];
});

afterEach(async () => {
  await rm(store, { recursive: true, force: true });
});

describe("autopilot and from-session share one idempotence ledger", () => {
  it("from-session first, then autopilot: everything skipped", async () => {
    await seed();
    expect(await runMemoryFromSession(env())).toBe(0);
    expect(await countMemories()).toBe(2);

    const result = await autopilot();
    expect(result).toEqual({ autoApproved: [], staged: [], skippedExisting: 2, cappedOut: 0 });
    expect(await countMemories()).toBe(2);
  });

  it("autopilot first, then from-session: a no-op", async () => {
    await seed();
    const result = await autopilot();
    // No prior session in this store, so both candidates stage (M2).
    expect(result.staged).toHaveLength(2);
    expect(result.autoApproved).toEqual([]);
    expect(await countMemories()).toBe(2);

    expect(await runMemoryFromSession(env())).toBe(0);
    expect(await countMemories()).toBe(2);
    expect(out.join("\n")).toContain("suggested=0");
    expect(out.join("\n")).toContain("skipped=2");
  });
});
```

- [ ] **Step 8: Build, then run the interop test.**

```bash
pnpm build
pnpm --filter @megasaver/cli exec vitest run autopilot-from-session-interop
```

  This is an integration pin over already-tested behavior, so it should be
  green on first run. If it is red, STOP and debug the engine (most likely
  a keyword-composition mismatch against from-session) — do not adjust the
  test to pass.

- [ ] **Step 9: Full package suites.**

```bash
pnpm --filter @megasaver/core test
pnpm --filter @megasaver/cli test
```

- [ ] **Step 10: Gates.** `pnpm lint:fix && pnpm typecheck` — both clean
  (TS4111 only surfaces here).

- [ ] **Step 11: Commit.**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/brain-autopilot && \
git add packages/core/src/autopilot.ts packages/core/src/index.ts \
  packages/core/test/autopilot.test.ts \
  apps/cli/test/autopilot-from-session-interop.test.ts && \
git commit -m "feat(core): runAutopilot capture engine"
```

---
# Section B — Entitlement + approve plumbing, `mega brain autopilot` CLI (Tasks 6–8)

All commands run from the worktree root:
`/Users/halitozger/Desktop/MegaSaver/.claude/worktrees/brain-autopilot`
(branch `feat/brain-autopilot`).

**Section dependency:** Tasks 6–8 build on Section A (Tasks 1–5) being
committed: `@megasaver/core` must already export `runAutopilot`,
`readAutopilotPolicy`, `writeAutopilotPolicy`, `readDigestState`,
`DEFAULT_AUTOPILOT_POLICY`, `type AutopilotPolicy`, and
`type RunAutopilotResult`. Task 7 Step 1 verifies this before touching code.

**Environment hazards (apply to every task below):**

- Mega Saver MCP read-proxy SILENTLY COMPRESSES and can REORDER file reads
  over ~4000 bytes (banners "[Mega Saver: compressed ...]" / "… [N
  paragraphs]") — locate targets with `grep -n`, read with `sed -n 'A,Bp'`
  in <=40-line chunks. Never trust an elided read; re-read smaller on a
  banner.
- `pnpm build` BEFORE running a package's tests (workspace deps resolve via
  `dist/`; the CLI imports `@megasaver/core` exports that Section A just
  added — an unbuilt core makes every CLI test fail on missing exports).
- Full `pnpm typecheck` REQUIRED before every commit — package vitest does
  NOT catch TS4111 (`noPropertyAccessFromIndexSignature`). If it fires, use
  bracket access + `// biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)`.
- tsconfig is `strict` with `exactOptionalPropertyTypes` — never assign an
  explicit `undefined` to an optional property; use conditional spreads
  (`...(x !== undefined ? { x } : {})`), exactly as the code below does.
- Branded IDs: raw UUID string literals in tests need `as ProjectId` /
  `as SessionId` / `as MemoryEntryId` casts where a branded type is required
  (the CLI run-functions below take plain `string` and re-parse at the
  boundary, so their tests need no casts).
- citty single-word boolean args: `--no-<name>` sets `args.<name> = false`.
  Multi-word flags use kebab-case arg keys and bracket access
  (`args["dry-run"]`), per `apps/cli/src/commands/memory/verify.ts:228-249`.
- CLI tests live in `apps/cli/test/` (memory tests under `test/memory/`,
  brain command tests under `test/commands/`); entitlement tests in
  `packages/entitlement/test/`. Single-file runs:
  `pnpm --filter @megasaver/cli exec vitest run <path-or-substring>`.
- Vitest transpiles with esbuild and IGNORES type errors — a union-widening
  change is invisible to `vitest run`. For type-only changes the RED signal
  is `tsc`, not vitest (Task 6 uses this deliberately).

---

### Task 6: `"brain-autopilot"` ProFeature + `RunMemoryApproveInput.approval` widening

Adds the `"brain-autopilot"` member to the `ProFeature` union
(`checkEntitlement` is feature-agnostic — the key documents intent; the test
mirrors the code-truth key test) and widens
`RunMemoryApproveInput.approval` from `"approved" | "rejected"` to
`"approved" | "rejected" | "suggested"` so the digest's undo/spot-review
revoke (Task 10) has a legal target. Runtime behavior needs ZERO production
logic change: `memoryApprovalSchema` already admits `"suggested"`, the
existing no-op guard handles same-state, and `applySupersession` fires only
inside the `input.approval === "approved"` branch. The public
`approve`/`reject` commands keep their two fixed targets — the
`defineApprovalCommand(name: "approve" | "reject", approval: "approved" | "rejected")`
factory signature is NOT touched. Both edits are type-only, so this task
uses the typecheck-RED pattern: vitest stays green throughout; `tsc` is the
failing gate.

**Files:**

- Modify: `packages/entitlement/src/entitlement.ts`
- Modify: `apps/cli/src/commands/memory/approve.ts`
- Test (modify): `packages/entitlement/test/entitlement.test.ts`
- Create (test): `apps/cli/test/memory/approve-suggested.test.ts`

**Steps:**

- [ ] **Step 1: Confirm the worktree and both insertion points.**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/brain-autopilot && git branch --show-current
```

  must print `feat/brain-autopilot`. Then:

```bash
grep -n 'export type ProFeature' packages/entitlement/src/entitlement.ts
```

  expect exactly one hit at line 6:
  `export type ProFeature = "savings-analytics" | "brain-portability" | "code-truth";`

```bash
grep -n '"approved" | "rejected"' apps/cli/src/commands/memory/approve.ts
```

  expect exactly TWO hits: line 10 (the `RunMemoryApproveInput.approval`
  field — this one is widened) and ~line 85 (the `defineApprovalCommand`
  factory parameters — this one is NOT touched). If the shape has drifted,
  stop and report instead of guessing.

- [ ] **Step 2: Write the failing entitlement test.** In
  `packages/entitlement/test/entitlement.test.ts`, locate the code-truth key
  test (`grep -n 'accepts the code-truth feature key' packages/entitlement/test/entitlement.test.ts`
  — ~line 59) and append this test immediately after it, inside the same
  `describe("checkEntitlement", ...)` block (the file's existing
  `signTestLicense` / `writeLicense` / `root` / `now` helpers are reused
  as-is):

```ts
  it("accepts the brain-autopilot feature key with tier-wide semantics", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    expect(checkEntitlement("brain-autopilot", { storeRoot: root, now, publicKey })).toEqual({
      entitled: false,
      reason: "no_license",
    });
    writeLicense(signTestLicense(privateKey, { v: 1, tier: "pro", id: "x", iat: 0, exp: null }));
    expect(checkEntitlement("brain-autopilot", { storeRoot: root, now, publicKey })).toEqual({
      entitled: true,
      tier: "pro",
      expiresAt: null,
    });
  });
```

- [ ] **Step 3: Verify the entitlement RED (typecheck, not vitest).**

```bash
pnpm --filter @megasaver/entitlement exec tsc -p tsconfig.test.json --noEmit
```

  Expected failure:
  `error TS2345: Argument of type '"brain-autopilot"' is not assignable to parameter of type 'ProFeature'.`
  (Note: `pnpm --filter @megasaver/entitlement test` PASSES even now —
  `checkEntitlement` ignores its feature argument at runtime and esbuild
  erases the type. The RED gate for this task is tsc. The entitlement
  package's own `typecheck` script covers only `src/`, which is why the
  explicit `tsc -p tsconfig.test.json` invocation is used here.)

- [ ] **Step 4: Write the failing CLI test.** Create
  `apps/cli/test/memory/approve-suggested.test.ts` with exactly:

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMemoryApprove } from "../../src/commands/memory/approve.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const CANDIDATE_ID = "33333333-3333-4333-8333-333333333333";
const TS = "2026-07-01T00:00:00.000Z";
const NOW = "2026-07-14T00:00:00.000Z";
const LATER = "2026-07-15T00:00:00.000Z";

type StoredRow = { id: string; approval?: string; updatedAt?: string; validTo?: string | null };

describe("mega memory approve — suggested revert (digest undo path)", () => {
  let store: string;
  const lines: string[] = [];
  const errLines: string[] = [];

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-approve-suggested-"));
    lines.length = 0;
    errLines.length = 0;
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  async function seedStore(): Promise<void> {
    await mkdir(join(store, "memory"), { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: "/tmp", createdAt: TS, updatedAt: TS },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
    const base = {
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      type: "decision",
      keywords: [],
      confidence: "high",
      source: "agent",
      stale: false,
      createdAt: TS,
      updatedAt: TS,
    };
    const rows = [
      {
        ...base,
        id: TARGET_ID,
        title: "Use npm for installs",
        content: "use npm for installs",
        approval: "approved",
      },
      {
        ...base,
        id: CANDIDATE_ID,
        title: "Use pnpm for installs",
        content: "use pnpm for installs",
        approval: "approved",
        supersedesId: TARGET_ID,
      },
    ];
    await writeFile(
      join(store, "memory", `${PROJECT_ID}.jsonl`),
      `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`,
    );
  }

  async function readRows(): Promise<StoredRow[]> {
    const raw = await readFile(join(store, "memory", `${PROJECT_ID}.jsonl`), "utf8");
    return raw
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as StoredRow);
  }

  function makeInput(
    over: Partial<Parameters<typeof runMemoryApprove>[0]>,
  ): Parameters<typeof runMemoryApprove>[0] {
    return {
      memoryEntryId: CANDIDATE_ID,
      approval: "suggested",
      storeFlag: store,
      jsonFlag: false,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
      home: process.env["HOME"] ?? "",
      xdgDataHome: undefined,
      platform: process.platform,
      localAppData: undefined,
      stdout: (line) => lines.push(line),
      stderr: (line) => errLines.push(line),
      now: () => NOW,
      ...over,
    };
  }

  it("flips an approved row back to suggested", async () => {
    await seedStore();
    const code = await runMemoryApprove(makeInput({}));
    expect(code).toBe(0);
    const row = (await readRows()).find((r) => r.id === CANDIDATE_ID);
    expect(row?.approval).toBe("suggested");
    expect(row?.updatedAt).toBe(NOW);
    expect(lines).toContain(CANDIDATE_ID);
  });

  it("does NOT run supersession on the suggested path", async () => {
    await seedStore();
    const code = await runMemoryApprove(makeInput({}));
    expect(code).toBe(0);
    const target = (await readRows()).find((r) => r.id === TARGET_ID);
    // applySupersession fires only on the approved flip, never on the
    // suggested revert: the declared target must stay open, no note printed.
    expect(target?.validTo).toBeUndefined();
    expect(target?.approval).toBe("approved");
    expect(errLines).toEqual([]);
  });

  it("no-op guard: reverting an already-suggested row does not churn updatedAt", async () => {
    await seedStore();
    expect(await runMemoryApprove(makeInput({}))).toBe(0);
    lines.length = 0;
    expect(await runMemoryApprove(makeInput({ now: () => LATER }))).toBe(0);
    const row = (await readRows()).find((r) => r.id === CANDIDATE_ID);
    expect(row?.updatedAt).toBe(NOW);
    expect(lines).toContain(CANDIDATE_ID);
  });
});
```

- [ ] **Step 5: Verify the CLI RED (typecheck).**

```bash
pnpm --filter @megasaver/cli typecheck
```

  Expected failure on `test/memory/approve-suggested.test.ts`:
  `error TS2322: Type '"suggested"' is not assignable to type '"approved" | "rejected"'.`
  (Again: `vitest run approve-suggested` would PASS even now — the runtime
  path already accepts `"suggested"` through `memoryApprovalSchema`. The
  RED gate is typecheck; this is exactly why the production change is
  type-only and safe.)

- [ ] **Step 6: Minimal implementation — two one-line edits.**

  In `packages/entitlement/src/entitlement.ts` line 6, replace:

```ts
export type ProFeature = "savings-analytics" | "brain-portability" | "code-truth";
```

  with:

```ts
export type ProFeature = "savings-analytics" | "brain-portability" | "code-truth" | "brain-autopilot";
```

  In `apps/cli/src/commands/memory/approve.ts` line 10 (inside
  `RunMemoryApproveInput`), replace:

```ts
  approval: "approved" | "rejected";
```

  with:

```ts
  approval: "approved" | "rejected" | "suggested";
```

  Do NOT touch anything else in `approve.ts`: the no-op guard, the
  `applySupersession` branch (`if (input.approval === "approved")`), and the
  `defineApprovalCommand(name: "approve" | "reject", approval: "approved" | "rejected")`
  factory all stay byte-identical.

- [ ] **Step 7: Verify GREEN.**

```bash
pnpm build
pnpm --filter @megasaver/entitlement exec tsc -p tsconfig.test.json --noEmit
pnpm --filter @megasaver/entitlement test
pnpm --filter @megasaver/cli typecheck
pnpm --filter @megasaver/cli exec vitest run approve
```

  All green. The last command runs `memory-approve.test.ts`,
  `memory/approve-supersession.test.ts`, AND the new
  `memory/approve-suggested.test.ts` — the untouched existing suites are the
  evidence that the public approve/reject commands are unchanged.

- [ ] **Step 8: Gates.**

```bash
pnpm lint:fix && pnpm typecheck
```

- [ ] **Step 9: Commit.**

```bash
git add packages/entitlement/src/entitlement.ts packages/entitlement/test/entitlement.test.ts apps/cli/src/commands/memory/approve.ts apps/cli/test/memory/approve-suggested.test.ts && git commit -m "feat(cli): autopilot gate + suggested revert"
```

---

### Task 7: `mega brain autopilot status|on|off` (FREE policy surface)

Creates `apps/cli/src/commands/brain/autopilot.ts` with three FREE
subcommands over the Task 3 policy store: `status` (enabled?, policy fields,
project-agnostic pending-suggested count, lastDigestAt), `on`
(`--auto-approve-types` comma list validated against `memoryTypeSchema`
options — unknown type → exit 1 + the valid list; `--max-per-session`
positive integer; writes the policy and prints what the next entitled run
will do), and `off` (`enabled: false`, other fields preserved). Registers
the `autopilot` subcommand in `apps/cli/src/commands/brain/index.ts`. No
entitlement gate anywhere in this task (spec §7: status/on/off are FREE).

**Files:**

- Create: `apps/cli/src/commands/brain/autopilot.ts`
- Modify: `apps/cli/src/commands/brain/index.ts`
- Create (test): `apps/cli/test/commands/brain-autopilot-policy.test.ts`

**Steps:**

- [ ] **Step 1: Confirm Section A landed and the registration point.**

```bash
grep -n "readAutopilotPolicy\|writeAutopilotPolicy\|readDigestState\|DEFAULT_AUTOPILOT_POLICY" packages/core/src/index.ts
grep -n "runAutopilot" packages/core/src/index.ts
grep -n "subCommands" apps/cli/src/commands/brain/index.ts
```

  The first two greps must each hit (Section A Tasks 3/5 exports). The third
  must show the `export`/`import`/`sync` subcommand map (~line 30 of the
  39-line file). If the core exports are missing, STOP — Section A is not
  complete; do not stub them.

- [ ] **Step 2: Write the failing test.** Create
  `apps/cli/test/commands/brain-autopilot-policy.test.ts` with exactly:

```ts
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAutopilotPolicy } from "@megasaver/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  runAutopilotOff,
  runAutopilotOn,
  runAutopilotStatus,
} from "../../src/commands/brain/autopilot.js";
import { brainCommand } from "../../src/commands/brain/index.js";
import { ensureStoreReady } from "../../src/store.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const MEM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const MEM_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const MEM_C = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const TS = "2026-07-01T00:00:00.000Z";

let store: string;
let out: string[];
let err: string[];

beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "megasaver-autopilot-policy-"));
  out = [];
  err = [];
});

afterEach(async () => {
  await rm(store, { recursive: true, force: true });
});

async function seedStore(withMemories = false): Promise<void> {
  await mkdir(join(store, "memory"), { recursive: true });
  await writeFile(
    join(store, "projects.json"),
    JSON.stringify([
      { id: PROJECT_ID, name: "demo", rootPath: "/tmp", createdAt: TS, updatedAt: TS },
    ]),
  );
  await writeFile(join(store, "sessions.json"), "[]");
  if (withMemories) {
    const base = {
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      type: "decision",
      keywords: [],
      confidence: "medium",
      source: "manual",
      stale: false,
      createdAt: TS,
      updatedAt: TS,
    };
    const rows = [
      { ...base, id: MEM_A, title: "a", content: "a", approval: "suggested" },
      { ...base, id: MEM_B, title: "b", content: "b", approval: "suggested" },
      { ...base, id: MEM_C, title: "c", content: "c", approval: "approved" },
    ];
    await writeFile(
      join(store, "memory", `${PROJECT_ID}.jsonl`),
      `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`,
    );
  }
}

function statusInput() {
  return {
    storeRoot: store,
    ensureStore: () => ensureStoreReady(store),
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => err.push(line),
  };
}

function onInput(typesFlag: string | undefined, maxFlag: string | undefined) {
  return {
    storeRoot: store,
    typesFlag,
    maxFlag,
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => err.push(line),
  };
}

describe("mega brain autopilot status/on/off", () => {
  it("status on a fresh store shows the fail-closed defaults", async () => {
    await seedStore();
    const code = await runAutopilotStatus(statusInput());
    expect(code).toBe(0);
    expect(out).toContain("enabled: no");
    expect(out).toContain("auto-approve types: bug, test_behavior");
    expect(out).toContain("min confidence: high");
    expect(out).toContain("max per session: 10");
    expect(out).toContain("pending suggested: 0");
    expect(out).toContain("last digest: never");
  });

  it("on writes the policy; off flips enabled back, preserving fields", async () => {
    await seedStore();
    expect(runAutopilotOn(onInput("bug,decision", "5"))).toBe(0);
    let policy = readAutopilotPolicy(store);
    expect(policy.enabled).toBe(true);
    expect(policy.autoApproveTypes).toEqual(["bug", "decision"]);
    expect(policy.maxAutoApprovesPerSession).toBe(5);
    expect(out.join("\n")).toContain("autopilot on");

    expect(
      runAutopilotOff({
        storeRoot: store,
        stdout: (line: string) => out.push(line),
        stderr: (line: string) => err.push(line),
      }),
    ).toBe(0);
    policy = readAutopilotPolicy(store);
    expect(policy.enabled).toBe(false);
    expect(policy.autoApproveTypes).toEqual(["bug", "decision"]);
    expect(policy.maxAutoApprovesPerSession).toBe(5);
  });

  it("rejects an unknown --auto-approve-types entry with the valid list", async () => {
    await seedStore();
    const code = runAutopilotOn(onInput("bug,nonsense", undefined));
    expect(code).toBe(1);
    expect(err.join("\n")).toContain('invalid memory type "nonsense"');
    expect(err.join("\n")).toContain("decision");
    expect(err.join("\n")).toContain("test_behavior");
    // Zero writes on the reject path: the policy file is never created.
    expect(existsSync(join(store, "autopilot.json"))).toBe(false);
    expect(readAutopilotPolicy(store).enabled).toBe(false);
  });

  it("rejects a non-positive --max-per-session", async () => {
    await seedStore();
    expect(runAutopilotOn(onInput(undefined, "0"))).toBe(1);
    expect(err.join("\n")).toContain("--max-per-session");
    expect(readAutopilotPolicy(store).enabled).toBe(false);
  });

  it("status counts suggested rows project-agnostically", async () => {
    await seedStore(true);
    const code = await runAutopilotStatus(statusInput());
    expect(code).toBe(0);
    expect(out).toContain("pending suggested: 2");
  });

  it("brain command registers the autopilot subcommand", () => {
    expect(Object.keys(brainCommand.subCommands ?? {})).toContain("autopilot");
  });
});
```

- [ ] **Step 3: Verify RED.**

```bash
pnpm build
pnpm --filter @megasaver/cli exec vitest run brain-autopilot-policy
```

  Expected failure: the suite errors at load with
  `Failed to resolve import "../../src/commands/brain/autopilot.js"`
  (the module does not exist yet).

- [ ] **Step 4: Minimal implementation.** Create
  `apps/cli/src/commands/brain/autopilot.ts` with exactly:

```ts
import {
  type AutopilotPolicy,
  type MemoryType,
  memoryTypeSchema,
  readAutopilotPolicy,
  readDigestState,
  writeAutopilotPolicy,
} from "@megasaver/core";
import { defineCommand } from "citty";
import {
  type EnsureStoreReadyResult,
  ensureStoreReady,
  readStoreEnv,
  resolveStorePath,
} from "../../store.js";

export type RunAutopilotStatusInput = {
  storeRoot: string;
  ensureStore: () => Promise<EnsureStoreReadyResult>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runAutopilotStatus(input: RunAutopilotStatusInput): Promise<0 | 1> {
  const policy = readAutopilotPolicy(input.storeRoot);
  const digest = readDigestState(input.storeRoot);
  const { registry, initialized } = await input.ensureStore();
  if (initialized) input.stderr(`note: initialized store at ${input.storeRoot}`);
  let pendingSuggested = 0;
  for (const project of registry.listProjects()) {
    pendingSuggested += registry
      .listMemoryEntries(project.id)
      .filter((entry) => entry.approval === "suggested").length;
  }
  input.stdout(`enabled: ${policy.enabled ? "yes" : "no"}`);
  input.stdout(`auto-approve types: ${policy.autoApproveTypes.join(", ")}`);
  input.stdout(`min confidence: ${policy.autoApproveMinConfidence}`);
  input.stdout(`max per session: ${policy.maxAutoApprovesPerSession}`);
  input.stdout(`pending suggested: ${pendingSuggested}`);
  input.stdout(`last digest: ${digest.lastDigestAt ?? "never"}`);
  return 0;
}

export type RunAutopilotOnInput = {
  storeRoot: string;
  typesFlag: string | undefined;
  maxFlag: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export function runAutopilotOn(input: RunAutopilotOnInput): 0 | 1 {
  const policy = readAutopilotPolicy(input.storeRoot);
  let autoApproveTypes = policy.autoApproveTypes;
  if (input.typesFlag !== undefined) {
    const items = input.typesFlag
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (items.length === 0) {
      input.stderr(
        `--auto-approve-types needs at least one type — valid types: ${memoryTypeSchema.options.join(", ")}`,
      );
      return 1;
    }
    const parsed: MemoryType[] = [];
    for (const item of items) {
      const result = memoryTypeSchema.safeParse(item);
      if (!result.success) {
        input.stderr(
          `invalid memory type "${item}" — valid types: ${memoryTypeSchema.options.join(", ")}`,
        );
        return 1;
      }
      parsed.push(result.data);
    }
    autoApproveTypes = parsed;
  }
  let maxAutoApprovesPerSession = policy.maxAutoApprovesPerSession;
  if (input.maxFlag !== undefined) {
    const parsed = Number(input.maxFlag);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      input.stderr(`invalid --max-per-session "${input.maxFlag}" — must be a positive integer`);
      return 1;
    }
    maxAutoApprovesPerSession = parsed;
  }
  const next: AutopilotPolicy = {
    ...policy,
    enabled: true,
    autoApproveTypes,
    maxAutoApprovesPerSession,
  };
  writeAutopilotPolicy(input.storeRoot, next);
  input.stdout(
    `autopilot on — the next entitled run auto-approves up to ${maxAutoApprovesPerSession} high-confidence ${autoApproveTypes.join("/")} memories per session; everything else stays suggested`,
  );
  return 0;
}

export type RunAutopilotOffInput = {
  storeRoot: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export function runAutopilotOff(input: RunAutopilotOffInput): 0 | 1 {
  const policy = readAutopilotPolicy(input.storeRoot);
  writeAutopilotPolicy(input.storeRoot, { ...policy, enabled: false });
  input.stdout("autopilot off");
  return 0;
}

const autopilotStatusCommand = defineCommand({
  meta: { name: "status", description: "Show the autopilot policy and pending queue size." },
  args: {
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeRoot = resolveStorePath(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    const code = await runAutopilotStatus({
      storeRoot,
      ensureStore: () => ensureStoreReady(storeRoot),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});

const autopilotOnCommand = defineCommand({
  meta: { name: "on", description: "Enable autopilot and set the auto-approve policy." },
  args: {
    "auto-approve-types": {
      type: "string",
      description: "Comma-separated memory types eligible for auto-approve.",
    },
    "max-per-session": {
      type: "string",
      description: "Max auto-approves per session run (positive integer).",
    },
    store: { type: "string", description: "Override store directory." },
  },
  run({ args }) {
    const storeRoot = resolveStorePath(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    const code = runAutopilotOn({
      storeRoot,
      typesFlag:
        typeof args["auto-approve-types"] === "string" ? args["auto-approve-types"] : undefined,
      maxFlag: typeof args["max-per-session"] === "string" ? args["max-per-session"] : undefined,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});

const autopilotOffCommand = defineCommand({
  meta: { name: "off", description: "Disable autopilot auto-approval." },
  args: {
    store: { type: "string", description: "Override store directory." },
  },
  run({ args }) {
    const storeRoot = resolveStorePath(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    const code = runAutopilotOff({
      storeRoot,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});

export const brainAutopilotCommand = defineCommand({
  meta: {
    name: "autopilot",
    description: "Grow the brain automatically — policy toggle, status, and manual runs.",
  },
  subCommands: {
    status: autopilotStatusCommand,
    on: autopilotOnCommand,
    off: autopilotOffCommand,
  },
});
```

- [ ] **Step 5: Register the subcommand.** In
  `apps/cli/src/commands/brain/index.ts`: add the import
  `import { brainAutopilotCommand } from "./autopilot.js";` beside the
  existing imports, add a named re-export block, and add
  `autopilot: brainAutopilotCommand` to `subCommands`. The full edited file:

```ts
import { defineCommand } from "citty";
import { brainAutopilotCommand } from "./autopilot.js";
import { brainExportCommand } from "./export.js";
import { brainImportCommand } from "./import.js";
import { brainSyncCommand } from "./sync/index.js";

export {
  type RunAutopilotOffInput,
  type RunAutopilotOnInput,
  type RunAutopilotStatusInput,
  brainAutopilotCommand,
  runAutopilotOff,
  runAutopilotOn,
  runAutopilotStatus,
} from "./autopilot.js";
export {
  BRAIN_EXPORT_UPSELL,
  type RunBrainExportInput,
  brainExportCommand,
  runBrainExport,
} from "./export.js";
export {
  BRAIN_IMPORT_UPSELL,
  type RunBrainImportInput,
  brainImportCommand,
  runBrainImport,
} from "./import.js";
export {
  type BrainSyncOpInput,
  brainSyncCommand,
  brainSyncPullCommand,
  brainSyncPushCommand,
  brainSyncStatusCommand,
  runBrainSyncPull,
  runBrainSyncPush,
  runBrainSyncStatus,
} from "./sync/index.js";

export const brainCommand = defineCommand({
  meta: {
    name: "brain",
    description: "Portable project brain — export/import the knowledge layer (Mega Saver Pro).",
  },
  subCommands: {
    autopilot: brainAutopilotCommand,
    export: brainExportCommand,
    import: brainImportCommand,
    sync: brainSyncCommand,
  },
});
```

- [ ] **Step 6: Verify GREEN.**

```bash
pnpm build
pnpm --filter @megasaver/cli exec vitest run brain-autopilot-policy
```

  All 6 tests pass.

- [ ] **Step 7: Gates.**

```bash
pnpm lint:fix && pnpm typecheck
```

- [ ] **Step 8: Commit.**

```bash
git add apps/cli/src/commands/brain/autopilot.ts apps/cli/src/commands/brain/index.ts apps/cli/test/commands/brain-autopilot-policy.test.ts && git commit -m "feat(cli): mega brain autopilot status/on/off"
```

---

### Task 8: `mega brain autopilot run` (PRO gate, FREE `--dry-run`)

Adds the `run` subcommand to the same `autopilot.ts`:
`run --session <id> [--project <name>] [--dry-run] [--json]`. Order of
operations (spec §6.1, architect M3): parse/validate → `--dry-run`? FREE
path — no entitlement check, no `enabled` check (the free proof surface) →
otherwise PRO gate FIRST (`checkEntitlement("brain-autopilot", ...)`;
unentitled → exported `AUTOPILOT_UPSELL` on stdout + exit 0, zero work) →
`enabled` check (`readAutopilotPolicy`; disabled →
`autopilot is off — enable with: mega brain autopilot on` on stderr +
exit 1, ZERO writes — the check runs BEFORE `ensureStore`, which would
otherwise initialize the store) → `runAutopilot` from `@megasaver/core`.
Table output: `auto-approved N · staged M · skipped K (already captured) ·
capped C` + one `id type title` line per row; `cappedOut > 0` renders a
notice; `--json` emits the `RunAutopilotResult`; dry-run prints a
`DRY RUN — nothing written` banner on stderr plus the same table. The
`--project` flag is a guard: it resolves the project by name and errors if
the session belongs elsewhere; the session's own `projectId` is what feeds
`runAutopilot`.

**Files:**

- Modify: `apps/cli/src/commands/brain/autopilot.ts`
- Modify: `apps/cli/src/commands/brain/index.ts`
- Create (test): `apps/cli/test/commands/brain-autopilot-run.test.ts`

**Steps:**

- [ ] **Step 1: Confirm the core engine export (Section A Task 5).**

```bash
grep -n "runAutopilot\|RunAutopilotResult" packages/core/src/index.ts
```

  Both must hit. If missing, STOP — Task 5 has not landed.

- [ ] **Step 2: Write the failing test.** Create
  `apps/cli/test/commands/brain-autopilot-run.test.ts` with exactly:

```ts
import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_AUTOPILOT_POLICY, writeAutopilotPolicy } from "@megasaver/core";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUTOPILOT_UPSELL, runAutopilotRun } from "../../src/commands/brain/autopilot.js";
import { ensureStoreReady } from "../../src/store.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_A = "22222222-2222-4222-8222-222222222222"; // earlier session
const SESSION_B = "33333333-3333-4333-8333-333333333333"; // current session
const FA_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const FA_B1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const FA_B2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const TS = "2026-07-01T00:00:00.000Z";
const NOW = "2026-07-14T00:00:00.000Z";

type LicensePayload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
  payload: LicensePayload,
): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

let store: string;
let out: string[];
let err: string[];
let proPublicKey: KeyObject | undefined;

beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "megasaver-autopilot-run-"));
  out = [];
  err = [];
  proPublicKey = undefined;
});

afterEach(async () => {
  await rm(store, { recursive: true, force: true });
});

function activatePro(): void {
  const keys = generateKeyPairSync("ed25519");
  const key = signTestLicense(keys.privateKey, { v: 1, tier: "pro", id: "t1", iat: 0, exp: null });
  activateLicense(store, key, { publicKey: keys.publicKey, now: () => Date.parse(NOW) });
  proPublicKey = keys.publicKey;
}

function failure(id: string, sessionId: string, over: Record<string, unknown>): string {
  return JSON.stringify({
    id,
    projectId: PROJECT_ID,
    sessionId,
    task: "fix login",
    failedStep: "run auth tests",
    relatedFiles: [],
    convertedToRule: false,
    createdAt: TS,
    ...over,
  });
}

async function seed(failures: string[]): Promise<void> {
  await mkdir(join(store, "memory"), { recursive: true });
  await mkdir(join(store, "failed-attempts"), { recursive: true });
  await writeFile(
    join(store, "projects.json"),
    JSON.stringify([
      { id: PROJECT_ID, name: "demo", rootPath: "/tmp", createdAt: TS, updatedAt: TS },
    ]),
  );
  await writeFile(
    join(store, "sessions.json"),
    JSON.stringify([
      {
        id: SESSION_A,
        projectId: PROJECT_ID,
        agentId: "claude-code",
        riskLevel: "medium",
        title: "earlier session",
        startedAt: TS,
        endedAt: TS,
      },
      {
        id: SESSION_B,
        projectId: PROJECT_ID,
        agentId: "claude-code",
        riskLevel: "medium",
        title: "current session",
        startedAt: TS,
        endedAt: null,
      },
    ]),
  );
  await writeFile(
    join(store, "failed-attempts", `${PROJECT_ID}.jsonl`),
    `${failures.join("\n")}\n`,
  );
}

// The same failure in session A and session B (cross-session recurrence —
// the dampener's qualifying signal, scores high) plus a one-off failure in
// session B (stays suggested).
function seedRecurringPlusOneOff(): Promise<void> {
  return seed([
    failure(FA_A, SESSION_A, {
      failedStep: "run auth tests",
      errorOutput: "AssertionError: expected 200 to be 401",
    }),
    failure(FA_B1, SESSION_B, {
      failedStep: "run auth tests",
      errorOutput: "AssertionError: expected 200 to be 401",
    }),
    failure(FA_B2, SESSION_B, {
      failedStep: "bundle the cli",
      errorOutput: "ENOENT: missing dist/cli.js",
    }),
  ]);
}

type StoredMem = {
  id: string;
  type: string;
  approval: string;
  confidence: string;
  keywords: string[];
  evidence?: string[];
  validFrom?: string;
  lastActiveAt?: string;
};

async function readMemories(): Promise<StoredMem[]> {
  const raw = await readFile(join(store, "memory", `${PROJECT_ID}.jsonl`), "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as StoredMem);
}

function runInput(over: Partial<Parameters<typeof runAutopilotRun>[0]> = {}) {
  let n = 0;
  return {
    storeRoot: store,
    sessionId: SESSION_B,
    projectName: undefined,
    dryRunFlag: false,
    jsonFlag: false,
    now: () => Date.parse(NOW),
    newId: () => `55555555-5555-4555-8555-${String(++n).padStart(12, "0")}`,
    ensureStore: () => ensureStoreReady(store),
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => err.push(line),
    ...(proPublicKey === undefined ? {} : { publicKey: proPublicKey }),
    ...over,
  };
}

describe("mega brain autopilot run", () => {
  it("free tier: prints the upsell, exit 0, zero writes", async () => {
    await seedRecurringPlusOneOff();
    const code = await runAutopilotRun(runInput());
    expect(code).toBe(0);
    expect(out).toContain(AUTOPILOT_UPSELL);
    expect(existsSync(join(store, "memory", `${PROJECT_ID}.jsonl`))).toBe(false);
  });

  it("entitled but disabled: refuses on stderr, exit 1, zero writes", async () => {
    await seedRecurringPlusOneOff();
    activatePro();
    const code = await runAutopilotRun(runInput());
    expect(code).toBe(1);
    expect(err).toContain("autopilot is off — enable with: mega brain autopilot on");
    expect(existsSync(join(store, "memory", `${PROJECT_ID}.jsonl`))).toBe(false);
  });

  it("entitled + enabled: auto-approves the recurring failure, stages the rest", async () => {
    await seedRecurringPlusOneOff();
    activatePro();
    writeAutopilotPolicy(store, { ...DEFAULT_AUTOPILOT_POLICY, enabled: true });
    const code = await runAutopilotRun(runInput());
    expect(code).toBe(0);

    const mems = await readMemories();
    expect(mems).toHaveLength(2);
    const approved = mems.find((m) => m.approval === "approved");
    const staged = mems.find((m) => m.approval === "suggested");
    expect(approved).toBeDefined();
    expect(staged).toBeDefined();
    expect(approved?.confidence).toBe("high");
    expect(approved?.evidence).toContain(
      `autopilot@1 rule=recurring-failure session=${SESSION_B}`,
    );
    expect(approved?.validFrom).toBe(NOW);
    expect(approved?.lastActiveAt).toBe(NOW);
    expect(approved?.keywords[0]).toMatch(/^from-session:/);
    expect(staged?.keywords[0]).toMatch(/^from-session:/);
    expect(staged?.evidence ?? []).toEqual([]);
    expect(out.join("\n")).toContain(
      "auto-approved 1 · staged 1 · skipped 0 (already captured) · capped 0",
    );
  });

  it("--dry-run is free, ignores enabled, prints the banner, writes nothing", async () => {
    await seedRecurringPlusOneOff();
    const code = await runAutopilotRun(runInput({ dryRunFlag: true }));
    expect(code).toBe(0);
    expect(err).toContain("DRY RUN — nothing written");
    expect(out.join("\n")).toContain(
      "auto-approved 1 · staged 1 · skipped 0 (already captured) · capped 0",
    );
    expect(existsSync(join(store, "memory", `${PROJECT_ID}.jsonl`))).toBe(false);
  });

  it("--json emits the RunAutopilotResult shape", async () => {
    await seedRecurringPlusOneOff();
    activatePro();
    writeAutopilotPolicy(store, { ...DEFAULT_AUTOPILOT_POLICY, enabled: true });
    const code = await runAutopilotRun(runInput({ jsonFlag: true }));
    expect(code).toBe(0);
    const result = JSON.parse(out.join("")) as {
      autoApproved: unknown[];
      staged: unknown[];
      skippedExisting: number;
      cappedOut: number;
    };
    expect(result.autoApproved).toHaveLength(1);
    expect(result.staged).toHaveLength(1);
    expect(result.skippedExisting).toBe(0);
    expect(result.cappedOut).toBe(0);
  });

  it("unknown session exits 1", async () => {
    await seedRecurringPlusOneOff();
    const code = await runAutopilotRun(
      runInput({ dryRunFlag: true, sessionId: "99999999-9999-4999-8999-999999999999" }),
    );
    expect(code).toBe(1);
    expect(err.join("\n").length).toBeGreaterThan(0);
  });

  it("unknown --project exits 1 and writes nothing", async () => {
    await seedRecurringPlusOneOff();
    const code = await runAutopilotRun(runInput({ dryRunFlag: true, projectName: "other" }));
    expect(code).toBe(1);
    expect(existsSync(join(store, "memory", `${PROJECT_ID}.jsonl`))).toBe(false);
  });
});
```

- [ ] **Step 3: Verify RED.**

```bash
pnpm build
pnpm --filter @megasaver/cli exec vitest run brain-autopilot-run
```

  Expected failure: the suite errors at load because
  `../../src/commands/brain/autopilot.js` does not export
  `runAutopilotRun` / `AUTOPILOT_UPSELL`
  (`SyntaxError: ... does not provide an export named 'runAutopilotRun'`,
  or Vite's equivalent missing-export error).

- [ ] **Step 4: Minimal implementation.** Replace
  `apps/cli/src/commands/brain/autopilot.ts` with the full file below (the
  Task 7 content plus the new imports, `AUTOPILOT_UPSELL`,
  `RunAutopilotRunInput`, `runAutopilotRun`, `autopilotRunCommand`, and the
  `run` entry in `subCommands` — everything else byte-identical to Task 7):

```ts
import { type KeyObject, randomUUID } from "node:crypto";
import {
  type AutopilotPolicy,
  type MemoryType,
  memoryTypeSchema,
  readAutopilotPolicy,
  readDigestState,
  runAutopilot,
  writeAutopilotPolicy,
} from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
import { sessionIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import {
  mapErrorToCliMessage,
  projectNotFoundMessage,
  sessionNotFoundMessage,
} from "../../errors.js";
import {
  type EnsureStoreReadyResult,
  ensureStoreReady,
  readStoreEnv,
  resolveStorePath,
} from "../../store.js";

export const AUTOPILOT_UPSELL =
  "Brain autopilot is a Mega Saver Pro feature. Activate a key: mega license activate <key>.";

export type RunAutopilotStatusInput = {
  storeRoot: string;
  ensureStore: () => Promise<EnsureStoreReadyResult>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runAutopilotStatus(input: RunAutopilotStatusInput): Promise<0 | 1> {
  const policy = readAutopilotPolicy(input.storeRoot);
  const digest = readDigestState(input.storeRoot);
  const { registry, initialized } = await input.ensureStore();
  if (initialized) input.stderr(`note: initialized store at ${input.storeRoot}`);
  let pendingSuggested = 0;
  for (const project of registry.listProjects()) {
    pendingSuggested += registry
      .listMemoryEntries(project.id)
      .filter((entry) => entry.approval === "suggested").length;
  }
  input.stdout(`enabled: ${policy.enabled ? "yes" : "no"}`);
  input.stdout(`auto-approve types: ${policy.autoApproveTypes.join(", ")}`);
  input.stdout(`min confidence: ${policy.autoApproveMinConfidence}`);
  input.stdout(`max per session: ${policy.maxAutoApprovesPerSession}`);
  input.stdout(`pending suggested: ${pendingSuggested}`);
  input.stdout(`last digest: ${digest.lastDigestAt ?? "never"}`);
  return 0;
}

export type RunAutopilotOnInput = {
  storeRoot: string;
  typesFlag: string | undefined;
  maxFlag: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export function runAutopilotOn(input: RunAutopilotOnInput): 0 | 1 {
  const policy = readAutopilotPolicy(input.storeRoot);
  let autoApproveTypes = policy.autoApproveTypes;
  if (input.typesFlag !== undefined) {
    const items = input.typesFlag
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (items.length === 0) {
      input.stderr(
        `--auto-approve-types needs at least one type — valid types: ${memoryTypeSchema.options.join(", ")}`,
      );
      return 1;
    }
    const parsed: MemoryType[] = [];
    for (const item of items) {
      const result = memoryTypeSchema.safeParse(item);
      if (!result.success) {
        input.stderr(
          `invalid memory type "${item}" — valid types: ${memoryTypeSchema.options.join(", ")}`,
        );
        return 1;
      }
      parsed.push(result.data);
    }
    autoApproveTypes = parsed;
  }
  let maxAutoApprovesPerSession = policy.maxAutoApprovesPerSession;
  if (input.maxFlag !== undefined) {
    const parsed = Number(input.maxFlag);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      input.stderr(`invalid --max-per-session "${input.maxFlag}" — must be a positive integer`);
      return 1;
    }
    maxAutoApprovesPerSession = parsed;
  }
  const next: AutopilotPolicy = {
    ...policy,
    enabled: true,
    autoApproveTypes,
    maxAutoApprovesPerSession,
  };
  writeAutopilotPolicy(input.storeRoot, next);
  input.stdout(
    `autopilot on — the next entitled run auto-approves up to ${maxAutoApprovesPerSession} high-confidence ${autoApproveTypes.join("/")} memories per session; everything else stays suggested`,
  );
  return 0;
}

export type RunAutopilotOffInput = {
  storeRoot: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export function runAutopilotOff(input: RunAutopilotOffInput): 0 | 1 {
  const policy = readAutopilotPolicy(input.storeRoot);
  writeAutopilotPolicy(input.storeRoot, { ...policy, enabled: false });
  input.stdout("autopilot off");
  return 0;
}

export type RunAutopilotRunInput = {
  storeRoot: string;
  sessionId: string;
  projectName: string | undefined;
  dryRunFlag: boolean;
  jsonFlag: boolean;
  now: () => number;
  newId?: () => string;
  publicKey?: KeyObject | string;
  ensureStore: () => Promise<EnsureStoreReadyResult>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runAutopilotRun(input: RunAutopilotRunInput): Promise<0 | 1> {
  let sessionId: ReturnType<typeof sessionIdSchema.parse>;
  try {
    sessionId = sessionIdSchema.parse(input.sessionId);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "sessionId" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  // Real runs only: PRO gate FIRST (zero work when unentitled), then the
  // enabled toggle (architect M3) — both BEFORE ensureStore, which would
  // otherwise initialize the store (a write). --dry-run is the free proof
  // surface and skips both checks.
  if (!input.dryRunFlag) {
    const ent = checkEntitlement("brain-autopilot", {
      storeRoot: input.storeRoot,
      now: input.now,
      ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
    });
    if (!ent.entitled) {
      input.stdout(AUTOPILOT_UPSELL);
      return 0;
    }
    if (!readAutopilotPolicy(input.storeRoot).enabled) {
      input.stderr("autopilot is off — enable with: mega brain autopilot on");
      return 1;
    }
  }

  try {
    const { registry, initialized } = await input.ensureStore();
    if (initialized) input.stderr(`note: initialized store at ${input.storeRoot}`);
    const session = registry.getSession(sessionId);
    if (!session) {
      const cli = sessionNotFoundMessage(sessionId);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    if (input.projectName !== undefined) {
      const project = registry.listProjects().find((p) => p.name === input.projectName);
      if (!project) {
        const cli = projectNotFoundMessage(input.projectName);
        input.stderr(cli.message);
        return cli.exitCode;
      }
      if (project.id !== session.projectId) {
        input.stderr(`session ${sessionId} does not belong to project "${input.projectName}"`);
        return 1;
      }
    }

    const policy = readAutopilotPolicy(input.storeRoot);
    const result = await runAutopilot({
      registry,
      projectId: session.projectId,
      sessionId,
      policy,
      now: new Date(input.now()).toISOString(),
      newId: input.newId ?? (() => randomUUID()),
      dryRun: input.dryRunFlag,
    });

    if (input.dryRunFlag) input.stderr("DRY RUN — nothing written");
    if (input.jsonFlag) {
      input.stdout(JSON.stringify(result));
      return 0;
    }
    input.stdout(
      `auto-approved ${result.autoApproved.length} · staged ${result.staged.length} · skipped ${result.skippedExisting} (already captured) · capped ${result.cappedOut}`,
    );
    for (const entry of result.autoApproved) {
      input.stdout(`auto-approved ${entry.id} ${entry.type} ${entry.title}`);
    }
    for (const entry of result.staged) {
      input.stdout(`staged ${entry.id} ${entry.type} ${entry.title}`);
    }
    if (result.cappedOut > 0) {
      input.stdout(
        `notice: ${result.cappedOut} more qualified — raise --max-per-session or approve in digest`,
      );
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

const autopilotStatusCommand = defineCommand({
  meta: { name: "status", description: "Show the autopilot policy and pending queue size." },
  args: {
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeRoot = resolveStorePath(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    const code = await runAutopilotStatus({
      storeRoot,
      ensureStore: () => ensureStoreReady(storeRoot),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});

const autopilotOnCommand = defineCommand({
  meta: { name: "on", description: "Enable autopilot and set the auto-approve policy." },
  args: {
    "auto-approve-types": {
      type: "string",
      description: "Comma-separated memory types eligible for auto-approve.",
    },
    "max-per-session": {
      type: "string",
      description: "Max auto-approves per session run (positive integer).",
    },
    store: { type: "string", description: "Override store directory." },
  },
  run({ args }) {
    const storeRoot = resolveStorePath(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    const code = runAutopilotOn({
      storeRoot,
      typesFlag:
        typeof args["auto-approve-types"] === "string" ? args["auto-approve-types"] : undefined,
      maxFlag: typeof args["max-per-session"] === "string" ? args["max-per-session"] : undefined,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});

const autopilotOffCommand = defineCommand({
  meta: { name: "off", description: "Disable autopilot auto-approval." },
  args: {
    store: { type: "string", description: "Override store directory." },
  },
  run({ args }) {
    const storeRoot = resolveStorePath(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    const code = runAutopilotOff({
      storeRoot,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});

const autopilotRunCommand = defineCommand({
  meta: {
    name: "run",
    description:
      "Distill a session's failures into memories (Mega Saver Pro; --dry-run is free).",
  },
  args: {
    session: { type: "string", required: true, description: "Session id (UUID)." },
    project: {
      type: "string",
      description: "Project name guard — errors if the session belongs elsewhere.",
    },
    "dry-run": {
      type: "boolean",
      default: false,
      description: "Preview the approve/stage split without writing.",
    },
    json: { type: "boolean", default: false, description: "Emit the run result as JSON." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeRoot = resolveStorePath(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    const code = await runAutopilotRun({
      storeRoot,
      sessionId: typeof args.session === "string" ? args.session : "",
      projectName: typeof args.project === "string" ? args.project : undefined,
      dryRunFlag: args["dry-run"] === true,
      jsonFlag: args.json === true,
      now: () => Date.now(),
      ensureStore: () => ensureStoreReady(storeRoot),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});

export const brainAutopilotCommand = defineCommand({
  meta: {
    name: "autopilot",
    description: "Grow the brain automatically — policy toggle, status, and manual runs.",
  },
  subCommands: {
    status: autopilotStatusCommand,
    on: autopilotOnCommand,
    off: autopilotOffCommand,
    run: autopilotRunCommand,
  },
});
```

- [ ] **Step 5: Extend the brain/index.ts re-export block.** In
  `apps/cli/src/commands/brain/index.ts`, replace the autopilot re-export
  block added in Task 7 with:

```ts
export {
  AUTOPILOT_UPSELL,
  type RunAutopilotOffInput,
  type RunAutopilotOnInput,
  type RunAutopilotRunInput,
  type RunAutopilotStatusInput,
  brainAutopilotCommand,
  runAutopilotOff,
  runAutopilotOn,
  runAutopilotRun,
  runAutopilotStatus,
} from "./autopilot.js";
```

  Everything else in the file stays byte-identical to Task 7's version
  (the `subCommands` map already routes `autopilot` to
  `brainAutopilotCommand`, which now carries `run`).

- [ ] **Step 6: Verify GREEN — new suite plus the Task 7 suite (same file touched).**

```bash
pnpm build
pnpm --filter @megasaver/cli exec vitest run brain-autopilot-run brain-autopilot-policy
```

  All tests pass.

- [ ] **Step 7: Gates.**

```bash
pnpm lint:fix && pnpm typecheck
```

- [ ] **Step 8: Commit.**

```bash
git add apps/cli/src/commands/brain/autopilot.ts apps/cli/src/commands/brain/index.ts apps/cli/test/commands/brain-autopilot-run.test.ts && git commit -m "feat(cli): mega brain autopilot run"
```
# Section C — Digest (Tasks 9–10)

All commands run from the worktree root:
`/Users/halitozger/Desktop/MegaSaver/.claude/worktrees/brain-autopilot`
(branch `feat/brain-autopilot`).

**Environment hazards (apply to every task below):**

- Mega Saver MCP read-proxy SILENTLY COMPRESSES file reads over ~4000 bytes
  (banners "[Mega Saver: compressed ...]" / "… [N paragraphs]") and can
  REORDER lines — locate with `grep -n`, read with `sed -n 'A,Bp'` in
  chunks of <=40 lines. Re-read smaller on any banner. Never trust an
  elided read.
- `pnpm build` BEFORE running a package's tests (workspace deps resolve via
  `dist/`).
- Gates per commit: `pnpm lint:fix` then `pnpm typecheck` — TS4111
  (`noPropertyAccessFromIndexSignature`) only surfaces in the full
  typecheck. If it fires: bracket access +
  `// biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)`.
- tsconfig is `strict` with `exactOptionalPropertyTypes` — never assign an
  explicit `undefined` to an optional property; use conditional spreads
  (`...(x !== undefined ? { x } : {})`), exactly as the code below does.
- `noUncheckedIndexedAccess`: indexed reads (`queue[index]`, `arr[0]`) may
  be `undefined` — guard, exactly as the code below does.
- Branded IDs: raw UUID string literals in tests need `as ProjectId` /
  `as SessionId` / `as FailedAttempt` style casts; test fixtures below cast
  whole objects (`as MemoryEntry`) following the repo convention.
- CLI tests live in `apps/cli/test/` and seed stores by writing
  `projects.json` / `sessions.json` (JSON arrays) and
  `memory/<projectId>.jsonl` / `failed-attempts/<projectId>.jsonl` (JSONL)
  directly. Single-file run:
  `pnpm --filter @megasaver/cli exec vitest run <path-or-substring>`.
- citty single-word boolean args: `--no-<name>` sets `args.<name> = false`.
- TypeScript strict ESM — every relative import carries the `.js` suffix.

**Section prerequisites (built by earlier tasks, verified in Step 1 of each
task):** Task 1 `dedupeKeywordFor`/`DEDUPE_KEYWORD_PREFIX` (core), Task 2
`ExtractedCandidate.occurrences`, Task 3 `readDigestState`/`writeDigestState`
(core), Task 6 `RunMemoryApproveInput.approval` widened to
`"approved" | "rejected" | "suggested"` and `ProFeature` +=
`"brain-autopilot"`, Task 7 `autopilot` subcommand registered in
`apps/cli/src/commands/brain/index.ts`.

---

### Task 9: Digest keystroke loop (`digest-loop.ts`) — isolated raw-mode machine

The single-keystroke y/n/e/s/u/a/q sequencer, ISOLATED in one module with an
injected input stream so every behavior is testable without a real TTY
(spec §6.2, architect M5). Hard requirements baked in: raw mode enabled ONLY
when `isTTY`; cooked mode restored + `data`/signal listeners removed in a
`finally` AND on SIGINT/SIGTERM; the loop is paused (raw off, `data`
detached, stream paused) while the editor child owns the TTY (the `e`
action); single-level undo (a second `u` without an intervening decision
prints "nothing to undo"); raw-mode Ctrl-C arrives as byte `\u0003` (raw
mode suppresses signal generation) and aborts exactly like SIGINT; EOF on
the input stream resolves the loop — CI/pipes never hang. The loop is a dumb
sequencer: all store I/O lives in the Task 10 `onAction` handler. The loop
emits `{ kind: "quit" }` exactly once on `q` OR on queue exhaustion — and
NEVER on abort (SIGINT/SIGTERM/Ctrl-C byte/EOF), so Task 10's
digest-state write (which lives in the quit handler) is skipped on abort.

`DigestItem` / `DigestActionResult` shapes (contract left these to the
author; Task 10 MUST use these exact shapes):

```ts
export type DigestItem = {
  entry: MemoryEntry;
  sessionLabel: string;
  occurrencesNote?: string;
};
export type DigestActionResult = {
  lines: readonly string[];
  decided?: boolean; // approve/reject/edit actually flipped a row (undo target)
  insertItems?: readonly DigestItem[]; // expandAuto: spot-review rows spliced ahead
};
```

**Files:**

- Create: `apps/cli/src/commands/brain/digest-loop.ts`
- Create (test): `apps/cli/test/brain/digest-loop.test.ts`

**Steps:**

- [ ] **Step 1: Confirm the worktree and prerequisites.**
  `cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/brain-autopilot && git branch --show-current`
  must print `feat/brain-autopilot`. Then
  `grep -n 'export function formatMemorySearchLine' apps/cli/src/commands/memory/shared.ts`
  must hit (~line 94) — the loop reuses this exported renderer. If missing,
  stop and report.

- [ ] **Step 2: Write the failing test.** Create
  `apps/cli/test/brain/digest-loop.test.ts` with exactly:

```ts
import { PassThrough } from "node:stream";
import type { MemoryEntry } from "@megasaver/core";
import { describe, expect, it, vi } from "vitest";
import {
  type DigestAction,
  type DigestActionResult,
  type DigestItem,
  runDigestLoop,
} from "../../src/commands/brain/digest-loop.js";

const TS = "2026-07-01T00:00:00.000Z";
const ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ID_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function entry(id: string, title: string): MemoryEntry {
  return {
    id,
    projectId: "11111111-1111-4111-8111-111111111111",
    sessionId: "22222222-2222-4222-8222-222222222222",
    scope: "session",
    type: "bug",
    title,
    content: "content",
    keywords: [],
    confidence: "low",
    source: "test_failure",
    approval: "suggested",
    stale: false,
    createdAt: TS,
    updatedAt: TS,
  } as MemoryEntry;
}

function item(id: string, title: string): DigestItem {
  return { entry: entry(id, title), sessionLabel: "demo session" };
}

type FakeTty = PassThrough & { setRawMode: ReturnType<typeof vi.fn> };

function fakeInput(): FakeTty {
  const stream = new PassThrough() as FakeTty;
  stream.setRawMode = vi.fn();
  return stream;
}

function recorder(respond?: (action: DigestAction) => DigestActionResult) {
  const actions: DigestAction[] = [];
  const onAction = async (action: DigestAction): Promise<DigestActionResult> => {
    actions.push(action);
    return respond === undefined ? { lines: [] } : respond(action);
  };
  return { actions, onAction };
}

describe("runDigestLoop", () => {
  it("sequences y/n/s into approve/reject/skip and quits on exhaustion", async () => {
    const input = fakeInput();
    const out: string[] = [];
    const { actions, onAction } = recorder();
    const loop = runDigestLoop({
      input,
      output: (line) => out.push(line),
      isTTY: false,
      queue: [item(ID_A, "first"), item(ID_B, "second"), item(ID_C, "third")],
      onAction,
    });
    input.write("yns");
    await loop;
    expect(actions).toEqual([
      { kind: "approve", id: ID_A },
      { kind: "reject", id: ID_B },
      { kind: "skip", id: ID_C },
      { kind: "quit" },
    ]);
    expect(out.some((line) => line.includes("first"))).toBe(true);
  });

  it("q quits without draining the queue", async () => {
    const input = fakeInput();
    const { actions, onAction } = recorder();
    const loop = runDigestLoop({
      input,
      output: () => {},
      isTTY: false,
      queue: [item(ID_A, "first"), item(ID_B, "second")],
      onAction,
    });
    input.write("q");
    await loop;
    expect(actions).toEqual([{ kind: "quit" }]);
  });

  it("unknown key prints the key help and stays on the item", async () => {
    const input = fakeInput();
    const out: string[] = [];
    const { actions, onAction } = recorder();
    const loop = runDigestLoop({
      input,
      output: (line) => out.push(line),
      isTTY: false,
      queue: [item(ID_A, "first")],
      onAction,
    });
    input.write("xq");
    await loop;
    expect(actions).toEqual([{ kind: "quit" }]);
    expect(out.some((line) => line.startsWith("keys:"))).toBe(true);
  });

  it("u rewinds exactly one decision (single-level undo)", async () => {
    const input = fakeInput();
    const { actions, onAction } = recorder((action) =>
      action.kind === "approve" ? { lines: [], decided: true } : { lines: [] },
    );
    const loop = runDigestLoop({
      input,
      output: () => {},
      isTTY: false,
      queue: [item(ID_A, "first"), item(ID_B, "second")],
      onAction,
    });
    input.write("yuss");
    await loop;
    expect(actions).toEqual([
      { kind: "approve", id: ID_A },
      { kind: "undo" },
      { kind: "skip", id: ID_A },
      { kind: "skip", id: ID_B },
      { kind: "quit" },
    ]);
  });

  it("u with nothing to undo emits no undo action", async () => {
    const input = fakeInput();
    const out: string[] = [];
    const { actions, onAction } = recorder();
    const loop = runDigestLoop({
      input,
      output: (line) => out.push(line),
      isTTY: false,
      queue: [item(ID_A, "first")],
      onAction,
    });
    input.write("us");
    await loop;
    expect(actions).toEqual([{ kind: "skip", id: ID_A }, { kind: "quit" }]);
    expect(out).toContain("nothing to undo");
  });

  it("a splices spot-review items ahead of the remaining queue", async () => {
    const input = fakeInput();
    const auto = item(ID_C, "auto row");
    const { actions, onAction } = recorder((action) =>
      action.kind === "expandAuto"
        ? { lines: ["reviewing 1 auto-approved"], insertItems: [auto] }
        : { lines: [] },
    );
    const loop = runDigestLoop({
      input,
      output: () => {},
      isTTY: false,
      queue: [item(ID_A, "first")],
      onAction,
    });
    input.write("ans");
    await loop;
    expect(actions).toEqual([
      { kind: "expandAuto" },
      { kind: "reject", id: ID_C },
      { kind: "skip", id: ID_A },
      { kind: "quit" },
    ]);
  });

  it("EOF resolves the loop without emitting quit (pipes never hang)", async () => {
    const input = fakeInput();
    const { actions, onAction } = recorder();
    const loop = runDigestLoop({
      input,
      output: () => {},
      isTTY: false,
      queue: [item(ID_A, "first")],
      onAction,
    });
    input.end();
    await loop;
    expect(actions).toEqual([]);
  });

  it("never enables raw mode when isTTY is false", async () => {
    const input = fakeInput();
    const { onAction } = recorder();
    const loop = runDigestLoop({
      input,
      output: () => {},
      isTTY: false,
      queue: [item(ID_A, "first")],
      onAction,
    });
    input.write("q");
    await loop;
    expect(input.setRawMode).not.toHaveBeenCalled();
  });

  it("TTY: raw mode on for the loop, cooked restored, listeners removed", async () => {
    const input = fakeInput();
    const { onAction } = recorder();
    const loop = runDigestLoop({
      input,
      output: () => {},
      isTTY: true,
      queue: [item(ID_A, "first")],
      onAction,
    });
    input.write("q");
    await loop;
    expect(input.setRawMode.mock.calls).toEqual([[true], [false]]);
    expect(input.listenerCount("data")).toBe(0);
    expect(input.listenerCount("end")).toBe(0);
  });

  it("SIGINT restores cooked mode, removes listeners, resolves without quit", async () => {
    const input = fakeInput();
    const { actions, onAction } = recorder();
    const before = process.listeners("SIGINT").length;
    const loop = runDigestLoop({
      input,
      output: () => {},
      isTTY: true,
      queue: [item(ID_A, "first")],
      onAction,
    });
    await new Promise((resolve) => setImmediate(resolve));
    const handlers = process.listeners("SIGINT");
    expect(handlers.length).toBe(before + 1);
    (handlers.at(-1) as () => void)();
    await loop;
    expect(process.listeners("SIGINT").length).toBe(before);
    expect(input.setRawMode.mock.calls.at(-1)).toEqual([false]);
    expect(input.listenerCount("data")).toBe(0);
    expect(actions).toEqual([]);
  });

  it("raw-mode Ctrl-C byte (\\u0003) aborts like a signal", async () => {
    const input = fakeInput();
    const { actions, onAction } = recorder();
    const loop = runDigestLoop({
      input,
      output: () => {},
      isTTY: true,
      queue: [item(ID_A, "first")],
      onAction,
    });
    input.write("\u0003");
    await loop;
    expect(actions).toEqual([]);
    expect(input.setRawMode.mock.calls.at(-1)).toEqual([false]);
  });

  it("e pauses raw mode and detaches the loop while the editor owns the TTY", async () => {
    const input = fakeInput();
    const rawDuringEdit: unknown[] = [];
    const dataListenersDuringEdit: number[] = [];
    const onAction = async (action: DigestAction): Promise<DigestActionResult> => {
      if (action.kind === "edit") {
        rawDuringEdit.push(input.setRawMode.mock.calls.at(-1)?.[0]);
        dataListenersDuringEdit.push(input.listenerCount("data"));
        return { lines: ["$EDITOR is not set — skipped"] };
      }
      return { lines: [] };
    };
    const loop = runDigestLoop({
      input,
      output: () => {},
      isTTY: true,
      queue: [item(ID_A, "first")],
      onAction,
    });
    input.write("e");
    await loop;
    expect(rawDuringEdit).toEqual([false]);
    expect(dataListenersDuringEdit).toEqual([0]);
    expect(input.setRawMode.mock.calls).toEqual([[true], [false], [true], [false]]);
  });
});
```

- [ ] **Step 3: Run to verify FAIL.**
  `pnpm build && pnpm --filter @megasaver/cli exec vitest run test/brain/digest-loop.test.ts`
  Expected failure: the module does not exist —
  `Failed to resolve import "../../src/commands/brain/digest-loop.js"`
  (or `Cannot find module`). Any OTHER failure: stop and investigate.

- [ ] **Step 4: Minimal implementation.** Create
  `apps/cli/src/commands/brain/digest-loop.ts` with exactly:

```ts
import type { MemoryEntry } from "@megasaver/core";
import type { MemoryEntryId } from "@megasaver/shared";
import { formatMemorySearchLine } from "../memory/shared.js";

export type DigestItem = {
  entry: MemoryEntry;
  sessionLabel: string;
  occurrencesNote?: string;
};

export type DigestAction =
  | { kind: "approve"; id: MemoryEntryId }
  | { kind: "reject"; id: MemoryEntryId }
  | { kind: "edit"; id: MemoryEntryId }
  | { kind: "skip"; id: MemoryEntryId }
  | { kind: "undo" }
  | { kind: "expandAuto" }
  | { kind: "quit" };

export type DigestActionResult = {
  lines: readonly string[];
  // approve/reject/edit actually flipped a row — it becomes the single-level
  // undo target. Absent/false (skip, no-op, edit-abort) leaves undo untouched.
  decided?: boolean;
  // expandAuto: spot-review rows spliced in ahead of the remaining queue.
  insertItems?: readonly DigestItem[];
};

const KEY_HELP =
  "keys: y approve · n reject · e edit · s skip · u undo · a auto-approved · q quit";
// Raw mode suppresses signal generation: Ctrl-C arrives as this byte and must
// abort exactly like SIGINT (architect M5 — never leave the shell in raw mode).
const CTRL_C = "\u0003";

type RawModeStream = NodeJS.ReadableStream & {
  setRawMode?: (mode: boolean) => void;
};

function renderItem(item: DigestItem): string {
  const note = item.occurrencesNote === undefined ? "" : `  ·  ${item.occurrencesNote}`;
  return `${item.sessionLabel}  ${formatMemorySearchLine({
    id: item.entry.id,
    type: item.entry.type,
    confidence: item.entry.confidence,
    title: item.entry.title,
  })}${note}`;
}

// The isolated keystroke machine (spec §6.2, architect M5). A dumb sequencer:
// all store I/O lives in the injected onAction handler. Emits `quit` exactly
// once — on `q` or queue exhaustion — and never on abort (SIGINT/SIGTERM/
// Ctrl-C byte/EOF), so the caller's digest-state write is skipped on abort.
export async function runDigestLoop(opts: {
  input: NodeJS.ReadableStream;
  output: (line: string) => void;
  isTTY: boolean;
  queue: readonly DigestItem[];
  onAction: (action: DigestAction) => Promise<DigestActionResult>;
}): Promise<void> {
  const { input, output, isTTY, onAction } = opts;
  const queue = [...opts.queue];
  const stream = input as RawModeStream;
  const setRaw = (mode: boolean): void => {
    if (isTTY && typeof stream.setRawMode === "function") stream.setRawMode(mode);
  };

  const buffered: string[] = [];
  let pending: ((key: string | null) => void) | null = null;
  let closed = false;
  const deliver = (key: string | null): void => {
    if (pending === null) {
      if (key !== null) buffered.push(key);
      return;
    }
    const resolve = pending;
    pending = null;
    resolve(key);
  };
  const onData = (chunk: Buffer | string): void => {
    for (const key of chunk.toString()) deliver(key);
  };
  const onEnd = (): void => {
    closed = true;
    deliver(null);
  };
  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    setRaw(false);
    input.off("data", onData);
    input.off("end", onEnd);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  };
  const onSignal = (): void => {
    closed = true;
    cleanup();
    deliver(null);
  };
  const nextKey = (): Promise<string | null> => {
    const key = buffered.shift();
    if (key !== undefined) return Promise.resolve(key);
    if (closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      pending = resolve;
    });
  };
  const emit = async (action: DigestAction): Promise<DigestActionResult> => {
    const result = await onAction(action);
    for (const line of result.lines) output(line);
    return result;
  };

  input.on("data", onData);
  input.on("end", onEnd);
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  setRaw(true);

  let index = 0;
  let lastDecisionIndex: number | null = null;
  try {
    while (index < queue.length) {
      const item = queue[index];
      if (item === undefined) break;
      output(renderItem(item));
      const key = await nextKey();
      if (key === null || key === CTRL_C) return; // abort: no quit action
      if (key === "y" || key === "n" || key === "s") {
        const kind = key === "y" ? "approve" : key === "n" ? "reject" : "skip";
        const result = await emit({ kind, id: item.entry.id });
        if (result.decided === true) lastDecisionIndex = index;
        index += 1;
      } else if (key === "e") {
        // The editor child owns the TTY: cooked mode, loop detached and
        // paused until the handler (which spawns the editor) returns.
        setRaw(false);
        input.off("data", onData);
        input.pause();
        const result = await emit({ kind: "edit", id: item.entry.id });
        input.on("data", onData);
        input.resume();
        setRaw(true);
        if (result.decided === true) lastDecisionIndex = index;
        index += 1;
      } else if (key === "u") {
        if (lastDecisionIndex === null) {
          output("nothing to undo");
        } else {
          await emit({ kind: "undo" });
          index = lastDecisionIndex;
          lastDecisionIndex = null;
        }
      } else if (key === "a") {
        const result = await emit({ kind: "expandAuto" });
        if (result.insertItems !== undefined && result.insertItems.length > 0) {
          queue.splice(index, 0, ...result.insertItems);
        }
      } else if (key === "q") {
        await emit({ kind: "quit" });
        return;
      } else {
        output(KEY_HELP);
      }
    }
    // CORRECTED post-review (was `if (!closed) await emit(...)`). The guard was a
    // BLOCKER: with a handler doing real disk I/O — which is exactly what Task 10's
    // quit handler does (writeDigestState) — `closed` is always true here, so quit
    // fired 0/10 runs and lastDigestAt never persisted on piped runs. A torn write:
    // the per-key handlers already applied the approvals, so only the bookkeeping
    // was lost and the next digest re-nudged an already-triaged backlog.
    // It was also semantically wrong: this line is only reachable on a fully drained
    // queue (EOF-mid-queue returns earlier at `key === null`), so it suppressed quit
    // exactly when the digest COMPLETED. For a pipe, "input closed" is always true.
    await emit({ kind: "quit" });
  } finally {
    cleanup();
  }
}
```

  Implementation notes (do not skip):
  - `cleanup` is idempotent (`cleaned` guard) because it runs on the signal
    path AND in `finally`.
  - `onSignal` is referenced by `cleanup` before its declaration — both are
    `const` arrow functions in the same scope; declaration order above
    (cleanup first, onSignal second) is fine because `cleanup` only CALLS
    `process.off(..., onSignal)` at runtime, after both exist. Keep the
    order exactly as written.
  - `lastDecisionIndex` is always `< index` when set, and `a` splices at
    `index`, so a later undo never lands on a shifted position.

- [ ] **Step 5: Run to verify PASS.**
  `pnpm build && pnpm --filter @megasaver/cli exec vitest run test/brain/digest-loop.test.ts`
  Expected: 12 tests pass, 0 fail.

- [ ] **Step 6: Whole-package regression.**
  `pnpm --filter @megasaver/cli test`
  Expected: all green (this task adds a new module; nothing existing is
  touched).

- [ ] **Step 7: Gates.**
  `pnpm lint:fix && pnpm typecheck`
  Both must exit 0. If TS4111 fires on `process.env` style access, apply the
  bracket-access + biome-ignore pattern from the hazards block.

- [ ] **Step 8: Commit.**

```bash
git add apps/cli/src/commands/brain/digest-loop.ts apps/cli/test/brain/digest-loop.test.ts
git commit -m "feat(cli): digest keystroke loop, raw-mode safe" -m "Isolated y/n/e/s/u/a/q machine with injected input stream (architect M5): raw mode only on a TTY, cooked-mode restore + listener removal in finally and on SIGINT/SIGTERM, loop paused while an editor owns the TTY, single-level undo, quit never emitted on abort."
```

---

### Task 10: `mega brain digest` command (PRO) + `applyApprovalFlip` extraction + registration

The CLI skin over the Task 9 loop (spec §6.2). PRO gate FIRST
(`checkEntitlement("brain-autopilot", ...)` — unentitled prints
`DIGEST_UPSELL` to stdout, exit 0, zero store work). Queue = ALL
`approval === "suggested"` rows of the project resolved BY NAME (positional
`projectName`, `listProjects().find` — the sibling brain-command idiom; no
cwd resolution exists in this CLI), grouped by session newest-first
(stable-sorted on `Session.startedAt` descending) then project-scope rows
last; `--limit N` (default 50) caps rendered rows with a
`showing N of M pending suggested` header. Rows approved by autopilot since
`lastDigestAt` (evidence[0] prefix `autopilot@1`, `createdAt` after
`lastDigestAt`; `lastDigestAt: null` matches all) render as ONE collapsed
`N auto-approved while you were away — press a to review` line; `a` expands
them as spot-review items where `y` keeps (no-op flip) and `n` REVOKES to
`suggested` (not rejected). Approve/reject/undo route through the SAME
approval flip `runMemoryApprove` uses — but `runMemoryApprove`'s signature
forces per-call `resolveStorePath` + `ensureStoreReady` (verified in
`approve.ts:26-40`), which violates architect m9 (registry opened ONCE, no
per-keystroke store re-resolution). Resolution, per the contract's escape
hatch: extract the flip into an exported `applyApprovalFlip(registry,
existing, approval, updatedAt)` helper in `approve.ts`, rewire
`runMemoryApprove` through it byte-identically, and have the digest call the
helper against its once-opened registry with CAPTURED stdout/stderr sinks.
Undo after an approve that closed a predecessor renders
`predecessor <id> stays closed — mega memory reopen <id>`. `e` opens
`$EDITOR` (injectable `spawnEditor` for tests; `$EDITOR` unset ⇒ message +
skip; editor non-zero ⇒ approve aborted, row stays suggested). Empty queue:
`Nothing to triage — 0 failures recorded since <lastDigestAt|ever>.` Quit
(or queue exhaustion) writes `digest-state.json` via `writeDigestState`;
abort (Ctrl-C) does not (Task 9 loop never emits quit on abort). `--json`
prints the pending queue as JSON, exit 0, READ-ONLY (no state write). Plain
non-TTY (`process.stdout.isTTY` falsy): numbered rows + a
`mega memory approve/reject <id>` hint, read-only, no raw mode, no hang.
`occurrencesNote` ("seen N× this session") is recomputed for display by
re-running `extractSessionMemories` over each visible session's failures and
joining on the `dedupeKeywordFor(dedupeKey)` keyword ledger (occurrences is
not persisted on MemoryEntry).

Depends on: Task 3 (`readDigestState`/`writeDigestState` exported from
core), Task 6 (widened approval union — `applyApprovalFlip` admits
`"suggested"`), Task 1 (`dedupeKeywordFor`), Task 2 (`occurrences`).

**Files:**

- Modify: `apps/cli/src/commands/memory/approve.ts` (extract
  `applyApprovalFlip`; behavior byte-identical)
- Create: `apps/cli/src/commands/brain/digest.ts`
- Modify: `apps/cli/src/commands/brain/index.ts` (register `digest`)
- Create (test): `apps/cli/test/brain/digest.test.ts`

**Steps:**

- [ ] **Step 1: Confirm prerequisites (chunked reads, no proxy).**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/brain-autopilot
grep -n '"approved" | "rejected" | "suggested"' apps/cli/src/commands/memory/approve.ts
grep -n 'readDigestState\|writeDigestState' packages/core/src/index.ts
grep -n 'dedupeKeywordFor' packages/core/src/index.ts
grep -n 'occurrences' packages/core/src/session-memory.ts
grep -n '"brain-autopilot"' packages/entitlement/src/entitlement.ts
grep -n 'autopilot' apps/cli/src/commands/brain/index.ts
```

  Every grep must hit (Tasks 1/2/3/6/7 landed). If any is missing, stop and
  report — this task builds on them. Also confirm the flip block to be
  extracted is unchanged:
  `sed -n '55,85p' apps/cli/src/commands/memory/approve.ts` must show the
  no-op guard, the `MEGA_TEST_NOW` read, `registry.updateMemoryEntry`, and
  the `applySupersession` branch as quoted in Step 4's `old_string`.

- [ ] **Step 2: Write the failing test.** Create
  `apps/cli/test/brain/digest.test.ts` with exactly:

```ts
import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { type FailedAttempt, dedupeKeywordFor, extractSessionMemories } from "@megasaver/core";
import { activateLicense } from "@megasaver/entitlement";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { brainCommand } from "../../src/commands/brain/index.js";
import { DIGEST_UPSELL, runBrainDigest } from "../../src/commands/brain/digest.js";
import { ensureStoreReady } from "../../src/store.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_A = "22222222-2222-4222-8222-222222222222"; // older
const SESSION_B = "44444444-4444-4444-8444-444444444444"; // newer
const MEM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEM_AUTO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MEM_PRED = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const FA_1 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const FA_2 = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const TS_OLD = "2026-07-01T00:00:00.000Z";
const TS_NEW = "2026-07-10T00:00:00.000Z";
const NOW = "2026-07-14T00:00:00.000Z";

type LicensePayload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
  payload: LicensePayload,
): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

let store: string;
let out: string[];
let err: string[];
let proPublicKey: KeyObject | undefined;

function activatePro(): void {
  const keys = generateKeyPairSync("ed25519");
  const key = signTestLicense(keys.privateKey, { v: 1, tier: "pro", id: "t1", iat: 0, exp: null });
  activateLicense(store, key, { publicKey: keys.publicKey, now: () => Date.parse(NOW) });
  proPublicKey = keys.publicKey;
}

function memoryRow(id: string, sessionId: string | null, over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id,
    projectId: PROJECT_ID,
    sessionId,
    scope: sessionId === null ? "project" : "session",
    type: "bug",
    title: `title ${id.slice(0, 8)}`,
    content: "content",
    keywords: [],
    confidence: "low",
    source: "test_failure",
    approval: "suggested",
    stale: false,
    createdAt: TS_OLD,
    updatedAt: TS_OLD,
    ...over,
  });
}

function failureRow(id: string, sessionId: string): string {
  return JSON.stringify({
    id,
    projectId: PROJECT_ID,
    sessionId,
    task: "fix login",
    failedStep: "run auth tests",
    errorOutput: "boom 401",
    relatedFiles: [],
    convertedToRule: false,
    createdAt: TS_OLD,
  });
}

async function seed(memoryRows: string[], failureRows: string[] = []): Promise<void> {
  await mkdir(join(store, "memory"), { recursive: true });
  await writeFile(
    join(store, "projects.json"),
    JSON.stringify([
      { id: PROJECT_ID, name: "demo", rootPath: "/tmp", createdAt: TS_OLD, updatedAt: TS_OLD },
    ]),
  );
  await writeFile(
    join(store, "sessions.json"),
    JSON.stringify([
      {
        id: SESSION_A,
        projectId: PROJECT_ID,
        agentId: "claude-code",
        riskLevel: "medium",
        title: "older session",
        startedAt: TS_OLD,
        endedAt: null,
      },
      {
        id: SESSION_B,
        projectId: PROJECT_ID,
        agentId: "claude-code",
        riskLevel: "medium",
        title: "newer session",
        startedAt: TS_NEW,
        endedAt: null,
      },
    ]),
  );
  if (memoryRows.length > 0) {
    await writeFile(join(store, "memory", `${PROJECT_ID}.jsonl`), `${memoryRows.join("\n")}\n`);
  }
  if (failureRows.length > 0) {
    await mkdir(join(store, "failed-attempts"), { recursive: true });
    await writeFile(
      join(store, "failed-attempts", `${PROJECT_ID}.jsonl`),
      `${failureRows.join("\n")}\n`,
    );
  }
}

type StoredRow = {
  id: string;
  approval: string;
  title: string;
  content: string;
  validTo?: string | null;
};

async function readRows(): Promise<StoredRow[]> {
  const raw = await readFile(join(store, "memory", `${PROJECT_ID}.jsonl`), "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as StoredRow);
}

type FakeTty = PassThrough & { setRawMode: ReturnType<typeof vi.fn> };

function fakeStdin(): FakeTty {
  const stream = new PassThrough() as FakeTty;
  stream.setRawMode = vi.fn();
  return stream;
}

function digestInput(
  over: Partial<Parameters<typeof runBrainDigest>[0]> = {},
): Parameters<typeof runBrainDigest>[0] {
  return {
    storeRoot: store,
    projectName: "demo",
    limitFlag: undefined,
    json: false,
    now: () => NOW,
    nowMs: () => Date.parse(NOW),
    ensureStore: () => ensureStoreReady(store),
    isTTY: false,
    stdin: fakeStdin(),
    editor: undefined,
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => err.push(line),
    ...(proPublicKey === undefined ? {} : { publicKey: proPublicKey }),
    ...over,
  };
}

beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "mega-cli-brain-digest-"));
  out = [];
  err = [];
  proPublicKey = undefined;
});

afterEach(async () => {
  await rm(store, { recursive: true, force: true });
});

describe("mega brain digest", () => {
  it("is registered as a brain subcommand", () => {
    expect(Object.keys(brainCommand.subCommands ?? {})).toContain("digest");
  });

  it("free tier: prints the upsell, exits 0, touches nothing", async () => {
    await seed([memoryRow(MEM_A, SESSION_B)]);
    const code = await runBrainDigest(digestInput());
    expect(code).toBe(0);
    expect(out).toContain(DIGEST_UPSELL);
    expect(existsSync(join(store, "digest-state.json"))).toBe(false);
    expect((await readRows()).find((r) => r.id === MEM_A)?.approval).toBe("suggested");
  });

  it("--json prints the queue newest-session-first, read-only", async () => {
    await seed([memoryRow(MEM_B, SESSION_A), memoryRow(MEM_A, SESSION_B)]);
    activatePro();
    const code = await runBrainDigest(digestInput({ json: true }));
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("")) as {
      total: number;
      showing: number;
      pending: Array<{ id: string }>;
    };
    expect(parsed.total).toBe(2);
    expect(parsed.showing).toBe(2);
    expect(parsed.pending.map((p) => p.id)).toEqual([MEM_A, MEM_B]);
    expect(existsSync(join(store, "digest-state.json"))).toBe(false);
  });

  it("non-TTY: numbered fallback with approve/reject hint, no raw mode", async () => {
    await seed([memoryRow(MEM_A, SESSION_B)]);
    activatePro();
    const stdin = fakeStdin();
    const code = await runBrainDigest(digestInput({ stdin }));
    expect(code).toBe(0);
    expect(stdin.setRawMode).not.toHaveBeenCalled();
    expect(out.some((l) => l.startsWith("1. ") && l.includes(MEM_A))).toBe(true);
    expect(out.some((l) => l.includes("mega memory approve"))).toBe(true);
    expect(existsSync(join(store, "digest-state.json"))).toBe(false);
  });

  it("--limit caps rows and the header reports showing N of M", async () => {
    await seed([memoryRow(MEM_A, SESSION_B), memoryRow(MEM_B, SESSION_B)]);
    activatePro();
    const code = await runBrainDigest(digestInput({ limitFlag: "1" }));
    expect(code).toBe(0);
    expect(out.some((l) => l.includes("showing 1 of 2"))).toBe(true);
    expect(out.filter((l) => /^\d+\. /.test(l))).toHaveLength(1);
  });

  it("invalid --limit exits 1 before any store work", async () => {
    await seed([memoryRow(MEM_A, SESSION_B)]);
    activatePro();
    const code = await runBrainDigest(digestInput({ limitFlag: "0" }));
    expect(code).toBe(1);
    expect(err.some((l) => l.includes("invalid --limit"))).toBe(true);
  });

  it("unknown project exits 1", async () => {
    await seed([memoryRow(MEM_A, SESSION_B)]);
    activatePro();
    const code = await runBrainDigest(digestInput({ projectName: "nope" }));
    expect(code).toBe(1);
    expect(err.join("\n").length).toBeGreaterThan(0);
  });

  it("interactive: y approves, n rejects, quit writes digest-state", async () => {
    await seed([memoryRow(MEM_A, SESSION_B), memoryRow(MEM_B, SESSION_A)]);
    activatePro();
    const stdin = fakeStdin();
    const loop = runBrainDigest(digestInput({ isTTY: true, stdin }));
    stdin.write("yn");
    const code = await loop;
    expect(code).toBe(0);
    const rows = await readRows();
    expect(rows.find((r) => r.id === MEM_A)?.approval).toBe("approved");
    expect(rows.find((r) => r.id === MEM_B)?.approval).toBe("rejected");
    const state = JSON.parse(await readFile(join(store, "digest-state.json"), "utf8")) as {
      lastDigestAt: string;
    };
    expect(state.lastDigestAt).toBe(NOW);
  });

  it("interactive: u flips the last decision back to suggested", async () => {
    await seed([memoryRow(MEM_A, SESSION_B)]);
    activatePro();
    const stdin = fakeStdin();
    const loop = runBrainDigest(digestInput({ isTTY: true, stdin }));
    stdin.write("yus");
    const code = await loop;
    expect(code).toBe(0);
    expect((await readRows()).find((r) => r.id === MEM_A)?.approval).toBe("suggested");
    expect(out.some((l) => l.includes(`undid — ${MEM_A} back to suggested`))).toBe(true);
  });

  it("undo after a supersession close renders the reopen hint; predecessor stays closed", async () => {
    await seed([
      memoryRow(MEM_PRED, SESSION_B, { approval: "approved" }),
      memoryRow(MEM_A, SESSION_B, { supersedesId: MEM_PRED }),
    ]);
    activatePro();
    const stdin = fakeStdin();
    const loop = runBrainDigest(digestInput({ isTTY: true, stdin }));
    stdin.write("yus");
    const code = await loop;
    expect(code).toBe(0);
    expect(
      out.some((l) =>
        l.includes(`predecessor ${MEM_PRED} stays closed — mega memory reopen ${MEM_PRED}`),
      ),
    ).toBe(true);
    const pred = (await readRows()).find((r) => r.id === MEM_PRED);
    expect(pred?.validTo).toBe(NOW);
  });

  it("collapsed auto-approved line; a expands; n revokes to suggested", async () => {
    await seed([
      memoryRow(MEM_A, SESSION_B),
      memoryRow(MEM_AUTO, SESSION_B, {
        approval: "approved",
        confidence: "high",
        evidence: [`autopilot@1 rule=recurring-failure session=${SESSION_B}`],
        createdAt: TS_NEW,
        updatedAt: TS_NEW,
      }),
    ]);
    activatePro();
    const stdin = fakeStdin();
    const loop = runBrainDigest(digestInput({ isTTY: true, stdin }));
    stdin.write("ans");
    const code = await loop;
    expect(code).toBe(0);
    expect(out.some((l) => l.includes("1 auto-approved while you were away"))).toBe(true);
    expect((await readRows()).find((r) => r.id === MEM_AUTO)?.approval).toBe("suggested");
    expect((await readRows()).find((r) => r.id === MEM_A)?.approval).toBe("suggested");
  });

  it("empty queue prints the honest empty line and stamps state on a TTY", async () => {
    await seed([]);
    activatePro();
    const code = await runBrainDigest(digestInput({ isTTY: true }));
    expect(code).toBe(0);
    expect(out).toContain("Nothing to triage — 0 failures recorded since ever.");
    expect(existsSync(join(store, "digest-state.json"))).toBe(true);
  });

  it("e with $EDITOR unset skips the row (stays suggested)", async () => {
    await seed([memoryRow(MEM_A, SESSION_B)]);
    activatePro();
    const stdin = fakeStdin();
    const loop = runBrainDigest(digestInput({ isTTY: true, stdin, editor: undefined }));
    stdin.write("e");
    const code = await loop;
    expect(code).toBe(0);
    expect(out.some((l) => l.includes("$EDITOR is not set — skipped"))).toBe(true);
    expect((await readRows()).find((r) => r.id === MEM_A)?.approval).toBe("suggested");
  });

  it("editor non-zero exit aborts the approve (stays suggested)", async () => {
    await seed([memoryRow(MEM_A, SESSION_B)]);
    activatePro();
    const stdin = fakeStdin();
    const loop = runBrainDigest(
      digestInput({ isTTY: true, stdin, editor: "vi", spawnEditor: () => ({ status: 1 }) }),
    );
    stdin.write("e");
    const code = await loop;
    expect(code).toBe(0);
    expect(out.some((l) => l.includes("approve aborted"))).toBe(true);
    expect((await readRows()).find((r) => r.id === MEM_A)?.approval).toBe("suggested");
  });

  it("editor success rewrites title/content then approves", async () => {
    await seed([memoryRow(MEM_A, SESSION_B)]);
    activatePro();
    const stdin = fakeStdin();
    const spawnEditor = (_editor: string, path: string): { status: number | null } => {
      writeFileSync(path, "Edited title\n\nEdited content\n");
      return { status: 0 };
    };
    const loop = runBrainDigest(digestInput({ isTTY: true, stdin, editor: "vi", spawnEditor }));
    stdin.write("e");
    const code = await loop;
    expect(code).toBe(0);
    const row = (await readRows()).find((r) => r.id === MEM_A);
    expect(row?.approval).toBe("approved");
    expect(row?.title).toBe("Edited title");
    expect(row?.content).toBe("Edited content");
  });

  it("renders 'seen N× this session' for collapsed repeat failures", async () => {
    const failures = [failureRow(FA_1, SESSION_B), failureRow(FA_2, SESSION_B)];
    const candidates = extractSessionMemories({
      sessionId: SESSION_B as SessionId,
      projectId: PROJECT_ID as ProjectId,
      failedAttempts: failures.map((row) => JSON.parse(row) as FailedAttempt),
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.occurrences).toBe(2);
    const keyword = dedupeKeywordFor(candidates[0]?.dedupeKey ?? "");
    await seed([memoryRow(MEM_A, SESSION_B, { keywords: [keyword] })], failures);
    activatePro();
    const code = await runBrainDigest(digestInput());
    expect(code).toBe(0);
    expect(out.some((l) => l.includes("seen 2× this session"))).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify FAIL.**
  `pnpm build && pnpm --filter @megasaver/cli exec vitest run test/brain/digest.test.ts`
  Expected failure: `Failed to resolve import "../../src/commands/brain/digest.js"`
  (or `Cannot find module`). Any OTHER failure: stop and investigate.

- [ ] **Step 4: Extract `applyApprovalFlip` in
  `apps/cli/src/commands/memory/approve.ts`** (three surgical edits;
  behavior byte-identical — the widened `"suggested"` union from Task 6 is
  already on `RunMemoryApproveInput.approval` and is NOT touched here).

  Edit 1 — imports. Replace:

```ts
import { type MemoryEntryUpdatePatch, applySupersession } from "@megasaver/core";
```

  with:

```ts
import {
  type CoreRegistry,
  type MemoryEntry,
  type MemoryEntryUpdatePatch,
  applySupersession,
} from "@megasaver/core";
import type { MemoryEntryId } from "@megasaver/shared";
```

  Edit 2 — insert the helper immediately BEFORE the line
  `export async function runMemoryApprove(input: RunMemoryApproveInput): Promise<0 | 1> {`:

```ts
export type ApprovalFlipOutcome = {
  entry: MemoryEntry;
  changed: boolean;
  closedPredecessor?: { id: MemoryEntryId; title: string };
};

// The core approval flip shared by approve/reject and `mega brain digest`
// (architect m9: the digest opens the registry ONCE and must not re-resolve
// the store per keystroke — runMemoryApprove's signature forces per-call
// resolveStorePath + ensureStoreReady, so the flip is extracted instead).
// Byte-identical behavior: no-op guard, approval patch, supersession close
// only on the approved flip.
export function applyApprovalFlip(
  registry: CoreRegistry,
  existing: MemoryEntry,
  approval: "approved" | "rejected" | "suggested",
  updatedAt: string,
): ApprovalFlipOutcome {
  if (existing.approval === approval) return { entry: existing, changed: false };
  const patch: MemoryEntryUpdatePatch = { approval, updatedAt };
  const updated = registry.updateMemoryEntry(existing.id, patch);
  if (approval === "approved") {
    const result = applySupersession(registry, updated, () => updatedAt);
    if (result.closed && result.superseded) {
      return { entry: updated, changed: true, closedPredecessor: result.superseded };
    }
  }
  return { entry: updated, changed: true };
}
```

  Edit 3 — rewire the body. Inside `runMemoryApprove`'s `try` block,
  replace:

```ts
    // True no-op: re-approving an already-approved memory must not churn updatedAt.
    if (existing.approval === input.approval) {
      input.stdout(input.jsonFlag ? JSON.stringify(existing) : existing.id);
      return 0;
    }
    const updatedAt = readTestEnv("MEGA_TEST_NOW") ?? now();
    const patch: MemoryEntryUpdatePatch = { approval: input.approval, updatedAt };
    const updated = registry.updateMemoryEntry(parsedId, patch);
    if (input.approval === "approved") {
      const result = applySupersession(registry, updated, () => updatedAt);
      if (result.closed && result.superseded) {
        input.stderr(
          `note: this approval closed ${result.superseded.id} ("${result.superseded.title}") — undo: mega memory reopen ${result.superseded.id}`,
        );
      }
    }
    input.stdout(input.jsonFlag ? JSON.stringify(updated) : updated.id);
    return 0;
```

  with:

```ts
    const updatedAt = readTestEnv("MEGA_TEST_NOW") ?? now();
    const flip = applyApprovalFlip(registry, existing, input.approval, updatedAt);
    if (flip.closedPredecessor !== undefined) {
      input.stderr(
        `note: this approval closed ${flip.closedPredecessor.id} ("${flip.closedPredecessor.title}") — undo: mega memory reopen ${flip.closedPredecessor.id}`,
      );
    }
    input.stdout(input.jsonFlag ? JSON.stringify(flip.entry) : flip.entry.id);
    return 0;
```

  (The no-op guard moved INTO the helper: `changed: false` returns the
  existing row, which prints identically and never churns `updatedAt`.
  `updatedAt` is now computed before the guard — `readTestEnv` and `now()`
  are side-effect-free, so behavior is unchanged.)

- [ ] **Step 5: Approve regression must stay green.**
  `pnpm build && pnpm --filter @megasaver/cli exec vitest run memory-approve approve-supersession`
  Expected: all existing approve/reject/supersession tests pass unchanged.
  If anything fails, the extraction is not byte-identical — fix before
  proceeding (systematic-debugging, no blind patching).

- [ ] **Step 6: Implement the command.** Create
  `apps/cli/src/commands/brain/digest.ts` with exactly:

```ts
import { spawnSync } from "node:child_process";
import type { KeyObject } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type MemoryEntry,
  dedupeKeywordFor,
  extractSessionMemories,
  readDigestState,
  writeDigestState,
} from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
import type { MemoryEntryId, SessionId } from "@megasaver/shared";
import { defineCommand } from "citty";
import { projectNotFoundMessage } from "../../errors.js";
import {
  type EnsureStoreReadyResult,
  ensureStoreReady,
  readStoreEnv,
  resolveStorePath,
} from "../../store.js";
import { applyApprovalFlip } from "../memory/approve.js";
import { formatMemorySearchLine } from "../memory/shared.js";
import { PRO_ANALYTICS_URL } from "../savings/index.js";
import {
  type DigestAction,
  type DigestActionResult,
  type DigestItem,
  runDigestLoop,
} from "./digest-loop.js";

export const DIGEST_UPSELL = `Brain digest is a Mega Saver Pro feature. Activate a key: mega license activate <key>. Learn more: ${PRO_ANALYTICS_URL}.`;

// Safety invariant §8.3: only autopilot writes this evidence prefix, so it is
// the auditable marker for "auto-approved while you were away".
const AUTOPILOT_EVIDENCE_PREFIX = "autopilot@1";
const DEFAULT_LIMIT = 50;

export type RunBrainDigestInput = {
  storeRoot: string;
  projectName: string;
  limitFlag: string | undefined;
  json: boolean;
  now: () => string;
  nowMs: () => number;
  publicKey?: KeyObject | string;
  ensureStore: () => Promise<EnsureStoreReadyResult>;
  isTTY: boolean;
  stdin: NodeJS.ReadableStream;
  editor: string | undefined;
  spawnEditor?: (editor: string, path: string) => { status: number | null };
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

function defaultSpawnEditor(editor: string, path: string): { status: number | null } {
  // $EDITOR may carry arguments ("code --wait"); mirror doctor-saver's
  // win32-shell vs `sh -c` split. stdio inherit hands the editor the TTY.
  const result =
    process.platform === "win32"
      ? spawnSync(`${editor} "${path}"`, { shell: true, stdio: "inherit" })
      : spawnSync("sh", ["-c", `${editor} "$0"`, path], { stdio: "inherit" });
  return { status: result.status };
}

export async function runBrainDigest(input: RunBrainDigestInput): Promise<0 | 1> {
  const ent = checkEntitlement("brain-autopilot", {
    storeRoot: input.storeRoot,
    now: input.nowMs,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });
  if (!ent.entitled) {
    input.stdout(DIGEST_UPSELL);
    return 0;
  }

  let limit = DEFAULT_LIMIT;
  if (input.limitFlag !== undefined) {
    if (!/^[1-9]\d*$/.test(input.limitFlag.trim())) {
      input.stderr(`invalid --limit: expected a positive integer, got "${input.limitFlag}"`);
      return 1;
    }
    limit = Number.parseInt(input.limitFlag.trim(), 10);
  }

  const { registry, initialized } = await input.ensureStore();
  if (initialized) input.stderr(`note: initialized store at ${input.storeRoot}`);
  const project = registry.listProjects().find((p) => p.name === input.projectName);
  if (project === undefined) {
    const { message } = projectNotFoundMessage(input.projectName);
    input.stderr(message);
    return 1;
  }

  const since = readDigestState(input.storeRoot).lastDigestAt;
  const all = registry.listMemoryEntries(project.id);
  const suggested = all.filter((entry) => entry.approval === "suggested");
  const autoApproved = all.filter(
    (entry) =>
      entry.approval === "approved" &&
      entry.evidence?.[0]?.startsWith(AUTOPILOT_EVIDENCE_PREFIX) === true &&
      (since === null || Date.parse(entry.createdAt) > Date.parse(since)),
  );

  const sessions = registry.listSessions(project.id);
  const startedAtOf = (sessionId: string | null): number => {
    if (sessionId === null) return Number.NEGATIVE_INFINITY; // project-scope rows last
    const session = sessions.find((s) => s.id === sessionId);
    return session === undefined ? 0 : Date.parse(session.startedAt);
  };
  // Stable sort: session groups newest first, project-scope rows last;
  // within a group the registry's append order is preserved.
  const ordered = [...suggested].sort(
    (a, b) => startedAtOf(b.sessionId) - startedAtOf(a.sessionId),
  );
  const total = ordered.length;
  const visible = ordered.slice(0, limit);

  if (input.json) {
    input.stdout(
      JSON.stringify({
        total,
        showing: visible.length,
        autoApprovedSinceLastDigest: autoApproved.length,
        lastDigestAt: since,
        pending: visible,
      }),
    );
    return 0;
  }

  if (total === 0) {
    input.stdout(`Nothing to triage — 0 failures recorded since ${since ?? "ever"}.`);
    if (autoApproved.length > 0) {
      input.stdout(`${autoApproved.length} auto-approved while you were away`);
    }
    // A human looked at the (empty) digest — stamp it. Read-only surfaces
    // (--json above, plain non-TTY below) never write.
    if (input.isTTY) writeDigestState(input.storeRoot, { lastDigestAt: input.now() });
    return 0;
  }

  // occurrences is not persisted on MemoryEntry — recompute the display
  // signal ("seen N× this session", spec §5.1) with the same pure extractor
  // and join on the from-session keyword ledger.
  const occurrencesByKeyword = new Map<string, number>();
  const failures = registry.listFailedAttempts(project.id);
  const visibleSessionIds = new Set(
    visible.map((entry) => entry.sessionId).filter((id): id is SessionId => id !== null),
  );
  for (const sessionId of visibleSessionIds) {
    const candidates = extractSessionMemories({
      sessionId,
      projectId: project.id,
      failedAttempts: failures.filter((failure) => failure.sessionId === sessionId),
    });
    for (const candidate of candidates) {
      if (candidate.occurrences >= 2) {
        occurrencesByKeyword.set(dedupeKeywordFor(candidate.dedupeKey), candidate.occurrences);
      }
    }
  }

  const sessionLabelOf = (sessionId: string | null): string => {
    if (sessionId === null) return "project scope";
    const session = sessions.find((s) => s.id === sessionId);
    if (session === undefined) return sessionId;
    const ended = session.endedAt === null ? "open" : `ended ${session.endedAt}`;
    return `${session.title ?? session.id} (${ended})`;
  };
  const items: DigestItem[] = visible.map((entry) => {
    const hit = entry.keywords
      .map((keyword) => occurrencesByKeyword.get(keyword))
      .find((count) => count !== undefined);
    return {
      entry,
      sessionLabel: sessionLabelOf(entry.sessionId),
      ...(hit === undefined ? {} : { occurrencesNote: `seen ${hit}× this session` }),
    };
  });

  const header = `showing ${visible.length} of ${total} pending suggested`;
  const collapsed =
    autoApproved.length > 0
      ? `${autoApproved.length} auto-approved while you were away — press a to review`
      : null;

  if (!input.isTTY) {
    input.stdout(header);
    if (autoApproved.length > 0) {
      input.stdout(`${autoApproved.length} auto-approved while you were away`);
    }
    items.forEach((item, i) => {
      const note = item.occurrencesNote === undefined ? "" : `  ·  ${item.occurrencesNote}`;
      input.stdout(
        `${i + 1}. ${formatMemorySearchLine({
          id: item.entry.id,
          type: item.entry.type,
          confidence: item.entry.confidence,
          title: item.entry.title,
        })}${note}`,
      );
    });
    input.stdout("triage with: mega memory approve <id> · mega memory reject <id>");
    return 0;
  }

  const spawnEditor = input.spawnEditor ?? defaultSpawnEditor;
  const autoApprovedIds = new Set<MemoryEntryId>(autoApproved.map((entry) => entry.id));
  let autoExpanded = false;
  let lastFlip: {
    id: MemoryEntryId;
    previous: MemoryEntry["approval"];
    closedId: MemoryEntryId | null;
  } | null = null;

  const flip = (
    id: MemoryEntryId,
    approval: "approved" | "rejected" | "suggested",
    verb: string,
  ): DigestActionResult => {
    const existing = registry.getMemoryEntry(id);
    if (existing === null) return { lines: [`not found: ${id}`] };
    const outcome = applyApprovalFlip(registry, existing, approval, input.now());
    if (!outcome.changed) return { lines: [`${verb} ${id} (no change)`] };
    lastFlip = { id, previous: existing.approval, closedId: outcome.closedPredecessor?.id ?? null };
    const lines = [`${verb} ${id}`];
    if (outcome.closedPredecessor !== undefined) {
      lines.push(
        `note: closed ${outcome.closedPredecessor.id} ("${outcome.closedPredecessor.title}")`,
      );
    }
    return { lines, decided: true };
  };

  const onAction = async (action: DigestAction): Promise<DigestActionResult> => {
    switch (action.kind) {
      case "approve":
        return flip(action.id, "approved", autoApprovedIds.has(action.id) ? "kept" : "approved");
      case "reject":
        // Spot-review `n` REVOKES an autopilot approval back to suggested —
        // reversibility invariant §8.5; nothing is deleted.
        return autoApprovedIds.has(action.id)
          ? flip(action.id, "suggested", "revoked to suggested")
          : flip(action.id, "rejected", "rejected");
      case "skip":
        return { lines: [] };
      case "undo": {
        if (lastFlip === null) return { lines: ["nothing to undo"] };
        const undone = lastFlip;
        lastFlip = null;
        const existing = registry.getMemoryEntry(undone.id);
        if (existing === null) return { lines: [`not found: ${undone.id}`] };
        applyApprovalFlip(registry, existing, undone.previous, input.now());
        const lines = [`undid — ${undone.id} back to ${undone.previous}`];
        if (undone.closedId !== null) {
          // Undo reverts ONLY the approval flip; the supersession close is
          // not reverted (spec §6.2) — name the documented recovery.
          lines.push(
            `predecessor ${undone.closedId} stays closed — mega memory reopen ${undone.closedId}`,
          );
        }
        return { lines };
      }
      case "expandAuto": {
        if (autoExpanded || autoApproved.length === 0) {
          return { lines: ["no auto-approved rows to review"] };
        }
        autoExpanded = true;
        return {
          lines: [
            `spot-review: ${autoApproved.length} auto-approved (y keeps · n revokes to suggested)`,
          ],
          insertItems: autoApproved.map((entry) => ({ entry, sessionLabel: "auto-approved" })),
        };
      }
      case "edit": {
        if (input.editor === undefined || input.editor.trim().length === 0) {
          return { lines: ["$EDITOR is not set — skipped"] };
        }
        const existing = registry.getMemoryEntry(action.id);
        if (existing === null) return { lines: [`not found: ${action.id}`] };
        const path = join(tmpdir(), `mega-digest-${action.id}.md`);
        writeFileSync(path, `${existing.title}\n\n${existing.content}\n`);
        try {
          const result = spawnEditor(input.editor, path);
          if (result.status !== 0) {
            return { lines: ["editor exited non-zero — approve aborted (stays suggested)"] };
          }
          const text = readFileSync(path, "utf8");
          const [titleLine, ...rest] = text.split("\n");
          const title = (titleLine ?? "").trim();
          const content = rest.join("\n").trim();
          if (title.length > 0 || content.length > 0) {
            const updatedAt = input.now();
            try {
              registry.updateMemoryEntry(action.id, {
                ...(title.length > 0 ? { title } : {}),
                ...(content.length > 0 ? { content } : {}),
                // Content-bearing edit re-keys decay (i1 lastActiveAt keying).
                lastActiveAt: updatedAt,
                updatedAt,
              });
            } catch {
              // Editor output is a trust boundary — a Zod rejection (e.g.
              // over-long title) aborts the approve instead of crashing the loop.
              return { lines: ["invalid edit — approve aborted (stays suggested)"] };
            }
          }
          return flip(action.id, "approved", "edited + approved");
        } finally {
          rmSync(path, { force: true });
        }
      }
      case "quit": {
        // Only the loop emits quit (on `q` or exhaustion, never on abort),
        // so Ctrl-C mid-digest never stamps lastDigestAt.
        writeDigestState(input.storeRoot, { lastDigestAt: input.now() });
        return { lines: ["digest done — state saved"] };
      }
    }
  };

  input.stdout(header);
  if (collapsed !== null) input.stdout(collapsed);
  await runDigestLoop({
    input: input.stdin,
    output: input.stdout,
    isTTY: input.isTTY,
    queue: items,
    onAction,
  });
  return 0;
}

export const brainDigestCommand = defineCommand({
  meta: {
    name: "digest",
    description: "Single-keystroke triage of pending suggested memories (Mega Saver Pro).",
  },
  args: {
    projectName: { type: "positional", required: true, description: "Project name." },
    limit: { type: "string", description: "Max rows rendered (default 50, newest first)." },
    json: { type: "boolean", default: false, description: "Print the pending queue as JSON (read-only)." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeRoot = resolveStorePath(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    const code = await runBrainDigest({
      storeRoot,
      projectName: String(args.projectName),
      limitFlag: typeof args.limit === "string" ? args.limit : undefined,
      json: args.json === true,
      now: () => new Date().toISOString(),
      nowMs: () => Date.now(),
      ensureStore: () => ensureStoreReady(storeRoot),
      isTTY: !!process.stdout.isTTY,
      stdin: process.stdin,
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
      editor: process.env["EDITOR"],
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] **Step 7: Register in `apps/cli/src/commands/brain/index.ts`** (three
  surgical edits — the file also carries Task 7's `autopilot` entries; do
  NOT touch them, anchor only on the pre-existing export/import lines).

  Edit 1 — add the import line directly after
  `import { defineCommand } from "citty";`:

```ts
import { brainDigestCommand } from "./digest.js";
```

  Edit 2 — add a re-export block directly after the
  `} from "./export.js";` re-export block:

```ts
export {
  DIGEST_UPSELL,
  type RunBrainDigestInput,
  brainDigestCommand,
  runBrainDigest,
} from "./digest.js";
```

  Edit 3 — in the `subCommands` map, replace:

```ts
    export: brainExportCommand,
```

  with:

```ts
    digest: brainDigestCommand,
    export: brainExportCommand,
```

  (`pnpm lint:fix` in Step 10 normalizes import/export ordering if biome
  wants a different sort.)

- [ ] **Step 8: Run to verify PASS.**
  `pnpm build && pnpm --filter @megasaver/cli exec vitest run test/brain/digest.test.ts test/brain/digest-loop.test.ts`
  Expected: all digest tests pass (16 in digest.test.ts, 12 in
  digest-loop.test.ts), 0 fail.

- [ ] **Step 9: Whole-package regression.**
  `pnpm --filter @megasaver/cli test`
  Expected: green — especially `memory-approve`, `approve-supersession`,
  and the brain export/import/sync/autopilot suites.

- [ ] **Step 10: Gates.**
  `pnpm lint:fix && pnpm typecheck`
  Both must exit 0.

- [ ] **Step 11: Commit.**

```bash
git add apps/cli/src/commands/memory/approve.ts apps/cli/src/commands/brain/digest.ts apps/cli/src/commands/brain/index.ts apps/cli/test/brain/digest.test.ts
git commit -m "feat(cli): mega brain digest triage command" -m "Extracts applyApprovalFlip from runMemoryApprove so the digest reuses the human approve flip against a once-opened registry (architect m9). Spot-review revokes autopilot approvals back to suggested; quit stamps digest-state, abort never does."
```

**Section C notes for the assembler / later tasks:**

- `DigestItem = { entry, sessionLabel, occurrencesNote? }` and
  `DigestActionResult = { lines, decided?, insertItems? }` are the binding
  shapes between Tasks 9/10 (contract left them to this section).
- The E2E WOW-loop smoke (real binary, cross-session recurrence →
  `autopilot run` → `brain digest` y/n triage) belongs to Task 11
  (release/gauntlet), not this section.
- Read-only surfaces (`--json`, plain non-TTY) never write
  `digest-state.json`; interactive quit/exhaustion and the interactive
  empty-state do.

---

### Task 11: Changeset, wiki, verify + E2E smoke, gauntlet

**Files:**
- Create: `.changeset/brain-autopilot.md`
- Modify: `docs/superpowers/specs/2026-07-14-brain-autopilot-design.md` (deviation note if any accumulated)
- Modify: `wiki/syntheses/memory-moat-portfolio.md`, `wiki/log.md`

- [ ] **Step 1: Write the changeset**

Confirm package names first: `grep '"name"' packages/core/package.json packages/entitlement/package.json packages/mcp-bridge/package.json apps/cli/package.json`

```markdown
---
"@megasaver/core": minor
"@megasaver/entitlement": minor
"@megasaver/mcp-bridge": patch
"@megasaver/cli": minor
---

Brain Autopilot (i14): the brain grows itself, safely.

- core: `autopilot` module (pure `scoreCandidate` rule table + `runAutopilot`
  engine over the existing session extractor), `autopilot-store` (policy +
  digest-state JSON, fail-closed), `ExtractedCandidate.occurrences`, shared
  `DEDUPE_KEYWORD_PREFIX` export. Auto-approval requires cross-session
  recurrence — within-session retry storms never qualify (M2 dampener).
- cli: `mega brain autopilot status|on|off|run` (dry-run free; real run Pro,
  honors the enabled toggle, per-session cap with capped-out notice) and
  `mega brain digest` (Pro) — single-keystroke y/n/e/s/u/a/q triage over the
  whole suggested backlog, auto-approved spot-review with revoke, safe
  raw-mode teardown, non-TTY/--json fallbacks. `runMemoryApprove` widened to
  admit a `suggested` target (undo/revoke); its core flip extracted as
  `applyApprovalFlip`.
- entitlement: `brain-autopilot` ProFeature key.
- mcp-bridge: from-session tool imports the shared dedupe prefix (behavior
  unchanged).
```

- [ ] **Step 2: Spec deviation note**

Append to the spec a `## 12. Implementation deviations (build phase)` section
recording any deviations that accumulated during Tasks 1-10 (collect from
task-commit messages / reviewer notes). Known-at-planning entries:

```markdown
> - `runMemoryApprove`'s core flip is extracted as `applyApprovalFlip`
>   (approve.ts) so the digest reuses one opened registry; runMemoryApprove
>   rewired byte-identically (architect m9's escape hatch).
> - Digest queue and autopilot pending counts are PROJECT-scoped —
>   `listMemoryEntries` is per-project; the spec's "ALL pending suggested
>   rows" reads as "all for the resolved project".
> - `writeAutopilotPolicy`/`writeDigestState` swallow write errors (mirrors
>   guard-state); reads fail closed, so a lost write can never enable
>   auto-approval.
```

- [ ] **Step 3: Full verify**

Run from the worktree root: `pnpm verify`
Expected: lint + typecheck + all test projects + conventions:check green.

- [ ] **Step 4: E2E smoke — the WOW loop (DoD evidence, capture the terminal session)**

Cross-session recurrence through the real binary (adjust seeding to the
harness used in the plan's CLI tests — direct store-file writes):

```bash
pnpm build
STORE=$(mktemp -d)
CLI="node apps/cli/dist/cli.js"
# seed: project demo + session A with failure F + session B with the SAME failure F
# (copy the plan's Task 8 test fixture seeding — projects.json + sessions + failed-attempts JSONL)
$CLI brain autopilot status --store "$STORE"                 # enabled: false
$CLI brain autopilot run --session <B> --dry-run --store "$STORE"
#   expect: DRY RUN banner + would-approve 1 (recurring across sessions)
$CLI brain autopilot run --session <B> --store "$STORE"      # free tier => upsell, exit 0, zero writes
# activate a test license (signTestLicense harness or launch key), then:
$CLI brain autopilot run --session <B> --store "$STORE"      # autopilot is off => exit 1
$CLI brain autopilot on --store "$STORE"
$CLI brain autopilot run --session <B> --store "$STORE"
#   expect: auto-approved 1 · staged N · per-row line; row has autopilot@1 evidence
$CLI memory show <approved-id> --store "$STORE"              # approval approved, evidence autopilot@1 rule=recurring-failure
$CLI brain digest --json --store "$STORE"                    # read-only queue JSON (non-TTY path)
# negative: single-session storm (same failure 5x in ONE session) => run approves 0
```

Every claim in the PR description must trace to a line in this capture.

- [ ] **Step 5: Wiki update**

- `wiki/syntheses/memory-moat-portfolio.md`: mark i14 SHIPPED (branch, PR, date).
- `wiki/log.md`: timestamped entry — what shipped, architect B1 catch
  (extractor never emits failed_attempt), M2 dampener, gauntlet verdicts.

- [ ] **Step 6: Commit**

```bash
git add .changeset/brain-autopilot.md docs/superpowers/specs/2026-07-14-brain-autopilot-design.md wiki/
git commit -m "chore(release): brain autopilot changeset + wiki"
```

- [ ] **Step 7: Gauntlet (HIGH risk — do not skip)**

Dispatch fresh-context `code-reviewer` AND adversarial `critic` (both opus,
full branch diff `git diff origin/main...feat/brain-autopilot`); verifier
re-pass on any fixes. Author and reviewer never the same context. Attack
surface to name explicitly for the critic:

- Machine-written approved rows: can ANY path reach auto-approve without
  the cross-session dampener (occurrence inflation, forged prior-session
  rows, contentHash collision)? Can an agent seed failures via MCP/guard
  loops in TWO sessions to force-approve junk (assess: is that vector
  bounded by the allowlist + cap + spot-review)?
- Provenance: is `autopilot@1` evidence writable through any agent surface
  (save_memory has no evidence field — re-verify nothing new opened one)?
- Digest raw-mode: terminal corruption on SIGINT/crash, $EDITOR abuse
  (command injection via EDITOR value?), undo semantics after a
  supersession close.
- approve widening: does "suggested" flowing through applyApprovalFlip
  create any path that fires supersession or corrupts bi-temporal fields?
- Policy store: corrupt/malicious autopilot.json (fail-closed proven?),
  TOCTOU between enabled-check and writes.
- Idempotence: re-run duplication (M4 keyword on approved rows), keyword
  forgery (an agent pre-writing a from-session:<key> keyword to SUPPRESS a
  legit capture — assess impact).
