# Paste Airlock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect large log-like pastes at UserPromptSubmit with a two-signal rule (size AND log-likeness), park the redacted original as an overlay chunk set fetchable via `mega output chunk`, and inject a conservative `additionalContext` digest with the fetch handle — with a `mega airlock on|off|status` kill-switch, `!raw` per-prompt bypass, and fail-open exit 0 everywhere. v1 is additive (the raw prompt still enters context — verified harness contract); it claims ZERO token savings.

**Architecture:** A new sibling UserPromptSubmit handler `mega hooks airlock` (NOT an intent-run extension — spec Locked Decision 2). Detection lives in `@megasaver/output-filter` (`assessPaste`, reusing `classifyOutput` at `packages/output-filter/src/classify.ts:114` plus new per-line signal regexes run on 512-char head slices). Parking reuses `recoverableChunks` (`packages/context-gate/src/recoverable-chunks.ts:21`, newly exported from the package index) feeding `saveOverlayChunkSet` (`packages/content-store/src/store.ts:169`) with a new `{ kind: "paste", label }` source member on `overlayChunkSetSchema` (`packages/content-store/src/chunk-set.ts:42`). Redaction runs once (`redact`, `packages/policy/src/redact.ts:44`); chunks AND digest are both built from the redacted text. The connector installs a second UserPromptSubmit entry beside intent (two same-event entries coexist by subcommand — `entryMatchesSubcommand`, `packages/connectors/claude-code/src/hook-settings.ts:220`). Explicitly NOT `recordAndFilterOverlayOutput` (`packages/context-gate/src/record-output.ts:216`) — its stats/evidence side effects are spec Non-Goals.

**Tech Stack:** TypeScript strict ESM, Zod at boundaries, Vitest, Citty CLI, per-package atomic tmp+rename writers, Changesets. No new workspace dependencies: `@megasaver/cli` already depends on `content-store`, `context-gate`, `output-filter`, `policy`, `shared` (`apps/cli/package.json:40-52`). No pnpm catalog exists in this repo — use `workspace:*` conventions as-is (nothing to add).

## Global Constraints

- **Worktree mandatory** (risk HIGH, §12): all work on `feat/cli-paste-airlock` in an isolated worktree via `superpowers:using-git-worktrees`. No `main` edits.
- **Fail-open is not optional:** the hook process ALWAYS sets `process.exitCode = 0` and writes NOTHING to stdout on any failure — a crashing UserPromptSubmit hook blocks every prompt. Mirror `runIntentHookFromProcess` (`apps/cli/src/hooks/intent-run.ts:160`).
- **Never emit `decision`** in hook output. The only output is `{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext}}` (precedent: `apps/cli/src/hooks/task-kickoff.ts:313-318`).
- **Digest ⇒ parked invariant:** park write failing means NO digest either. A handle pointing at nothing is worse than silence.
- **Redact once, use twice:** `redact(prompt)` first; both the persisted chunks and the digest derive from the redacted text. No un-redacted prompt byte is ever persisted.
- **Honest metrics posture:** no `TokenSaverEvent`, no `bytesSaved`, no savings percentage in the digest, no `OutputSourceKind` extension, no evidence-ledger row, and `apps/cli` must NOT import `@megasaver/stats`.
- **All new regexes linear by construction:** per-line application on a 512-char head slice, bounded quantifiers, never `^\s*` under the `m` flag (wiki `concepts/redos-case-output-filter`). The growth-ratio guard (Task 4) lands in the same PR as the detector (Task 3) — the feature does not merge without it.
- **No timing-tight tests** anywhere except the Task 4 growth-ratio instrument (which measures a ratio, not wall-clock).
- **Escalation triggers** (stop and re-spec, do not improvise): any need to touch `filterOutput` internals, ranking weights, or stats schemas.
- **Commits:** conventional commits, one logical change per task, subject ≤ 50 chars, imperative. Do not push or merge from this plan; `code-reviewer` AND `critic` passes (separate fresh contexts) plus `verifier` evidence are required before `superpowers:finishing-a-development-branch`.
- Run RED steps before GREEN steps — a test that never failed proves nothing.

---

### Task 1: `@megasaver/content-store` — `paste` source member

**Files:**

- Modify: `packages/content-store/src/chunk-set.ts` (source union, line 22-30)
- Modify: `packages/content-store/test/source-discriminator.test-d.ts` (relation becomes superset, see Step 4)
- Create: `packages/content-store/test/paste-source.test.ts`
- Modify: `packages/context-gate/src/fetch-chunk.ts` (two `source.kind` consumer sites break under the widened union, see Step 5)
- Modify: `packages/context-gate/test/fetch-chunk-expansion-event.test.ts` (RED test for the skipped paste debt event, see Step 5)

**Interfaces:** `overlayChunkSetSchema` (`packages/content-store/src/chunk-set.ts:42`) reuses `chunkSetSchema.shape.source` (line 48), so adding the member to `chunkSetSchema`'s discriminated union (line 22) covers both schemas. `assertSafeSegment` (`packages/content-store/src/paths.ts:5`) and `overlayChunkSetPath` (`paths.ts:33`) already gate every path segment — no change needed there.

- [ ] **Step 1: Write the failing schema test**

```ts
// packages/content-store/test/paste-source.test.ts
import { describe, expect, it } from "vitest";
import { overlayChunkSetSchema } from "../src/chunk-set.js";

const base = {
  chunkSetId: "cs-0123456789abcdef0123456789abcdef",
  liveSessionId: "sess-1",
  workspaceKey: "wk-project",
  createdAt: "2026-08-06T12:00:00.000Z",
  rawBytes: 24576,
  redacted: true,
  chunks: [
    { id: "0", startLine: 1, endLine: 40, bytes: 512, text: " FAIL  test/session.test.ts" },
  ],
};

describe("overlayChunkSetSchema paste source", () => {
  it("accepts { kind: 'paste', label }", () => {
    const parsed = overlayChunkSetSchema.parse({
      ...base,
      source: { kind: "paste", label: "user paste (600 lines, 24576 B)" },
    });
    expect(parsed.source).toEqual({ kind: "paste", label: "user paste (600 lines, 24576 B)" });
  });

  it("rejects a paste source without a label", () => {
    const result = overlayChunkSetSchema.safeParse({ ...base, source: { kind: "paste" } });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown source kind (union stays closed)", () => {
    const result = overlayChunkSetSchema.safeParse({
      ...base,
      source: { kind: "clipboard", label: "x" },
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: RED**

Run: `pnpm --filter @megasaver/content-store exec vitest run test/paste-source.test.ts`

Expected: FAIL — `paste` is not a union member.

- [ ] **Step 3: GREEN — add the member**

In `packages/content-store/src/chunk-set.ts`, extend the discriminated union (after the `fetch` member, line 30):

```ts
      z.object({ kind: z.literal("fetch"), url: z.string().url() }),
      // Paste Airlock (#14): a user paste parked by the UserPromptSubmit
      // hook. Store-only member — deliberately NOT an OutputSourceKind
      // (that enum feeds the stats adoption denominator; spec Non-Goal).
      z.object({ kind: z.literal("paste"), label: z.string() }),
```

- [ ] **Step 4: Repair the discriminator type-test to the new relation**

`packages/content-store/test/source-discriminator.test-d.ts` currently asserts `SourceKind` and `OutputSourceKind` are mutually assignable (`const _forward: OutputSourceKind = "command" as SourceKind;`) — that direction is now a type error BY DESIGN: the chunk-set source union becomes a strict superset. Replace the forward assertion:

```ts
  it("every OutputSourceKind remains a valid SourceKind (superset since paste)", () => {
    // The reverse (SourceKind -> OutputSourceKind) is intentionally NOT
    // assignable: "paste" is a store-only source with no stats identity.
    const _back: SourceKind = "command" as OutputSourceKind;
    // @ts-expect-error paste never becomes an OutputSourceKind (spec Non-Goal)
    const _noPaste: OutputSourceKind = "paste" as SourceKind;
    void _back;
    void _noPaste;
  });
```

Keep the per-literal assertions (`"command"`, `"fetch"`, `"file"`, `"grep"`) unchanged — they always hold. The `outputSourceKindSchema.options` tuple assertion holds only until the flake-adjudicator plan lands (its Task 3 appends `flake-rerun` to the enum and rewrites this same file). CROSS-PLAN COORDINATION — whichever feature lands second merges, not overwrites: per-literal assertions stay; the tuple pin reads whatever the enum then is (`[..., "flake-rerun"]` once flake-adjudicator has landed); and once BOTH land, NEITHER direction of the union assignability holds — the `_back: SourceKind = "command" as OutputSourceKind` line above then needs its own `@ts-expect-error` (`flake-rerun` is a stats-only source kind, never a chunk-set source), alongside the `_noPaste` one.

- [ ] **Step 5: Fix the two `source.kind` consumer sites in `packages/context-gate/src/fetch-chunk.ts`**

Two consumer sites OUTSIDE `chunk-set.ts`/`record-output.ts` read `source.kind` and become `tsc` errors the moment the union gains `paste` (verified against the repo — the earlier draft's claim that none exist was wrong):

1. `fetch-chunk.ts:54` — `recordOverlayExpansionDebt` assigns `sourceKind: set.source.kind` into an overlay stats event whose schema types `sourceKind` as `outputSourceKindSchema` (`packages/stats/src/event.ts:78` — `command|fetch|file|grep` only). This is not a label-arm fix but an honest-metrics design decision: appending a `paste`-sourced overlay `TokenSaverEvent` on every `mega output chunk` fetch of a parked paste would violate the spec's own Non-Goal (no overlay stats event for pastes — adoption metrics treat every event as a proxy-tool interception, and v1 banks zero savings for pastes, so there is no debt to charge back). Early-return BEFORE the append:

```ts
    // Spec Non-Goal: no overlay stats event for parked pastes — v1 banks zero
    // savings for a paste, so there is no recovery debt to charge back, and
    // adoption metrics must not count a paste fetch as a tool interception.
    if (set.source.kind === "paste") return;
```

placed immediately after the `loadOverlayChunkSet` call (the narrowing also fixes the `sourceKind` assignment below it).

2. `fetch-chunk.ts:185` — the registry branch passes `registrySourceKind: chunkSet.source.kind` to a parameter typed `"command" | "fetch" | "file" | "grep"` (`fetch-chunk.ts:89`). Registry sets never carry `paste` at runtime (pastes are parked as OVERLAY sets only), but the shared union type now includes it — narrow before the call:

```ts
    // Registry sets never carry "paste" at runtime (pastes are overlay-only);
    // the shared source union includes it, so narrow for the 4-literal param.
    ...(chunkSet.source.kind !== "paste" ? { registrySourceKind: chunkSet.source.kind } : {}),
```

(`registrySourceKind` is already optional; an `undefined` value makes `recordExpansionDebt` skip the append at `fetch-chunk.ts:104` — consistent fail-safe.)

RED test first — add to `packages/context-gate/test/fetch-chunk-expansion-event.test.ts` (reuse its `seedOverlay` harness with `source: { kind: "paste", label: "user paste (600 lines, 24576 B)" }`):

```ts
  it("a paste-sourced overlay fetch appends NO expansion event (spec Non-Goal)", async () => {
    await seedPasteOverlay();
    const out = await fetchChunk({ storeRoot: store, chunkSetId: SET, chunkId: "0" });
    expect(out.ok).toBe(true);
    expect(readOverlayEvents({ root: store }, WK, LIVE)).toHaveLength(0);
  });
```

Run: `pnpm --filter @megasaver/context-gate exec vitest run test/fetch-chunk-expansion-event.test.ts` — the new case must FAIL before the early-return lands (it will fail as a schema/parse error or an appended event, depending on Step 3 ordering), then GREEN after.

- [ ] **Step 6: Verify package-wide**

Run: `pnpm --filter @megasaver/content-store exec vitest run && pnpm --filter @megasaver/context-gate exec vitest run && pnpm typecheck`

Expected: green. TS exhaustiveness surfaces any REMAINING `source.kind` consumer site that needs a `paste` arm — the known ones are `chunk-set.ts`, `record-output.ts` (whose `chunkSetSource` switches over `OutputSourceKind`, unchanged), and the two `fetch-chunk.ts` sites fixed in Step 5. If typecheck surfaces a renderer site, add a minimal `case "paste":` arm rendering the label — do not restructure.

- [ ] **Step 7: Commit**

```
feat(content-store): add paste source kind
```

---

### Task 2: `@megasaver/context-gate` — export `recoverableChunks`

**Files:**

- Modify: `packages/context-gate/src/index.ts`
- Create: `packages/context-gate/test/recoverable-chunks-export.test.ts`

**Interfaces:** `recoverableChunks(raw: string): ChunkSet["chunks"]` (`packages/context-gate/src/recoverable-chunks.ts:21`) — redacts, normalizes, chunks at `OVERLAY_CHUNK_LINES = 40` (`packages/context-gate/src/recovery-footer.ts:4`), and emits one empty chunk for empty input. It is currently imported internally by `read.ts` (`:24`), `run-command.ts` (`:51`), and `record-output.ts` (`:22`); `src/index.ts` has no export (verified). This is a public-API addition (changeset covered in Task 9).

- [ ] **Step 1: Write the failing public-surface test**

```ts
// packages/context-gate/test/recoverable-chunks-export.test.ts
import { describe, expect, it } from "vitest";
import { recoverableChunks } from "../src/index.js";

describe("public surface: recoverableChunks", () => {
  it("chunks 100 lines into 40-line pieces with sequential string ids", () => {
    const raw = Array.from({ length: 100 }, (_, i) => `2026-08-06T14:02:11Z line ${i + 1}`).join(
      "\n",
    );
    const chunks = recoverableChunks(raw);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toMatchObject({ id: "0", startLine: 1, endLine: 40 });
    expect(chunks[2]).toMatchObject({ id: "2", endLine: 100 });
  });

  it("redacts secrets before chunking", () => {
    const chunks = recoverableChunks("token AKIAIOSFODNN7EXAMPLE end");
    expect(chunks.map((c) => c.text).join("\n")).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });
});
```

- [ ] **Step 2: RED**

Run: `pnpm --filter @megasaver/context-gate exec vitest run test/recoverable-chunks-export.test.ts`

Expected: FAIL — `recoverableChunks` is not exported from `../src/index.js`.

- [ ] **Step 3: GREEN — export it**

In `packages/context-gate/src/index.ts` add:

```ts
export { recoverableChunks } from "./recoverable-chunks.js";
```

- [ ] **Step 4: Verify package-wide** (`dependency-direction.test.ts` and any public-export fence must stay green)

Run: `pnpm --filter @megasaver/context-gate exec vitest run`

- [ ] **Step 5: Commit**

```
feat(context-gate): export recoverableChunks
```

---

### Task 3: `@megasaver/output-filter` — `assessPaste` detector

**Files:**

- Create: `packages/output-filter/src/paste.ts`
- Modify: `packages/output-filter/src/index.ts`
- Create: `packages/output-filter/test/paste.test.ts`

**Interfaces:** `classifyOutput(input: ClassifyInput): Classification` (`packages/output-filter/src/classify.ts:114`, `ClassifyInput.text` is the only required field), `CLASSIFICATION_CONFIDENCE_FLOOR = 0.5` (`classify.ts:37`), `outputCategorySchema` (`classify.ts:7` — `vitest | typescript | diff | structured | prose | generic_shell | unknown`), `normalize` (`src/index.ts:5`). New exports: `assessPaste`, `lineHasLogSignal`, `lineIsErrorSignal`, `PasteAssessment`, and the trigger constants.

- [ ] **Step 1: Write the failing detector tests with realistic fixtures**

```ts
// packages/output-filter/test/paste.test.ts
import { describe, expect, it } from "vitest";
import { classifyOutput } from "../src/classify.js";
import {
  AIRLOCK_MIN_BYTES,
  AIRLOCK_MIN_LINES,
  assessPaste,
  lineIsErrorSignal,
} from "../src/paste.js";

function vitestLog(cases: number): string {
  const out: string[] = [" RUN  v3.2.1 /repo/packages/core", ""];
  for (let i = 0; i < cases; i += 1) {
    out.push(
      ` ❯ test/session-${i}.test.ts (3 tests | 1 failed) ${100 + i}ms`,
      `   × registry > case ${i} rejects a duplicate id`,
      `     → expected [Function] to throw error including 'duplicate'`,
      ` FAIL  test/session-${i}.test.ts > registry > case ${i}`,
      `AssertionError: expected [Function] to throw error including 'duplicate'`,
      ` ❯ test/session-${i}.test.ts:41:5`,
      "",
    );
  }
  out.push(
    ` Test Files  ${cases} failed | 3 passed (${cases + 3})`,
    `      Tests  ${cases} failed | ${cases * 2} passed (${cases * 3})`,
    "   Duration  4.12s",
  );
  return out.join("\n");
}

const tscLog = [
  ...Array.from({ length: 48 }, (_, i) =>
    [
      `src/store-${i}.ts(${40 + i},18): error TS2345: Argument of type 'string' is not`,
      "assignable to parameter of type 'number'.",
    ].join(" "),
  ),
  "Found 48 errors in 12 files.",
].join("\n");

function timestampedBuildLog(lines: number): string {
  const out: string[] = [];
  for (let i = 0; i < lines; i += 1) {
    const level = i % 7 === 0 ? "WARN" : "INFO";
    out.push(
      `2026-08-06T14:02:${String(i % 60).padStart(2, "0")}.${String(100 + (i % 900))}Z ` +
        `[${level}] step ${i}/9: compiling module chunk-${i}`,
    );
  }
  out.push("2026-08-06T14:03:00.001Z [ERROR] ELIFECYCLE Command failed with exit code 1");
  return out.join("\n");
}

const gitDiff = [
  "diff --git a/src/store.ts b/src/store.ts",
  "index 3f1c2ab..9d0e4b1 100644",
  "--- a/src/store.ts",
  "+++ b/src/store.ts",
  "@@ -40,7 +40,9 @@ export async function saveChunkSet(",
  ...Array.from({ length: 50 }, (_, i) =>
    i % 2 === 0 ? `-  const legacy${i} = readFileSync(path${i});` : `+  const next${i} = atomicRead(path${i});`,
  ),
].join("\n");

const prose = Array.from(
  { length: 45 },
  (_, i) =>
    `Paragraph ${i}: this section explains the design in plain sentences, describing the ` +
    "trade-offs we accepted and why the reviewer should not be surprised by them.",
).join("\n\n");

describe("assessPaste positives (size AND log-likeness)", () => {
  it("intercepts a 600-line vitest failure log", () => {
    const a = assessPaste(vitestLog(86)); // 86 cases * 7 lines + header/footer ≈ 607 lines
    expect(a.lines).toBeGreaterThanOrEqual(600);
    expect(a.intercept).toBe(true);
    expect(["vitest", "generic_shell", "unknown"]).toContain(a.category);
  });

  it("intercepts tsc output", () => {
    expect(assessPaste(tscLog).intercept).toBe(true);
  });

  it("intercepts a timestamped build log via the line-signal fraction", () => {
    const a = assessPaste(timestampedBuildLog(80));
    expect(a.logLineFraction).toBeGreaterThanOrEqual(0.4);
    expect(a.intercept).toBe(true);
  });

  it("intercepts a git diff", () => {
    expect(assessPaste(gitDiff).intercept).toBe(true);
  });

  it("tolerates a short prose preamble before the log", () => {
    const mixed = `why does this fail?\n\n${vitestLog(40)}`;
    expect(assessPaste(mixed).intercept).toBe(true);
  });
});

describe("assessPaste negatives", () => {
  it("never intercepts prose, even large prose", () => {
    const a = assessPaste(prose);
    expect(a.bytes).toBeGreaterThan(AIRLOCK_MIN_BYTES);
    expect(a.intercept).toBe(false);
  });

  it("39 short log lines stay under both size gates", () => {
    const small = Array.from(
      { length: 39 },
      (_, i) => `12:00:${String(i % 60).padStart(2, "0")} INFO ok ${i}`,
    ).join("\n");
    const a = assessPaste(small);
    expect(a.lines).toBeLessThan(AIRLOCK_MIN_LINES);
    expect(a.bytes).toBeLessThan(AIRLOCK_MIN_BYTES);
    expect(a.intercept).toBe(false);
  });

  it("a single-line 5 KB blob has no line-signal sample and no log category", () => {
    const blob = `payload=${"QWJjZDEyMzQ".repeat(500)}`;
    const a = assessPaste(blob);
    expect(a.bytes).toBeGreaterThan(AIRLOCK_MIN_BYTES);
    expect(a.intercept).toBe(false);
  });

  it("a short error snippet is not a paste (size gate)", () => {
    const snippet = [
      "TypeError: Cannot read properties of undefined (reading 'id')",
      "    at resolveSession (src/session.ts:88:21)",
      "    at run (src/main.ts:14:9)",
    ].join("\n");
    expect(assessPaste(snippet).intercept).toBe(false);
  });
});

describe("fraction edges and the prose veto", () => {
  const filler = "these are ordinary words describing the situation without any markers";
  const signal = (i: number) => `2026-08-06T14:02:11.532Z [ERROR] worker ${i} failed`;

  it("fraction exactly at 0.4 over 40 lines intercepts", () => {
    const lines = Array.from({ length: 40 }, (_, i) => (i < 16 ? signal(i) : `${filler} ${i}`));
    const a = assessPaste(lines.join("\n"));
    expect(a.logLineFraction).toBeGreaterThanOrEqual(0.4);
    expect(a.intercept).toBe(true);
  });

  it("fraction below 0.4 does not intercept without a confident log category", () => {
    const lines = Array.from({ length: 40 }, (_, i) => (i < 8 ? signal(i) : `${filler} ${i}`));
    const a = assessPaste(lines.join("\n"));
    expect(a.logLineFraction).toBeLessThan(0.4);
    expect(a.intercept).toBe(false);
  });

  it("an unstructured essay with stray error words passes via the no-signal path", () => {
    // Measured: this fixture classifies unknown/0 (no ATX heading -> not
    // prose) and has line-signal fraction 0 — it does NOT exercise the veto.
    const essay = Array.from(
      { length: 60 },
      (_, i) =>
        `Sentence ${i}: the word error appears here in running text, which must not make ` +
        "an essay look like a build log to the airlock.",
    ).join("\n");
    const a = assessPaste(essay);
    expect(a.intercept).toBe(false);
  });

  it("a confident prose classification vetoes even when the fraction path fires", () => {
    // Genuine veto coverage (spec LD1): ATX headings + "+ " bullets classify
    // as prose 0.85 (measured), while the "> "/"+ " lines match the shell-echo
    // line signal — fraction 0.5 >= 0.4 over 60 lines, so WITHOUT the veto
    // this fixture would intercept. Only the prose veto keeps it out.
    const proseDoc = Array.from({ length: 15 }, (_, i) =>
      [
        `## Incident retrospective, part ${i}`,
        `> the pipeline reported an error and the deploy failed on a Tuesday (${i})`,
        `+ follow up with the platform team about the error budget for service ${i}`,
        `An ordinary sentence describing what the team decided afterwards, item ${i}.`,
      ].join("\n"),
    ).join("\n");
    const c = classifyOutput({ text: proseDoc });
    expect(c.category).toBe("prose");
    expect(c.confidence).toBeGreaterThanOrEqual(0.5);
    const a = assessPaste(proseDoc);
    expect(a.logLineFraction).toBeGreaterThanOrEqual(0.4);
    expect(a.lines).toBeGreaterThanOrEqual(AIRLOCK_MIN_LINES);
    expect(a.intercept).toBe(false);
  });
});

describe("lineIsErrorSignal (digest keep filter)", () => {
  it("keeps error/fail/warn/exit-marker lines and drops neutral ones", () => {
    expect(lineIsErrorSignal(" FAIL  test/session.test.ts > registry")).toBe(true);
    expect(lineIsErrorSignal("AssertionError: expected 2 to be 3")).toBe(true);
    expect(lineIsErrorSignal("2026-08-06T14:03:00Z [WARN] deprecated option ignored")).toBe(true);
    expect(lineIsErrorSignal("ELIFECYCLE Command failed with exit code 1")).toBe(true);
    expect(lineIsErrorSignal("   Duration  4.12s")).toBe(false);
    expect(lineIsErrorSignal("compiling module chunk-12")).toBe(false);
  });
});
```

Note on the vitest fixture: `assessPaste`'s intercept must hold through EITHER a confident log category OR the fraction path — the fixture's `FAIL`/`AssertionError`/frame lines satisfy the fraction path regardless of what `classifyOutput` returns, so the category assertion is deliberately loose. MEASURED against the shipped classifier (no command context, exactly these fixtures): `vitestLog(86)` → `{vitest, 0.7}`, `tscLog` → `{typescript, 0.7}`, `gitDiff` → `{diff, 0.7}`, `prose`/`blob`/essay → `{unknown, 0}`, the veto `proseDoc` → `{prose, 0.85}` — all conform to the expectations above. If future classifier drift makes a POSITIVE fixture fail, strengthen the FIXTURE (more signal lines), never the thresholds — `AIRLOCK_MIN_LINES/BYTES/FRACTION` are spec-locked. If a NEGATIVE fixture starts intercepting (e.g. the single-line blob classifying as confident `structured`), the DETECTOR is out of spec, not the test: tighten `assessPaste` (the confident-log path may additionally require ≥ 2 lines) rather than weakening the fixture — the spec's negative list is normative.

- [ ] **Step 2: RED**

Run: `pnpm --filter @megasaver/output-filter exec vitest run test/paste.test.ts`

Expected: FAIL — module `../src/paste.js` does not exist.

- [ ] **Step 3: GREEN — implement `src/paste.ts`**

```ts
// packages/output-filter/src/paste.ts
import {
  CLASSIFICATION_CONFIDENCE_FLOOR,
  type OutputCategory,
  classifyOutput,
} from "./classify.js";
import { normalize } from "./normalize.js";

export const AIRLOCK_MIN_LINES = 40;
export const AIRLOCK_MIN_BYTES = 4096;
export const LOG_LINE_MIN_FRACTION = 0.4;
export const LOG_LINE_MIN_SAMPLE = 8;
export const SIGNAL_HEAD_CHARS = 512;

const LOG_CATEGORIES: ReadonlySet<OutputCategory> = new Set([
  "vitest",
  "typescript",
  "diff",
  "structured",
]);

// Linear by construction (wiki concepts/redos-case-output-filter): every
// pattern runs on ONE line's 512-char head slice — no `m` flag, no `^\s*`
// under `m`, bounded quantifiers only. The Task 4 growth-ratio guard fences
// this file; keep new patterns inside these constraints.
const LINE_SIGNALS: readonly RegExp[] = [
  /^\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/, // ISO timestamp
  /^\[?\d{2}:\d{2}:\d{2}(?:[.,]\d{1,6})?\]? /, // bare clock timestamp
  /\b(?:ERROR|WARN|WARNING|INFO|DEBUG|TRACE|FATAL)\b/, // level token
  /^ {0,16}at [^\n]{1,400}:\d{1,6}:\d{1,6}/, // stack frame
  /[A-Za-z0-9_.-]{1,120}\.[A-Za-z]{1,8}[(:]\d{1,6}(?:[,:]\d{1,6})?\)?/, // path:line
  /\b(?:exit code \d{1,3}|exited with|ELIFECYCLE|Command failed|npm ERR!)\b/, // exit marker
  /^(?:\$|>|\+) /, // shell echo
];

const ERROR_SIGNALS: readonly RegExp[] = [
  /\b(?:error|errors|err!|fail|failed|failing|fatal|panic|exception|traceback|assertionerror)\b/i,
  /\b(?:warn|warning)\b/i,
  /\b(?:exit code \d{1,3}|exited with|ELIFECYCLE|Command failed|npm ERR!)\b/i,
  /^ {0,64}(?:FAIL|×|✕|✖)\b/,
];

export type PasteAssessment = {
  intercept: boolean;
  category: OutputCategory;
  confidence: number;
  logLineFraction: number;
  lines: number;
  bytes: number;
};

export function lineHasLogSignal(line: string): boolean {
  const head = line.slice(0, SIGNAL_HEAD_CHARS);
  return LINE_SIGNALS.some((re) => re.test(head));
}

// Digest keep filter (spec LD4): a line qualifies for the airlock digest iff
// it carries an error/fail/warn/exit-marker signal. Lives beside the
// log-likeness signals so one guard test fences both families.
export function lineIsErrorSignal(line: string): boolean {
  const head = line.slice(0, SIGNAL_HEAD_CHARS);
  return ERROR_SIGNALS.some((re) => re.test(head));
}

export function assessPaste(text: string): PasteAssessment {
  const bytes = Buffer.byteLength(text, "utf8");
  const allLines = normalize(text).split("\n");
  const lines = allLines.length;
  const nonEmpty = allLines.filter((l) => l.trim() !== "");
  const signalCount = nonEmpty.reduce((n, l) => n + (lineHasLogSignal(l) ? 1 : 0), 0);
  const logLineFraction = nonEmpty.length === 0 ? 0 : signalCount / nonEmpty.length;
  const { category, confidence } = classifyOutput({ text });
  const facts = { category, confidence, logLineFraction, lines, bytes };
  if (lines < AIRLOCK_MIN_LINES && bytes < AIRLOCK_MIN_BYTES) {
    return { intercept: false, ...facts };
  }
  // Unconditional veto: ordinary prose is NEVER intercepted (spec LD1).
  if (category === "prose" && confidence >= CLASSIFICATION_CONFIDENCE_FLOOR) {
    return { intercept: false, ...facts };
  }
  const confidentLog =
    LOG_CATEGORIES.has(category) && confidence >= CLASSIFICATION_CONFIDENCE_FLOOR;
  const fractionHit =
    nonEmpty.length >= LOG_LINE_MIN_SAMPLE && logLineFraction >= LOG_LINE_MIN_FRACTION;
  return { intercept: confidentLog || fractionHit, ...facts };
}
```

Then add to `packages/output-filter/src/index.ts`:

```ts
export {
  AIRLOCK_MIN_BYTES,
  AIRLOCK_MIN_LINES,
  LOG_LINE_MIN_FRACTION,
  type PasteAssessment,
  assessPaste,
  lineHasLogSignal,
  lineIsErrorSignal,
} from "./paste.js";
```

- [ ] **Step 4: GREEN verification**

Run: `pnpm --filter @megasaver/output-filter exec vitest run test/paste.test.ts && pnpm --filter @megasaver/output-filter exec vitest run`

Expected: new file green, no regressions (`determinism.guard.test.ts`, `classify.test.ts` untouched).

- [ ] **Step 5: Commit**

```
feat(output-filter): assessPaste paste detector
```

---

### Task 4: growth-ratio ReDoS guard for the paste signal regexes

**Files:**

- Create: `packages/output-filter/test/paste-quadratic.test.ts`

**Interfaces:** Mirrors `packages/output-filter/test/dedupe-quadratic.test.ts` (growth RATIO, min-per-side, seeded corpus, `retry: 3`, no wall-clock ceiling — its header comment explains why a ratio and not a ceiling). Driven through `assessPaste`, the public entry (spec C2). Anchored corpus with a minimum match-count assertion per wiki `concepts/redos-guard-testing` / `redos-growth-ratio-measurement`.

- [ ] **Step 1: Write the guard (it is born green — it fences future edits, RED is demonstrated by mutation in Step 2)**

```ts
// packages/output-filter/test/paste-quadratic.test.ts
import { describe, expect, it } from "vitest";
import { assessPaste } from "../src/paste.js";

// assessPaste runs every LINE_SIGNALS pattern on every non-empty line. The
// patterns are linear by construction (512-char head slice, bounded
// quantifiers, no `m`), so doubling the corpus must roughly double the cost.
// A quadratic regression (an unbounded nested quantifier, or a pattern
// switched to whole-text `m` mode) makes the full/half ratio approach 4x.
const LINES = 160_000;
const HALF_LINES = LINES / 2;
// Same threshold family as dedupe-quadratic.test.ts: linear measures ~2x,
// quadratic ~4x; 2.75 leaves headroom on the linear side under load.
const MAX_GROWTH = 2.75;
const TRIALS = 3;

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Seeded ANCHORED corpus: every line opens with a timestamp and carries a
// level token + exit marker, so the signal patterns MATCH. A corpus the
// patterns reject would measure only the fail-fast path
// (wiki concepts/redos-growth-ratio-measurement).
const anchoredLog = (lines: number, seed: number): string => {
  const rnd = mulberry32(seed);
  const out: string[] = [];
  for (let i = 0; i < lines; i += 1) {
    out.push(
      `2026-08-06T14:02:11.532Z [ERROR] worker ${rnd().toString(16).slice(2, 10)} ` +
        "Command failed with exit code 1",
    );
  }
  return out.join("\n");
};

const sample = (raw: string): number => {
  const started = performance.now();
  assessPaste(raw);
  return performance.now() - started;
};

describe("assessPaste — per-line signal scan stays linear", () => {
  it(
    `grows under ${MAX_GROWTH}x from ${HALF_LINES / 1000}k to ${LINES / 1000}k lines`,
    { retry: 3, timeout: 120_000 },
    () => {
      const half = anchoredLog(HALF_LINES, 1);
      const full = anchoredLog(LINES, 1);

      // Minimum match-count assertion: the corpus must actually exercise the
      // match path, and it doubles as JIT warm-up for trial 0.
      for (const raw of [half, full]) {
        const a = assessPaste(raw);
        expect(a.logLineFraction).toBeGreaterThan(0.95);
        expect(a.intercept).toBe(true);
      }

      // Min per SIDE, not min of per-trial ratios: scheduler noise only ever
      // inflates a duration, so each side's minimum converges on its
      // noise-free cost (dedupe-quadratic.test.ts precedent).
      let bestHalf = Number.POSITIVE_INFINITY;
      let bestFull = Number.POSITIVE_INFINITY;
      for (let trial = 0; trial < TRIALS; trial += 1) {
        bestHalf = Math.min(bestHalf, sample(half));
        bestFull = Math.min(bestFull, sample(full));
      }

      expect(bestFull / bestHalf).toBeLessThan(MAX_GROWTH);
    },
  );
});
```

- [ ] **Step 2: Prove the guard bites (throwaway mutation, do not commit)**

Temporarily replace the stack-frame pattern in `src/paste.ts` with a superlinear form applied to the WHOLE text (e.g. run `/^ +at .+:\d+:\d+/m` against `text` per line instead of the head slice) OR remove the `.slice(0, SIGNAL_HEAD_CHARS)` and feed the corpus 20 KB single lines; run the guard and record the red ratio in the PR description. Revert the mutation.

Run: `pnpm --filter @megasaver/output-filter exec vitest run test/paste-quadratic.test.ts`

Expected: guard green on the real implementation; red under the mutation.

- [ ] **Step 3: Commit**

```
test(output-filter): paste signal growth guard
```

---

### Task 5: CLI airlock core — config, park, digest (`apps/cli/src/hooks/airlock.ts`)

**Files:**

- Create: `apps/cli/src/hooks/airlock.ts`
- Create: `apps/cli/test/hooks/airlock.test.ts`

**Interfaces:** `saveOverlayChunkSet({ storeRoot, chunkSet })` (`packages/content-store/src/store.ts:169` — schema-parses, `atomicWriteFile`s to `overlayChunkSetPath` = `content/<workspaceKey>/<liveSessionId>/<chunkSetId>.json`, `paths.ts:33`), `recoverableChunks` (Task 2 export), `assessPaste`/`lineIsErrorSignal` (Task 3), `redact` returning `{ redacted, count }` (`packages/policy/src/redact.ts:44`), `encodeWorkspaceKey` (`@megasaver/shared`, used by `intent-run.ts:14,53`), `SAFE_SEGMENT` mirrored from `apps/cli/src/hooks/intent-run.ts:35`, atomic tmp+rename + 0o600/0o700 posture mirrored from `intent-run.ts:102-116`. Digest wording mirrors `buildRecoveryFooter` (`packages/context-gate/src/recovery-footer.ts:37-51`) minus any savings figures.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/cli/test/hooks/airlock.test.ts
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { overlayChunkSetSchema } from "@megasaver/content-store";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  airlockConfigPath,
  buildAirlockDigest,
  processAirlockPayload,
  readAirlockEnabled,
  writeAirlockEnabled,
} from "../../src/hooks/airlock.js";

let storeRoot: string;
const cwd = "/some/project";
const wk = encodeWorkspaceKey(cwd);
const sid = "airlock-session-1";

function vitestLog(cases: number): string {
  const out: string[] = [" RUN  v3.2.1 /repo/packages/core", ""];
  for (let i = 0; i < cases; i += 1) {
    out.push(
      ` FAIL  test/session-${i}.test.ts > registry > case ${i}`,
      `AssertionError: expected [Function] to throw error including 'duplicate'`,
      ` ❯ test/session-${i}.test.ts:41:5`,
      `   × registry > case ${i} rejects a duplicate id`,
      `2026-08-06T14:02:${String(i % 60).padStart(2, "0")}.100Z [INFO] retrying case ${i}`,
      "",
    );
  }
  out.push(" Test Files  100 failed | 3 passed (103)", "   Duration  4.12s");
  return out.join("\n");
}

const pastePayload = (prompt: string) => ({ prompt, cwd, session_id: sid });

beforeEach(() => {
  storeRoot = join(mkdtempSync(join(tmpdir(), "airlock-")), "megasaver");
});
afterEach(() => {
  rmSync(join(storeRoot, ".."), { recursive: true, force: true });
});

describe("processAirlockPayload park + digest round-trip", () => {
  it("parks a 600-line vitest log and returns a <=2 KB envelope", async () => {
    const log = vitestLog(100); // 100 * 6 + 4 = 604 lines
    const envelope = await processAirlockPayload(storeRoot, pastePayload(log));
    expect(envelope).toBeDefined();
    expect(Buffer.byteLength(envelope as string, "utf8")).toBeLessThanOrEqual(2048);

    const parsed = JSON.parse(envelope as string) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    const digest = parsed.hookSpecificOutput.additionalContext;
    expect(digest).toContain("[airlocked]");
    expect(digest).toMatch(/mega output chunk "cs-[0-9a-f]{32}"/);
    expect(digest).not.toMatch(/\d+(?:\.\d+)?%/); // no savings claim (spec LD4)

    const dir = join(storeRoot, "content", wk, sid);
    const files = readFileSync(
      join(dir, `${/cs-[0-9a-f]{32}/.exec(digest)?.[0]}.json`),
      "utf8",
    );
    const chunkSet = overlayChunkSetSchema.parse(JSON.parse(files));
    expect(chunkSet.source).toMatchObject({ kind: "paste" });
    expect(chunkSet.source.kind === "paste" && chunkSet.source.label).toContain("user paste");
    expect(chunkSet.chunks.length).toBeGreaterThan(10); // ~604 lines / 40
    expect(chunkSet.chunks[0]?.text).toContain("RUN  v3.2.1");
  });

  it("is silent for prose and short prompts (the common path)", async () => {
    expect(await processAirlockPayload(storeRoot, pastePayload("fix the parser please"))).toBe(
      undefined,
    );
    const prose = Array.from({ length: 50 }, (_, i) => `Plain sentence number ${i}.`).join("\n\n");
    expect(await processAirlockPayload(storeRoot, pastePayload(prose))).toBe(undefined);
    expect(existsSync(join(storeRoot, "content"))).toBe(false);
  });

  it("re-pasting the same blob overwrites its own set (content-derived id)", async () => {
    const log = vitestLog(50);
    await processAirlockPayload(storeRoot, pastePayload(log));
    await processAirlockPayload(storeRoot, pastePayload(log));
    const dir = join(storeRoot, "content", wk, sid);
    const sets = readdirSync(dir).filter((f) => f.startsWith("cs-") && f.endsWith(".json"));
    expect(sets).toHaveLength(1); // sha256-derived id: same content, same file
  });
});

describe("bypass, kill-switch, safety rails", () => {
  it("skips a !raw-prefixed paste", async () => {
    expect(
      await processAirlockPayload(storeRoot, pastePayload(`!raw\n${vitestLog(50)}`)),
    ).toBe(undefined);
  });

  it("does nothing when airlock.json disables it", async () => {
    writeAirlockEnabled(storeRoot, false);
    expect(await processAirlockPayload(storeRoot, pastePayload(vitestLog(50)))).toBe(undefined);
  });

  it("a malformed config file reads as DISABLED; a missing one as enabled", () => {
    expect(readAirlockEnabled(storeRoot)).toBe(true);
    mkdirSync(storeRoot, { recursive: true });
    writeFileSync(airlockConfigPath(storeRoot), "{ not json", "utf8");
    expect(readAirlockEnabled(storeRoot)).toBe(false);
  });

  it("rejects a hostile session_id (no park, no digest)", async () => {
    const payload = { prompt: vitestLog(50), cwd, session_id: "../../evil" };
    expect(await processAirlockPayload(storeRoot, payload)).toBe(undefined);
  });

  it("rejects a payload without session_id (park needs the overlay key)", async () => {
    expect(await processAirlockPayload(storeRoot, { prompt: vitestLog(50), cwd })).toBe(undefined);
  });

  it("park failure yields NO digest (reversibility invariant)", async () => {
    const thrower = async () => {
      throw new Error("disk full");
    };
    await expect(
      processAirlockPayload(storeRoot, pastePayload(vitestLog(50)), { save: thrower }),
    ).rejects.toThrow("disk full");
  });

  it("secrets never persist un-redacted, in chunks or digest", async () => {
    const secret = "AKIAIOSFODNN7EXAMPLE";
    const log = `${vitestLog(50)}\n2026-08-06T14:05:00Z [ERROR] auth failed for key ${secret}`;
    const envelope = await processAirlockPayload(storeRoot, pastePayload(log));
    expect(envelope).toBeDefined();
    expect(envelope).not.toContain(secret);
    const dir = join(storeRoot, "content", wk, sid);
    const stored = readFileSync(
      join(dir, `${/cs-[0-9a-f]{32}/.exec(envelope as string)?.[0]}.json`),
      "utf8",
    );
    expect(stored).not.toContain(secret);
    expect(stored).toContain("AKIA[REDACTED]");
  });

  // Store files: NTFS ignores POSIX mode bits (intent-run.test.ts precedent).
  it.skipIf(process.platform === "win32")("config file is owner-only", () => {
    writeAirlockEnabled(storeRoot, true);
    expect(statSync(airlockConfigPath(storeRoot)).mode & 0o777).toBe(0o600);
  });
});

describe("buildAirlockDigest budget", () => {
  it("keeps matching lines in original order up to 1536 B, then counts the rest", () => {
    const redactedText = Array.from(
      { length: 60 },
      (_, i) => ` FAIL  test/case-${i}.test.ts > assertion ${i} failed with exit code 1`,
    ).join("\n");
    const digest = buildAirlockDigest({
      redactedText,
      assessment: {
        intercept: true,
        category: "vitest",
        confidence: 0.9,
        logLineFraction: 1,
        lines: 60,
        bytes: Buffer.byteLength(redactedText, "utf8"),
      },
      chunkSetId: "cs-0123456789abcdef0123456789abcdef",
      chunkCount: 2,
    });
    expect(digest).toMatch(/\+\d+ more matching lines in store/);
    const idx = (n: number) => digest.indexOf(`case-${n}.test.ts`);
    expect(idx(0)).toBeGreaterThan(-1);
    expect(idx(1)).toBeGreaterThan(idx(0)); // original order preserved
  });

  it("clamps kept lines to 200 chars", () => {
    const long = ` FAIL  ${"x".repeat(400)} failed`;
    const digest = buildAirlockDigest({
      redactedText: long,
      assessment: {
        intercept: true,
        category: "generic_shell",
        confidence: 0.2,
        logLineFraction: 1,
        lines: 1,
        bytes: 420,
      },
      chunkSetId: "cs-0123456789abcdef0123456789abcdef",
      chunkCount: 1,
    });
    for (const line of digest.split("\n").slice(1)) {
      expect(line.length).toBeLessThanOrEqual(200);
    }
  });
});
```

- [ ] **Step 2: RED**

Run: `pnpm --filter @megasaver/cli exec vitest run test/hooks/airlock.test.ts`

Expected: FAIL — `../../src/hooks/airlock.js` does not exist.

- [ ] **Step 3: GREEN — implement `apps/cli/src/hooks/airlock.ts`**

```ts
// apps/cli/src/hooks/airlock.ts
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type OverlayChunkSet, saveOverlayChunkSet } from "@megasaver/content-store";
import { recoverableChunks } from "@megasaver/context-gate";
import {
  type PasteAssessment,
  assessPaste,
  lineIsErrorSignal,
  normalize,
} from "@megasaver/output-filter";
import { redact } from "@megasaver/policy";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { z } from "zod";

export const MAX_AIRLOCK_HOOK_STDIN_BYTES = 1024 * 1024; // 4x intent-run's 256 KB: large pastes are the subject
export const AIRLOCK_DIGEST_KEEP_BUDGET = 1536;
export const AIRLOCK_DIGEST_LINE_CLAMP = 200;
// Single anchored test per prompt, no `m` flag — not a per-line scan.
export const RAW_BYPASS = /^\s*!raw\b/;

// Mirrors intent-run.ts SAFE_SEGMENT: session_id becomes a filesystem segment.
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

// session_id is REQUIRED here (unlike intent-run): the park key is
// (workspaceKey, session_id); without a safe id there is nowhere to park,
// and digest-without-park is forbidden.
const payloadSchema = z.object({
  prompt: z.string(),
  cwd: z.string().min(1),
  session_id: z.string().min(1),
});

const airlockConfigSchema = z.object({ enabled: z.boolean() }).strict();

export function airlockConfigPath(storeRoot: string): string {
  return join(storeRoot, "airlock.json");
}

// Missing file = enabled (installing the hook is the opt-in). Malformed or
// unreadable = DISABLED — fail toward doing nothing (spec error handling).
export function readAirlockEnabled(storeRoot: string): boolean {
  const path = airlockConfigPath(storeRoot);
  if (!existsSync(path)) return true;
  try {
    const parsed = airlockConfigSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.success ? parsed.data.enabled : false;
  } catch {
    return false;
  }
}

// Atomic tmp+rename, owner-only — intent-run writeIntentAt posture.
export function writeAirlockEnabled(storeRoot: string, enabled: boolean): void {
  mkdirSync(storeRoot, { recursive: true, mode: 0o700 });
  const path = airlockConfigPath(storeRoot);
  const tmp = join(storeRoot, `.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, `${JSON.stringify({ enabled })}\n`, { mode: 0o600 });
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

export function buildAirlockDigest(input: {
  redactedText: string;
  assessment: PasteAssessment;
  chunkSetId: string;
  chunkCount: number;
}): string {
  const a = input.assessment;
  const n = input.chunkCount;
  // Fetch-handle wording mirrors buildRecoveryFooter (context-gate
  // recovery-footer.ts:43-46). No savings percentage — v1 saves zero tokens.
  const fetch =
    n > 1
      ? `stored in ${n} chunks of ~40 lines each; fetch any with: mega output chunk "${input.chunkSetId}" "<i>" (i = 0..${n - 1})`
      : `run: mega output chunk "${input.chunkSetId}" "0"`;
  const header =
    `[airlocked] user paste parked (${a.bytes} B, ${a.lines} lines, ${a.category}). ` +
    `Full text recoverable — ${fetch} (or MCP proxy_expand_chunk if connected).`;
  const kept: string[] = [];
  let used = 0;
  let skipped = 0;
  for (const line of normalize(input.redactedText).split("\n")) {
    if (!lineIsErrorSignal(line)) continue;
    const clamped = line.slice(0, AIRLOCK_DIGEST_LINE_CLAMP);
    const cost = Buffer.byteLength(clamped, "utf8") + 1;
    if (used + cost > AIRLOCK_DIGEST_KEEP_BUDGET) {
      skipped += 1;
      continue;
    }
    kept.push(clamped);
    used += cost;
  }
  const tail = skipped > 0 ? `\n+${skipped} more matching lines in store` : "";
  return kept.length === 0 ? header : `${header}\n${kept.join("\n")}${tail}`;
}

export type AirlockDeps = {
  save?: (input: { storeRoot: string; chunkSet: OverlayChunkSet }) => Promise<void>;
  now?: () => string;
};

// Decision pipeline in spec Architecture order: config -> bypass -> assess ->
// redact -> park -> digest. Returns the envelope string, or undefined for
// silence (the common path). Throws are the caller's fail-open problem
// (airlock-run.ts) — this function never prints.
export async function processAirlockPayload(
  storeRoot: string,
  payload: unknown,
  deps: AirlockDeps = {},
): Promise<string | undefined> {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return undefined;
  const { prompt, cwd, session_id: sessionId } = parsed.data;
  if (!SAFE_SEGMENT.test(sessionId)) return undefined;
  if (!readAirlockEnabled(storeRoot)) return undefined;
  if (RAW_BYPASS.test(prompt)) return undefined;
  const assessment = assessPaste(prompt);
  if (!assessment.intercept) return undefined;

  const { redacted } = redact(prompt);
  const chunkSetId = `cs-${createHash("sha256").update(redacted, "utf8").digest("hex").slice(0, 32)}`;
  const chunkSet: OverlayChunkSet = {
    chunkSetId,
    liveSessionId: sessionId,
    workspaceKey: encodeWorkspaceKey(cwd),
    createdAt: (deps.now ?? (() => new Date().toISOString()))(),
    source: {
      kind: "paste",
      label: `user paste (${assessment.lines} lines, ${assessment.bytes} B)`,
    },
    rawBytes: assessment.bytes,
    redacted: true,
    chunks: recoverableChunks(redacted),
  };
  // Park FIRST. If this throws, no digest exists anywhere (digest => parked).
  await (deps.save ?? saveOverlayChunkSet)({ storeRoot, chunkSet });
  const digest = buildAirlockDigest({
    redactedText: redacted,
    assessment,
    chunkSetId,
    chunkCount: chunkSet.chunks.length,
  });
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: digest },
  });
}
```

- [ ] **Step 4: GREEN verification**

Run: `pnpm --filter @megasaver/cli exec vitest run test/hooks/airlock.test.ts`

Expected: all green. If the 2048-byte envelope assertion fails because JSON escaping of the kept lines inflates past the budget, reduce `AIRLOCK_DIGEST_KEEP_BUDGET`'s effective use by measuring the escaped cost (`Buffer.byteLength(JSON.stringify(clamped))`) in the budget loop — the ≤2 KB envelope is the spec success criterion; 1536 is the raw-byte budget serving it.

- [ ] **Step 5: Commit**

```
feat(cli): airlock park and digest core
```

---

### Task 6: fail-open process wrapper + `mega hooks airlock`

**Files:**

- Create: `apps/cli/src/hooks/airlock-run.ts`
- Create: `apps/cli/src/commands/hooks/airlock.ts`
- Modify: `apps/cli/src/commands/hooks/index.ts` (import, re-export, `subCommands.airlock`)
- Create: `apps/cli/test/hooks/airlock-run.test.ts`

**Interfaces:** stdin reader shape from `intent-run.ts:139-156` with the 1 MiB cap; store resolution via `readStoreEnv`/`resolveStorePath` (`apps/cli/src/store.ts:52,17`); Citty command mirrors `hooksIntentCommand` (`apps/cli/src/commands/hooks/intent.ts`); registration mirrors `hooksCommand.subCommands` (`apps/cli/src/commands/hooks/index.ts`).

- [ ] **Step 1: Write the failing wrapper tests (stdin mock pattern from `apps/cli/test/hooks/intent-run.test.ts:18-37`)**

```ts
// apps/cli/test/hooks/airlock-run.test.ts
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hookState = vi.hoisted(() => ({ stdin: "", stdinOffset: 0, saveShouldThrow: false }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readSync: ((fd: number, buffer: Uint8Array, offset: number, length: number) => {
      if (fd !== 0) return actual.readSync(fd, buffer, offset, length, null);
      const source = Buffer.from(hookState.stdin);
      const chunk = source.subarray(hookState.stdinOffset, hookState.stdinOffset + length);
      chunk.copy(buffer, offset);
      hookState.stdinOffset += chunk.length;
      return chunk.length;
    }) as typeof actual.readSync,
  };
});

vi.mock("@megasaver/content-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@megasaver/content-store")>();
  return {
    ...actual,
    saveOverlayChunkSet: (async (input: Parameters<typeof actual.saveOverlayChunkSet>[0]) => {
      if (hookState.saveShouldThrow) throw new Error("injected park failure");
      return actual.saveOverlayChunkSet(input);
    }) as typeof actual.saveOverlayChunkSet,
  };
});

const { runAirlockHookFromProcess } = await import("../../src/hooks/airlock-run.js");
const { hooksAirlockCommand } = await import("../../src/commands/hooks/airlock.js");

let storeParent: string;
let storeRoot: string;
const cwd = "/some/project";
const wk = encodeWorkspaceKey(cwd);
const originalExitCode = process.exitCode;
// biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
const originalXdgDataHome = process.env["XDG_DATA_HOME"];
let stdoutSpy: ReturnType<typeof vi.spyOn>;

function bigVitestLog(): string {
  return Array.from(
    { length: 600 },
    (_, i) => ` FAIL  test/case-${i}.test.ts > assertion ${i} (exit code 1)`,
  ).join("\n");
}

beforeEach(() => {
  storeParent = mkdtempSync(join(tmpdir(), "airlock-run-"));
  storeRoot = join(storeParent, "megasaver");
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  process.env["XDG_DATA_HOME"] = storeParent;
  process.exitCode = undefined;
  hookState.stdin = "";
  hookState.stdinOffset = 0;
  hookState.saveShouldThrow = false;
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});
afterEach(() => {
  rmSync(storeParent, { recursive: true, force: true });
  if (originalXdgDataHome === undefined) Reflect.deleteProperty(process.env, "XDG_DATA_HOME");
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  else process.env["XDG_DATA_HOME"] = originalXdgDataHome;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

describe("runAirlockHookFromProcess", () => {
  it("parks a paste payload and prints exactly one envelope line", async () => {
    hookState.stdin = JSON.stringify({ prompt: bigVitestLog(), cwd, session_id: "run-1" });
    await runAirlockHookFromProcess();
    expect(process.exitCode).toBe(0);
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const written = String(stdoutSpy.mock.calls[0]?.[0]);
    expect(JSON.parse(written)).toMatchObject({
      hookSpecificOutput: { hookEventName: "UserPromptSubmit" },
    });
    const files = readdirSync(join(storeRoot, "content", wk, "run-1"));
    expect(files.some((f) => f.startsWith("cs-"))).toBe(true);
  });

  it("stays silent on prose (exit 0, no stdout, no store writes)", async () => {
    hookState.stdin = JSON.stringify({ prompt: "please fix the parser", cwd, session_id: "run-2" });
    await runAirlockHookFromProcess();
    expect(process.exitCode).toBe(0);
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(existsSync(join(storeRoot, "content"))).toBe(false);
  });

  it("rejects stdin over 1 MiB before parsing (fail open)", async () => {
    hookState.stdin = JSON.stringify({
      prompt: "x".repeat(1024 * 1024),
      cwd,
      session_id: "run-3",
    });
    await runAirlockHookFromProcess();
    expect(process.exitCode).toBe(0);
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("swallows malformed stdin (exit 0, silence)", async () => {
    hookState.stdin = "{ not json";
    await runAirlockHookFromProcess();
    expect(process.exitCode).toBe(0);
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("park failure exits 0 with NO stdout (digest => parked)", async () => {
    hookState.saveShouldThrow = true;
    hookState.stdin = JSON.stringify({ prompt: bigVitestLog(), cwd, session_id: "run-4" });
    await runAirlockHookFromProcess();
    expect(process.exitCode).toBe(0);
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("forwards the installed --store value", async () => {
    const configured = join(storeParent, "custom-store");
    hookState.stdin = JSON.stringify({ prompt: bigVitestLog(), cwd, session_id: "run-5" });
    await runCommand(hooksAirlockCommand, { rawArgs: ["--store", configured] });
    expect(readdirSync(join(configured, "content", wk, "run-5")).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: RED**

Run: `pnpm --filter @megasaver/cli exec vitest run test/hooks/airlock-run.test.ts`

Expected: FAIL — modules do not exist.

- [ ] **Step 3: GREEN — wrapper, command, registration**

```ts
// apps/cli/src/hooks/airlock-run.ts
import { readSync } from "node:fs";
import { readStoreEnv, resolveStorePath } from "../store.js";
import { MAX_AIRLOCK_HOOK_STDIN_BYTES, processAirlockPayload } from "./airlock.js";

// intent-run.ts readStdinSync shape with the airlock's 1 MiB cap: over-cap
// returns undefined and the hook does nothing (fail open, spec LD2).
function readStdinSync(): string | undefined {
  try {
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= MAX_AIRLOCK_HOOK_STDIN_BYTES) {
      const capacity = Math.min(65536, MAX_AIRLOCK_HOOK_STDIN_BYTES - total + 1);
      const chunk = Buffer.allocUnsafe(capacity);
      const read = readSync(0, chunk, 0, capacity, null);
      if (read === 0) return Buffer.concat(chunks, total).toString("utf8");
      total += read;
      if (total > MAX_AIRLOCK_HOOK_STDIN_BYTES) return undefined;
      chunks.push(chunk.subarray(0, read));
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// ALWAYS exits 0; on any failure writes nothing so the prompt is never
// blocked (runIntentHookFromProcess / runSaverHookFromProcess posture).
export async function runAirlockHookFromProcess(storeFlag?: string): Promise<void> {
  process.exitCode = 0;
  try {
    const input = readStdinSync();
    if (input === undefined) return;
    const raw = input.trim();
    if (raw === "") return;
    const payload: unknown = JSON.parse(raw);
    const storeRoot = resolveStorePath(readStoreEnv(storeFlag));
    const envelope = await processAirlockPayload(storeRoot, payload);
    if (envelope !== undefined) process.stdout.write(`${envelope}\n`);
  } catch {
    // best-effort; never block the prompt.
  }
}
```

```ts
// apps/cli/src/commands/hooks/airlock.ts
import { defineCommand } from "citty";
import { runAirlockHookFromProcess } from "../../hooks/airlock-run.js";

// The command Claude Code's second UserPromptSubmit hook invokes. Parks large
// log-like pastes and emits an additionalContext digest. SAFETY: ALWAYS exits
// 0; writes nothing on any error. Wired by `mega hooks install`.
export const hooksAirlockCommand = defineCommand({
  meta: {
    name: "airlock",
    description:
      "Internal: park a large pasted log as a recoverable chunk set (stdin payload).",
  },
  args: {
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    await runAirlockHookFromProcess(typeof args.store === "string" ? args.store : undefined);
  },
});
```

In `apps/cli/src/commands/hooks/index.ts`: add the import, `export { hooksAirlockCommand } from "./airlock.js";`, and `airlock: hooksAirlockCommand` in `hooksCommand.subCommands`.

- [ ] **Step 4: GREEN verification + no-regression**

Run: `pnpm --filter @megasaver/cli exec vitest run test/hooks/airlock-run.test.ts test/hooks/intent-run.test.ts`

- [ ] **Step 5: Commit**

```
feat(cli): mega hooks airlock entrypoint
```

---

### Task 7: `mega airlock on|off|status` kill-switch

**Files:**

- Create: `apps/cli/src/commands/airlock.ts`
- Modify: `apps/cli/src/main.ts` (register `airlock: airlockCommand` in `subCommands`, ~line 60)
- Create: `apps/cli/test/airlock.test.ts` (flat, per `wiki/workflows/cli-test-pattern`)

**Interfaces:** `readAirlockEnabled`/`writeAirlockEnabled` from Task 5; injected-io handler per `wiki/workflows/cli-test-pattern.md` — inner `runAirlock(input): Promise<0 | 1>` with `stdout`/`stderr` callbacks, thin Citty adapters.

- [ ] **Step 1: Write the failing test**

```ts
// apps/cli/test/airlock.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAirlock } from "../src/commands/airlock.js";
import { airlockConfigPath } from "../src/hooks/airlock.js";

let storeRoot: string;
let out: string[];
let err: string[];

const io = () => ({
  storeFlag: storeRoot,
  stdout: (line: string) => out.push(line),
  stderr: (line: string) => err.push(line),
});

beforeEach(() => {
  storeRoot = join(mkdtempSync(join(tmpdir(), "airlock-cmd-")), "megasaver");
  out = [];
  err = [];
});
afterEach(() => {
  rmSync(join(storeRoot, ".."), { recursive: true, force: true });
});

describe("mega airlock", () => {
  it("status reports enabled when no config exists (install is the opt-in)", async () => {
    expect(await runAirlock({ action: "status", ...io() })).toBe(0);
    expect(out).toEqual(["airlock: enabled"]);
  });

  it("off -> status -> on round-trips through the config file", async () => {
    expect(await runAirlock({ action: "off", ...io() })).toBe(0);
    expect(await runAirlock({ action: "status", ...io() })).toBe(0);
    expect(out).toContain("airlock: disabled");
    out.length = 0;
    expect(await runAirlock({ action: "on", ...io() })).toBe(0);
    expect(await runAirlock({ action: "status", ...io() })).toBe(0);
    expect(out).toContain("airlock: enabled");
    expect(err).toEqual([]);
  });

  it("status reports disabled for a malformed config (fail toward doing nothing)", async () => {
    mkdirSync(storeRoot, { recursive: true });
    writeFileSync(airlockConfigPath(storeRoot), "{ not json", "utf8");
    expect(await runAirlock({ action: "status", ...io() })).toBe(0);
    expect(out).toEqual(["airlock: disabled"]);
  });
});
```

- [ ] **Step 2: RED**

Run: `pnpm --filter @megasaver/cli exec vitest run test/airlock.test.ts`

- [ ] **Step 3: GREEN — implement and register**

```ts
// apps/cli/src/commands/airlock.ts
import { defineCommand } from "citty";
import { readAirlockEnabled, writeAirlockEnabled } from "../hooks/airlock.js";
import { readStoreEnv, resolveStorePath } from "../store.js";

export type RunAirlockInput = {
  action: "on" | "off" | "status";
  storeFlag: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runAirlock(input: RunAirlockInput): Promise<0 | 1> {
  try {
    const storeRoot = resolveStorePath(readStoreEnv(input.storeFlag));
    if (input.action === "status") {
      input.stdout(readAirlockEnabled(storeRoot) ? "airlock: enabled" : "airlock: disabled");
      return 0;
    }
    writeAirlockEnabled(storeRoot, input.action === "on");
    input.stdout(`airlock: ${input.action === "on" ? "enabled" : "disabled"}`);
    return 0;
  } catch (error) {
    input.stderr(`airlock: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

function subcommand(action: "on" | "off" | "status", description: string) {
  return defineCommand({
    meta: { name: action, description },
    args: { store: { type: "string", description: "Override store directory." } },
    async run({ args }) {
      const code = await runAirlock({
        action,
        storeFlag: typeof args.store === "string" ? args.store : undefined,
        stdout: (line) => console.log(line),
        stderr: (line) => console.error(line),
      });
      if (code !== 0) process.exitCode = code;
    },
  });
}

export const airlockCommand = defineCommand({
  meta: { name: "airlock", description: "Paste Airlock kill-switch (on|off|status)." },
  subCommands: {
    on: subcommand("on", "Enable paste interception."),
    off: subcommand("off", "Disable paste interception (hook stays installed, does nothing)."),
    status: subcommand("status", "Report whether the airlock is enabled."),
  },
});
```

Register in `apps/cli/src/main.ts` `subCommands` (alphabetical slot near `alerts`/`audit`): `airlock: airlockCommand` with the matching import.

- [ ] **Step 4: GREEN verification**

Run: `pnpm --filter @megasaver/cli exec vitest run test/airlock.test.ts`

- [ ] **Step 5: Commit**

```
feat(cli): mega airlock kill-switch
```

---

### Task 8: connector wiring — install/uninstall/status

**Files:**

- Modify: `packages/connectors/claude-code/src/hook-settings.ts`
- Modify: `apps/cli/src/commands/hooks/install.ts` (`airlock` boolean arg + pass-through, mirroring `warmup` at lines 18-20, 65-67, 119-123, 149-151)
- Create: `packages/connectors/claude-code/test/hook-settings-airlock.test.ts`

**Interfaces:** `INTENT_HOOK_COMMAND` (`hook-settings.ts:16`), `buildHookCommand` union (`:34`), `addUserPromptSubmitHook`/`removeUserPromptSubmitHook` (`:385,405`), `installClaudeCodeHook` (`:540`), `uninstallClaudeCodeHook` (`:568`), `readClaudeCodeHookStatus` (`:604`), `InstallClaudeCodeHookInput` (`:524`), `ClaudeCodeHookStatus` (`:595`). Two UserPromptSubmit entries coexist keyed by subcommand (`entryMatchesSubcommand`, `:220`; `subcommandOf` -> `ownedHookCommandSubcommand`, `:171` — parses any `mega hooks <sub>` form, so no whitelist to extend). `timeoutFor` (`:201`) gives non-saver hooks 10 s — sufficient for ≤1 MiB in-process work; do not special-case.

- [ ] **Step 1: Write the failing connector tests**

```ts
// packages/connectors/claude-code/test/hook-settings-airlock.test.ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AIRLOCK_HOOK_COMMAND,
  buildHookCommand,
  installClaudeCodeHook,
  readClaudeCodeHookStatus,
  uninstallClaudeCodeHook,
} from "../src/hook-settings.js";

let dir: string;
let settingsPath: string;

type UpsEntry = { hooks?: { command?: string }[] };
const upsCommands = (path: string): string[] => {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as {
    hooks?: { UserPromptSubmit?: UpsEntry[] };
  };
  return (parsed.hooks?.UserPromptSubmit ?? []).flatMap((e) =>
    (e.hooks ?? []).map((h) => h.command ?? ""),
  );
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "airlock-settings-"));
  settingsPath = join(dir, "settings.json");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("airlock hook wiring", () => {
  it("buildHookCommand supports the airlock subcommand with a baked store", () => {
    expect(buildHookCommand("airlock")).toBe("mega hooks airlock");
    expect(AIRLOCK_HOOK_COMMAND).toBe("mega hooks airlock");
    expect(buildHookCommand("airlock", { storeRoot: "/tmp/store" })).toBe(
      "mega hooks airlock --store /tmp/store",
    );
  });

  it("install writes intent AND airlock as separate UserPromptSubmit entries", () => {
    const result = installClaudeCodeHook({ settingsPath });
    expect(result.changed).toBe(true);
    const commands = upsCommands(settingsPath);
    expect(commands).toContain("mega hooks intent");
    expect(commands).toContain("mega hooks airlock");
  });

  it("install is idempotent and { airlock: false } removes only the airlock entry", () => {
    installClaudeCodeHook({ settingsPath });
    expect(installClaudeCodeHook({ settingsPath }).changed).toBe(false);
    installClaudeCodeHook({ settingsPath, airlock: false });
    const commands = upsCommands(settingsPath);
    expect(commands).toContain("mega hooks intent");
    expect(commands).not.toContain("mega hooks airlock");
  });

  it("uninstall removes the airlock entry", () => {
    installClaudeCodeHook({ settingsPath });
    uninstallClaudeCodeHook({ settingsPath });
    expect(upsCommands(settingsPath)).not.toContain("mega hooks airlock");
  });

  it("status reports airlockInstalled", () => {
    expect(readClaudeCodeHookStatus({ settingsPath }).airlockInstalled).toBe(false);
    installClaudeCodeHook({ settingsPath });
    expect(readClaudeCodeHookStatus({ settingsPath }).airlockInstalled).toBe(true);
    installClaudeCodeHook({ settingsPath, airlock: false });
    expect(readClaudeCodeHookStatus({ settingsPath }).airlockInstalled).toBe(false);
  });
});
```

- [ ] **Step 2: RED**

Run: `pnpm --filter @megasaver/connector-claude-code exec vitest run test/hook-settings-airlock.test.ts`

- [ ] **Step 3: GREEN — wire the connector**

In `packages/connectors/claude-code/src/hook-settings.ts`:

1. Beside `INTENT_HOOK_COMMAND` (line 16): `export const AIRLOCK_HOOK_COMMAND = "mega hooks airlock";`
2. `buildHookCommand` union (line 35): add `| "airlock"`.
3. `InstallClaudeCodeHookInput` (line ~524): add `airlock?: boolean;`.
4. `installClaudeCodeHook` (line 540), after the intent `addUserPromptSubmitHook` line:

```ts
  const airlockCommand = buildHookCommand("airlock", cfg);
  next =
    input.airlock === false
      ? removeUserPromptSubmitHook(next, airlockCommand)
      : addUserPromptSubmitHook(next, airlockCommand);
```

5. `uninstallClaudeCodeHook` (line 568): add `hasUserPromptSubmitHook(existing, AIRLOCK_HOOK_COMMAND)` to the no-op check and `next = removeUserPromptSubmitHook(next, AIRLOCK_HOOK_COMMAND);` to the removal chain.
6. `ClaudeCodeHookStatus` (line ~595): add `airlockInstalled: boolean;`; compute it in `readClaudeCodeHookStatus` via `hasUserPromptSubmitHook(settings, AIRLOCK_HOOK_COMMAND)` and add `airlockInstalled: false` to the unreadable-settings fallback object. Leave `connected` as `pre && post && intent` — the airlock is optional, like warmup/guard.
7. Export `AIRLOCK_HOOK_COMMAND` from `packages/connectors/claude-code/src/index.ts` beside the other hook constants (check `public-export.test.ts` — if it fences the export list, extend it).

In `apps/cli/src/commands/hooks/install.ts`, mirror the `warmup` flag exactly (citty `--no-<name>` negation comment at lines 116-118 applies):

```ts
    airlock: {
      type: "boolean",
      description: "Install the Paste Airlock UserPromptSubmit hook (--no-airlock to skip).",
    },
```

with `airlock?: boolean` on `RunHooksInstallInput`, `...(input.airlock !== undefined ? { airlock: input.airlock } : {})` in the install call, and `airlock: args.airlock !== false` at the adapter.

CLI test additions (verified against the suites: `status.test.ts` asserts `payload.hookInstallation` via `toMatchObject` — partial match, `apps/cli/test/hooks/status.test.ts:137,181` — so the new `airlockInstalled` field breaks nothing by itself; the cases below are the positive coverage). Add to `apps/cli/test/hooks/install.test.ts`, mirroring the `runHooksInstall --no-warmup` block (`install.test.ts:250-289` — same `mkdtempSync` settings dir, `beforeEach`/`afterEach`):

```ts
describe("runHooksInstall --no-airlock", () => {
  // dir/settingsPath beforeEach + rmSync afterEach exactly as the --no-warmup block

  const upsCommands = (p: string): string[] => {
    const s = JSON.parse(readFileSync(p, "utf8"));
    return (s.hooks?.UserPromptSubmit ?? []).flatMap(
      (e: { hooks: { command: string }[] }) => e.hooks.map((h) => h.command),
    );
  };

  it("installs the airlock UserPromptSubmit hook by default, and re-install is idempotent", () => {
    const base = { target: "claude-code", settingsPath, stdout: () => {}, stderr: () => {}, json: false } as const;
    expect(runHooksInstall(base)).toBe(0);
    expect(upsCommands(settingsPath)).toContain("mega hooks airlock");
    const once = readFileSync(settingsPath, "utf8");
    expect(runHooksInstall(base)).toBe(0);
    expect(readFileSync(settingsPath, "utf8")).toBe(once);
  });

  it("airlock: false removes only the airlock entry, keeping intent", () => {
    const base = { target: "claude-code", settingsPath, stdout: () => {}, stderr: () => {}, json: false } as const;
    runHooksInstall(base);
    runHooksInstall({ ...base, airlock: false });
    const commands = upsCommands(settingsPath);
    expect(commands).toContain("mega hooks intent");
    expect(commands).not.toContain("mega hooks airlock");
  });
});
```

And in `apps/cli/test/hooks/status.test.ts`: extend the existing `toMatchObject` at `:181` with `airlockInstalled: false` (that case's seeded settings carry no airlock entry), and add one positive case that seeds the same settings shape PLUS `{ hooks: [{ type: "command", command: "mega hooks airlock", timeout: 10 }] }` in `UserPromptSubmit`, asserting `payload.hookInstallation` matches `{ connected: true, airlockInstalled: true }` (airlock stays out of `connected`, like warmup/guard).

- [ ] **Step 4: GREEN verification + full connector suite**

Run: `pnpm --filter @megasaver/connector-claude-code exec vitest run && pnpm --filter @megasaver/cli exec vitest run test/hooks/install.test.ts test/hooks/uninstall.test.ts test/hooks/status.test.ts`

Expected: green, including `hook-settings.test.ts` regression (`repairEntry` co-location behavior must be untouched).

- [ ] **Step 5: Commit**

```
feat(connector): install airlock prompt hook
```

---

### Task 9: changeset, full verify, smoke evidence, wiki

**Files:**

- Create: `.changeset/paste-airlock.md`
- Modify: `wiki/log.md` (timestamped entry), `wiki/index.md` only if a new page is added

**Interfaces:** `mega` bundle is produced by `pnpm --filter @megasaver/cli run build` + `run bundle` -> `apps/cli/dist-bundle/mega.mjs` (`apps/cli/package.json:7-9,24-26` — `bin.mega` points there).

- [ ] **Step 1: Changeset (all five packages, minor — spec Dependencies section)**

```md
---
"@megasaver/output-filter": minor
"@megasaver/content-store": minor
"@megasaver/context-gate": minor
"@megasaver/connector-claude-code": minor
"@megasaver/cli": minor
---

Paste Airlock: a second UserPromptSubmit hook (`mega hooks airlock`) detects
large log-like pastes (size AND log-likeness), parks the redacted original as
an overlay chunk set (`source: { kind: "paste" }`), and injects an
additionalContext digest with the `mega output chunk` fetch handle. Includes
the `mega airlock on|off|status` kill-switch, `!raw` per-prompt bypass, and a
`--no-airlock` install flag. v1 is additive and claims zero token savings.
```

- [ ] **Step 2: Full verify**

Run: `pnpm verify`

Expected: biome + tsc project refs + vitest all green. Fix drift only in files this feature touched.

- [ ] **Step 3: Captured smoke evidence (DoD §9.5 — CLI feature needs a real terminal session)**

```bash
pnpm --filter @megasaver/cli run build && pnpm --filter @megasaver/cli run bundle
STORE=$(mktemp -d)
# paste payload -> chunk file + envelope
node -e 'const l=[];for(let i=0;i<600;i++)l.push(` FAIL  test/f${i}.test.ts > case ${i} (exit code 1)`);process.stdout.write(JSON.stringify({prompt:l.join("\n"),cwd:process.cwd(),session_id:"smoke-1"}))' \
  | node apps/cli/dist-bundle/mega.mjs hooks airlock --store "$STORE"
find "$STORE/content" -name 'cs-*.json' | head -3
# prose payload -> silence, exit 0
printf '{"prompt":"please fix the parser","cwd":"%s","session_id":"smoke-2"}' "$PWD" \
  | node apps/cli/dist-bundle/mega.mjs hooks airlock --store "$STORE"; echo "exit=$?"
# recovery round-trip through the advertised handle
node apps/cli/dist-bundle/mega.mjs output chunk "$(basename "$(find "$STORE/content" -name 'cs-*.json' | head -1)" .json)" "0" --store "$STORE" | head -5
# kill-switch round-trip
node apps/cli/dist-bundle/mega.mjs airlock off --store "$STORE"
node apps/cli/dist-bundle/mega.mjs airlock status --store "$STORE"
```

Capture the session verbatim into the PR description. Expected: one envelope line on the paste, empty output + `exit=0` on prose, chunk 0 text on recovery, `airlock: disabled` at the end. Bare-id resolution is VERIFIED in the repo: `outputChunkCommand` (`apps/cli/src/commands/output/chunk.ts:61-64`) passes only `{storeRoot, chunkSetId, chunkId}` to `fetchChunk` (`packages/context-gate/src/fetch-chunk.ts:131`), which resolves via `locateChunkSet` (`packages/context-gate/src/locate-chunk-set.ts:20-46`) — a bare-id walk of `content/<topDir>/<sessionDir>/<chunkSetId>.json` that recognizes the overlay layout (16-hex workspaceKey dirs) and delegates to `fetchOverlayChunk` — so the advertised recovery handle works as specced.

- [ ] **Step 4: Wiki + process tail**

- Append a timestamped entry to `wiki/log.md` (feature, files, evidence pointer).
- Then the §4/§12 HIGH-risk gates, each in a fresh context, none authored by the implementer's context: `code-reviewer` pass, `critic` pass, `verifier` pass with the smoke evidence. Only after all three: `superpowers:finishing-a-development-branch`.

- [ ] **Step 5: Commit**

```
chore(airlock): changeset, smoke evidence, wiki
```
