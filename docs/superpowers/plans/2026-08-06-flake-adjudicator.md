# Flake Adjudicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an allowlisted test command fails under `mega output exec`, synchronously re-run ONLY the failed test (name-filtered, N times, hard wall-clock budget) and stamp an evidence-backed verdict into the returned digest: `real`, `flaky`, `load-sensitive`, or `unadjudicated` — never guessed. Every re-run's raw output persists as a lossless chunk set; every re-run appends a `sourceKind: "flake-rerun"` event carrying `childExitCode` + `adjudicationId`; the verdict is recomputable from persisted receipts alone. Spec: `docs/superpowers/specs/2026-08-06-flake-adjudicator-design.md` (the contract — do not edit it).

**Architecture:** Five packages, dependency-ordered. `@megasaver/stats` gains three additive-optional receipt fields on both event schemas. `@megasaver/output-filter` gains the `flake-rerun` source kind (appended LAST) and a new `parsers/failed-tests.ts` extractor reusing the shipped framework detectors. `@megasaver/context-gate` gains a `src/flake/` module (allowlist, rerun-args, verdict, adjudicate orchestrator) wired into `runOutputExecCommand` (`packages/context-gate/src/run-command.ts:206`) after capture — registry exec path ONLY, never the overlay path (spec Non-Goal 1). `@megasaver/core` re-exports the new surface (`packages/core/src/context-gate.ts` — `apps/cli` imports core only, pinned by `apps/cli/test/dependency-graph.test.ts`). `@megasaver/cli` gains `mega flake enable|disable|status`, the `--no-flake` exec flag, and verdict rendering.

**Tech Stack:** TypeScript strict ESM, Zod boundary schemas, Vitest (unit + `test-d.ts` typecheck pins — `vitest.config.ts` typecheck is already enabled in both `packages/context-gate` and `packages/output-filter`, with `tsconfig.test-d.json` present in both), Citty CLI, `withFileLock` from `@megasaver/shared/node` (`packages/shared/src/file-lock.ts:25`, re-exported via `packages/shared/src/node.ts:1`), tmp+rename atomic writes (precedent `packages/context-gate/src/net-effect-store.ts:28-30`).

## Global Constraints

- **HARD DEPENDENCY (verify first, Task 1):** claim-verification-gate C3 must have landed — `childExitCode` on BOTH stats event schemas. As of plan-writing it is **absent** from `packages/stats/src/event.ts` (verified: `tokenSaverEventSchema` at `:41` and `overlayTokenSaverEventSchema` at `:72` have no `childExitCode` field). This feature CONSUMES that field, never duplicates it (spec Non-Goal 5). If Task 1's check fails, STOP the plan and implement `2026-08-06-claim-verification-gate-design.md` first.
- **Risk HIGH (spec §Risk):** work in an isolated worktree (`superpowers:using-git-worktrees`), no `main` edits. Reviewers: `code-reviewer` AND `critic`, separate passes, never the authoring context.
- **TDD, red first.** Every step: write the failing test, run it, see it fail for the RIGHT reason, then implement, then see it pass. RED/GREEN commands are given per step.
- **No real child processes, no real clocks in tests.** Spawn is always injected (harness mimics `apps/cli/test/output/exec.test.ts:57-114`: `FakeChild`/`makeChild`/`Script`/`scriptedSpawn`/`inertSpawn`; context-gate precedent `packages/context-gate/test/ledger-signed-delta.test.ts:61-83`). Wall-clock budget is tested with a stepped `nowMs` array — never `sleep`, never timing-tight assertions (the lesson of commit `7469812c`).
- **Enums append-only.** `flake-rerun` is appended LAST to `outputSourceKindSchema` (`packages/output-filter/src/output-source.ts:3`); existing members untouched. New enums get `test-d.ts` tuple-ordering pins in their own packages. Do NOT touch `apps/cli/test/enum-pin-audit.test.ts` — its `PIN_FILES` list is scoped to the 8 AA1-epic enums and asserts `toHaveLength(8)` (`apps/cli/test/enum-pin-audit.test.ts:16-38`).
- **Event schema changes are additive-optional only** (both schemas are `.strict()`; precedent: `deltaBytes`/`rawTokens` optional fields, `packages/stats/src/event.ts:16-38`).
- **Redact on every echoed/persisted string:** re-run labels, test id, excerpt — through `redact` (`packages/policy/src/redact.ts:44`), same discipline as the suite label (`packages/context-gate/src/run-command.ts:290-292`).
- **Fail-inert, never fail-open:** malformed allowlist disables adjudication for the run + warning; no adjudication failure may break the primary exec result (spec §Error handling). Every re-run passes `evaluateCommand` again before spawn.
- **Bounded regexes, no `/m` row anchors:** extraction regexes run per-split-line, anchored without `/m`, every quantifier bounded (the `^`-under-`m` U+2028 rescan trap; see parser headers, e.g. `packages/output-filter/src/parsers/test-output.ts:3-9`).
- **Zero fabricated savings:** re-run events carry `returnedBytes`/`bytesSaved`/`deltaBytes`/`savingRatio` = 0.
- Conventional commits, subject ≤ 50 chars, imperative. One logical change per commit. English everywhere.
- After each task: `pnpm --filter <pkg> test` green; before review: `pnpm verify` at repo root.
- **Do not commit as part of writing this plan.** Commits listed below are for the implementing worker.

Numeric contract (from spec Locked Decisions; defaults marked where the spec is silent):

| Constant | Value | Source |
|---|---|---|
| `DEFAULT_FLAKE_BUDGET_MS` | `60_000` | spec Decision 4 |
| `--budget-sec` bounds | 5..600 | spec Decision 4 |
| per-run timeout | `min(remainingBudget, exec timeoutMs)`; stop when remaining < 1000 ms | spec Decision 4 |
| `DEFAULT_FLAKE_RUNS` | `3` | ASSUMPTION: spec pins no default for `--runs`; 3 distinguishes all three verdicts at minimal cost |
| `--runs` bounds | 1..10 | ASSUMPTION: spec pins no bounds; 10 caps resource use symmetrically with budget bounds |
| multi-failure cutoff | > 3 distinct extracted failures → `unadjudicated`/`multi-failure` | spec Decision 5 |
| excerpt cap | 400 chars, redacted | spec Decision 7 |
| extraction cap | first 10 distinct rows | ASSUMPTION: bounded work; only the >3 comparison is contract |
| lock options | `{ deadlineMs: 50, staleMs: 5000 }` | spec Component 2 |

---

### Task 1: Precondition gate — claim-verification-gate C3 landed

**Files:** none created — verification only.

**Interfaces:** `tokenSaverEventSchema` / `overlayTokenSaverEventSchema` (`packages/stats/src/event.ts:41` / `:72`) must accept `childExitCode`; `Capture.childExitCode` already exists (`packages/context-gate/src/run-command.ts:105`) and `ExecResult.childExitCode` already exists (`run-command.ts:84-87`).

- [ ] Run the gate check:

  ```bash
  grep -n "childExitCode" packages/stats/src/event.ts
  ```

- [ ] Both schemas show a `childExitCode` field → proceed to Task 2.
- [ ] Field absent (the state at plan-writing time) → **STOP THIS PLAN.** Report to the user that build-order dependency claim-verification-gate (`docs/superpowers/specs/2026-08-06-claim-verification-gate-design.md`, "3 of 11") has not landed; it must be implemented first. Do not add `childExitCode` yourself — that field is owned by the other feature (spec Non-Goal 5).

No commit for this task.

---

### Task 2: stats — flake receipt fields on both event schemas

**Files:**
- `packages/stats/test/flake-receipt-fields.test.ts` (new)
- `packages/stats/src/event.ts` (edit)

**Interfaces:** three additive-optional fields on BOTH `tokenSaverEventSchema` (`packages/stats/src/event.ts:41`) and `overlayTokenSaverEventSchema` (`:72`): `adjudicationId: z.string().min(1).optional()`, `rerunIndex: z.number().int().nonnegative().optional()`, `rerunPlanned: z.number().int().positive().optional()`. Precedent for additive-optional: `deltaBytes`/`rawTokens` (`event.ts:16-22`).

- [ ] Write `packages/stats/test/flake-receipt-fields.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { overlayTokenSaverEventSchema, tokenSaverEventSchema } from "../src/event.js";

  const BASE = {
    id: "ev-1",
    sessionId: "22222222-2222-4222-8222-222222222222",
    projectId: "11111111-1111-4111-8111-111111111111",
    createdAt: "2026-08-06T12:00:00.000Z",
    sourceKind: "command",
    label: "pnpm test",
    rawBytes: 100,
    returnedBytes: 50,
    bytesSaved: 50,
    savingRatio: 0.5,
    summary: "s",
  };

  const OVERLAY_BASE = {
    ...BASE,
    sessionId: undefined,
    projectId: undefined,
    liveSessionId: "live-1",
    workspaceKey: "wk-1",
  };

  function overlayRow(extra: Record<string, unknown> = {}): Record<string, unknown> {
    const { sessionId: _s, projectId: _p, ...rest } = { ...OVERLAY_BASE, ...extra };
    return rest;
  }

  describe("flake receipt fields (adjudicationId, rerunIndex, rerunPlanned)", () => {
    it("pre-flake rows (fields absent) keep parsing on both schemas", () => {
      expect(tokenSaverEventSchema.safeParse(BASE).success).toBe(true);
      expect(overlayTokenSaverEventSchema.safeParse(overlayRow()).success).toBe(true);
    });

    it("rows carrying all three fields parse on both schemas", () => {
      const extra = { adjudicationId: "adj-1", rerunIndex: 0, rerunPlanned: 3 };
      expect(tokenSaverEventSchema.safeParse({ ...BASE, ...extra }).success).toBe(true);
      expect(overlayTokenSaverEventSchema.safeParse(overlayRow(extra)).success).toBe(true);
    });

    it("rejects empty adjudicationId, negative rerunIndex, zero rerunPlanned", () => {
      expect(tokenSaverEventSchema.safeParse({ ...BASE, adjudicationId: "" }).success).toBe(false);
      expect(tokenSaverEventSchema.safeParse({ ...BASE, rerunIndex: -1 }).success).toBe(false);
      expect(tokenSaverEventSchema.safeParse({ ...BASE, rerunPlanned: 0 }).success).toBe(false);
    });
  });
  ```

- [ ] RED: `pnpm --filter @megasaver/stats test -- test/flake-receipt-fields.test.ts` — the "carrying all three fields" test fails (`.strict()` rejects unknown keys).
- [ ] Implement in `packages/stats/src/event.ts`: define once, above `tokenSaverEventSchema`:

  ```ts
  // Flake adjudicator receipts (spec 2026-08-06-flake-adjudicator Decision 6).
  // Optional so pre-flake JSONL rows keep parsing. A suite event and its
  // isolation re-runs share adjudicationId; recompute = group by it, count
  // childExitCode === 0, compare rerun-row count against rerunPlanned.
  const adjudicationIdField = z.string().min(1).optional();
  const rerunIndexField = z.number().int().nonnegative().optional();
  const rerunPlannedField = z.number().int().positive().optional();
  ```

  and add `adjudicationId: adjudicationIdField, rerunIndex: rerunIndexField, rerunPlanned: rerunPlannedField,` to BOTH schema objects (`:41` and `:72`).
- [ ] GREEN: `pnpm --filter @megasaver/stats test`.
- [ ] Commit: `feat(stats): flake receipt fields on both event schemas`

---

### Task 3: output-filter — `flake-rerun` source kind, appended last

**Files:**
- `packages/output-filter/test/output-source.test-d.ts` (edit — the existing tuple pin)
- `packages/content-store/test/source-discriminator.test-d.ts` (edit — a SECOND repo consumer pins this enum: the exact tuple at `:26-29` and the back-assignability at `:19-24` both break when the enum gains a fifth member)
- `packages/output-filter/src/output-source.ts` (edit)

**Interfaces:** `outputSourceKindSchema` (`packages/output-filter/src/output-source.ts:3`) becomes `z.enum(["command", "fetch", "file", "grep", "flake-rerun"])`. Append-only: C3's `verify claims` filters `sourceKind === "command"`, so a re-run event can never be counted as a suite receipt.

- [ ] Edit `packages/output-filter/test/output-source.test-d.ts`: add `flake-rerun` to the member-assignability cases and change the exact-tuple pin (`output-source.test-d.ts:33-36`) to:

  ```ts
  it("outputSourceKindSchema.options is the exact append-ordered readonly tuple", () => {
    // Historical members stay alphabetic; new members append LAST (never
    // resorted) so persisted rows and C3's sourceKind filter stay stable.
    const _t: readonly ["command", "fetch", "file", "grep", "flake-rerun"] =
      outputSourceKindSchema.options;
    void _t;
  });
  ```

  (The old pin text said "exact alphabetic readonly tuple" — `flake-rerun` would sort between `fetch` and `file`, but the spec mandates append-last; the pin's wording changes with it.)
- [ ] Edit `packages/content-store/test/source-discriminator.test-d.ts` — the second repo consumer that pins this enum. Widen its exact-tuple assertion (`:26-29`) to the same append-ordered 5-member tuple as above, and replace the bidirectional-assignability test (`:19-24`) with the one-way form — forward (`SourceKind` → `OutputSourceKind`) still holds; the back direction is intentionally broken because `flake-rerun` is a stats-only source kind (re-run chunk sets persist with `source.kind: "command"`, Task 8; the chunk-set union never gains `flake-rerun`):

  ```ts
  it("the discriminator union is assignable to OutputSourceKind; the back direction is intentionally broken", () => {
    const _forward: OutputSourceKind = "command" as SourceKind;
    // @ts-expect-error flake-rerun is a stats-only source kind; chunk-set sources never carry it
    const _back: SourceKind = "command" as OutputSourceKind;
    void _forward;
    void _back;
  });
  ```

  Keep the per-literal assertions (`:8-17`) unchanged. CROSS-PLAN COORDINATION: the paste-airlock plan (Task 1 Step 4) rewrites this same file in the opposite direction (its `paste` member breaks the FORWARD assignment). Whichever feature lands second must merge, not overwrite: per-literal assertions stay; each divergent literal gets its own `@ts-expect-error` line (`paste` never an `OutputSourceKind`, `flake-rerun` never a `SourceKind`); the tuple pin reads `["command", "fetch", "file", "grep", "flake-rerun"]` regardless of order.
- [ ] RED: `pnpm --filter @megasaver/output-filter test -- test/output-source.test-d.ts` — typecheck fails on the tuple. `pnpm --filter @megasaver/content-store test` fails the same way on its widened pin.
- [ ] Implement: `export const outputSourceKindSchema = z.enum(["command", "fetch", "file", "grep", "flake-rerun"]);` in `src/output-source.ts`.
- [ ] GREEN: `pnpm --filter @megasaver/output-filter test`. Then run `pnpm --filter @megasaver/stats test` — the stats schemas import this enum (`packages/stats/src/event.ts:1`) and must stay green — and `pnpm --filter @megasaver/content-store test` — its `source-discriminator.test-d.ts` was updated above and must now pass against the 5-member enum.
- [ ] Commit: `feat(output-filter): add flake-rerun source kind`

---

### Task 4: output-filter — failed-test extractor

**Files:**
- `packages/output-filter/test/failed-tests.test.ts` (new)
- `packages/output-filter/test/failed-tests.test-d.ts` (new — tuple pin for `testFrameworkSchema`)
- `packages/output-filter/src/parsers/failed-tests.ts` (new)
- `packages/output-filter/src/index.ts` (edit — export public surface)

**Interfaces:**

```ts
export const testFrameworkSchema = z.enum(["pytest", "cargo-test", "go-test", "vitest"]); // order = detection order
export type TestFramework = z.infer<typeof testFrameworkSchema>;
export type FailedTestRef = { framework: TestFramework; file?: string; name?: string; raw: string };
export function extractFailedTests(raw: string): FailedTestRef[];
```

Detection order mirrors `packages/output-filter/src/parsers/index.ts:37-58`: `detectPytest` (`parsers/pytest.ts:11`) → `detectCargoTest` (`parsers/cargo-test.ts:7`) → `detectGoTest` (`parsers/go-test.ts:14`) → `detectTestOutput` (`parsers/test-output.ts:11`). Exactly ONE framework wins; its row regex runs per split line, anchored WITHOUT `/m`, quantifiers bounded. Distinct results only (keyed by `file|name`), capped at 10.

- [ ] Write `packages/output-filter/test/failed-tests.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { extractFailedTests } from "../src/parsers/failed-tests.js";

  const PYTEST = [
    "=================================== FAILURES ===================================",
    "________________________________ test_login ___________________________________",
    "E   AssertionError: assert 401 == 200",
    "=========================== short test summary info ============================",
    "FAILED tests/test_auth.py::test_login - AssertionError: assert 401 == 200",
    "FAILED tests/test_auth.py::TestSession::test_refresh - TimeoutError",
    "========================= 2 failed, 40 passed in 3.21s =========================",
  ].join("\n");

  const GO = [
    "--- FAIL: TestParse (0.03s)",
    "    --- FAIL: TestParse/empty_input (0.00s)",
    "        parse_test.go:42: got nil, want error",
    "FAIL",
    "FAIL\texample.com/pkg/parser\t0.187s",
  ].join("\n");

  const CARGO = [
    "running 3 tests",
    "test config::tests::parses_defaults ... ok",
    "test config::tests::rejects_empty ... FAILED",
    "failures:",
    "    config::tests::rejects_empty",
    "test result: FAILED. 2 passed; 1 failed; 0 ignored",
  ].join("\n");

  // ASSUMPTION (spec Open Questions): vitest default reporter prints
  // `FAIL <file> > <suite> > <name>` rows. Verify against a real vitest 3
  // run at impl time; widen this fixture if only the tree (❯/×) form exists.
  const VITEST = [
    "FAIL src/verdict.test.ts > computeFlakeVerdict > maps 0/N to real",
    "AssertionError: expected 'flaky' to be 'real'",
    "Tests  1 failed | 12 passed (13)",
  ].join("\n");

  describe("extractFailedTests", () => {
    it("pytest: file + name from short-summary FAILED rows", () => {
      const refs = extractFailedTests(PYTEST);
      expect(refs).toHaveLength(2);
      expect(refs[0]).toMatchObject({
        framework: "pytest",
        file: "tests/test_auth.py",
        name: "test_login",
      });
      expect(refs[1]?.name).toBe("TestSession::test_refresh");
    });

    it("go: innermost subtest path from --- FAIL rows", () => {
      const refs = extractFailedTests(GO);
      expect(refs.map((r) => r.name)).toEqual(["TestParse", "TestParse/empty_input"]);
      expect(refs.every((r) => r.framework === "go-test")).toBe(true);
    });

    it("cargo: module path from `test ... FAILED` rows", () => {
      const refs = extractFailedTests(CARGO);
      expect(refs).toHaveLength(1);
      expect(refs[0]).toMatchObject({
        framework: "cargo-test",
        name: "config::tests::rejects_empty",
      });
    });

    it("vitest: file + joined suite path from FAIL rows", () => {
      const refs = extractFailedTests(VITEST);
      expect(refs).toHaveLength(1);
      expect(refs[0]).toMatchObject({
        framework: "vitest",
        file: "src/verdict.test.ts",
        name: "computeFlakeVerdict > maps 0/N to real",
      });
    });

    it("non-test output → []", () => {
      expect(extractFailedTests("error: something exploded\nat main.ts:1")).toEqual([]);
      expect(extractFailedTests("")).toEqual([]);
    });

    it("duplicate rows collapse; extraction caps at 10 distinct", () => {
      const rows = Array.from({ length: 30 }, (_, i) => `--- FAIL: TestGen${i % 15} (0.01s)`);
      const refs = extractFailedTests(rows.join("\n"));
      expect(refs).toHaveLength(10);
    });

    it("U+2028 in a line cannot smuggle a row (per-line regexes, no /m)", () => {
      const refs = extractFailedTests(`prefix --- FAIL: TestSmuggled (0.01s)`);
      expect(refs).toEqual([]);
    });
  });
  ```

- [ ] Write `packages/output-filter/test/failed-tests.test-d.ts` (mimic `test/output-source.test-d.ts` shape byte-for-byte, adapted):

  ```ts
  import { describe, it } from "vitest";
  import { type TestFramework, testFrameworkSchema } from "../src/parsers/failed-tests.js";

  describe("TestFramework type regression", () => {
    it("each member is a valid TestFramework", () => {
      const _a: TestFramework = "pytest";
      const _b: TestFramework = "cargo-test";
      const _c: TestFramework = "go-test";
      const _d: TestFramework = "vitest";
      void _a;
      void _b;
      void _c;
      void _d;
    });

    it("non-member string literal is not assignable to TestFramework", () => {
      // @ts-expect-error non-member literal is not TestFramework
      const _bad: TestFramework = "jest";
      void _bad;
    });

    it("testFrameworkSchema.options is the exact detection-ordered readonly tuple", () => {
      const _t: readonly ["pytest", "cargo-test", "go-test", "vitest"] =
        testFrameworkSchema.options;
      void _t;
    });
  });
  ```

- [ ] RED: `pnpm --filter @megasaver/output-filter test -- test/failed-tests.test.ts test/failed-tests.test-d.ts` — module does not exist.
- [ ] Implement `packages/output-filter/src/parsers/failed-tests.ts`:

  ```ts
  import { z } from "zod";
  import { detectCargoTest } from "./cargo-test.js";
  import { detectGoTest } from "./go-test.js";
  import { detectPytest } from "./pytest.js";
  import { detectTestOutput } from "./test-output.js";

  // Order = detection order of parsers/index.ts:37-58. Append-only.
  export const testFrameworkSchema = z.enum(["pytest", "cargo-test", "go-test", "vitest"]);
  export type TestFramework = z.infer<typeof testFrameworkSchema>;

  export type FailedTestRef = {
    framework: TestFramework;
    file?: string;
    name?: string;
    raw: string;
  };

  // Bounded, per-split-line, NO /m: the ^-under-m U+2028 rescan trap
  // ([[concepts/unbounded-run-redos]]) never applies to a regex tested
  // against one already-split line.
  const PYTEST_ROW = /^FAILED ([^\s:]{1,500}(?:\.[a-z]{1,8})?)::(\S{1,500})/;
  const GO_ROW = /^\s{0,64}--- FAIL: (\S{1,500}) \(/;
  const CARGO_ROW = /^test ([A-Za-z0-9_]{1,100}(?:::[A-Za-z0-9_]{1,100}){0,10}) \.\.\. FAILED$/;
  const VITEST_ROW = /^\s{0,64}FAIL\s{1,8}(\S{1,500}) > (.{1,500})$/;

  const MAX_REFS = 10;

  export function extractFailedTests(raw: string): FailedTestRef[] {
    const framework = detectFramework(raw);
    if (framework === null) return [];
    const refs: FailedTestRef[] = [];
    const seen = new Set<string>();
    for (const line of raw.split("\n")) {
      const ref = matchRow(framework, line);
      if (ref === null) continue;
      const key = `${ref.file ?? ""}|${ref.name ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push(ref);
      if (refs.length >= MAX_REFS) break;
    }
    return refs;
  }

  function detectFramework(raw: string): TestFramework | null {
    if (detectPytest(raw)) return "pytest";
    if (detectCargoTest(raw)) return "cargo-test";
    if (detectGoTest(raw)) return "go-test";
    if (detectTestOutput(raw)) return "vitest";
    return null;
  }

  function matchRow(framework: TestFramework, line: string): FailedTestRef | null {
    if (framework === "pytest") {
      const m = PYTEST_ROW.exec(line);
      // The trailing ` - <message>` (when present) is not part of the id.
      return m ? { framework, file: m[1] as string, name: (m[2] as string).split(" ")[0] as string, raw: line } : null;
    }
    if (framework === "go-test") {
      const m = GO_ROW.exec(line);
      return m ? { framework, name: m[1] as string, raw: line } : null;
    }
    if (framework === "cargo-test") {
      const m = CARGO_ROW.exec(line);
      return m ? { framework, name: m[1] as string, raw: line } : null;
    }
    const m = VITEST_ROW.exec(line);
    return m ? { framework, file: m[1] as string, name: m[2] as string, raw: line } : null;
  }
  ```

  Export `testFrameworkSchema`, `TestFramework`, `FailedTestRef`, `extractFailedTests` from `packages/output-filter/src/index.ts` (public surface only, §8).
- [ ] GREEN: `pnpm --filter @megasaver/output-filter test`.
- [ ] Resolve the vitest-format ASSUMPTION now: run a real one-test failing vitest file in a scratch dir, capture its default-reporter output, and if the `FAIL <file> > <suite> > <name>` row is absent (only `❯`/`×` tree rows), widen `VITEST_ROW` + fixture accordingly (spec Open Questions explicitly orders this check).
- [ ] Commit: `feat(output-filter): failed-test extraction for 4 frameworks`

---

### Task 5: context-gate — flake allowlist store

**Files:**
- `packages/context-gate/test/flake-allowlist.test.ts` (new)
- `packages/context-gate/src/flake/allowlist.ts` (new)

**Interfaces:**

```ts
export const flakeAllowlistSchema = z
  .object({
    version: z.literal(1),
    entries: z.array(
      z.object({
        pattern: z.string().min(1),          // literal command tokens, e.g. "pnpm test"
        runs: z.number().int().min(1).max(10),
        budgetMs: z.number().int().min(5_000).max(600_000),
        addedAt: z.string().datetime({ offset: true }),
      }),
    ),
  })
  .strict();
export type FlakeAllowlist = z.infer<typeof flakeAllowlistSchema>;
export type FlakeEntry = FlakeAllowlist["entries"][number];
export type ReadFlakeAllowlistResult =
  | { ok: true; entries: FlakeEntry[] }
  | { ok: false; reason: "malformed"; detail: string };
export function flakeAllowlistPath(storeRoot: string): string; // <storeRoot>/flake/allowlist.json
export function readFlakeAllowlist(storeRoot: string): ReadFlakeAllowlistResult;      // absent file → { ok: true, entries: [] }
export function upsertFlakeEntry(storeRoot: string, entry: FlakeEntry): boolean;       // withFileLock; returns lock-acquired
export function removeFlakeEntry(storeRoot: string, pattern: string): boolean;
export function matchFlakeEntry(entries: readonly FlakeEntry[], command: string, args: readonly string[]): FlakeEntry | null;
```

`withFileLock` from `@megasaver/shared/node` (`packages/shared/src/file-lock.ts:25`) with `{ deadlineMs: 50, staleMs: 5000 }` around a package-local `writeFlakeAllowlistAtomic` (tmp + rename, mirror `packages/context-gate/src/net-effect-store.ts:28-30`). Matching: split `pattern` on single spaces; entry matches iff its tokens `===`-equal a prefix of `[command, ...args]`. No globs, no regex from user input.

- [ ] Write `packages/context-gate/test/flake-allowlist.test.ts`:

  ```ts
  import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
  import { mkdir } from "node:fs/promises";
  import { tmpdir } from "node:os";
  import { join } from "node:path";
  import { afterEach, beforeEach, describe, expect, it } from "vitest";
  import {
    flakeAllowlistPath,
    matchFlakeEntry,
    readFlakeAllowlist,
    removeFlakeEntry,
    upsertFlakeEntry,
  } from "../src/flake/allowlist.js";

  const NOW = "2026-08-06T12:00:00.000Z";
  const entry = (pattern: string) => ({ pattern, runs: 3, budgetMs: 60_000, addedAt: NOW });

  describe("flake allowlist store", () => {
    let store: string;

    beforeEach(() => {
      store = mkdtempSync(join(tmpdir(), "megasaver-flake-store-"));
    });

    afterEach(() => {
      rmSync(store, { recursive: true, force: true });
    });

    it("absent file reads as empty (the allowlist SHIPS empty)", () => {
      expect(readFlakeAllowlist(store)).toEqual({ ok: true, entries: [] });
    });

    it("upsert then read round-trips; second upsert on same pattern replaces", () => {
      expect(upsertFlakeEntry(store, entry("pnpm test"))).toBe(true);
      expect(upsertFlakeEntry(store, { ...entry("pnpm test"), runs: 5 })).toBe(true);
      const read = readFlakeAllowlist(store);
      expect(read.ok).toBe(true);
      if (read.ok) {
        expect(read.entries).toHaveLength(1);
        expect(read.entries[0]?.runs).toBe(5);
      }
    });

    it("remove deletes only the named pattern", () => {
      upsertFlakeEntry(store, entry("pnpm test"));
      upsertFlakeEntry(store, entry("cargo test"));
      removeFlakeEntry(store, "pnpm test");
      const read = readFlakeAllowlist(store);
      if (read.ok) expect(read.entries.map((e) => e.pattern)).toEqual(["cargo test"]);
    });

    it("malformed JSON → typed malformed result, never a throw", async () => {
      await mkdir(join(store, "flake"), { recursive: true });
      writeFileSync(flakeAllowlistPath(store), "{ not json");
      const read = readFlakeAllowlist(store);
      expect(read).toMatchObject({ ok: false, reason: "malformed" });
    });

    it("schema-invalid content (bad runs bound) is malformed, not partially accepted", async () => {
      await mkdir(join(store, "flake"), { recursive: true });
      writeFileSync(
        flakeAllowlistPath(store),
        JSON.stringify({ version: 1, entries: [{ ...entry("pnpm test"), runs: 99 }] }),
      );
      expect(readFlakeAllowlist(store).ok).toBe(false);
    });

    it("prefix-match table", () => {
      const entries = [entry("pnpm test"), entry("go test ./...")];
      const table: Array<[string, string[], string | null]> = [
        ["pnpm", ["test"], "pnpm test"],
        ["pnpm", ["test", "--filter", "x"], "pnpm test"],
        ["pnpm", ["build"], null],
        ["pnpm", [], null],                       // entry longer than argv → no match
        ["go", ["test", "./..."], "go test ./..."],
        ["go", ["test"], null],
        ["gopnpm", ["test"], null],               // token equality, not substring
      ];
      for (const [command, args, want] of table) {
        expect(matchFlakeEntry(entries, command, args)?.pattern ?? null).toBe(want);
      }
    });

    it("interleaved writers keep the file valid JSON (lock + atomic write)", () => {
      // withFileLock is synchronous; interleave sequential writers and assert
      // the on-disk artifact parses after every write — the atomic tmp+rename
      // contract, not a timing race (no timing-tight tests).
      for (let i = 0; i < 20; i += 1) {
        upsertFlakeEntry(store, entry(`cmd-${i % 4} test`));
        const onDisk = JSON.parse(readFileSync(flakeAllowlistPath(store), "utf8"));
        expect(Array.isArray(onDisk.entries)).toBe(true);
      }
    });
  });
  ```

- [ ] RED: `pnpm --filter @megasaver/context-gate test -- test/flake-allowlist.test.ts`.
- [ ] Implement `src/flake/allowlist.ts` per the interface above: `readFileSync` + `flakeAllowlistSchema.safeParse` at the read boundary; `upsertFlakeEntry`/`removeFlakeEntry` = `mkdirSync(dir, { recursive: true })`, then `withFileLock(join(dir, "allowlist.lock"), { deadlineMs: 50, staleMs: 5000 }, () => writeFlakeAllowlistAtomic(path, next))`; `writeFlakeAllowlistAtomic` writes `.${randomUUID()}.tmp` then `renameSync` (net-effect-store precedent). A malformed existing file on write is replaced wholesale (the write path owns repair; the read path stays fail-inert).
- [ ] GREEN: `pnpm --filter @megasaver/context-gate test -- test/flake-allowlist.test.ts`.
- [ ] Commit: `feat(context-gate): flake allowlist store`

---

### Task 6: context-gate — re-run argument builder

**Files:**
- `packages/context-gate/test/flake-rerun-args.test.ts` (new)
- `packages/context-gate/src/flake/rerun-args.ts` (new)

**Interfaces:**

```ts
import type { FailedTestRef } from "@megasaver/output-filter";
export function buildRerunArgs(input: {
  command: string;
  args: readonly string[];
  failed: FailedTestRef;
}): readonly string[] | null;                 // null = no honest filter constructible
export function escapeGoRunPattern(name: string): string;  // regex-escape per /-segment, anchor ^…$ each
```

Pure (spec Component 3). Name filters only, NEVER file targets as the selector (Decision 3): vitest `-t <name>` plus the file positional when `failed.file` is present; pytest `-k <name>` (the final `::` segment); go `-run <escaped>`; cargo positional `<name>` substring filter (v1, spec Open Questions). For `npm|pnpm|yarn|bun` as `command`, insert `--` before appended filter args when not already present in `args`.

- [ ] Write `packages/context-gate/test/flake-rerun-args.test.ts`:

  ```ts
  import type { FailedTestRef } from "@megasaver/output-filter";
  import { describe, expect, it } from "vitest";
  import { buildRerunArgs, escapeGoRunPattern } from "../src/flake/rerun-args.js";

  const ref = (over: Partial<FailedTestRef>): FailedTestRef => ({
    framework: "vitest",
    raw: "row",
    ...over,
  });

  describe("buildRerunArgs", () => {
    it("vitest under pnpm: inserts -- then file positional + -t name", () => {
      expect(
        buildRerunArgs({
          command: "pnpm",
          args: ["test"],
          failed: ref({ framework: "vitest", file: "src/a.test.ts", name: "suite > does x" }),
        }),
      ).toEqual(["test", "--", "src/a.test.ts", "-t", "suite > does x"]);
    });

    it("vitest under pnpm with -- already present: no second separator", () => {
      expect(
        buildRerunArgs({
          command: "pnpm",
          args: ["test", "--"],
          failed: ref({ framework: "vitest", file: "src/a.test.ts", name: "n" }),
        }),
      ).toEqual(["test", "--", "src/a.test.ts", "-t", "n"]);
    });

    it("pytest: -k with the final :: segment (class path narrowed to the test name)", () => {
      expect(
        buildRerunArgs({
          command: "pytest",
          args: ["tests/"],
          failed: ref({ framework: "pytest", file: "tests/test_auth.py", name: "TestSession::test_refresh" }),
        }),
      ).toEqual(["tests/", "-k", "test_refresh"]);
    });

    it("go: -run with per-segment anchored escaped pattern", () => {
      expect(
        buildRerunArgs({
          command: "go",
          args: ["test", "./..."],
          failed: ref({ framework: "go-test", name: "TestParse/empty_input" }),
        }),
      ).toEqual(["test", "./...", "-run", "^TestParse$/^empty_input$"]);
    });

    it("cargo: positional substring filter", () => {
      expect(
        buildRerunArgs({
          command: "cargo",
          args: ["test"],
          failed: ref({ framework: "cargo-test", name: "config::tests::rejects_empty" }),
        }),
      ).toEqual(["test", "config::tests::rejects_empty"]);
    });

    it("no name extracted → null (no honest filter, no re-run)", () => {
      expect(
        buildRerunArgs({ command: "pnpm", args: ["test"], failed: ref({ name: undefined }) }),
      ).toBeNull();
    });
  });

  describe("escapeGoRunPattern", () => {
    it("escapes regex metacharacters inside each / segment", () => {
      expect(escapeGoRunPattern("TestA.B/sub(1)")).toBe("^TestA\\.B$/^sub\\(1\\)$");
    });
  });
  ```

- [ ] RED: `pnpm --filter @megasaver/context-gate test -- test/flake-rerun-args.test.ts`.
- [ ] Implement `src/flake/rerun-args.ts`: pure functions; script-runner set `new Set(["npm", "pnpm", "yarn", "bun"])`; `escapeGoRunPattern` = split on `/`, per segment `segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")`, wrap `^…$`, re-join with `/`. Return `null` when `failed.name` is `undefined` (and for vitest also when both `file` and `name` are missing).
- [ ] GREEN: `pnpm --filter @megasaver/context-gate test -- test/flake-rerun-args.test.ts`.
- [ ] Commit: `feat(context-gate): flake re-run argument builder`

---

### Task 7: context-gate — verdict computation + recompute

**Files:**
- `packages/context-gate/test/flake-verdict.test.ts` (new)
- `packages/context-gate/test/flake-verdict.test-d.ts` (new)
- `packages/context-gate/src/flake/verdict.ts` (new)

**Interfaces:**

```ts
export const flakeVerdictSchema = z.enum(["real", "flaky", "load-sensitive", "unadjudicated"]); // order pinned
export type FlakeVerdict = z.infer<typeof flakeVerdictSchema>;
export const unadjudicatedReasonSchema = z.enum(["budget", "no-failed-test-id", "multi-failure", "rerun-failed"]);
export type UnadjudicatedReason = z.infer<typeof unadjudicatedReasonSchema>;
export type FlakeVerdictResult = { verdict: FlakeVerdict; reason?: UnadjudicatedReason };
export function computeFlakeVerdict(input: { passes: number; completed: number; planned: number }): FlakeVerdictResult;
export function recomputeVerdictFromEvents(
  events: ReadonlyArray<{ sourceKind: string; adjudicationId?: string; childExitCode?: number | null; rerunPlanned?: number }>,
  adjudicationId: string,
): FlakeVerdictResult; // the Decision 6 recompute: pure, receipts-only
```

Semantics (Decision 5): `completed < planned` → `unadjudicated`/`budget`; passes `0/N` → `real`; `N/N` → `load-sensitive`; `0<k<N` → `flaky`.

- [ ] Write `packages/context-gate/test/flake-verdict.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { computeFlakeVerdict, recomputeVerdictFromEvents } from "../src/flake/verdict.js";

  describe("computeFlakeVerdict", () => {
    const table: Array<[number, number, number, string, string | undefined]> = [
      // passes, completed, planned, verdict, reason
      [0, 3, 3, "real", undefined],
      [3, 3, 3, "load-sensitive", undefined],
      [1, 3, 3, "flaky", undefined],
      [2, 3, 3, "flaky", undefined],
      [0, 1, 1, "real", undefined],
      [1, 1, 1, "load-sensitive", undefined],
      [1, 2, 3, "unadjudicated", "budget"],   // budget-short: fewer completed than planned
      [0, 0, 3, "unadjudicated", "budget"],
    ];
    it.each(table)("passes=%i completed=%i planned=%i → %s", (passes, completed, planned, verdict, reason) => {
      expect(computeFlakeVerdict({ passes, completed, planned })).toEqual(
        reason === undefined ? { verdict } : { verdict, reason },
      );
    });
  });

  describe("recomputeVerdictFromEvents (receipts alone)", () => {
    const rerun = (adjudicationId: string, childExitCode: number | null, rerunPlanned: number) => ({
      sourceKind: "flake-rerun",
      adjudicationId,
      childExitCode,
      rerunPlanned,
    });

    it("groups by adjudicationId and counts childExitCode === 0 as passes", () => {
      const events = [
        { sourceKind: "command", adjudicationId: "adj-1" },
        rerun("adj-1", 0, 3),
        rerun("adj-1", 1, 3),
        rerun("adj-1", 0, 3),
        rerun("adj-OTHER", 0, 1),
      ];
      expect(recomputeVerdictFromEvents(events, "adj-1")).toEqual({ verdict: "flaky" });
    });

    it("suite rows (sourceKind command) are never counted as isolation passes", () => {
      const events = [{ sourceKind: "command", adjudicationId: "adj-1", childExitCode: 0 }, rerun("adj-1", 1, 1)];
      expect(recomputeVerdictFromEvents(events, "adj-1")).toEqual({ verdict: "real" });
    });

    it("fewer rerun rows than rerunPlanned recomputes to unadjudicated/budget", () => {
      expect(recomputeVerdictFromEvents([rerun("adj-1", 0, 3), rerun("adj-1", 0, 3)], "adj-1")).toEqual({
        verdict: "unadjudicated",
        reason: "budget",
      });
    });
  });
  ```

- [ ] Write `packages/context-gate/test/flake-verdict.test-d.ts` — same shape as Task 4's pin, two suites: `flakeVerdictSchema.options` is the exact readonly tuple `["real", "flaky", "load-sensitive", "unadjudicated"]`; `unadjudicatedReasonSchema.options` is `["budget", "no-failed-test-id", "multi-failure", "rerun-failed"]`; plus `@ts-expect-error` non-member cases. (This is the FIRST `test-d.ts` in `packages/context-gate` — the vitest config typecheck block and `tsconfig.test-d.json` already exist there, verified; no config work needed.)
- [ ] RED: `pnpm --filter @megasaver/context-gate test -- test/flake-verdict.test.ts test/flake-verdict.test-d.ts`.
- [ ] Implement `src/flake/verdict.ts` per the interface; `recomputeVerdictFromEvents` filters `sourceKind === "flake-rerun" && adjudicationId === wanted`, `planned = rows[0]?.rerunPlanned ?? 0`, `passes = rows.filter((r) => r.childExitCode === 0).length`, `completed = rows.length`, then delegates to `computeFlakeVerdict`.
- [ ] GREEN: `pnpm --filter @megasaver/context-gate test -- test/flake-verdict.test.ts test/flake-verdict.test-d.ts`.
- [ ] Commit: `feat(context-gate): flake verdict + receipt recompute`

---

### Task 8: context-gate — adjudication orchestrator (fake spawn sequence)

**Files:**
- `packages/context-gate/test/flake-adjudicate.test.ts` (new)
- `packages/context-gate/src/flake/adjudicate.ts` (new)

**Interfaces:**

```ts
export const DEFAULT_FLAKE_BUDGET_MS = 60_000;
export const DEFAULT_FLAKE_RUNS = 3; // ASSUMPTION: see Global Constraints table
export type FlakeRunReceipt = { runIndex: number; exitCode: number | null; eventId: string; chunkSetId?: string };
export type FlakeAdjudication = {
  verdict: FlakeVerdict;
  reason?: UnadjudicatedReason;
  passes: number;
  completed: number;
  planned: number;
  framework: TestFramework;
  testId: string;      // redacted
  excerpt: string;     // redacted first-failure excerpt, ≤ 400 chars
  adjudicationId: string;
  receipts: FlakeRunReceipt[];
};
export type AdjudicateInput = {
  storeRoot: string;
  sessionId: SessionId;
  projectId: ProjectId;
  mode: TokenSaverMode;
  storeRawOutput: boolean;
  permissions: ProjectPermissions | null;
  command: string;
  args: readonly string[];
  cwd: string;
  originPid: string;
  execTimeoutMs: number;
  maxBytes: number;
  suiteRaw: string;
  entry: { runs: number; budgetMs: number };
  spawn: RunCommandSpawn;
  nowMs: () => number;
  now: () => string;
  newId: () => string;
};
export function adjudicateFailure(input: AdjudicateInput): Promise<{ flake: FlakeAdjudication; warnings: string[] }>;
```

Loop (spec Architecture): extract via `extractFailedTests(suiteRaw)`; 0 refs → `unadjudicated`/`no-failed-test-id`; > 3 distinct → `unadjudicated`/`multi-failure` (both with zero spawns). Otherwise adjudicate the FIRST failure: build args via `buildRerunArgs` (null → `no-failed-test-id`); for each run `i < entry.runs`: `remaining = budgetMs - (nowMs() - start)`; `remaining < 1000` → stop (verdict from completed runs, `budget` when short); re-gate via `evaluateCommand` (denied → `rerun-failed`); `runChild` (`packages/context-gate/src/run-command.ts:119`) with `timeoutMs: Math.min(remaining, execTimeoutMs)`; spawn error → `rerun-failed` + warning; on capture: when `storeRawOutput`, `saveChunkSet` (`@megasaver/content-store`, shape per `run-command.ts:382-405` — `source: { kind: "command", command: redactedCommand, args: redactedRerunArgs }`, `chunks: recoverableChunks(raw)`); `appendEvent` (`@megasaver/stats`, call shape per `run-command.ts:471-476`) with `sourceKind: "flake-rerun"`, redacted label, real `rawBytes`, `returnedBytes: 0, bytesSaved: 0, deltaBytes: 0, savingRatio: 0`, `childExitCode` from the capture, `adjudicationId`, `rerunIndex: i`, `rerunPlanned: entry.runs`, `summary: "flake isolation re-run"`, `mode`; store write failure → warning, receipt omitted, loop continues. A bound-killed re-run (`terminated` set, `childExitCode === null`) counts as a completed NON-pass. Verdict = `computeFlakeVerdict`. `testId`/`excerpt` = `redact(...).redacted`, excerpt sliced AFTER redaction (redact-then-slice, the `run-command.ts:307` order).

- [ ] Write `packages/context-gate/test/flake-adjudicate.test.ts`. Harness mimics `apps/cli/test/output/exec.test.ts:57-114` byte-for-byte, extended from one scripted child to a scripted SEQUENCE (one `Script` per spawn call — the `ledger-signed-delta.test.ts:61-83` `makeChild`/`spawnMock` precedent, sequenced):

  ```ts
  import { EventEmitter } from "node:events";
  import { mkdtemp, readFile, rm } from "node:fs/promises";
  import { tmpdir } from "node:os";
  import { join } from "node:path";
  import type { ProjectId, SessionId, TokenSaverMode } from "@megasaver/shared";
  import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
  import { adjudicateFailure } from "../src/flake/adjudicate.js";
  import type { RunCommandSpawn } from "../src/run-command.js";

  const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
  const SESSION_ID = "22222222-2222-4222-8222-222222222222" as SessionId;
  const NOW = "2026-08-06T12:00:00.000Z";
  const ROOT_PID = String(process.pid);

  const SUITE_RAW = [
    "FAIL src/thing.test.ts > suite > does x",
    "AssertionError: expected 1 to be 2",
    "Tests  1 failed | 9 passed (10)",
  ].join("\n");

  type FakeChild = EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };

  function makeChild(): FakeChild {
    const child = new EventEmitter() as FakeChild;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn(() => true);
    return child;
  }

  type Script = {
    stdout?: readonly string[];
    stderr?: readonly string[];
    // "close" with the given code (default 0), or "error" with the given message.
    close?: number | null;
    error?: string;
  };

  // A spawn mock that drives the child on setImmediate AFTER it is invoked. The
  // orchestrator subscribes to the child synchronously inside its Promise
  // executor (same tick as the spawn call) — scheduling on setImmediate
  // guarantees listeners are attached before any event fires. Sequenced: the
  // n-th spawn call consumes the n-th script (one fresh child per call).
  function sequencedSpawn(scripts: readonly Script[]) {
    const calls: unknown[][] = [];
    const spawn = ((...a: unknown[]) => {
      const script = scripts[calls.length] ?? { close: 0 };
      calls.push(a);
      const child = makeChild();
      setImmediate(() => {
        for (const chunk of script.stdout ?? []) child.stdout.emit("data", Buffer.from(chunk));
        for (const chunk of script.stderr ?? []) child.stderr.emit("data", Buffer.from(chunk));
        if (script.error !== undefined) {
          child.emit("error", new Error(script.error));
          return;
        }
        child.emit("close", script.close ?? 0);
      });
      return child as unknown;
      // biome-ignore lint/suspicious/noExplicitAny: cast for the orchestrator's spawn slot
    }) as any;
    return { spawn: spawn as RunCommandSpawn, calls };
  }

  // Stepped clock: each nowMs() call consumes the next tick. No sleeps, ever.
  function steppedClock(ticks: readonly number[]) {
    let i = 0;
    return () => ticks[Math.min(i++, ticks.length - 1)] as number;
  }

  function baseInput(overrides: Record<string, unknown> = {}) {
    return {
      storeRoot: "",
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      mode: "balanced" as TokenSaverMode,
      storeRawOutput: true,
      permissions: null,
      command: "pnpm",
      args: ["test"] as readonly string[],
      cwd: "/tmp",
      originPid: ROOT_PID,
      execTimeoutMs: 120_000,
      maxBytes: 1_000_000,
      suiteRaw: SUITE_RAW,
      entry: { runs: 3, budgetMs: 60_000 },
      nowMs: steppedClock([0]),
      now: () => NOW,
      newId: (() => {
        let n = 0;
        return () => `id-${n++}`;
      })(),
      ...overrides,
    };
  }

  async function readRerunEvents(store: string) {
    const raw = await readFile(join(store, "stats", PROJECT_ID, `${SESSION_ID}.events.jsonl`), "utf8");
    return raw
      .trimEnd()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((e) => e["sourceKind"] === "flake-rerun");
  }

  describe("adjudicateFailure", () => {
    let store: string;

    beforeEach(async () => {
      store = await mkdtemp(join(tmpdir(), "megasaver-flake-adj-"));
    });

    afterEach(async () => {
      await rm(store, { recursive: true, force: true });
    });

    it("0/3 passes → real; 3 rerun events with receipts, exit codes 1,1,1", async () => {
      const { spawn, calls } = sequencedSpawn([{ close: 1 }, { close: 1 }, { close: 1 }]);
      const { flake } = await adjudicateFailure({ ...baseInput({ storeRoot: store, spawn }) } as never);
      expect(flake.verdict).toBe("real");
      expect(flake).toMatchObject({ passes: 0, completed: 3, planned: 3, framework: "vitest" });
      expect(calls).toHaveLength(3);
      // Name filter, never a bare suite re-run: -- inserted, file + -t name appended.
      expect(calls[0]?.[1]).toEqual(["test", "--", "src/thing.test.ts", "-t", "suite > does x"]);
      const events = await readRerunEvents(store);
      expect(events).toHaveLength(3);
      expect(events.map((e) => e["childExitCode"])).toEqual([1, 1, 1]);
      expect(events.every((e) => e["adjudicationId"] === flake.adjudicationId)).toBe(true);
      expect(events.map((e) => e["rerunIndex"])).toEqual([0, 1, 2]);
      expect(events.every((e) => e["rerunPlanned"] === 3)).toBe(true);
      // No fabricated savings on any re-run row.
      expect(events.every((e) => e["bytesSaved"] === 0 && e["savingRatio"] === 0)).toBe(true);
      expect(flake.receipts.map((r) => r.exitCode)).toEqual([1, 1, 1]);
      expect(flake.receipts.every((r) => typeof r.chunkSetId === "string")).toBe(true);
    });

    it("3/3 passes → load-sensitive", async () => {
      const { spawn } = sequencedSpawn([{ close: 0 }, { close: 0 }, { close: 0 }]);
      const { flake } = await adjudicateFailure(baseInput({ storeRoot: store, spawn }) as never);
      expect(flake.verdict).toBe("load-sensitive");
      expect(flake.passes).toBe(3);
    });

    it("1/3 passes → flaky, diverging receipts kept", async () => {
      const { spawn } = sequencedSpawn([{ close: 1 }, { close: 0 }, { close: 1 }]);
      const { flake } = await adjudicateFailure(baseInput({ storeRoot: store, spawn }) as never);
      expect(flake.verdict).toBe("flaky");
      expect(flake.receipts.map((r) => r.exitCode)).toEqual([1, 0, 1]);
    });

    it("budget cut via stepped nowMs: stops after 1 run → unadjudicated/budget", async () => {
      const { spawn, calls } = sequencedSpawn([{ close: 1 }, { close: 1 }, { close: 1 }]);
      // start=0; run 1 checks remaining at 0 → ok; run 2 checks at 59_500 → 500ms left < 1000 → stop.
      const { flake } = await adjudicateFailure(
        baseInput({ storeRoot: store, spawn, nowMs: steppedClock([0, 0, 59_500]) }) as never,
      );
      expect(flake).toMatchObject({ verdict: "unadjudicated", reason: "budget", completed: 1, planned: 3 });
      expect(calls).toHaveLength(1);
    });

    it("policy denial on the re-run → unadjudicated/rerun-failed, zero spawns", async () => {
      const { spawn, calls } = sequencedSpawn([]);
      const { flake, warnings } = await adjudicateFailure(
        baseInput({
          storeRoot: store,
          spawn,
          // Tighten-only project deny gate: forbid the re-run command outright.
          permissions: { denyReadPatterns: [], denyCommands: ["pnpm"] },
        }) as never,
      );
      expect(flake).toMatchObject({ verdict: "unadjudicated", reason: "rerun-failed" });
      expect(calls).toHaveLength(0);
      expect(warnings.some((w) => w.includes("rerun"))).toBe(true);
    });

    it("spawn error mid-loop → unadjudicated/rerun-failed, receipts hold what persisted", async () => {
      const { spawn } = sequencedSpawn([{ close: 1 }, { error: "ENOENT" }]);
      const { flake } = await adjudicateFailure(baseInput({ storeRoot: store, spawn }) as never);
      expect(flake).toMatchObject({ verdict: "unadjudicated", reason: "rerun-failed" });
      expect(flake.receipts).toHaveLength(1);
    });

    it("no extractable failed test → unadjudicated/no-failed-test-id, zero spawns", async () => {
      const { spawn, calls } = sequencedSpawn([]);
      const { flake } = await adjudicateFailure(
        baseInput({ storeRoot: store, spawn, suiteRaw: "error: not test output at all" }) as never,
      );
      expect(flake).toMatchObject({ verdict: "unadjudicated", reason: "no-failed-test-id" });
      expect(calls).toHaveLength(0);
    });

    it("more than 3 distinct failures → unadjudicated/multi-failure, zero spawns", async () => {
      const many = Array.from({ length: 5 }, (_, i) => `--- FAIL: TestCase${i} (0.01s)`).join("\n");
      const { spawn, calls } = sequencedSpawn([]);
      const { flake } = await adjudicateFailure(baseInput({ storeRoot: store, spawn, suiteRaw: many }) as never);
      expect(flake).toMatchObject({ verdict: "unadjudicated", reason: "multi-failure" });
      expect(calls).toHaveLength(0);
    });

    it("excerpt and testId are redacted and the excerpt is capped at 400 chars", async () => {
      const secretRaw = [
        "FAIL src/thing.test.ts > suite > does x",
        `Authorization: Bearer sk-test-${"a".repeat(40)}`,
        "x".repeat(1000),
      ].join("\n");
      const { spawn } = sequencedSpawn([{ close: 1 }, { close: 1 }, { close: 1 }]);
      const { flake } = await adjudicateFailure(
        baseInput({ storeRoot: store, spawn, suiteRaw: secretRaw }) as never,
      );
      expect(flake.excerpt.length).toBeLessThanOrEqual(400);
      expect(flake.excerpt).not.toContain("sk-test-");
    });
  });
  ```

  (The `permissions` literal above is the PARSED `ProjectPermissions` shape — `{ denyReadPatterns: readonly PathMatcher[]; denyCommands: readonly string[] }`, `packages/policy/src/parse-project-permissions.ts:63-66` — which `evaluateCommand` consumes via `input.permissions?.denyCommands` at `packages/policy/src/evaluate-command.ts:67`; verified. It is NOT the raw YAML `{ deny: { commands } }` file shape.)
- [ ] RED: `pnpm --filter @megasaver/context-gate test -- test/flake-adjudicate.test.ts`.
- [ ] Implement `src/flake/adjudicate.ts` per the loop contract above. Imports: `extractFailedTests` from `@megasaver/output-filter`; `evaluateCommand`, `redact` from `@megasaver/policy`; `saveChunkSet` from `@megasaver/content-store`; `appendEvent`, type `TokenSaverEvent` from `@megasaver/stats`; `runChild`, type `RunCommandSpawn` from `../run-command.js`; `recoverableChunks` from `../recoverable-chunks.js`. Excerpt source: the first extracted ref's raw row plus following lines up to the cap, `redact(...)` FIRST then `.slice(0, 400)`.
- [ ] GREEN: `pnpm --filter @megasaver/context-gate test -- test/flake-adjudicate.test.ts`.
- [ ] Commit: `feat(context-gate): flake adjudication orchestrator`

---

### Task 9: context-gate wiring + core re-exports

**Files:**
- `packages/context-gate/test/flake-exec-wiring.test.ts` (new)
- `packages/context-gate/src/run-command.ts` (edit)
- `packages/context-gate/src/index.ts` (edit — export flake module surface)
- `packages/core/src/context-gate.ts` (edit — re-export)

**Interfaces:** `RunOutputExecInput` (`packages/context-gate/src/run-command.ts:64`) gains `noFlake?: boolean` and `nowMs?: () => number`. `ExecResult` (`run-command.ts:84`) gains `flake?: FlakeAdjudication`. Eligibility gate runs in `runOutputExecCommand` AFTER capture + chunk-set persist and BEFORE `mcpEnvelopeBytes(result)` at `run-command.ts:432` (Decision 7: the verdict's bytes count into the envelope) and BEFORE the suite event build at `run-command.ts:433` (the suite event carries `adjudicationId`). Gate condition — ALL of: `readFlakeAllowlist` ok AND `matchFlakeEntry` hit AND `outcome.capture.childExitCode !== 0 && !== null` AND `outcome.capture.terminated === undefined` AND `input.noFlake !== true`. ORDER MATTERS: the run-eligibility checks (`noFlake`, `terminated`, `childExitCode`) run BEFORE `readFlakeAllowlist`, so an ineligible run — including a PASSING run with a malformed allowlist file on disk — never reads the allowlist and stays byte-identical to today (spec Decision 2's eligibility lock). Malformed allowlist → skip adjudication + warning (fail-inert), and that warning can only appear on runs that would otherwise adjudicate. Anything ineligible → zero extra spawns, result byte-identical to today. Overlay path (`runOverlayOutputExecCommand`, `run-command.ts:506`) is NOT touched (Non-Goal 1).

- [ ] Write `packages/context-gate/test/flake-exec-wiring.test.ts` — reuse the Task 8 harness (`makeChild`/`sequencedSpawn`) plus the registry stub of `packages/context-gate/test/ledger-signed-delta.test.ts:85-100`, driving `runOutputExecCommand` end-to-end with a temp store. Cases:

  ```ts
  // Cases (each with an assertion on calls.length — the spawn count IS the contract):
  // 1. allowlist EMPTY + failing suite → 1 spawn total, result has no `flake`,
  //    suite event has no adjudicationId (byte-identical-to-today guard: also
  //    deep-equal the result against a run with noFlake: true).
  // 2. allowlisted + suite exit 0 → 1 spawn, no `flake`.
  // 3. allowlisted + failing suite + noFlake: true → 1 spawn, no `flake`.
  // 4. allowlisted + terminated ("timeout" script via max-bytes/timeout path →
  //    childExitCode null) → 1 spawn, no `flake` (no honest parse of partial output).
  // 5. allowlisted + failing vitest suite, re-runs scripted [1,1,1] → 4 spawns,
  //    result.flake.verdict === "real", suite event row carries the same
  //    adjudicationId as the 3 flake-rerun rows, and the ONE suite row keeps
  //    sourceKind "command" (C3 filter safety).
  // 6. malformed allowlist JSON on disk + FAILING suite → 1 spawn, no `flake`,
  //    result.warnings includes a flake-allowlist warning (fail-inert, never
  //    fail-open).
  // 7. malformed allowlist JSON on disk + suite exit 0 → 1 spawn, NO warning:
  //    result deep-equals the same run with noFlake: true (Decision 2's
  //    byte-identical lock — a passing run never reads the allowlist).
  ```

  Write each as a real `it(...)` with the sequenced spawn scripts (`{ stdout: [SUITE_RAW], close: 1 }` first, then the re-run scripts) and `readFile` on `stats/<pid>/<sid>.events.jsonl` for the event assertions, exactly as in Task 8's `readRerunEvents`.
- [ ] RED: `pnpm --filter @megasaver/context-gate test -- test/flake-exec-wiring.test.ts`.
- [ ] Implement the gate in `runOutputExecCommand` between the chunk-set block (`run-command.ts:382-405`) and the envelope measurement (`:432`):

  ```ts
  let adjudicationId: string | undefined;
  // Eligibility FIRST, allowlist read second: a run that would not adjudicate
  // (passing, terminated, or --no-flake) must stay byte-identical to today
  // even when the allowlist file is malformed (Decision 2 lock) — so the
  // unreadable-allowlist warning can only fire on otherwise-eligible failures.
  if (
    input.noFlake !== true &&
    outcome.capture.terminated === undefined &&
    outcome.capture.childExitCode !== 0 &&
    outcome.capture.childExitCode !== null
  ) {
    const allowlist = readFlakeAllowlist(input.storeRoot);
    if (!allowlist.ok) {
      resultWarnings.push(`flake allowlist unreadable: ${allowlist.detail} (adjudication disabled)`);
    } else {
      const entry = matchFlakeEntry(allowlist.entries, input.command, input.args);
      if (entry !== null) {
        const { flake, warnings: flakeWarnings } = await adjudicateFailure({ /* thread inputs */ });
        result.flake = flake;
        adjudicationId = flake.adjudicationId;
        resultWarnings.push(...flakeWarnings);
      }
    }
  }
  ```

  then `...(adjudicationId !== undefined ? { adjudicationId } : {})` on the suite event object (`:433-469`). Note `resultWarnings` is currently built before this point (`run-command.ts:363-370`) — move the `result` warning-spread AFTER the gate or push into the array before constructing `result`; keep the no-warnings shape (`warnings` key absent when empty) identical.
- [ ] Export from `packages/context-gate/src/index.ts`: everything Tasks 5-8 defined (`flakeAllowlistSchema`, `FlakeEntry`, `readFlakeAllowlist`, `upsertFlakeEntry`, `removeFlakeEntry`, `matchFlakeEntry`, `flakeAllowlistPath`, `buildRerunArgs`, `escapeGoRunPattern`, `flakeVerdictSchema`, `FlakeVerdict`, `unadjudicatedReasonSchema`, `UnadjudicatedReason`, `computeFlakeVerdict`, `recomputeVerdictFromEvents`, `adjudicateFailure`, `FlakeAdjudication`, `FlakeRunReceipt`, `DEFAULT_FLAKE_BUDGET_MS`, `DEFAULT_FLAKE_RUNS`).
- [ ] Re-export the same names through `packages/core/src/context-gate.ts` (existing export-block shape at `packages/core/src/context-gate.ts:1-25`). `apps/cli` must import ONLY `@megasaver/core` (`apps/cli/test/dependency-graph.test.ts` pin — run it: `pnpm --filter @megasaver/cli test -- test/dependency-graph.test.ts`).
- [ ] GREEN: `pnpm --filter @megasaver/context-gate test && pnpm --filter @megasaver/core build && pnpm --filter @megasaver/core test`.
- [ ] Commit: `feat(context-gate): adjudicate flaky failures on exec`

---

### Task 10: CLI — `mega flake enable|disable|status`

**Files:**
- `apps/cli/test/flake.test.ts` (new — flat, per `wiki/workflows/cli-test-pattern.md`)
- `apps/cli/src/commands/flake.ts` (new)
- `apps/cli/src/errors.ts` (edit — three helpers)
- `apps/cli/src/main.ts` (edit — register `flake: flakeCommand` in `subCommands`, `apps/cli/src/main.ts:61`)

**Interfaces:** [[workflows/cli-test-pattern]] shape — `defineCommand` wrappers are thin adapters over inner pure functions:

```ts
export type RunFlakeEnableInput = {
  pattern: string | undefined;
  runsFlag: string | undefined;       // parse: int 1..10, default DEFAULT_FLAKE_RUNS
  budgetSecFlag: string | undefined;  // parse: int 5..600, default DEFAULT_FLAKE_BUDGET_MS / 1000
  storeFlag: string | undefined;
  cwd: string; home: string; xdgDataHome: string | undefined;
  platform: NodeJS.Platform; localAppData: string | undefined;
  stdout: (line: string) => void; stderr: (line: string) => void;
  now?: () => string;
};
export async function runFlakeEnable(input: RunFlakeEnableInput): Promise<0 | 1>;
export async function runFlakeDisable(input: /* pattern + store/io slice */): Promise<0 | 1>;
export async function runFlakeStatus(input: /* store/io slice + json?: boolean */): Promise<0 | 1>;
export const flakeCommand: /* defineCommand with subCommands { enable, disable, status } */;
```

Error helpers in `apps/cli/src/errors.ts` (shape per `duplicateNameMessage`, `apps/cli/src/errors.ts:43`; `CliMessage` at `:15`):

```ts
export function flakePatternRequiredMessage(): CliMessage;
export function invalidFlakeRunsMessage(value: string): CliMessage;   // "runs must be an integer 1..10"
export function invalidFlakeBudgetMessage(value: string): CliMessage; // "budget-sec must be an integer 5..600"
```

Store resolution mirrors exec: `resolveStorePath` from `apps/cli/src/store.js` (`apps/cli/src/commands/output/exec.ts:12,69`). Failure paths: text → stderr, empty stdout, exit 1 (spec §Error handling).

- [ ] Write `apps/cli/test/flake.test.ts` — inner-function tests plus one `Command.run?.({...} as never)` smoke per subcommand (`wiki/workflows/cli-test-pattern.md` "Test invocation" section, byte-for-byte: `logSpy`/`errSpy` on console, `process.exitCode` reset in beforeEach/afterEach, `mkdtemp` temp store passed via `--store`):

  ```ts
  import { mkdtemp, rm } from "node:fs/promises";
  import { tmpdir } from "node:os";
  import { join } from "node:path";
  import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
  import { flakeCommand, runFlakeDisable, runFlakeEnable, runFlakeStatus } from "../src/commands/flake.js";

  describe("mega flake", () => {
    let store: string;
    const io = () => {
      const out: string[] = [];
      const err: string[] = [];
      return { out, err, stdout: (l: string) => out.push(l), stderr: (l: string) => err.push(l) };
    };
    const base = (extra: Record<string, unknown> = {}) => ({
      storeFlag: store,
      cwd: "/tmp",
      home: "/tmp",
      xdgDataHome: undefined,
      platform: "linux" as NodeJS.Platform,
      localAppData: undefined,
      now: () => "2026-08-06T12:00:00.000Z",
      ...extra,
    });

    beforeEach(async () => {
      store = await mkdtemp(join(tmpdir(), "megasaver-flake-cli-"));
    });

    afterEach(async () => {
      await rm(store, { recursive: true, force: true });
    });

    it("enable without pattern → exit 1, pattern message on stderr, empty stdout", async () => {
      const { out, err, stdout, stderr } = io();
      const code = await runFlakeEnable({ ...base(), pattern: undefined, runsFlag: undefined, budgetSecFlag: undefined, stdout, stderr } as never);
      expect(code).toBe(1);
      expect(out).toHaveLength(0);
      expect(err.some((e) => e.includes("pattern"))).toBe(true);
    });

    it("enable rejects runs 0 and 11, budget-sec 4 and 601", async () => {
      for (const [runsFlag, budgetSecFlag] of [["0", undefined], ["11", undefined], [undefined, "4"], [undefined, "601"]] as const) {
        const { err, stdout, stderr } = io();
        const code = await runFlakeEnable({ ...base(), pattern: "pnpm test", runsFlag, budgetSecFlag, stdout, stderr } as never);
        expect(code).toBe(1);
        expect(err.length).toBeGreaterThan(0);
      }
    });

    it("enable then status round-trips pattern, runs, budget", async () => {
      const a = io();
      expect(
        await runFlakeEnable({ ...base(), pattern: "pnpm test", runsFlag: "5", budgetSecFlag: "120", stdout: a.stdout, stderr: a.stderr } as never),
      ).toBe(0);
      const b = io();
      expect(await runFlakeStatus({ ...base(), json: false, stdout: b.stdout, stderr: b.stderr } as never)).toBe(0);
      expect(b.out.join("\n")).toContain("pnpm test");
      expect(b.out.join("\n")).toContain("5");
      expect(b.out.join("\n")).toContain("120");
    });

    it("disable removes the entry; status on empty store says empty", async () => {
      const a = io();
      await runFlakeEnable({ ...base(), pattern: "pnpm test", runsFlag: undefined, budgetSecFlag: undefined, stdout: a.stdout, stderr: a.stderr } as never);
      expect(await runFlakeDisable({ ...base(), pattern: "pnpm test", stdout: a.stdout, stderr: a.stderr } as never)).toBe(0);
      const b = io();
      await runFlakeStatus({ ...base(), json: false, stdout: b.stdout, stderr: b.stderr } as never);
      expect(b.out.join("\n")).not.toContain("pnpm test");
    });
  });

  describe("flakeCommand (citty adapter)", () => {
    let logSpy: ReturnType<typeof vi.spyOn>;
    let errSpy: ReturnType<typeof vi.spyOn>;
    let store: string;

    beforeEach(async () => {
      logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      process.exitCode = 0;
      store = await mkdtemp(join(tmpdir(), "megasaver-flake-cmd-"));
    });

    afterEach(async () => {
      logSpy.mockRestore();
      errSpy.mockRestore();
      process.exitCode = 0;
      await rm(store, { recursive: true, force: true });
    });

    it("status subcommand runs through the adapter with a temp store", async () => {
      const status = (flakeCommand as { subCommands?: Record<string, unknown> }).subCommands?.["status"] as {
        run?: (ctx: never) => Promise<void>;
      };
      await status.run?.({ args: { store, json: false }, cmd: status, rawArgs: [], data: undefined } as never);
      expect(process.exitCode).toBe(0);
    });
  });
  ```

- [ ] RED: `pnpm --filter @megasaver/cli test -- test/flake.test.ts`.
- [ ] Implement `apps/cli/src/commands/flake.ts` (imports from `@megasaver/core` ONLY), the three `errors.ts` helpers, and register `flake: flakeCommand` in `apps/cli/src/main.ts` `subCommands`. Status output: one line per entry `"<pattern>  runs=<n>  budget=<s>s"`, or `"flake allowlist is empty"`; `--json` prints the entries array as one line.
- [ ] GREEN: `pnpm --filter @megasaver/cli test -- test/flake.test.ts test/dependency-graph.test.ts`.
- [ ] Commit: `feat(cli): mega flake enable/disable/status`

---

### Task 11: CLI — `--no-flake` flag + verdict rendering on exec

**Files:**
- `apps/cli/test/output/exec-flake.test.ts` (new — reuses the exec harness)
- `apps/cli/src/commands/output/exec.ts` (edit)

**Interfaces:** `RunOutputExecInput` (CLI-side, `apps/cli/src/commands/output/exec.ts:37`) gains `noFlake?: boolean`; the `defineCommand` args gain `"no-flake"` (boolean, default false); the core call site (`exec.ts:102-113`) threads `...(input.noFlake !== undefined ? { noFlake: input.noFlake } : {})` and (for tests) an optional `nowMs`. Text rendering appends, when `result.flake` is present, ONE verdict line plus fetch handles:

```
flake verdict: flaky (1/3 isolation passes) — suite > does x [vitest]
  re-run receipts: mega output chunk "<chunkSetId>" "<i>"  (runs 0..2)
```

`--json` and the MCP envelope carry `result.flake` as-is (already true once Task 9 stamps it — assert, don't re-implement).

- [ ] Write `apps/cli/test/output/exec-flake.test.ts`. Copy the harness of `apps/cli/test/output/exec.test.ts:1-187` byte-for-byte (`seed` at `:23`, `FakeChild`/`makeChild` at `:57-69`, `Script` at `:71-77`, `scriptedSpawn` at `:85-102`, `inertSpawn` at `:106-114`, `capture` at `:116-118`, `baseInput`/`scriptedInput` at `:135-187`) with ONE extension: `scriptedSpawn` → the Task 8 `sequencedSpawn` (n-th call consumes n-th script, one fresh child per call) so the suite spawn and the re-run spawns can be scripted independently. Then:

  ```ts
  const SUITE_RAW = [
    "FAIL src/thing.test.ts > suite > does x",
    "AssertionError: expected 1 to be 2",
    "Tests  1 failed | 9 passed (10)",
  ].join("\n");

  async function enableFlake(storeDir: string): Promise<void> {
    // Seed the allowlist file directly — the CLI store and the core store share
    // <storeRoot>; shape pinned by flakeAllowlistSchema (context-gate Task 5).
    await mkdir(join(storeDir, "flake"), { recursive: true });
    await writeFile(
      join(storeDir, "flake", "allowlist.json"),
      JSON.stringify({
        version: 1,
        entries: [{ pattern: "pnpm test", runs: 3, budgetMs: 60_000, addedAt: TS }],
      }),
    );
  }

  it("allowlisted failing run prints one verdict line + receipts, exit code mirrors child", async () => {
    await seed(store, projectRoot);
    await enableFlake(store);
    const { input, out } = sequencedInput([
      { stdout: [SUITE_RAW], close: 1 },
      { close: 1 },
      { close: 1 },
      { close: 1 },
    ]);
    const code = await runOutputExec(input);
    expect(code).toBe(1); // child-mirrored suite exit, unchanged by adjudication
    expect(out.some((l) => l.includes("flake verdict: real (0/3 isolation passes)"))).toBe(true);
    expect(out.some((l) => l.includes('mega output chunk "'))).toBe(true);
  });

  it("--no-flake suppresses adjudication: exactly one spawn, no verdict line", async () => {
    await seed(store, projectRoot);
    await enableFlake(store);
    const { input, calls, out } = sequencedInput([{ stdout: [SUITE_RAW], close: 1 }], { noFlake: true });
    await runOutputExec(input);
    expect(calls).toHaveLength(1);
    expect(out.some((l) => l.includes("flake verdict"))).toBe(false);
  });

  it("non-allowlisted failing run: exactly one spawn, no verdict line", async () => {
    await seed(store, projectRoot);
    const { input, calls, out } = sequencedInput([{ stdout: [SUITE_RAW], close: 1 }]);
    await runOutputExec(input);
    expect(calls).toHaveLength(1);
    expect(out.some((l) => l.includes("flake verdict"))).toBe(false);
  });

  it("--json carries result.flake as-is (verdict + receipts + adjudicationId)", async () => {
    await seed(store, projectRoot);
    await enableFlake(store);
    const { input, out } = sequencedInput(
      [{ stdout: [SUITE_RAW], close: 1 }, { close: 0 }, { close: 0 }, { close: 0 }],
      { json: true },
    );
    await runOutputExec(input);
    const payload = JSON.parse(out.join("")) as { result: { flake?: Record<string, unknown> } };
    expect(payload.result.flake).toMatchObject({ verdict: "load-sensitive", passes: 3, planned: 3 });
    expect(Array.isArray(payload.result.flake?.["receipts"])).toBe(true);
  });
  ```

  (`sequencedInput` = `scriptedInput` with `sequencedSpawn` swapped in; keep every other field of the harness identical — `SESSION_ID`, `intentFlag`, `storeFlag: store`, `originPid: ROOT_PID`, injected `now`/`newId`.)
- [ ] RED: `pnpm --filter @megasaver/cli test -- test/output/exec-flake.test.ts`.
- [ ] Implement: the `no-flake` boolean arg on `execCommandFromPositionals`' `defineCommand`, `noFlake` threading in `runOutputExec`, and the verdict/receipt text rendering after the existing success line (chunk-handle format matching the recovery-footer style already emitted by the exec path — mirror the wording the existing `Ran <cmd> ...` renderer uses for `chunkSetId`, `apps/cli/test/output/exec.test.ts:309`).
- [ ] GREEN: `pnpm --filter @megasaver/cli test -- test/output/exec.test.ts test/output/exec-flake.test.ts` (the pre-existing exec suite must stay green untouched — byte-identical ineligible path).
- [ ] Commit: `feat(cli): flake verdict on exec + --no-flake`

---

### Task 12: changesets, full verification, smoke evidence, wiki

**Files:**
- `.changeset/flake-adjudicator.md` (new)
- `wiki/log.md` (append), relevant wiki pages (update)

- [ ] Add the changeset (all five touched packages, DoD #9; prose style precedent: existing `.changeset/*.md`):

  ```md
  ---
  "@megasaver/output-filter": minor
  "@megasaver/stats": minor
  "@megasaver/context-gate": minor
  "@megasaver/core": minor
  "@megasaver/cli": minor
  ---

  Flake adjudicator: when an allowlisted test command fails under
  `mega output exec`, the failed test is re-run name-filtered N times inside a
  hard wall-clock budget and the digest is stamped with an evidence-backed
  verdict (real / flaky / load-sensitive / unadjudicated). Every re-run
  persists a lossless chunk set and a `sourceKind: "flake-rerun"` stats event
  carrying `childExitCode`, `adjudicationId`, `rerunIndex`, `rerunPlanned` —
  the verdict is recomputable from receipts alone. The allowlist ships EMPTY
  (`mega flake enable|disable|status`); `--no-flake` opts a single run out.
  ```

- [ ] `pnpm verify` at repo root — lint + typecheck + all tests green (DoD #4). Fix drift, never bypass.
- [ ] Feature smoke evidence (DoD #5, CLI feature → captured terminal session): in a scratch project with a deliberately flaky vitest test (e.g. failing when a marker file is absent), run `mega flake enable "pnpm test"`, then `mega output exec <sid> --intent "adjudicate" -- pnpm test`, and capture the printed verdict line + receipts; then `mega output chunk` one re-run receipt to show recoverability. This is also the moment the Task 4 vitest-reporter ASSUMPTION gets its final real-world confirmation.
- [ ] Update wiki: add `wiki/` page for the flake adjudicator surface (allowlist location, verdict semantics, recompute rule), append a timestamped `wiki/log.md` entry (§0 mandate).
- [ ] Request reviews per spec §Risk: `code-reviewer` AND `critic`, separate passes, fresh contexts (`superpowers:requesting-code-review`); then `verifier` with the smoke evidence (DoD #6-7).
- [ ] Commit: `docs(changeset): flake adjudicator release notes`

---

## Self-review notes (plan author)

- The plan was written against the spec read in full (all 251 lines; the file is complete on disk — no repair was needed or made).
- Every `path:line` above was verified by reading the file at plan-writing time except where marked `ASSUMPTION:`. The load-bearing ones: `run-command.ts:64/84/105/119/206/290-292/299/307/363-370/382-405/432-433/471-476/506`, `output-source.ts:3`, `parsers/index.ts:37-58`, `pytest.ts:11`, `cargo-test.ts:7`, `go-test.ts:14`, `test-output.ts:9,11`, `stats/src/event.ts:16-22,41,72`, `shared/src/file-lock.ts:25`, `shared/src/node.ts:1`, `net-effect-store.ts:28-30`, `policy/src/redact.ts:44`, `cli exec.ts:12,37,65,69,102-113`, `cli exec.test.ts:23,57-187,309`, `ledger-signed-delta.test.ts:61-100`, `enum-pin-audit.test.ts:16-38`, `core/src/context-gate.ts:1-25`, `main.ts:61`, `output-source.test-d.ts:33-36`, `content-store/test/source-discriminator.test-d.ts:19-29` (second enum-pin consumer, covered by Task 3), `policy/src/parse-project-permissions.ts:63-66`, `policy/src/evaluate-command.ts:67`.
- Open ASSUMPTION markers for the implementer: (1) `DEFAULT_FLAKE_RUNS = 3` and runs bounds 1..10 (spec silent); (2) extraction cap 10 (only the >3 comparison is contract); (3) vitest default-reporter row format — the spec itself orders a real-run check at impl time (Tasks 4 and 12 both carry it).
- Deliberate deviations from none: overlay path untouched, `childExitCode` never added by this plan (Task 1 gates on claim-verification-gate), enum-pin-audit untouched, no new exit-code field, no timing-tight tests anywhere (stepped `nowMs` arrays and spawn-count assertions instead).
