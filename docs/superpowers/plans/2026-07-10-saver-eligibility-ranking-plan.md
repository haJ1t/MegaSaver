# Saver Eligibility + Ranking (Wave 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the compression dead band (B8), let safe mode compress Bash (B9), light up semantic chunking (B10), render excerpts in source order with elision markers (D16), scope intent per-session with TTL (D17), make the intent tokenizer Unicode-aware (D18), and add a repo-local mode floor (D19).

**Architecture:** The hook's `minBytesFor` byte gate becomes the single compression-eligibility authority — `record()` carries it as `compressFloorBytes` and derives both `filterOutput` token thresholds from it. `record-output.ts` additionally passes a `source` hint (semantic chunking) and renders source-ordered excerpts with gap markers. Intent gains a per-session file + 30-min TTL. A committed `.megasaver/policy.json` clamps resolved mode at a single enforcement point (the resolver).

**Tech Stack:** TypeScript strict ESM, Vitest, Zod 3, pnpm + Turborepo. Spec: `docs/superpowers/specs/2026-07-10-saver-eligibility-ranking-design.md`.

**Branch/worktree:** `feat/saver-eligibility` at `/Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-eligibility` (stacked on `feat/saver-recovery`). All commands run from that directory.

---

## Read/build discipline (every task)

- A live PostToolUse hook compresses large Read/Bash outputs in this environment. Read source ONLY via `sed -n 'START,ENDp' <file>` in chunks under ~100 lines (keep each command's output < 4000 bytes). Ignore any `[Mega Saver: compressed …]` footer in tool output — hook artifact, not file content.
- Workspace packages resolve to `dist/`. After editing a package, rebuild the dependency chain before running a DOWNSTREAM package's tests:
  `pnpm --filter @megasaver/output-filter build && pnpm --filter @megasaver/context-gate build && pnpm --filter @megasaver/daemon build && pnpm --filter @megasaver/core build && pnpm --filter @megasaver/cli build`
  (Same-package unit tests run against `src/` and need no rebuild.)
- NEVER pipe verification commands (`pnpm test`, `pnpm verify`) into `tail`/`head` — the pipe masks the exit code. Run bare, or redirect: `pnpm verify > /tmp/v.log 2>&1; echo EXIT=$?`.
- Commit after each task. Conventional Commits, subject ≤ 50 chars.

---

### Task 1: D18 — Unicode intent tokenizer

**Files:**
- Modify: `packages/output-filter/src/rank.ts` (the `tokenize` const, currently `split(/[^a-z0-9]+/)`)
- Test: `packages/output-filter/test/rank.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `packages/output-filter/test/rank.test.ts` (match the file's existing imports; `scoreChunk` is exported from `../src/rank.js`):

```ts
describe("D18: Unicode-aware tokenizer", () => {
  it("Turkish intent tokens match Turkish chunk text", () => {
    const chunk = { text: "işçi kaydını günceller ve derler", startLine: 1, endLine: 1 };
    const scored = scoreChunk("işçi kaydı neden bozuk", chunk);
    expect(scored.features.keywordScore).toBeGreaterThan(0);
  });

  it("accent folding is symmetric across case (İ/ı/ç/ş)", () => {
    const chunk = { text: "KIRMIZI İŞÇİ ÇALIŞIYOR", startLine: 1, endLine: 1 };
    const scored = scoreChunk("kırmızı işçi çalışıyor", chunk);
    expect(scored.features.keywordScore).toBe(3);
  });

  it("ASCII tokenization is unchanged (identifiers, digits, underscores)", () => {
    const chunk = { text: "parseConfig v2 reads snake_case_keys", startLine: 1, endLine: 1 };
    const scored = scoreChunk("parseConfig snake_case_keys", chunk);
    // "snake_case_keys" splits on "_" exactly as before: snake, case, keys
    expect(scored.features.keywordScore).toBe(4);
  });
});
```

- [ ] **Step 2: Run tests to verify the Turkish ones fail**

Run: `pnpm --filter @megasaver/output-filter test -- rank.test.ts`
Expected: first two tests FAIL (`keywordScore` is 0 — `[^a-z0-9]+` shatters Turkish words), third PASSES.

- [ ] **Step 3: Replace `tokenize` in `packages/output-filter/src/rank.ts`**

```ts
// Matching normalization, not linguistic correctness: lowercase, strip
// combining marks after NFD (ç→c, ş→s, JS-lowercased İ→i̇→i), fold dotless
// ı→i (no NFD decomposition exists for it). Both sides of keywordScore run
// the same fold, so matching stays symmetric for any script; ASCII input
// tokenizes exactly as before.
const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/ı/g, "i")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
```

Deviation note vs spec: the spec sketch was a bare `\p{L}\p{N}` split; without NFD mark-stripping, JS `"İ".toLowerCase()` (= `i` + combining U+0307, a `\p{M}`) would split mid-word. This is the same intent, correct on combining marks.

- [ ] **Step 4: Run the full output-filter suite**

Run: `pnpm --filter @megasaver/output-filter test`
Expected: PASS. Determinism/rank fixtures are ASCII-only and tokenize identically; if any fixture with non-ASCII shifted, re-baseline the asserted score with the new (correct) value and say so in the commit body.

- [ ] **Step 5: Commit**

```bash
git add packages/output-filter/src/rank.ts packages/output-filter/test/rank.test.ts
git commit -m "fix(output-filter): Unicode-aware intent tokenizer

ASCII-only [^a-z0-9] split made ranking inert for Turkish prompts (D18).
Fold: lowercase -> NFD -> strip marks -> dotless-i -> \\p{L}\\p{N} split;
symmetric on both sides of keywordScore, byte-identical for ASCII."
```

---

### Task 2: B8 — thresholds derive from the caller's byte gate

**Files:**
- Modify: `packages/context-gate/src/record-output.ts` (type `RecordOverlayOutputInput`, the `filterOutput` call)
- Test: `packages/context-gate/test/record-output.test.ts`

- [ ] **Step 1: Write the failing test** — append to `packages/context-gate/test/record-output.test.ts` (reuse the file's existing tmp-store `beforeEach` helpers/UUID constants; adjust names to what is already there):

```ts
it("B8: a ~5KB aggressive output compresses (dead band closed)", async () => {
  // 150 lines x ~34 chars ≈ 5.1 KB ≈ 1275 tokens: past the aggressive 4000 B
  // gate, but inside the old fixed 1200/2000 band -> "light" -> discarded.
  const raw = Array.from({ length: 150 }, (_, i) => `line ${i}: build noise xxxxxxxxxx`).join(
    "\n",
  );
  const r = await recordAndFilterOverlayOutput({
    storeRoot: store,
    workspaceKey: encodeWorkspaceKey("/Users/x/proj"),
    liveSessionId: "11111111-1111-4111-8111-111111111111",
    raw,
    sourceKind: "command",
    label: "pnpm build",
    mode: "aggressive",
    storeRawOutput: true,
    compressFloorBytes: 4000,
  });
  expect(r.decision).toBe("compressed");
  expect(r.chunkSetId).toBeDefined();
});

it("B8: gate falls back to modeToBudget(mode) when compressFloorBytes is absent", async () => {
  const raw = Array.from({ length: 150 }, (_, i) => `line ${i}: build noise xxxxxxxxxx`).join(
    "\n",
  );
  const r = await recordAndFilterOverlayOutput({
    storeRoot: store,
    workspaceKey: encodeWorkspaceKey("/Users/x/proj"),
    liveSessionId: "11111111-1111-4111-8111-111111111111",
    raw,
    sourceKind: "command",
    label: "pnpm build",
    mode: "aggressive",
    storeRawOutput: true,
  });
  expect(r.decision).toBe("compressed");
});
```

- [ ] **Step 2: Run to verify both fail**

Run: `pnpm --filter @megasaver/context-gate test -- record-output.test.ts`
Expected: both FAIL with `decision` = `"light"`.

- [ ] **Step 3: Implement in `packages/context-gate/src/record-output.ts`**

Add to `RecordOverlayOutputInput` (after `storeRawOutput`):

```ts
  // The byte gate the caller already applied (hook minBytesFor). Both token
  // thresholds derive from it so the caller's gate is the single eligibility
  // authority — no passthrough/light dead band can open between the gate and
  // the decision (B8). Absent -> modeToBudget(mode) (old callers, old daemon).
  compressFloorBytes?: number;
```

Replace the `filterOutput` call:

```ts
  const floorBytes = input.compressFloorBytes ?? modeToBudget(input.mode);
  // ~4 bytes/token, mirroring output-filter estimateTokens.
  const thresholdTokens = Math.max(1, Math.ceil(floorBytes / 4));

  const filtered = await filterOutput({
    raw: input.raw,
    mode: input.mode,
    maxReturnedBytes: modeToBudget(input.mode),
    passthroughThresholdTokens: thresholdTokens,
    hardWrapThresholdTokens: thresholdTokens,
    ...(input.intent !== undefined ? { intent: input.intent } : {}),
  });
```

(Equal thresholds make `light` unreachable on this path — intended; `record-output` discarded `light` anyway.)

- [ ] **Step 4: Run the context-gate suite** (rebuild output-filter first if Task 1 landed: `pnpm --filter @megasaver/output-filter build`)

Run: `pnpm --filter @megasaver/context-gate test`
Expected: PASS. Watch `record-output-intent.test.ts` — its `expect.objectContaining` assertions tolerate the two new threshold fields. If an existing smaller-fixture test asserted `"passthrough"` for a sub-gate input, it still passes (thresholds only moved DOWN for inputs past the gate).

- [ ] **Step 5: Commit**

```bash
git add packages/context-gate/src/record-output.ts packages/context-gate/test/record-output.test.ts
git commit -m "fix(context-gate): derive filter thresholds from byte gate

Fixed 1200/2000 token thresholds opened a 4001-7996 B dead band under
aggressive/4000 (B8): past the hook gate but labeled light/passthrough,
then discarded. compressFloorBytes (fallback modeToBudget) collapses
both thresholds onto the caller's gate - one eligibility authority."
```

---

### Task 3: B10 — pass `source` into `filterOutput`

**Files:**
- Modify: `packages/context-gate/src/record-output.ts` (the `filterOutput` call from Task 2)
- Test: `packages/context-gate/test/record-output.test.ts`

- [ ] **Step 1: Write the failing test** — append to `record-output.test.ts`:

```ts
it("B10: a file read reaches filterOutput with a file source (semantic chunking)", async () => {
  // A function that CROSSES the blind 40-line wall: head at line 40, marker in
  // the body at line 46. Blind chunking splits head/body into different chunks
  // and budget pressure drops the body; semantic chunking keeps the function
  // whole, so the marker survives into returnedText.
  const filler = (n: number, tag: string) =>
    Array.from({ length: n }, (_, i) => `// ${tag} filler line ${i} ${"x".repeat(80)}`);
  const lines = [
    ...filler(39, "head"),
    "function targetFn() {",
    ...filler(5, "body"),
    '  return "TARGET_BODY_MARKER";',
    "}",
    ...filler(260, "tail"),
  ];
  const raw = lines.join("\n");
  const r = await recordAndFilterOverlayOutput({
    storeRoot: store,
    workspaceKey: encodeWorkspaceKey("/Users/x/proj"),
    liveSessionId: "11111111-1111-4111-8111-111111111111",
    raw,
    sourceKind: "file",
    label: "/Users/x/proj/src/target-module.ts",
    mode: "aggressive",
    storeRawOutput: true,
    compressFloorBytes: 4000,
    intent: "why does targetFn misbehave",
  });
  expect(r.decision).toBe("compressed");
  expect(r.returnedText).toContain("TARGET_BODY_MARKER");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @megasaver/context-gate test -- record-output.test.ts`
Expected: FAIL — without a `source`, blind 40-line chunking separates the intent-matched head chunk from the body; `returnedText` lacks `TARGET_BODY_MARKER`. (If it unexpectedly passes because both chunks fit the 4000 B budget, triple the tail filler width — the point is budget pressure dropping the body chunk.)

- [ ] **Step 3: Implement** — in the `filterOutput` call from Task 2, add one line:

```ts
  const filtered = await filterOutput({
    raw: input.raw,
    mode: input.mode,
    maxReturnedBytes: modeToBudget(input.mode),
    passthroughThresholdTokens: thresholdTokens,
    hardWrapThresholdTokens: thresholdTokens,
    // RAW label, not the redacted one: the file extension must survive for
    // semantic chunking to trigger. In-memory hint only — the persisted
    // chunk-set source below still uses redactedLabel.
    source: chunkSetSource(input.sourceKind, input.label),
    ...(input.intent !== undefined ? { intent: input.intent } : {}),
  });
```

- [ ] **Step 4: Run the context-gate suite**

Run: `pnpm --filter @megasaver/context-gate test`
Expected: PASS. `record-output.test.ts` chunk-set source assertions are unaffected (they check the PERSISTED source, which still uses `redactedLabel`). `record-output-intent.test.ts` mock-arg checks use `objectContaining`/`"intent" in arg` — compatible.

- [ ] **Step 5: Commit**

```bash
git add packages/context-gate/src/record-output.ts packages/context-gate/test/record-output.test.ts
git commit -m "feat(context-gate): pass source hint to filterOutput

The hook path never forwarded source, so semantic AST chunking was dead
code and every file read got blind 40-line walls (B10). Raw label feeds
the in-memory hint (extension must survive); persisted chunk-set source
stays redacted. Daemon path fixes itself - same function."
```

---

### Task 4: D16 — source-order rendering with elision markers

**Files:**
- Modify: `packages/context-gate/src/record-output.ts` (`returnedTextOf` + its two call sites)
- Test: `packages/context-gate/test/record-output.test.ts`

- [ ] **Step 1: Write the failing test** — append to `record-output.test.ts`:

```ts
it("D16: excerpts render in source order with elision markers", async () => {
  // 200 lines; errors at lines 41-80 and 121-160 outrank filler under budget
  // pressure, and the two kept blocks are non-adjacent -> three gap markers.
  // Line width matters: ~40 chars/line keeps each 40-line chunk ≈1.6 KB so BOTH
  // error chunks fit the aggressive 4000 B budget while filler chunks do not.
  const block = (start: number, n: number, mk: (i: number) => string) =>
    Array.from({ length: n }, (_, i) => mk(start + i));
  const lines = [
    ...block(1, 40, (i) => `info: quiet filler line ${i} ${"x".repeat(10)}`),
    ...block(41, 40, (i) => `ERROR: build exploded at step ${i} ${"x".repeat(10)}`),
    ...block(81, 40, (i) => `info: quiet filler line ${i} ${"x".repeat(10)}`),
    ...block(121, 40, (i) => `ERROR: tests failed at case ${i} ${"x".repeat(10)}`),
    ...block(161, 40, (i) => `info: quiet filler line ${i} ${"x".repeat(10)}`),
  ];
  const raw = lines.join("\n");
  const r = await recordAndFilterOverlayOutput({
    storeRoot: store,
    workspaceKey: encodeWorkspaceKey("/Users/x/proj"),
    liveSessionId: "11111111-1111-4111-8111-111111111111",
    raw,
    sourceKind: "command",
    label: "pnpm verify",
    mode: "aggressive",
    storeRawOutput: true,
    compressFloorBytes: 4000,
  });
  expect(r.decision).toBe("compressed");
  const text = r.returnedText;
  // Markers exist and use the fixed grammar.
  expect(text).toMatch(/… \[lines \d+-\d+ omitted\]/);
  // Source order: first ERROR block appears before the second.
  const firstErr = text.indexOf("ERROR: build exploded at step 41");
  const secondErr = text.indexOf("ERROR: tests failed at case 121");
  expect(firstErr).toBeGreaterThan(-1);
  expect(secondErr).toBeGreaterThan(firstErr);
  // A leading gap marker precedes the first excerpt when lines 1-40 are dropped.
  const leadMarker = text.indexOf("… [lines 1-40 omitted]");
  if (leadMarker !== -1) expect(leadMarker).toBeLessThan(firstErr);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @megasaver/context-gate test -- record-output.test.ts`
Expected: FAIL on the marker regex (today's join has no markers).

Note: if simhash dedupe collapses the two ERROR chunks (they share structure), make the second block's wording more distinct (e.g. `FATAL: linker gave up on unit ${i}`) rather than weakening the assertions.

- [ ] **Step 3: Implement in `record-output.ts`** — replace `returnedTextOf` and its call sites:

```ts
function countLines(text: string): number {
  if (text === "") return 0;
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

// D16: excerpts render in SOURCE order with gap markers so spliced fragments
// can never parse as contiguous code. Line numbers are the ORIGINAL raw line
// space; recovery stays fetch-by-chunk-id (the wave-2 footer), so no line->id
// promise is made here.
function returnedTextOf(result: FilterOutputResult, rawTotalLines: number): string {
  const ordered = [...result.excerpts].sort(
    (a, b) => a.startLine - b.startLine || a.endLine - b.endLine,
  );
  const parts: string[] = [result.summary];
  let cursor = 1;
  for (const e of ordered) {
    if (e.startLine > cursor) parts.push(`… [lines ${cursor}-${e.startLine - 1} omitted]`);
    parts.push(e.text);
    cursor = Math.max(cursor, e.endLine + 1);
  }
  if (cursor <= rawTotalLines) parts.push(`… [lines ${cursor}-${rawTotalLines} omitted]`);
  return parts.join("\n");
}
```

Update both call sites:

```ts
  const rawTotalLines = countLines(input.raw);
  const base = {
    decision: filtered.decision,
    summary: filtered.summary,
    returnedText: returnedTextOf(filtered, rawTotalLines),
    ...
```

and on the evidence path:

```ts
    const { redacted: redactedReturnedText } = redact(returnedTextOf(filtered, rawTotalLines));
```

Known metrics note (wave 5, F30): marker bytes join the returned text but `filtered.returnedBytes` doesn't count them — same class as the footer exclusion; do NOT fix here, it is wave-5 scope.

- [ ] **Step 4: Run the context-gate suite; re-baseline joined-text assertions**

Run: `pnpm --filter @megasaver/context-gate test`
Expected: `dedup-shown-excerpts.test.ts` / `run-overlay.test.ts` may pin the old score-ordered bare join — update those assertions to the new source-ordered + marker shape (state each re-baseline in the commit body). Chunk-set reconstruction tests (`cs.chunks.map(...).join("\n")`) are untouched — they read the STORED chunks, not `returnedText`.

- [ ] **Step 5: Commit**

```bash
git add packages/context-gate/src/record-output.ts packages/context-gate/test/*.test.ts
git commit -m "fix(context-gate): render excerpts in source order

Score-ordered bare-newline joins made spliced fragments parse as
contiguous code and dropped all position info (D16). Excerpts now sort
by startLine with '… [lines A-B omitted]' markers at leading/middle/
trailing gaps, in the original raw line space."
```

---

### Task 5: D19 — policy floor module + resolver clamp

**Files:**
- Create: `packages/context-gate/src/policy-floor.ts`
- Modify: `packages/context-gate/src/resolve-saver-settings.ts` (`ResolverDeps`, `ResolvedWorkspaceTokenSaver`, `nodeResolverDeps`, wrap the resolver)
- Modify: `packages/context-gate/src/index.ts` (exports)
- Test: `packages/context-gate/test/policy-floor.test.ts` (new), `packages/context-gate/test/resolve-saver-settings.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/context-gate/test/policy-floor.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clampModeToFloor, readPolicyModeFloor } from "../src/policy-floor.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-policy-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const writePolicy = (dir: string, body: string) => {
  mkdirSync(join(dir, ".megasaver"), { recursive: true });
  writeFileSync(join(dir, ".megasaver", "policy.json"), body);
};

describe("readPolicyModeFloor", () => {
  it("reads the floor from <dir>/.megasaver/policy.json", () => {
    writePolicy(root, JSON.stringify({ modeFloor: "balanced" }));
    expect(readPolicyModeFloor(root)).toBe("balanced");
  });

  it("walks up from a nested cwd", () => {
    writePolicy(root, JSON.stringify({ modeFloor: "safe" }));
    const nested = join(root, "packages", "core", "src");
    mkdirSync(nested, { recursive: true });
    expect(readPolicyModeFloor(nested)).toBe("safe");
  });

  it("no file -> null", () => {
    expect(readPolicyModeFloor(root)).toBeNull();
  });

  it("malformed JSON -> null (fail-open)", () => {
    writePolicy(root, "{not json");
    expect(readPolicyModeFloor(root)).toBeNull();
  });

  it("unknown keys / bad floor value -> null (strict schema, fail-open)", () => {
    writePolicy(root, JSON.stringify({ modeFloor: "aggressive" }));
    expect(readPolicyModeFloor(root)).toBeNull();
    writePolicy(root, JSON.stringify({ modeFloor: "balanced", extra: 1 }));
    expect(readPolicyModeFloor(root)).toBeNull();
  });
});

describe("clampModeToFloor", () => {
  it("clamps only below the floor", () => {
    expect(clampModeToFloor("aggressive", "balanced")).toBe("balanced");
    expect(clampModeToFloor("balanced", "balanced")).toBe("balanced");
    expect(clampModeToFloor("safe", "balanced")).toBe("safe");
    expect(clampModeToFloor("aggressive", "safe")).toBe("safe");
    expect(clampModeToFloor("balanced", "safe")).toBe("safe");
  });
});
```

Append to `resolve-saver-settings.test.ts` (reuse its existing deps-builder helper — it constructs a `ResolverDeps`; add `readPolicyFloor: () => null` to that helper as part of this step so existing tests compile):

```ts
it("D19: policy floor clamps an aggressive exact record", () => {
  // Arrange an exact record with mode "aggressive" the way sibling tests do,
  // then resolve with a deps whose readPolicyFloor returns "balanced".
  const resolved = resolveWorkspaceTokenSaverSettings(store, cwd, {
    ...deps,
    readPolicyFloor: () => "balanced",
  });
  expect(resolved.enabled).toBe(true);
  expect(resolved.mode).toBe("balanced");
  expect(resolved.policyClamp).toEqual({ floor: "balanced", original: "aggressive" });
});

it("D19: no policy floor -> resolution unchanged, policyClamp null", () => {
  const resolved = resolveWorkspaceTokenSaverSettings(store, cwd, {
    ...deps,
    readPolicyFloor: () => null,
  });
  expect(resolved.mode).toBe("aggressive");
  expect(resolved.policyClamp).toBeNull();
});

it("D19: floor at/below the record mode -> no clamp mark", () => {
  // exact record mode "safe" + floor "balanced" -> mode stays "safe", no clamp
  const resolved = resolveWorkspaceTokenSaverSettings(store, safeCwd, {
    ...deps,
    readPolicyFloor: () => "balanced",
  });
  expect(resolved.mode).toBe("safe");
  expect(resolved.policyClamp).toBeNull();
});
```

- [ ] **Step 2: Run to verify failures**

Run: `pnpm --filter @megasaver/context-gate test -- policy-floor.test.ts resolve-saver-settings.test.ts`
Expected: policy-floor tests fail with module-not-found; resolver tests fail to compile on `readPolicyFloor`/`policyClamp`.

- [ ] **Step 3: Create `packages/context-gate/src/policy-floor.ts`**

```ts
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { TokenSaverMode } from "@megasaver/shared";
import { z } from "zod";

// Committed, repo-local mode floor (D19): a HIGH-risk repo can veto
// evidence-dropping compression regardless of what the operator's store
// records say. "aggressive" is not a valid floor - it would clamp nothing.
const policyFileSchema = z.object({ modeFloor: z.enum(["balanced", "safe"]).optional() }).strict();

export type PolicyModeFloor = "balanced" | "safe";

const MODE_RANK: Record<TokenSaverMode, number> = { aggressive: 0, balanced: 1, safe: 2 };

export function clampModeToFloor(mode: TokenSaverMode, floor: PolicyModeFloor): TokenSaverMode {
  return MODE_RANK[mode] >= MODE_RANK[floor] ? mode : floor;
}

// Walks cwd -> fs root for .megasaver/policy.json; first valid file wins.
// Malformed/unreadable files are skipped (fail-open, hook philosophy —
// doctor surfacing is wave-4/E22). Bounded walk mirrors probeLegacyRoot.
export function readPolicyModeFloor(cwd: string): PolicyModeFloor | null {
  let dir = resolve(cwd);
  for (let i = 0; i < 32; i++) {
    try {
      const parsed = policyFileSchema.safeParse(
        JSON.parse(readFileSync(join(dir, ".megasaver", "policy.json"), "utf8")),
      );
      if (parsed.success) return parsed.data.modeFloor ?? null;
    } catch {
      /* absent or unreadable -> keep walking */
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}
```

- [ ] **Step 4: Wire into `resolve-saver-settings.ts`**

1. Import: `import { type PolicyModeFloor, clampModeToFloor, readPolicyModeFloor } from "./policy-floor.js";`
2. `ResolverDeps` gains a required field:

```ts
export type ResolverDeps = {
  platform: string;
  resolveGit: (cwd: string) => GitCommonDirResult;
  caseModeOf: (path: string) => CaseMode;
  realpath: (path: string) => string;
  readPolicyFloor: (cwd: string) => PolicyModeFloor | null;
};
```

3. `ResolvedWorkspaceTokenSaver` gains a required field:

```ts
  policyClamp: { floor: TokenSaverMode; original: TokenSaverMode } | null;
```

4. Rename the existing exported function body to a module-private
   `resolveUnclamped` returning `Omit<ResolvedWorkspaceTokenSaver, "policyClamp">`
   (its internals — including `disabled()` — are UNCHANGED; only the signature
   type annotation changes). Add the new exported wrapper:

```ts
// D19 enforcement is HERE and only here: every consumer (hook, daemon,
// resolve/status commands) goes through this resolver, so a repo-local
// floor cannot be bypassed by any store record.
export function resolveWorkspaceTokenSaverSettings(
  storeRoot: string,
  cwd: string,
  deps: ResolverDeps,
): ResolvedWorkspaceTokenSaver {
  const r = resolveUnclamped(storeRoot, cwd, deps);
  if (!r.enabled) return { ...r, policyClamp: null };
  const floor = deps.readPolicyFloor(cwd);
  if (floor === null) return { ...r, policyClamp: null };
  const clamped = clampModeToFloor(r.mode, floor);
  if (clamped === r.mode) return { ...r, policyClamp: null };
  return { ...r, mode: clamped, policyClamp: { floor, original: r.mode } };
}
```

5. `nodeResolverDeps()` gains `readPolicyFloor: readPolicyModeFloor,`.
6. `packages/context-gate/src/index.ts`: export `clampModeToFloor`, `readPolicyModeFloor`, `type PolicyModeFloor` from `./policy-floor.js`.

- [ ] **Step 5: Run the context-gate suite**

Run: `pnpm --filter @megasaver/context-gate test`
Expected: PASS after the deps-builder helper gained `readPolicyFloor: () => null`. `resolve-effective-settings.test.ts` may also construct deps — same one-line addition.

- [ ] **Step 6: Commit**

```bash
git add packages/context-gate/src/policy-floor.ts packages/context-gate/src/resolve-saver-settings.ts packages/context-gate/src/index.ts packages/context-gate/test/policy-floor.test.ts packages/context-gate/test/resolve-saver-settings.test.ts packages/context-gate/test/resolve-effective-settings.test.ts
git commit -m "feat(context-gate): repo-local mode floor clamps resolver

Store records could pin a HIGH-risk repo to aggressive with no veto
(D19). A committed .megasaver/policy.json {modeFloor} now clamps the
resolved mode at the single resolver chokepoint; result carries
policyClamp so surfaces can show it. Malformed policy = fail-open."
```

---

### Task 6: B8 — daemon accepts `compressFloorBytes`

**Files:**
- Modify: `packages/daemon/src/handlers.ts` (`excerptRequestSchema`)
- Test: `packages/daemon/test/handlers.test.ts`

- [ ] **Step 1: Write the failing test** — append to `packages/daemon/test/handlers.test.ts`, following its existing `excerptHandler` test fixture style (tmp store, valid workspaceKey/liveSessionId):

```ts
it("B8: /excerpt accepts compressFloorBytes and derives thresholds from it", async () => {
  const raw = Array.from({ length: 150 }, (_, i) => `line ${i}: build noise xxxxxxxxxx`).join(
    "\n",
  );
  const res = await excerptHandler(store, {
    workspaceKey,
    liveSessionId,
    raw,
    sourceKind: "command",
    label: "pnpm build",
    mode: "aggressive",
    storeRawOutput: true,
    compressFloorBytes: 4000,
  });
  expect(res.status).toBe(200); // strict schema rejected the unknown key before
  expect(res.json["decision"]).toBe("compressed");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @megasaver/context-gate build && pnpm --filter @megasaver/daemon test -- handlers.test.ts`
Expected: FAIL with `res.status` 400 (`.strict()` rejects the unknown key).

- [ ] **Step 3: Implement** — add one line to `excerptRequestSchema` in `packages/daemon/src/handlers.ts` (after `intent`):

```ts
    compressFloorBytes: z.number().int().positive().optional(),
```

No handler-body change: the field rides the existing `...rest` spread into `recordAndFilterOverlayOutput`.

- [ ] **Step 4: Run the daemon suite**

Run: `pnpm --filter @megasaver/daemon test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/daemon/src/handlers.ts packages/daemon/test/handlers.test.ts
git commit -m "feat(daemon): /excerpt accepts compressFloorBytes

Forwards the hook's byte gate so daemon-path compression uses the same
single eligibility authority as in-process (B8). Optional field: an old
CLI never sends it, a new CLI against an old daemon gets a 400 and
falls back in-process by design."
```

---

### Task 7: B9 + B8 plumbing — hook gate

**Files:**
- Modify: `apps/cli/src/hooks/saver.ts` (`minBytesFor`, `buildSaverDecision` record call)
- Test: `apps/cli/test/hooks/saver.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `apps/cli/test/hooks/saver.test.ts`, reusing its existing fake-deps builder (a `SaverDeps` whose `record` captures its input and returns a canned compressed result; follow the file's existing pattern exactly):

```ts
describe("B9: safe mode compresses Bash below Claude Code's output ceiling", () => {
  it("a 26KB Bash output in safe mode reaches record() with the Bash floor", async () => {
    const captured: RecordOverlayOutputInput[] = [];
    const deps = makeDeps({
      settings: { enabled: true, mode: "safe" },
      onRecord: (input) => captured.push(input),
    });
    const raw = "x".repeat(26_000);
    const decision = await buildSaverDecision(
      {
        tool_name: "Bash",
        session_id: "11111111-1111-4111-8111-111111111111",
        cwd: "/Users/x/proj",
        tool_input: { command: "pnpm verify" },
        tool_response: { stdout: raw, stderr: "" },
      },
      deps,
    );
    expect("updatedToolOutput" in decision).toBe(true); // today: passthrough (32000 gate)
    expect(captured[0]?.compressFloorBytes).toBe(24_000);
  });

  it("safe mode still passes a 26KB Read through (32KB gate intact)", async () => {
    const deps = makeDeps({ settings: { enabled: true, mode: "safe" } });
    const decision = await buildSaverDecision(
      {
        tool_name: "Read",
        session_id: "11111111-1111-4111-8111-111111111111",
        cwd: "/Users/x/proj",
        tool_input: { file_path: "/Users/x/proj/big.txt" },
        tool_response: { file: { content: "x".repeat(26_000) } },
      },
      deps,
    );
    expect(decision).toEqual({ passthrough: true });
  });
});

describe("B8: hook forwards its gate as compressFloorBytes", () => {
  it("aggressive Read forwards the 4000 B gate", async () => {
    const captured: RecordOverlayOutputInput[] = [];
    const deps = makeDeps({
      settings: { enabled: true, mode: "aggressive" },
      onRecord: (input) => captured.push(input),
    });
    await buildSaverDecision(
      {
        tool_name: "Read",
        session_id: "11111111-1111-4111-8111-111111111111",
        cwd: "/Users/x/proj",
        tool_input: { file_path: "/Users/x/proj/big.txt" },
        tool_response: { file: { content: "x".repeat(5_000) } },
      },
      deps,
    );
    expect(captured[0]?.compressFloorBytes).toBe(4_000);
  });
});
```

(If the file's deps builder has a different name/shape than `makeDeps({settings, onRecord})`, adapt the calls — do NOT restructure the existing builder.)

- [ ] **Step 2: Run to verify failures**

Run: `pnpm --filter @megasaver/context-gate build && pnpm --filter @megasaver/core build && pnpm --filter @megasaver/cli test -- hooks/saver.test.ts`
Expected: B9 test FAILS (passthrough — 26 000 ≤ 32 000 gate); B8 test FAILS (`compressFloorBytes` undefined).

- [ ] **Step 3: Implement in `apps/cli/src/hooks/saver.ts`**

Replace `minBytesFor` (and add the constant next to `NEW_SURFACE_MIN_BYTES`):

```ts
// Claude Code truncates Bash output at ~30 000 chars before the hook sees it;
// a gate at or above that ceiling means "never compress a command" (B9). Keep
// the Bash floor below the ceiling so safe mode still saves on commands.
export const BASH_COMPRESS_FLOOR = 24_000;

function minBytesFor(tool: string, mode: TokenSaverMode): number {
  const budget = modeToBudget(mode);
  if (tool === "Bash") return Math.min(budget, BASH_COMPRESS_FLOOR);
  return ORIGINAL_TOOLS.has(tool) ? budget : Math.max(budget, NEW_SURFACE_MIN_BYTES);
}
```

In `buildSaverDecision`, capture the gate once and forward it (this replaces the existing size-gate line and the existing `deps.record({...})` call — every field below except `compressFloorBytes` is already there verbatim, including the biome-ignore comment on the `label` line):

```ts
    const floorBytes = minBytesFor(tool, settings.mode);
    if (Buffer.byteLength(shape.raw, "utf8") <= floorBytes) return PASSTHROUGH;

    const recorded = await deps.record({
      storeRoot: deps.storeRoot,
      // Evidence rows live under <storeRoot>/evidence/<wk>/ — same base root the
      // MCP approve-memory path reads from. Passing it turns on the best-effort
      // evidence write inside record(); a failure there never blocks compression.
      evidenceStoreRoot: deps.storeRoot,
      workspaceKey,
      liveSessionId: sessionId,
      raw: shape.raw,
      sourceKind,
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      label: labelOf(p["tool_input"], tool),
      mode: settings.mode,
      storeRawOutput: true,
      // B8: the gate above is the single eligibility authority; record()
      // collapses the filter thresholds onto it.
      compressFloorBytes: floorBytes,
      ...(sessionIntent !== undefined ? { intent: sessionIntent } : {}),
    });
```

- [ ] **Step 4: Run the cli hook suites**

Run: `pnpm --filter @megasaver/cli test -- hooks/`
Expected: PASS, including `saver-roundtrip.test.ts` (its inputs are far past every gate, and thresholds only moved down).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/hooks/saver.ts apps/cli/test/hooks/saver.test.ts
git commit -m "fix(cli): safe mode compresses Bash; hook forwards gate

Safe's 32000 B gate exceeded Claude Code's ~30000-char Bash truncation
ceiling, so safe mode never compressed a command (B9). Bash floor caps
at 24000. The hook also forwards its gate as compressFloorBytes so the
filter thresholds collapse onto it (B8)."
```

---

### Task 8: D17 — per-session intent + TTL + GC sweep

**Files:**
- Modify: `apps/cli/src/hooks/intent-run.ts` (schema, paths, read/write)
- Modify: `apps/cli/src/hooks/saver.ts` (`SaverDeps.readSessionIntent` signature + call site)
- Modify: `apps/cli/src/hooks/gc.ts` (intent sweep)
- Test: `apps/cli/test/hooks/intent-run.test.ts`, `apps/cli/test/hooks/saver.test.ts`, `apps/cli/test/hooks/gc.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `apps/cli/test/hooks/intent-run.test.ts` (reuse its tmp-store setup):

```ts
describe("D17: per-session intent + TTL", () => {
  const ws = encodeWorkspaceKey("/Users/x/proj");
  const sidA = "11111111-1111-4111-8111-111111111111";
  const sidB = "22222222-2222-4222-8222-222222222222";

  it("two sessions in one workspace read their own prompts", () => {
    captureIntent(store, { prompt: "fix the parser", cwd: "/Users/x/proj", session_id: sidA });
    captureIntent(store, { prompt: "write the docs", cwd: "/Users/x/proj", session_id: sidB });
    expect(readSessionIntent(store, ws, sidA)).toBe("fix the parser");
    expect(readSessionIntent(store, ws, sidB)).toBe("write the docs");
  });

  it("id-less payloads still work via the legacy latest-wins file", () => {
    captureIntent(store, { prompt: "legacy prompt", cwd: "/Users/x/proj" });
    expect(readSessionIntent(store, ws)).toBe("legacy prompt");
    // an unknown session id falls back to the legacy file
    expect(readSessionIntent(store, ws, sidA)).toBe("legacy prompt");
  });

  it("intent expires after 30 minutes", () => {
    const t0 = 1_000_000_000_000;
    captureIntent(store, { prompt: "old prompt", cwd: "/Users/x/proj", session_id: sidA }, () => t0);
    const late = () => t0 + 30 * 60_000 + 1;
    expect(readSessionIntent(store, ws, sidA, late)).toBeUndefined();
    expect(readSessionIntent(store, ws, undefined, late)).toBeUndefined();
  });

  it("a hostile session_id cannot escape the store (falls back to legacy)", () => {
    captureIntent(store, { prompt: "safe prompt", cwd: "/Users/x/proj", session_id: "../../evil" });
    // nothing written outside; the per-session write was skipped, legacy still works
    expect(readSessionIntent(store, ws, "../../evil")).toBe("safe prompt");
  });
});
```

Append to `apps/cli/test/hooks/gc.test.ts` (reuse its injected-clock pattern):

```ts
it("D17: gc sweeps intent files older than retention", async () => {
  const ws = encodeWorkspaceKey("/Users/x/proj");
  const dir = join(store, "stats", ws, "intent");
  mkdirSync(dir, { recursive: true });
  const old = join(dir, "aaaa.json");
  const fresh = join(dir, "bbbb.json");
  writeFileSync(old, JSON.stringify({ prompt: "old", ts: 0 }));
  writeFileSync(fresh, JSON.stringify({ prompt: "new", ts: Date.now() }));
  const past = new Date(Date.now() - 40 * 86_400_000);
  utimesSync(old, past, past);
  mkdirSync(join(store, "content"), { recursive: true });
  const ran = await maybeRunOverlayGc(store, { prune: async () => ({ removed: 0 }) });
  expect(ran).toBe(true);
  expect(existsSync(old)).toBe(false);
  expect(existsSync(fresh)).toBe(true);
});
```

(Match `maybeRunOverlayGc`'s existing test for the `prune` stub's exact return shape.)

- [ ] **Step 2: Run to verify failures**

Run: `pnpm --filter @megasaver/cli test -- hooks/intent-run.test.ts hooks/gc.test.ts`
Expected: per-session/TTL/hostile-id tests FAIL (no `session_id` in schema, no TTL); gc test FAILS (old intent file survives).

- [ ] **Step 3: Implement `intent-run.ts`**

```ts
const intentFileSchema = z.object({ prompt: z.string(), ts: z.number() });
const payloadSchema = z.object({
  prompt: z.string(),
  cwd: z.string().min(1),
  // Claude Code sends session_id on every hook event; optional so old/other
  // harness payloads keep working through the legacy file.
  session_id: z.string().min(1).optional(),
});

export const INTENT_TTL_MS = 30 * 60_000;

// session_id becomes a filesystem segment; reject anything that could carry a
// path separator or dot-prefix (daemon safeSegmentSchema posture). A rejected
// id silently degrades to the legacy workspace file.
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function intentFilePath(storeRoot: string, workspaceKey: string): string {
  return join(storeRoot, "stats", workspaceKey, "session-intent.json");
}

export function sessionIntentFilePath(
  storeRoot: string,
  workspaceKey: string,
  sessionId: string,
): string {
  return join(storeRoot, "stats", workspaceKey, "intent", `${sessionId}.json`);
}

function readIntentAt(path: string, now: () => number): string | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = intentFileSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (!parsed.success) return undefined;
    // D17: a stale prompt ranking a fresh read is worse than no intent at all.
    if (now() - parsed.data.ts > INTENT_TTL_MS) return undefined;
    const prompt = parsed.data.prompt.trim();
    return prompt === "" ? undefined : prompt;
  } catch {
    return undefined;
  }
}

export function readSessionIntent(
  storeRoot: string,
  workspaceKey: string,
  sessionId?: string,
  now: () => number = Date.now,
): string | undefined {
  if (sessionId !== undefined && SAFE_SEGMENT.test(sessionId)) {
    const scoped = readIntentAt(sessionIntentFilePath(storeRoot, workspaceKey, sessionId), now);
    if (scoped !== undefined) return scoped;
  }
  return readIntentAt(intentFilePath(storeRoot, workspaceKey), now);
}
```

Generalize the writer (same atomic tmp+rename body, path parameter):

```ts
function writeIntentAt(path: string, prompt: string, ts: number): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, `${JSON.stringify({ prompt, ts })}\n`);
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

export function captureIntent(
  storeRoot: string,
  payload: unknown,
  now: () => number = Date.now,
): void {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return;
  const prompt = parsed.data.prompt.trim();
  if (prompt === "") return;
  const wsKey = encodeWorkspaceKey(parsed.data.cwd);
  const redacted = redact(prompt).redacted;
  const ts = now();
  const sid = parsed.data.session_id;
  if (sid !== undefined && SAFE_SEGMENT.test(sid)) {
    writeIntentAt(sessionIntentFilePath(storeRoot, wsKey, sid), redacted, ts);
  }
  // Legacy latest-wins file: id-less payloads and older saver binaries.
  writeIntentAt(intentFilePath(storeRoot, wsKey), redacted, ts);
}
```

- [ ] **Step 4: Thread the session id through the saver**

`apps/cli/src/hooks/saver.ts` — `SaverDeps`:

```ts
  readSessionIntent: (
    storeRoot: string,
    workspaceKey: string,
    sessionId?: string,
  ) => string | undefined;
```

Call site in `buildSaverDecision`:

```ts
    const sessionIntent = deps.readSessionIntent(deps.storeRoot, workspaceKey, sessionId);
```

`saver-run.ts` wires `readSessionIntent` by reference — signature-compatible, no change needed. Update `saver.test.ts` fake deps to the 3-arg signature (mechanical).

- [ ] **Step 5: Add the sweep to `apps/cli/src/hooks/gc.ts`**

```ts
import { readdirSync, statSync, unlinkSync } from "node:fs"; // merge with existing fs imports

// D17: per-session intent files are tiny but unbounded; sweep them with the
// same retention as chunk sets. Best-effort, every failure swallowed.
function pruneIntentFiles(storeRoot: string, cutoffMs: number): void {
  let workspaces: string[];
  try {
    workspaces = readdirSync(join(storeRoot, "stats"));
  } catch {
    return;
  }
  for (const ws of workspaces) {
    const dir = join(storeRoot, "stats", ws, "intent");
    let files: string[];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const p = join(dir, f);
      try {
        if (statSync(p).mtimeMs < cutoffMs) unlinkSync(p);
      } catch {
        /* best-effort */
      }
    }
  }
}
```

In `maybeRunOverlayGc`, extend the final try block:

```ts
  try {
    await prune({ storeRoot, olderThan: new Date(now() - OVERLAY_RETENTION_MS) });
    pruneIntentFiles(storeRoot, now() - OVERLAY_RETENTION_MS);
    return true;
  } catch {
    return false;
  }
```

- [ ] **Step 6: Run the cli suite**

Run: `pnpm --filter @megasaver/cli test`
Expected: PASS (including the intent-command tests — `captureIntent`'s legacy write is unchanged for id-less payloads).

- [ ] **Step 7: Commit**

```bash
git add apps/cli/src/hooks/intent-run.ts apps/cli/src/hooks/saver.ts apps/cli/src/hooks/gc.ts apps/cli/test/hooks/intent-run.test.ts apps/cli/test/hooks/saver.test.ts apps/cli/test/hooks/gc.test.ts
git commit -m "fix(cli): per-session intent with 30-min TTL

Workspace-global latest-wins intent let concurrent sessions rank
against each other's prompts and never expired (D17). Intent now writes
stats/<ws>/intent/<sessionId>.json (legacy file kept for id-less
payloads), reads session-first with TTL, and gc sweeps stale files."
```

---

### Task 9: D19 surface — enable notice, resolve display, repo policy file

**Files:**
- Modify: `apps/cli/src/commands/session/saver/workspace.ts` (enable notice)
- Modify: `apps/cli/src/commands/session/saver/resolve.ts` (clamp display + JSON field)
- Create: `.megasaver/policy.json` (repo root of the worktree)
- Modify: `.gitignore` (line `**/.megasaver/` → contents-ignore + policy exception)
- Test: `apps/cli/test/session-saver-workspace.test.ts`, `apps/cli/test/session-saver-resolve.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apps/cli/test/session-saver-workspace.test.ts` (reuse its existing enable-run fixture; it drives `runSessionSaverWorkspaceEnable` with a tmp cwd):

```ts
it("D19: enabling aggressive in a floored repo prints a clamp notice", async () => {
  mkdirSync(join(cwd, ".megasaver"), { recursive: true });
  writeFileSync(join(cwd, ".megasaver", "policy.json"), JSON.stringify({ modeFloor: "balanced" }));
  const errs: string[] = [];
  const code = await runSessionSaverWorkspaceEnable({
    ...baseInput,
    modeFlag: "aggressive",
    stderr: (l) => errs.push(l),
  });
  expect(code).toBe(0); // record still written; resolver clamps at read time
  expect(errs.join("\n")).toContain('floors this repository at "balanced"');
});
```

Append to `apps/cli/test/session-saver-resolve.test.ts`:

```ts
it("D19: resolve JSON carries policyClamp", async () => {
  // enable aggressive + floor balanced in the fixture cwd (as above), then:
  const out: string[] = [];
  const code = await runSessionSaverResolve({ ...baseInput, json: true, stdout: (l) => out.push(l) });
  expect(code).toBe(0);
  const parsed = JSON.parse(out.join(""));
  expect(parsed.mode).toBe("balanced");
  expect(parsed.policyClamp).toEqual({ floor: "balanced", original: "aggressive" });
});
```

- [ ] **Step 2: Run to verify failures**

Run: `pnpm --filter @megasaver/context-gate build && pnpm --filter @megasaver/cli test -- session-saver-workspace.test.ts session-saver-resolve.test.ts`
Expected: FAIL (no notice; no `policyClamp` key).

- [ ] **Step 3: Implement the notice** — `workspace.ts`, in `runSessionSaverWorkspaceEnable` after the `writeActivation` try/catch succeeds, before `emit(...)`:

```ts
import { clampModeToFloor, readPolicyModeFloor } from "@megasaver/context-gate"; // merge into existing import

  const floor = readPolicyModeFloor(input.cwd);
  if (floor !== null && clampModeToFloor(mode, floor) !== mode) {
    input.stderr(
      `note: .megasaver/policy.json floors this repository at "${floor}" — the "${mode}" record is written but resolves as "${floor}"`,
    );
  }
```

- [ ] **Step 4: Implement the resolve display** — `resolve.ts`:

JSON branch, add to the object: `policyClamp: resolved.policyClamp,`

Text branch, after the repository-family line:

```ts
  if (resolved.policyClamp !== null) {
    input.stdout(
      `  policy floor: ${resolved.policyClamp.floor} (record mode ${resolved.policyClamp.original} clamped by .megasaver/policy.json)`,
    );
  }
```

- [ ] **Step 5: Add the repo policy file + un-ignore it**

Create `.megasaver/policy.json` at the worktree root:

```json
{ "modeFloor": "balanced" }
```

In `.gitignore`, replace the line `**/.megasaver/` with (git cannot re-include a file under an excluded DIRECTORY; ignoring the dir's *contents* instead lets the negation work):

```
**/.megasaver/*
!**/.megasaver/policy.json
```

Verify: `git check-ignore -v .megasaver/policy.json ; echo CHECK=$?` → expected `CHECK=1` (not ignored), and `git check-ignore .megasaver/hooks 2>/dev/null; echo CHECK=$?` → `CHECK=0` for a runtime subpath (still ignored).

- [ ] **Step 6: Run the cli suite**

Run: `pnpm --filter @megasaver/cli test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/cli/src/commands/session/saver/workspace.ts apps/cli/src/commands/session/saver/resolve.ts apps/cli/test/session-saver-workspace.test.ts apps/cli/test/session-saver-resolve.test.ts .megasaver/policy.json .gitignore
git commit -m "feat(cli): surface policy floor; floor this repo at balanced

workspace enable warns when a repo policy will clamp the requested
mode; resolve shows the clamp. MegaSaver itself is a HIGH-risk source
repo (§12 evidence-preserving rule) - its committed policy.json floors
the store-pinned aggressive mode to balanced."
```

---

### Task 10: changeset, wiki, full verify

**Files:**
- Create: `.changeset/saver-eligibility-wave3.md`
- Modify: `wiki/log.md` (append), `wiki/syntheses/saver-savings-gaps.md` is on main's working tree — do NOT touch it here (FIXED marks land at merge time).

- [ ] **Step 1: Write the changeset** — `.changeset/saver-eligibility-wave3.md`:

```md
---
"@megasaver/output-filter": minor
"@megasaver/context-gate": minor
"@megasaver/daemon": patch
"@megasaver/cli": minor
---

Saver eligibility + ranking wave 3: the hook's byte gate is now the single
compression-eligibility authority (no more 4-8 KB dead band), safe mode
compresses Bash below Claude Code's output ceiling, file reads get semantic
AST chunking, compressed views render in source order with `… [lines A-B
omitted]` markers, intent is per-session with a 30-minute TTL, the intent
tokenizer understands non-ASCII prompts, and a committed
`.megasaver/policy.json` can floor the mode a repo may be compressed with.
```

- [ ] **Step 2: Append to `wiki/log.md`** (follow the file's existing entry format):

```md
## [2026-07-10] feature | saver eligibility + ranking (wave 3)

Wave 3 of [[syntheses/saver-savings-gaps]] shipped on `feat/saver-eligibility`
(stacked on wave 2): B8 dead band closed (thresholds derive from the hook
gate via compressFloorBytes), B9 safe-mode Bash floor 24000 B, B10 source
hint wired (semantic chunking live), D16 source-order rendering with elision
markers, D17 per-session intent + 30-min TTL + gc sweep, D18 Unicode
tokenizer, D19 repo-local mode floor (.megasaver/policy.json — this repo
floors at balanced). D20 conscious accept (scoped down by B10). Spec:
docs/superpowers/specs/2026-07-10-saver-eligibility-ranking-design.md.
```

- [ ] **Step 3: Full verify (no pipe!)**

Run: `pnpm verify > /tmp/wave3-verify.log 2>&1; echo EXIT=$?`
Expected: `EXIT=0`. If not, read the log tail via `sed -n`, fix, re-run.

- [ ] **Step 4: Live smoke** — the worktree's own hook run (evidence for DoD §5):

```bash
node apps/cli/dist/index.mjs output gc --days 30 --store "$(mktemp -d)" ; echo EXIT=$?
```

Expected: exits 0 (command wired). Then a synthetic hook round-trip already covered by `saver-roundtrip.test.ts` counts as the connector evidence.

- [ ] **Step 5: Commit**

```bash
git add .changeset/saver-eligibility-wave3.md wiki/log.md
git commit -m "chore(release): wave 3 changeset + wiki log"
```

---

## Re-baseline expectations (do NOT fight these)

- `record-output-intent.test.ts` — mock-arg assertions gain `source` + threshold fields; `objectContaining` should absorb them, only exact-equality assertions need edits.
- `dedup-shown-excerpts.test.ts`, `run-overlay.test.ts` — returnedText shape changed by D16 (order + markers).
- `determinism.guard.test.ts`, `rank.test.ts` — only if fixtures contain non-ASCII (D18); ASCII scores are byte-identical.
- Resolver test deps builders — add `readPolicyFloor: () => null` once.
- Anything asserting `decision === "light"` on the record path — the band no longer exists there.

## Out of scope (spec non-goals)

D20 prose compressor changes; new saver modes; per-subagent intent distribution; doctor surfacing of malformed policy files (wave 4); marker-byte metrics honesty (wave 5, F30).
