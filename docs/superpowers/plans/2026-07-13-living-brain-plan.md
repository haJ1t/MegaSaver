# Living Brain (i1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-superseding memory save path with lineage recall and time-travel queries — every write detects conflict with the live corpus, links `supersedesId`, closes stale validity at the human-approval boundary; recall surfaces show what changed; CLI exposes history/reopen/`--as-of`.

**Architecture:** New `packages/core/src/supersession.ts` owns detection (checkConflicts ladder + optional cosine overlay), the extracted `applySupersession` close, `buildLineage`, `changedFromFor`, and the single write entry point `saveMemoryWithLineage` with a born-approved close ladder. Five writers rewire to it; `approve-memory` gains a declared-target quarantine exemption + disclosure; four recall surfaces gain a one-line `changedFrom`; decay rekeys to a new optional `lastActiveAt`. All storage changes are additive.

**Tech Stack:** TypeScript strict ESM, Zod, Vitest, Citty, pnpm/Turborepo. Entitlement: existing `savings-analytics` key.

**Spec:** `docs/superpowers/specs/2026-07-13-living-brain-design.md` (rev 2, architect-approved). The spec is BINDING — when in doubt, the spec wins.

**Risk level:** HIGH (§12 — memory schema + main write path). Gauntlet at the end: `code-reviewer` AND adversarial `critic` in fresh contexts, verifier re-pass on fixes.

**Branch/worktree:** `feat/living-brain` stacked on `feat/guard` (worktree `.claude/worktrees/living-brain`). Base MUST be `feat/guard` — `packages/core/src/warm-start.ts` (Task 15) exists only on that chain. PR base: `feat/guard` (retarget after #284/#285 merge).

**Environment hazards (read before every task):**
- Mega Saver MCP read-proxy SILENTLY TRUNCATES file reads (banner `N kept, M dropped` / `[Mega Saver: compressed...]`) — read files via `sed -n 'A,Bp'` in ≤60-line chunks after `grep -n`. Never trust a read that shows the banner.
- `pnpm build` before package tests (dist resolution). `pnpm --filter X test -- pattern` does NOT narrow — run the package suite.
- Full `pnpm typecheck` before EVERY commit — package vitest misses TS4111 (noPropertyAccessFromIndexSignature). Bracket access + `// biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)`.
- Citty `--no-<name>` sets `args.<name> = false` — opt-out flags are positive names with `default: true`, never `noX` args (bug fixed in 38488043).
- No bare `===` in zsh echo commands.

---
# Section 1 — Core package (Tasks 1–6)

All commands run from the worktree root:
`/Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain`
(branch `feat/living-brain`, stacked on `feat/guard`).

**Environment hazards (apply to every task below):**

- Mega Saver MCP read-proxy SILENTLY TRUNCATES file reads (banner "N kept, M
  dropped" / "[Mega Saver: compressed...]") — read files via `sed -n 'A,Bp'`
  in <=60-line chunks, locate with `grep -n`. Never trust a proxied read.
- `pnpm build` BEFORE package tests (workspace deps resolve via `dist/`).
- `pnpm --filter @megasaver/core test -- <pattern>` does NOT narrow — always
  run the whole package suite.
- Full `pnpm typecheck` REQUIRED before every commit — package vitest does NOT
  catch TS4111 (`noPropertyAccessFromIndexSignature`). If it fires, use bracket
  access + `// biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)`.
- No bare `===` in zsh echo commands.
- tsconfig is `strict` with `exactOptionalPropertyTypes` — never assign an
  explicit `undefined` to an optional property; use conditional spreads
  (`...(x !== undefined ? { x } : {})`), exactly as the code below does.

---

### Task 1: `applySupersession` — the extracted validTo-close helper

The validTo-close block currently lives inline in
`packages/mcp-bridge/src/tools/approve-memory.ts:176-201` (verified on
`feat/guard`). This task lifts its exact guard semantics into a pure core
helper. Task 7 (not this task) rewires approve-memory to call it — so the
guard conditions here MUST match the original byte-for-byte in behavior:
target exists, non-self, same `projectId`, same `scope`, `validTo == null`
⇒ patch `{ validTo: now(), updatedAt: now() }`; anything else is a silent
skip (`closed: false`). New over the original: the helper reports what it
closed (`superseded: { id, title }`) so callers can disclose, and the
caller-side `supersedesId !== undefined` check is folded in (returns
`{ closed: false }`) so Task 7's rewire stays a pure refactor.

**Files:**

- Create: `packages/core/src/supersession.ts`
- Create (test): `packages/core/test/supersession.test.ts`

**Steps:**

- [ ] **Step 1: Confirm the worktree.**
  `cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain && git branch --show-current`
  must print `feat/living-brain`. If the worktree does not exist yet:
  `git -C /Users/halitozger/Desktop/MegaSaver worktree add .claude/worktrees/living-brain -b feat/living-brain feat/guard`,
  then `cd` into it and run `pnpm install`.

- [ ] **Step 2: Read the original close block (chunked, no proxy).**
  `sed -n '160,210p' packages/mcp-bridge/src/tools/approve-memory.ts` —
  confirm the guard: `superseded !== null && superseded.id !== updated.id &&
  superseded.projectId === updated.projectId && superseded.scope ===
  updated.scope && superseded.validTo == null`. Do not proceed if the block
  has drifted from this shape; report instead.

- [ ] **Step 3: Write the failing test.** Create
  `packages/core/test/supersession.test.ts` with exactly:

```ts
import type { MemoryEntryId, SessionId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { type MemoryEntry, memoryEntrySchema } from "../src/memory-entry.js";
import { type CoreRegistry, createInMemoryCoreRegistry } from "../src/registry.js";
import { applySupersession } from "../src/supersession.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333" as SessionId;
const TARGET_ID = "00000000-0000-4000-8000-0000000000a1" as MemoryEntryId;
const ENTRY_ID = "00000000-0000-4000-8000-0000000000a2" as MemoryEntryId;
const MISSING_ID = "00000000-0000-4000-8000-0000000000ff" as MemoryEntryId;
const TS = "2026-07-13T00:00:00.000Z";
const NOW = "2026-07-13T12:00:00.000Z";
const EARLIER = "2026-07-10T00:00:00.000Z";
const now = () => NOW;

function mem(
  over: Omit<Partial<MemoryEntry>, "id"> & { id: string },
): MemoryEntry {
  return memoryEntrySchema.parse({
    id: over.id,
    projectId: over.projectId ?? PROJECT_ID,
    sessionId: over.sessionId ?? null,
    scope: over.scope ?? "project",
    type: over.type ?? "decision",
    title: over.title ?? "use npm for installs",
    content: over.content ?? "use npm for installs",
    keywords: over.keywords ?? [],
    confidence: "medium",
    source: "manual",
    approval: over.approval ?? "approved",
    stale: false,
    createdAt: TS,
    updatedAt: TS,
    ...(over.supersedesId !== undefined ? { supersedesId: over.supersedesId } : {}),
    ...(over.validTo !== undefined ? { validTo: over.validTo } : {}),
  });
}

function freshRegistry(): CoreRegistry {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: "/tmp/demo",
    createdAt: TS,
    updatedAt: TS,
  });
  return registry;
}

describe("applySupersession", () => {
  it("closes an open same-project same-scope target and reports it", () => {
    const registry = freshRegistry();
    registry.createMemoryEntry(mem({ id: TARGET_ID }));
    const entry = mem({ id: ENTRY_ID, content: "use pnpm for installs", supersedesId: TARGET_ID });

    const result = applySupersession(registry, entry, now);

    expect(result).toEqual({
      closed: true,
      superseded: { id: TARGET_ID, title: "use npm for installs" },
    });
    const target = registry.getMemoryEntry(TARGET_ID);
    expect(target?.validTo).toBe(NOW);
    expect(target?.updatedAt).toBe(NOW);
  });

  it("entry without supersedesId -> closed false, nothing touched", () => {
    const registry = freshRegistry();
    registry.createMemoryEntry(mem({ id: TARGET_ID }));
    const entry = mem({ id: ENTRY_ID, content: "use pnpm for installs" });

    expect(applySupersession(registry, entry, now)).toEqual({ closed: false });
    expect(registry.getMemoryEntry(TARGET_ID)?.validTo).toBeUndefined();
  });

  it("missing target -> closed false", () => {
    const registry = freshRegistry();
    const entry = mem({ id: ENTRY_ID, supersedesId: MISSING_ID });

    expect(applySupersession(registry, entry, now)).toEqual({ closed: false });
  });

  it("self-referencing supersedesId -> closed false, target stays open", () => {
    const registry = freshRegistry();
    registry.createMemoryEntry(mem({ id: TARGET_ID }));
    const entry = mem({ id: TARGET_ID, supersedesId: TARGET_ID });

    expect(applySupersession(registry, entry, now)).toEqual({ closed: false });
    expect(registry.getMemoryEntry(TARGET_ID)?.validTo).toBeUndefined();
  });

  it("cross-project target -> closed false, target stays open", () => {
    const registry = freshRegistry();
    registry.createMemoryEntry(mem({ id: TARGET_ID }));
    // The superseding entry is NOT persisted — applySupersession only reads
    // its fields, mirroring the approve-memory call shape.
    const entry = memoryEntrySchema.parse({
      ...mem({ id: ENTRY_ID, supersedesId: TARGET_ID }),
      projectId: OTHER_PROJECT_ID,
    });

    expect(applySupersession(registry, entry, now)).toEqual({ closed: false });
    expect(registry.getMemoryEntry(TARGET_ID)?.validTo).toBeUndefined();
  });

  it("cross-scope target -> closed false, target stays open", () => {
    const registry = freshRegistry();
    registry.createMemoryEntry(mem({ id: TARGET_ID }));
    const entry = mem({
      id: ENTRY_ID,
      scope: "session",
      sessionId: SESSION_ID,
      supersedesId: TARGET_ID,
    });

    expect(applySupersession(registry, entry, now)).toEqual({ closed: false });
    expect(registry.getMemoryEntry(TARGET_ID)?.validTo).toBeUndefined();
  });

  it("already-closed target -> closed false, validTo unchanged (idempotent)", () => {
    const registry = freshRegistry();
    registry.createMemoryEntry(mem({ id: TARGET_ID }));
    registry.updateMemoryEntry(TARGET_ID, { validTo: EARLIER, updatedAt: EARLIER });
    const entry = mem({ id: ENTRY_ID, content: "use pnpm for installs", supersedesId: TARGET_ID });

    expect(applySupersession(registry, entry, now)).toEqual({ closed: false });
    expect(registry.getMemoryEntry(TARGET_ID)?.validTo).toBe(EARLIER);
  });
});
```

- [ ] **Step 4: Run the test — expect FAIL.**
  `pnpm build && pnpm --filter @megasaver/core test`
  Expected: the core suite fails on `test/supersession.test.ts` with
  `Failed to resolve import "../src/supersession.js"` (module does not exist
  yet). All other core test files stay green.

- [ ] **Step 5: Implement.** Create `packages/core/src/supersession.ts` with
  exactly:

```ts
import type { MemoryEntryId } from "@megasaver/shared";
import type { MemoryEntry } from "./memory-entry.js";
import type { CoreRegistry } from "./registry.js";

// The bi-temporal validTo-close block, extracted verbatim from the approve
// flip (mcp-bridge approve-memory.ts). supersedesId is agent-controlled (the
// schema only checks UUID shape), so the target is validated before closing
// its validity, or an agent could (a) close a CURRENT memory in another
// project/scope it should not touch, or (b) self-reference to close its own
// validity — approved yet instantly non-current, silently vanishing from
// default recall. So close ONLY a different, same-project, same-scope,
// still-open target. Invalid targets skip silently (closed: false) exactly as
// today; the return value makes the outcome disclosable at decision surfaces.
export function applySupersession(
  registry: CoreRegistry,
  entry: MemoryEntry,
  now: () => string,
): { closed: boolean; superseded?: { id: MemoryEntryId; title: string } } {
  if (entry.supersedesId === undefined) return { closed: false };
  const superseded = registry.getMemoryEntry(entry.supersedesId);
  const targetIsValid =
    superseded !== null &&
    superseded.id !== entry.id &&
    superseded.projectId === entry.projectId &&
    superseded.scope === entry.scope &&
    superseded.validTo == null;
  if (!targetIsValid) return { closed: false };
  registry.updateMemoryEntry(superseded.id, {
    validTo: now(),
    updatedAt: now(),
  });
  return { closed: true, superseded: { id: superseded.id, title: superseded.title } };
}
```

- [ ] **Step 6: Run the test — expect PASS.**
  `pnpm build && pnpm --filter @megasaver/core test`
  Expected: all core test files pass, including the 7 new
  `applySupersession` tests.

- [ ] **Step 7: Lint + typecheck.**
  `pnpm lint:fix && pnpm typecheck` — both must exit 0.

- [ ] **Step 8: Commit.**
  `git add packages/core/src/supersession.ts packages/core/test/supersession.test.ts && git commit -m "feat(core): applySupersession close helper"`

---

### Task 2: `eligibleSupersessionCorpus` + lexical `detectSupersession` + constants

Pure detection over an in-memory corpus. The ladder at this stage is
lexical-only (`checkConflicts` classes); the cosine overlay lands in Task 3
but the exported signature is contract-final NOW (the unused `now`/`opts`
params are intentional — `noUnusedParameters` is not enabled in
`tsconfig.base.json` and Biome 1.9.4 recommended does not flag unused
function parameters; do NOT rename or underscore them).

**Files:**

- Modify: `packages/core/src/supersession.ts`
- Create (test): `packages/core/test/supersession-detect.test.ts`

**Steps:**

- [ ] **Step 1: Read `checkConflicts` (chunked).**
  `sed -n '1,72p' packages/core/src/conflict-checker.ts` — confirm the
  precedence order duplicate → supersession → contradiction, single-element
  `conflictIds`, and that negations are matched on `keywords` only.

- [ ] **Step 2: Write the failing table-driven test.** Create
  `packages/core/test/supersession-detect.test.ts` with exactly:

```ts
import type { MemoryEntryId, SessionId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import type { MemoryEntry } from "../src/memory-entry.js";
import {
  POSSIBLE_SUPERSEDES_PREFIX,
  SUPERSEDE_COSINE_AMBIGUOUS,
  SUPERSEDE_COSINE_LINK,
  SUPERSEDE_TOP_K,
  type SupersessionDetection,
  detectSupersession,
  eligibleSupersessionCorpus,
} from "../src/supersession.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_A = "33333333-3333-4333-8333-333333333333" as SessionId;
const SESSION_B = "44444444-4444-4444-8444-444444444444" as SessionId;
const NOW = "2026-07-13T12:00:00.000Z";
const PAST_CLOSE = "2026-07-01T00:00:00.000Z";
const CAND_ID = "00000000-0000-4000-8000-0000000000c0" as MemoryEntryId;
const ID_B1 = "00000000-0000-4000-8000-0000000000b1" as MemoryEntryId;
const ID_K = "00000000-0000-4000-8000-0000000000b2" as MemoryEntryId;
const ID_D1 = "00000000-0000-4000-8000-0000000000d1" as MemoryEntryId;
const ID_D2 = "00000000-0000-4000-8000-0000000000d2" as MemoryEntryId;
const ID_D3 = "00000000-0000-4000-8000-0000000000d3" as MemoryEntryId;
const ID_D4 = "00000000-0000-4000-8000-0000000000d4" as MemoryEntryId;
const ID_D5 = "00000000-0000-4000-8000-0000000000d5" as MemoryEntryId;
const ID_D6 = "00000000-0000-4000-8000-0000000000d6" as MemoryEntryId;

// Cast-style fixtures (conflict-checker.test.ts precedent): terse, and lets
// scope/session combinations be built without registry ceremony.
const mk = (id: string, over: Partial<MemoryEntry> = {}): MemoryEntry =>
  ({
    id,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "install tooling",
    content: "use pnpm not npm",
    keywords: ["pnpm"],
    confidence: "medium",
    source: "agent",
    approval: "approved",
    stale: false,
    relatedFiles: ["package.json"],
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    ...over,
  }) as MemoryEntry;

describe("supersession constants", () => {
  it("fixtures-are-the-spec: constants pinned", () => {
    expect(SUPERSEDE_TOP_K).toBe(5);
    expect(SUPERSEDE_COSINE_LINK).toBe(0.8);
    expect(SUPERSEDE_COSINE_AMBIGUOUS).toBe(0.6);
    expect(POSSIBLE_SUPERSEDES_PREFIX).toBe("possible-supersedes:");
  });
});

describe("eligibleSupersessionCorpus", () => {
  it("keeps same-project same-type approved recallable project-scope rows, drops the rest", () => {
    const candidate = mk(CAND_ID);
    const keep = mk(ID_K);
    const self = mk(CAND_ID);
    const otherProject = mk(ID_D1, { projectId: OTHER_PROJECT_ID as MemoryEntry["projectId"] });
    const otherType = mk(ID_D2, { type: "bug" });
    const unapproved = mk(ID_D3, { approval: "suggested" });
    const closed = mk(ID_D4, { validTo: PAST_CLOSE });
    const archival = mk(ID_D5, { tier: "archival" });
    const sessionScoped = mk(ID_D6, { scope: "session", sessionId: SESSION_A });

    const result = eligibleSupersessionCorpus(
      candidate,
      [keep, self, otherProject, otherType, unapproved, closed, archival, sessionScoped],
      NOW,
    );
    expect(result.map((e) => e.id)).toEqual([ID_K]);
  });

  it("session-scoped candidate matches only its own session", () => {
    const candidate = mk(CAND_ID, { scope: "session", sessionId: SESSION_A });
    const sameSession = mk(ID_K, { scope: "session", sessionId: SESSION_A });
    const otherSession = mk(ID_D1, { scope: "session", sessionId: SESSION_B });
    const projectScoped = mk(ID_D2);

    const result = eligibleSupersessionCorpus(
      candidate,
      [sameSession, otherSession, projectScoped],
      NOW,
    );
    expect(result.map((e) => e.id)).toEqual([ID_K]);
  });
});

describe("detectSupersession — lexical ladder", () => {
  type Case = {
    name: string;
    candidate: MemoryEntry;
    corpus: MemoryEntry[];
    expected: SupersessionDetection;
  };

  const cases: Case[] = [
    {
      name: "exact duplicate -> duplicate",
      candidate: mk(CAND_ID),
      corpus: [mk(ID_B1)],
      expected: { kind: "duplicate", existingId: ID_B1 },
    },
    {
      name: "file-overlap divergence (same type, different conclusion) -> supersede via supersession",
      candidate: mk(CAND_ID, { content: "use npm not pnpm", keywords: ["npm"] }),
      corpus: [mk(ID_B1)],
      expected: { kind: "supersede", supersededId: ID_B1, via: "supersession" },
    },
    {
      // Negation flip. NOTE: the corpus row is a different type (decision vs
      // project_rule) — with a same-type pair, checkConflicts' supersession
      // branch (same type + file overlap + different content) fires first.
      // detectSupersession takes the corpus as a parameter, so the ladder is
      // unit-tested here independent of eligibleSupersessionCorpus' same-type
      // filter (see the plan's open questions for the production wrinkle).
      name: "negation flip -> supersede via contradiction",
      candidate: mk(CAND_ID, {
        type: "project_rule",
        title: "merge shortcut",
        content: "merge without waiting for tests",
        keywords: ["merge", "skip"],
        relatedFiles: ["ci.yml"],
      }),
      corpus: [
        mk(ID_B1, {
          title: "merge gate",
          content: "tests must pass before merge",
          keywords: ["merge", "pass"],
          relatedFiles: ["ci.yml"],
        }),
      ],
      expected: { kind: "supersede", supersededId: ID_B1, via: "contradiction" },
    },
    {
      name: "unrelated -> none",
      candidate: mk(CAND_ID, {
        content: "auth uses JWT",
        keywords: ["jwt"],
        relatedFiles: ["src/auth.ts"],
      }),
      corpus: [mk(ID_B1)],
      expected: { kind: "none" },
    },
    {
      name: "empty corpus -> none",
      candidate: mk(CAND_ID),
      corpus: [],
      expected: { kind: "none" },
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(detectSupersession(c.candidate, c.corpus, NOW)).toEqual(c.expected);
    });
  }

  it("is deterministic under a fixed now (pure — repeat calls agree)", () => {
    const candidate = mk(CAND_ID, { content: "use npm not pnpm", keywords: ["npm"] });
    const corpus = [mk(ID_B1)];
    const first = detectSupersession(candidate, corpus, NOW);
    const second = detectSupersession(candidate, corpus, NOW);
    expect(second).toEqual(first);
    expect(second).toEqual({ kind: "supersede", supersededId: ID_B1, via: "supersession" });
  });
});
```

- [ ] **Step 3: Run — expect FAIL.**
  `pnpm build && pnpm --filter @megasaver/core test`
  Expected: `supersession-detect.test.ts` fails with
  `No matching export ... for import "detectSupersession"` (or
  `does not provide an export named 'SUPERSEDE_TOP_K'`). Task 1's
  `supersession.test.ts` stays green.

- [ ] **Step 4: Implement.** In `packages/core/src/supersession.ts`, replace
  the import block at the top with:

```ts
import type { MemoryEntryId } from "@megasaver/shared";
import { checkConflicts } from "./conflict-checker.js";
import { type MemoryEntry, isRecallable } from "./memory-entry.js";
import type { CoreRegistry } from "./registry.js";
```

  Then append at the end of the file:

```ts
// Single tunable site for all supersession knobs (spec §4.1).
export const SUPERSEDE_TOP_K = 5;
export const SUPERSEDE_COSINE_LINK = 0.8;
export const SUPERSEDE_COSINE_AMBIGUOUS = 0.6;
export const POSSIBLE_SUPERSEDES_PREFIX = "possible-supersedes:";

export type SupersessionDetection =
  | { kind: "none" }
  | { kind: "duplicate"; existingId: MemoryEntryId }
  | {
      kind: "supersede";
      supersededId: MemoryEntryId;
      via: "supersession" | "contradiction" | "cosine";
      score?: number;
    }
  | { kind: "ambiguous"; possibleIds: readonly MemoryEntryId[] };

// The corpus a candidate may supersede: same project, same type, approved,
// recallable at `now` (current + non-archival), scope-compatible
// (project<->project; session<->same sessionId), never itself.
export function eligibleSupersessionCorpus(
  candidate: MemoryEntry,
  entries: readonly MemoryEntry[],
  now: string,
): MemoryEntry[] {
  return entries.filter(
    (e) =>
      e.id !== candidate.id &&
      e.projectId === candidate.projectId &&
      e.type === candidate.type &&
      e.approval === "approved" &&
      isRecallable(e, now) &&
      (candidate.scope === "session"
        ? e.scope === "session" && e.sessionId === candidate.sessionId
        : e.scope === "project"),
  );
}

// Deterministic decision ladder, first match wins. Pure given inputs: no I/O,
// no wall clock — `now` is threaded explicitly so fixtures ARE the spec.
// Lexical classes come from checkConflicts (precedence-ordered duplicate ->
// supersession -> contradiction). The cosine overlay (opts) is the only
// non-lexical rung and lands in the next commit; `now` and `opts` are part of
// the stable public signature.
export function detectSupersession(
  candidate: MemoryEntry,
  corpus: readonly MemoryEntry[],
  now: string,
  opts?: { queryVector?: Float32Array; memoryVectors?: Map<string, Float32Array> },
): SupersessionDetection {
  const conflict = checkConflicts(candidate, corpus);
  const target = conflict.conflictIds[0];
  if (target !== undefined) {
    if (conflict.outcome === "duplicate") return { kind: "duplicate", existingId: target };
    if (conflict.outcome === "supersession" || conflict.outcome === "contradiction") {
      return { kind: "supersede", supersededId: target, via: conflict.outcome };
    }
  }
  return { kind: "none" };
}
```

- [ ] **Step 5: Run — expect PASS.**
  `pnpm build && pnpm --filter @megasaver/core test`
  Expected: all core tests green (Task 1's 7 + this task's 10).

- [ ] **Step 6: Lint + typecheck.**
  `pnpm lint:fix && pnpm typecheck` — both exit 0.

- [ ] **Step 7: Commit.**
  `git add packages/core/src/supersession.ts packages/core/test/supersession-detect.test.ts && git commit -m "feat(core): lexical supersession detection"`

---

### Task 3: cosine overlay in `detectSupersession`

The overlay runs ONLY when `opts.queryVector` is present, and only after the
lexical rungs miss. Pool = BM25 top-K over the corpus
(`searchMemoryEntries`, `limit: SUPERSEDE_TOP_K`, `asOf: now`). Link target =
**MAX RAW COSINE over the pool** among entries that have a vector in
`opts.memoryVectors` — NOT the weighted BM25 #1
(`searchMemoryEntries` weights by `effectiveConfidence`, so a fresher,
less-similar row can outrank the true stale predecessor). Bands:
`max >= 0.80` ⇒ supersede via `"cosine"` with score;
`0.60 <= max < 0.80` ⇒ ambiguous; else none. All vectors are injected
`Float32Array`s — no model download, no `embed()` call anywhere in core.

**Files:**

- Modify: `packages/core/src/supersession.ts`
- Modify (test): `packages/core/test/supersession-detect.test.ts`

**Steps:**

- [ ] **Step 1: Write the failing tests.** In
  `packages/core/test/supersession-detect.test.ts`, replace the line
  `import type { MemoryEntry } from "../src/memory-entry.js";` with:

```ts
import type { MemoryEntry } from "../src/memory-entry.js";
import { searchMemoryEntries } from "../src/memory-search.js";
```

  Then append at the end of the file:

```ts
describe("detectSupersession — cosine overlay", () => {
  const OLD = "2026-01-01T00:00:00.000Z";
  const RECENT = "2026-07-12T00:00:00.000Z";
  const ID_STALE = "00000000-0000-4000-8000-0000000000e1" as MemoryEntryId;
  const ID_FRESH = "00000000-0000-4000-8000-0000000000e2" as MemoryEntryId;
  const queryVector = Float32Array.from([1, 0]);

  // No relatedFiles overlap and no negation keywords, so the lexical rungs
  // all miss and the ladder reaches the overlay.
  const candidate = mk(CAND_ID, {
    title: "auth middleware decision v2",
    content: "auth middleware uses session cookies",
    keywords: [],
    relatedFiles: [],
  });
  const stalePredecessor = mk(ID_STALE, {
    title: "auth middleware decision",
    content: "auth middleware uses jwt tokens",
    keywords: [],
    relatedFiles: [],
    confidence: "low",
    createdAt: OLD,
    updatedAt: OLD,
  });
  const freshBystander = mk(ID_FRESH, {
    title: "auth middleware decision",
    content: "auth middleware logging setup",
    keywords: [],
    relatedFiles: [],
    confidence: "high",
    createdAt: RECENT,
    updatedAt: RECENT,
  });

  it("fixture sanity: the decay-weighted BM25 #1 is NOT the true predecessor", () => {
    const pool = searchMemoryEntries([stalePredecessor, freshBystander], {
      text: `${candidate.title} ${candidate.content}`,
      asOf: NOW,
      limit: SUPERSEDE_TOP_K,
    });
    expect(pool[0]?.id).toBe(ID_FRESH);
    expect(pool.map((e) => e.id)).toContain(ID_STALE);
  });

  it("links by MAX RAW COSINE over the BM25 pool, not the weighted #1", () => {
    const memoryVectors = new Map<string, Float32Array>([
      [ID_STALE, Float32Array.from([1, 0])],
      [ID_FRESH, Float32Array.from([0, 1])],
    ]);
    const result = detectSupersession(candidate, [stalePredecessor, freshBystander], NOW, {
      queryVector,
      memoryVectors,
    });
    expect(result).toEqual({ kind: "supersede", supersededId: ID_STALE, via: "cosine", score: 1 });
  });

  it("0.60 <= max < 0.80 -> ambiguous, no link", () => {
    // cosine([1,0],[1,1]) = 1/sqrt(2) ~= 0.707 — inside the ambiguous band.
    const memoryVectors = new Map<string, Float32Array>([[ID_STALE, Float32Array.from([1, 1])]]);
    const result = detectSupersession(candidate, [stalePredecessor], NOW, {
      queryVector,
      memoryVectors,
    });
    expect(result).toEqual({ kind: "ambiguous", possibleIds: [ID_STALE] });
  });

  it("max < 0.60 -> none", () => {
    // cosine([1,0],[1,2]) = 1/sqrt(5) ~= 0.447 — below the band.
    const memoryVectors = new Map<string, Float32Array>([[ID_STALE, Float32Array.from([1, 2])]]);
    const result = detectSupersession(candidate, [stalePredecessor], NOW, {
      queryVector,
      memoryVectors,
    });
    expect(result).toEqual({ kind: "none" });
  });

  it("pool entries without a sidecar vector cannot link -> none", () => {
    const result = detectSupersession(candidate, [stalePredecessor], NOW, {
      queryVector,
      memoryVectors: new Map(),
    });
    expect(result).toEqual({ kind: "none" });
  });

  it("no queryVector -> overlay skipped even when vectors exist", () => {
    const memoryVectors = new Map<string, Float32Array>([[ID_STALE, Float32Array.from([1, 0])]]);
    const result = detectSupersession(candidate, [stalePredecessor], NOW, { memoryVectors });
    expect(result).toEqual({ kind: "none" });
  });

  it("an entry outside the BM25 pool never links, however similar its vector", () => {
    const offTopic = mk(ID_FRESH, {
      title: "quarterly revenue targets",
      content: "quarterly revenue targets for finance",
      keywords: [],
      relatedFiles: [],
    });
    const result = detectSupersession(candidate, [offTopic], NOW, {
      queryVector,
      memoryVectors: new Map<string, Float32Array>([[ID_FRESH, Float32Array.from([1, 0])]]),
    });
    expect(result).toEqual({ kind: "none" });
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**
  `pnpm build && pnpm --filter @megasaver/core test`
  Expected: 5 of the 7 new tests fail (`links by MAX RAW COSINE`,
  `ambiguous`, and the band tests get `{ kind: "none" }` where a
  cosine/ambiguous result is expected — the lexical-only tail returns none).
  The `fixture sanity`, `no queryVector`, `without a sidecar vector`, and
  `outside the BM25 pool` tests may already pass — that is fine; the red
  signal is the cosine-link and ambiguous cases.

- [ ] **Step 3: Implement.** In `packages/core/src/supersession.ts`, replace
  the import block with:

```ts
import { cosine } from "@megasaver/embeddings";
import type { MemoryEntryId } from "@megasaver/shared";
import { checkConflicts } from "./conflict-checker.js";
import { type MemoryEntry, isRecallable } from "./memory-entry.js";
import { searchMemoryEntries } from "./memory-search.js";
import type { CoreRegistry } from "./registry.js";
```

  (Biome `organizeImports` requires `@megasaver/embeddings` before
  `@megasaver/shared`; do not fight it.)

  Then replace the entire `detectSupersession` function with:

```ts
// Deterministic decision ladder, first match wins. Pure given inputs: no I/O,
// no wall clock — `now` is threaded explicitly so fixtures ARE the spec.
// Lexical classes come from checkConflicts (precedence-ordered duplicate ->
// supersession -> contradiction). Cosine overlay only when the caller injects
// a queryVector (embedding is the caller's async boundary, mirroring
// searchMemoryEntriesSemantic): pool = BM25 top-K over the corpus, link
// target = MAX RAW COSINE over the pool — NOT the weighted BM25 #1, whose
// effectiveConfidence weighting can rank a fresher, less-similar row above
// the true stale predecessor. No BM25-only auto-link: BM25 scores are
// unnormalized; the 0.60/0.80 bands are cosine bands.
export function detectSupersession(
  candidate: MemoryEntry,
  corpus: readonly MemoryEntry[],
  now: string,
  opts?: { queryVector?: Float32Array; memoryVectors?: Map<string, Float32Array> },
): SupersessionDetection {
  const conflict = checkConflicts(candidate, corpus);
  const target = conflict.conflictIds[0];
  if (target !== undefined) {
    if (conflict.outcome === "duplicate") return { kind: "duplicate", existingId: target };
    if (conflict.outcome === "supersession" || conflict.outcome === "contradiction") {
      return { kind: "supersede", supersededId: target, via: conflict.outcome };
    }
  }

  const queryVector = opts?.queryVector;
  if (queryVector === undefined) return { kind: "none" };
  const memoryVectors = opts?.memoryVectors ?? new Map<string, Float32Array>();

  const pool = searchMemoryEntries(corpus, {
    text: `${candidate.title} ${candidate.content}`,
    asOf: now,
    limit: SUPERSEDE_TOP_K,
  });

  let best: { id: MemoryEntryId; score: number } | undefined;
  for (const entry of pool) {
    const vector = memoryVectors.get(entry.id);
    if (vector === undefined) continue;
    const score = cosine(queryVector, vector);
    if (best === undefined || score > best.score) best = { id: entry.id, score };
  }
  if (best === undefined) return { kind: "none" };
  if (best.score >= SUPERSEDE_COSINE_LINK) {
    return { kind: "supersede", supersededId: best.id, via: "cosine", score: best.score };
  }
  if (best.score >= SUPERSEDE_COSINE_AMBIGUOUS) {
    return { kind: "ambiguous", possibleIds: [best.id] };
  }
  return { kind: "none" };
}
```

- [ ] **Step 4: Run — expect PASS.**
  `pnpm build && pnpm --filter @megasaver/core test`
  Expected: all core tests green, including all 7 cosine-overlay tests and
  every pre-existing lexical test (the overlay must not change any lexical
  outcome).

- [ ] **Step 5: Lint + typecheck.**
  `pnpm lint:fix && pnpm typecheck` — both exit 0.

- [ ] **Step 6: Commit.**
  `git add packages/core/src/supersession.ts packages/core/test/supersession-detect.test.ts && git commit -m "feat(core): cosine overlay in supersession"`

---

### Task 4: `buildLineage` + `changedFromFor`

Read-side lineage. `buildLineage`: ancestors via `supersedesId` walk
(cycle-guarded — `supersedesId` is agent-controlled data; a forged chain
must not hang the CLI), then the entry, then descendants via ONE linear scan
building a `supersedesId -> first child` map (first child per parent by
`createdAt` asc, stable by id). `changedFromFor`: immediate predecessor
only, suppressed when the predecessor was reopened (`validTo` back to null).

**Files:**

- Modify: `packages/core/src/supersession.ts`
- Create (test): `packages/core/test/lineage.test.ts`

**Steps:**

- [ ] **Step 1: Write the failing test.** Create
  `packages/core/test/lineage.test.ts` with exactly:

```ts
import type { MemoryEntryId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import type { MemoryEntry } from "../src/memory-entry.js";
import { buildLineage, changedFromFor } from "../src/supersession.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ID_A = "00000000-0000-4000-8000-0000000000f1" as MemoryEntryId;
const ID_B = "00000000-0000-4000-8000-0000000000f2" as MemoryEntryId;
const ID_C = "00000000-0000-4000-8000-0000000000f3" as MemoryEntryId;
const ID_X = "00000000-0000-4000-8000-0000000000f4" as MemoryEntryId;
const ID_MISSING = "00000000-0000-4000-8000-0000000000ff" as MemoryEntryId;
const CLOSED_AT = "2026-07-10T00:00:00.000Z";

const mk = (id: string, over: Partial<MemoryEntry> = {}): MemoryEntry =>
  ({
    id,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: `title ${id.slice(-2)}`,
    content: `content ${id.slice(-2)}`,
    keywords: [],
    confidence: "medium",
    source: "agent",
    approval: "approved",
    stale: false,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...over,
  }) as MemoryEntry;

describe("buildLineage", () => {
  const a = mk(ID_A, { validTo: CLOSED_AT });
  const b = mk(ID_B, { supersedesId: ID_A, createdAt: "2026-07-02T00:00:00.000Z", validTo: CLOSED_AT });
  const c = mk(ID_C, { supersedesId: ID_B, createdAt: "2026-07-03T00:00:00.000Z" });

  it("chain of 3, from the middle: oldest -> newest", () => {
    expect(buildLineage([c, a, b], ID_B).map((e) => e.id)).toEqual([ID_A, ID_B, ID_C]);
  });

  it("chain of 3, from the oldest and the newest: same chain", () => {
    expect(buildLineage([c, a, b], ID_A).map((e) => e.id)).toEqual([ID_A, ID_B, ID_C]);
    expect(buildLineage([c, a, b], ID_C).map((e) => e.id)).toEqual([ID_A, ID_B, ID_C]);
  });

  it("terminates on a forged supersedesId cycle", () => {
    const cycleA = mk(ID_A, { supersedesId: ID_B });
    const cycleB = mk(ID_B, { supersedesId: ID_A });
    expect(buildLineage([cycleA, cycleB], ID_A).map((e) => e.id)).toEqual([ID_B, ID_A]);
  });

  it("picks the FIRST child per parent by createdAt asc", () => {
    const parent = mk(ID_A);
    const firstChild = mk(ID_B, { supersedesId: ID_A, createdAt: "2026-07-02T00:00:00.000Z" });
    const laterChild = mk(ID_X, { supersedesId: ID_A, createdAt: "2026-07-05T00:00:00.000Z" });
    expect(buildLineage([laterChild, parent, firstChild], ID_A).map((e) => e.id)).toEqual([
      ID_A,
      ID_B,
    ]);
  });

  it("unknown id -> empty chain", () => {
    expect(buildLineage([a, b], ID_MISSING)).toEqual([]);
  });
});

describe("changedFromFor", () => {
  const byIdOf = (entries: MemoryEntry[]): ReadonlyMap<string, MemoryEntry> =>
    new Map<string, MemoryEntry>(entries.map((e) => [e.id, e]));

  it("closed predecessor -> title + closedAt, hit reason wins", () => {
    const predecessor = mk(ID_A, { validTo: CLOSED_AT, reason: "old reason" });
    const cf = changedFromFor(
      { supersedesId: ID_A, reason: "newer decision" },
      byIdOf([predecessor]),
    );
    expect(cf).toEqual({
      title: predecessor.title,
      closedAt: CLOSED_AT,
      reason: "newer decision",
    });
  });

  it("hit reason absent -> falls back to the predecessor reason", () => {
    const predecessor = mk(ID_A, { validTo: CLOSED_AT, reason: "old reason" });
    const cf = changedFromFor({ supersedesId: ID_A }, byIdOf([predecessor]));
    expect(cf).toEqual({ title: predecessor.title, closedAt: CLOSED_AT, reason: "old reason" });
  });

  it("both reasons absent -> no reason key at all", () => {
    const predecessor = mk(ID_A, { validTo: CLOSED_AT });
    const cf = changedFromFor({ supersedesId: ID_A }, byIdOf([predecessor]));
    expect(cf).toBeDefined();
    expect(cf !== undefined && "reason" in cf).toBe(false);
  });

  it("reopened predecessor (validTo null) -> undefined", () => {
    const predecessor = mk(ID_A, { validTo: null });
    expect(changedFromFor({ supersedesId: ID_A }, byIdOf([predecessor]))).toBeUndefined();
  });

  it("never-closed predecessor (validTo absent) -> undefined", () => {
    const predecessor = mk(ID_A);
    expect(changedFromFor({ supersedesId: ID_A }, byIdOf([predecessor]))).toBeUndefined();
  });

  it("missing predecessor -> undefined", () => {
    expect(changedFromFor({ supersedesId: ID_MISSING }, byIdOf([]))).toBeUndefined();
  });

  it("hit without supersedesId -> undefined", () => {
    expect(changedFromFor({}, byIdOf([mk(ID_A, { validTo: CLOSED_AT })]))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**
  `pnpm build && pnpm --filter @megasaver/core test`
  Expected: `lineage.test.ts` fails with
  `No matching export ... for import "buildLineage"`.

- [ ] **Step 3: Implement.** Append to
  `packages/core/src/supersession.ts`:

```ts
// Chain oldest -> newest: ancestors via the supersedesId walk, then the entry,
// then descendants via one linear scan building a supersedesId -> first-child
// map (first child per parent by createdAt asc, stable by id). No new index,
// no back-pointer field. supersedesId is agent-controlled data, so both walks
// are cycle-guarded by a shared visited set — a forged chain must not hang
// the CLI.
export function buildLineage(
  entries: readonly MemoryEntry[],
  id: MemoryEntryId,
): MemoryEntry[] {
  const byId = new Map<string, MemoryEntry>(entries.map((e) => [e.id, e]));
  const self = byId.get(id);
  if (self === undefined) return [];

  const visited = new Set<string>([self.id]);

  const ancestors: MemoryEntry[] = [];
  let ancestor = self.supersedesId !== undefined ? byId.get(self.supersedesId) : undefined;
  while (ancestor !== undefined && !visited.has(ancestor.id)) {
    visited.add(ancestor.id);
    ancestors.unshift(ancestor);
    ancestor = ancestor.supersedesId !== undefined ? byId.get(ancestor.supersedesId) : undefined;
  }

  const childOf = new Map<string, MemoryEntry>();
  for (const e of entries) {
    if (e.supersedesId === undefined) continue;
    const prev = childOf.get(e.supersedesId);
    if (
      prev === undefined ||
      e.createdAt < prev.createdAt ||
      (e.createdAt === prev.createdAt && e.id < prev.id)
    ) {
      childOf.set(e.supersedesId, e);
    }
  }

  const descendants: MemoryEntry[] = [];
  let child = childOf.get(self.id);
  while (child !== undefined && !visited.has(child.id)) {
    visited.add(child.id);
    descendants.push(child);
    child = childOf.get(child.id);
  }

  return [...ancestors, self, ...descendants];
}

export type ChangedFrom = { title: string; closedAt: string; reason?: string };

// Recall enrichment: immediate predecessor only (never the chain — token
// discipline). A reopened predecessor (validTo back to null) suppresses the
// line: the row is current again, so "changed from" would be a lie.
export function changedFromFor(
  hit: Pick<MemoryEntry, "supersedesId" | "reason">,
  byId: ReadonlyMap<string, MemoryEntry>,
): ChangedFrom | undefined {
  if (hit.supersedesId === undefined) return undefined;
  const predecessor = byId.get(hit.supersedesId);
  if (predecessor === undefined || predecessor.validTo == null) return undefined;
  const reason = hit.reason ?? predecessor.reason;
  return {
    title: predecessor.title,
    closedAt: predecessor.validTo,
    ...(reason !== undefined ? { reason } : {}),
  };
}
```

- [ ] **Step 4: Run — expect PASS.**
  `pnpm build && pnpm --filter @megasaver/core test`
  Expected: all core tests green (12 new in `lineage.test.ts`).

- [ ] **Step 5: Lint + typecheck.**
  `pnpm lint:fix && pnpm typecheck` — both exit 0.

- [ ] **Step 6: Commit.**
  `git add packages/core/src/supersession.ts packages/core/test/lineage.test.ts && git commit -m "feat(core): lineage and changedFrom helpers"`

---

### Task 5: `saveMemoryWithLineage` close ladder + core `index.ts` exports

The single write-path entry point (spec §4.2). BINDING flow:

1. `entry.supersedesId !== undefined` (explicit) ⇒ skip detection; create,
   then if `entry.approval === "approved"` run `applySupersession`
   (`closed` from its result). `opts.detect === false` ⇒ plain create.
2. Otherwise detect over
   `eligibleSupersessionCorpus(entry, registry.listMemoryEntries(entry.projectId), now)`:
   - `duplicate` ⇒ NO write; return the existing row + `deduped`.
   - `supersede`, `approval !== "approved"` ⇒ write with `supersedesId`
     (any via), `closed: false` — the close fires later at approval.
   - `supersede`, born-approved, via `"supersession"` (weak lexical class)
     ⇒ DOWNGRADE: no link, no close, evidence note
     `possible-supersedes:<id>` only, `supersession` field NOT set.
   - `supersede`, born-approved, via `"contradiction"`/`"cosine"` ⇒ write
     with `supersedesId`, then `applySupersession`.
   - `ambiguous` ⇒ write with `possible-supersedes:<id>` evidence per id.
   - `none` ⇒ plain create.
3. Detection wrapped in try/catch: any throw ⇒ plain create (fail-open).
4. supersedesId/evidence mutations happen BEFORE `createMemoryEntry`
   (create-time-immutable afterwards).

**Files:**

- Modify: `packages/core/src/supersession.ts`
- Modify: `packages/core/src/index.ts`
- Create (test): `packages/core/test/save-memory-with-lineage.test.ts`

**Steps:**

- [ ] **Step 1: Check the index export anchor (chunked).**
  `grep -n "conflict-checker" packages/core/src/index.ts` — expect one line:
  `export { checkConflicts, type ConflictOutcome, type ConflictResult } from "./conflict-checker.js";`

- [ ] **Step 2: Write the failing test.** Create
  `packages/core/test/save-memory-with-lineage.test.ts` with exactly (note:
  it imports from `../src/index.js` on purpose — this pins the public
  exports as part of the red/green cycle):

```ts
import type { MemoryEntryId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { POSSIBLE_SUPERSEDES_PREFIX, saveMemoryWithLineage } from "../src/index.js";
import { type MemoryEntry, memoryEntrySchema } from "../src/memory-entry.js";
import { type CoreRegistry, createInMemoryCoreRegistry } from "../src/registry.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ID_OLD = "00000000-0000-4000-8000-0000000000a1" as MemoryEntryId;
const ID_NEW = "00000000-0000-4000-8000-0000000000a2" as MemoryEntryId;
const ID_THIRD = "00000000-0000-4000-8000-0000000000a3" as MemoryEntryId;
const TS = "2026-07-13T00:00:00.000Z";
const NOW = "2026-07-13T12:00:00.000Z";
const now = () => NOW;

function mem(
  over: Omit<Partial<MemoryEntry>, "id"> & { id: string; content: string },
): MemoryEntry {
  return memoryEntrySchema.parse({
    id: over.id,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: over.type ?? "decision",
    title: over.title ?? over.content,
    content: over.content,
    keywords: over.keywords ?? [],
    confidence: "medium",
    source: over.source ?? "agent",
    approval: over.approval ?? "approved",
    stale: false,
    createdAt: over.createdAt ?? TS,
    updatedAt: over.updatedAt ?? TS,
    ...(over.relatedFiles !== undefined ? { relatedFiles: over.relatedFiles } : {}),
    ...(over.supersedesId !== undefined ? { supersedesId: over.supersedesId } : {}),
    ...(over.evidence !== undefined ? { evidence: over.evidence } : {}),
  });
}

function freshRegistry(): CoreRegistry {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: "/tmp/demo",
    createdAt: TS,
    updatedAt: TS,
  });
  return registry;
}

describe("saveMemoryWithLineage — close ladder", () => {
  it("suggested write with detected supersession: link carried, NO close", () => {
    const registry = freshRegistry();
    registry.createMemoryEntry(
      mem({ id: ID_OLD, content: "use npm for installs", relatedFiles: ["package.json"] }),
    );
    const candidate = mem({
      id: ID_NEW,
      content: "use pnpm for installs",
      relatedFiles: ["package.json"],
      approval: "suggested",
    });

    const result = saveMemoryWithLineage(registry, candidate, { now });

    expect(result.entry.supersedesId).toBe(ID_OLD);
    expect(result.supersession).toEqual({
      supersededId: ID_OLD,
      via: "supersession",
      closed: false,
    });
    expect(result.deduped).toBeUndefined();
    expect(registry.getMemoryEntry(ID_OLD)?.validTo).toBeUndefined();
  });

  it("born-approved + weak lexical class: DOWNGRADED to note-only (no link, no close)", () => {
    const registry = freshRegistry();
    registry.createMemoryEntry(
      mem({ id: ID_OLD, content: "use npm for installs", relatedFiles: ["package.json"] }),
    );
    const candidate = mem({
      id: ID_NEW,
      content: "use pnpm for installs",
      relatedFiles: ["package.json"],
      evidence: ["seed"],
    });

    const result = saveMemoryWithLineage(registry, candidate, { now });

    expect(result.supersession).toBeUndefined();
    expect(result.entry.supersedesId).toBeUndefined();
    expect(result.entry.evidence).toEqual(["seed", `${POSSIBLE_SUPERSEDES_PREFIX}${ID_OLD}`]);
    expect(registry.getMemoryEntry(ID_OLD)?.validTo).toBeUndefined();
  });

  it("born-approved + contradiction: link + immediate close", () => {
    const registry = freshRegistry();
    // Same-type corpus (eligibleSupersessionCorpus filters same type), so the
    // lexical contradiction class only fires on an equal-content polarity
    // flip: different content in same type + file overlap classifies as the
    // weak "supersession" class first (checkConflicts precedence).
    registry.createMemoryEntry(
      mem({
        id: ID_OLD,
        type: "project_rule",
        title: "merge gate",
        content: "tests must pass before merge",
        keywords: ["merge", "pass"],
        relatedFiles: ["ci.yml"],
      }),
    );
    const candidate = mem({
      id: ID_NEW,
      type: "project_rule",
      title: "merge gate override",
      content: "tests must pass before merge",
      keywords: ["merge", "skip"],
      relatedFiles: ["ci.yml"],
    });

    const result = saveMemoryWithLineage(registry, candidate, { now });

    expect(result.entry.supersedesId).toBe(ID_OLD);
    expect(result.supersession).toEqual({
      supersededId: ID_OLD,
      via: "contradiction",
      closed: true,
    });
    expect(registry.getMemoryEntry(ID_OLD)?.validTo).toBe(NOW);
  });

  it("born-approved + cosine >= 0.80: link + immediate close with score", () => {
    const registry = freshRegistry();
    registry.createMemoryEntry(
      mem({ id: ID_OLD, title: "auth middleware decision", content: "auth middleware uses jwt tokens" }),
    );
    const candidate = mem({
      id: ID_NEW,
      title: "auth middleware decision v2",
      content: "auth middleware uses session cookies",
    });

    const result = saveMemoryWithLineage(registry, candidate, {
      now,
      queryVector: Float32Array.from([1, 0]),
      memoryVectors: new Map<string, Float32Array>([[ID_OLD, Float32Array.from([1, 0])]]),
    });

    expect(result.entry.supersedesId).toBe(ID_OLD);
    expect(result.supersession).toEqual({
      supersededId: ID_OLD,
      via: "cosine",
      score: 1,
      closed: true,
    });
    expect(registry.getMemoryEntry(ID_OLD)?.validTo).toBe(NOW);
  });

  it("cosine ambiguous band: evidence note appended, no link, no close", () => {
    const registry = freshRegistry();
    registry.createMemoryEntry(
      mem({ id: ID_OLD, title: "auth middleware decision", content: "auth middleware uses jwt tokens" }),
    );
    const candidate = mem({
      id: ID_NEW,
      title: "auth middleware decision v2",
      content: "auth middleware uses session cookies",
      evidence: ["seed"],
    });

    const result = saveMemoryWithLineage(registry, candidate, {
      now,
      queryVector: Float32Array.from([1, 0]),
      memoryVectors: new Map<string, Float32Array>([[ID_OLD, Float32Array.from([1, 1])]]),
    });

    expect(result.supersession).toBeUndefined();
    expect(result.entry.supersedesId).toBeUndefined();
    expect(result.entry.evidence).toEqual(["seed", `${POSSIBLE_SUPERSEDES_PREFIX}${ID_OLD}`]);
    expect(registry.getMemoryEntry(ID_OLD)?.validTo).toBeUndefined();
  });

  it("explicit supersedesId beats detection (a duplicate that would dedupe is still written)", () => {
    const registry = freshRegistry();
    registry.createMemoryEntry(mem({ id: ID_OLD, content: "use npm for installs" }));
    registry.createMemoryEntry(mem({ id: ID_THIRD, content: "exact duplicate content" }));
    const candidate = mem({
      id: ID_NEW,
      content: "exact duplicate content",
      supersedesId: ID_OLD,
    });

    const result = saveMemoryWithLineage(registry, candidate, { now });

    expect(result.entry.id).toBe(ID_NEW);
    expect(result.deduped).toBeUndefined();
    expect(result.supersession).toEqual({
      supersededId: ID_OLD,
      via: "explicit",
      closed: true,
    });
    expect(registry.getMemoryEntry(ID_OLD)?.validTo).toBe(NOW);
    expect(registry.getMemoryEntry(ID_THIRD)?.validTo).toBeUndefined();
  });

  it("explicit supersedesId on a suggested write: passthrough, no close, no supersession field", () => {
    const registry = freshRegistry();
    registry.createMemoryEntry(mem({ id: ID_OLD, content: "use npm for installs" }));
    const candidate = mem({
      id: ID_NEW,
      content: "use pnpm for installs",
      approval: "suggested",
      supersedesId: ID_OLD,
    });

    const result = saveMemoryWithLineage(registry, candidate, { now });

    expect(result.entry.supersedesId).toBe(ID_OLD);
    expect(result.supersession).toBeUndefined();
    expect(registry.getMemoryEntry(ID_OLD)?.validTo).toBeUndefined();
  });

  it("detect: false -> plain create even when an exact duplicate exists", () => {
    const registry = freshRegistry();
    registry.createMemoryEntry(mem({ id: ID_THIRD, content: "exact duplicate content" }));
    const candidate = mem({ id: ID_NEW, content: "exact duplicate content" });

    const result = saveMemoryWithLineage(registry, candidate, { now, detect: false });

    expect(result.entry.id).toBe(ID_NEW);
    expect(result.deduped).toBeUndefined();
    expect(result.supersession).toBeUndefined();
    expect(registry.listMemoryEntries(candidate.projectId)).toHaveLength(2);
  });

  it("duplicate short-circuits: NO write, returns the existing row", () => {
    const registry = freshRegistry();
    registry.createMemoryEntry(mem({ id: ID_THIRD, content: "exact duplicate content" }));
    const candidate = mem({ id: ID_NEW, content: "exact duplicate content" });

    const result = saveMemoryWithLineage(registry, candidate, { now });

    expect(result.entry.id).toBe(ID_THIRD);
    expect(result.deduped).toEqual({ existingId: ID_THIRD });
    expect(result.supersession).toBeUndefined();
    expect(registry.getMemoryEntry(ID_NEW)).toBeNull();
    expect(registry.listMemoryEntries(candidate.projectId)).toHaveLength(1);
  });

  it("detection throw -> fail-open plain create", () => {
    const registry = freshRegistry();
    const throwing: CoreRegistry = {
      ...registry,
      listMemoryEntries: () => {
        throw new Error("boom");
      },
    };
    const candidate = mem({ id: ID_NEW, content: "auth uses JWT" });

    const result = saveMemoryWithLineage(throwing, candidate, { now });

    expect(result.entry.id).toBe(ID_NEW);
    expect(result.supersession).toBeUndefined();
    expect(result.deduped).toBeUndefined();
    expect(registry.getMemoryEntry(ID_NEW)).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run — expect FAIL.**
  `pnpm build && pnpm --filter @megasaver/core test`
  Expected: `save-memory-with-lineage.test.ts` fails with
  `No matching export in "src/index.ts" for import "saveMemoryWithLineage"`
  (neither the function nor the index re-export exists yet).

- [ ] **Step 4: Implement the function.** Append to
  `packages/core/src/supersession.ts`:

```ts
export type SaveMemoryLineageResult = {
  entry: MemoryEntry; // written row, or the existing row when deduped
  supersession?: {
    supersededId: MemoryEntryId;
    // "explicit" = caller-supplied supersedesId (no detection ran)
    via: "supersession" | "contradiction" | "cosine" | "explicit";
    score?: number;
    closed: boolean;
  };
  deduped?: { existingId: MemoryEntryId };
};

function withEvidenceNotes(entry: MemoryEntry, notes: readonly string[]): MemoryEntry {
  return { ...entry, evidence: [...(entry.evidence ?? []), ...notes] };
}

// The single write path for lineage-aware memory saves (spec §4.2). All entry
// mutation (supersedesId, evidence) happens BEFORE createMemoryEntry — both
// fields are create-time-immutable afterwards. The close ladder (architect
// #3): a weak lexical heuristic must never close at save time — suggested
// rows carry the link and close at approval; born-approved rows close only on
// explicit supersedesId or strong signals (contradiction / cosine >= 0.80).
export function saveMemoryWithLineage(
  registry: CoreRegistry,
  entry: MemoryEntry,
  opts: {
    now: () => string;
    detect?: boolean; // default true
    queryVector?: Float32Array;
    memoryVectors?: Map<string, Float32Array>;
  },
): SaveMemoryLineageResult {
  // Explicit supersedesId beats detection: the caller declared the target, so
  // detection must not second-guess (or dedupe away) the write. Explicit
  // intent is the human gate — born-approved closes immediately; suggested
  // rows keep today's passthrough (close fires at approval).
  if (entry.supersedesId !== undefined) {
    const created = registry.createMemoryEntry(entry);
    if (created.approval !== "approved") return { entry: created };
    const applied = applySupersession(registry, created, opts.now);
    return {
      entry: created,
      supersession: {
        supersededId: entry.supersedesId,
        via: "explicit",
        closed: applied.closed,
      },
    };
  }
  if (opts.detect === false) return { entry: registry.createMemoryEntry(entry) };

  let detection: SupersessionDetection;
  try {
    const now = opts.now();
    const corpus = eligibleSupersessionCorpus(
      entry,
      registry.listMemoryEntries(entry.projectId),
      now,
    );
    detection = detectSupersession(entry, corpus, now, {
      ...(opts.queryVector !== undefined ? { queryVector: opts.queryVector } : {}),
      ...(opts.memoryVectors !== undefined ? { memoryVectors: opts.memoryVectors } : {}),
    });
  } catch {
    // Fail-open (spec §7): detection must never block a save.
    return { entry: registry.createMemoryEntry(entry) };
  }

  if (detection.kind === "duplicate") {
    const existing = registry.getMemoryEntry(detection.existingId);
    // Detection ids come from this registry's live corpus; null means a
    // racing delete — fail open with a plain create rather than lose the write.
    if (existing === null) return { entry: registry.createMemoryEntry(entry) };
    return { entry: existing, deduped: { existingId: detection.existingId } };
  }

  if (detection.kind === "supersede") {
    const { supersededId, via } = detection;
    if (entry.approval !== "approved") {
      const created = registry.createMemoryEntry({ ...entry, supersedesId: supersededId });
      return {
        entry: created,
        supersession: {
          supersededId,
          via,
          ...(detection.score !== undefined ? { score: detection.score } : {}),
          closed: false,
        },
      };
    }
    if (via === "supersession") {
      // Born-approved + weak lexical class (mere file overlap + different
      // content): downgraded to the ambiguous treatment — evidence note only,
      // no link, no close (architect #3).
      const created = registry.createMemoryEntry(
        withEvidenceNotes(entry, [`${POSSIBLE_SUPERSEDES_PREFIX}${supersededId}`]),
      );
      return { entry: created };
    }
    const created = registry.createMemoryEntry({ ...entry, supersedesId: supersededId });
    const applied = applySupersession(registry, created, opts.now);
    return {
      entry: created,
      supersession: {
        supersededId,
        via,
        ...(detection.score !== undefined ? { score: detection.score } : {}),
        closed: applied.closed,
      },
    };
  }

  if (detection.kind === "ambiguous") {
    const created = registry.createMemoryEntry(
      withEvidenceNotes(
        entry,
        detection.possibleIds.map((id) => `${POSSIBLE_SUPERSEDES_PREFIX}${id}`),
      ),
    );
    return { entry: created };
  }

  return { entry: registry.createMemoryEntry(entry) };
}
```

- [ ] **Step 5: Add the public exports.** In `packages/core/src/index.ts`,
  find the line
  `export { checkConflicts, type ConflictOutcome, type ConflictResult } from "./conflict-checker.js";`
  and add directly AFTER it:

```ts
export {
  POSSIBLE_SUPERSEDES_PREFIX,
  SUPERSEDE_COSINE_AMBIGUOUS,
  SUPERSEDE_COSINE_LINK,
  SUPERSEDE_TOP_K,
  applySupersession,
  buildLineage,
  type ChangedFrom,
  changedFromFor,
  detectSupersession,
  eligibleSupersessionCorpus,
  type SaveMemoryLineageResult,
  saveMemoryWithLineage,
  type SupersessionDetection,
} from "./supersession.js";
```

- [ ] **Step 6: Run — expect PASS.**
  `pnpm build && pnpm --filter @megasaver/core test`
  Expected: all core tests green (10 new ladder tests). Every branch of the
  ladder is now covered: explicit-approved, explicit-suggested,
  detect:false, duplicate, suggested-link, weak-downgrade,
  contradiction-close, cosine-close, ambiguous-evidence, throw-fail-open,
  plain-none (implicitly via the throw test's created row).

- [ ] **Step 7: Lint + typecheck.**
  `pnpm lint:fix && pnpm typecheck` — both exit 0. (`pnpm typecheck` is the
  step that would catch any TS4111/exactOptionalPropertyTypes slip that
  vitest misses.)

- [ ] **Step 8: Commit.**
  `git add packages/core/src/supersession.ts packages/core/src/index.ts packages/core/test/save-memory-with-lineage.test.ts && git commit -m "feat(core): saveMemoryWithLineage close ladder"`

---

### Task 6: `lastActiveAt` — schema, patch schema, decay rekey, ranking pins

Adds the optional `lastActiveAt` datetime to `memoryEntrySchema`,
`overlayMemoryEntrySchema`, and `memoryEntryUpdatePatchSchema` (patchable;
the overlay patch alias `overlayMemoryEntryUpdatePatchSchema` is the same
object — no separate edit). Rekeys `effectiveConfidence` decay to
`lastActiveAt ?? updatedAt ?? createdAt`. Legacy rows (no `lastActiveAt`)
must rank bit-identically; an approve/reject/sweep that bumps `updatedAt` no
longer resets a memory's age. Writers setting the field at create/update are
LATER tasks — this task is schema + decay + pins only.

**Files:**

- Modify: `packages/core/src/memory-entry.ts`
- Modify (test): `packages/core/test/memory-search-decay.test.ts`

**Steps:**

- [ ] **Step 1: Read the current schema and decay code (chunked).**
  `grep -n "supersedesId\|effectiveConfidence\|validTo is patchable" packages/core/src/memory-entry.ts`
  then `sed -n '96,130p'`, `sed -n '198,220p'`, `sed -n '255,340p'` of the
  same file. Confirm: `supersedesId: memoryEntryIdSchema.optional(),`
  followed by the `// M2 tier.` comment appears exactly TWICE (main schema +
  overlay schema) — the schema edit below relies on that.

- [ ] **Step 2: Write the pin + failing tests.** In
  `packages/core/test/memory-search-decay.test.ts`:

  (a) Replace the import line
  `import { type MemoryEntry, memoryEntrySchema } from "../src/memory-entry.js";`
  with:

```ts
import {
  type MemoryEntry,
  effectiveConfidence,
  memoryEntrySchema,
  memoryEntryUpdatePatchSchema,
  overlayMemoryEntrySchema,
} from "../src/memory-entry.js";
```

  (b) In the `entry(...)` fixture helper, directly after the line
  `...(over.tier !== undefined ? { tier: over.tier } : {}),` add:

```ts
    ...(over.lastActiveAt !== undefined ? { lastActiveAt: over.lastActiveAt } : {}),
```

  (c) Append at the end of the file:

```ts
describe("lastActiveAt decay rekey", () => {
  const ID_A = "00000000-0000-4000-8000-0000000000e1";
  const ID_B = "00000000-0000-4000-8000-0000000000e2";

  it("pin: legacy rows without lastActiveAt rank exactly as before the rekey", () => {
    const fresh = entry({
      id: ID_A,
      content: "auth middleware decision",
      keywords: ["auth"],
      updatedAt: RECENT,
    });
    const stale = entry({
      id: ID_B,
      content: "auth middleware decision",
      keywords: ["auth"],
      updatedAt: OLD,
    });
    const result = searchMemoryEntries([stale, fresh], { text: "auth middleware", asOf: NOW });
    expect(result.map((e) => e.id)).toEqual([ID_A, ID_B]);
  });

  it("schema accepts lastActiveAt on entry, overlay, and update patch", () => {
    const withField = entry({ id: ID_A, content: "alpha decision", lastActiveAt: RECENT });
    expect(withField.lastActiveAt).toBe(RECENT);

    const overlay = overlayMemoryEntrySchema.parse({
      id: ID_B,
      workspaceKey: "/tmp/demo",
      liveSessionId: null,
      scope: "project",
      type: "decision",
      title: "alpha",
      content: "alpha",
      keywords: [],
      confidence: "medium",
      source: "manual",
      approval: "approved",
      stale: false,
      createdAt: RECENT,
      updatedAt: RECENT,
      lastActiveAt: RECENT,
    });
    expect(overlay.lastActiveAt).toBe(RECENT);

    const patch = memoryEntryUpdatePatchSchema.parse({ lastActiveAt: NOW, updatedAt: NOW });
    expect(patch.lastActiveAt).toBe(NOW);
  });

  it("decay keys on lastActiveAt when present", () => {
    const touchedRecently = entry({
      id: ID_A,
      content: "auth middleware decision",
      keywords: ["auth"],
      updatedAt: OLD,
      lastActiveAt: RECENT,
    });
    const touchedLongAgo = entry({
      id: ID_B,
      content: "auth middleware decision",
      keywords: ["auth"],
      updatedAt: RECENT,
      lastActiveAt: OLD,
    });
    const result = searchMemoryEntries([touchedLongAgo, touchedRecently], {
      text: "auth middleware",
      asOf: NOW,
    });
    expect(result.map((e) => e.id)).toEqual([ID_A, ID_B]);
  });

  it("an approval flip that bumps updatedAt no longer resets age", () => {
    const beforeFlip = entry({ id: ID_A, content: "alpha decision", updatedAt: OLD, lastActiveAt: OLD });
    const afterFlip = entry({ id: ID_A, content: "alpha decision", updatedAt: NOW, lastActiveAt: OLD });
    expect(effectiveConfidence(afterFlip, NOW)).toBe(effectiveConfidence(beforeFlip, NOW));

    const legacyOld = entry({ id: ID_B, content: "alpha decision", updatedAt: OLD });
    expect(effectiveConfidence(afterFlip, NOW)).toBe(effectiveConfidence(legacyOld, NOW));
  });
});
```

- [ ] **Step 3: Run — expect 3 FAIL, pin PASS.**
  `pnpm build && pnpm --filter @megasaver/core test`
  Expected: the `pin:` test PASSES (that is the point — it must be green
  both before and after the code change). The other three FAIL: the strict
  schemas reject the unknown `lastActiveAt` key (ZodError
  `unrecognized_keys`). NOTE: `pnpm typecheck` would also fail right now
  (`lastActiveAt` is not on `Partial<MemoryEntry>` yet) — that is expected
  in the red state; do not run it until after Step 4.

- [ ] **Step 4: Implement.** Three edits in
  `packages/core/src/memory-entry.ts`:

  (a) Schema field — this exact two-line pattern occurs TWICE
  (`memoryEntrySchema` and `overlayMemoryEntrySchema`); apply the same
  replacement to BOTH occurrences (`replace_all`):

  Old:

```ts
    supersedesId: memoryEntryIdSchema.optional(),
    // M2 tier. Absent ⇒ recall (see memoryTierSchema). Only the explicit sweep
```

  New:

```ts
    supersedesId: memoryEntryIdSchema.optional(),
    // Decay rekey (Living Brain): last time the CONTENT was touched. Set at
    // create by writers and by `mega memory update` on content-bearing
    // patches; approval flips and sweeps bump updatedAt but never this field.
    // Absent on legacy rows ⇒ decay falls back to updatedAt (bit-identical
    // pre-rekey behavior).
    lastActiveAt: z.string().datetime({ offset: true }).optional(),
    // M2 tier. Absent ⇒ recall (see memoryTierSchema). Only the explicit sweep
```

  (b) Update patch schema — old:

```ts
    // validTo is patchable so the supersede gate can close a memory's validity
    // (validFrom/supersedesId are set at create and immutable, like the key cols).
    validTo: z.string().datetime({ offset: true }).nullable().optional(),
```

  New:

```ts
    // validTo is patchable so the supersede gate can close a memory's validity
    // (validFrom/supersedesId are set at create and immutable, like the key cols).
    validTo: z.string().datetime({ offset: true }).nullable().optional(),
    // lastActiveAt is patchable so content-bearing updates can re-key decay.
    lastActiveAt: z.string().datetime({ offset: true }).optional(),
```

  (c) `effectiveConfidence` — old:

```ts
// M2: effective confidence for RANKING only — a pure read-time function that
// never mutates the stored `confidence`. effective = baseWeight(confidence) ×
// ageDecay(now − updatedAt) × tierWeight(tier). Older memories rank lower; the
// working tier ranks slightly higher. Always > 0, so a current memory is only
// ever DOWN-RANKED by decay, never dropped. `now` is an ISO-8601 datetime.
export function effectiveConfidence(
  memory: Pick<MemoryEntry, "confidence" | "tier" | "createdAt" | "updatedAt">,
  now: string,
): number {
  const at = Date.parse(now);
  const ref = Date.parse(memory.updatedAt ?? memory.createdAt);
```

  New:

```ts
// M2: effective confidence for RANKING only — a pure read-time function that
// never mutates the stored `confidence`. effective = baseWeight(confidence) ×
// ageDecay(now − lastActiveAt) × tierWeight(tier), falling back to updatedAt
// then createdAt for legacy rows (bit-identical pre-rekey ordering). Approval
// flips and sweeps bump updatedAt but never lastActiveAt, so they no longer
// reset a memory's age. Older memories rank lower; the working tier ranks
// slightly higher. Always > 0, so a current memory is only ever DOWN-RANKED
// by decay, never dropped. `now` is an ISO-8601 datetime.
export function effectiveConfidence(
  memory: Pick<MemoryEntry, "confidence" | "tier" | "createdAt" | "updatedAt" | "lastActiveAt">,
  now: string,
): number {
  const at = Date.parse(now);
  const ref = Date.parse(memory.lastActiveAt ?? memory.updatedAt ?? memory.createdAt);
```

  The rest of the function body (NaN guard, weight product) is unchanged.
  Do NOT touch `sweepMemoryTiers` — its idle keying stays on
  `updatedAt ?? createdAt` by design (spec §4.3, out of scope).

- [ ] **Step 5: Run — expect PASS.**
  `pnpm build && pnpm --filter @megasaver/core test`
  Expected: all core tests green — the 4 new tests AND every pre-existing
  test in `memory-search-decay.test.ts` and `memory-tier-decay.test.ts`
  (legacy fixtures have no `lastActiveAt`, so the fallback keeps them
  bit-identical; any failure there means the rekey broke back-compat — stop
  and fix, do not adjust the old tests).

- [ ] **Step 6: Lint + typecheck.**
  `pnpm lint:fix && pnpm typecheck` — both exit 0. The full repo typecheck
  matters here: `effectiveConfidence`'s widened `Pick` and the schema change
  flow into `@megasaver/cli` / `@megasaver/mcp-bridge` type surfaces.

- [ ] **Step 7: Commit.**
  `git add packages/core/src/memory-entry.ts packages/core/test/memory-search-decay.test.ts && git commit -m "feat(core): rekey decay to lastActiveAt"`
# Section 2 — mcp-bridge write path (Tasks 7–8)

**Prereq:** Tasks 1–6 (core `packages/core/src/supersession.ts` + `index.ts` exports:
`applySupersession`, `saveMemoryWithLineage`, `SaveMemoryLineageResult`) are merged into the
execution worktree. Both tasks below import them from `@megasaver/core` and will not compile
before that.

**Where to run:** the execution worktree `.claude/worktrees/living-brain` (branch
`feat/living-brain`, stacked on `feat/guard`). All commands from its repo root:
`cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain`.

**ENVIRONMENT HAZARDS (apply to every step):**
- Mega Saver MCP read-proxy SILENTLY TRUNCATES file reads (banner "N kept, M dropped" /
  "[Mega Saver: compressed...]") — read files via `sed -n 'A,Bp'` in <=60-line chunks, locate
  with `grep -n`. Never trust a whole-file read.
- `pnpm build` BEFORE package tests (dist resolution).
- `pnpm --filter X test -- pattern` does NOT narrow — run the whole package suite.
- Full `pnpm typecheck` REQUIRED before every commit — package vitest does NOT catch TS4111
  (noPropertyAccessFromIndexSignature). Use bracket access +
  `// biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)`
  where needed.
- No bare `===` in zsh echo commands.

---

### Task 7: approve-memory — applySupersession refactor, declared-target exemption, superseded disclosure

**Files:**
- Modify: `packages/mcp-bridge/src/tools/approve-memory.ts`
- Test (append only): `packages/mcp-bridge/test/approve-memory.test.ts` — the existing 703
  lines are the pure-refactor gate and MUST stay green unchanged
- Create: `.changeset/bridge-declared-target-exemption.md`

**Pure-refactor gate (say it out loud):** part (a) of this task replaces the inline
validTo-close block with core's `applySupersession` with byte-identical behavior. The proof is
that the existing 703-line `packages/mcp-bridge/test/approve-memory.test.ts` (plus
`approve-memory-canonicalization.test.ts` and `approve-memory-serialization.test.ts`) passes
with ZERO test modifications, via:

```bash
pnpm build && pnpm --filter @megasaver/mcp-bridge test
```

- [ ] **Step 1: Orient (read the current file — sed chunks only).**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain
grep -n "supersedesId\|conflict.outcome\|ApproveMemoryResult" packages/mcp-bridge/src/tools/approve-memory.ts
sed -n '1,60p'   packages/mcp-bridge/src/tools/approve-memory.ts
sed -n '60,120p' packages/mcp-bridge/src/tools/approve-memory.ts
sed -n '120,180p' packages/mcp-bridge/src/tools/approve-memory.ts
sed -n '180,240p' packages/mcp-bridge/src/tools/approve-memory.ts
sed -n '240,285p' packages/mcp-bridge/src/tools/approve-memory.ts
```

Confirm: the quarantine gate is the `if (validation.status !== "valid" || conflict.outcome !== "unrelated")`
block (~line 156), the inline close block is the
`if (approval === "approved" && updated.supersedesId !== undefined)` block (~lines 177–202),
and the duplicate auto-reject sits BEFORE the gate (~line 141).

- [ ] **Step 2: Write the failing tests (append at the very end of `packages/mcp-bridge/test/approve-memory.test.ts`).**

All imports/consts used below (`createInMemoryCoreRegistry`, `handleApproveMemory`,
`MemoryEntryId`, `PROJECT_ID`, `TS`, `describe`/`expect`/`it`) already exist at the top of the
file. Append exactly:

```typescript
const TGT_ID = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1" as MemoryEntryId;
const CAND_ID = "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2" as MemoryEntryId;
const BYS_ID = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3" as MemoryEntryId;

// Living brain §3.1 declared-target exemption. The suggested candidate LEXICALLY
// conflicts (supersession class: same type + relatedFiles overlap + different
// content) with the row it declares via supersedesId. Pre-exemption the
// quarantine gate blocked this flip, so create-time links could never close at
// approval. Bystander is created FIRST so checkConflicts' .find() hits it before
// the declared target (architect #7 pin).
function declaredConflictRegistry(
  over: { link?: boolean; bystander?: boolean; duplicate?: boolean } = {},
) {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: "/tmp/demo",
    createdAt: TS,
    updatedAt: TS,
  });
  if (over.bystander === true) {
    registry.createMemoryEntry({
      id: BYS_ID,
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      type: "decision",
      title: "Region latency notes",
      content: "Latency benchmarks for candidate regions.",
      keywords: [],
      confidence: "medium",
      source: "manual",
      stale: false,
      approval: "approved",
      relatedFiles: ["src/deploy.ts"],
      createdAt: TS,
      updatedAt: TS,
    });
  }
  registry.createMemoryEntry({
    id: TGT_ID,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "Deploy region us-east",
    content: "Primary deploy region is us-east.",
    keywords: [],
    confidence: "medium",
    source: "manual",
    stale: false,
    approval: "approved",
    relatedFiles: ["src/deploy.ts"],
    createdAt: TS,
    updatedAt: TS,
  });
  registry.createMemoryEntry({
    id: CAND_ID,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: over.duplicate === true ? "Deploy region us-east" : "Deploy region eu-west",
    content:
      over.duplicate === true
        ? "Primary deploy region is us-east."
        : "Primary deploy region is eu-west.",
    keywords: [],
    confidence: "medium",
    source: "manual",
    stale: false,
    approval: "suggested",
    relatedFiles: ["src/deploy.ts"],
    ...(over.link === false ? {} : { supersedesId: TGT_ID }),
    createdAt: TS,
    updatedAt: TS,
  });
  return registry;
}

describe("approve_memory declared-target exemption (living brain §3.1)", () => {
  const APPROVE_AT = "2026-06-26T00:00:00.000Z";

  it("flips a linked candidate whose only conflict is its declared target, closes it, and reports superseded", async () => {
    const registry = declaredConflictRegistry();
    const result = await handleApproveMemory(
      { registry, storeRoot: "", now: () => APPROVE_AT },
      { memoryEntryId: CAND_ID, approval: "approved" },
    );
    expect(result.approval).toBe("approved");
    expect(result.superseded).toEqual({ id: TGT_ID, title: "Deploy region us-east" });
    expect(registry.getMemoryEntry(CAND_ID as never)?.approval).toBe("approved");
    expect(registry.getMemoryEntry(TGT_ID as never)?.validTo).toBe(APPROVE_AT);
  });

  it("still quarantines an UNLINKED supersession conflict (no supersedesId declared)", async () => {
    const registry = declaredConflictRegistry({ link: false });
    const result = await handleApproveMemory(
      { registry, storeRoot: "", now: () => APPROVE_AT },
      { memoryEntryId: CAND_ID, approval: "approved" },
    );
    expect(result.approval).toBe("suggested");
    expect(result.conflict?.outcome).toBe("supersession");
    expect(result.superseded).toBeUndefined();
    expect(registry.getMemoryEntry(TGT_ID as never)?.validTo).toBeUndefined();
  });

  it("still quarantines when the first conflict is a BYSTANDER, not the declared target (architect #7 pin)", async () => {
    const registry = declaredConflictRegistry({ bystander: true });
    const result = await handleApproveMemory(
      { registry, storeRoot: "", now: () => APPROVE_AT },
      { memoryEntryId: CAND_ID, approval: "approved" },
    );
    expect(result.approval).toBe("suggested");
    expect(result.conflict?.conflictIds).toEqual([BYS_ID]);
    expect(result.superseded).toBeUndefined();
    expect(registry.getMemoryEntry(TGT_ID as never)?.validTo).toBeUndefined();
  });

  it("a duplicate of the declared target still auto-rejects (exemption never reaches the duplicate branch)", async () => {
    const registry = declaredConflictRegistry({ duplicate: true });
    const result = await handleApproveMemory(
      { registry, storeRoot: "", now: () => APPROVE_AT },
      { memoryEntryId: CAND_ID, approval: "approved" },
    );
    expect(result.approval).toBe("rejected");
    expect(result.conflict?.outcome).toBe("duplicate");
    expect(registry.getMemoryEntry(TGT_ID as never)?.validTo).toBeUndefined();
  });
});
```

Fixture rationale (do not change the shapes): `checkConflicts` classifies the candidate vs the
target as `supersession` because both are type `decision`, share `relatedFiles:
["src/deploy.ts"]`, and have different content. `source: "manual"` + `confidence: "medium"`
mirrors the existing `supersedeRegistry` fixture so `validateSave` passes cleanly and the test
isolates the conflict gate. `storeRoot: ""` makes the M3 semantic pass a no-op (existing
pattern).

- [ ] **Step 3: Run — expect RED (exactly one new failure).**

```bash
pnpm build && pnpm --filter @megasaver/mcp-bridge test
```

Expected: FAIL. The single failing test is
`approve_memory declared-target exemption (living brain §3.1) > flips a linked candidate ...`
with `expected 'suggested' to be 'approved'` (today the supersession conflict quarantines the
flip). The other three new tests PASS (they pin today's behavior). Every pre-existing test
passes. (`result.superseded` is a TS-only error at this point; vitest does not typecheck, so
the red run works.)

- [ ] **Step 4: Implement — five surgical edits to `packages/mcp-bridge/src/tools/approve-memory.ts`.**

**Edit 4a — import `applySupersession`.** Old:

```typescript
import {
  type ConflictOutcome,
  type CoreRegistry,
  type EmbedFn,
  type MemoryApproval,
  type MemoryEntry,
  type MemoryValidation,
  type ValidationStatus,
  checkConflicts,
  isRecallable,
  memoryEmbedText,
  memoryEmbeddingsSidecarPath,
  validateSave,
} from "@megasaver/core";
```

New:

```typescript
import {
  type ConflictOutcome,
  type CoreRegistry,
  type EmbedFn,
  type MemoryApproval,
  type MemoryEntry,
  type MemoryValidation,
  type ValidationStatus,
  applySupersession,
  checkConflicts,
  isRecallable,
  memoryEmbedText,
  memoryEmbeddingsSidecarPath,
  validateSave,
} from "@megasaver/core";
```

**Edit 4b — widen `ApproveMemoryResult`.** Old:

```typescript
export interface ApproveMemoryResult {
  id: string;
  approval: MemoryApproval;
  validation?: { status: ValidationStatus; reasons: readonly string[] };
  conflict?: { outcome: ConflictOutcome; conflictIds: readonly MemoryEntryId[] };
}
```

New:

```typescript
export interface ApproveMemoryResult {
  id: string;
  approval: MemoryApproval;
  validation?: { status: ValidationStatus; reasons: readonly string[] };
  conflict?: { outcome: ConflictOutcome; conflictIds: readonly MemoryEntryId[] };
  // Decision-surface disclosure (living brain, architect #6): present ONLY when
  // this approval actually closed a superseded row's validity.
  superseded?: { id: string; title: string };
}
```

**Edit 4c — declared-target exemption in the quarantine gate.** Old:

```typescript
    // Any non-valid validation or any non-unrelated conflict blocks the flip: the
    // row stays `suggested` and the reasons are surfaced for the human to resolve.
    if (validation.status !== "valid" || conflict.outcome !== "unrelated") {
```

New:

```typescript
    // Any non-valid validation or any non-unrelated conflict blocks the flip: the
    // row stays `suggested` and the reasons are surfaced for the human to resolve.
    // EXCEPT the declared target (living brain §3.1): a supersession/contradiction
    // conflict whose single conflictId IS the row this candidate declares via
    // supersedesId is not a blocker — the candidate exists to replace that row,
    // and approval resolves the conflict through the validTo close below. Any
    // bystander conflict (different id) still quarantines; duplicate never
    // reaches here (auto-rejected above).
    const declaredTarget =
      (conflict.outcome === "supersession" || conflict.outcome === "contradiction") &&
      conflict.conflictIds.length === 1 &&
      conflict.conflictIds[0] === existing.supersedesId;
    if (validation.status !== "valid" || (conflict.outcome !== "unrelated" && !declaredTarget)) {
```

**Edit 4d — replace the inline close block with `applySupersession` (pure refactor).** Old
(the entire block after `const updated = env.registry.updateMemoryEntry(id, { approval, updatedAt: env.now() });`):

```typescript
  // Bi-temporal supersession (M1): approving a memory that supersedes an older
  // one closes the old one's valid-time (validTo = now) so it drops out of
  // current-by-default recall. The old row is NOT deleted — kept for time-travel
  // (lossless). Only on approve; a reject leaves all validity untouched.
  if (approval === "approved" && updated.supersedesId !== undefined) {
    const superseded = env.registry.getMemoryEntry(updated.supersedesId as MemoryEntryId);
    // supersedesId is agent-controlled (save_memory passes it through; the schema
    // only checks UUID shape). Validate the target before closing its validity, or
    // an agent could (a) close a CURRENT memory in another project/scope it should
    // not touch, or (b) self-reference to close its own validity — approved yet
    // instantly non-current, silently vanishing from default recall. So close ONLY
    // a different, same-project, same-scope, still-open target.
    const targetIsValid =
      superseded !== null &&
      superseded.id !== updated.id &&
      superseded.projectId === updated.projectId &&
      superseded.scope === updated.scope &&
      superseded.validTo == null;
    if (targetIsValid) {
      env.registry.updateMemoryEntry(updated.supersedesId as MemoryEntryId, {
        validTo: env.now(),
        updatedAt: env.now(),
      });
    }
  }
```

New:

```typescript
  // Bi-temporal supersession (M1): approving a memory that supersedes an older
  // one closes the old one's valid-time (validTo = now) so it drops out of
  // current-by-default recall. The close — including the tamper guard that
  // validates the agent-controlled target (non-self, same-project, same-scope,
  // still-open) — now lives in core's applySupersession, shared with
  // saveMemoryWithLineage. Only on approve; a reject leaves validity untouched.
  const supersessionResult =
    approval === "approved" ? applySupersession(env.registry, updated, env.now) : undefined;
```

**Edit 4e — surface `superseded` on both success returns.** Old:

```typescript
  if (reasons.length > 0) {
    return {
      id: updated.id,
      approval: updated.approval,
      validation: { status: "valid", reasons },
      conflict: { outcome: "unrelated", conflictIds: semantic.conflictIds },
    };
  }
  return { id: updated.id, approval: updated.approval };
```

New:

```typescript
  const supersededField =
    supersessionResult?.superseded !== undefined
      ? { superseded: supersessionResult.superseded }
      : {};
  if (reasons.length > 0) {
    return {
      id: updated.id,
      approval: updated.approval,
      validation: { status: "valid", reasons },
      conflict: { outcome: "unrelated", conflictIds: semantic.conflictIds },
      ...supersededField,
    };
  }
  return { id: updated.id, approval: updated.approval, ...supersededField };
```

(The conditional spread is required by `exactOptionalPropertyTypes` — never assign
`superseded: undefined`.)

- [ ] **Step 5: Run — expect GREEN, including the pure-refactor gate.**

```bash
pnpm build && pnpm --filter @megasaver/mcp-bridge test
```

Expected: PASS, zero failures. This run is the explicit evidence that the 703-line
`test/approve-memory.test.ts` stays green with the close block refactored into
`applySupersession` (the existing `approve_memory closes superseded validity` and
`supersedesId validation (recall-loss / tamper guard)` describes exercise every guard branch),
and that `approve-memory-canonicalization.test.ts` / `approve-memory-serialization.test.ts`
are untouched. If ANY pre-existing test fails, the refactor is not pure — fix
`applySupersession` usage, never the tests.

- [ ] **Step 6: Changeset.** Create `.changeset/bridge-declared-target-exemption.md`:

```markdown
---
"@megasaver/mcp-bridge": minor
---

approve_memory: declared-target exemption in the quarantine gate and a
`superseded` disclosure field on the result when an approval closes a
superseded memory's validity.
```

- [ ] **Step 7: Lint + typecheck (required before every commit).**

```bash
pnpm lint:fix && pnpm typecheck
```

Expected: both exit 0 (biome may rewrap long lines; re-run tests only if it touched source).

- [ ] **Step 8: Commit.**

```bash
git add packages/mcp-bridge/src/tools/approve-memory.ts packages/mcp-bridge/test/approve-memory.test.ts .changeset/bridge-declared-target-exemption.md
git commit -m "$(cat <<'EOF'
feat(mcp-bridge): declared-target exemption

Create-time supersession links (living brain §4.2) made the approve
quarantine gate a deadlock: the same conflict that justified the link
blocked the flip, so the validTo close could never run. Exemption is
scoped to the exact declared target (single conflictId == supersedesId,
supersession/contradiction only); duplicates still auto-reject and
bystander conflicts still quarantine. The inline close block moved to
core applySupersession (pure refactor, existing suite green) and the
result now discloses what the approval closed.
EOF
)"
```

---

### Task 8: save_memory lineage + detect:false twins + task status --save-summary

**Files:**
- Modify: `packages/mcp-bridge/src/tools/save-memory.ts`
- Modify: `packages/mcp-bridge/src/server.ts` (save_memory dispatch gains `storeRoot`)
- Modify: `packages/mcp-bridge/src/tools/from-session-memory.ts` (detect:false)
- Modify: `apps/cli/src/commands/memory/from-session.ts` (detect:false)
- Modify: `apps/cli/src/commands/task/status.ts` (detect on, stderr disclosure)
- Test (append only): `packages/mcp-bridge/test/tools/memory-tools.test.ts`
- Test (append only): `apps/cli/test/task.test.ts`
- Green gates (unchanged, MUST stay green — this IS the "detect:false byte-identical" evidence):
  `packages/mcp-bridge/test/tools/from-session-memory.test.ts`,
  `apps/cli/test/memory-from-session.test.ts`
- Create: `.changeset/save-path-lineage.md`

- [ ] **Step 1: Write the failing save_memory tests (append to `packages/mcp-bridge/test/tools/memory-tools.test.ts`).**

First change the shared import at the top of the file. Old:

```typescript
import type { ProjectId } from "@megasaver/shared";
```

New:

```typescript
import type { MemoryEntryId, ProjectId } from "@megasaver/shared";
```

Then append at the very end of the file (uses the existing `seededRegistry`, `idFactory`,
`PROJECT_ID`, `TS` helpers):

```typescript
const RULE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" as MemoryEntryId;
const LATER_TS = "2026-06-12T00:00:00.000Z";

// An approved project_rule the candidates below collide with. Contradiction
// fixture shape (core conflict-checker): same type + relatedFiles overlap +
// SAME normalized content (so the higher-precedence supersession class cannot
// shadow contradiction) + negation-keyword XOR ("never" on the candidate only).
function ruleSeededRegistry(): CoreRegistry {
  const registry = seededRegistry();
  registry.createMemoryEntry({
    id: RULE_ID,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "project_rule",
    title: "Deploy region rule",
    content: "deploy to us-east",
    keywords: ["deploy"],
    confidence: "medium",
    source: "manual",
    stale: false,
    approval: "approved",
    relatedFiles: ["src/deploy.ts"],
    createdAt: TS,
    updatedAt: TS,
  });
  return registry;
}

describe("save_memory supersession lineage (living brain)", () => {
  it("links a detected contradiction on a suggested write (no close) and reports it", async () => {
    const registry = ruleSeededRegistry();
    const result = await handleSaveMemory(
      { registry, now: () => LATER_TS, newId: idFactory() },
      {
        projectId: PROJECT_ID,
        scope: "project",
        type: "project_rule",
        title: "Never deploy region rule",
        content: "deploy to us-east",
        keywords: ["never"],
        relatedFiles: ["src/deploy.ts"],
      },
    );
    expect(result.supersession).toEqual({
      supersededId: RULE_ID,
      via: "contradiction",
      closed: false,
    });
    const stored = registry.getMemoryEntry(result.id as never);
    expect(stored?.supersedesId).toBe(RULE_ID);
    expect(registry.getMemoryEntry(RULE_ID as never)?.validTo).toBeUndefined();
  });

  it("closes the contradicted rule when the write is born approved (closed: true)", async () => {
    const registry = ruleSeededRegistry();
    const result = await handleSaveMemory(
      { registry, now: () => LATER_TS, newId: idFactory() },
      {
        projectId: PROJECT_ID,
        scope: "project",
        type: "project_rule",
        title: "Never deploy region rule",
        content: "deploy to us-east",
        keywords: ["never"],
        relatedFiles: ["src/deploy.ts"],
        approval: "approved",
      },
    );
    expect(result.supersession).toEqual({
      supersededId: RULE_ID,
      via: "contradiction",
      closed: true,
    });
    expect(registry.getMemoryEntry(RULE_ID as never)?.validTo).toBe(LATER_TS);
  });

  it("dedupes an exact duplicate of an approved memory (no write, existing id returned)", async () => {
    const registry = ruleSeededRegistry();
    const result = await handleSaveMemory(
      { registry, now: () => LATER_TS, newId: idFactory() },
      {
        projectId: PROJECT_ID,
        scope: "project",
        type: "project_rule",
        title: "Deploy region rule",
        content: "deploy to us-east",
      },
    );
    expect(result.id).toBe(RULE_ID);
    expect(result.deduped).toEqual({ existingId: RULE_ID });
    expect(result.supersession).toBeUndefined();
    expect(registry.listMemoryEntries(PROJECT_ID)).toHaveLength(1);
  });

  it("explicit supersedesId passthrough is unchanged (suggested: stored link, no close)", async () => {
    const registry = ruleSeededRegistry();
    const result = await handleSaveMemory(
      { registry, now: () => LATER_TS, newId: idFactory() },
      {
        projectId: PROJECT_ID,
        scope: "project",
        content: "we moved deploys to eu-west",
        supersedesId: RULE_ID,
      },
    );
    const stored = registry.getMemoryEntry(result.id as never);
    expect(stored?.supersedesId).toBe(RULE_ID);
    expect(registry.getMemoryEntry(RULE_ID as never)?.validTo).toBeUndefined();
  });
});
```

Note: the passthrough test deliberately does NOT pin `result.supersession` presence/shape for
the explicit path — the contract binds only the behavior (stored link, no close on a suggested
write); the core section owns the explicit-path result field.

- [ ] **Step 2: Run — expect RED.**

```bash
pnpm build && pnpm --filter @megasaver/mcp-bridge test
```

Expected: FAIL — exactly three new failures in
`save_memory supersession lineage (living brain)`:
- "links a detected contradiction..." — `result.supersession` is `undefined`.
- "closes the contradicted rule..." — `result.supersession` is `undefined`.
- "dedupes an exact duplicate..." — `result.id` is the fresh id
  `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, not `RULE_ID`, and length is 2.

The passthrough test PASSES today (regression pin). Everything else green.

- [ ] **Step 3: Implement `packages/mcp-bridge/src/tools/save-memory.ts` — replace the entire file with:**

```typescript
import {
  type CoreRegistry,
  type MemoryEntry,
  type SaveMemoryLineageResult,
  memoryApprovalSchema,
  memoryConfidenceSchema,
  memoryEmbedText,
  memoryEmbeddingsSidecarPath,
  memoryEntrySchema,
  memoryScopeSchema,
  memorySourceSchema,
  memoryTypeSchema,
  saveMemoryWithLineage,
} from "@megasaver/core";
import { CoreRegistryError } from "@megasaver/core";
import { embed, readVectors } from "@megasaver/embeddings";
import type { ProjectId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type SaveMemoryEnv = {
  registry: CoreRegistry;
  now: () => string;
  newId: () => string;
  // Cosine supersession inputs are best-effort: storeRoot locates the memory
  // vector sidecar; embedFn is injectable so tests never load the real model.
  storeRoot?: string;
  embedFn?: (texts: readonly string[]) => Promise<Float32Array[]>;
};

export type SaveMemoryResult = {
  id: string;
  supersession?: SaveMemoryLineageResult["supersession"];
  deduped?: SaveMemoryLineageResult["deduped"];
};

const saveMemoryInputSchema = z
  .object({
    projectId: z.string().min(1),
    scope: memoryScopeSchema,
    content: z.string().min(1),
    type: memoryTypeSchema.optional(),
    title: z.string().min(1).optional(),
    keywords: z.array(z.string()).optional(),
    confidence: memoryConfidenceSchema.optional(),
    source: memorySourceSchema.optional(),
    approval: memoryApprovalSchema.optional(),
    sessionId: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
    goal: z.string().min(1).optional(),
    relatedFiles: z.array(z.string()).optional(),
    expiresAt: z.string().datetime({ offset: true }).optional(),
    supersedesId: z.string().min(1).optional(),
  })
  .strict();

// CoreRegistry failures carry a closed code; surface it as the matching wire
// code so an MCP client sees why the write was rejected.
function mapCoreError(err: unknown): McpBridgeError {
  if (err instanceof CoreRegistryError) {
    if (err.code === "session_not_found") {
      return new McpBridgeError("session_not_found", err.message);
    }
    if (err.code === "project_not_found") {
      return new McpBridgeError("resource_not_found", err.message);
    }
    return new McpBridgeError("validation_failed", err.message);
  }
  if (err instanceof Error) return new McpBridgeError("validation_failed", err.message);
  return new McpBridgeError("validation_failed", "save_memory failed");
}

// Best-effort cosine inputs for supersession detection (living brain §4.2):
// only when a storeRoot is configured AND the sidecar has vectors. Embeds the
// candidate's title+content once. Any failure (no model, unreadable sidecar)
// degrades to lexical-only detection — never blocks the save.
async function cosineInputsFor(
  env: SaveMemoryEnv,
  entry: MemoryEntry,
): Promise<{ queryVector: Float32Array; memoryVectors: Map<string, Float32Array> } | undefined> {
  if (env.storeRoot === undefined) return undefined;
  try {
    const memoryVectors = readVectors(
      memoryEmbeddingsSidecarPath(env.storeRoot, entry.projectId as ProjectId),
    );
    if (memoryVectors.size === 0) return undefined;
    const [queryVector] = await (env.embedFn ?? embed)([memoryEmbedText(entry)]);
    if (queryVector === undefined) return undefined;
    return { queryVector, memoryVectors };
  } catch {
    return undefined;
  }
}

export async function handleSaveMemory(
  env: SaveMemoryEnv,
  rawArgs: unknown,
): Promise<SaveMemoryResult> {
  const parsed = saveMemoryInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const d = parsed.data;

  let entry: MemoryEntry;
  try {
    entry = memoryEntrySchema.parse({
      id: env.newId(),
      projectId: d.projectId,
      sessionId: d.sessionId ?? null,
      scope: d.scope,
      type: d.type ?? "todo",
      title: d.title ?? d.content,
      content: d.content,
      keywords: d.keywords ?? [],
      confidence: d.confidence ?? "medium",
      source: d.source ?? "agent",
      approval: d.approval ?? "suggested",
      ...(d.reason !== undefined ? { reason: d.reason } : {}),
      ...(d.goal !== undefined ? { goal: d.goal } : {}),
      ...(d.relatedFiles !== undefined ? { relatedFiles: d.relatedFiles } : {}),
      ...(d.expiresAt !== undefined ? { expiresAt: d.expiresAt } : {}),
      ...(d.supersedesId !== undefined ? { supersedesId: d.supersedesId } : {}),
      createdAt: env.now(),
      updatedAt: env.now(),
    });
  } catch (err) {
    throw new McpBridgeError(
      "validation_failed",
      err instanceof Error ? err.message : "invalid memory entry",
    );
  }

  const cosineInputs = await cosineInputsFor(env, entry);
  try {
    const result = saveMemoryWithLineage(env.registry, entry, {
      now: env.now,
      ...(cosineInputs ?? {}),
    });
    return {
      id: result.entry.id,
      ...(result.supersession !== undefined ? { supersession: result.supersession } : {}),
      ...(result.deduped !== undefined ? { deduped: result.deduped } : {}),
    };
  } catch (err) {
    throw mapCoreError(err);
  }
}
```

(`memoryEmbedText(entry)` returns exactly `` `${entry.title}\n${entry.content}` `` —
`packages/core/src/embed-memory.ts:59` — so this matches the contract's embed-text string and
the pattern approve-memory.ts already uses.)

Then edit `packages/mcp-bridge/src/server.ts` — the save_memory dispatch (~line 356). Old:

```typescript
      case "save_memory":
        return handleSaveMemory({ registry: deps.registry, now, newId }, args);
```

New:

```typescript
      case "save_memory":
        return handleSaveMemory(
          { registry: deps.registry, storeRoot: deps.storeRoot, now, newId },
          args,
        );
```

(`storeRoot` is already a required field of `ServerDeps` at server.ts:92. `embedFn` is
deliberately NOT added to `ServerDeps` — production falls back to the real `embed` via
`env.embedFn ?? embed`, the same convention as approve_memory and get_relevant_memories.)

- [ ] **Step 4: Run — expect GREEN.**

```bash
pnpm build && pnpm --filter @megasaver/mcp-bridge test
```

Expected: PASS, zero failures — the four new lineage tests pass and every pre-existing
save_memory/search/get_relevant_memories/approve/from-session test stays green (the response
change is additive; detection over an empty approved corpus is `none` ⇒ plain create).

- [ ] **Step 5: from-session twins — detect:false (pure rewire, existing tests are the byte-identity gate).**

**5a — `packages/mcp-bridge/src/tools/from-session-memory.ts`.** Old import:

```typescript
import {
  type CoreRegistry,
  CoreRegistryError,
  type MemoryEntry,
  extractSessionMemories,
  memoryEntrySchema,
} from "@megasaver/core";
```

New:

```typescript
import {
  type CoreRegistry,
  CoreRegistryError,
  type MemoryEntry,
  extractSessionMemories,
  memoryEntrySchema,
  saveMemoryWithLineage,
} from "@megasaver/core";
```

Old (inside the candidate loop, line ~88):

```typescript
      env.registry.createMemoryEntry(entry);
```

New:

```typescript
      // detect: false (living brain, architect #5): N terse extracted candidates
      // sharing the same session files would mass-auto-link against approved
      // rows and prime a bulk-approval mass-close. The from-session: dedupe
      // keyword stays the only dedupe on this path.
      saveMemoryWithLineage(env.registry, entry, { now: env.now, detect: false });
```

**5b — `apps/cli/src/commands/memory/from-session.ts`.** Old import:

```typescript
import { type MemoryEntry, extractSessionMemories, memoryEntrySchema } from "@megasaver/core";
```

New:

```typescript
import {
  type MemoryEntry,
  extractSessionMemories,
  memoryEntrySchema,
  saveMemoryWithLineage,
} from "@megasaver/core";
```

Old (inside the candidate loop, line ~112):

```typescript
      registry.createMemoryEntry(entry);
```

New (note: in this file `now` is a `string`, so wrap it):

```typescript
      // detect: false (living brain, architect #5): N terse extracted candidates
      // sharing the same session files would mass-auto-link against approved
      // rows and prime a bulk-approval mass-close. The from-session: dedupe
      // keyword stays the only dedupe on this path.
      saveMemoryWithLineage(registry, entry, { now: () => now, detect: false });
```

**5c — run both suites; existing tests unchanged and green IS the "detect:false paths
byte-identical outputs" evidence** (they pin suggested/skipped counts and the stored rows;
detect:false is a plain `createMemoryEntry` inside core, so any behavior drift fails them):

```bash
pnpm build && pnpm --filter @megasaver/mcp-bridge test && pnpm --filter @megasaver/cli test
```

Expected: PASS with ZERO modifications to
`packages/mcp-bridge/test/tools/from-session-memory.test.ts` and
`apps/cli/test/memory-from-session.test.ts`.

- [ ] **Step 6: Write the failing `--save-summary` test (append inside the
`describe("mega task status + explain", ...)` block of `apps/cli/test/task.test.ts`, directly
after the existing test `"status --save-summary writes a memory once the plan is completed"`).**

```typescript
  it("status --save-summary dedupes an identical re-save (living brain: no duplicate row)", async () => {
    const stepA = "d0000000-0000-4000-8000-00000000000a";
    const stepB = "d0000000-0000-4000-8000-00000000000b";
    for (const stepId of [stepA, stepB]) {
      const code = await runTaskStep({
        ...base(root, [], []),
        planIdFlag: PLAN_ID,
        stepIdFlag: stepId,
        statusFlag: "completed",
      });
      expect(code).toBe(0);
    }

    const first = await runTaskStatus({
      ...base(root, [], []),
      planIdFlag: PLAN_ID,
      saveSummaryFlag: "all done",
      newId: () => "d0000000-0000-4000-8000-0000000000c1",
    });
    expect(first).toBe(0);

    const err: string[] = [];
    const second = await runTaskStatus({
      ...base(root, [], err),
      planIdFlag: PLAN_ID,
      saveSummaryFlag: "all done",
      newId: () => "d0000000-0000-4000-8000-0000000000c2",
    });
    expect(second).toBe(0);
    expect(err.join("\n")).toContain(
      "note: duplicate of d0000000-0000-4000-8000-0000000000c1 — not written",
    );
    expect(
      createJsonDirectoryCoreRegistry({ rootDir: root }).listMemoryEntries(PROJECT_ID),
    ).toHaveLength(1);
  });
```

(All helpers — `base`, `runTaskStep`, `runTaskStatus`, `createJsonDirectoryCoreRegistry`,
`PROJECT_ID`, `PLAN_ID`, `root` — already exist in the file/describe. Summaries are born
`approved` via the schema default, so the second identical write is an exact duplicate of an
approved row ⇒ dedupe.)

- [ ] **Step 7: Run — expect RED.**

```bash
pnpm build && pnpm --filter @megasaver/cli test
```

Expected: FAIL — the new test fails with `expected 2 to be 1` (today the second save writes a
second identical row) and the missing dedupe stderr note. Everything else green.

- [ ] **Step 8: Implement `apps/cli/src/commands/task/status.ts`.** Old import:

```typescript
import { type MemoryEntry, memoryEntrySchema, readySteps } from "@megasaver/core";
```

New:

```typescript
import {
  type MemoryEntry,
  memoryEntrySchema,
  readySteps,
  saveMemoryWithLineage,
} from "@megasaver/core";
```

Old (end of the `--save-summary` block):

```typescript
      registry.createMemoryEntry(entry);
      input.stderr(`note: saved summary memory ${entry.id}`);
```

New:

```typescript
      // Detection ON (living brain §4.2): summaries are born approved, so the
      // born-approved close ladder applies. This path is lexical-only (no
      // vectors), so only a checkConflicts contradiction can close — and every
      // close is disclosed loudly on stderr with its undo.
      const result = saveMemoryWithLineage(registry, entry, { now: () => ts });
      if (result.supersession?.closed === true) {
        const closedTitle = registry.getMemoryEntry(result.supersession.supersededId)?.title ?? "";
        input.stderr(
          `note: superseded ${result.supersession.supersededId} ("${closedTitle}") — undo: mega memory reopen ${result.supersession.supersededId}`,
        );
      }
      if (result.deduped !== undefined) {
        input.stderr(`note: duplicate of ${result.deduped.existingId} — not written`);
      } else {
        input.stderr(`note: saved summary memory ${result.entry.id}`);
      }
```

(The close-disclosure string reuses the binding `mega memory create` close-note format. Note:
with a `decision`-type summary, no relatedFiles and a same-type detection corpus, the
contradiction class cannot currently fire on this writer — the close branch is
contract-mandated wiring whose ladder is covered by core tests; the observable, testable
behavior change at this surface is dedupe.)

- [ ] **Step 9: Run — expect GREEN.**

```bash
pnpm build && pnpm --filter @megasaver/cli test
```

Expected: PASS, zero failures — the new dedupe test passes; the pre-existing
`status --save-summary` tests ("refuses when not completed", "writes a memory once completed")
stay green (fresh save still writes exactly one row and still prints
`note: saved summary memory <id>`).

- [ ] **Step 10: Changeset.** Create `.changeset/save-path-lineage.md`:

```markdown
---
"@megasaver/mcp-bridge": minor
"@megasaver/cli": minor
---

save_memory detects supersession/dedupe via saveMemoryWithLineage (response
gains `supersession?`/`deduped?`; best-effort cosine inputs from the memory
sidecar). from-session writers switch to detect:false lineage saves; `mega
task status --save-summary` gains detection with stderr disclosure.
```

- [ ] **Step 11: Lint + typecheck (required before every commit).**

```bash
pnpm lint:fix && pnpm typecheck
```

Expected: both exit 0. If `tsc` reports TS4111 anywhere in the touched files, switch to
bracket access with
`// biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)`.

- [ ] **Step 12: Commit (two atomic commits).**

```bash
git add packages/mcp-bridge/src/tools/save-memory.ts packages/mcp-bridge/src/server.ts packages/mcp-bridge/test/tools/memory-tools.test.ts .changeset/save-path-lineage.md
git commit -m "$(cat <<'EOF'
feat(mcp-bridge): save_memory lineage response

save_memory routes through saveMemoryWithLineage: detected supersession
links (close only per the born-approved ladder), exact duplicates
short-circuit to the existing row, and the response discloses both.
Cosine inputs are best-effort from the sidecar so a missing model or
vector file degrades to lexical-only, never blocking a save.
EOF
)"

git add packages/mcp-bridge/src/tools/from-session-memory.ts apps/cli/src/commands/memory/from-session.ts apps/cli/src/commands/task/status.ts apps/cli/test/task.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): rewire remaining memory writers

from-session twins (CLI + bridge) save with detect:false — N terse
extracted candidates sharing session files would mass-auto-link and
prime a bulk-approval mass-close (architect #5); their from-session:
dedupe key stays. task status --save-summary saves with detection on:
identical re-saves dedupe and any close is disclosed on stderr with
its reopen undo.
EOF
)"
```
## Section 3: CLI surface (Tasks 9–12)

All work happens in the execution worktree
`/Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain`
(branch `feat/living-brain`, stacked on `feat/guard`). Run every command from
that worktree root. Tasks 9–12 assume Tasks 1–8 have landed, i.e.
`@megasaver/core` already exports `saveMemoryWithLineage`,
`SaveMemoryLineageResult`, `applySupersession`, `buildLineage`,
`POSSIBLE_SUPERSEDES_PREFIX` (plus the pre-existing `isCurrent`), and
`memoryEntryUpdatePatchSchema` already accepts `lastActiveAt`.

**ENVIRONMENT HAZARDS (apply to every task below):**

- Mega Saver MCP read-proxy SILENTLY TRUNCATES file reads (banner "N kept, M dropped" / "[Mega Saver: compressed...]") — read files via `sed -n 'A,Bp'` in <=60-line chunks, locate with `grep -n`.
- `pnpm build` BEFORE package tests (dist resolution).
- `pnpm --filter X test -- pattern` does NOT narrow — run the whole package suite.
- Full `pnpm typecheck` REQUIRED before every commit — package vitest does NOT catch TS4111 (noPropertyAccessFromIndexSignature). Use bracket access + `// biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)` where needed.
- No bare `===` in zsh echo commands.

Test placement: new CLI tests go in `apps/cli/test/memory/*.test.ts` (new
directory; the cli vitest config includes `test/**/*.test.ts`, and
`apps/cli/test/hooks/` proves subdirectories are picked up). Existing flat
files (`apps/cli/test/memory.test.ts`, `memory-approve.test.ts`, …) MUST stay
green and untouched.

---

### Task 9: `mega memory create` — saveMemoryWithLineage rewire + supersede flags

**Files:**
- Modify: `apps/cli/src/commands/memory/create.ts`
- Test (new): `apps/cli/test/memory/create-supersede.test.ts`

**Contract notes (BINDING):**

> CITTY NEGATION TRAP (fixed 2026-07-13, commit 38488043): `--no-<name>` sets
> `args.<name> = false`. NEVER define a `noX` arg. Opt-out flags are positive
> names with `default: true`.

Multi-word wrinkle verified against `node_modules/citty/dist/index.mjs`: the
parser writes the negation onto the kebab key (`out["auto-supersede"] = false`)
while the declared default lands on the camel key (`out["autoSupersede"] =
true`). Reading `args.autoSupersede` would therefore swallow the negation.
The run() wrapper MUST read `args["auto-supersede"]` — the args proxy resolves
it to the negation when present and falls back (via camelCase) to the default
otherwise. The parse-path test below pins this.

Exact strings (stderr notes; stdout stays a single id line, or the `--json`
object):

- close: `note: superseded <id> ("<old title>") — undo: mega memory reopen <id>` (FULL id, exactly as stored)
- dedupe: `note: duplicate of <existingId> — not written` (stdout still prints the existing id)
- ambiguous/weak-downgrade: `note: possibly supersedes <id> ("<title>") — link explicitly with --supersede <id>`
- mutual exclusion: `error: --supersede and --no-auto-supersede are mutually exclusive` (exit 1)
- `--json` output: `JSON.stringify({ ...entry, ...(supersession ? { supersession } : {}), ...(deduped ? { deduped } : {}) })`

CLI create stays lexical-only (no queryVector — no model load on an
interactive command), so its detected auto-close path is contradiction-only.
Fixture caution: `checkConflicts` is precedence-ordered and the detection
corpus is same-type, so `contradiction` is reachable only when normalized
content is EQUAL, titles differ, files overlap, and negation keywords XOR
(same-type + overlap + different content hits `supersession` first).

- [ ] **Step 1: Write the failing test (complete file)**

Create `apps/cli/test/memory/create-supersede.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryCreateCommand, runMemoryCreate } from "../../src/commands/memory/create.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const RULE_ID = "22222222-2222-4222-8222-222222222222";
const DECISION_ID = "33333333-3333-4333-8333-333333333333";
const NEW_ID = "55555555-5555-4555-8555-555555555555";
const TS = "2026-07-01T00:00:00.000Z";
const NOW = "2026-07-13T00:00:00.000Z";

type StoredRow = {
  id: string;
  title?: string;
  validTo?: string | null;
  supersedesId?: string;
  evidence?: string[];
};

describe("mega memory create — supersession", () => {
  let store: string;
  const lines: string[] = [];
  const errLines: string[] = [];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
  const originalNodeEnv = process.env["NODE_ENV"];

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-create-supersede-"));
    lines.length = 0;
    errLines.length = 0;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = 0;
    // biome-ignore lint/performance/noDelete: process.env clear semantics require delete
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    delete process.env["MEGA_TEST_MEMORY_ENTRY_ID"];
    // biome-ignore lint/performance/noDelete: process.env clear semantics require delete
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    delete process.env["MEGA_TEST_NOW"];
    // biome-ignore lint/performance/noDelete: restoring env to absent state requires delete
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    if (originalNodeEnv === undefined) delete process.env["NODE_ENV"];
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    else process.env["NODE_ENV"] = originalNodeEnv;
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
      keywords: [],
      confidence: "high",
      source: "manual",
      stale: false,
      approval: "approved",
      relatedFiles: ["docs/install.md"],
      createdAt: TS,
      updatedAt: TS,
    };
    const rows = [
      {
        ...base,
        id: RULE_ID,
        type: "project_rule",
        title: "Use npm for installs",
        content: "use npm for installs",
      },
      {
        ...base,
        id: DECISION_ID,
        type: "decision",
        title: "Use npm",
        content: "use npm for installs",
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
    over: Partial<Parameters<typeof runMemoryCreate>[0]>,
  ): Parameters<typeof runMemoryCreate>[0] {
    return {
      projectName: "demo",
      scopeFlag: "project",
      contentFlag: "placeholder",
      sessionFlag: undefined,
      storeFlag: store,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
      home: process.env["HOME"] ?? "",
      xdgDataHome: undefined,
      platform: process.platform,
      localAppData: undefined,
      stdout: (line) => lines.push(line),
      stderr: (line) => errLines.push(line),
      newId: () => NEW_ID,
      now: () => NOW,
      ...over,
    };
  }

  it("born-approved contradiction links, closes, and prints the undo note", async () => {
    await seedStore();
    const code = await runMemoryCreate(
      makeInput({
        typeFlag: "project_rule",
        titleFlag: "Never use npm for installs",
        contentFlag: "use npm for installs",
        keywordFlags: ["never"],
        fileFlags: ["docs/install.md"],
      }),
    );
    expect(code).toBe(0);
    expect(lines).toEqual([NEW_ID]);
    const rows = await readRows();
    expect(rows.find((r) => r.id === NEW_ID)?.supersedesId).toBe(RULE_ID);
    expect(rows.find((r) => r.id === RULE_ID)?.validTo).toBe(NOW);
    expect(errLines).toContain(
      `note: superseded ${RULE_ID} ("Use npm for installs") — undo: mega memory reopen ${RULE_ID}`,
    );
  });

  it("weak supersession class downgrades to evidence note only", async () => {
    await seedStore();
    const code = await runMemoryCreate(
      makeInput({
        typeFlag: "decision",
        titleFlag: "Use pnpm",
        contentFlag: "use pnpm for installs",
        fileFlags: ["docs/install.md"],
      }),
    );
    expect(code).toBe(0);
    const rows = await readRows();
    const created = rows.find((r) => r.id === NEW_ID);
    expect(created?.supersedesId).toBeUndefined();
    expect(created?.evidence).toContain(`possible-supersedes:${DECISION_ID}`);
    expect(rows.find((r) => r.id === DECISION_ID)?.validTo).toBeUndefined();
    expect(errLines).toContain(
      `note: possibly supersedes ${DECISION_ID} ("Use npm") — link explicitly with --supersede ${DECISION_ID}`,
    );
  });

  it("duplicate short-circuits without writing", async () => {
    await seedStore();
    const code = await runMemoryCreate(
      makeInput({
        typeFlag: "decision",
        titleFlag: "Use npm",
        contentFlag: "use npm for installs",
      }),
    );
    expect(code).toBe(0);
    expect(lines).toEqual([DECISION_ID]);
    expect(await readRows()).toHaveLength(2);
    expect(errLines).toContain(`note: duplicate of ${DECISION_ID} — not written`);
  });

  it("--supersede links and closes explicitly", async () => {
    await seedStore();
    const code = await runMemoryCreate(
      makeInput({
        typeFlag: "decision",
        titleFlag: "Switch to bun",
        contentFlag: "use bun for installs",
        supersedeFlag: DECISION_ID,
      }),
    );
    expect(code).toBe(0);
    const rows = await readRows();
    expect(rows.find((r) => r.id === NEW_ID)?.supersedesId).toBe(DECISION_ID);
    expect(rows.find((r) => r.id === DECISION_ID)?.validTo).toBe(NOW);
    expect(errLines).toContain(
      `note: superseded ${DECISION_ID} ("Use npm") — undo: mega memory reopen ${DECISION_ID}`,
    );
  });

  it("--supersede with --no-auto-supersede is rejected", async () => {
    await seedStore();
    const code = await runMemoryCreate(
      makeInput({
        contentFlag: "use bun for installs",
        supersedeFlag: DECISION_ID,
        autoSupersedeFlag: false,
      }),
    );
    expect(code).toBe(1);
    expect(errLines).toContain("error: --supersede and --no-auto-supersede are mutually exclusive");
    expect(await readRows()).toHaveLength(2);
  });

  it("--json carries supersession and deduped fields", async () => {
    await seedStore();
    const code = await runMemoryCreate(
      makeInput({
        typeFlag: "project_rule",
        titleFlag: "Never use npm for installs",
        contentFlag: "use npm for installs",
        keywordFlags: ["never"],
        fileFlags: ["docs/install.md"],
        json: true,
      }),
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(lines[0] ?? "{}") as {
      id: string;
      supersession?: { supersededId: string; via: string; closed: boolean };
    };
    expect(parsed.id).toBe(NEW_ID);
    expect(parsed.supersession).toEqual({
      supersededId: RULE_ID,
      via: "contradiction",
      closed: true,
    });
  });

  it("citty parse path: --no-auto-supersede skips detection", async () => {
    await seedStore();
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    process.env["NODE_ENV"] = "test";
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    process.env["MEGA_TEST_MEMORY_ENTRY_ID"] = NEW_ID;
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    process.env["MEGA_TEST_NOW"] = NOW;
    await runCommand(memoryCreateCommand, {
      rawArgs: [
        "demo",
        "--scope",
        "project",
        "--type",
        "decision",
        "--content",
        "use pnpm for installs",
        "--file",
        "docs/install.md",
        "--store",
        store,
        "--no-auto-supersede",
      ],
    });
    expect(process.exitCode).toBe(0);
    const rows = await readRows();
    const created = rows.find((r) => r.id === NEW_ID);
    // Without the flag this fixture is the weak-supersession class and would
    // carry a possible-supersedes evidence string; its absence proves the
    // negation survived citty parsing.
    expect(created).toBeDefined();
    expect(created?.supersedesId).toBeUndefined();
    expect(created?.evidence).toBeUndefined();
  });

  it("citty parse path: --supersede plus --no-auto-supersede exits 1", async () => {
    await seedStore();
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    process.env["NODE_ENV"] = "test";
    await runCommand(memoryCreateCommand, {
      rawArgs: [
        "demo",
        "--scope",
        "project",
        "--content",
        "use bun for installs",
        "--supersede",
        DECISION_ID,
        "--store",
        store,
        "--no-auto-supersede",
      ],
    });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.flat()).toContain(
      "error: --supersede and --no-auto-supersede are mutually exclusive",
    );
    expect(await readRows()).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain
pnpm build && pnpm --filter @megasaver/cli test
```

Expected: the new file `test/memory/create-supersede.test.ts` FAILS (the
implementation ignores `supersedeFlag`/`autoSupersedeFlag`, prints no notes,
never links/closes — assertion failures on `supersedesId`, `validTo`, and the
note strings). All pre-existing cli tests still pass. Do not proceed if a
pre-existing test broke.

- [ ] **Step 3: Implement — rewire `create.ts` (exact edits)**

Apply these edits to `apps/cli/src/commands/memory/create.ts`
(read the current file with `grep -n` + `sed -n 'A,Bp'` in <=60-line chunks
first; the proxy truncates whole-file reads).

Edit 1 — imports (top of file):

```ts
// OLD
import {
  type MemoryEntry,
  memoryConfidenceSchema,
  memoryEntrySchema,
  memoryScopeSchema,
  memorySourceSchema,
  memoryTypeSchema,
} from "@megasaver/core";
import { sessionIdSchema, titleSchema } from "@megasaver/shared";
```

```ts
// NEW
import {
  type MemoryEntry,
  POSSIBLE_SUPERSEDES_PREFIX,
  memoryConfidenceSchema,
  memoryEntrySchema,
  memoryScopeSchema,
  memorySourceSchema,
  memoryTypeSchema,
  saveMemoryWithLineage,
} from "@megasaver/core";
import { type MemoryEntryId, sessionIdSchema, titleSchema } from "@megasaver/shared";
```

Edit 2 — shared.js import (same file, a few lines below):

```ts
// OLD
import { contentSchema, toStringArray } from "./shared.js";
```

```ts
// NEW
import { contentSchema, memoryEntryIdSchema, toStringArray } from "./shared.js";
```

Edit 3 — `RunMemoryCreateInput` gains two fields:

```ts
// OLD
  expiresFlag?: string | undefined;
  storeFlag: string | undefined;
```

```ts
// NEW
  expiresFlag?: string | undefined;
  supersedeFlag?: string | undefined;
  autoSupersedeFlag?: boolean | undefined;
  storeFlag: string | undefined;
```

Edit 4 — mutual-exclusion check first thing in the function:

```ts
// OLD
export async function runMemoryCreate(input: RunMemoryCreateInput): Promise<0 | 1> {
  let rootDir: string;
  try {
```

```ts
// NEW
export async function runMemoryCreate(input: RunMemoryCreateInput): Promise<0 | 1> {
  if (input.supersedeFlag !== undefined && input.autoSupersedeFlag === false) {
    input.stderr("error: --supersede and --no-auto-supersede are mutually exclusive");
    return 1;
  }

  let rootDir: string;
  try {
```

Edit 5 — parse the supersede id at the boundary (immediately before the main
`try {` that calls `ensureStoreReady`; the anchor below is the expires
validation block that precedes it):

```ts
// OLD
  if (
    input.expiresFlag !== undefined &&
    !z.string().datetime({ offset: true }).safeParse(input.expiresFlag).success
  ) {
    const cli = invalidExpiresMessage(input.expiresFlag);
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
```

```ts
// NEW
  if (
    input.expiresFlag !== undefined &&
    !z.string().datetime({ offset: true }).safeParse(input.expiresFlag).success
  ) {
    const cli = invalidExpiresMessage(input.expiresFlag);
    input.stderr(cli.message);
    return cli.exitCode;
  }

  let parsedSupersedeId: ReturnType<typeof memoryEntryIdSchema.parse> | undefined;
  if (input.supersedeFlag !== undefined) {
    try {
      parsedSupersedeId = memoryEntryIdSchema.parse(input.supersedeFlag);
    } catch (err) {
      const cli = mapErrorToCliMessage(err, { kind: "memoryEntryId" });
      input.stderr(cli.message);
      return cli.exitCode;
    }
  }

  try {
```

Edit 6 — entry build gains the explicit link (supersedesId is
create-time-immutable, so it must land here, before `memoryEntrySchema.parse`):

```ts
// OLD
      ...(input.expiresFlag !== undefined ? { expiresAt: input.expiresFlag } : {}),
      createdAt,
      updatedAt: createdAt,
    });
```

```ts
// NEW
      ...(input.expiresFlag !== undefined ? { expiresAt: input.expiresFlag } : {}),
      ...(parsedSupersedeId !== undefined ? { supersedesId: parsedSupersedeId } : {}),
      createdAt,
      updatedAt: createdAt,
    });
```

Edit 7 — replace the raw write with the lineage save + notes + output:

```ts
// OLD
    registry.createMemoryEntry(entry);
    input.stdout(input.json ? JSON.stringify(entry) : entry.id);
    return 0;
```

```ts
// NEW
    // Lexical-only in v1: no queryVector — an interactive create must not load
    // the embedding model, so the detected auto-close path is contradiction-only.
    const result = saveMemoryWithLineage(registry, entry, {
      now: () => createdAt,
      detect: input.autoSupersedeFlag !== false,
    });

    if (result.deduped) {
      input.stderr(`note: duplicate of ${result.deduped.existingId} — not written`);
    } else {
      if (result.supersession?.closed) {
        const closedId = result.supersession.supersededId;
        const closedTitle = registry.getMemoryEntry(closedId)?.title ?? "";
        input.stderr(
          `note: superseded ${closedId} ("${closedTitle}") — undo: mega memory reopen ${closedId}`,
        );
      }
      for (const ev of result.entry.evidence ?? []) {
        if (!ev.startsWith(POSSIBLE_SUPERSEDES_PREFIX)) continue;
        // Detection wrote this id into evidence moments ago; it is a real row.
        const possibleId = ev.slice(POSSIBLE_SUPERSEDES_PREFIX.length) as MemoryEntryId;
        const possibleTitle = registry.getMemoryEntry(possibleId)?.title ?? "";
        input.stderr(
          `note: possibly supersedes ${possibleId} ("${possibleTitle}") — link explicitly with --supersede ${possibleId}`,
        );
      }
    }

    input.stdout(
      input.json
        ? JSON.stringify({
            ...result.entry,
            ...(result.supersession ? { supersession: result.supersession } : {}),
            ...(result.deduped ? { deduped: result.deduped } : {}),
          })
        : result.entry.id,
    );
    return 0;
```

Edit 8 — citty args block (contract-exact definitions):

```ts
// OLD
    expires: { type: "string", description: "Expiry timestamp (ISO-8601)." },
    store: { type: "string", description: "Override store directory." },
```

```ts
// NEW
    expires: { type: "string", description: "Expiry timestamp (ISO-8601)." },
    supersede: {
      type: "string",
      description: "Explicitly supersede a memory id (links + closes it).",
    },
    autoSupersede: {
      type: "boolean",
      default: true,
      description: "Detect supersession automatically (--no-auto-supersede to skip).",
    },
    store: { type: "string", description: "Override store directory." },
```

Edit 9 — run() wrapper (kebab read is load-bearing, see task notes):

```ts
// OLD
      expiresFlag: typeof args.expires === "string" ? args.expires : undefined,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
```

```ts
// NEW
      expiresFlag: typeof args.expires === "string" ? args.expires : undefined,
      supersedeFlag: typeof args.supersede === "string" ? args.supersede : undefined,
      // Citty negation trap (commit 38488043): --no-auto-supersede lands on the
      // kebab key while the declared default lands on the camel key. Read the
      // kebab key — the args proxy resolves the negation when present and falls
      // back to the camel default otherwise.
      autoSupersedeFlag: args["auto-supersede"] !== false,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
```

- [ ] **Step 4: Run the test — expect PASS**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain
pnpm build && pnpm --filter @megasaver/cli test
```

Expected: whole cli suite green, including all 8 new tests and the untouched
pre-existing `memory.test.ts` create tests.

- [ ] **Step 5: Typecheck + lint**

```bash
pnpm typecheck && pnpm lint
```

Expected: zero errors (TS4111 surfaces only here, not in vitest).

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/memory/create.ts apps/cli/test/memory/create-supersede.test.ts
git commit -m "feat(cli): memory create auto-supersede flags"
```

---

### Task 10: `mega memory approve` close disclosure + `mega memory update` lastActiveAt touch

**Files:**
- Modify: `apps/cli/src/commands/memory/approve.ts`
- Modify: `apps/cli/src/commands/memory/update.ts`
- Test (new): `apps/cli/test/memory/approve-supersession.test.ts`
- Test (new): `apps/cli/test/memory/update-last-active.test.ts`

Exact strings (BINDING):

- approve close note (stderr): `note: this approval closed <id> ("<title>") — undo: mega memory reopen <id>`
- update: when the patch touches any of title/content/keywords/relatedFiles, also set `lastActiveAt: now` in the same patch. Metadata-only patches (stale/expires/etc.) must NOT set it.

The CLI approve command has no quarantine gate (that is the MCP
`approve_memory` handler, Task 7); it only flips approval. This task adds the
`applySupersession` call after a flip to `approved`, exactly as the contract
specifies. `pnpm build` before the package suite; `--filter ... test -- name`
does NOT narrow — run the whole suite.

- [ ] **Step 1: Write the failing tests (two complete files)**

Create `apps/cli/test/memory/approve-supersession.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMemoryApprove } from "../../src/commands/memory/approve.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const CANDIDATE_ID = "33333333-3333-4333-8333-333333333333";
const LONE_ID = "44444444-4444-4444-8444-444444444444";
const TS = "2026-07-01T00:00:00.000Z";
const NOW = "2026-07-13T00:00:00.000Z";

type StoredRow = { id: string; approval?: string; validTo?: string | null };

describe("mega memory approve — supersession close", () => {
  let store: string;
  const lines: string[] = [];
  const errLines: string[] = [];

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-approve-lineage-"));
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
        approval: "suggested",
        supersedesId: TARGET_ID,
      },
      {
        ...base,
        id: LONE_ID,
        title: "Cache node_modules in CI",
        content: "cache node_modules in ci",
        approval: "suggested",
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
    over: Partial<Parameters<typeof runMemoryApprove>[0]> & {
      approval: "approved" | "rejected";
    },
  ): Parameters<typeof runMemoryApprove>[0] {
    return {
      memoryEntryId: CANDIDATE_ID,
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

  it("approving a linked candidate closes the declared target and prints the note", async () => {
    await seedStore();
    const code = await runMemoryApprove(makeInput({ approval: "approved" }));
    expect(code).toBe(0);
    const rows = await readRows();
    expect(rows.find((r) => r.id === CANDIDATE_ID)?.approval).toBe("approved");
    expect(rows.find((r) => r.id === TARGET_ID)?.validTo).toBe(NOW);
    expect(errLines).toContain(
      `note: this approval closed ${TARGET_ID} ("Use npm for installs") — undo: mega memory reopen ${TARGET_ID}`,
    );
  });

  it("approving an unlinked entry closes nothing and prints no note", async () => {
    await seedStore();
    const code = await runMemoryApprove(makeInput({ approval: "approved", memoryEntryId: LONE_ID }));
    expect(code).toBe(0);
    const rows = await readRows();
    expect(rows.find((r) => r.id === LONE_ID)?.approval).toBe("approved");
    expect(rows.find((r) => r.id === TARGET_ID)?.validTo).toBeUndefined();
    expect(errLines.some((l) => l.includes("this approval closed"))).toBe(false);
  });

  it("rejecting a linked candidate closes nothing", async () => {
    await seedStore();
    const code = await runMemoryApprove(makeInput({ approval: "rejected" }));
    expect(code).toBe(0);
    const rows = await readRows();
    expect(rows.find((r) => r.id === TARGET_ID)?.validTo).toBeUndefined();
    expect(errLines.some((l) => l.includes("this approval closed"))).toBe(false);
  });
});
```

Create `apps/cli/test/memory/update-last-active.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMemoryUpdate } from "../../src/commands/memory/update.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ENTRY_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-07-01T00:00:00.000Z";
const NOW = "2026-07-13T00:00:00.000Z";

type StoredRow = { id: string; lastActiveAt?: string; updatedAt?: string; stale?: boolean };

describe("mega memory update — lastActiveAt touch", () => {
  let store: string;
  const lines: string[] = [];
  const errLines: string[] = [];

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-update-lastactive-"));
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
    const row = {
      id: ENTRY_ID,
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      type: "decision",
      title: "Use npm",
      content: "use npm for installs",
      keywords: [],
      confidence: "high",
      source: "manual",
      stale: false,
      approval: "approved",
      createdAt: TS,
      updatedAt: TS,
    };
    await writeFile(join(store, "memory", `${PROJECT_ID}.jsonl`), `${JSON.stringify(row)}\n`);
  }

  async function readRow(): Promise<StoredRow | undefined> {
    const raw = await readFile(join(store, "memory", `${PROJECT_ID}.jsonl`), "utf8");
    return raw
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as StoredRow)[0];
  }

  function makeInput(
    over: Partial<Parameters<typeof runMemoryUpdate>[0]>,
  ): Parameters<typeof runMemoryUpdate>[0] {
    return {
      memoryEntryId: ENTRY_ID,
      typeFlag: undefined,
      titleFlag: undefined,
      contentFlag: undefined,
      confidenceFlag: undefined,
      sourceFlag: undefined,
      reasonFlag: undefined,
      goalFlag: undefined,
      keywordFlags: undefined,
      fileFlags: undefined,
      staleFlag: undefined,
      expiresFlag: undefined,
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

  it("title patch sets lastActiveAt", async () => {
    await seedStore();
    const code = await runMemoryUpdate(makeInput({ titleFlag: "Use npm always" }));
    expect(code).toBe(0);
    const row = await readRow();
    expect(row?.lastActiveAt).toBe(NOW);
    expect(row?.updatedAt).toBe(NOW);
  });

  it("content patch sets lastActiveAt", async () => {
    await seedStore();
    const code = await runMemoryUpdate(makeInput({ contentFlag: "use npm ci for installs" }));
    expect(code).toBe(0);
    expect((await readRow())?.lastActiveAt).toBe(NOW);
  });

  it("stale-only patch does NOT set lastActiveAt", async () => {
    await seedStore();
    const code = await runMemoryUpdate(makeInput({ staleFlag: true }));
    expect(code).toBe(0);
    const row = await readRow();
    expect(row?.stale).toBe(true);
    expect(row?.updatedAt).toBe(NOW);
    expect(row?.lastActiveAt).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests — expect FAIL**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain
pnpm build && pnpm --filter @megasaver/cli test
```

Expected: `approve-supersession.test.ts` fails on `validTo`/note assertions;
`update-last-active.test.ts` fails on `lastActiveAt` assertions. Everything
pre-existing (incl. `apps/cli/test/memory-approve.test.ts`, which must stay
green unchanged) passes.

- [ ] **Step 3: Implement — `approve.ts` (exact edits)**

Edit 1 — imports:

```ts
// OLD
import type { MemoryEntryUpdatePatch } from "@megasaver/core";
```

```ts
// NEW
import { type MemoryEntryUpdatePatch, applySupersession } from "@megasaver/core";
```

Edit 2 — flip block (currently at approve.ts:65-69):

```ts
// OLD
    const updatedAt = readTestEnv("MEGA_TEST_NOW") ?? now();
    const patch: MemoryEntryUpdatePatch = { approval: input.approval, updatedAt };
    const updated = registry.updateMemoryEntry(parsedId, patch);
    input.stdout(input.jsonFlag ? JSON.stringify(updated) : updated.id);
    return 0;
```

```ts
// NEW
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

- [ ] **Step 4: Implement — `update.ts` (exact edits)**

Edit 1 — track content-bearing patches (update.ts:77-78):

```ts
// OLD
  const patch: MemoryEntryUpdatePatch = { updatedAt };
  let touched = false;
```

```ts
// NEW
  const patch: MemoryEntryUpdatePatch = { updatedAt };
  let touched = false;
  let contentBearing = false;
```

Edit 2 — title branch:

```ts
// OLD
  if (input.titleFlag !== undefined) {
    try {
      patch.title = titleSchema.parse(input.titleFlag);
    } catch (err) {
      const cli = mapErrorToCliMessage(err, { kind: "title" });
      input.stderr(cli.message);
      return cli.exitCode;
    }
    touched = true;
  }
```

```ts
// NEW
  if (input.titleFlag !== undefined) {
    try {
      patch.title = titleSchema.parse(input.titleFlag);
    } catch (err) {
      const cli = mapErrorToCliMessage(err, { kind: "title" });
      input.stderr(cli.message);
      return cli.exitCode;
    }
    touched = true;
    contentBearing = true;
  }
```

Edit 3 — content branch:

```ts
// OLD
  if (input.contentFlag !== undefined) {
    try {
      patch.content = contentSchema.parse(input.contentFlag);
    } catch (err) {
      const cli = mapErrorToCliMessage(err, { kind: "memory_create" });
      input.stderr(cli.message);
      return cli.exitCode;
    }
    touched = true;
  }
```

```ts
// NEW
  if (input.contentFlag !== undefined) {
    try {
      patch.content = contentSchema.parse(input.contentFlag);
    } catch (err) {
      const cli = mapErrorToCliMessage(err, { kind: "memory_create" });
      input.stderr(cli.message);
      return cli.exitCode;
    }
    touched = true;
    contentBearing = true;
  }
```

Edit 4 — keywords branch:

```ts
// OLD
  if (input.keywordFlags !== undefined) {
    patch.keywords = toStringArray(input.keywordFlags);
    touched = true;
  }
```

```ts
// NEW
  if (input.keywordFlags !== undefined) {
    patch.keywords = toStringArray(input.keywordFlags);
    touched = true;
    contentBearing = true;
  }
```

Edit 5 — relatedFiles branch:

```ts
// OLD
  if (input.fileFlags !== undefined) {
    patch.relatedFiles = toStringArray(input.fileFlags);
    touched = true;
  }
```

```ts
// NEW
  if (input.fileFlags !== undefined) {
    patch.relatedFiles = toStringArray(input.fileFlags);
    touched = true;
    contentBearing = true;
  }
```

Edit 6 — set the anchor just before the no-op guard:

```ts
// OLD
  if (!touched) {
    const cli = nothingToUpdateMessage();
```

```ts
// NEW
  // Content-bearing edits refresh the decay anchor (lastActiveAt); metadata-only
  // patches (stale/expires/approval) must not reset a memory's age.
  if (contentBearing) patch.lastActiveAt = updatedAt;

  if (!touched) {
    const cli = nothingToUpdateMessage();
```

- [ ] **Step 5: Run the tests — expect PASS**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain
pnpm build && pnpm --filter @megasaver/cli test
```

Expected: whole cli suite green, including both new files and the untouched
`memory-approve.test.ts` (pure-refactor gate on the approve flip).

- [ ] **Step 6: Typecheck + lint**

```bash
pnpm typecheck && pnpm lint
```

- [ ] **Step 7: Commit**

```bash
git add apps/cli/src/commands/memory/approve.ts apps/cli/src/commands/memory/update.ts apps/cli/test/memory/approve-supersession.test.ts apps/cli/test/memory/update-last-active.test.ts
git commit -m "feat(cli): approve close note, lastActiveAt touch"
```

---

### Task 11: `mega memory history` (PRO) + `mega memory reopen` (FREE)

**Files:**
- Create: `apps/cli/src/commands/memory/history.ts`
- Create: `apps/cli/src/commands/memory/reopen.ts`
- Modify: `apps/cli/src/commands/memory/index.ts`
- Test (new): `apps/cli/test/memory/history-reopen.test.ts`

Exact strings (BINDING):

- `MEMORY_HISTORY_UPSELL = "Memory history is a Mega Saver Pro feature. Activate a key: mega license activate <key>."`
- Free-tier stdout (single line, exit 0): `N prior versions. Memory history is a Mega Saver Pro feature. Activate a key: mega license activate <key>.` — omit `N prior versions. ` when N === 0. (Kept verbatim even for N === 1.)
- Pro output oldest→newest, per entry: `<id>  <title>` then `  <validFrom ?? createdAt> -> <validTo ?? "current">` then `  reason: <reason>` (reason line only when present). `--json`: full entry array oldest→newest (gate still applies).
- reopen: entry must have `validTo != null`, else stderr `error: memory <id> is not closed` exit 1; patch `{ validTo: null, updatedAt: now }`; stdout `reopened <id> ("<title>")`; `--json` prints the updated entry. reopen is FREE — no entitlement call.

Gate pattern = `guard/events.ts`: `checkEntitlement("savings-analytics", { storeRoot, now, ...(publicKey) })` FIRST, upsell + return 0 on `!entitled`.

- [ ] **Step 1: Write the failing test (complete file)**

Create `apps/cli/test/memory/history-reopen.test.ts`:

```ts
import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MEMORY_HISTORY_UPSELL, runMemoryHistory } from "../../src/commands/memory/history.js";
import { memoryCommand } from "../../src/commands/memory/index.js";
import { runMemoryReopen } from "../../src/commands/memory/reopen.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OLD_ID = "22222222-2222-4222-8222-222222222222";
const NEW_ID = "33333333-3333-4333-8333-333333333333";
const TS_OLD = "2026-06-01T00:00:00.000Z";
const T_CLOSE = "2026-07-10T00:00:00.000Z";
const TS_NEW = "2026-07-10T00:00:00.000Z";
const NOW = "2026-07-13T00:00:00.000Z";

type StoredRow = { id: string; validTo?: string | null };

type LicensePayload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
  payload: LicensePayload,
): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

describe("mega memory history / reopen", () => {
  let store: string;
  let proPublicKey: KeyObject | undefined;
  const lines: string[] = [];
  const errLines: string[] = [];

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-history-reopen-"));
    proPublicKey = undefined;
    lines.length = 0;
    errLines.length = 0;
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  function activatePro(): void {
    const keys = generateKeyPairSync("ed25519");
    const key = signTestLicense(keys.privateKey, {
      v: 1,
      tier: "pro",
      id: "t1",
      iat: 0,
      exp: null,
    });
    activateLicense(store, key, { publicKey: keys.publicKey, now: () => Date.parse(NOW) });
    proPublicKey = keys.publicKey;
  }

  async function seedStore(): Promise<void> {
    await mkdir(join(store, "memory"), { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: "/tmp", createdAt: TS_OLD, updatedAt: TS_OLD },
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
      source: "manual",
      stale: false,
      approval: "approved",
    };
    const rows = [
      {
        ...base,
        id: OLD_ID,
        title: "Use npm",
        content: "use npm for installs",
        validTo: T_CLOSE,
        createdAt: TS_OLD,
        updatedAt: TS_OLD,
      },
      {
        ...base,
        id: NEW_ID,
        title: "Use pnpm",
        content: "use pnpm for installs",
        supersedesId: OLD_ID,
        reason: "npm broke on CI",
        createdAt: TS_NEW,
        updatedAt: TS_NEW,
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

  function historyInput(
    id: string,
    over: Partial<Parameters<typeof runMemoryHistory>[0]> = {},
  ): Parameters<typeof runMemoryHistory>[0] {
    return {
      memoryEntryId: id,
      storeFlag: store,
      jsonFlag: false,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
      home: process.env["HOME"] ?? "",
      xdgDataHome: undefined,
      platform: process.platform,
      localAppData: undefined,
      stdout: (line: string) => lines.push(line),
      stderr: (line: string) => errLines.push(line),
      nowMs: () => Date.parse(NOW),
      ...(proPublicKey === undefined ? {} : { publicKey: proPublicKey }),
      ...over,
    };
  }

  function reopenInput(
    id: string,
    over: Partial<Parameters<typeof runMemoryReopen>[0]> = {},
  ): Parameters<typeof runMemoryReopen>[0] {
    return {
      memoryEntryId: id,
      storeFlag: store,
      jsonFlag: false,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
      home: process.env["HOME"] ?? "",
      xdgDataHome: undefined,
      platform: process.platform,
      localAppData: undefined,
      stdout: (line: string) => lines.push(line),
      stderr: (line: string) => errLines.push(line),
      now: () => NOW,
      ...over,
    };
  }

  it("registers history and reopen subcommands", () => {
    const names = Object.keys(memoryCommand.subCommands ?? {});
    expect(names).toContain("history");
    expect(names).toContain("reopen");
  });

  it("pins the exact upsell sentence", () => {
    expect(MEMORY_HISTORY_UPSELL).toBe(
      "Memory history is a Mega Saver Pro feature. Activate a key: mega license activate <key>.",
    );
  });

  it("free tier with ancestors prints the counted upsell line, exit 0", async () => {
    await seedStore();
    const code = await runMemoryHistory(historyInput(NEW_ID));
    expect(code).toBe(0);
    expect(lines).toEqual([`1 prior versions. ${MEMORY_HISTORY_UPSELL}`]);
  });

  it("free tier without ancestors omits the count prefix", async () => {
    await seedStore();
    const code = await runMemoryHistory(historyInput(OLD_ID));
    expect(code).toBe(0);
    expect(lines).toEqual([MEMORY_HISTORY_UPSELL]);
  });

  it("pro tier prints the chain oldest to newest", async () => {
    await seedStore();
    activatePro();
    const code = await runMemoryHistory(historyInput(NEW_ID));
    expect(code).toBe(0);
    expect(lines).toEqual([
      `${OLD_ID}  Use npm`,
      `  ${TS_OLD} -> ${T_CLOSE}`,
      `${NEW_ID}  Use pnpm`,
      `  ${TS_NEW} -> current`,
      "  reason: npm broke on CI",
    ]);
  });

  it("pro tier --json emits the full chain array oldest to newest", async () => {
    await seedStore();
    activatePro();
    const code = await runMemoryHistory(historyInput(NEW_ID, { jsonFlag: true }));
    expect(code).toBe(0);
    const parsed = JSON.parse(lines[0] ?? "[]") as Array<{ id: string }>;
    expect(parsed.map((e) => e.id)).toEqual([OLD_ID, NEW_ID]);
  });

  it("reopen clears validTo and prints the confirmation", async () => {
    await seedStore();
    const code = await runMemoryReopen(reopenInput(OLD_ID));
    expect(code).toBe(0);
    expect(lines).toEqual([`reopened ${OLD_ID} ("Use npm")`]);
    expect((await readRows()).find((r) => r.id === OLD_ID)?.validTo).toBeNull();
  });

  it("reopen of a non-closed entry errors with exit 1", async () => {
    await seedStore();
    await runMemoryReopen(reopenInput(OLD_ID));
    lines.length = 0;
    errLines.length = 0;
    const again = await runMemoryReopen(reopenInput(OLD_ID));
    expect(again).toBe(1);
    expect(errLines).toContain(`error: memory ${OLD_ID} is not closed`);

    errLines.length = 0;
    const never = await runMemoryReopen(reopenInput(NEW_ID));
    expect(never).toBe(1);
    expect(errLines).toContain(`error: memory ${NEW_ID} is not closed`);
  });

  it("reopen --json prints the updated entry", async () => {
    await seedStore();
    const code = await runMemoryReopen(reopenInput(OLD_ID, { jsonFlag: true }));
    expect(code).toBe(0);
    const parsed = JSON.parse(lines[0] ?? "{}") as { id: string; validTo?: string | null };
    expect(parsed.id).toBe(OLD_ID);
    expect(parsed.validTo).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain
pnpm build && pnpm --filter @megasaver/cli test
```

Expected: `history-reopen.test.ts` fails at import time — `Cannot find module
'../../src/commands/memory/history.js'`. Everything else green.

- [ ] **Step 3: Implement — create `history.ts` (complete file)**

Create `apps/cli/src/commands/memory/history.ts`:

```ts
import type { KeyObject } from "node:crypto";
import { buildLineage } from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, memoryEntryNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { memoryEntryIdSchema } from "./shared.js";

export const MEMORY_HISTORY_UPSELL =
  "Memory history is a Mega Saver Pro feature. Activate a key: mega license activate <key>.";

export type RunMemoryHistoryInput = {
  memoryEntryId: string;
  storeFlag: string | undefined;
  jsonFlag: boolean;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  nowMs?: () => number;
  publicKey?: KeyObject | string;
};

export async function runMemoryHistory(input: RunMemoryHistoryInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath({
      storeFlag: input.storeFlag,
      cwd: input.cwd,
      home: input.home,
      xdgDataHome: input.xdgDataHome,
      platform: input.platform,
      localAppData: input.localAppData,
    });
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  let parsedId: ReturnType<typeof memoryEntryIdSchema.parse>;
  try {
    parsedId = memoryEntryIdSchema.parse(input.memoryEntryId);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memoryEntryId" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  // Gate first: entitlement is decided before any Pro compute runs.
  const ent = checkEntitlement("savings-analytics", {
    storeRoot: rootDir,
    now: input.nowMs ?? (() => Date.now()),
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const entry = registry.getMemoryEntry(parsedId);
    if (entry === null) {
      const cli = memoryEntryNotFoundMessage(parsedId);
      input.stderr(cli.message);
      return cli.exitCode;
    }

    const chain = buildLineage(registry.listMemoryEntries(entry.projectId), parsedId);

    if (!ent.entitled) {
      // Chains only form via supersession, so the ancestor count is cheap and
      // honest to disclose on the free tier.
      const priorVersions = chain.findIndex((e) => e.id === parsedId);
      input.stdout(
        priorVersions > 0
          ? `${priorVersions} prior versions. ${MEMORY_HISTORY_UPSELL}`
          : MEMORY_HISTORY_UPSELL,
      );
      return 0;
    }

    if (input.jsonFlag) {
      input.stdout(JSON.stringify(chain));
      return 0;
    }
    for (const e of chain) {
      input.stdout(`${e.id}  ${e.title}`);
      input.stdout(`  ${e.validFrom ?? e.createdAt} -> ${e.validTo ?? "current"}`);
      if (e.reason !== undefined) input.stdout(`  reason: ${e.reason}`);
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const memoryHistoryCommand = defineCommand({
  meta: { name: "history", description: "Show a memory entry's lineage chain (Pro)." },
  args: {
    memoryEntryId: {
      type: "positional",
      required: true,
      description: "Memory entry id (UUID).",
    },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runMemoryHistory({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      memoryEntryId: typeof args.memoryEntryId === "string" ? args.memoryEntryId : "",
      jsonFlag: args.json === true,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] **Step 4: Implement — create `reopen.ts` (complete file)**

Create `apps/cli/src/commands/memory/reopen.ts`:

```ts
import { defineCommand } from "citty";
import { mapErrorToCliMessage, memoryEntryNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { readTestEnv } from "../session/shared.js";
import { memoryEntryIdSchema } from "./shared.js";

export type RunMemoryReopenInput = {
  memoryEntryId: string;
  storeFlag: string | undefined;
  jsonFlag: boolean;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  now?: () => string;
};

export async function runMemoryReopen(input: RunMemoryReopenInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath({
      storeFlag: input.storeFlag,
      cwd: input.cwd,
      home: input.home,
      xdgDataHome: input.xdgDataHome,
      platform: input.platform,
      localAppData: input.localAppData,
    });
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  let parsedId: ReturnType<typeof memoryEntryIdSchema.parse>;
  try {
    parsedId = memoryEntryIdSchema.parse(input.memoryEntryId);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memoryEntryId" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  const now = input.now ?? (() => new Date().toISOString());

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const existing = registry.getMemoryEntry(parsedId);
    if (existing === null) {
      const cli = memoryEntryNotFoundMessage(parsedId);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    if (existing.validTo == null) {
      input.stderr(`error: memory ${parsedId} is not closed`);
      return 1;
    }
    const updatedAt = readTestEnv("MEGA_TEST_NOW") ?? now();
    const updated = registry.updateMemoryEntry(parsedId, { validTo: null, updatedAt });
    input.stdout(
      input.jsonFlag ? JSON.stringify(updated) : `reopened ${updated.id} ("${updated.title}")`,
    );
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_update" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const memoryReopenCommand = defineCommand({
  meta: { name: "reopen", description: "Reopen a superseded memory (clear validTo)." },
  args: {
    memoryEntryId: {
      type: "positional",
      required: true,
      description: "Memory entry id (UUID).",
    },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runMemoryReopen({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      memoryEntryId: typeof args.memoryEntryId === "string" ? args.memoryEntryId : "",
      jsonFlag: args.json === true,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] **Step 5: Implement — register in `memory/index.ts` (exact edits)**

Edit 1 — imports (alphabetical placement):

```ts
// OLD
import { memoryGraphCommand } from "./graph.js";
import { memoryIndexBuildCommand } from "./index-build.js";
import { memoryListCommand } from "./list.js";
import { memoryReviewCommand } from "./review.js";
```

```ts
// NEW
import { memoryGraphCommand } from "./graph.js";
import { memoryHistoryCommand } from "./history.js";
import { memoryIndexBuildCommand } from "./index-build.js";
import { memoryListCommand } from "./list.js";
import { memoryReopenCommand } from "./reopen.js";
import { memoryReviewCommand } from "./review.js";
```

Edit 2 — re-exports (append after the from-session export block):

```ts
// OLD
export {
  type RunMemoryFromSessionInput,
  runMemoryFromSession,
  memoryFromSessionCommand,
} from "./from-session.js";
```

```ts
// NEW
export {
  type RunMemoryFromSessionInput,
  runMemoryFromSession,
  memoryFromSessionCommand,
} from "./from-session.js";
export {
  type RunMemoryHistoryInput,
  runMemoryHistory,
  memoryHistoryCommand,
} from "./history.js";
export {
  type RunMemoryReopenInput,
  runMemoryReopen,
  memoryReopenCommand,
} from "./reopen.js";
```

Edit 3 — subCommands map:

```ts
// OLD
    sweep: memorySweepCommand,
    "from-session": memoryFromSessionCommand,
  },
});
```

```ts
// NEW
    sweep: memorySweepCommand,
    "from-session": memoryFromSessionCommand,
    history: memoryHistoryCommand,
    reopen: memoryReopenCommand,
  },
});
```

- [ ] **Step 6: Run the test — expect PASS**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain
pnpm build && pnpm --filter @megasaver/cli test
```

Expected: whole cli suite green including all 9 new tests.

- [ ] **Step 7: Typecheck + lint**

```bash
pnpm typecheck && pnpm lint
```

- [ ] **Step 8: Commit**

```bash
git add apps/cli/src/commands/memory/history.ts apps/cli/src/commands/memory/reopen.ts apps/cli/src/commands/memory/index.ts apps/cli/test/memory/history-reopen.test.ts
git commit -m "feat(cli): memory history and reopen commands"
```

---

### Task 12: `mega memory explain` lineage section + `search`/`list --as-of` (PRO per-flag)

**Files:**
- Modify: `apps/cli/src/commands/memory/shared.ts` (formatMemoryLineageLines + MEMORY_AS_OF_UPSELL)
- Modify: `apps/cli/src/commands/memory/explain.ts` (third section loop)
- Modify: `apps/cli/src/commands/memory/search.ts` (--as-of)
- Modify: `apps/cli/src/commands/memory/list.ts` (--as-of)
- Modify: `apps/cli/src/errors.ts` (invalidAsOfMessage)
- Test (new): `apps/cli/test/memory/explain-asof.test.ts`

Exact strings (BINDING):

- `MEMORY_AS_OF_UPSELL = "Time-travel queries (--as-of) are a Mega Saver Pro feature. Activate a key: mega license activate <key>."` — defined ONCE in `memory/shared.ts` (search and list both consume it; history's twin lives in the new history.ts per contract).
- Flag absent ⇒ behavior byte-identical to today; NO entitlement call.
- Flag present ⇒ gate FIRST (upsell + exit 0 when not entitled); invalid datetime ⇒ the command's existing invalid-arg error pattern (errors.ts factory), exit 1: `error: invalid as-of "<value>", expected ISO-8601 datetime` (mirrors `invalidExpiresMessage`).
- search passes `asOf` into the existing core query; list applies ONLY the `isCurrent(entry, asOf)` filter on top of today's output (no approval filter change).
- explain: third section loop `formatMemoryLineageLines(entry, all)` printing (only lines whose value exists): `validFrom`, `validTo`, `supersedesId`, plus `supersedes` / `supersededBy` lines resolved from the project's entries, each rendered with the file's existing `padExplain` 16-char key alignment.

- [ ] **Step 1: Write the failing test (complete file)**

Create `apps/cli/test/memory/explain-asof.test.ts`:

```ts
import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMemoryExplain } from "../../src/commands/memory/explain.js";
import { runMemoryList } from "../../src/commands/memory/list.js";
import { runMemorySearch } from "../../src/commands/memory/search.js";
import { MEMORY_AS_OF_UPSELL } from "../../src/commands/memory/shared.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OLD_ID = "22222222-2222-4222-8222-222222222222";
const NEW_ID = "33333333-3333-4333-8333-333333333333";
const TS_OLD = "2026-06-01T00:00:00.000Z";
const T_CLOSE = "2026-07-10T00:00:00.000Z";
const TS_NEW = "2026-07-10T00:00:00.000Z";
const T_BEFORE = "2026-07-05T00:00:00.000Z";
const NOW = "2026-07-13T00:00:00.000Z";

type LicensePayload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
  payload: LicensePayload,
): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

describe("mega memory explain lineage + search/list --as-of", () => {
  let store: string;
  let proPublicKey: KeyObject | undefined;
  const lines: string[] = [];
  const errLines: string[] = [];

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-explain-asof-"));
    proPublicKey = undefined;
    lines.length = 0;
    errLines.length = 0;
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  function activatePro(): void {
    const keys = generateKeyPairSync("ed25519");
    const key = signTestLicense(keys.privateKey, {
      v: 1,
      tier: "pro",
      id: "t1",
      iat: 0,
      exp: null,
    });
    activateLicense(store, key, { publicKey: keys.publicKey, now: () => Date.parse(NOW) });
    proPublicKey = keys.publicKey;
  }

  async function seedStore(): Promise<void> {
    await mkdir(join(store, "memory"), { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: "/tmp", createdAt: TS_OLD, updatedAt: TS_OLD },
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
      source: "manual",
      stale: false,
      approval: "approved",
    };
    const rows = [
      {
        ...base,
        id: OLD_ID,
        title: "Use npm",
        content: "use npm for installs",
        validTo: T_CLOSE,
        createdAt: TS_OLD,
        updatedAt: TS_OLD,
      },
      {
        ...base,
        id: NEW_ID,
        title: "Use pnpm",
        content: "use pnpm for installs",
        supersedesId: OLD_ID,
        validFrom: TS_NEW,
        createdAt: TS_NEW,
        updatedAt: TS_NEW,
      },
    ];
    await writeFile(
      join(store, "memory", `${PROJECT_ID}.jsonl`),
      `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`,
    );
  }

  const env = {
    cwd: process.cwd(),
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    home: process.env["HOME"] ?? "",
    xdgDataHome: undefined,
    platform: process.platform,
    localAppData: undefined,
  };

  function explainInput(id: string): Parameters<typeof runMemoryExplain>[0] {
    return {
      memoryEntryId: id,
      storeFlag: store,
      jsonFlag: false,
      ...env,
      stdout: (line: string) => lines.push(line),
      stderr: (line: string) => errLines.push(line),
    };
  }

  function searchInput(
    over: Partial<Parameters<typeof runMemorySearch>[0]> = {},
  ): Parameters<typeof runMemorySearch>[0] {
    return {
      projectName: "demo",
      queryFlag: undefined,
      typeFlag: undefined,
      confidenceFlag: undefined,
      scopeFlag: undefined,
      includeStale: false,
      limitFlag: undefined,
      storeFlag: store,
      jsonFlag: false,
      ...env,
      stdout: (line: string) => lines.push(line),
      stderr: (line: string) => errLines.push(line),
      nowMs: () => Date.parse(NOW),
      ...(proPublicKey === undefined ? {} : { publicKey: proPublicKey }),
      ...over,
    };
  }

  function listInput(
    over: Partial<Parameters<typeof runMemoryList>[0]> = {},
  ): Parameters<typeof runMemoryList>[0] {
    return {
      projectName: "demo",
      storeFlag: store,
      jsonFlag: false,
      ...env,
      stdout: (line: string) => lines.push(line),
      stderr: (line: string) => errLines.push(line),
      nowMs: () => Date.parse(NOW),
      ...(proPublicKey === undefined ? {} : { publicKey: proPublicKey }),
      ...over,
    };
  }

  it("pins the exact --as-of upsell sentence", () => {
    expect(MEMORY_AS_OF_UPSELL).toBe(
      "Time-travel queries (--as-of) are a Mega Saver Pro feature. Activate a key: mega license activate <key>.",
    );
  });

  it("explain shows lineage lines on the successor", async () => {
    await seedStore();
    const code = await runMemoryExplain(explainInput(NEW_ID));
    expect(code).toBe(0);
    expect(lines).toContain(`${"validFrom".padEnd(16, " ")}${TS_NEW}`);
    expect(lines).toContain(`${"supersedesId".padEnd(16, " ")}${OLD_ID}`);
    expect(lines).toContain(`${"supersedes".padEnd(16, " ")}${OLD_ID} ("Use npm")`);
  });

  it("explain shows validTo and supersededBy on the predecessor", async () => {
    await seedStore();
    const code = await runMemoryExplain(explainInput(OLD_ID));
    expect(code).toBe(0);
    expect(lines).toContain(`${"validTo".padEnd(16, " ")}${T_CLOSE}`);
    expect(lines).toContain(`${"supersededBy".padEnd(16, " ")}${NEW_ID} ("Use pnpm")`);
  });

  it("pro search --as-of returns the predecessor at a historical instant", async () => {
    await seedStore();
    activatePro();
    const code = await runMemorySearch(searchInput({ asOfFlag: T_BEFORE }));
    expect(code).toBe(0);
    expect(lines.some((l) => l.startsWith(OLD_ID))).toBe(true);
    expect(lines.some((l) => l.startsWith(NEW_ID))).toBe(false);
  });

  it("search without the flag returns only the successor and never gates", async () => {
    await seedStore();
    // No license on purpose: if the no-flag path called checkEntitlement, the
    // upsell (not the hits) would print.
    const code = await runMemorySearch(searchInput());
    expect(code).toBe(0);
    expect(lines.some((l) => l.startsWith(NEW_ID))).toBe(true);
    expect(lines.some((l) => l.startsWith(OLD_ID))).toBe(false);
    expect(lines.join("\n")).not.toContain("Pro feature");
  });

  it("free search --as-of prints the upsell and exits 0", async () => {
    await seedStore();
    const code = await runMemorySearch(searchInput({ asOfFlag: T_BEFORE }));
    expect(code).toBe(0);
    expect(lines).toEqual([MEMORY_AS_OF_UPSELL]);
  });

  it("free list --as-of prints the upsell and exits 0", async () => {
    await seedStore();
    const code = await runMemoryList(listInput({ asOfFlag: T_BEFORE }));
    expect(code).toBe(0);
    expect(lines).toEqual([MEMORY_AS_OF_UPSELL]);
  });

  it("pro list --as-of filters to entries current at the instant", async () => {
    await seedStore();
    activatePro();
    const code = await runMemoryList(listInput({ asOfFlag: T_BEFORE }));
    expect(code).toBe(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.startsWith(OLD_ID)).toBe(true);
  });

  it("list without the flag shows everything, unchanged", async () => {
    await seedStore();
    const code = await runMemoryList(listInput());
    expect(code).toBe(0);
    expect(lines).toHaveLength(2);
    expect(lines.join("\n")).not.toContain("Pro feature");
  });

  it("pro search --as-of with an invalid datetime exits 1", async () => {
    await seedStore();
    activatePro();
    const code = await runMemorySearch(searchInput({ asOfFlag: "yesterday" }));
    expect(code).toBe(1);
    expect(errLines).toContain('error: invalid as-of "yesterday", expected ISO-8601 datetime');
  });

  it("pro list --as-of with an invalid datetime exits 1", async () => {
    await seedStore();
    activatePro();
    const code = await runMemoryList(listInput({ asOfFlag: "yesterday" }));
    expect(code).toBe(1);
    expect(errLines).toContain('error: invalid as-of "yesterday", expected ISO-8601 datetime');
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain
pnpm build && pnpm --filter @megasaver/cli test
```

Expected: `explain-asof.test.ts` fails at import time (`MEMORY_AS_OF_UPSELL`
is not exported from `shared.js`). Everything else green.

- [ ] **Step 3: Implement — `errors.ts` (exact edit)**

Append directly after the existing `invalidExpiresMessage` function
(errors.ts:422-427):

```ts
// OLD
export function invalidExpiresMessage(value: string): CliMessage {
  return {
    message: `error: invalid expires "${value}", expected ISO-8601 datetime`,
    exitCode: 1,
  };
}
```

```ts
// NEW
export function invalidExpiresMessage(value: string): CliMessage {
  return {
    message: `error: invalid expires "${value}", expected ISO-8601 datetime`,
    exitCode: 1,
  };
}

export function invalidAsOfMessage(value: string): CliMessage {
  return {
    message: `error: invalid as-of "${value}", expected ISO-8601 datetime`,
    exitCode: 1,
  };
}
```

- [ ] **Step 4: Implement — `memory/shared.ts` (append at end of file)**

Append after `formatMemoryValidationLines` (end of file):

```ts
// Shared by the search/list --as-of gates: one sentence, two commands.
export const MEMORY_AS_OF_UPSELL =
  "Time-travel queries (--as-of) are a Mega Saver Pro feature. Activate a key: mega license activate <key>.";

export function formatMemoryLineageLines(
  entry: MemoryEntry,
  all: readonly MemoryEntry[],
): string[] {
  const lines: string[] = [];
  if (entry.validFrom !== undefined) lines.push(`${padExplain("validFrom")}${entry.validFrom}`);
  if (entry.validTo != null) lines.push(`${padExplain("validTo")}${entry.validTo}`);
  if (entry.supersedesId !== undefined) {
    lines.push(`${padExplain("supersedesId")}${entry.supersedesId}`);
    const predecessor = all.find((e) => e.id === entry.supersedesId);
    if (predecessor !== undefined) {
      lines.push(`${padExplain("supersedes")}${predecessor.id} ("${predecessor.title}")`);
    }
  }
  const successor = all
    .filter((e) => e.supersedesId === entry.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (successor !== undefined) {
    lines.push(`${padExplain("supersededBy")}${successor.id} ("${successor.title}")`);
  }
  return lines;
}
```

(`MemoryEntry` and `padExplain` already exist in this file — no new imports.)

- [ ] **Step 5: Implement — `explain.ts` (exact edits)**

Edit 1 — import:

```ts
// OLD
import {
  formatMemoryExplainLines,
  formatMemoryValidationLines,
  memoryEntryIdSchema,
} from "./shared.js";
```

```ts
// NEW
import {
  formatMemoryExplainLines,
  formatMemoryLineageLines,
  formatMemoryValidationLines,
  memoryEntryIdSchema,
} from "./shared.js";
```

Edit 2 — third section loop (explain.ts:62-63):

```ts
// OLD
      for (const line of formatMemoryExplainLines(entry)) input.stdout(line);
      for (const line of formatMemoryValidationLines(validation)) input.stdout(line);
```

```ts
// NEW
      for (const line of formatMemoryExplainLines(entry)) input.stdout(line);
      for (const line of formatMemoryValidationLines(validation)) input.stdout(line);
      const all = registry.listMemoryEntries(entry.projectId);
      for (const line of formatMemoryLineageLines(entry, all)) input.stdout(line);
```

- [ ] **Step 6: Implement — `search.ts` (exact edits)**

Edit 1 — imports (top of file):

```ts
// OLD
import {
  type MemorySearchQuery,
  memoryConfidenceSchema,
  memoryScopeSchema,
  memoryTypeSchema,
} from "@megasaver/core";
import { defineCommand } from "citty";
import {
  invalidConfidenceMessage,
  invalidScopeMessage,
  invalidTypeMessage,
  mapErrorToCliMessage,
  projectNotFoundMessage,
} from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { projectNameSchema } from "../shared/schemas.js";
import { formatMemorySearchLine } from "./shared.js";
```

```ts
// NEW
import type { KeyObject } from "node:crypto";
import {
  type MemorySearchQuery,
  memoryConfidenceSchema,
  memoryScopeSchema,
  memoryTypeSchema,
} from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
import { defineCommand } from "citty";
import { z } from "zod";
import {
  invalidAsOfMessage,
  invalidConfidenceMessage,
  invalidScopeMessage,
  invalidTypeMessage,
  mapErrorToCliMessage,
  projectNotFoundMessage,
} from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { projectNameSchema } from "../shared/schemas.js";
import { MEMORY_AS_OF_UPSELL, formatMemorySearchLine } from "./shared.js";
```

Edit 2 — input type:

```ts
// OLD
  includeStale: boolean;
  allFlag?: boolean;
  limitFlag: number | undefined;
```

```ts
// NEW
  includeStale: boolean;
  allFlag?: boolean;
  asOfFlag?: string | undefined;
  nowMs?: () => number;
  publicKey?: KeyObject | string;
  limitFlag: number | undefined;
```

Edit 3 — gate + plumb, immediately after the scope validation block and before
the store `try {`:

```ts
// OLD
  if (input.scopeFlag !== undefined) {
    const result = memoryScopeSchema.safeParse(input.scopeFlag);
    if (!result.success) {
      const cli = invalidScopeMessage(input.scopeFlag);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    query.scope = result.data;
  }

  try {
```

```ts
// NEW
  if (input.scopeFlag !== undefined) {
    const result = memoryScopeSchema.safeParse(input.scopeFlag);
    if (!result.success) {
      const cli = invalidScopeMessage(input.scopeFlag);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    query.scope = result.data;
  }

  // --as-of is the only Pro-gated path here; without the flag this command
  // makes no entitlement call and behaves exactly as before.
  if (input.asOfFlag !== undefined) {
    const ent = checkEntitlement("savings-analytics", {
      storeRoot: rootDir,
      now: input.nowMs ?? (() => Date.now()),
      ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
    });
    if (!ent.entitled) {
      input.stdout(MEMORY_AS_OF_UPSELL);
      return 0;
    }
    if (!z.string().datetime({ offset: true }).safeParse(input.asOfFlag).success) {
      const cli = invalidAsOfMessage(input.asOfFlag);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    query.asOf = input.asOfFlag;
  }

  try {
```

Edit 4 — citty args block:

```ts
// OLD
    "include-stale": { type: "boolean", default: false, description: "Include stale entries." },
```

```ts
// NEW
    "include-stale": { type: "boolean", default: false, description: "Include stale entries." },
    "as-of": {
      type: "string",
      description: "Only entries valid at this ISO-8601 instant (Pro).",
    },
```

Edit 5 — run() wrapper:

```ts
// OLD
      includeStale: args["include-stale"] === true,
      allFlag: args.all === true,
```

```ts
// NEW
      includeStale: args["include-stale"] === true,
      allFlag: args.all === true,
      asOfFlag: typeof args["as-of"] === "string" ? args["as-of"] : undefined,
```

- [ ] **Step 7: Implement — `list.ts` (exact edits)**

Edit 1 — imports:

```ts
// OLD
import { defineCommand } from "citty";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { projectNameSchema } from "../shared/schemas.js";
import { formatMemoryListLine } from "./shared.js";
```

```ts
// NEW
import type { KeyObject } from "node:crypto";
import { isCurrent } from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
import { defineCommand } from "citty";
import { z } from "zod";
import {
  invalidAsOfMessage,
  mapErrorToCliMessage,
  projectNotFoundMessage,
} from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { projectNameSchema } from "../shared/schemas.js";
import { MEMORY_AS_OF_UPSELL, formatMemoryListLine } from "./shared.js";
```

Edit 2 — input type:

```ts
// OLD
export type RunMemoryListInput = {
  projectName: string;
  storeFlag: string | undefined;
  jsonFlag: boolean;
```

```ts
// NEW
export type RunMemoryListInput = {
  projectName: string;
  storeFlag: string | undefined;
  jsonFlag: boolean;
  asOfFlag?: string | undefined;
  nowMs?: () => number;
  publicKey?: KeyObject | string;
```

Edit 3 — gate after the projectName parse, before the store `try {`:

```ts
// OLD
  let projectName: string;
  try {
    projectName = projectNameSchema.parse(input.projectName);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "name" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
```

```ts
// NEW
  let projectName: string;
  try {
    projectName = projectNameSchema.parse(input.projectName);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "name" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  // --as-of is the only Pro-gated path here; without the flag this command
  // makes no entitlement call and behaves exactly as before.
  if (input.asOfFlag !== undefined) {
    const ent = checkEntitlement("savings-analytics", {
      storeRoot: rootDir,
      now: input.nowMs ?? (() => Date.now()),
      ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
    });
    if (!ent.entitled) {
      input.stdout(MEMORY_AS_OF_UPSELL);
      return 0;
    }
    if (!z.string().datetime({ offset: true }).safeParse(input.asOfFlag).success) {
      const cli = invalidAsOfMessage(input.asOfFlag);
      input.stderr(cli.message);
      return cli.exitCode;
    }
  }

  try {
```

Edit 4 — the isCurrent filter on top of today's output (JSON included):

```ts
// OLD
    const entries = registry.listMemoryEntries(project.id);
    if (input.jsonFlag) {
      input.stdout(JSON.stringify(entries));
    } else {
      for (const entry of entries) {
        input.stdout(formatMemoryListLine(entry));
      }
    }
    return 0;
```

```ts
// NEW
    const asOf = input.asOfFlag;
    const entries = registry.listMemoryEntries(project.id);
    const visible = asOf === undefined ? entries : entries.filter((e) => isCurrent(e, asOf));
    if (input.jsonFlag) {
      input.stdout(JSON.stringify(visible));
    } else {
      for (const entry of visible) {
        input.stdout(formatMemoryListLine(entry));
      }
    }
    return 0;
```

Edit 5 — citty args + run() wrapper:

```ts
// OLD
    store: { type: "string", description: "Override store directory." },
    json: {
      type: "boolean",
      default: false,
      description: "Emit JSON output.",
    },
  },
  async run({ args }) {
    const code = await runMemoryList({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      jsonFlag: args.json === true,
```

```ts
// NEW
    "as-of": {
      type: "string",
      description: "Only entries valid at this ISO-8601 instant (Pro).",
    },
    store: { type: "string", description: "Override store directory." },
    json: {
      type: "boolean",
      default: false,
      description: "Emit JSON output.",
    },
  },
  async run({ args }) {
    const code = await runMemoryList({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      asOfFlag: typeof args["as-of"] === "string" ? args["as-of"] : undefined,
      jsonFlag: args.json === true,
```

- [ ] **Step 8: Run the test — expect PASS**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain
pnpm build && pnpm --filter @megasaver/cli test
```

Expected: whole cli suite green, including all 12 new tests. The pre-existing
`memory.test.ts` list/search assertions passing unchanged is the byte-identical
no-flag evidence.

- [ ] **Step 9: Typecheck + lint**

```bash
pnpm typecheck && pnpm lint
```

- [ ] **Step 10: Commit**

```bash
git add apps/cli/src/commands/memory/shared.ts apps/cli/src/commands/memory/explain.ts apps/cli/src/commands/memory/search.ts apps/cli/src/commands/memory/list.ts apps/cli/src/errors.ts apps/cli/test/memory/explain-asof.test.ts
git commit -m "feat(cli): explain lineage and as-of time travel"
```
# Section 4 — Recall surfaces (Tasks 13–15)

All work happens in the execution worktree
`/Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain`
(branch `feat/living-brain`, stacked on `feat/guard`). Run every command from
that directory.

**ENVIRONMENT HAZARDS (apply to every step below):**

- Mega Saver MCP read-proxy SILENTLY TRUNCATES file reads (banner "N kept, M dropped" / "[Mega Saver: compressed...]") — read files via `sed -n 'A,Bp'` in <=60-line chunks, locate with `grep -n`.
- `pnpm build` BEFORE package tests (dist resolution).
- `pnpm --filter X test -- pattern` does NOT narrow — run the whole package suite.
- Full `pnpm typecheck` REQUIRED before every commit — package vitest does NOT catch TS4111 (noPropertyAccessFromIndexSignature). Use bracket access + `// biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)` where needed.
- No bare `===` in zsh echo commands.

**Section-wide dependency:** these tasks import `changedFromFor` and
`type ChangedFrom` from `@megasaver/core` — both are created in
`packages/core/src/supersession.ts` and re-exported from
`packages/core/src/index.ts` by the earlier core tasks of this plan. Task 13
Step 1 verifies that precondition; if it fails, STOP — the core tasks are not
merged yet.

**Format authority note:** the render suffix implemented here follows the
BINDING contract exactly — `(changed from "<title>", closed <closedAt.slice(0,10)>)`
— which supersedes the spec §4.4 sketch text `(changed from: "<pred.title>",
closed <validTo>)` (no colon after "from", date sliced to 10 chars). Same for
the warm-start suffix ` (was: "<title>" until <closedAt.slice(0,10)>)`.

---

### Task 13: `changedFrom` on MCP recall surfaces (`get_relevant_memories` + `mega_recall`)

**Files:**

- Modify: `packages/mcp-bridge/src/tools/get-relevant-memories.ts`
- Modify: `packages/mcp-bridge/src/tools/recall.ts`
- Create (test): `packages/mcp-bridge/test/tools/changed-from.test.ts`

Both handlers gain response-only enrichment: any hit whose `supersedesId`
names a predecessor with `validTo != null` (closed) carries
`changedFrom: { title, closedAt, reason? }`. Reopened predecessors
(`validTo` null) carry nothing. `changedFrom` is NEVER persisted. No
`server.ts` change is needed — both dispatch cases return the handler result
verbatim, so the additive field flows through.

- [ ] **Step 1: Verify the core dependency exists**

  ```bash
  cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain
  grep -n "changedFromFor" packages/core/src/index.ts packages/core/src/supersession.ts
  ```

  Expected: at least one hit in each file (the export line in `index.ts`, the
  function in `supersession.ts`). If either grep is empty, STOP — the core
  supersession tasks of this plan have not landed; do not improvise the
  helper locally.

- [ ] **Step 2: Write the failing test (complete file)**

  Also confirm the two source files still match the shapes this task edits
  (earlier plan tasks do not touch them, but verify):

  ```bash
  grep -n "GetRelevantMemoriesResult\|return { memory" packages/mcp-bridge/src/tools/get-relevant-memories.ts
  grep -n "RecallToolResult\|allMemory" packages/mcp-bridge/src/tools/recall.ts
  ```

  Expected: `get-relevant-memories.ts` has `export type GetRelevantMemoriesResult = { memory: readonly MemoryEntry[] };`
  plus two `return { memory ... }` sites; `recall.ts` has `const allMemory = env.registry.listMemoryEntries(session.projectId);`.

  Create `packages/mcp-bridge/test/tools/changed-from.test.ts` with exactly:

  ```typescript
  import { mkdtemp, rm } from "node:fs/promises";
  import { tmpdir } from "node:os";
  import { join } from "node:path";
  import {
    type CoreRegistry,
    createInMemoryCoreRegistry,
    memoryEmbeddingsSidecarPath,
  } from "@megasaver/core";
  import { writeVectors } from "@megasaver/embeddings";
  import type { MemoryEntryId, ProjectId, SessionId } from "@megasaver/shared";
  import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
  import { handleGetRelevantMemories } from "../../src/tools/get-relevant-memories.js";
  import { handleRecall } from "../../src/tools/recall.js";

  vi.mock("@megasaver/daemon", () => ({ getRunningDaemon: vi.fn() }));
  import { getRunningDaemon } from "@megasaver/daemon";
  const mockGetRunningDaemon = vi.mocked(getRunningDaemon);

  const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
  const SESSION_ID = "22222222-2222-4222-8222-222222222222" as SessionId;
  const PREDECESSOR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as MemoryEntryId;
  const SUCCESSOR_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as MemoryEntryId;
  const OTHER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc" as MemoryEntryId;
  const TS = "2026-06-11T00:00:00.000Z";
  const CLOSED_AT = "2026-07-01T00:00:00.000Z";
  // Pinned asOf AFTER the close: the predecessor is non-current, the successor
  // current — deterministic regardless of the wall clock at test time.
  const AS_OF = "2026-07-12T00:00:00.000Z";

  const EXPECTED_CHANGED_FROM = {
    title: "use npm",
    closedAt: CLOSED_AT,
    reason: "package manager switched",
  };

  function seededRegistry(opts?: { predecessorValidTo?: string | null }): CoreRegistry {
    const registry = createInMemoryCoreRegistry();
    registry.createProject({
      id: PROJECT_ID,
      name: "demo",
      rootPath: "/tmp/demo",
      createdAt: TS,
      updatedAt: TS,
    });
    registry.createSession({
      id: SESSION_ID,
      projectId: PROJECT_ID,
      agentId: "claude-code",
      riskLevel: "medium",
      title: "demo",
      startedAt: TS,
      endedAt: null,
    });
    registry.createMemoryEntry({
      id: PREDECESSOR_ID,
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      content: "use npm for installs",
      type: "decision",
      title: "use npm",
      keywords: [],
      confidence: "medium",
      source: "manual",
      approval: "approved",
      stale: false,
      createdAt: TS,
      updatedAt: TS,
      validTo: opts?.predecessorValidTo === undefined ? CLOSED_AT : opts.predecessorValidTo,
    });
    registry.createMemoryEntry({
      id: SUCCESSOR_ID,
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      content: "use pnpm for installs",
      type: "decision",
      title: "use pnpm",
      keywords: [],
      confidence: "medium",
      source: "manual",
      approval: "approved",
      stale: false,
      createdAt: TS,
      updatedAt: TS,
      supersedesId: PREDECESSOR_ID,
      reason: "package manager switched",
    });
    return registry;
  }

  describe("changedFrom enrichment on MCP recall surfaces", () => {
    let store: string;
    beforeEach(async () => {
      store = await mkdtemp(join(tmpdir(), "mcp-changed-from-"));
      // No daemon → forwardOrFallback runs the inProcess closure under test.
      mockGetRunningDaemon.mockResolvedValue(null);
    });
    afterEach(async () => {
      await rm(store, { recursive: true, force: true });
      vi.clearAllMocks();
    });

    it("get_relevant_memories (BM25 branch) enriches a hit with a closed predecessor", async () => {
      const registry = seededRegistry();
      const result = await handleGetRelevantMemories(
        { registry },
        { projectId: PROJECT_ID, task: "pnpm installs", asOf: AS_OF },
      );
      const hit = result.memory.find((m) => m.id === SUCCESSOR_ID);
      expect(hit).toBeDefined();
      expect(hit?.changedFrom).toEqual(EXPECTED_CHANGED_FROM);
    });

    it("get_relevant_memories carries no changedFrom for a reopened predecessor", async () => {
      const registry = seededRegistry({ predecessorValidTo: null });
      const result = await handleGetRelevantMemories(
        { registry },
        { projectId: PROJECT_ID, task: "pnpm installs", asOf: AS_OF },
      );
      const hit = result.memory.find((m) => m.id === SUCCESSOR_ID);
      expect(hit).toBeDefined();
      expect(hit?.changedFrom).toBeUndefined();
    });

    it("get_relevant_memories (semantic branch) enriches too — injected embedFn + vectors", async () => {
      const registry = seededRegistry();
      // Second CURRENT entry with identical lexical text so BM25 ties — only
      // the injected sidecar vectors can produce the [SUCCESSOR, OTHER] order,
      // proving the semantic branch (not BM25 fallback) served the response.
      registry.createMemoryEntry({
        id: OTHER_ID,
        projectId: PROJECT_ID,
        sessionId: null,
        scope: "project",
        content: "use pnpm for installs",
        type: "decision",
        title: "use pnpm",
        keywords: [],
        confidence: "medium",
        source: "manual",
        approval: "approved",
        stale: false,
        createdAt: TS,
        updatedAt: TS,
      });
      // Full coverage of the AS_OF-current candidates (the closed predecessor
      // is not a candidate, so it needs no vector).
      writeVectors(memoryEmbeddingsSidecarPath(store, PROJECT_ID), [
        { id: SUCCESSOR_ID, vector: [0.9, 0.1, 0] },
        { id: OTHER_ID, vector: [0, 0, 1] },
      ]);
      const fakeEmbed = async () => [Float32Array.from([1, 0, 0])];
      const result = await handleGetRelevantMemories(
        { registry, storeRoot: store, embedFn: fakeEmbed },
        { projectId: PROJECT_ID, task: "use pnpm", asOf: AS_OF },
      );
      expect(result.memory.map((m) => m.id)).toEqual([SUCCESSOR_ID, OTHER_ID]);
      expect(result.memory[0]?.changedFrom).toEqual(EXPECTED_CHANGED_FROM);
      expect(result.memory[1]?.changedFrom).toBeUndefined();
    });

    it("mega_recall enriches in the inProcess closure and drops the closed predecessor", async () => {
      const registry = seededRegistry();
      const result = await handleRecall(
        { registry, storeRoot: store },
        { sessionId: SESSION_ID, intent: "project setup", asOf: AS_OF },
      );
      const ids = result.memory.map((m) => m.id);
      expect(ids).toContain(SUCCESSOR_ID);
      expect(ids).not.toContain(PREDECESSOR_ID);
      const hit = result.memory.find((m) => m.id === SUCCESSOR_ID);
      expect(hit?.changedFrom).toEqual(EXPECTED_CHANGED_FROM);
    });

    it("mega_recall carries no changedFrom for a reopened predecessor", async () => {
      const registry = seededRegistry({ predecessorValidTo: null });
      const result = await handleRecall(
        { registry, storeRoot: store },
        { sessionId: SESSION_ID, intent: "project setup", asOf: AS_OF },
      );
      // Reopened predecessor is recallable again — both rows return, no suffix data.
      expect(result.memory.map((m) => m.id)).toContain(PREDECESSOR_ID);
      const hit = result.memory.find((m) => m.id === SUCCESSOR_ID);
      expect(hit?.changedFrom).toBeUndefined();
    });
  });
  ```

- [ ] **Step 3: Run — expect RED**

  ```bash
  pnpm build && pnpm --filter @megasaver/mcp-bridge test
  ```

  Expected: FAIL. Three tests fail in `test/tools/changed-from.test.ts` (the
  BM25 enrich, semantic enrich, and mega_recall enrich cases) with
  `expected undefined to deeply equal { title: 'use npm', … }`. The two
  reopened-predecessor tests pass trivially (they assert absence). Vitest
  runs the new file without type-checking, so the not-yet-existing
  `changedFrom` property fails at assertion time, not compile time. All other
  mcp-bridge tests stay green.

- [ ] **Step 4: Implement `get-relevant-memories.ts` (four exact edits)**

  Edit 4a — imports (top of file). Replace:

  ```typescript
  import {
    type CoreRegistry,
    CoreRegistryError,
    type MemoryEntry,
    isRecallable,
    memoryEmbeddingsSidecarPath,
    searchMemoryEntriesSemantic,
  } from "@megasaver/core";
  ```

  with:

  ```typescript
  import {
    type ChangedFrom,
    type CoreRegistry,
    CoreRegistryError,
    type MemoryEntry,
    changedFromFor,
    isRecallable,
    memoryEmbeddingsSidecarPath,
    searchMemoryEntriesSemantic,
  } from "@megasaver/core";
  ```

  Edit 4b — widen the result type. Replace:

  ```typescript
  export type GetRelevantMemoriesResult = { memory: readonly MemoryEntry[] };
  ```

  with:

  ```typescript
  export type GetRelevantMemoriesResult = {
    memory: readonly (MemoryEntry & { changedFrom?: ChangedFrom })[];
  };
  ```

  Edit 4c — insert the enrichment helper immediately BEFORE the comment block
  that starts `// Free-text task → top-N relevant memories.` (which precedes
  `export async function handleGetRelevantMemories`):

  ```typescript
  // changedFrom enrichment (response-only, never persisted): a hit that
  // supersedes a CLOSED predecessor carries { title, closedAt, reason } so the
  // agent sees what changed. Reopened predecessors (validTo null) carry nothing.
  function withChangedFrom(
    registry: CoreRegistry,
    hits: readonly MemoryEntry[],
  ): (MemoryEntry & { changedFrom?: ChangedFrom })[] {
    const byId = new Map<string, MemoryEntry>();
    for (const hit of hits) {
      if (hit.supersedesId === undefined || byId.has(hit.supersedesId)) continue;
      const predecessor = registry.getMemoryEntry(hit.supersedesId);
      if (predecessor !== null) byId.set(hit.supersedesId, predecessor);
    }
    return hits.map((hit) => {
      const changedFrom = changedFromFor(hit, byId);
      return { ...hit, ...(changedFrom === undefined ? {} : { changedFrom }) };
    });
  }
  ```

  Edit 4d — enrich BOTH return branches inside `handleGetRelevantMemories`.
  Replace:

  ```typescript
      const semantic = await semanticMemoryRanking(env, projectId as ProjectId, task, limit, at);
      if (semantic !== null) return { memory: semantic };
      const memory = env.registry.searchMemoryEntries(projectId as ProjectId, {
        text: task,
        asOf: at,
        ...(limit !== undefined ? { limit } : {}),
      });
      return { memory };
  ```

  with:

  ```typescript
      const semantic = await semanticMemoryRanking(env, projectId as ProjectId, task, limit, at);
      if (semantic !== null) return { memory: withChangedFrom(env.registry, semantic) };
      const memory = env.registry.searchMemoryEntries(projectId as ProjectId, {
        text: task,
        asOf: at,
        ...(limit !== undefined ? { limit } : {}),
      });
      return { memory: withChangedFrom(env.registry, memory) };
  ```

- [ ] **Step 5: Implement `recall.ts` (full file replacement)**

  First confirm the file is unchanged from the base (65 lines):

  ```bash
  wc -l packages/mcp-bridge/src/tools/recall.ts
  ```

  Expected: `65`. Then replace the ENTIRE content of
  `packages/mcp-bridge/src/tools/recall.ts` with:

  ```typescript
  import { type ChunkSetSummary, listChunkSets } from "@megasaver/content-store";
  import {
    type ChangedFrom,
    type CoreRegistry,
    type MemoryEntry,
    changedFromFor,
    isRecallable,
  } from "@megasaver/core";
  import type { SessionId } from "@megasaver/shared";
  import { z } from "zod";
  import { McpBridgeError } from "../errors.js";
  import { forwardOrFallback } from "./forward.js";

  export type RecallToolEnv = { registry: CoreRegistry; storeRoot: string };

  const recallInputSchema = z
    .object({
      sessionId: z.string().min(1),
      intent: z.string(),
      maxBytes: z.number().int().positive().optional(),
      // Bi-temporal time-travel: recall what we believed as of this instant.
      // Absent ⇒ now ⇒ currently-valid memories only.
      asOf: z.string().datetime({ offset: true }).optional(),
    })
    .strict();

  export type RecallToolResult = {
    memory: readonly (MemoryEntry & { changedFrom?: ChangedFrom })[];
    chunkSets: readonly ChunkSetSummary[];
  };

  export async function handleRecall(
    env: RecallToolEnv,
    rawArgs: unknown,
  ): Promise<RecallToolResult> {
    const parsed = recallInputSchema.safeParse(rawArgs);
    if (!parsed.success) {
      throw new McpBridgeError("validation_failed", parsed.error.message);
    }
    const { sessionId, intent, asOf } = parsed.data;

    if (intent.trim() === "") {
      throw new McpBridgeError("intent_required", "mega_recall requires a non-empty intent");
    }

    const at = asOf ?? new Date().toISOString();

    return forwardOrFallback(
      env.storeRoot,
      "/recall-registry",
      { sessionId, intent, ...(asOf !== undefined ? { asOf } : {}) },
      async () => {
        const session = env.registry.getSession(sessionId as SessionId);
        if (session === null) {
          throw new McpBridgeError("session_not_found", `session not found: ${sessionId}`);
        }

        const allMemory = env.registry.listMemoryEntries(session.projectId);
        // changedFrom enrichment (response-only): the predecessor lookup is free
        // from the already-loaded allMemory. NOTE: the daemon /recall-registry
        // route has no server-side handler today; if one ever lands it must
        // mirror this enrichment.
        const byId = new Map<string, MemoryEntry>(allMemory.map((m) => [m.id, m]));
        const memory = allMemory
          .filter(
            (m) => isRecallable(m, at) && (m.sessionId === session.id || m.scope === "project"),
          )
          .map((m) => {
            const changedFrom = changedFromFor(m, byId);
            return { ...m, ...(changedFrom === undefined ? {} : { changedFrom }) };
          });
        const chunkSets = await listChunkSets({
          storeRoot: env.storeRoot,
          projectId: session.projectId,
          sessionId: session.id,
        });

        return { memory, chunkSets };
      },
    );
  }
  ```

- [ ] **Step 6: Run — expect GREEN (whole package)**

  ```bash
  pnpm build && pnpm --filter @megasaver/mcp-bridge test
  ```

  Expected: PASS. All 5 tests in `changed-from.test.ts` green, AND the whole
  existing mcp-bridge suite green — in particular `test/approve-memory.test.ts`
  (703 lines), `test/tools/recall.test.ts` (the daemon-path test at line 167
  does `expect(result).toEqual(daemonResult)` on the FORWARDED path, which this
  change does not touch), `test/mcp-leak.test.ts`, and
  `test/tools/get-relevant-memories-semantic.test.ts` (its assertions map over
  `id`/`content` only; the additive field cannot break them).

- [ ] **Step 7: Lint + typecheck**

  ```bash
  pnpm lint:fix && pnpm typecheck
  ```

  Expected: both exit 0. (`lint:fix` normalizes import order if it drifted.)

- [ ] **Step 8: Commit**

  ```bash
  git add packages/mcp-bridge/src/tools/get-relevant-memories.ts packages/mcp-bridge/src/tools/recall.ts packages/mcp-bridge/test/tools/changed-from.test.ts
  git commit -m "feat(mcp-bridge): changedFrom on recall surfaces"
  ```

---

### Task 14: connector — validity gate, `memoryChangedFrom`, render suffix, sentinel guard

**Files:**

- Modify: `packages/connectors/shared/src/context.ts`
- Modify: `packages/connectors/shared/src/render.ts`
- Modify: `apps/cli/src/commands/connector/shared.ts`
- Modify: `apps/cli/src/commands/connector/sync.ts`
- Modify: `apps/cli/src/commands/connector/status.ts`
- Modify: `apps/cli/src/commands/connector/doctor.ts`
- Modify: `apps/cli/src/commands/warmup.ts`
- Modify (test): `apps/cli/test/connector-byte-equality.test.ts`
- Modify (test): `packages/connectors/shared/test/context.test.ts` (append)
- Modify (test): `packages/connectors/shared/test/render.test.ts` (append)
- Create (test): `apps/cli/test/connector/build-context.test.ts`

Two coupled changes (spec §3.3 + §4.4, architect #1 security):
`filterMemoryEntriesForSession` switches its bare `approval === "approved"`
check to the shared `isRecallable(entry, now)` gate — a deliberate behavior
change: closed (superseded) and archival-tier rows stop rendering in the
connector Memory block. `ConnectorContext` gains an optional
`memoryChangedFrom` record built in `buildConnectorContext` (which gains a
required `now: string` param, threaded from all four call sites), rendered by
`renderMemoryEntries` as a one-line suffix. The `superRefine` sentinel guard
is EXTENDED to the record's titles: the predecessor is filtered OUT of
`memoryEntries`, so its agent-controlled title reaches the rendered block only
via `memoryChangedFrom` — without the guard an agent could plant a sentinel in
a memory title, supersede it, and inject the sentinel into agent config files.

- [ ] **Step 1: Failing schema + render tests (connectors-shared)**

  Append to `packages/connectors/shared/test/context.test.ts` (the file ends
  with a top-level `});` closing its last `describe`; append AFTER it):

  ```bash
  cat >> packages/connectors/shared/test/context.test.ts <<'EOF'

  describe("memoryChangedFrom", () => {
    const changedFrom = { title: "use npm", closedAt: "2026-07-01T00:00:00.000Z" };

    it("accepts a sentinel-free changedFrom record", () => {
      const ctx = {
        ...buildContext({
          memoryEntries: [{ id: MEMORY_ID, scope: "project", content: "use pnpm" }],
        }),
        memoryChangedFrom: { [MEMORY_ID]: changedFrom },
      };
      expect(() => ConnectorContextSchema.parse(ctx)).not.toThrow();
    });

    it("rejects sentinel substrings in changedFrom titles", () => {
      const ctx = {
        ...buildContext(),
        memoryChangedFrom: {
          [MEMORY_ID]: { ...changedFrom, title: "evil <!-- MEGA SAVER:BEGIN --> was" },
        },
      };
      expect(() => ConnectorContextSchema.parse(ctx)).toThrow();
    });

    it("rejects sentinel lookalikes with zero-width chars in changedFrom titles", () => {
      // Same lookalike as the "rejects sentinel lookalikes with zero-width
      // chars" projectName test above (a zero-width space splits the sentinel).
      // That test embeds the LITERAL U+200B; here it is the \u200B escape —
      // identical at runtime, and immune to invisible-byte loss in transit.
      const ctx = {
        ...buildContext(),
        memoryChangedFrom: {
          [MEMORY_ID]: { ...changedFrom, title: "evil <!-- MEGA SAVER:BEGIN --\u200B> was" },
        },
      };
      expect(() => ConnectorContextSchema.parse(ctx)).toThrow();
    });
  });
  EOF
  ```

  Append to `packages/connectors/shared/test/render.test.ts` (same append-at-
  end mechanics):

  ```bash
  cat >> packages/connectors/shared/test/render.test.ts <<'EOF'

  describe("changedFrom suffix", () => {
    it("renders the changed-from suffix when memoryChangedFrom has the entry", () => {
      const block = renderBlock({
        ...buildContext({
          memoryEntries: [{ id: MEMORY_ID, scope: "project", content: "use pnpm" }],
        }),
        memoryChangedFrom: {
          [MEMORY_ID]: { title: "use npm", closedAt: "2026-07-01T00:00:00.000Z" },
        },
      });
      expect(block).toContain(
        `- [project:${MEMORY_ID}] use pnpm (changed from "use npm", closed 2026-07-01)`,
      );
    });

    it("renders no suffix for entries without a changedFrom record", () => {
      const block = renderBlock(
        buildContext({ memoryEntries: [{ id: MEMORY_ID, scope: "project", content: "use pnpm" }] }),
      );
      expect(block).toContain(`- [project:${MEMORY_ID}] use pnpm\n`);
      expect(block).not.toContain("changed from");
    });
  });
  EOF
  ```

- [ ] **Step 2: Run — expect RED**

  ```bash
  pnpm build && pnpm --filter @megasaver/connectors-shared test
  ```

  Expected: FAIL. "accepts a sentinel-free changedFrom record" and "renders
  the changed-from suffix …" fail — `ConnectorContextSchema` is `.strict()`,
  so the unknown `memoryChangedFrom` key is rejected (the reject tests pass
  pre-implementation for the wrong reason — the strict-key rejection — which
  is why the accept test is the load-bearing red). All pre-existing tests
  stay green.

- [ ] **Step 3: Implement `context.ts` + `render.ts`**

  Edit 3a — `packages/connectors/shared/src/context.ts`, schema object.
  Replace:

  ```ts
      agentId: agentIdSchema,
      project: projectSchema,
      session: sessionSchema.nullable(),
      memoryEntries: z.array(memoryEntrySchema),
    })
  ```

  with:

  ```ts
      agentId: agentIdSchema,
      project: projectSchema,
      session: sessionSchema.nullable(),
      memoryEntries: z.array(memoryEntrySchema),
      // Response/render-only data (never persisted), keyed by memory entry id:
      // the CLOSED predecessor's title/closedAt for the "changed from" suffix.
      memoryChangedFrom: z
        .record(z.object({ title: z.string(), closedAt: z.string(), reason: z.string().optional() }))
        .optional(),
    })
  ```

  Edit 3b — same file, extend the `superRefine`. The refinement body ends
  with the `context.memoryEntries.forEach((entry, index) => { … });` block
  followed by the closing `});` of the superRefine callback. Insert BETWEEN
  the `forEach`'s closing `});` and the superRefine's closing `});`:

  ```ts

      // The predecessor named by changedFrom is filtered OUT of memoryEntries
      // (closed rows are not recallable), so its agent-controlled title reaches
      // the rendered block only through this record — guard it like the entries.
      for (const [id, changedFrom] of Object.entries(context.memoryChangedFrom ?? {})) {
        if (containsSentinel(changedFrom.title)) {
          ctx.addIssue({
            code: "custom",
            message: "Changed-from title cannot contain Mega Saver sentinels.",
            path: ["memoryChangedFrom", id, "title"],
          });
        }
      }
  ```

  Edit 3c — `packages/connectors/shared/src/render.ts`. Replace:

  ```ts
  function renderMemoryEntries(context: ConnectorContext): string[] {
    if (context.memoryEntries.length === 0) {
      return ["- none"];
    }
    // contentSchema rejects newlines, so entry.content is always single-line here.
    return context.memoryEntries.map((entry) => `- [${entry.scope}:${entry.id}] ${entry.content}`);
  }
  ```

  with:

  ```ts
  function renderMemoryEntries(context: ConnectorContext): string[] {
    if (context.memoryEntries.length === 0) {
      return ["- none"];
    }
    // contentSchema rejects newlines, so entry.content is always single-line here.
    return context.memoryEntries.map((entry) => {
      const base = `- [${entry.scope}:${entry.id}] ${entry.content}`;
      const changedFrom = context.memoryChangedFrom?.[entry.id];
      if (changedFrom === undefined) return base;
      const closedDate = changedFrom.closedAt.slice(0, 10);
      return `${base} (changed from "${changedFrom.title}", closed ${closedDate})`;
    });
  }
  ```

- [ ] **Step 4: Run — expect GREEN (connectors-shared)**

  ```bash
  pnpm build && pnpm --filter @megasaver/connectors-shared test
  ```

  Expected: PASS, including the pre-existing inline-snapshot canonical-block
  test (unchanged output for contexts without `memoryChangedFrom`) and
  `public-export.test.ts`.

- [ ] **Step 5: Failing CLI test (complete file)**

  Create `apps/cli/test/connector/build-context.test.ts` with exactly:

  ```typescript
  import { type MemoryEntry, type Project, memoryEntrySchema } from "@megasaver/core";
  import type { ProjectId } from "@megasaver/shared";
  import { describe, expect, it } from "vitest";
  import {
    buildConnectorContext,
    filterMemoryEntriesForSession,
  } from "../../src/commands/connector/shared.js";
  import { KNOWN_TARGETS } from "../../src/known-targets.js";

  const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
  const PREDECESSOR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const SUCCESSOR_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const TS = "2026-06-11T00:00:00.000Z";
  const CLOSED_AT = "2026-07-01T00:00:00.000Z";
  const NOW = "2026-07-12T00:00:00.000Z";

  function mem(over: Partial<Record<string, unknown>> = {}): MemoryEntry {
    return memoryEntrySchema.parse({
      id: SUCCESSOR_ID,
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      type: "decision",
      title: "use pnpm",
      content: "use pnpm for installs",
      keywords: [],
      confidence: "medium",
      source: "manual",
      approval: "approved",
      stale: false,
      createdAt: TS,
      updatedAt: TS,
      ...over,
    });
  }

  const project: Project = {
    id: PROJECT_ID as ProjectId,
    name: "demo",
    rootPath: "/tmp/demo",
    createdAt: TS,
    updatedAt: TS,
  };

  const target = KNOWN_TARGETS[0]!;

  describe("connector validity gate + changedFrom (spec §3.3 / §4.4)", () => {
    const predecessor = mem({
      id: PREDECESSOR_ID,
      title: "use npm",
      content: "use npm for installs",
      validTo: CLOSED_AT,
    });
    const successor = mem({
      supersedesId: PREDECESSOR_ID,
      reason: "package manager switched",
    });

    it("filterMemoryEntriesForSession drops closed (superseded) rows", () => {
      const kept = filterMemoryEntriesForSession([predecessor, successor], null, NOW);
      expect(kept.map((e) => e.id)).toEqual([SUCCESSOR_ID]);
    });

    it("filterMemoryEntriesForSession drops archival-tier rows", () => {
      const archived = mem({ id: PREDECESSOR_ID, title: "old", tier: "archival" });
      const kept = filterMemoryEntriesForSession([archived, successor], null, NOW);
      expect(kept.map((e) => e.id)).toEqual([SUCCESSOR_ID]);
    });

    it("buildConnectorContext carries memoryChangedFrom for the successor", () => {
      const context = buildConnectorContext(target, project, [], [predecessor, successor], NOW);
      expect(context.memoryEntries.map((e) => e.id)).toEqual([SUCCESSOR_ID]);
      expect(context.memoryChangedFrom).toEqual({
        [SUCCESSOR_ID]: {
          title: "use npm",
          closedAt: CLOSED_AT,
          reason: "package manager switched",
        },
      });
    });

    it("omits memoryChangedFrom when the predecessor is reopened (validTo null)", () => {
      const reopened = mem({ id: PREDECESSOR_ID, title: "use npm", validTo: null });
      const context = buildConnectorContext(target, project, [], [reopened, successor], NOW);
      expect(context.memoryChangedFrom).toBeUndefined();
    });
  });
  ```

- [ ] **Step 6: Run — expect RED (cli)**

  ```bash
  pnpm build && pnpm --filter @megasaver/cli test
  ```

  Expected: FAIL. In the new file: the closed-row test fails (the old
  approval-only filter keeps the closed predecessor), the archival test
  fails, and the `memoryChangedFrom` test fails (`undefined` vs record).
  Vitest ignores the extra `NOW` argument at runtime pre-implementation, so
  these are assertion failures, not crashes. Everything else stays green.

- [ ] **Step 7: Implement `apps/cli/src/commands/connector/shared.ts`**

  Edit 7a — imports. Replace:

  ```ts
  import type { CoreRegistry, MemoryEntry, Project, Session } from "@megasaver/core";
  ```

  with:

  ```ts
  import {
    type ChangedFrom,
    type CoreRegistry,
    type MemoryEntry,
    type Project,
    type Session,
    changedFromFor,
    isRecallable,
  } from "@megasaver/core";
  ```

  Edit 7b — the filter. Replace:

  ```ts
  export function filterMemoryEntriesForSession(
    entries: readonly MemoryEntry[],
    session: Session | null,
  ): MemoryEntry[] {
    return entries.filter((entry) => {
      if (entry.approval !== "approved") return false;
      if (entry.scope === "project") return true;
      return session !== null && entry.sessionId === session.id;
    });
  }
  ```

  with:

  ```ts
  export function filterMemoryEntriesForSession(
    entries: readonly MemoryEntry[],
    session: Session | null,
    now: string,
  ): MemoryEntry[] {
    return entries.filter((entry) => {
      // isRecallable (approved + current + non-archival) replaces the bare
      // approval check so closed (superseded) rows stop rendering — without
      // this a changedFrom line would co-render beside the very predecessor
      // it references (spec §3.3).
      if (!isRecallable(entry, now)) return false;
      if (entry.scope === "project") return true;
      return session !== null && entry.sessionId === session.id;
    });
  }
  ```

  Edit 7c — the builder. Replace:

  ```ts
  export function buildConnectorContext(
    target: ConnectorTarget,
    project: Project,
    allSessions: readonly Session[],
    allMemoryEntries: readonly MemoryEntry[],
  ): ConnectorContext {
    const session = pickLatestOpenSession(allSessions, target.agentId);
    const filtered = filterMemoryEntriesForSession(allMemoryEntries, session);
    // connector block caps at 20 most-recent entries; older entries remain queryable via 'mega memory list'
    const memoryEntries = [...filtered]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, 20);
    return {
      agentId: target.agentId,
      project,
      session,
      memoryEntries,
    };
  }
  ```

  with:

  ```ts
  export function buildConnectorContext(
    target: ConnectorTarget,
    project: Project,
    allSessions: readonly Session[],
    allMemoryEntries: readonly MemoryEntry[],
    now: string,
  ): ConnectorContext {
    const session = pickLatestOpenSession(allSessions, target.agentId);
    const filtered = filterMemoryEntriesForSession(allMemoryEntries, session, now);
    // connector block caps at 20 most-recent entries; older entries remain queryable via 'mega memory list'
    const memoryEntries = [...filtered]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, 20);
    // changedFrom lookups go over the UNFILTERED list — the closed predecessor
    // is exactly the row filterMemoryEntriesForSession drops.
    const byId = new Map<string, MemoryEntry>(allMemoryEntries.map((m) => [m.id, m]));
    const memoryChangedFrom: Record<string, ChangedFrom> = {};
    for (const entry of memoryEntries) {
      const changedFrom = changedFromFor(entry, byId);
      if (changedFrom !== undefined) memoryChangedFrom[entry.id] = changedFrom;
    }
    return {
      agentId: target.agentId,
      project,
      session,
      memoryEntries,
      ...(Object.keys(memoryChangedFrom).length > 0 ? { memoryChangedFrom } : {}),
    };
  }
  ```

- [ ] **Step 8: Thread `now` through the four call sites**

  Contract: the call sites default to `new Date().toISOString()` (computed
  once per command run, next to the data reads); `warmup.ts` already has a
  pinned `nowIso` in scope and passes that. Locate exact lines first
  (numbers below are from the `feat/guard` base — re-verify, the read proxy
  truncates, use `grep -n` + `sed -n 'A,Bp'`):

  ```bash
  grep -n "buildConnectorContext\|listMemoryEntries(project.id)" apps/cli/src/commands/connector/sync.ts apps/cli/src/commands/connector/status.ts apps/cli/src/commands/connector/doctor.ts apps/cli/src/commands/warmup.ts
  ```

  Edit 8a — `apps/cli/src/commands/connector/sync.ts` (~lines 63-65).
  Replace:

  ```ts
      const sessions = registry.listSessions(project.id);
      const memoryEntries = registry.listMemoryEntries(project.id);
      let anyFailed = false;
  ```

  with:

  ```ts
      const sessions = registry.listSessions(project.id);
      const memoryEntries = registry.listMemoryEntries(project.id);
      const now = new Date().toISOString();
      let anyFailed = false;
  ```

  and (~line 94) replace:

  ```ts
          const context = buildConnectorContext(target, project, sessions, memoryEntries);
  ```

  with:

  ```ts
          const context = buildConnectorContext(target, project, sessions, memoryEntries, now);
  ```

  Edit 8b — `apps/cli/src/commands/connector/status.ts` (~lines 54-56).
  Replace:

  ```ts
      const sessions = registry.listSessions(project.id);
      const memoryEntries = registry.listMemoryEntries(project.id);
      let anyDriftOrError = false;
  ```

  with:

  ```ts
      const sessions = registry.listSessions(project.id);
      const memoryEntries = registry.listMemoryEntries(project.id);
      const now = new Date().toISOString();
      let anyDriftOrError = false;
  ```

  and (~line 101) replace:

  ```ts
          const context = buildConnectorContext(target, project, sessions, memoryEntries);
  ```

  with:

  ```ts
          const context = buildConnectorContext(target, project, sessions, memoryEntries, now);
  ```

  Edit 8c — `apps/cli/src/commands/connector/doctor.ts` (~lines 90-92, note
  2-space indent). Replace:

  ```ts
    const sessions = registry.listSessions(project.id);
    const memoryEntries = registry.listMemoryEntries(project.id);
    let anyError = false;
  ```

  with:

  ```ts
    const sessions = registry.listSessions(project.id);
    const memoryEntries = registry.listMemoryEntries(project.id);
    const now = new Date().toISOString();
    let anyError = false;
  ```

  and (~line 145) replace:

  ```ts
      const context = buildConnectorContext(target, project, sessions, memoryEntries);
  ```

  with:

  ```ts
      const context = buildConnectorContext(target, project, sessions, memoryEntries, now);
  ```

  Edit 8d — `apps/cli/src/commands/warmup.ts` (~line 166; `nowIso` is the
  function's existing pinned timestamp param). Replace:

  ```ts
        const context = buildConnectorContext(target, project, sessions, memoryEntries);
  ```

  with:

  ```ts
        const context = buildConnectorContext(target, project, sessions, memoryEntries, nowIso);
  ```

- [ ] **Step 9: Update the byte-equality test (deliberate expectation update)**

  `apps/cli/test/connector-byte-equality.test.ts` (~line 164). Replace:

  ```ts
          const context = buildConnectorContext(target, project, sessions, []);
  ```

  with:

  ```ts
          const context = buildConnectorContext(target, project, sessions, [], TS);
  ```

  WHY this is a deliberate update, not drift: `buildConnectorContext` gained
  a required `now` parameter, so the test must pass the fixture's pinned `TS`
  constant. The byte-equality contract itself still holds — this fixture's
  memory list is empty, so neither the `isRecallable` gate nor
  `memoryChangedFrom` can alter the rendered block, and re-applied
  `upsertBlock` output remains byte-identical even though `runConnectorSync`
  internally used a different wall-clock `now`. Only the call signature
  changed; the assertion `expect(upserted).toBe(written)` is untouched.

- [ ] **Step 10: Run — expect GREEN (cli, whole suite)**

  ```bash
  pnpm build && pnpm --filter @megasaver/cli test
  ```

  Expected: PASS. The new `build-context.test.ts` is green; the byte-equality
  suite (all targets × 4 tokenSaver permutations) is green;
  `connector.test.ts`, `warmup.test.ts`, and `connector/shared.test.ts`
  (pickLatestOpenSession only) are green — their memory fixtures are all
  plain approved/current/working-tier rows, which `isRecallable` keeps.

- [ ] **Step 11: Lint + typecheck**

  ```bash
  pnpm lint:fix && pnpm typecheck
  ```

  Expected: both exit 0.

- [ ] **Step 12: Commit**

  ```bash
  git add packages/connectors/shared/src/context.ts packages/connectors/shared/src/render.ts packages/connectors/shared/test/context.test.ts packages/connectors/shared/test/render.test.ts apps/cli/src/commands/connector/shared.ts apps/cli/src/commands/connector/sync.ts apps/cli/src/commands/connector/status.ts apps/cli/src/commands/connector/doctor.ts apps/cli/src/commands/warmup.ts apps/cli/test/connector-byte-equality.test.ts apps/cli/test/connector/build-context.test.ts
  git commit -m "feat(connector): changedFrom line + validity gate" -m "isRecallable replaces the bare approval check (spec 3.3) so a changedFrom suffix can never co-render beside the closed predecessor it references; superRefine extended to the record titles (architect #1 sentinel injection)."
  ```

---

### Task 15: warm-start `memLine` changedFrom suffix

**Files:**

- Modify: `packages/core/src/warm-start.ts`
- Modify (test): `packages/core/test/warm-start.test.ts` (append)

The fourth recall surface. `memLine` gains the contract suffix
` (was: "<title>" until <closedAt.slice(0,10)>)`, computed via
`changedFromFor` over a Map built from the UNFILTERED `input.memories` (the
closed predecessor is exactly the row the `recallable` filter drops). The
greedy budget fill already meters the longer line — no budget code changes.

- [ ] **Step 1: Append the failing tests**

  `packages/core/test/warm-start.test.ts` ends with a top-level `});` closing
  the `"timeless (sentinel-block) variant"` describe. Its existing imports
  already include `estimateTokens`, `type MemoryEntry`, `memoryEntrySchema`,
  `assembleWarmStartBrief`, and the `mem`/`baseInput` factories used below.
  Append at end of file:

  ```bash
  cat >> packages/core/test/warm-start.test.ts <<'EOF'

  describe("changedFrom suffix", () => {
    it("successor line carries (was: ...) when its predecessor is closed", () => {
      const predecessor = mem({
        title: "use npm",
        content: "Use npm for installs.",
        validTo: "2026-07-01T00:00:00.000Z",
      });
      const successor = mem({
        title: "use pnpm",
        content: "Use pnpm for installs.",
        supersedesId: predecessor.id,
      });
      const brief = assembleWarmStartBrief(baseInput({ memories: [predecessor, successor] }));
      expect(brief.text).toContain('(was: "use npm" until 2026-07-01)');
      // The closed predecessor's OWN line must not render (its title still
      // appears inside the successor's suffix, so match the line prefix).
      expect(brief.text).not.toContain("- [decision] use npm —");
    });

    it("suppresses the suffix when the predecessor is reopened (validTo null)", () => {
      const predecessor = mem({ title: "use npm", validTo: null });
      const successor = mem({ title: "use pnpm", supersedesId: predecessor.id });
      const brief = assembleWarmStartBrief(baseInput({ memories: [predecessor, successor] }));
      expect(brief.text).not.toContain("(was:");
    });

    it("budget invariant holds with the longer suffixed lines", () => {
      const big = "x".repeat(4000);
      const memories: MemoryEntry[] = [];
      for (let i = 0; i < 20; i += 1) {
        const predecessor = mem({
          title: `old title ${i} ${"y".repeat(200)}`,
          validTo: "2026-07-01T00:00:00.000Z",
        });
        const successor = mem({ title: `new ${i}`, content: big, supersedesId: predecessor.id });
        memories.push(predecessor, successor);
      }
      const brief = assembleWarmStartBrief(baseInput({ budgetTokens: 500, memories }));
      expect(estimateTokens(brief.text)).toBeLessThanOrEqual(500);
      expect(brief.tokenEstimate).toBe(estimateTokens(brief.text));
    });
  });
  EOF
  ```

  Note the em-dash in `"- [decision] use npm —"` — it is the literal ` — `
  separator from `memLine`; keep it exact.

- [ ] **Step 2: Run — expect RED**

  ```bash
  pnpm build && pnpm --filter @megasaver/core test
  ```

  Expected: FAIL. The first new test fails (`(was: "use npm" until
  2026-07-01)` not found in the brief text). The reopened-predecessor and
  budget tests pass trivially pre-implementation (they assert absence and an
  invariant that already holds). All pre-existing core tests stay green.

- [ ] **Step 3: Implement in `packages/core/src/warm-start.ts` (four exact edits)**

  Verify current shape first (the extraction base has `memLine` at ~line 72;
  the earlier core tasks of this plan do not touch warm-start.ts):

  ```bash
  grep -n "function memLine\|function memSection\|const decisions = memSection\|import type { ProjectRule }" packages/core/src/warm-start.ts
  ```

  Edit 3a — imports. Replace:

  ```ts
  import { rankApplicableRules } from "./project-rule-ranking.js";
  import type { ProjectRule } from "./project-rule.js";
  ```

  with:

  ```ts
  import { rankApplicableRules } from "./project-rule-ranking.js";
  import type { ProjectRule } from "./project-rule.js";
  import { changedFromFor } from "./supersession.js";
  ```

  Edit 3b — `memLine`. Replace:

  ```ts
  function memLine(m: MemoryEntry, now: string): string {
    return `- [${m.type}] ${m.title} — ${clampSentence(m.content)} (${m.confidence}, ${ageDays(now, m.updatedAt)}d)`;
  }
  ```

  with:

  ```ts
  function memLine(m: MemoryEntry, now: string, byId: ReadonlyMap<string, MemoryEntry>): string {
    const base = `- [${m.type}] ${m.title} — ${clampSentence(m.content)} (${m.confidence}, ${ageDays(now, m.updatedAt)}d)`;
    const changedFrom = changedFromFor(m, byId);
    if (changedFrom === undefined) return base;
    return `${base} (was: "${changedFrom.title}" until ${changedFrom.closedAt.slice(0, 10)})`;
  }
  ```

  Edit 3c — `memSection`. Replace:

  ```ts
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
    return { key, lines: items.length === 0 ? [] : ["", heading, ...items] };
  }
  ```

  with:

  ```ts
  function memSection(
    key: string,
    heading: string,
    memories: readonly MemoryEntry[],
    type: MemoryType,
    now: string,
    byId: ReadonlyMap<string, MemoryEntry>,
  ): Section {
    const items = memories
      .filter((m) => m.type === type)
      .sort(byScore(now))
      .slice(0, SECTION_ITEM_CAP)
      .map((m) => memLine(m, now, byId));
    return { key, lines: items.length === 0 ? [] : ["", heading, ...items] };
  }
  ```

  Edit 3d — `assembleWarmStartBrief` call sites. Replace:

  ```ts
    const rules = rulesSection(input.rules);
    const decisions = memSection("decisions", "## Standing decisions", recallable, "decision", now);
    const todos = memSection("todos", "## Open todos", recallable, "todo", now);
  ```

  with:

  ```ts
    const rules = rulesSection(input.rules);
    // changedFrom lookups go over the UNFILTERED input.memories — the closed
    // predecessor is exactly the row the recallable filter drops.
    const byId = new Map<string, MemoryEntry>(input.memories.map((m) => [m.id, m]));
    const decisions = memSection(
      "decisions",
      "## Standing decisions",
      recallable,
      "decision",
      now,
      byId,
    );
    const todos = memSection("todos", "## Open todos", recallable, "todo", now, byId);
  ```

- [ ] **Step 4: Run — expect GREEN (whole core suite)**

  ```bash
  pnpm build && pnpm --filter @megasaver/core test
  ```

  Expected: PASS. All three new tests green; every pre-existing
  warm-start test green (fixtures without `supersedesId` produce no suffix,
  so `memLine` output is byte-identical for them — including the timeless /
  micro / reonboard / budget describes). The full core suite stays green.

- [ ] **Step 5: Lint + typecheck**

  ```bash
  pnpm lint:fix && pnpm typecheck
  ```

  Expected: both exit 0.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/core/src/warm-start.ts packages/core/test/warm-start.test.ts
  git commit -m "feat(core): warm-start changedFrom suffix"
  ```
### Task 16: Changeset, wiki, spec deviation note, verify + E2E smoke

**Files:**
- Create: `.changeset/living-brain.md`
- Modify: `docs/superpowers/specs/2026-07-13-living-brain-design.md` (flag-name deviation note)
- Modify: `wiki/syntheses/memory-moat-portfolio.md`, `wiki/log.md`

- [ ] **Step 1: Write the changeset**

```markdown
---
"@megasaver/core": minor
"@megasaver/mcp-bridge": minor
"@megasaver/cli": minor
"@megasaver/connectors-shared": minor
---

Living Brain: auto-superseding memory save path with lineage recall and
time-travel queries. New core supersession module (detect + close ladder +
lineage), `saveMemoryWithLineage` write entry point, declared-target
approve exemption with disclosure, `changedFrom` on all recall surfaces,
`lastActiveAt` decay rekey, and `mega memory history`/`reopen`/`--as-of`.
```

Check the exact package name for connectors-shared first:
`grep '"name"' packages/connectors/shared/package.json` — use what it prints.
If `apps/cli` package name differs (`grep '"name"' apps/cli/package.json`), use that.

- [ ] **Step 2: Spec deviation note**

Append to the CLI section of `docs/superpowers/specs/2026-07-13-living-brain-design.md`:

```markdown
> Implementation deviations (plan phase, 2026-07-13):
> - Create opt-out flag shipped as `--no-auto-supersede` (arg
>   `autoSupersede`, default true), not `--no-supersede` — citty's
>   `--no-<name>` negation would collide with the string-valued
>   `--supersede <id>` arg.
> - changedFrom render format: `(changed from "<title>", closed
>   <YYYY-MM-DD>)` — date sliced to day, no colon (token discipline).
> - Lexical `contradiction` auto-close on born-approved writers is
>   narrow in practice (checkConflicts precedence classifies same-type
>   file-overlap divergences as the weak class first) — born-approved
>   auto-close is deliberately conservative; `--supersede` is the human
>   gate. Suggested-path (agent) auto-link + approve-close is unaffected.
> - `SaveMemoryLineageResult.supersession.via` union includes
>   `"explicit"` for the explicit-supersedesId path.
```

- [ ] **Step 3: Full verify**

Run from the worktree root: `pnpm verify`
Expected: lint + typecheck + all test projects + conventions:check green (52/52 or current count).

- [ ] **Step 4: E2E smoke (DoD evidence — capture the terminal session)**

```bash
pnpm build
STORE=$(mktemp -d)
CLI="node apps/cli/dist/cli.js"
$CLI project create demo --root /tmp/demo --store "$STORE"
# 1) create rule A
A=$($CLI memory create demo --scope project --type project_rule --content "use npm for installs" --keyword installs --file package.json --store "$STORE")
# 2) auto-detect on a born-approved write is CONSERVATIVE by design: a
#    same-type file-overlap divergence is the weak lexical class, so expect
#    the note-only path (no close):
B=$($CLI memory create demo --scope project --type project_rule --content "use pnpm for installs (CI cache misses)" --keyword installs --file package.json --store "$STORE")
# expect stderr: note: possibly supersedes <A> ("use npm for installs") — link explicitly with --supersede <A>
# 3) explicit supersede closes (the human gate for born-approved writes):
C=$($CLI memory create demo --scope project --type project_rule --content "use pnpm for installs, never npm" --keyword installs --file package.json --supersede "$A" --store "$STORE")
# expect stderr: note: superseded <A> ("use npm for installs") — undo: mega memory reopen <A>
$CLI memory search demo "installs" --store "$STORE" --json    # A absent (closed), B + C present
$CLI memory search demo "installs" --as-of "$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)" --store "$STORE"  # free => MEMORY_AS_OF_UPSELL line
$CLI memory history "$C" --store "$STORE"                      # free => "1 prior versions. Memory history is a Mega Saver Pro feature. ..."
$CLI memory explain "$C" --store "$STORE"                      # lineage section shows supersedes <A>
$CLI memory reopen "$A" --store "$STORE"                       # reopened <A> ("use npm for installs")
$CLI memory search demo "installs" --store "$STORE" --json    # A current again
```

The suggested-path close (agent flow) is exercised separately: MCP
`save_memory` (weak class links `supersedesId` on the suggested row) followed
by `approve_memory` — declared-target exemption flips + closes + reports
`superseded`. Capture with the bridge test suite output or a scripted MCP
session if feasible.

Adjust `project create` invocation to the real command surface
(`node apps/cli/dist/cli.js --help`) — if project creation differs, use the
existing test-store bootstrap the CLI tests use. Every claim in the PR
description must trace to a line in this capture.

- [ ] **Step 5: Wiki update**

- `wiki/syntheses/memory-moat-portfolio.md`: mark i1 SHIPPED (branch, PR, date).
- `wiki/log.md`: timestamped entry — what shipped, gauntlet verdicts, deviations (flag rename, recall write-back cut, from-session exemption).

- [ ] **Step 6: Commit**

```bash
git add .changeset/living-brain.md docs/superpowers/specs/2026-07-13-living-brain-design.md wiki/
git commit -m "chore(release): living brain changeset + wiki"
```

- [ ] **Step 7: Gauntlet (HIGH risk — do not skip)**

Dispatch fresh-context `code-reviewer` AND adversarial `critic` over the full
branch diff (`git diff feat/guard...feat/living-brain`); verifier re-pass on
any fixes. Author and reviewer never the same context. Attack surface to name
explicitly for the critic: declared-target exemption abuse, sentinel
injection via changedFrom, false-positive close ladder, `--as-of` gate bypass,
lastActiveAt ranking regressions.
