# Saver Metrics Honesty — Wave 5 Implementation Plan (F30–F34)

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development to execute this plan task-by-task
> in the current session (or superpowers:executing-plans in a separate
> session). Every task is strict TDD: write the failing test, run it RED,
> implement, run it GREEN, commit. Never skip a RED run.

**Spec:** `docs/superpowers/specs/2026-07-11-saver-metrics-honesty-design.md`
(approved 2026-07-11; risk HIGH per §12 — worktree mandatory, dual review).

**Goal:** Every reported saver number counts the bytes actually delivered to
the model (D16 markers + recovery footer included), no ratio divides
mismatched scopes, one torn usage line can no longer zero `mega audit usage`,
a removed proxy route self-heals, and the metering proxy stops being framed
as a saver.

**Architecture:** `recordAndFilterOverlayOutput` (context-gate) becomes the
single place persisted numbers are computed — it builds the canonical
recovery footer itself (new `recovery-footer.ts`) so the numbers survive the
daemon HTTP boundary, and guards against net-negative delivery before any
side effect. The stats event schema carries `secretsRedacted`/`chunksStored`
so rebuilds stop depending on carryForward. The llm-proxy reader, audit
scope-matching, supervisor route self-heal, and F34 renames are thin,
independent follow-ons.

**Tech Stack:** TypeScript strict ESM, Zod at boundaries, Vitest, Biome,
pnpm + Turborepo. No new dependencies.

---

## Environment & verification discipline (READ FIRST)

- **Work ONLY in this worktree:**
  `/Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-metrics-honesty`
  (branch `feat/saver-metrics-honesty`). Never touch the main checkout.
- **A live saver PostToolUse hook compresses tool outputs > 4000 bytes.**
  Read files ONLY via `sed -n 'A,Bp' <file>` in ≤70-line slices (or Read
  with `limit ≤ 70`). If any result contains `[Mega Saver: compressed`,
  the content is NOT complete — re-run a smaller slice. Never trust a
  compressed footer's elisions when quoting code.
- **Command exit codes:** always `cmd; echo RC=$?`. NEVER pipe through
  `| tail` / `| head` (pipes eat the exit code and bloat output).
- **Vitest scoping:** `pnpm --filter X test -- <files>` does NOT scope to
  files. Use `cd <pkg-dir> && pnpm exec vitest run <file> [<file>…]`.
- **Build deps before cross-package tests:**
  `pnpm -s turbo build --filter @megasaver/<pkg>...` from the repo root
  (tests resolve workspace deps from `dist/`). After editing `stats`,
  rebuild before running `context-gate`/`cli` tests; after `context-gate`,
  rebuild before `daemon`/`cli`; after `llm-proxy`/`proxy-control`, rebuild
  before `cli`.
- **Biome:** `useLiteralKeys` is an ERROR. For index-signature bracket
  access use the repo's exact pattern on the line above:
  `// biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature`
- **exactOptionalPropertyTypes is ON.** Optional fields are omitted via
  conditional spread (`...(x !== undefined ? { x } : {})`), never set to
  `undefined`.
- **Full gate:** `pnpm verify` from the repo root (lint + typecheck + all
  tests). Run it in Task 8; per-task GREEN runs are file-scoped.
- Commits: Conventional Commits, subject ≤ 50 chars, one logical change per
  commit. Do NOT push; do NOT commit this plan file as part of feature
  commits.

**Task order is dependency order:** T1 (stats) → T2 (context-gate) → T3
(cli + daemon) → T4 (llm-proxy) → T5 (audit scope) → T6 (proxy-control) →
T7 (F34 renames) → T8 (changeset + wiki + verify).

---

## Task 1 — stats: event-carried counters + validated reconcile count

Closes the wave-4 accept (counters lost when the summary is unreadable) and
the documented garbage-line re-rebuild ponytail.

**Files**
- Modify: `packages/stats/src/event.ts`
- Modify: `packages/stats/src/store.ts`
- Test: `packages/stats/test/overlay-selfheal.test.ts`
- Test: `packages/stats/test/overlay-lock.test.ts`

Design note (architect contract): `appendOverlayEvent` is unchanged except
that the schema now ACCEPTS the two fields on the event row. It does NOT
copy its `secretsRedacted`/`chunksStored` side args into the row — the
single source for row contents stays the caller-built event object
(record-output starts populating them in Task 2). Summary accumulation
keeps using the side args exactly as today.

### Steps

- [ ] **RED — schema + rebuild tests.** In
  `packages/stats/test/overlay-selfheal.test.ts`:
  - extend the store import to include `readOverlayEvents`:

    ```ts
    import {
      appendOverlayEvent,
      readOverlayEvents,
      readOverlaySummary,
      rebuildOverlaySummaryFromEvents,
    } from "../src/store.js";
    ```

  - add below the existing `corruptSummary()` helper:

    ```ts
    const eventsPath = () => join(root, "stats", WK, `${ID}.events.jsonl`);
    ```

  - append these tests inside the existing
    `describe("E24 self-healing overlay summaries", …)` block:

    ```ts
      it("W5: event rows carrying secretsRedacted/chunksStored parse and expose them", () => {
        mkdirSync(join(root, "stats", WK), { recursive: true });
        writeFileSync(
          eventsPath(),
          `${JSON.stringify({ ...event("e1", 1000), secretsRedacted: 3, chunksStored: 4 })}\n`,
        );
        const events = readOverlayEvents({ root }, WK, ID);
        expect(events).toHaveLength(1);
        expect(events[0]?.secretsRedacted).toBe(3);
        expect(events[0]?.chunksStored).toBe(4);
      });

      it("W5: rebuild WITHOUT carryForward recovers counters from post-w5 events", () => {
        mkdirSync(join(root, "stats", WK), { recursive: true });
        writeFileSync(
          eventsPath(),
          `${[
            JSON.stringify({ ...event("e1", 1000), secretsRedacted: 2, chunksStored: 3 }),
            JSON.stringify({ ...event("e2", 1000), secretsRedacted: 1, chunksStored: 2 }),
            JSON.stringify(event("e3", 1000)), // pre-w5 row: folds as 0
          ].join("\n")}\n`,
        );
        const rebuilt = rebuildOverlaySummaryFromEvents({ root }, WK, ID);
        expect(rebuilt.eventsTotal).toBe(3);
        expect(rebuilt.secretsRedactedTotal).toBe(3);
        expect(rebuilt.chunksStoredTotal).toBe(5);
      });

      it("W5: carryForward still WINS over folded counters when present", () => {
        mkdirSync(join(root, "stats", WK), { recursive: true });
        writeFileSync(
          eventsPath(),
          `${JSON.stringify({ ...event("e1", 1000), secretsRedacted: 2, chunksStored: 3 })}\n`,
        );
        const rebuilt = rebuildOverlaySummaryFromEvents({ root }, WK, ID, undefined, {
          secretsRedactedTotal: 10,
          chunksStoredTotal: 20,
        });
        expect(rebuilt.secretsRedactedTotal).toBe(10);
        expect(rebuilt.chunksStoredTotal).toBe(20);
      });
    ```

  (The `event(id, rawBytes)` factory already exists in this file.)

- [ ] **RED — reconcile garbage-line test.** In
  `packages/stats/test/overlay-lock.test.ts`, append inside the existing
  `describe("E26 summary lock + reconciliation", …)` block (the `event(id)`
  factory and `eventsPath()` helper already exist there):

  ```ts
    it("W5: reconcile does not rebuild a healthy summary over a garbage JSONL line", () => {
      appendOverlayEvent({
        store: { root },
        event: event("e1"),
        secretsRedacted: 0,
        chunksStored: 1,
      });
      appendFileSync(eventsPath(), "{{{ torn line\n");
      // summary (eventsTotal 1) matches the 1 schema-valid line — no drift.
      expect(reconcileOverlaySummaries({ root })).toBe(0);
    });
  ```

- [ ] **Run RED:**

  ```bash
  cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-metrics-honesty/packages/stats && pnpm exec vitest run test/overlay-selfheal.test.ts test/overlay-lock.test.ts; echo RC=$?
  ```

  Expect RC=1. Failures: the two counter-carrying rows are DROPPED by the
  `.strict()` schema (`events` length 0 / `eventsTotal` 1, counters 0), and
  reconcile returns 1 (raw line count 2 > eventsTotal 1). The carryForward
  test passes already (regression guard).

- [ ] **Implement — `packages/stats/src/event.ts`.** In
  `overlayTokenSaverEventSchema` ONLY (`tokenSaverEventSchema` unchanged),
  current tail:

  ```ts
      chunkSetId: z.string().min(1).optional(),
      summary: z.string(),
      mode: tokenSaverModeSchema,
    })
    .strict();
  ```

  becomes:

  ```ts
      chunkSetId: z.string().min(1).optional(),
      summary: z.string(),
      mode: tokenSaverModeSchema,
      // W5: event-carried counters. Optional so pre-wave-5 JSONL rows keep
      // parsing; rebuilds fold them so a lost summary no longer zeroes them.
      secretsRedacted: z.number().int().nonnegative().optional(),
      chunksStored: z.number().int().nonnegative().optional(),
    })
    .strict();
  ```

- [ ] **Implement — `packages/stats/src/store.ts`,
  `rebuildOverlaySummaryFromEvents`.** Replace the header comment, current:

  ```ts
  // E24 self-heal: rebuild the summary from the corruption-tolerant JSONL reader
  // and persist it. secretsRedactedTotal / chunksStoredTotal cannot be recovered
  // from events — events carry neither. When the prior summary is still loadable
  // (the normal lock-skip lag path), the caller passes carryForward so those two
  // counters survive; only a genuinely unreadable summary loses them (rebuilt as
  // 0 — no source). A missing events file rebuilds to an empty summary
  // (readOverlayEvents returns []), never a throw.
  ```

  with:

  ```ts
  // E24 self-heal: rebuild the summary from the corruption-tolerant JSONL reader
  // and persist it. secretsRedactedTotal / chunksStoredTotal: carryForward (the
  // loadable prior summary's totals, which include pre-wave-5 history) is
  // authoritative and WINS when present; the fold over event-carried counters
  // (W5 rows) is the recovery path for a genuinely unreadable summary — better
  // than zero, exact for post-wave-5 events, 0 for pre-wave-5 rows. A missing
  // events file rebuilds to an empty summary (readOverlayEvents returns []),
  // never a throw.
  ```

  In the fold loop, current:

  ```ts
    let eventsTotal = 0;
    let rawBytesTotal = 0;
    let returnedBytesTotal = 0;
    let bytesSavedTotal = 0;
    for (const event of events) {
      eventsTotal += 1;
      rawBytesTotal += event.rawBytes;
      returnedBytesTotal += event.returnedBytes;
      bytesSavedTotal += event.bytesSaved;
    }
  ```

  becomes:

  ```ts
    let eventsTotal = 0;
    let rawBytesTotal = 0;
    let returnedBytesTotal = 0;
    let bytesSavedTotal = 0;
    let secretsFolded = 0;
    let chunksFolded = 0;
    for (const event of events) {
      eventsTotal += 1;
      rawBytesTotal += event.rawBytes;
      returnedBytesTotal += event.returnedBytes;
      bytesSavedTotal += event.bytesSaved;
      secretsFolded += event.secretsRedacted ?? 0;
      chunksFolded += event.chunksStored ?? 0;
    }
  ```

  And in the `rebuilt` object, current:

  ```ts
      secretsRedactedTotal: carryForward?.secretsRedactedTotal ?? 0,
      chunksStoredTotal: carryForward?.chunksStoredTotal ?? 0,
  ```

  becomes:

  ```ts
      secretsRedactedTotal: carryForward?.secretsRedactedTotal ?? secretsFolded,
      chunksStoredTotal: carryForward?.chunksStoredTotal ?? chunksFolded,
  ```

- [ ] **Implement — `packages/stats/src/store.ts`,
  `reconcileOverlaySummaries`.** Delete the ponytail comment (fixed),
  current:

  ```ts
  // swallowed so one bad workspace cannot stop the walk.
  // ponytail: line count counts ALL non-empty lines while the rebuild folds only
  // schema-valid ones, so a JSONL with garbage lines is re-rebuilt every sweep —
  // benign (once/day, atomic write); tighten to a validated count if it matters.
  export function reconcileOverlaySummaries(store: StatsStore): number {
  ```

  becomes:

  ```ts
  // swallowed so one bad workspace cannot stop the walk. The drift count uses
  // SCHEMA-VALID lines (same reader the rebuild folds), so garbage lines can
  // no longer trigger a rebuild every sweep; the extra parse is bounded by the
  // once-a-day cadence.
  export function reconcileOverlaySummaries(store: StatsStore): number {
  ```

  Replace the raw line count, current:

  ```ts
        try {
          const lineCount = readFileSync(join(store.root, "stats", workspaceKey, file), "utf8")
            .split("\n")
            .filter((line) => line.trim() !== "").length;
  ```

  becomes:

  ```ts
        try {
          const lineCount = readOverlayEvents(store, workspaceKey, liveSessionId).length;
  ```

  (`readOverlayEvents` is defined later in the same file — no import
  needed. If `readFileSync` becomes unused in this file after the edit,
  leave it — it is used elsewhere in store.ts; verify with
  `grep -n 'readFileSync' packages/stats/src/store.ts` before removing
  anything.)

- [ ] **Run GREEN:**

  ```bash
  cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-metrics-honesty/packages/stats && pnpm exec vitest run; echo RC=$?
  ```

  Expect RC=0 across the whole stats package (the existing
  "reconcile resets secrets/chunks to 0 when the summary is corrupt" test
  still passes: its rows carry no counters, so the fold is 0).

- [ ] **Commit:**

  ```
  feat(stats): events carry secrets/chunks counters
  ```

---

## Task 2 — context-gate F30: honest delivered-bytes accounting + net-negative guard + canonical footer

**Contract adjustment (architect-approved, replaces the spec's
`footerTemplate` callback):** a function value cannot cross the daemon HTTP
boundary (`excerptHandler` receives JSON). The footer builder moves INTO
context-gate as the canonical implementation; callers opt in with a
serializable `includeFooter?: boolean`.

**Files**
- Create: `packages/context-gate/src/recovery-footer.ts`
- Modify: `packages/context-gate/src/record-output.ts`
- Modify: `packages/context-gate/src/index.ts`
- Test (create): `packages/context-gate/test/recovery-footer.test.ts`
- Test (modify): `packages/context-gate/test/record-output.test.ts`

### Steps

- [ ] **RED — footer unit tests.** Create
  `packages/context-gate/test/recovery-footer.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import {
    OVERLAY_CHUNK_LINES,
    buildRecoveryFooter,
    looksPreTruncated,
  } from "../src/recovery-footer.js";

  describe("buildRecoveryFooter", () => {
    const base = {
      rawBytes: 100_000,
      returnedBytes: 200,
      chunkSetId: "cs-1",
      rawLooksTruncated: false,
    };

    it("single chunk keeps the wave-2 wording", () => {
      const f = buildRecoveryFooter({ ...base, chunkCount: 1 });
      expect(f.startsWith("\n\n[Mega Saver: compressed 100000→200 B (~25000→50 tokens, 99.8%).")).toBe(
        true,
      );
      expect(f).toContain('run: mega output chunk "cs-1" "0"');
      expect(f).toContain("proxy_expand_chunk");
      expect(f).not.toContain("chunks of");
      expect(f.endsWith(".]")).toBe(true);
    });

    it("multi chunk advertises N and the id range (no line->id formula)", () => {
      const f = buildRecoveryFooter({ ...base, chunkCount: 5 });
      expect(f).toContain(`stored in 5 chunks of ~${OVERLAY_CHUNK_LINES} lines each`);
      expect(f).toContain('mega output chunk "cs-1" "<i>" (i = 0..4)');
      expect(f).not.toContain("covers lines");
    });

    it("truncated raw switches to the PARTIAL note", () => {
      const f = buildRecoveryFooter({ ...base, chunkCount: 2, rawLooksTruncated: true });
      expect(f).toContain("NOTE: upstream output appears truncated, recovered chunks are PARTIAL");
      expect(f).not.toContain("Full output recoverable");
    });
  });

  describe("looksPreTruncated", () => {
    it("detects a truncation marker in the tail", () => {
      expect(looksPreTruncated(`${"x".repeat(500)}\n[truncated]`)).toBe(true);
    });
    it("ignores a mid-text mention outside the last 256 bytes", () => {
      expect(looksPreTruncated(`output truncated${"x".repeat(500)}`)).toBe(false);
    });
  });
  ```

- [ ] **RED — record accounting tests.** In
  `packages/context-gate/test/record-output.test.ts`:
  - extend the fs import (line 1), current:

    ```ts
    import { mkdtempSync, readFileSync } from "node:fs";
    ```

    becomes:

    ```ts
    import { existsSync, mkdtempSync, readFileSync } from "node:fs";
    ```

  - append a new describe at the end of the file:

    ```ts
    describe("F30 honest delivered-bytes accounting", () => {
      const bigRaw = () => `line ${"x".repeat(40)}\n`.repeat(2000);

      it("persisted returnedBytes equals delivered bytes (markers + footer) with includeFooter", async () => {
        const storeRoot = store();
        const res = await recordAndFilterOverlayOutput({
          storeRoot,
          workspaceKey: WK,
          liveSessionId: SID,
          raw: bigRaw(),
          sourceKind: "command",
          label: "echo big",
          mode: "aggressive",
          storeRawOutput: true,
          includeFooter: true,
        });
        expect(res.decision).toBe("compressed");
        expect(res.returnedText).toContain("[Mega Saver: compressed ");
        expect(res.returnedBytes).toBe(Buffer.byteLength(res.returnedText, "utf8"));
        expect(res.bytesSaved).toBe(res.rawBytes - res.returnedBytes);
        const events = readOverlayEvents({ root: storeRoot }, WK, SID);
        expect(events[0]?.returnedBytes).toBe(res.returnedBytes);
        expect(events[0]?.bytesSaved).toBe(res.bytesSaved);
        expect(events[0]?.savingRatio).toBe(res.savingRatio);
      });

      it("the event row carries secretsRedacted/chunksStored (W5 counters)", async () => {
        const storeRoot = store();
        const res = await recordAndFilterOverlayOutput({
          storeRoot,
          workspaceKey: WK,
          liveSessionId: SID,
          raw: bigRaw(),
          sourceKind: "command",
          label: "echo big",
          mode: "aggressive",
          storeRawOutput: true,
          includeFooter: true,
        });
        const events = readOverlayEvents({ root: storeRoot }, WK, SID);
        expect(events[0]?.chunksStored).toBe(res.chunkCount);
        expect(events[0]?.secretsRedacted).toBe(0);
      });

      it("returnedBytes counts D16 markers even WITHOUT a footer", async () => {
        const storeRoot = store();
        const block = (start: number, n: number, mk: (i: number) => string) =>
          Array.from({ length: n }, (_, i) => mk(start + i));
        const raw = [
          ...block(1, 40, (i) => `info: quiet filler line ${i} ${"x".repeat(10)}`),
          ...block(41, 40, (i) => `ERROR: build exploded at step ${i} ${"x".repeat(10)}`),
          ...block(81, 40, (i) => `info: quiet filler line ${i} ${"x".repeat(10)}`),
          ...block(121, 40, (i) => `FATAL: linker gave up on unit ${i} failure ${"x".repeat(10)}`),
          ...block(161, 40, (i) => `info: quiet filler line ${i} ${"x".repeat(10)}`),
        ].join("\n");
        const r = await recordAndFilterOverlayOutput({
          storeRoot,
          workspaceKey: WK,
          liveSessionId: SID,
          raw,
          sourceKind: "command",
          label: "pnpm verify",
          mode: "aggressive",
          storeRawOutput: true,
          compressFloorBytes: 4000,
        });
        expect(r.decision).toBe("compressed");
        expect(r.returnedText).toMatch(/… \[lines \d+-\d+ omitted\]/);
        expect(r.returnedBytes).toBe(Buffer.byteLength(r.returnedText, "utf8"));
        const events = readOverlayEvents({ root: storeRoot }, WK, SID);
        expect(events[0]?.returnedBytes).toBe(r.returnedBytes);
      });

      it("net-negative guard: degrades to passthrough with ZERO side effects", async () => {
        const storeRoot = store();
        // Small eligible input: summary + full excerpts + footer >= raw.
        const raw = Array.from(
          { length: 12 },
          (_, i) => `ERROR: distinct failure item ${i} qq`,
        ).join("\n");
        const res = await recordAndFilterOverlayOutput({
          storeRoot,
          workspaceKey: WK,
          liveSessionId: SID,
          raw,
          sourceKind: "command",
          label: "small",
          mode: "aggressive",
          storeRawOutput: true,
          includeFooter: true,
          compressFloorBytes: 64,
        });
        expect(res.decision).toBe("passthrough");
        expect(res.returnedText).toBe(raw);
        expect(res.returnedBytes).toBe(res.rawBytes);
        expect(res.bytesSaved).toBe(0);
        expect(res.savingRatio).toBe(0);
        expect(res.chunkSetId).toBeUndefined();
        expect(readOverlayEvents({ root: storeRoot }, WK, SID)).toHaveLength(0);
        expect(existsSync(join(storeRoot, "content", WK, SID))).toBe(false);
      });

      it("footer's displayed returnedBytes matches the persisted value (fixed point)", async () => {
        const storeRoot = store();
        const res = await recordAndFilterOverlayOutput({
          storeRoot,
          workspaceKey: WK,
          liveSessionId: SID,
          raw: bigRaw(),
          sourceKind: "command",
          label: "echo big",
          mode: "aggressive",
          storeRawOutput: true,
          includeFooter: true,
        });
        const m = res.returnedText.match(/compressed (\d+)→(\d+) B/);
        expect(m).not.toBeNull();
        expect(Number(m?.[1])).toBe(res.rawBytes);
        // ≤2-iteration fixed point: displayed size may drift by its own
        // digit-width change in pathological rollovers — documented tolerance.
        expect(Math.abs(Number(m?.[2]) - res.returnedBytes)).toBeLessThanOrEqual(2);
      });
    });
    ```

- [ ] **Run RED:**

  ```bash
  cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-metrics-honesty/packages/context-gate && pnpm exec vitest run test/recovery-footer.test.ts test/record-output.test.ts; echo RC=$?
  ```

  Expect RC=1: recovery-footer.test.ts fails to import (module does not
  exist); the accounting tests fail (no footer in returnedText, persisted
  returnedBytes is the filter's marker-exclusive number, counters absent,
  guard test records an event instead of degrading).

- [ ] **Implement — create
  `packages/context-gate/src/recovery-footer.ts`** (the constant and
  `looksPreTruncated` MOVE here verbatim; the footer text is the exact
  string `apps/cli/src/hooks/saver.ts:343-365` builds today):

  ```ts
  // Matches the generic chunker default; the recovery footer's chunk wording
  // mirrors this. Lives here (not record-output.ts) so record-output can
  // import the footer builder without a cycle.
  export const OVERLAY_CHUNK_LINES = 40;

  // ~4 bytes/token, mirroring output-filter estimateTokens and
  // @megasaver/stats tokensFromBytes. Local copy: one line is cheaper than a
  // package dependency on stats.
  function tokensFromBytes(bytes: number): number {
    return Math.ceil(bytes / 4);
  }

  // The harness can truncate a tool output BEFORE the PostToolUse hook sees it; the
  // stored chunk is then incomplete and "Full output recoverable" would be a lie.
  // Anchored near the END of the buffer (last 256 bytes) to keep false positives low:
  // a mid-text mention of truncation is normal content, not a real cutoff.
  const TRUNCATION_MARKER = /\[truncated\b|output truncated|<truncated\b/i;
  const TRUNCATION_TAIL_BYTES = 256;
  export function looksPreTruncated(raw: string): boolean {
    const tail = raw.length > TRUNCATION_TAIL_BYTES ? raw.slice(-TRUNCATION_TAIL_BYTES) : raw;
    return TRUNCATION_MARKER.test(tail);
  }

  export type RecoveryFooterInput = {
    rawBytes: number;
    returnedBytes: number;
    chunkSetId: string;
    chunkCount: number;
    rawLooksTruncated: boolean;
  };

  // Canonical recovery footer (F30): built INSIDE record-output so the
  // persisted returnedBytes/bytesSaved count it. Wording is byte-identical to
  // the pre-wave-5 hook footer so e2e fixtures shift minimally. Advertise
  // chunk IDS, never a line->id formula: chunks index the REDACTED stored
  // text, while the agent sees the original tool output's line numbers.
  export function buildRecoveryFooter(input: RecoveryFooterInput): string {
    const rawTokens = tokensFromBytes(input.rawBytes);
    const returnedTokens = tokensFromBytes(input.returnedBytes);
    const tokenPct =
      rawTokens === 0 ? "0.0" : ((1 - returnedTokens / rawTokens) * 100).toFixed(1);
    const n = input.chunkCount;
    const L = OVERLAY_CHUNK_LINES;
    const expandCmd =
      n > 1
        ? `— stored in ${n} chunks of ~${L} lines each; fetch any with: mega output chunk "${input.chunkSetId}" "<i>" (i = 0..${n - 1})`
        : `— run: mega output chunk "${input.chunkSetId}" "0"`;
    const partialNoun = n > 1 ? "recovered chunks are" : "recovered chunk is";
    const recovery = input.rawLooksTruncated
      ? `NOTE: upstream output appears truncated, ${partialNoun} PARTIAL, not complete ${expandCmd} (or MCP proxy_expand_chunk if connected)`
      : `Full output recoverable ${expandCmd} (or MCP proxy_expand_chunk if connected)`;
    return `\n\n[Mega Saver: compressed ${input.rawBytes}→${input.returnedBytes} B (~${rawTokens}→${returnedTokens} tokens, ${tokenPct}%). ${recovery}.]`;
  }
  ```

- [ ] **Implement — `packages/context-gate/src/record-output.ts`.**
  1. Remove the local constant, current:

     ```ts
     // Matches the generic chunker default; the saver footer's line->id formula
     // mirrors this.
     export const OVERLAY_CHUNK_LINES = 40;
     ```

     and add the import (after the existing imports):

     ```ts
     import { OVERLAY_CHUNK_LINES, buildRecoveryFooter, looksPreTruncated } from "./recovery-footer.js";
     ```

  2. In `RecordOverlayOutputInput`, after the `intent?: string;` field add:

     ```ts
       // F30: when true and the decision compresses with a stored chunk set, the
       // canonical recovery footer is appended to returnedText INSIDE record so
       // the persisted returnedBytes/bytesSaved count everything the model
       // receives. Callers must NOT append their own footer.
       includeFooter?: boolean;
     ```

  3. Replace the body of `recordAndFilterOverlayOutput` from the `base`
     object to the end of the function. Current code (abridged anchors —
     the block starting at `const base = {` through the final
     `return { ...base, ...(chunkSetId !== undefined ? { chunkSetId, chunkCount: chunksStored } : {}) };`)
     is REPLACED with:

     ```ts
       if (filtered.decision !== "compressed") {
         return {
           decision: filtered.decision,
           summary: filtered.summary,
           returnedText: returnedTextOf(filtered),
           rawBytes: filtered.rawBytes,
           returnedBytes: filtered.returnedBytes,
           bytesSaved: filtered.bytesSaved,
           savingRatio: filtered.savingRatio,
         };
       }

       const createdAt = now();
       const { redacted: redactedText, count: secretCount } = redact(input.raw);
       // The label is itself secret-bearing (full command line, fetch URL, file
       // path). Redact it before it reaches the persisted chunk-set source and the
       // overlay stats event — mirrors policyRedactSourceRef on the evidence path.
       const redactedLabel = redact(input.label).redacted;

       // Chunk pieces are prepared IN MEMORY first: the footer needs chunkCount
       // and the net-negative guard below must run before any side effect.
       let chunkSetId: string | undefined;
       let chunks: OverlayChunkSet["chunks"] = [];
       if (input.storeRawOutput) {
         chunkSetId = newId();
         const pieces =
           redactedText === ""
             ? [{ text: "", startLine: 1, endLine: 1 }]
             : chunkByLines(redactedText, OVERLAY_CHUNK_LINES);
         chunks = pieces.map((piece, i) => ({
           id: String(i),
           startLine: piece.startLine,
           endLine: piece.endLine,
           bytes: Buffer.byteLength(piece.text, "utf8"),
           text: piece.text,
         }));
       }

       // F30 honest accounting: persisted numbers count the bytes the model
       // actually receives — summary + excerpts + D16 markers, plus the recovery
       // footer when the caller asks for one.
       const text0 = returnedTextOf(filtered);
       let finalText = text0;
       if (input.includeFooter === true && chunkSetId !== undefined) {
         const text0Bytes = Buffer.byteLength(text0, "utf8");
         const footerInput = {
           rawBytes: filtered.rawBytes,
           chunkSetId,
           chunkCount: chunks.length,
           rawLooksTruncated: looksPreTruncated(input.raw),
         };
         let footer = buildRecoveryFooter({ ...footerInput, returnedBytes: text0Bytes });
         // Fixed point on the displayed size: the footer's own bytes are part of
         // the delivered size it reports. One correction pass almost always
         // converges; the second absorbs a digit-width rollover. A rollover ON
         // the second pass is accepted — the display drifts by at most its own
         // digit-width change, while the PERSISTED numbers stay exact byte
         // counts of the final text.
         for (let i = 0; i < 2; i++) {
           const next = buildRecoveryFooter({
             ...footerInput,
             returnedBytes: text0Bytes + Buffer.byteLength(footer, "utf8"),
           });
           if (Buffer.byteLength(next, "utf8") === Buffer.byteLength(footer, "utf8")) {
             footer = next;
             break;
           }
           footer = next;
         }
         finalText = text0 + footer;
       }
       const finalReturnedBytes = Buffer.byteLength(finalText, "utf8");

       // Net-negative guard, BEFORE any side effect (saveOverlayChunkSet,
       // appendOverlayEvent, evidence): never deliver a replacement at least as
       // large as the original. Degrading to passthrough also structurally
       // preserves the honest-metrics invariant returnedTokens <= rawTokens.
       if (finalReturnedBytes >= filtered.rawBytes) {
         return {
           decision: "passthrough",
           summary: filtered.summary,
           returnedText: input.raw,
           rawBytes: filtered.rawBytes,
           returnedBytes: filtered.rawBytes,
           bytesSaved: 0,
           savingRatio: 0,
         };
       }

       const bytesSaved = filtered.rawBytes - finalReturnedBytes;
       const savingRatio = bytesSaved / filtered.rawBytes;

       // A throw here is fine: the PostToolUse hook caller treats any failure as
       // passthrough (the original output reaches the model untouched), so a partial
       // write (chunk saved, event throws) is acceptable — no evidence is lost.
       let chunksStored = 0;
       let chunkRefs: ReturnedChunkRef[] = [];
       if (input.storeRawOutput && chunkSetId !== undefined) {
         const csid = chunkSetId;
         const chunkSet: OverlayChunkSet = {
           chunkSetId,
           workspaceKey: input.workspaceKey,
           liveSessionId: input.liveSessionId,
           createdAt,
           source: chunkSetSource(input.sourceKind, redactedLabel),
           rawBytes: filtered.rawBytes,
           redacted: secretCount > 0,
           chunks,
         };
         // Store the full redacted output (not just kept excerpts) so the agent can
         // recover EVERYTHING via expand — split into fixed 40-line chunks so an
         // expansion fetches only the needed slice (C12), not the whole raw again.
         await saveOverlayChunkSet({ storeRoot: input.storeRoot, chunkSet });
         chunksStored = chunks.length;
         chunkRefs = chunks.map((c) => ({ chunkSetId: csid, chunkId: c.id }));
       }

       appendOverlayEvent({
         store: { root: input.storeRoot },
         event: {
           id: newId(),
           liveSessionId: input.liveSessionId,
           workspaceKey: input.workspaceKey,
           createdAt,
           sourceKind: input.sourceKind,
           label: redactedLabel,
           rawBytes: filtered.rawBytes,
           returnedBytes: finalReturnedBytes,
           bytesSaved,
           savingRatio,
           ...(chunkSetId !== undefined ? { chunkSetId } : {}),
           summary: filtered.summary,
           mode: input.mode,
           // W5: event-carried counters — rebuilds recover them without
           // carryForward when the summary file is lost.
           secretsRedacted: secretCount,
           chunksStored,
         },
         secretsRedacted: secretCount,
         chunksStored,
       });

       // Evidence write: only when chunk was persisted AND a store is configured.
       // Fire-and-await but swallowed: evidence failure must never block compressed output
       // (same fail-safe posture as appendOverlayEvent above).
       if (input.evidenceStoreRoot !== undefined && chunkSetId !== undefined) {
         const { redacted: redactedReturnedText } = redact(finalText);
         const evidenceRecord: EvidenceRecordInput = {
           evidenceId: newId(),
           // workspaceKey in RecordOverlayOutputInput is plain string; evidence schema
           // requires the branded WorkspaceKey — the value is already validated upstream
           // by the overlay event path, so this cast is safe at the call boundary.
           workspaceKey: input.workspaceKey as WorkspaceKey,
           sessionRef: { kind: "live", id: input.liveSessionId },
           // OutputSourceKind values are a strict subset of SourceKind — cast is safe.
           sourceKind: input.sourceKind as SourceKind,
           // sourceRef redaction is handled by the policyRedactSourceRef port passed
           // to appendEvidence below — do NOT pre-redact here (single responsibility).
           sourceRef: { label: input.label },
           classification: input.sourceKind,
           redactionReport: {
             redacted: secretCount > 0,
             highRiskFindings: secretCount,
             unresolvedHighRisk: false,
           },
           redactedRawContent: redactedText,
           redactedReturnedContent: redactedReturnedText,
           redactedRawChunkSetId: chunkSetId,
           returnedChunkRefs: chunkRefs,
           createdAt,
           expiresAt: null,
           retentionClass: "session",
           policyVersion: "1",
           pipelineVersion: "1",
         };
         try {
           await appendEvidence({
             storeRoot: input.evidenceStoreRoot,
             redactSourceRef: policyRedactSourceRef,
             record: evidenceRecord,
           });
         } catch {
           // Best-effort: evidence failure must never surface to the caller.
         }
       }

       return {
         decision: "compressed",
         summary: filtered.summary,
         returnedText: finalText,
         rawBytes: filtered.rawBytes,
         returnedBytes: finalReturnedBytes,
         bytesSaved,
         savingRatio,
         ...(chunkSetId !== undefined ? { chunkSetId, chunkCount: chunksStored } : {}),
       };
     }
     ```

     This deletes the old `base` object together with its F30 deferral
     comment ("reported savings are marginally optimistic by the marker
     bytes … deferred to wave-5 (F30)").

- [ ] **Implement — `packages/context-gate/src/index.ts`.** In the
  record-output export block, current:

  ```ts
  export {
    recordAndFilterOverlayOutput,
    type RecordOverlayOutputInput,
    type RecordOverlayOutputResult,
    OVERLAY_CHUNK_LINES,
  } from "./record-output.js";
  ```

  becomes:

  ```ts
  export {
    recordAndFilterOverlayOutput,
    type RecordOverlayOutputInput,
    type RecordOverlayOutputResult,
  } from "./record-output.js";
  export {
    OVERLAY_CHUNK_LINES,
    buildRecoveryFooter,
    looksPreTruncated,
    type RecoveryFooterInput,
  } from "./recovery-footer.js";
  ```

  (External importers of `OVERLAY_CHUNK_LINES` via the package entry are
  unaffected. Sanity: `grep -rn 'OVERLAY_CHUNK_LINES' apps packages --include='*.ts' | grep -v dist`.)

- [ ] **Run GREEN (whole package — other record tests must not regress):**

  ```bash
  cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-metrics-honesty/packages/context-gate && pnpm exec vitest run; echo RC=$?
  ```

  Expect RC=0. If any pre-existing test pinned the filter-level
  `returnedBytes` equality on the compressed path, re-baseline it to the
  delivered-bytes number (update, don't weaken — assert
  `returnedBytes === Buffer.byteLength(returnedText, "utf8")`).

- [ ] **Commit:**

  ```
  feat(context-gate): honest delivered-byte counts
  ```

---

## Task 3 — cli + daemon wiring: footer comes from record

**Files**
- Modify: `apps/cli/src/hooks/saver.ts`
- Modify: `packages/daemon/src/handlers.ts`
- Verify (no change expected): `apps/cli/src/hooks/saver-run.ts`
- Test (modify): `apps/cli/test/hooks/saver.test.ts`
- Test (modify): `packages/daemon/test/handlers.test.ts`
- Verify (no change expected): `apps/cli/test/hooks/saver-worktree-inheritance.test.ts`

### Steps

- [ ] **Build upstream first:**

  ```bash
  cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-metrics-honesty && pnpm -s turbo build --filter @megasaver/stats... ; echo RC=$?
  ```

  (This covers context-gate, core, daemon, cli as dependents.)

- [ ] **RED — daemon schema test.** In
  `packages/daemon/test/handlers.test.ts`, append inside
  `describe("excerptHandler", …)`:

  ```ts
    it("F30: /excerpt accepts includeFooter and the result carries the footer", async () => {
      const res = await excerptHandler(store, {
        workspaceKey: "ws",
        liveSessionId: "live1",
        raw: bigRaw,
        sourceKind: "command",
        label: "test",
        mode: "aggressive",
        storeRawOutput: true,
        includeFooter: true,
      });
      expect(res.status).toBe(200);
      expect(res.json.decision).toBe("compressed");
      expect(String(res.json.returnedText)).toContain("[Mega Saver: compressed ");
    });
  ```

- [ ] **RED — saver hook tests.** In `apps/cli/test/hooks/saver.test.ts`:
  - update the `RECORDED` factory (top of file), current:

    ```ts
    const RECORDED = {
      decision: "compressed" as const,
      summary: "SUMMARY",
      returnedText: "SHORT",
      rawBytes: 100_000,
      returnedBytes: 200,
      bytesSaved: 99_800,
      savingRatio: 0.998,
      chunkSetId: "cs-1",
      chunkCount: 1,
    };
    ```

    becomes (the footer text is exactly what `buildRecoveryFooter`
    produces for these numbers — record now returns it inside
    `returnedText`):

    ```ts
    const FOOTER =
      '\n\n[Mega Saver: compressed 100000→200 B (~25000→50 tokens, 99.8%). Full output recoverable — run: mega output chunk "cs-1" "0" (or MCP proxy_expand_chunk if connected).]';
    const RECORDED = {
      decision: "compressed" as const,
      summary: "SUMMARY",
      returnedText: `SHORT${FOOTER}`,
      rawBytes: 100_000,
      returnedBytes: 200,
      bytesSaved: 99_800,
      savingRatio: 0.998,
      chunkSetId: "cs-1",
      chunkCount: 1,
    };
    ```

  - replace the `describe("N-aware recovery footer (C12)", …)` block (its
    two tests asserted hook-side footer WORDING, which now lives in
    context-gate's `recovery-footer.test.ts` — moved, not weakened) with:

    ```ts
    describe("footer comes from record (F30)", () => {
      it("emits recorded.returnedText verbatim — no hook-side footer appending", async () => {
        const d = deps();
        const out = await buildSaverDecision(bigBash("X".repeat(50_000)), d);
        const u = (out as { updatedToolOutput: { stdout: string } }).updatedToolOutput;
        expect(u.stdout).toBe(RECORDED.returnedText);
      });

      it("asks record() to include the footer", async () => {
        const d = deps();
        await buildSaverDecision(bigBash("X".repeat(50_000)), d);
        expect(d.record).toHaveBeenCalledWith(expect.objectContaining({ includeFooter: true }));
      });
    });
    ```

- [ ] **Run RED:**

  ```bash
  cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-metrics-honesty/packages/daemon && pnpm exec vitest run test/handlers.test.ts; echo RC=$?
  cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-metrics-honesty/apps/cli && pnpm exec vitest run test/hooks/saver.test.ts; echo RC=$?
  ```

  Expect both RC=1: daemon 400s on the unknown strict key `includeFooter`;
  the hook still appends its own pointer, so `u.stdout` is
  `RECORDED.returnedText` + a SECOND footer, and no `includeFooter` is
  passed to record.

- [ ] **Implement — `packages/daemon/src/handlers.ts`.** Schema, current:

  ```ts
      intent: z.string().min(1).optional(),
      compressFloorBytes: z.number().int().positive().optional(),
    })
    .strict();
  ```

  becomes:

  ```ts
      intent: z.string().min(1).optional(),
      compressFloorBytes: z.number().int().positive().optional(),
      includeFooter: z.boolean().optional(),
    })
    .strict();
  ```

  Handler forwarding, current:

  ```ts
    const { intent, compressFloorBytes, ...rest } = parsed.data;
    const result = await recordAndFilterOverlayOutput({
      storeRoot,
      evidenceStoreRoot: storeRoot,
      ...rest,
      // ponytail: exactOptionalPropertyTypes — omit key entirely when absent
      ...(intent !== undefined ? { intent } : {}),
      ...(compressFloorBytes !== undefined ? { compressFloorBytes } : {}),
    });
  ```

  becomes:

  ```ts
    const { intent, compressFloorBytes, includeFooter, ...rest } = parsed.data;
    const result = await recordAndFilterOverlayOutput({
      storeRoot,
      evidenceStoreRoot: storeRoot,
      ...rest,
      // ponytail: exactOptionalPropertyTypes — omit key entirely when absent
      ...(intent !== undefined ? { intent } : {}),
      ...(compressFloorBytes !== undefined ? { compressFloorBytes } : {}),
      ...(includeFooter !== undefined ? { includeFooter } : {}),
    });
  ```

- [ ] **Implement — `apps/cli/src/hooks/saver.ts`.**
  1. Imports (line 1 and the core import), current:

     ```ts
     import { type FailureKind, OVERLAY_CHUNK_LINES } from "@megasaver/context-gate";
     import {
       type RecordOverlayOutputInput,
       type RecordOverlayOutputResult,
       tokensFromBytes,
     } from "@megasaver/core";
     ```

     becomes:

     ```ts
     import type { FailureKind } from "@megasaver/context-gate";
     import type {
       RecordOverlayOutputInput,
       RecordOverlayOutputResult,
     } from "@megasaver/core";
     ```

  2. Delete the local `looksPreTruncated` block (moved verbatim into
     context-gate in Task 2), current:

     ```ts
     // The harness can truncate a tool output BEFORE the PostToolUse hook sees it; the
     // stored chunk is then incomplete and "Full output recoverable" would be a lie.
     // Anchored near the END of the buffer (last 256 bytes) to keep false positives low:
     // a mid-text mention of truncation is normal content, not a real cutoff.
     const TRUNCATION_MARKER = /\[truncated\b|output truncated|<truncated\b/i;
     const TRUNCATION_TAIL_BYTES = 256;
     function looksPreTruncated(raw: string): boolean {
       const tail = raw.length > TRUNCATION_TAIL_BYTES ? raw.slice(-TRUNCATION_TAIL_BYTES) : raw;
       return TRUNCATION_MARKER.test(tail);
     }
     ```

  3. The record call gains `includeFooter: true`, current:

     ```ts
         storeRawOutput: true,
         // B8: the gate above is the single eligibility authority; record()
         // collapses the filter thresholds onto it.
         compressFloorBytes: floorBytes,
     ```

     becomes:

     ```ts
         storeRawOutput: true,
         // F30: the recovery footer is built INSIDE record() so the persisted
         // numbers count it; returnedText comes back ready-to-emit.
         includeFooter: true,
         // B8: the gate above is the single eligibility authority; record()
         // collapses the filter thresholds onto it.
         compressFloorBytes: floorBytes,
     ```

  4. Delete the ENTIRE pointer-building tail and return the recorded text
     directly. Current (from `const rawTokens = …` through the final
     return):

     ```ts
       const rawTokens = tokensFromBytes(recorded.rawBytes);
       const returnedTokens = tokensFromBytes(recorded.returnedBytes);
       const tokenPct = rawTokens === 0 ? "0.0" : ((1 - returnedTokens / rawTokens) * 100).toFixed(1);
       const n = recorded.chunkCount ?? 1;
       const L = OVERLAY_CHUNK_LINES;
       // Advertise chunk IDS, never a line->id formula: chunks index the REDACTED
       // stored text, while the agent sees the original tool output's line numbers
       // (a multi-line secret redacts to one line, shifting the two spaces apart).
       // Fetch by id 0..n-1 is correct regardless.
       const expandCmd =
         n > 1
           ? `— stored in ${n} chunks of ~${L} lines each; fetch any with: mega output chunk "${recorded.chunkSetId}" "<i>" (i = 0..${n - 1})`
           : `— run: mega output chunk "${recorded.chunkSetId}" "0"`;
       const partialNoun = n > 1 ? "recovered chunks are" : "recovered chunk is";
       const recovery = looksPreTruncated(shape.raw)
         ? `NOTE: upstream output appears truncated, ${partialNoun} PARTIAL, not complete ${expandCmd} (or MCP proxy_expand_chunk if connected)`
         : `Full output recoverable ${expandCmd} (or MCP proxy_expand_chunk if connected)`;
       const pointer = recorded.chunkSetId
         ? `\n\n[Mega Saver: compressed ${recorded.rawBytes}→${recorded.returnedBytes} B (~${rawTokens}→${returnedTokens} tokens, ${tokenPct}%). ${recovery}.]`
         : "";
       return { updatedToolOutput: shape.rebuild(`${recorded.returnedText}${pointer}`) };
     }
     ```

     becomes:

     ```ts
       return { updatedToolOutput: shape.rebuild(recorded.returnedText) };
     }
     ```

- [ ] **Verify saver-run passthrough (read-only check).**
  `apps/cli/src/hooks/saver-run.ts` `makeRecord` strips ONLY
  `storeRoot`/`evidenceStoreRoot`/`now`/`newId` from the daemon body:

  ```ts
            const {
              storeRoot: _sr,
              evidenceStoreRoot: _esr,
              now: _now,
              newId: _nid,
              ...daemonBody
            } = input;
  ```

  `includeFooter` rides through in `daemonBody`. No change needed —
  confirm by reading `apps/cli/src/hooks/saver-run.ts:99-115`.

- [ ] **Run GREEN + re-baseline sweep:**

  ```bash
  cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-metrics-honesty/packages/daemon && pnpm exec vitest run; echo RC=$?
  cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-metrics-honesty && pnpm -s turbo build --filter @megasaver/daemon... ; echo RC=$?
  cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-metrics-honesty/apps/cli && pnpm exec vitest run test/hooks/saver.test.ts test/hooks/saver-worktree-inheritance.test.ts; echo RC=$?
  ```

  Expect RC=0. `saver-worktree-inheritance.test.ts:106` uses the real
  record path and only asserts `toContain("Mega Saver: compressed")` — the
  footer now arrives via `recorded.returnedText`, so it passes unchanged.
  If any other saver test still asserts old footer text against the stub,
  re-baseline it against `RECORDED.returnedText`/`FOOTER` (grep:
  `grep -n 'Mega Saver\|output chunk' apps/cli/test/hooks/saver.test.ts`).

- [ ] **Commit:**

  ```
  feat(cli): saver footer via record accounting
  ```

---

## Task 4 — F32: corruption-tolerant proxy usage reader

**Files**
- Modify: `packages/llm-proxy/src/store.ts`
- Modify: `packages/llm-proxy/src/index.ts`
- Modify: `apps/cli/src/commands/audit/usage.ts`
- Test (modify): `packages/llm-proxy/test/store.test.ts`
- Test (modify): `apps/cli/test/audit-usage.test.ts`

### Steps

- [ ] **RED — reader test.** In `packages/llm-proxy/test/store.test.ts`:
  - extend imports:

    ```ts
    import { appendFileSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync } from "node:fs";
    ```

    and:

    ```ts
    import { appendProxyUsage, listProxyUsage, proxyUsageLogPath, readProxyUsage } from "../src/store.js";
    ```

  - append inside `describe("proxy usage store", …)`:

    ```ts
      it("F32: a torn line between two valid rows is skipped and counted", async () => {
        await appendProxyUsage({ storeRoot: root, event: mk({ id: "a" }) });
        appendFileSync(proxyUsageLogPath(root), '{"id":"torn\n');
        await appendProxyUsage({ storeRoot: root, event: mk({ id: "b" }) });
        const { events, skippedLines } = await readProxyUsage({ storeRoot: root });
        expect(events.map((e) => e.id)).toEqual(["a", "b"]);
        expect(skippedLines).toBe(1);
        // compat delegate: listProxyUsage no longer throws on a torn line
        expect((await listProxyUsage({ storeRoot: root })).map((e) => e.id)).toEqual(["a", "b"]);
      });
    ```

- [ ] **RED — audit render test.** In `apps/cli/test/audit-usage.test.ts`,
  append inside `describe("audit usage", …)`:

  ```ts
    it("F32: renders the skipped-line note when the reader reports torn lines", async () => {
      const out = await runAuditUsage({
        ...base,
        readSaved: () => 100,
        readUsage: async () => ({ events: [event(1000, 0, 0, 0)], skippedLines: 2 }),
      });
      expect(out).toContain("⚠ 2 unreadable usage lines skipped");
    });
  ```

  And migrate every existing `listUsage:` injection in this file to
  `readUsage:` (5 sites):
  - `listUsage: async () => []` →
    `readUsage: async () => ({ events: [], skippedLines: 0 })`
  - `listUsage: async () => [event(9000, 0, 0, 500)]` →
    `readUsage: async () => ({ events: [event(9000, 0, 0, 500)], skippedLines: 0 })`
  - `listUsage: async () => [event(1000, 0, 90000, 0)]` →
    `readUsage: async () => ({ events: [event(1000, 0, 90000, 0)], skippedLines: 0 })`
  - `listUsage: async () => [event(1000, 0, 0, 100)]` →
    `readUsage: async () => ({ events: [event(1000, 0, 0, 100)], skippedLines: 0 })`
  - the three-event windowing injection, current:

    ```ts
        listUsage: async () => [
          { ...event(1000, 0, 0, 0), ts: "2026-07-01T12:00:00.000Z" },
          { ...event(1000, 0, 0, 0), ts: "2026-07-01T08:00:00.000Z" }, // earliest
          { ...event(1000, 0, 0, 0), ts: "2026-07-01T20:00:00.000Z" },
        ],
    ```

    becomes:

    ```ts
        readUsage: async () => ({
          events: [
            { ...event(1000, 0, 0, 0), ts: "2026-07-01T12:00:00.000Z" },
            { ...event(1000, 0, 0, 0), ts: "2026-07-01T08:00:00.000Z" }, // earliest
            { ...event(1000, 0, 0, 0), ts: "2026-07-01T20:00:00.000Z" },
          ],
          skippedLines: 0,
        }),
    ```

- [ ] **Run RED:**

  ```bash
  cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-metrics-honesty/packages/llm-proxy && pnpm exec vitest run test/store.test.ts; echo RC=$?
  cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-metrics-honesty/apps/cli && pnpm exec vitest run test/audit-usage.test.ts; echo RC=$?
  ```

  Expect both RC=1 (`readProxyUsage` does not exist; `readUsage` is not an
  accepted input).

- [ ] **Implement — `packages/llm-proxy/src/store.ts`.** Update the header
  comment, current:

  ```ts
  // The usage log's canonical location. Exported so read-only consumers (the
  // cache doctor) can do their own tolerant per-line parse — listProxyUsage is
  // strict by design and throws on a corrupt line.
  ```

  becomes:

  ```ts
  // The usage log's canonical location, shared by the tolerant reader below
  // and any read-only consumer that wants the raw file.
  ```

  Replace `listProxyUsage`, current:

  ```ts
  export async function listProxyUsage(input: {
    storeRoot: string;
  }): Promise<readonly ProxyUsageEvent[]> {
    let raw: string;
    try {
      raw = readFileSync(proxyUsageLogPath(input.storeRoot), "utf8");
    } catch (e) {
      if (isErrno(e) && e.code === "ENOENT") return [];
      throw e;
    }
    const out: ProxyUsageEvent[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      out.push(proxyUsageEventSchema.parse(JSON.parse(trimmed)));
    }
    return out;
  }
  ```

  becomes:

  ```ts
  export type ReadProxyUsageResult = {
    events: readonly ProxyUsageEvent[];
    skippedLines: number;
  };

  // F32 parity with the overlay events reader: one torn/garbage line must not
  // zero every future report. Invalid lines are skipped and COUNTED so loss
  // becomes visible upstream instead of silent.
  export async function readProxyUsage(input: {
    storeRoot: string;
  }): Promise<ReadProxyUsageResult> {
    let raw: string;
    try {
      raw = readFileSync(proxyUsageLogPath(input.storeRoot), "utf8");
    } catch (e) {
      if (isErrno(e) && e.code === "ENOENT") return { events: [], skippedLines: 0 };
      throw e;
    }
    const events: ProxyUsageEvent[] = [];
    let skippedLines = 0;
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        events.push(proxyUsageEventSchema.parse(JSON.parse(trimmed)));
      } catch {
        skippedLines += 1;
      }
    }
    return { events, skippedLines };
  }

  export async function listProxyUsage(input: {
    storeRoot: string;
  }): Promise<readonly ProxyUsageEvent[]> {
    return (await readProxyUsage(input)).events;
  }
  ```

  (`appendProxyUsage` and the symlink guard are untouched.)

- [ ] **Implement — `packages/llm-proxy/src/index.ts`.** Current line:

  ```ts
  export { appendProxyUsage, listProxyUsage, proxyUsageLogPath } from "./store.js";
  ```

  becomes:

  ```ts
  export {
    appendProxyUsage,
    listProxyUsage,
    proxyUsageLogPath,
    readProxyUsage,
    type ReadProxyUsageResult,
  } from "./store.js";
  ```

- [ ] **Implement — `apps/cli/src/commands/audit/usage.ts`.**
  1. Import, current:

     ```ts
     import { listProxyUsage } from "@megasaver/llm-proxy";
     ```

     becomes:

     ```ts
     import { type ProxyUsageEvent, readProxyUsage } from "@megasaver/llm-proxy";
     ```

  2. `renderUsageReport` gains the skipped count. Signature, current:

     ```ts
     export function renderUsageReport(m: ProxyUsageSavings): string {
     ```

     becomes:

     ```ts
     export function renderUsageReport(m: ProxyUsageSavings, skippedLines: number): string {
     ```

     Add directly under the `n` helper:

     ```ts
       const skipNote =
         skippedLines > 0 ? ["", `⚠ ${skippedLines} unreadable usage lines skipped`] : [];
     ```

     and append `...skipNote` to each of the three returned arrays (the
     onboarding branch, the `!m.reliable` branch, and the final branch) as
     the last spread before `.join("\n")`.

  3. `RunAuditUsageInput`, current:

     ```ts
       // Injectable for tests; default to the real on-disk readers. `readSaved`
       // returns saved TOKENS within [sinceMs, now].
       listUsage?: typeof listProxyUsage;
       readSaved?: (storeRoot: string, workspaceKey: string, sinceMs: number) => number;
     ```

     becomes:

     ```ts
       // Injectable for tests; default to the real on-disk readers. `readSaved`
       // returns saved TOKENS within [sinceMs, now].
       readUsage?: typeof readProxyUsage;
       readSaved?: (storeRoot: string, workspaceKey: string, sinceMs: number) => number;
     ```

  4. In `runAuditUsage`, current:

     ```ts
       const readSaved = input.readSaved ?? readWorkspaceSavedTokensSince;
       const listUsage = input.listUsage ?? listProxyUsage;

       let usage: Awaited<ReturnType<typeof listProxyUsage>> = [];
       try {
         usage = await listUsage({ storeRoot: input.storeRoot });
       } catch {
         // No proxy-usage log yet.
       }
     ```

     becomes:

     ```ts
       const readSaved = input.readSaved ?? readWorkspaceSavedTokensSince;
       const readUsage = input.readUsage ?? readProxyUsage;

       let usage: readonly ProxyUsageEvent[] = [];
       let skippedLines = 0;
       try {
         const read = await readUsage({ storeRoot: input.storeRoot });
         usage = read.events;
         skippedLines = read.skippedLines;
       } catch {
         // No proxy-usage log yet.
       }
     ```

     and the final return, current:

     ```ts
       const savings = proxyUsageSavings({ savedTokens, usage });
       return input.json ? JSON.stringify(savings) : renderUsageReport(savings);
     ```

     becomes:

     ```ts
       const savings = proxyUsageSavings({ savedTokens, usage });
       return input.json
         ? JSON.stringify({ ...savings, skippedLines })
         : renderUsageReport(savings, skippedLines);
     ```

- [ ] **Run GREEN:**

  ```bash
  cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-metrics-honesty/packages/llm-proxy && pnpm exec vitest run; echo RC=$?
  cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-metrics-honesty && pnpm -s turbo build --filter @megasaver/llm-proxy... ; echo RC=$?
  cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-metrics-honesty/apps/cli && pnpm exec vitest run test/audit-usage.test.ts; echo RC=$?
  ```

  Expect RC=0. Also confirm no other production caller depended on
  `listProxyUsage` THROWING on corrupt lines:
  `grep -rn 'listProxyUsage' apps packages --include='*.ts' | grep -v dist | grep -v test`
  (expected: only `audit/usage.ts` before this task, now migrated).

- [ ] **Commit:**

  ```
  fix(llm-proxy): tolerate torn usage lines
  ```

---

## Task 5 — F33: scope-matched audit ratios

The numerator becomes GLOBAL (all workspaces summed) so it matches the
global usage denominator; a per-workspace savings breakdown is added
(without ratios — usage cannot be attributed per workspace today), and the
scoped-ratio branch for future `workspaceKey`-stamped rows is written now.

**Files**
- Modify: `packages/llm-proxy/src/usage-event.ts`
- Modify: `apps/cli/src/commands/audit/usage.ts`
- Test (modify): `apps/cli/test/audit-usage.test.ts`

### Steps

- [ ] **RED — tests.** In `apps/cli/test/audit-usage.test.ts`, append:

  ```ts
    it("F33: the ratio divides GLOBAL savings by global usage (all workspaces summed)", async () => {
      const out = await runAuditUsage({
        ...base,
        readSavedAll: () => ({ totalTokens: 1000, byWorkspace: { "wk-a": 700, "wk-b": 300 } }),
        readUsage: async () => ({ events: [event(9000, 0, 0, 500)], skippedLines: 0 }),
      });
      expect(out).toContain("scope: all workspaces (global)");
      // 1000 / (1000 + 9000) — NOT just the cwd workspace's share
      expect(out).toContain("saved of new context:       10.0%");
    });

    it("F33: renders the per-workspace savings breakdown without ratios", async () => {
      const out = await runAuditUsage({
        ...base,
        readSavedAll: () => ({ totalTokens: 1000, byWorkspace: { "wk-a": 700, "wk-b": 300 } }),
        readUsage: async () => ({ events: [event(9000, 0, 0, 500)], skippedLines: 0 }),
      });
      expect(out).toContain("savings by workspace");
      expect(out).toContain("wk-a  ~700 tokens");
      expect(out).toContain("wk-b  ~300 tokens");
      expect(out).not.toMatch(/wk-a.*%/);
    });

    it("F33: usage rows carrying workspaceKey get a scoped ratio; keyless stay global", async () => {
      const out = await runAuditUsage({
        ...base,
        readSavedAll: () => ({ totalTokens: 1000, byWorkspace: { "wk-a": 600, "wk-b": 400 } }),
        readUsage: async () => ({
          events: [
            { ...event(2400, 0, 0, 0), workspaceKey: "wk-a" },
            event(5000, 0, 0, 0), // keyless -> global bucket
          ],
          skippedLines: 0,
        }),
      });
      expect(out).toContain("workspace wk-a: saved ~600 of 2,400 new-context tokens (20.0%)");
      expect(out).toContain("scope: all workspaces (global)");
      // global bucket numerator excludes the 600 attributed to wk-a
      // (spacing-agnostic: renderUsageReport pads the label column)
      expect(out).toContain("~400 tokens (est, bytes/4)");
    });
  ```

  And migrate every existing `readSaved:` injection in this file to
  `readSavedAll:` (5 sites):
  - `readSaved: () => 0` → `readSavedAll: () => ({ totalTokens: 0, byWorkspace: {} })`
  - `readSaved: () => 1000` → `readSavedAll: () => ({ totalTokens: 1000, byWorkspace: { "wk-a": 1000 } })`
  - `readSaved: () => 500` → `readSavedAll: () => ({ totalTokens: 500, byWorkspace: { "wk-a": 500 } })`
  - `readSaved: () => 5000` → `readSavedAll: () => ({ totalTokens: 5000, byWorkspace: { "wk-a": 5000 } })`
  - `readSaved: () => 100` (Task 4's skip-note test) →
    `readSavedAll: () => ({ totalTokens: 100, byWorkspace: {} })`
  - the windowing test, current:

    ```ts
        readSaved: (_s, _w, since) => {
          receivedSince = since;
          return 100;
        },
    ```

    becomes:

    ```ts
        readSavedAll: (_s, since) => {
          receivedSince = since;
          return { totalTokens: 100, byWorkspace: {} };
        },
    ```

- [ ] **Run RED:**

  ```bash
  cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-metrics-honesty/apps/cli && pnpm exec vitest run test/audit-usage.test.ts; echo RC=$?
  ```

  Expect RC=1 (`readSavedAll` unknown, `workspaceKey` not on
  `ProxyUsageEvent`, no scope/breakdown lines).

- [ ] **Implement — `packages/llm-proxy/src/usage-event.ts`.** After the
  `stream: z.boolean(),` field add:

  ```ts
      // F33: reserved per-request workspace attribution. The proxy today runs
      // a single global listener with NO per-request workspace signal (no env
      // or header scoping), so the writer never stamps this — audit falls back
      // to the labeled global bucket. Optional keeps old rows parsing under
      // .strict(); the day a signal exists, stamping it activates the scoped
      // ratios in `mega audit usage` with no further schema change.
      workspaceKey: z.string().min(1).optional(),
  ```

- [ ] **Implement — `apps/cli/src/commands/audit/usage.ts`.**
  1. Add after `readWorkspaceSavedTokensSince` (which stays as the
     per-directory helper):

     ```ts
     export type WorkspaceSavings = {
       totalTokens: number;
       byWorkspace: Record<string, number>;
     };

     // F33 numerator: sum savings across EVERY workspace under stats/ so the
     // ratio's scope matches the global usage denominator (the proxy meters all
     // workspaces on this machine). Per-workspace token values are kept for the
     // breakdown; totalTokens sums them (ceil-per-workspace rounding is noise).
     function readAllWorkspacesSavedTokensSince(
       storeRoot: string,
       sinceMs: number,
     ): WorkspaceSavings {
       let names: string[] = [];
       try {
         names = readdirSync(join(storeRoot, "stats"));
       } catch {
         return { totalTokens: 0, byWorkspace: {} };
       }
       const byWorkspace: Record<string, number> = {};
       let totalTokens = 0;
       for (const workspaceKey of names) {
         const saved = readWorkspaceSavedTokensSince(storeRoot, workspaceKey, sinceMs);
         if (saved > 0) byWorkspace[workspaceKey] = saved;
         totalTokens += saved;
       }
       return { totalTokens, byWorkspace };
     }
     ```

  2. `RunAuditUsageInput`: replace the `readSaved` field, current:

     ```ts
       readUsage?: typeof readProxyUsage;
       readSaved?: (storeRoot: string, workspaceKey: string, sinceMs: number) => number;
     ```

     becomes:

     ```ts
       readUsage?: typeof readProxyUsage;
       readSavedAll?: (storeRoot: string, sinceMs: number) => WorkspaceSavings;
     ```

  3. Replace the body of `runAuditUsage` (everything inside the function)
     with:

     ```ts
       const readUsage = input.readUsage ?? readProxyUsage;
       const readSavedAll = input.readSavedAll ?? readAllWorkspacesSavedTokensSince;

       let usage: readonly ProxyUsageEvent[] = [];
       let skippedLines = 0;
       try {
         const read = await readUsage({ storeRoot: input.storeRoot });
         usage = read.events;
         skippedLines = read.skippedLines;
       } catch {
         // No proxy-usage log yet.
       }

       // Window the numerator to the proxy's metering period (earliest usage ts).
       const sinceMs = usage.reduce((min, u) => {
         const t = Date.parse(u.ts);
         return Number.isFinite(t) ? Math.min(min, t) : min;
       }, Number.POSITIVE_INFINITY);

       let saved: WorkspaceSavings = { totalTokens: 0, byWorkspace: {} };
       if (usage.length > 0) {
         try {
           saved = readSavedAll(input.storeRoot, sinceMs);
         } catch {
           // Store not initialized — report against zero savings.
         }
       }

       // F33 scope matching: rows carrying a workspaceKey divide against that
       // workspace's savings ONLY; keyless rows form the global bucket, divided
       // against savings not attributed to any keyed workspace. Today the writer
       // never stamps workspaceKey (single global listener, no per-request
       // attribution), so every row is keyless and global/global is the — scope-
       // matched — comparison.
       const keyed = new Map<string, ProxyUsageEvent[]>();
       const keyless: ProxyUsageEvent[] = [];
       for (const u of usage) {
         if (u.workspaceKey === undefined) {
           keyless.push(u);
         } else {
           keyed.set(u.workspaceKey, [...(keyed.get(u.workspaceKey) ?? []), u]);
         }
       }
       const scoped: Record<string, ProxyUsageSavings> = {};
       let attributedTokens = 0;
       for (const [key, rows] of keyed) {
         const savedTokens = saved.byWorkspace[key] ?? 0;
         attributedTokens += savedTokens;
         scoped[key] = proxyUsageSavings({ savedTokens, usage: rows });
       }
       const globalSavings = proxyUsageSavings({
         savedTokens: saved.totalTokens - attributedTokens,
         usage: keyless,
       });

       if (input.json) {
         return JSON.stringify({
           ...globalSavings,
           skippedLines,
           savedByWorkspace: saved.byWorkspace,
           ...(keyed.size > 0 ? { scoped } : {}),
         });
       }

       const n = (x: number): string => x.toLocaleString("en-US");
       const lines: string[] = [];
       for (const [key, s] of Object.entries(scoped)) {
         lines.push(
           `workspace ${key}: saved ~${n(s.savedTokens)} of ${n(s.newContextTokens)} new-context tokens` +
             (s.reliable
               ? ` (${(s.savedShareOfNewContext * 100).toFixed(1)}%)`
               : " (% suppressed: low coverage)"),
         );
       }
       if (keyless.length > 0 || keyed.size === 0) {
         if (lines.length > 0) lines.push("");
         lines.push("scope: all workspaces (global)");
         lines.push(renderUsageReport(globalSavings, skippedLines));
       }
       const breakdown = Object.entries(saved.byWorkspace)
         .sort((a, b) => b[1] - a[1])
         .slice(0, 5);
       if (breakdown.length > 0) {
         const current = encodeWorkspaceKey(input.cwd);
         lines.push("", "savings by workspace (usage is not attributed per workspace — no ratios):");
         for (const [key, tokens] of breakdown) {
           lines.push(`  ${key}  ~${n(tokens)} tokens${key === current ? " (this workspace)" : ""}`);
         }
       }
       return lines.join("\n");
     ```

     Remove the now-unused `const workspaceKey = encodeWorkspaceKey(input.cwd);`
     from the old body (`encodeWorkspaceKey` is still used for the
     `(this workspace)` label — the import stays).

- [ ] **Run GREEN:**

  ```bash
  cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-metrics-honesty && pnpm -s turbo build --filter @megasaver/llm-proxy... ; echo RC=$?
  cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-metrics-honesty/apps/cli && pnpm exec vitest run test/audit-usage.test.ts; echo RC=$?
  ```

  Expect RC=0 (the JSON test still passes — the top-level fused fields are
  preserved, extra keys are additive).

- [ ] **Commit:**

  ```
  fix(cli): audit usage scope-matched ratios
  ```

---

## Task 6 — F31: route drift self-heal + doctor check

An ABSENT route with a healthy listener is re-applied in place (the
adapter's value-guard — `createClaudeRouteAdapter.apply()` refuses to
overwrite a FOREIGN value, `packages/connectors/claude-code/src/proxy-route.ts:112-125`
— makes clobbering structurally impossible). Foreign/invalid drift and
failed re-applies keep today's block+drain behavior verbatim.

**Files**
- Modify: `packages/proxy-control/src/state.ts`
- Modify: `packages/proxy-control/src/supervisor.ts`
- Modify: `apps/cli/src/commands/doctor-saver.ts`
- Test (modify): `packages/proxy-control/test/supervisor.test.ts`
- Test (modify): `apps/cli/test/doctor-saver.test.ts`

### Steps

- [ ] **RED — supervisor tests.** In
  `packages/proxy-control/test/supervisor.test.ts`:
  - extend imports:

    ```ts
    import type { ProxyControlState, ProxyRuntimeState, ProxyTransition } from "../src/state.js";
    import {
      readControlState,
      readRuntimeState,
      writeControlState,
      writeRuntimeState,
    } from "../src/stores.js";
    ```

  - add a runtime-state factory next to `control(…)`:

    ```ts
    const runtime = (over: Partial<ProxyRuntimeState> = {}): ProxyRuntimeState => ({
      version: 1,
      pid: 1234,
      processStartToken: "tok",
      bootId: "boot",
      instanceId: "inst",
      controlUrl: "http://127.0.0.1:8788",
      controlToken: "secret",
      healthCapability: "health",
      proxyUrl: OWNED,
      startedAt: "2026-07-03T00:00:00.000Z",
      lastReconciledAt: "2026-07-03T00:00:00.000Z",
      lastUsagePersistedAt: null,
      ...over,
    });
    ```

  - REPLACE the existing test
    `"with no transition + enabled + healthy + route drift → blocks and drains, never applies"`
    (its premise — never re-apply — is exactly what F31 changes; the
    lost-write variant below keeps its block+drain assertions) and add the
    healthy-path tests. New tests inside the same
    `describe("monitorTick — …")` block:

    ```ts
      it("F31: absent-route drift + healthy listener → re-applies, keeps lease, no block", () => {
        const route = fakeRoute(null); // settings rewrite dropped our value
        writeControlState(
          store,
          control({
            transition: null,
            routeLease: { url: OWNED, instanceId: "inst", phase: "active", installedAt: "x" },
          }),
        );
        writeRuntimeState(store, runtime());
        monitorTick(deps(route, fakeListener(true, "matching")));
        const s = readControlState(store);
        expect(route.value).toBe(OWNED); // route restored in place
        expect(s.reconcileBlocked).toBeNull();
        expect(s.routeLease?.phase).toBe("active"); // lease KEPT
        expect(s.drainingGeneration).toBeNull();
        const rt = readRuntimeState(store);
        expect(rt?.routeReapplies).toBe(1);
        expect(rt?.lastRouteReappliedAt).toBe(
          new Date(Date.UTC(2026, 6, 3, 0, 0, 30)).toISOString(),
        );
      });

      it("F31: a second drift bumps the counter to 2", () => {
        const route = fakeRoute(null);
        writeControlState(
          store,
          control({
            transition: null,
            routeLease: { url: OWNED, instanceId: "inst", phase: "active", installedAt: "x" },
          }),
        );
        writeRuntimeState(store, runtime({ routeReapplies: 1 }));
        monitorTick(deps(route, fakeListener(true, "matching")));
        expect(readRuntimeState(store)?.routeReapplies).toBe(2);
      });

      it("F31: re-apply that does not take (lost write) falls back to block + drain", () => {
        const route = brokenRoute(null); // apply() silently fails
        writeControlState(
          store,
          control({
            transition: null,
            routeLease: { url: OWNED, instanceId: "inst", phase: "active", installedAt: "x" },
          }),
        );
        writeRuntimeState(store, runtime());
        monitorTick(deps(route, fakeListener(true, "matching")));
        const s = readControlState(store);
        expect(route.value).toBeNull();
        expect(s.reconcileBlocked?.reason).toBe("route_removed");
        expect(s.routeLease).toBeNull();
        expect(s.drainingGeneration).not.toBeNull();
        expect(readRuntimeState(store)?.routeReapplies).toBeUndefined();
      });

      it("F31: unhealthy listener never re-applies — blocks without draining a dead generation", () => {
        const route = fakeRoute(null);
        writeControlState(
          store,
          control({
            transition: null,
            routeLease: { url: OWNED, instanceId: "inst", phase: "active", installedAt: "x" },
          }),
        );
        monitorTick(deps(route, fakeListener(false, "none")));
        const s = readControlState(store);
        expect(route.value).toBeNull(); // not re-applied
        expect(s.reconcileBlocked?.reason).toBe("route_removed");
        expect(s.drainingGeneration).toBeNull();
      });
    ```

    (The existing foreign-drift test —
    `"no transition + foreign route drift → preserves foreign, blocks route_conflict"`
    — stays untouched and must keep passing: foreign is NEVER re-applied
    over.)

- [ ] **RED — doctor tests.** In `apps/cli/test/doctor-saver.test.ts`:
  - add imports:

    ```ts
    import {
      type ProxyControlState,
      writeControlState,
      writeRuntimeState,
    } from "@megasaver/proxy-control";
    ```

  - add a control-state factory next to the existing helpers:

    ```ts
    function proxyControl(over: Partial<ProxyControlState>): ProxyControlState {
      return {
        version: 1,
        desiredEnabled: true,
        port: 8787,
        upstreamBaseUrl: "https://api.anthropic.com",
        routeLease: null,
        drainingGeneration: null,
        reconcileBlocked: null,
        transition: null,
        updatedAt: iso(NOW),
        lastError: null,
        ...over,
      };
    }
    ```

  - append tests inside `describe("runSaverChecks", …)` (reuse the
    existing `fakeBinary`/`writeHookSettings`/`advancingSpawn`/`find`
    helpers; only the `saver-proxy-route` check is asserted):

    ```ts
      it("saver-proxy-route: passes as informational when the proxy is disabled", () => {
        const settingsPath = writeHookSettings(`${fakeBinary()} hooks saver`);
        const checks = runSaverChecks({ settingsPath, storeRoot, spawn: advancingSpawn, now: () => NOW });
        const c = find(checks, "saver-proxy-route");
        expect(c?.pass).toBe(true);
        expect(c?.value).toContain("disabled");
      });

      it("saver-proxy-route: FAILs when desiredEnabled but the route is blocked", () => {
        const settingsPath = writeHookSettings(`${fakeBinary()} hooks saver`);
        writeControlState(
          storeRoot,
          proxyControl({ reconcileBlocked: { reason: "route_removed", at: iso(NOW) } }),
        );
        const checks = runSaverChecks({ settingsPath, storeRoot, spawn: advancingSpawn, now: () => NOW });
        const c = find(checks, "saver-proxy-route");
        expect(c?.pass).toBe(false);
        expect(c?.reason).toContain("mega proxy enable");
      });

      it("saver-proxy-route: WARNs (pass + churn note) when routeReapplies > 0", () => {
        const settingsPath = writeHookSettings(`${fakeBinary()} hooks saver`);
        writeControlState(storeRoot, proxyControl({}));
        writeRuntimeState(storeRoot, {
          version: 1,
          pid: 1234,
          processStartToken: "tok",
          bootId: "boot",
          instanceId: "inst",
          controlUrl: "http://127.0.0.1:8788",
          controlToken: "secret",
          healthCapability: "health",
          proxyUrl: "http://127.0.0.1:8787",
          startedAt: iso(NOW),
          lastReconciledAt: iso(NOW),
          lastUsagePersistedAt: null,
          routeReapplies: 3,
        });
        const checks = runSaverChecks({ settingsPath, storeRoot, spawn: advancingSpawn, now: () => NOW });
        const c = find(checks, "saver-proxy-route");
        expect(c?.pass).toBe(true);
        expect(c?.value).toContain("re-applied 3");
        expect(c?.value).toContain("rewrites settings");
      });
    ```

- [ ] **Run RED:**

  ```bash
  cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-metrics-honesty/packages/proxy-control && pnpm exec vitest run test/supervisor.test.ts; echo RC=$?
  cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-metrics-honesty/apps/cli && pnpm exec vitest run test/doctor-saver.test.ts; echo RC=$?
  ```

  Expect both RC=1 (monitorTick clears the lease and blocks instead of
  re-applying; `routeReapplies` is stripped by the schema; the doctor has
  no `saver-proxy-route` check).

- [ ] **Implement — `packages/proxy-control/src/state.ts`.** In
  `proxyRuntimeStateSchema`, current tail:

  ```ts
    lastReconciledAt: z.string(),
    lastUsagePersistedAt: z.string().nullable(),
  });
  ```

  becomes:

  ```ts
    lastReconciledAt: z.string(),
    lastUsagePersistedAt: z.string().nullable(),
    // F31 self-heal telemetry: bumped by monitorTick when it restores a
    // removed route. Optional — pre-wave-5 runtime files keep parsing.
    routeReapplies: z.number().int().nonnegative().optional(),
    lastRouteReappliedAt: z.string().datetime({ offset: true }).optional(),
  });
  ```

- [ ] **Implement — `packages/proxy-control/src/supervisor.ts`.**
  1. Import, current:

     ```ts
     import { readControlState, writeControlState } from "./stores.js";
     ```

     becomes:

     ```ts
     import {
       readControlState,
       readRuntimeState,
       writeControlState,
       writeRuntimeState,
     } from "./stores.js";
     ```

  2. Replace `monitorTick` and its header comment. Current:

     ```ts
     // Fixed 5-second monitor. Suspended while a transition is retained (observe-only:
     // never mutates route/lease/block). With no transition, missing/foreign route
     // drift blocks + drains the still-healthy generation and never re-applies.
     export function monitorTick(deps: SupervisorDeps): void {
       const control = readControlState(deps.storeRoot);
       if (control.transition !== null) return; // observe-only during a retained transition

       // During an expected-unrouted (disable) window there is no transition here by
       // construction; a missing route with no lease is simply the steady disabled
       // state. Drift only matters when we still hold a lease.
       if (control.routeLease === null) return;
       const route = deps.route.inspect(deps.ownedUrl);
       if (route === "exact") return; // still routed, no drift

       const nowIso = new Date(deps.now()).toISOString();
       const healthy = deps.listener.isAlive() && deps.listener.healthCheck() === "matching";
     ```

     becomes:

     ```ts
     // Fixed 5-second monitor. Suspended while a transition is retained (observe-only:
     // never mutates route/lease/block). With no transition: an ABSENT route with a
     // healthy listener is re-applied in place (F31 — a settings rewrite dropped our
     // value; the route adapter's value-guard makes overwriting a FOREIGN value
     // structurally impossible, so self-heal can never fight another gateway).
     // Foreign/invalid drift and failed re-applies block + drain as before.
     export function monitorTick(deps: SupervisorDeps): void {
       const control = readControlState(deps.storeRoot);
       if (control.transition !== null) return; // observe-only during a retained transition

       // During an expected-unrouted (disable) window there is no transition here by
       // construction; a missing route with no lease is simply the steady disabled
       // state. Drift only matters when we still hold a lease. Deliberate disable
       // stops the supervisor first, so re-apply cannot fight the user.
       if (control.routeLease === null) return;
       const route = deps.route.inspect(deps.ownedUrl);
       if (route === "exact") return; // still routed, no drift

       const nowIso = new Date(deps.now()).toISOString();
       const healthy = deps.listener.isAlive() && deps.listener.healthCheck() === "matching";

       if (route === "absent" && healthy) {
         deps.route.apply(deps.ownedUrl);
         if (deps.route.inspect(deps.ownedUrl) === "exact") {
           // Route restored: keep the lease, no block, no drain. Count the
           // re-apply so doctor can surface settings-rewrite churn.
           const runtime = readRuntimeState(deps.storeRoot);
           if (runtime !== null) {
             writeRuntimeState(deps.storeRoot, {
               ...runtime,
               routeReapplies: (runtime.routeReapplies ?? 0) + 1,
               lastRouteReappliedAt: nowIso,
             });
           }
           return;
         }
         // Re-apply did not take (lost write / refused): fall through to the
         // block + drain path below.
       }
     ```

     The remainder of the function (the `const next: ProxyControlState = {…}`
     block through `writeControlState(deps.storeRoot, next);`) stays
     byte-identical.

- [ ] **Implement — `apps/cli/src/commands/doctor-saver.ts`.**
  1. Add the import (with the other `@megasaver/*` imports):

     ```ts
     import { readControlState, readRuntimeState } from "@megasaver/proxy-control";
     ```

     (`apps/cli/package.json` already depends on
     `@megasaver/proxy-control` — no dep change.)

  2. In `runSaverChecks`, directly after the E22.5 daemon check (the
     `checks.push({ key: "saver-daemon", … })` block) and before
     `return checks;`, insert:

     ```ts
       // F31 route health: desiredEnabled with a blocked route means metering
       // died silently (the exact failure the supervisor now self-heals); a
       // nonzero re-apply counter means something on this machine keeps
       // rewriting settings — churn worth knowing about, not a failure.
       const proxyControl = readControlState(storeRoot);
       if (!proxyControl.desiredEnabled) {
         checks.push({
           key: "saver-proxy-route",
           value: "proxy disabled (no route expected)",
           pass: true,
         });
       } else if (proxyControl.reconcileBlocked !== null) {
         checks.push({
           key: "saver-proxy-route",
           value: `route ${proxyControl.reconcileBlocked.reason} at ${proxyControl.reconcileBlocked.at}`,
           pass: false,
           reason: "proxy route lost and not restorable — run: mega proxy enable",
         });
       } else {
         const reapplies = readRuntimeState(storeRoot)?.routeReapplies ?? 0;
         checks.push({
           key: "saver-proxy-route",
           value:
             reapplies > 0
               ? `route healthy — re-applied ${reapplies} times (something rewrites settings)`
               : "route healthy",
           pass: true,
         });
       }
     ```

     (`Check` is `{ key: string; value: string; pass: boolean; reason?: string }`
     — WARN is expressed as `pass: true` with the churn note in `value`,
     matching how doctor renders informational checks.)

- [ ] **Run GREEN:**

  ```bash
  cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-metrics-honesty/packages/proxy-control && pnpm exec vitest run; echo RC=$?
  cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-metrics-honesty && pnpm -s turbo build --filter @megasaver/proxy-control... ; echo RC=$?
  cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-metrics-honesty/apps/cli && pnpm exec vitest run test/doctor-saver.test.ts; echo RC=$?
  ```

  Expect RC=0, including the untouched foreign-drift test and the existing
  end-to-end doctor test (no control state file → `DISABLED_CONTROL_STATE`
  → the new check passes as "proxy disabled").

- [ ] **Commit:**

  ```
  feat(proxy-control): self-heal removed route
  ```

---

## Task 7 — F34: metering-not-saver framing

Pre-1.0: rename with NO compat shim.

**Files**
- Modify: `packages/stats/src/metrics.ts`
- Modify: `apps/cli/src/commands/hooks/status.ts`
- Modify: `apps/cli/src/commands/session/saver/stats.ts`
- Modify: `apps/cli/src/commands/audit/usage.ts`
- Test (modify): `packages/stats/test/metrics.test.ts`
- Test (modify): `apps/cli/test/session-saver.test.ts`
- Test (modify): `apps/cli/test/audit-usage.test.ts`

### Steps

- [ ] **RED — tests.**
  - `packages/stats/test/metrics.test.ts`: rename the field in the three
    assertion sites, current:

    ```ts
        expect(adoption.proxy_mediated_token_savings).toBe(3800);
    ```

    becomes `expect(adoption.saver_mediated_token_savings).toBe(3800);`
    (and the `toBe(0)` site in the zero-block test, plus the test title
    `"sums proxy-mediated token savings and raw stored output count"` →
    `"sums saver-mediated token savings and raw stored output count"`).
  - `apps/cli/test/session-saver.test.ts`: add to the imports at the top
    of the file:

    ```ts
    import { sessionEventToRecorded } from "../src/commands/session/saver/stats.js";
    ```

    and append a standalone test inside the file's top-level describe:

    ```ts
      it("F34: session saver events are saver_hook-mediated, not proxy", () => {
        expect(sessionEventToRecorded({ rawBytes: 100, returnedBytes: 10 })).toEqual({
          rawBytes: 100,
          returnedBytes: 10,
          mediation: "saver_hook",
          decision: "compressed",
        });
      });
    ```

  - `apps/cli/test/audit-usage.test.ts`: append:

    ```ts
      it("F34: clarifies that the proxy meters usage and saves nothing itself", async () => {
        const out = await runAuditUsage({
          ...base,
          readSavedAll: () => ({ totalTokens: 1000, byWorkspace: { "wk-a": 1000 } }),
          readUsage: async () => ({ events: [event(9000, 0, 0, 500)], skippedLines: 0 }),
        });
        expect(out).toContain("note: the proxy meters usage; savings come from the saver hook/tools");
      });
    ```

- [ ] **Run RED:**

  ```bash
  cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-metrics-honesty/packages/stats && pnpm exec vitest run test/metrics.test.ts; echo RC=$?
  cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-metrics-honesty/apps/cli && pnpm exec vitest run test/session-saver.test.ts test/audit-usage.test.ts; echo RC=$?
  ```

  Expect both RC=1 (`saver_mediated_token_savings` undefined;
  `sessionEventToRecorded` not exported; note line absent).

- [ ] **Implement — `packages/stats/src/metrics.ts`.** In
  `AdoptionMetrics`, current:

  ```ts
    proxy_mediated_token_savings: number;
  ```

  becomes:

  ```ts
    // F34: these bytes were saved by the SAVER pipeline (hook/proxy tools); the
    // metering HTTP proxy itself saves nothing (passthrough by design).
    saver_mediated_token_savings: number;
  ```

  In `aggregateAdoption`'s return, current:

  ```ts
      proxy_mediated_token_savings: savings,
  ```

  becomes:

  ```ts
      saver_mediated_token_savings: savings,
  ```

  Confirm every consumer is migrated:
  `grep -rn 'proxy_mediated' apps packages --include='*.ts' --include='*.tsx' | grep -v dist`
  — expected remaining sites after this task: none (recon found exactly
  `packages/stats/src/metrics.ts`, `packages/stats/test/metrics.test.ts`,
  `apps/cli/src/commands/hooks/status.ts`; the GUI does not read this
  field).

- [ ] **Implement — `apps/cli/src/commands/hooks/status.ts`.** In
  `renderText`, current:

  ```ts
      `  expand rate: ${pct(a.expand_rate)} | raw stored: ${a.raw_stored_output_count} | avg compression: ${pct(a.avg_compression_ratio)} | proxy-mediated savings: ${a.proxy_mediated_token_savings} B`,
  ```

  becomes:

  ```ts
      `  expand rate: ${pct(a.expand_rate)} | raw stored: ${a.raw_stored_output_count} | avg compression: ${pct(a.avg_compression_ratio)} | saver-mediated savings: ${a.saver_mediated_token_savings} B`,
  ```

  (Adoption/interception framing stays — interception is real.)

- [ ] **Implement — `apps/cli/src/commands/session/saver/stats.ts`.** Add
  the exported seam above `runSessionSaverStats`:

  ```ts
  // F34: session-store saver events were mediated by the SAVER pipeline, not
  // the metering HTTP proxy (which is passthrough and saves nothing).
  // Exported so the mediation label is testable.
  export function sessionEventToRecorded(e: { rawBytes: number; returnedBytes: number }): {
    rawBytes: number;
    returnedBytes: number;
    mediation: "saver_hook";
    decision: "compressed";
  } {
    return {
      rawBytes: e.rawBytes,
      returnedBytes: e.returnedBytes,
      mediation: "saver_hook",
      decision: "compressed",
    };
  }
  ```

  and replace the hardcode, current:

  ```ts
            readEvents({ root: rootDir }, session.projectId, parsedSessionId).map((e) => ({
              rawBytes: e.rawBytes,
              returnedBytes: e.returnedBytes,
              mediation: "proxy",
              decision: "compressed",
            })),
  ```

  becomes:

  ```ts
            readEvents({ root: rootDir }, session.projectId, parsedSessionId).map((e) =>
              sessionEventToRecorded({ rawBytes: e.rawBytes, returnedBytes: e.returnedBytes }),
            ),
  ```

  (`aggregateHonestMetrics` treats `proxy` and `saver_hook` identically —
  both are non-`native` — so rendered numbers do not change; only the
  label stops lying.)

- [ ] **Implement — `apps/cli/src/commands/audit/usage.ts`.** In
  `renderUsageReport`, add next to the `skipNote` const:

  ```ts
    const meteringNote = "note: the proxy meters usage; savings come from the saver hook/tools.";
  ```

  and append `meteringNote` (before `...skipNote`) to the two non-zero
  return arrays (the `!m.reliable` branch and the final branch); the
  zero-usage onboarding branch keeps only `...skipNote`.

- [ ] **Run GREEN:**

  ```bash
  cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-metrics-honesty/packages/stats && pnpm exec vitest run; echo RC=$?
  cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-metrics-honesty && pnpm -s turbo build --filter @megasaver/stats... ; echo RC=$?
  cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-metrics-honesty/apps/cli && pnpm exec vitest run test/session-saver.test.ts test/audit-usage.test.ts; echo RC=$?
  cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-metrics-honesty/apps/cli && pnpm exec tsc -b --noEmit; echo RC=$?
  ```

  (No test file pins the `hooks status` render string — recon grep found
  `proxy_mediated`/`proxy-mediated` only in `packages/stats/src/metrics.ts`,
  `packages/stats/test/metrics.test.ts`, and
  `apps/cli/src/commands/hooks/status.ts`. The typecheck run proves the
  rename reached every consumer — a stale `proxy_mediated_token_savings`
  reference anywhere fails compilation.)

- [ ] **Commit:**

  ```
  fix(stats): saver-mediated naming honesty
  ```

---

## Task 8 — changeset + wiki + full verify

**Files**
- Create: `.changeset/saver-metrics-honesty-wave5.md`
- Modify: `wiki/log.md` (append at bottom — append-only file)

### Steps

- [ ] **Create `.changeset/saver-metrics-honesty-wave5.md`:**

  ```md
  ---
  "@megasaver/stats": minor
  "@megasaver/context-gate": minor
  "@megasaver/llm-proxy": minor
  "@megasaver/proxy-control": minor
  "@megasaver/cli": minor
  "@megasaver/daemon": patch
  "@megasaver/core": patch
  ---

  Saver metrics honesty wave 5 (F30-F34): every reported number now counts
  the bytes actually delivered to the model, and no ratio divides mismatched
  scopes. `recordAndFilterOverlayOutput` computes the persisted
  returnedBytes/bytesSaved/savingRatio from the FINAL delivered text — D16
  elision markers plus the recovery footer, which now renders inside record
  (new canonical `buildRecoveryFooter` + `includeFooter` flag, wired through
  the saver hook and the daemon /excerpt schema) — and degrades to
  passthrough with ZERO side effects when a compressed replacement would be
  net-negative. Overlay events carry `secretsRedacted`/`chunksStored`, so
  summary rebuilds recover both counters without carryForward, and the GC
  reconcile counts schema-valid lines only (garbage lines no longer force a
  rebuild every sweep). The proxy usage reader tolerates torn JSONL lines
  and `mega audit usage` reports the skipped count, matches a GLOBAL savings
  numerator to the global usage denominator, adds a per-workspace savings
  breakdown (no unattributable ratios), and carries a scoped-ratio branch
  for future workspace-keyed usage rows. The proxy supervisor re-applies a
  removed route in place (lease kept; counter surfaced by the new
  `saver-proxy-route` doctor check), and metering is no longer framed as
  saving: `saver_mediated_token_savings`, `mediation: "saver_hook"`, and an
  explicit metering note in the audit report.
  ```

  (`@megasaver/core` is patch: its re-exported
  `RecordOverlayOutputInput` type gained the optional `includeFooter`
  field. Check nothing else in core changed:
  `git -C /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-metrics-honesty diff main --stat -- packages/core`
  should be empty.)

- [ ] **Append to `wiki/log.md`** (bottom of file, format
  `## [YYYY-MM-DD] <op> | <description>`):

  ```md
  ## [2026-07-11] feat | Saver metrics honesty wave 5 (F30-F34)

  Wave 5 (final) of the saver-savings-gaps program, branch
  `feat/saver-metrics-honesty` (spec
  `docs/superpowers/specs/2026-07-11-saver-metrics-honesty-design.md`).

  - F30 — honest delivered-bytes accounting: `recordAndFilterOverlayOutput`
    now computes persisted `returnedBytes`/`bytesSaved`/`savingRatio` from
    the FINAL delivered text (summary + excerpts + D16 markers + recovery
    footer). The footer moved into context-gate as the canonical
    `buildRecoveryFooter` (new `recovery-footer.ts`, also home of
    `looksPreTruncated` and `OVERLAY_CHUNK_LINES`); the saver hook and the
    daemon `/excerpt` opt in via `includeFooter: true` and emit
    `returnedText` verbatim. Net-negative guard: if the delivered
    replacement would be >= raw, record degrades to passthrough BEFORE any
    side effect (no chunk set, no event, no evidence). Footer display uses a
    <=2-iteration fixed point (digit-width drift tolerated, persisted
    numbers exact).
  - Contract adjustment vs spec: the spec's `footerTemplate` callback was
    replaced by the canonical in-package footer + `includeFooter` boolean —
    a function value cannot cross the daemon HTTP boundary
    (architect-approved at plan time).
  - W5-extra — overlay events now carry `secretsRedacted`/`chunksStored`
    (optional, strict schema keeps old rows parsing); rebuilds fold them so
    an unreadable summary loses nothing post-wave-5 (carryForward still wins
    when the prior summary is loadable). Reconcile drift-counts schema-valid
    lines only — the garbage-line rebuild-every-sweep ponytail is gone.
  - F32 — `readProxyUsage` reads usage.jsonl tolerantly (torn lines skipped
    + counted; `listProxyUsage` delegates); `mega audit usage` prints
    "N unreadable usage lines skipped".
  - F33 — audit usage ratios are scope-matched: GLOBAL savings (all
    `stats/<wk>/` dirs summed) over global usage, per-workspace savings
    breakdown without ratios, and a ready scoped-ratio branch for usage rows
    carrying the new optional `workspaceKey`. Resolution recorded: the proxy
    has NO per-request workspace signal today (single global listener), so
    the writer never stamps the key — the field is reserved, the fallback is
    the labeled global bucket.
  - F31 — supervisor `monitorTick` re-applies an ABSENT route when the
    listener is healthy (lease kept, no block), bumps persisted
    `routeReapplies`/`lastRouteReappliedAt` in runtime state; foreign values
    are never overwritten (adapter value-guard). New doctor check
    `saver-proxy-route`: FAIL on blocked route while enabled, churn WARN on
    `routeReapplies > 0`.
  - F34 — `proxy_mediated_token_savings` renamed to
    `saver_mediated_token_savings` (no shim, pre-1.0); `hooks status` says
    "saver-mediated savings"; `session saver stats` mediation is
    `saver_hook` (was a hardcoded `proxy`); audit usage carries "note: the
    proxy meters usage; savings come from the saver hook/tools."
  ```

- [ ] **Full verify (evidence, not assertion):**

  ```bash
  cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-metrics-honesty && pnpm verify > /tmp/verify.log 2>&1; echo RC=$?
  ```

  Must print `RC=0`. If not: read the FAILURE REGION of /tmp/verify.log in
  ≤70-line slices (`grep -n 'FAIL\|error' /tmp/verify.log | head -30`
  first), fix, re-run. Expected re-baseline candidates if anything fails:
  saver e2e fixtures asserting old footer placement, stats/GUI fixtures
  pinning `returnedBytes` equality — update to the delivered-bytes truth,
  never weaken to inequalities that would also pass on the old numbers.

- [ ] **Commit:**

  ```
  docs(saver): wave 5 changeset + wiki log
  ```

---

## Contract adjustments (vs the architect contract)

1. **Commit subjects shortened to meet the ≤50-char repo rule** (§10):
   - T2 `feat(context-gate): honest delivered-bytes accounting` (53) →
     `feat(context-gate): honest delivered-byte counts` (48).
   - T5 `fix(cli): audit usage matches savings scope to usage` (52) →
     `fix(cli): audit usage scope-matched ratios` (42).
   - T6 `feat(proxy-control): re-apply removed route on drift` (52) →
     `feat(proxy-control): self-heal removed route` (44).
   - T7 `fix(stats): saver-mediated naming, honest mediation` (52) →
     `fix(stats): saver-mediated naming honesty` (41).
2. **monitorTick runtime-state bump:** the contract said
   "`readRuntimeState ?? default → writeRuntimeState`". A `null` runtime
   state has no honest values for the required
   pid/controlUrl/controlToken/healthCapability fields — fabricating them
   would write a bogus schema-valid file. Implemented as: bump only when
   `readRuntimeState !== null` (the supervisor runs inside the proxy
   process, which wrote runtime state at startup, so null is the
   crashed/absent edge where a counter is moot). The route is still
   re-applied either way.
3. **`OVERLAY_CHUNK_LINES` moved** from `record-output.ts` to
   `recovery-footer.ts` (not in the contract): the footer builder needs it
   and record-output imports the footer builder — keeping it in
   record-output would create a cycle. The package-entry export path is
   unchanged.
4. **T7 testability seam:** the contract's RED test "stats.ts observation
   mediation === saver_hook" is not observable from the command's rendered
   output (honest-metrics treats `proxy` and `saver_hook` identically).
   Added a tiny exported pure function `sessionEventToRecorded` in
   `apps/cli/src/commands/session/saver/stats.ts` so the label is directly
   assertable.
5. **T4/T5 injectable renames:** `RunAuditUsageInput.listUsage` →
   `readUsage` (returns `{ events, skippedLines }`) and `readSaved` →
   `readSavedAll` (returns `WorkspaceSavings`). Implied by the contract's
   reader/numerator changes; existing tests are migrated, not deleted.

## Open questions

None blocking. One watch item for the executing workers: the T2
net-negative-guard test relies on a small eligible input compressing to
summary+all-excerpts (so final + footer >= raw). If the filter ever returns
a summary-only result small enough to stay net-positive, enlarge the footer
share by shrinking the raw fixture (e.g. 8 lines) rather than weakening the
assertions.
