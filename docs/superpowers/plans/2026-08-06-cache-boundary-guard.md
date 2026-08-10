# Cache-Boundary Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the cache-boundary guard per
`docs/superpowers/specs/2026-08-06-cache-boundary-guard-design.md` (the
contract — re-read it before starting): the opt-in proxy extracts the last
`cache_control` breakpoint POSITION from each successful `/v1/messages`
request on the existing post-flush parse, persists the last two observations
(positions + timestamps only) atomically at
`<storeRoot>/proxy-usage/cache-boundary.json`, and `buildSaverDecision`
refuses a rewrite whose projected target index falls at or before a fresh
recorded boundary. Fail-open everywhere; receipts (`consults`/`refusals`)
surface as one informational `mega doctor` line.

**Architecture:** Four touch points, no new package. (1)
`@megasaver/llm-proxy` gains `parseRequestBodyFacts` (replacing
`countRequestMessages`, packages/llm-proxy/src/parse-usage.ts:60), a new
`boundary-record.ts` (Zod `.strict()` schemas, lock+tmp+rename writer,
tolerant reader, pure `evaluateCacheBoundary`, `CACHE_BOUNDARY_TTL_MS`), and
an optional `onBoundary` sink in `proxy-handler.ts`/`server.ts` invoked
post-flush and 2xx-gated. (2) `apps/cli` supervise wires `onBoundary` to the
record writer best-effort, mirroring the `onUsage` wiring at
apps/cli/src/commands/proxy/supervise.ts:77-84. (3) `@megasaver/context-gate`
gains `boundary-guard-stats.ts` (receipts on
`stats/<wk>/boundary-guard.json`). (4) The saver hook: two new injected
`SaverDeps` (apps/cli/src/hooks/saver.ts:73-108) plus the gate placed after
the seen-hash check (saver.ts:382) and before `ctx.stage = "record"`
(saver.ts:386); `saver-run.ts` wires fail-open implementations mirroring the
`recordSeenOutput` wrapper (apps/cli/src/hooks/saver-run.ts:81-92);
`doctor-saver.ts` prints one always-pass Check.

**Tech Stack:** TypeScript strict ESM, Node 22, Vitest, Zod (`.strict()` at
boundaries), `withFileLock` from `@megasaver/shared/node`
(packages/shared/src/file-lock.ts:25, options `{deadlineMs: 50, staleMs:
5000}` — the saver-seen options, packages/context-gate/src/saver-seen.ts:17),
tmp+rename atomic writes with dir 0700 / file 0600 mirroring
packages/context-gate/src/saver-heartbeat.ts:294-310 and symlink refusal
mirroring packages/llm-proxy/src/store.ts:24-31.

## Global Constraints

- **Risk HIGH (spec frontmatter).** Work in an isolated worktree; no `main`
  edits. Reviewer gates: `code-reviewer` AND `critic`, separate fresh
  contexts; then `verifier`. Author is never reviewer.
- **HARD RULE:** the proxy never persists request/response bodies
  (packages/llm-proxy/src/usage-event.ts:7-9). The boundary record stores
  integer indices and timestamps only — no content, no hashes of content, no
  labels. `proxyUsageEventSchema` is NOT touched. Byte-verbatim forwarding is
  NOT touched. If implementation ever needs to mutate request bodies or
  change `proxyUsageEventSchema`: STOP — CRITICAL territory, back to spec.
- **Fail-open, everywhere.** Missing/stale/corrupt record → allow (exactly
  today's behavior). Hook always exits 0 (`runSaverHookFromProcess`
  unchanged, saver-run.ts:156). Proxy-side write failure → dropped
  observation. Stats write failure → dropped receipt (undercount, never
  overcount). `FailureKind` union untouched (saver-heartbeat.ts:15 — enum
  order is a contract); a guard throw surfaces under the existing `"resolve"`
  stage.
- **The saver decision path gains no awaited I/O.** Both new deps are
  synchronous fs reads/writes; `evaluateCacheBoundary` is pure. No dynamic
  `import()` and no `await` added anywhere in `decide()`.
- **No timing-tight tests.** TTL is 1 h vs ms-scale test runs; TTL tests
  inject `nowMs`. Fresh-record tests use `new Date().toISOString()`.
- **No pnpm catalog in this repo.** New dep lines are literal
  `"@megasaver/shared": "workspace:*"` mirroring
  packages/content-store/package.json. No tsconfig changes needed
  (llm-proxy and content-store share the identical non-composite tsconfig).
- **TDD, red-first, per task.** Run the RED command and confirm the exact
  failure before writing implementation. Conventional commits, subject ≤ 50
  chars, imperative. One logical change per commit.
- Per-package test command: `pnpm --filter <pkg> test -- <file>`; full gate
  is `pnpm verify` (root package.json:26 — lint + typecheck + test +
  conventions:check).
- ASSUMPTION: a future-dated `current.observedAt` (age < 0) evaluates to
  `"no-consult"`. The spec pins only the expiry side ("an expired breakpoint
  protects nothing"); both choices are one-sided safe (allow = today's
  behavior), and no-consult keeps a forged future timestamp from pinning the
  record fresh forever.

---

### Task 1: `parseRequestBodyFacts` replaces `countRequestMessages`

**Files:**
- Modify: `/Users/ozger/Desktop/MegaSaver/packages/llm-proxy/src/parse-usage.ts`
- Modify: `/Users/ozger/Desktop/MegaSaver/packages/llm-proxy/src/proxy-handler.ts` (call site only, line 4 + 181)
- Modify: `/Users/ozger/Desktop/MegaSaver/packages/llm-proxy/src/index.ts` (swap export)
- Test: `/Users/ozger/Desktop/MegaSaver/packages/llm-proxy/test/parse-usage.test.ts`

`countRequestMessages` is referenced only inside `packages/llm-proxy`
(src/parse-usage.ts:60, src/index.ts:7, src/proxy-handler.ts:4+181, its own
test) — verified by repo-wide grep. Pre-1.0: delete it, no shim.

**Interfaces:**
```ts
// packages/llm-proxy/src/parse-usage.ts
export type RequestBodyFacts = {
  model: string;
  messageCount: number;
  lastCacheBreakpointIndex: number | null;
};
export function parseRequestBodyFacts(bodyText: string): RequestBodyFacts;
```

**Steps:**

- [ ] RED — in `packages/llm-proxy/test/parse-usage.test.ts`, replace the
  `describe("countRequestMessages", …)` block (lines 4-18) with:

```ts
describe("parseRequestBodyFacts", () => {
  it("reads model + counts messages + finds the LAST cache_control breakpoint", () => {
    const body = JSON.stringify({
      model: "claude-opus-4-8",
      system: "you are…",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "a", cache_control: { type: "ephemeral" } }],
        },
        { role: "assistant", content: [{ type: "text", text: "b" }] },
        {
          role: "user",
          content: [{ type: "tool_result", content: "c", cache_control: { type: "ephemeral" } }],
        },
        { role: "assistant", content: [{ type: "text", text: "d" }] },
      ],
    });
    expect(parseRequestBodyFacts(body)).toEqual({
      model: "claude-opus-4-8",
      messageCount: 4,
      lastCacheBreakpointIndex: 2,
    });
  });

  it("no breakpoint anywhere → null index", () => {
    const body = JSON.stringify({
      model: "claude-opus-4-8",
      messages: [{ role: "user", content: [{ type: "text", text: "a" }] }],
    });
    expect(parseRequestBodyFacts(body)).toEqual({
      model: "claude-opus-4-8",
      messageCount: 1,
      lastCacheBreakpointIndex: null,
    });
  });

  it("string content carries no blocks and is skipped", () => {
    const body = JSON.stringify({
      model: "m",
      messages: [
        { role: "user", content: "plain string" },
        { role: "user", content: [{ type: "text", text: "x", cache_control: { type: "ephemeral" } }] },
        { role: "assistant", content: "also plain" },
      ],
    });
    expect(parseRequestBodyFacts(body)).toEqual({
      model: "m",
      messageCount: 3,
      lastCacheBreakpointIndex: 1,
    });
  });

  it("malformed body → zero facts (best-effort)", () => {
    expect(parseRequestBodyFacts("not json")).toEqual({
      model: "",
      messageCount: 0,
      lastCacheBreakpointIndex: null,
    });
    expect(parseRequestBodyFacts("{}")).toEqual({
      model: "",
      messageCount: 0,
      lastCacheBreakpointIndex: null,
    });
  });
});
```
  Update the file's import to
  `import { parseRequestBodyFacts, parseUsageFromJson, parseUsageFromSse } from "../src/parse-usage.js";`

- [ ] Run: `pnpm --filter @megasaver/llm-proxy test -- test/parse-usage.test.ts`
  — expect FAIL: `does not provide an export named 'parseRequestBodyFacts'`.

- [ ] GREEN — in `packages/llm-proxy/src/parse-usage.ts`, replace
  `countRequestMessages` (lines 60-66) with:

```ts
export type RequestBodyFacts = {
  model: string;
  messageCount: number;
  lastCacheBreakpointIndex: number | null;
};

interface RawMessage {
  content?: unknown;
}

function hasCacheControl(block: unknown): boolean {
  return typeof block === "object" && block !== null && "cache_control" in block;
}

// Replaces countRequestMessages (pre-1.0, no shim). Same defensive posture as
// everything in this file: structure only — block text is never read or
// retained. The last breakpoint is found scanning messages[] from the END, so
// the common growing-history case costs one short suffix walk.
export function parseRequestBodyFacts(bodyText: string): RequestBodyFacts {
  const obj = asObject<RawRequest>(parseJson(bodyText));
  if (obj === null) return { model: "", messageCount: 0, lastCacheBreakpointIndex: null };
  const model = typeof obj.model === "string" ? obj.model : "";
  const messages = Array.isArray(obj.messages) ? obj.messages : [];
  let lastCacheBreakpointIndex: number | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = asObject<RawMessage>(messages[i]);
    const content = message?.content;
    if (!Array.isArray(content)) continue; // string content carries no blocks
    if (content.some(hasCacheControl)) {
      lastCacheBreakpointIndex = i;
      break;
    }
  }
  return { model, messageCount: messages.length, lastCacheBreakpointIndex };
}
```
  In `proxy-handler.ts`: line 4 import becomes
  `import { createSseUsageScanner, parseRequestBodyFacts, parseUsageFromJson } from "./parse-usage.js";`
  and line 181 becomes
  `const { model, messageCount } = parseRequestBodyFacts(bodyBuf.toString("utf8"));`
  (the `lastCacheBreakpointIndex` field is consumed in Task 4). In
  `index.ts` swap the `countRequestMessages` export (line 7) for
  `parseRequestBodyFacts` and add `type RequestBodyFacts`.

- [ ] Run: `pnpm --filter @megasaver/llm-proxy test` — expect PASS (all
  files, including proxy-handler.test.ts unchanged).
- [ ] Commit: `feat(llm-proxy): extract request body facts`

---

### Task 2: boundary record store (schemas, path, read, write)

**Files:**
- Create: `/Users/ozger/Desktop/MegaSaver/packages/llm-proxy/src/boundary-record.ts`
- Modify: `/Users/ozger/Desktop/MegaSaver/packages/llm-proxy/package.json` (add `"@megasaver/shared": "workspace:*"` to dependencies)
- Modify: `/Users/ozger/Desktop/MegaSaver/packages/llm-proxy/src/index.ts` (exports)
- Create: `/Users/ozger/Desktop/MegaSaver/packages/llm-proxy/test/boundary-record.test.ts`

**Interfaces:**
```ts
// packages/llm-proxy/src/boundary-record.ts
export const MAX_BOUNDARY_INDEX = 1_000_000;
export const cacheBoundaryObservationSchema: z.ZodType; // .strict()
export const cacheBoundaryRecordSchema: z.ZodType; // .strict()
export type CacheBoundaryObservation = {
  messageCount: number;
  lastBreakpointIndex: number | null;
  observedAt: string;
};
export type CacheBoundaryRecord = {
  version: 1;
  current: CacheBoundaryObservation;
  previous: CacheBoundaryObservation | null;
};
export function cacheBoundaryRecordPath(storeRoot: string): string; // <storeRoot>/proxy-usage/cache-boundary.json
export function readCacheBoundaryRecord(storeRoot: string): CacheBoundaryRecord | null;
export function recordCacheBoundaryObservation(input: {
  storeRoot: string;
  messageCount: number;
  lastBreakpointIndex: number | null;
  observedAt?: string; // injectable for tests; defaults to new Date().toISOString()
}): void;
```

**Steps:**

- [ ] Add the dep first (build order): in
  `packages/llm-proxy/package.json` dependencies add
  `"@megasaver/shared": "workspace:*"` (alongside `"zod": "^3.24.1"`), then
  run `pnpm install`.

- [ ] RED — create `packages/llm-proxy/test/boundary-record.test.ts`
  (mkdtemp/rm harness mirrors `packages/llm-proxy/test/store.test.ts`):

```ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cacheBoundaryRecordPath,
  readCacheBoundaryRecord,
  recordCacheBoundaryObservation,
} from "../src/boundary-record.js";

describe("cache-boundary record", () => {
  let store: string;
  beforeEach(() => {
    store = mkdtempSync(join(tmpdir(), "llm-proxy-cb-"));
  });
  afterEach(() => {
    rmSync(store, { recursive: true, force: true });
  });

  it("round-trips one observation (positions + timestamps only)", () => {
    recordCacheBoundaryObservation({
      storeRoot: store,
      messageCount: 12,
      lastBreakpointIndex: 9,
      observedAt: "2026-08-06T12:00:00.000Z",
    });
    expect(readCacheBoundaryRecord(store)).toEqual({
      version: 1,
      current: { messageCount: 12, lastBreakpointIndex: 9, observedAt: "2026-08-06T12:00:00.000Z" },
      previous: null,
    });
  });

  it("second observation shifts current→previous", () => {
    recordCacheBoundaryObservation({
      storeRoot: store,
      messageCount: 12,
      lastBreakpointIndex: 9,
      observedAt: "2026-08-06T12:00:00.000Z",
    });
    recordCacheBoundaryObservation({
      storeRoot: store,
      messageCount: 14,
      lastBreakpointIndex: 11,
      observedAt: "2026-08-06T12:01:00.000Z",
    });
    const rec = readCacheBoundaryRecord(store);
    expect(rec?.current).toEqual({
      messageCount: 14,
      lastBreakpointIndex: 11,
      observedAt: "2026-08-06T12:01:00.000Z",
    });
    expect(rec?.previous).toEqual({
      messageCount: 12,
      lastBreakpointIndex: 9,
      observedAt: "2026-08-06T12:00:00.000Z",
    });
  });

  it("corrupt file → null read; the next write recovers with previous:null", () => {
    mkdirSync(join(store, "proxy-usage"), { recursive: true });
    writeFileSync(cacheBoundaryRecordPath(store), "{ corrupt");
    expect(readCacheBoundaryRecord(store)).toBeNull();
    recordCacheBoundaryObservation({
      storeRoot: store,
      messageCount: 3,
      lastBreakpointIndex: null,
      observedAt: "2026-08-06T12:02:00.000Z",
    });
    expect(readCacheBoundaryRecord(store)?.previous).toBeNull();
  });

  it("out-of-schema record (extra key, giant index) → null read", () => {
    mkdirSync(join(store, "proxy-usage"), { recursive: true });
    const good = {
      version: 1,
      current: { messageCount: 1, lastBreakpointIndex: null, observedAt: "2026-08-06T12:00:00.000Z" },
      previous: null,
    };
    writeFileSync(cacheBoundaryRecordPath(store), JSON.stringify({ ...good, forged: "x" }));
    expect(readCacheBoundaryRecord(store)).toBeNull();
    writeFileSync(
      cacheBoundaryRecordPath(store),
      JSON.stringify({ ...good, current: { ...good.current, messageCount: 2_000_000 } }),
    );
    expect(readCacheBoundaryRecord(store)).toBeNull();
  });

  it("a forged lastBreakpointIndex >= messageCount stays representable (tripwire)", () => {
    recordCacheBoundaryObservation({
      storeRoot: store,
      messageCount: 5,
      lastBreakpointIndex: 5,
      observedAt: "2026-08-06T12:00:00.000Z",
    });
    expect(readCacheBoundaryRecord(store)?.current.lastBreakpointIndex).toBe(5);
  });

  it("refuses to write through a symlinked record path", () => {
    mkdirSync(join(store, "proxy-usage"), { recursive: true });
    writeFileSync(join(store, "elsewhere.json"), "{}");
    symlinkSync(join(store, "elsewhere.json"), cacheBoundaryRecordPath(store));
    expect(() =>
      recordCacheBoundaryObservation({ storeRoot: store, messageCount: 1, lastBreakpointIndex: null }),
    ).toThrow(/refusing/);
    expect(readCacheBoundaryRecord(store)).toBeNull(); // symlink also refused on read
  });

  it("file lands 0600, dir 0700", () => {
    recordCacheBoundaryObservation({ storeRoot: store, messageCount: 1, lastBreakpointIndex: null });
    expect(statSync(cacheBoundaryRecordPath(store)).mode & 0o777).toBe(0o600);
    expect(statSync(join(store, "proxy-usage")).mode & 0o777).toBe(0o700);
  });
});
```

- [ ] Run: `pnpm --filter @megasaver/llm-proxy test -- test/boundary-record.test.ts`
  — expect FAIL: `Failed to resolve import "../src/boundary-record.js"`.

- [ ] GREEN — create `packages/llm-proxy/src/boundary-record.ts`:

```ts
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { withFileLock } from "@megasaver/shared/node";
import { z } from "zod";

// B4 positional cache-boundary coupling. Positions + timestamps ONLY — the
// proxy's no-body-persistence HARD RULE (usage-event.ts) extends here: no
// content, no hashes of content, no labels. File discipline mirrors the usage
// log (store.ts): dir 0700, file 0600, refuse symlinked paths.

// Far above any real messages[] length; rejects forged giants while keeping
// index arithmetic in safe-integer range.
export const MAX_BOUNDARY_INDEX = 1_000_000;

// Same options the saver-side ledgers use (context-gate saver-seen): a writer
// must not stall, a dead writer's lock is stolen.
const BOUNDARY_LOCK_OPTIONS = { deadlineMs: 50, staleMs: 5000 };

export const cacheBoundaryObservationSchema = z
  .object({
    messageCount: z.number().int().nonnegative().max(MAX_BOUNDARY_INDEX),
    // A forged lastBreakpointIndex >= messageCount stays representable on
    // purpose — rejecting it at the schema would blind the evaluate tripwire.
    lastBreakpointIndex: z.number().int().nonnegative().max(MAX_BOUNDARY_INDEX).nullable(),
    observedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const cacheBoundaryRecordSchema = z
  .object({
    version: z.literal(1),
    current: cacheBoundaryObservationSchema,
    previous: cacheBoundaryObservationSchema.nullable(),
  })
  .strict();

export type CacheBoundaryObservation = z.infer<typeof cacheBoundaryObservationSchema>;
export type CacheBoundaryRecord = z.infer<typeof cacheBoundaryRecordSchema>;

export function cacheBoundaryRecordPath(storeRoot: string): string {
  return join(storeRoot, "proxy-usage", "cache-boundary.json");
}

function refuseSymlink(path: string): void {
  try {
    if (lstatSync(path).isSymbolicLink()) throw new Error("refusing symlinked boundary record");
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("refusing")) throw e;
    // ENOENT is fine — the file is created below.
  }
}

// Reads are lock-free on purpose: the writer publishes via tmp+rename, so a
// read observes a complete old or complete new file — and the hook-side
// reader must never wait on the proxy's lock. null on ANY anomaly (fail-open;
// record values are untrusted at read time, hence .strict() parse).
export function readCacheBoundaryRecord(storeRoot: string): CacheBoundaryRecord | null {
  const path = cacheBoundaryRecordPath(storeRoot);
  try {
    const st = lstatSync(path);
    if (st.isSymbolicLink() || !st.isFile()) return null;
    const parsed = cacheBoundaryRecordSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function recordCacheBoundaryObservation(input: {
  storeRoot: string;
  messageCount: number;
  lastBreakpointIndex: number | null;
  observedAt?: string;
}): void {
  const path = cacheBoundaryRecordPath(input.storeRoot);
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  refuseSymlink(path);
  const current = cacheBoundaryObservationSchema.parse({
    messageCount: input.messageCount,
    lastBreakpointIndex: input.lastBreakpointIndex,
    observedAt: input.observedAt ?? new Date().toISOString(),
  });
  // Lock-miss ⇒ this observation is dropped (fail-open; the next round trip
  // re-observes). Read-modify-write shifts current→previous under the lock.
  withFileLock(`${path}.lock`, BOUNDARY_LOCK_OPTIONS, () => {
    const prior = readCacheBoundaryRecord(input.storeRoot);
    const record: CacheBoundaryRecord = { version: 1, current, previous: prior?.current ?? null };
    const tmp = join(dir, `.${randomUUID()}.cb.tmp`);
    try {
      writeFileSync(tmp, JSON.stringify(record), { mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, path);
    } finally {
      try {
        rmSync(tmp, { force: true });
      } catch {
        /* already renamed */
      }
    }
  });
}
```
  Add to `src/index.ts`:

```ts
export {
  MAX_BOUNDARY_INDEX,
  cacheBoundaryObservationSchema,
  cacheBoundaryRecordSchema,
  cacheBoundaryRecordPath,
  readCacheBoundaryRecord,
  recordCacheBoundaryObservation,
  type CacheBoundaryObservation,
  type CacheBoundaryRecord,
} from "./boundary-record.js";
```

- [ ] Run: `pnpm --filter @megasaver/llm-proxy test -- test/boundary-record.test.ts`
  — expect PASS.
- [ ] Commit: `feat(llm-proxy): cache-boundary record store`

---

### Task 3: `evaluateCacheBoundary` pure verdict + TTL

**Files:**
- Modify: `/Users/ozger/Desktop/MegaSaver/packages/llm-proxy/src/boundary-record.ts`
- Modify: `/Users/ozger/Desktop/MegaSaver/packages/llm-proxy/src/index.ts`
- Test: `/Users/ozger/Desktop/MegaSaver/packages/llm-proxy/test/boundary-record.test.ts`

**Interfaces:**
```ts
export const CACHE_BOUNDARY_TTL_MS = 3_600_000; // 1h
export type CacheBoundaryVerdict = "no-consult" | "allow" | "refuse";
export function evaluateCacheBoundary(
  record: CacheBoundaryRecord | null,
  nowMs: number,
): CacheBoundaryVerdict;
```

**Steps:**

- [ ] RED — append to `test/boundary-record.test.ts` (extend the import from
  `../src/boundary-record.js` with `CACHE_BOUNDARY_TTL_MS, evaluateCacheBoundary`):

```ts
describe("evaluateCacheBoundary", () => {
  const NOW = Date.parse("2026-08-06T12:00:00.000Z");
  const iso = (ms: number) => new Date(ms).toISOString();
  const obs = (messageCount: number, lastBreakpointIndex: number | null, atMs = NOW) => ({
    messageCount,
    lastBreakpointIndex,
    observedAt: iso(atMs),
  });

  it("null record → no-consult (exactly today's behavior)", () => {
    expect(evaluateCacheBoundary(null, NOW)).toBe("no-consult");
  });

  it("well-formed growth can never fire: breakpoint < messageCount → allow", () => {
    expect(
      evaluateCacheBoundary({ version: 1, current: obs(10, 7), previous: obs(8, 5) }, NOW),
    ).toBe("allow");
  });

  it("no breakpoint at all → allow", () => {
    expect(evaluateCacheBoundary({ version: 1, current: obs(10, null), previous: null }, NOW)).toBe(
      "allow",
    );
  });

  it("shrink consults the PREVIOUS breakpoint: rebuilt shorter conversation refuses", () => {
    expect(
      evaluateCacheBoundary(
        { version: 1, current: obs(8, 5, NOW), previous: obs(20, 15, NOW - 60_000) },
        NOW,
      ),
    ).toBe("refuse");
  });

  it("no shrink → previous breakpoint is ignored", () => {
    expect(
      evaluateCacheBoundary(
        { version: 1, current: obs(8, 5, NOW), previous: obs(8, 15, NOW - 60_000) },
        NOW,
      ),
    ).toBe("allow");
  });

  it("forged breakpoint >= messageCount is the tripwire → refuse", () => {
    expect(evaluateCacheBoundary({ version: 1, current: obs(5, 5), previous: null }, NOW)).toBe(
      "refuse",
    );
  });

  it("expired record (injected clock past TTL) → no-consult, never refuse", () => {
    const rec = { version: 1 as const, current: obs(8, 5, NOW), previous: obs(20, 15, NOW) };
    expect(evaluateCacheBoundary(rec, NOW + CACHE_BOUNDARY_TTL_MS + 1)).toBe("no-consult");
    expect(evaluateCacheBoundary(rec, NOW + CACHE_BOUNDARY_TTL_MS)).toBe("refuse"); // boundary inclusive
  });

  it("future-dated observedAt is incoherent → no-consult", () => {
    expect(
      evaluateCacheBoundary({ version: 1, current: obs(8, 5, NOW + 60_000), previous: null }, NOW),
    ).toBe("no-consult");
  });
});
```

- [ ] Run: `pnpm --filter @megasaver/llm-proxy test -- test/boundary-record.test.ts`
  — expect FAIL: `does not provide an export named 'evaluateCacheBoundary'`.

- [ ] GREEN — append to `src/boundary-record.ts`:

```ts
// 1h — the client's native prompt-cache TTL (wiki/syntheses/saver-cache-churn
// §Claim; spec Open Question 3: if the real TTL is 5m this is merely more
// conservative). An expired breakpoint protects nothing → no-consult.
export const CACHE_BOUNDARY_TTL_MS = 3_600_000;

export type CacheBoundaryVerdict = "no-consult" | "allow" | "refuse";

// Pure verdict (Locked Decision 4): one comparison over parsed-but-untrusted
// positions. Only "allow"/"refuse" are real gate evaluations (receipts);
// "no-consult" means the guard had nothing coherent to check. Error direction
// is one-sided: a wrong verdict can only refuse (skip one compression), never
// authorize an unsafe rewrite.
export function evaluateCacheBoundary(
  record: CacheBoundaryRecord | null,
  nowMs: number,
): CacheBoundaryVerdict {
  if (record === null) return "no-consult";
  const age = nowMs - Date.parse(record.current.observedAt);
  // Future-dated observedAt (age < 0) is as incoherent as expired.
  if (!Number.isFinite(age) || age < 0 || age > CACHE_BOUNDARY_TTL_MS) return "no-consult";
  const { current, previous } = record;
  // The sound lower bound for where the next tool_result can append.
  const projectedIndex = current.messageCount;
  const shrank = previous !== null && current.messageCount < previous.messageCount;
  const boundaryIndex = Math.max(
    current.lastBreakpointIndex ?? -1,
    shrank ? (previous.lastBreakpointIndex ?? -1) : -1,
  );
  return projectedIndex <= boundaryIndex ? "refuse" : "allow";
}
```
  Add `CACHE_BOUNDARY_TTL_MS`, `evaluateCacheBoundary`,
  `type CacheBoundaryVerdict` to the `index.ts` boundary-record export block.

- [ ] Run: `pnpm --filter @megasaver/llm-proxy test` — expect PASS.
- [ ] Commit: `feat(llm-proxy): cache-boundary verdict`

---

### Task 4: `onBoundary` sink in proxy handler + server

**Files:**
- Modify: `/Users/ozger/Desktop/MegaSaver/packages/llm-proxy/src/proxy-handler.ts`
- Modify: `/Users/ozger/Desktop/MegaSaver/packages/llm-proxy/src/server.ts`
- Modify: `/Users/ozger/Desktop/MegaSaver/packages/llm-proxy/src/index.ts` (export `type BoundaryObservation`)
- Test: `/Users/ozger/Desktop/MegaSaver/packages/llm-proxy/test/proxy-handler.test.ts`

**Interfaces:**
```ts
// proxy-handler.ts
export type BoundaryObservation = { messageCount: number; lastBreakpointIndex: number | null };
// ProxyHandlerDeps gains:
onBoundary?: (obs: BoundaryObservation) => void;
// server.ts StartProxyOptions gains the same optional field, spread through
// like onUsage (server.ts:31).
```

**Steps:**

- [ ] RED — in `test/proxy-handler.test.ts`, first extend the `makeRes` fake
  (lines 19-47) with an `ended` flag: add `let ended = false;` beside
  `chunks`, set `ended = true;` at the top of `end(…)`, and expose
  `get ended() { return ended; },` beside the other getters. Then append:

```ts
  it("onBoundary observes positions only after the full body is flushed (2xx)", async () => {
    const upstreamFetch = async () =>
      new Response('{"usage":{"input_tokens":1,"output_tokens":1}}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const out = makeRes();
    let seenAtCall: { ended: boolean; obs: unknown } | null = null;
    const handler = createProxyHandler(
      deps({
        upstreamFetch,
        onBoundary: (obs) => {
          seenAtCall = { ended: out.ended, obs };
        },
      }),
    );
    await handler(
      makeReq(
        "POST",
        "/v1/messages",
        { "x-api-key": "sk-secret" },
        JSON.stringify({
          model: "claude-opus-4-8",
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "a", cache_control: { type: "ephemeral" } }],
            },
            { role: "assistant", content: [{ type: "text", text: "b" }] },
          ],
        }),
      ),
      out.res as never,
    );
    expect(seenAtCall).toEqual({ ended: true, obs: { messageCount: 2, lastBreakpointIndex: 0 } });
  });

  it("non-2xx → no boundary observation (a failed round trip caches nothing)", async () => {
    const upstreamFetch = async () =>
      new Response('{"type":"error"}', { status: 400, headers: { "content-type": "application/json" } });
    const onBoundary = vi.fn();
    const handler = createProxyHandler(deps({ upstreamFetch, onBoundary }));
    await handler(
      makeReq(
        "POST",
        "/v1/messages",
        {},
        JSON.stringify({
          model: "m",
          messages: [{ role: "user", content: [{ type: "text", text: "a", cache_control: { type: "ephemeral" } }] }],
        }),
      ),
      makeRes().res as never,
    );
    expect(onBoundary).not.toHaveBeenCalled();
  });

  it("a throwing onBoundary sink never affects the proxied response", async () => {
    const upstreamFetch = async () =>
      new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
    const handler = createProxyHandler(
      deps({
        upstreamFetch,
        onBoundary: () => {
          throw new Error("sink exploded");
        },
      }),
    );
    const out = makeRes();
    await expect(handler(makeReq("POST", "/v1/messages", {}, "{}"), out.res as never)).resolves.toBeUndefined();
    expect(out.status).toBe(200);
    expect(out.body).toBe("ok");
  });
```

- [ ] Run: `pnpm --filter @megasaver/llm-proxy test -- test/proxy-handler.test.ts`
  — expect FAIL: first new test asserts `seenAtCall` equals an object but it
  stays `null` (`onBoundary` is never invoked).

- [ ] GREEN — in `proxy-handler.ts`: add the type + dep field:

```ts
export type BoundaryObservation = { messageCount: number; lastBreakpointIndex: number | null };
```
  in `ProxyHandlerDeps` (after `onUsage`, line 11):
```ts
  // B4: positional cache-boundary observation. Invoked AFTER the response is
  // fully flushed (structural no-latency guarantee) and only for 2xx round
  // trips — a failed request caches nothing, so observing it would move the
  // boundary on evidence that does not exist.
  onBoundary?: (obs: BoundaryObservation) => void;
```
  destructure it at line 91, then rework the post-flush block (lines
  179-201; every response byte is already flushed by `res.end()` at line 177
  before this runs):

```ts
    try {
      if (method === "POST" && path.startsWith("/v1/messages") && (onUsage || onBoundary)) {
        const facts = parseRequestBodyFacts(bodyBuf.toString("utf8"));
        if (onUsage) {
          const usage = scanner
            ? scanner.result()
            : parseUsageFromJson(Buffer.concat(jsonCaptured).toString("utf8"));
          if (usage) {
            onUsage({
              id: newId(),
              ts: now(),
              model: facts.model,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cacheReadTokens: usage.cacheReadTokens,
              cacheCreationTokens: usage.cacheCreationTokens,
              messageCount: facts.messageCount,
              stream,
            });
          }
        }
        if (onBoundary && upstream.status >= 200 && upstream.status < 300) {
          onBoundary({
            messageCount: facts.messageCount,
            lastBreakpointIndex: facts.lastCacheBreakpointIndex,
          });
        }
      }
    } catch {
      // Measurement is best-effort; never affect the proxied response.
    }
```
  In `server.ts`: add `onBoundary?: (obs: BoundaryObservation) => void;` to
  `StartProxyOptions` (import the type) and spread it in `createProxyHandler`
  beside `onUsage` (line 31):
  `...(opts.onBoundary ? { onBoundary: opts.onBoundary } : {}),`
  In `index.ts`: export `type BoundaryObservation` from `./proxy-handler.js`.

- [ ] Run: `pnpm --filter @megasaver/llm-proxy test && pnpm --filter @megasaver/llm-proxy typecheck`
  — expect PASS (server.test.ts and health.test.ts untouched and green).
- [ ] Commit: `feat(llm-proxy): onBoundary observation sink`

---

### Task 5: supervise wires `onBoundary` to the record writer

**Files:**
- Modify: `/Users/ozger/Desktop/MegaSaver/apps/cli/src/commands/proxy/supervise.ts`
- Test: `/Users/ozger/Desktop/MegaSaver/apps/cli/test/commands/proxy/supervise.test.ts`

**Steps:**

- [ ] RED — in `supervise.test.ts` (mirror the "starts the server…" test at
  line 55 and its `fakeStart` capture pattern; extend the file's
  `@megasaver/llm-proxy` import with `readCacheBoundaryRecord` and
  `type BoundaryObservation`):

```ts
  it("wires onBoundary to the cache-boundary record writer", async () => {
    let captured: ((obs: BoundaryObservation) => void) | undefined;
    const fakeStart = (opts: StartProxyOptions): Promise<RunningProxy> => {
      captured = opts.onBoundary;
      return Promise.resolve({
        url: "http://127.0.0.1:8787",
        port: 8787,
        close: () => Promise.resolve(),
      });
    };
    await runProxySupervise({
      port: 8787,
      upstream: "https://api.anthropic.com",
      storeRoot: store,
      stdout: () => {},
      startServer: fakeStart,
    });
    expect(captured).toBeDefined();
    captured?.({ messageCount: 12, lastBreakpointIndex: 9 });
    const rec = readCacheBoundaryRecord(store);
    expect(rec?.current.messageCount).toBe(12);
    expect(rec?.current.lastBreakpointIndex).toBe(9);
    expect(rec?.previous).toBeNull();
  });
```
  NOTE: mimic the surrounding tests' exact `runProxySupervise` input shape if
  it differs (e.g. required flags added since this plan was written) — the
  assertion body is the contract, the input scaffold follows the neighbors.

- [ ] Run: `pnpm --filter @megasaver/cli test -- test/commands/proxy/supervise.test.ts`
  — expect FAIL: `captured` stays `undefined`
  (`expected undefined to be defined`).

- [ ] GREEN — in `supervise.ts`: extend the `@megasaver/llm-proxy` import
  (line 6) with `recordCacheBoundaryObservation`, and in the `startServer`
  options (after the `onUsage` closure, lines 77-84) add:

```ts
      onBoundary: (obs) => {
        // Best-effort like appendProxyUsage above: a dropped observation must
        // never disrupt proxying; the next round trip re-observes.
        try {
          recordCacheBoundaryObservation({
            storeRoot: input.storeRoot,
            messageCount: obs.messageCount,
            lastBreakpointIndex: obs.lastBreakpointIndex,
          });
        } catch {
          /* observation is best-effort */
        }
      },
```

- [ ] Run: `pnpm --filter @megasaver/cli test -- test/commands/proxy/supervise.test.ts`
  — expect PASS (all pre-existing supervise tests unchanged).
- [ ] Commit: `feat(cli): wire proxy boundary observations`

---

### Task 6: boundary-guard receipts in context-gate

**Files:**
- Create: `/Users/ozger/Desktop/MegaSaver/packages/context-gate/src/boundary-guard-stats.ts`
- Modify: `/Users/ozger/Desktop/MegaSaver/packages/context-gate/src/index.ts`
- Create: `/Users/ozger/Desktop/MegaSaver/packages/context-gate/test/boundary-guard-stats.test.ts`

**Interfaces:**
```ts
export type BoundaryGuardOutcome = "allow" | "refuse";
export type BoundaryGuardStats = {
  consults: number;
  refusals: number;
  lastRefusalAt: string | null;
};
export function recordBoundaryGuardOutcome(
  storeRoot: string,
  workspaceKey: string,
  outcome: BoundaryGuardOutcome,
  tsIso: string,
): void; // stats/<wk>/boundary-guard.json {version:1, consults, refusals, lastRefusalAt}
export function readBoundaryGuardStats(
  storeRoot: string,
  workspaceKey: string,
): BoundaryGuardStats | null;
export function sumBoundaryGuardStats(storeRoot: string): BoundaryGuardStats;
```
`sumBoundaryGuardStats` exists so doctor stays thin AND `@megasaver/cli`
keeps reading stats only through context-gate (the routing note at
packages/context-gate/src/index.ts, "forbidden from depending on
@megasaver/stats directly").

**Steps:**

- [ ] RED — create `packages/context-gate/test/boundary-guard-stats.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readBoundaryGuardStats,
  recordBoundaryGuardOutcome,
  sumBoundaryGuardStats,
} from "../src/boundary-guard-stats.js";

describe("boundary-guard receipts", () => {
  let store: string;
  beforeEach(() => {
    store = mkdtempSync(join(tmpdir(), "ctx-gate-bg-"));
  });
  afterEach(() => {
    rmSync(store, { recursive: true, force: true });
  });

  it("counts consults and refusals exactly (receipts math)", () => {
    recordBoundaryGuardOutcome(store, "wk-a", "allow", "2026-08-06T12:00:00.000Z");
    recordBoundaryGuardOutcome(store, "wk-a", "allow", "2026-08-06T12:00:01.000Z");
    recordBoundaryGuardOutcome(store, "wk-a", "refuse", "2026-08-06T12:00:02.000Z");
    expect(readBoundaryGuardStats(store, "wk-a")).toEqual({
      consults: 3,
      refusals: 1,
      lastRefusalAt: "2026-08-06T12:00:02.000Z",
    });
  });

  it("an allow after a refuse keeps lastRefusalAt", () => {
    recordBoundaryGuardOutcome(store, "wk-a", "refuse", "2026-08-06T12:00:00.000Z");
    recordBoundaryGuardOutcome(store, "wk-a", "allow", "2026-08-06T12:00:01.000Z");
    expect(readBoundaryGuardStats(store, "wk-a")?.lastRefusalAt).toBe("2026-08-06T12:00:00.000Z");
  });

  it("no file → null; corrupt file reads as absent and the next receipt restarts", () => {
    expect(readBoundaryGuardStats(store, "wk-a")).toBeNull();
    mkdirSync(join(store, "stats", "wk-a"), { recursive: true });
    writeFileSync(join(store, "stats", "wk-a", "boundary-guard.json"), "{ corrupt");
    expect(readBoundaryGuardStats(store, "wk-a")).toBeNull();
    recordBoundaryGuardOutcome(store, "wk-a", "allow", "2026-08-06T12:00:00.000Z");
    expect(readBoundaryGuardStats(store, "wk-a")).toEqual({
      consults: 1,
      refusals: 0,
      lastRefusalAt: null,
    });
  });

  it("sums across workspaces with the newest lastRefusalAt", () => {
    recordBoundaryGuardOutcome(store, "wk-a", "refuse", "2026-08-06T12:00:00.000Z");
    recordBoundaryGuardOutcome(store, "wk-b", "refuse", "2026-08-06T13:00:00.000Z");
    recordBoundaryGuardOutcome(store, "wk-b", "allow", "2026-08-06T13:00:01.000Z");
    expect(sumBoundaryGuardStats(store)).toEqual({
      consults: 3,
      refusals: 2,
      lastRefusalAt: "2026-08-06T13:00:00.000Z",
    });
  });

  it("sum skips non-workspace entries in stats/ (e.g. the heartbeat registry file)", () => {
    mkdirSync(join(store, "stats"), { recursive: true });
    writeFileSync(join(store, "stats", "saver-hook-heartbeats.json"), "{}");
    recordBoundaryGuardOutcome(store, "wk-a", "allow", "2026-08-06T12:00:00.000Z");
    expect(sumBoundaryGuardStats(store)).toEqual({ consults: 1, refusals: 0, lastRefusalAt: null });
  });

  it("empty store sums to zero", () => {
    expect(sumBoundaryGuardStats(store)).toEqual({ consults: 0, refusals: 0, lastRefusalAt: null });
  });
});
```

- [ ] Run: `pnpm --filter @megasaver/context-gate test -- test/boundary-guard-stats.test.ts`
  — expect FAIL: `Failed to resolve import "../src/boundary-guard-stats.js"`.

- [ ] GREEN — create `packages/context-gate/src/boundary-guard-stats.ts`:

```ts
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { withFileLock } from "@megasaver/shared/node";
import { z } from "zod";

// B4 receipts: consults/refusals incremented ONLY by real gate evaluations in
// buildSaverDecision — no estimated-savings claims, ever. A refusal is a
// conservative skip (one compression forgone at baseline cost), never a
// fault. Lock-miss or write failure drops the receipt: undercount, never
// overcount.

const LOCK_OPTIONS = { deadlineMs: 50, staleMs: 5000 }; // the saver-seen options (E26)

const statsSchema = z
  .object({
    version: z.literal(1),
    consults: z.number().int().nonnegative(),
    refusals: z.number().int().nonnegative(),
    lastRefusalAt: z.string().nullable(),
  })
  .strict();

export type BoundaryGuardOutcome = "allow" | "refuse";
export type BoundaryGuardStats = {
  consults: number;
  refusals: number;
  lastRefusalAt: string | null;
};

const empty = (): BoundaryGuardStats => ({ consults: 0, refusals: 0, lastRefusalAt: null });

function statsPath(storeRoot: string, workspaceKey: string): string {
  return join(storeRoot, "stats", workspaceKey, "boundary-guard.json");
}

function readOrNull(path: string): BoundaryGuardStats | null {
  try {
    const st = lstatSync(path);
    if (st.isSymbolicLink() || !st.isFile()) return null;
    const parsed = statsSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (!parsed.success) return null;
    const { consults, refusals, lastRefusalAt } = parsed.data;
    return { consults, refusals, lastRefusalAt };
  } catch {
    return null;
  }
}

export function recordBoundaryGuardOutcome(
  storeRoot: string,
  workspaceKey: string,
  outcome: BoundaryGuardOutcome,
  tsIso: string,
): void {
  const path = statsPath(storeRoot, workspaceKey);
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  withFileLock(`${path}.lock`, LOCK_OPTIONS, () => {
    const prior = readOrNull(path) ?? empty();
    const next = {
      version: 1 as const,
      consults: prior.consults + 1,
      refusals: outcome === "refuse" ? prior.refusals + 1 : prior.refusals,
      lastRefusalAt: outcome === "refuse" ? tsIso : prior.lastRefusalAt,
    };
    const tmp = join(dir, `.${randomUUID()}.bg.tmp`);
    try {
      writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, path);
    } finally {
      try {
        rmSync(tmp, { force: true });
      } catch {
        /* already renamed */
      }
    }
  });
}

export function readBoundaryGuardStats(
  storeRoot: string,
  workspaceKey: string,
): BoundaryGuardStats | null {
  return readOrNull(statsPath(storeRoot, workspaceKey));
}

// Doctor sums the per-workspace receipts. Anomalous entries (files in stats/,
// corrupt json) read as absent, matching every reader in this module.
export function sumBoundaryGuardStats(storeRoot: string): BoundaryGuardStats {
  let entries: string[];
  try {
    entries = readdirSync(join(storeRoot, "stats"));
  } catch {
    return empty();
  }
  const total = empty();
  for (const wk of entries) {
    const s = readBoundaryGuardStats(storeRoot, wk);
    if (s === null) continue;
    total.consults += s.consults;
    total.refusals += s.refusals;
    if (
      s.lastRefusalAt !== null &&
      (total.lastRefusalAt === null || s.lastRefusalAt > total.lastRefusalAt)
    ) {
      total.lastRefusalAt = s.lastRefusalAt;
    }
  }
  return total;
}
```
  Add to `packages/context-gate/src/index.ts` (beside the saver-seen export,
  line 163):

```ts
export {
  readBoundaryGuardStats,
  recordBoundaryGuardOutcome,
  sumBoundaryGuardStats,
  type BoundaryGuardOutcome,
  type BoundaryGuardStats,
} from "./boundary-guard-stats.js";
```

- [ ] Run: `pnpm --filter @megasaver/context-gate test -- test/boundary-guard-stats.test.ts`
  — expect PASS.
- [ ] Commit: `feat(context-gate): boundary guard receipts`

---

### Task 7: the gate in `buildSaverDecision`

**Files:**
- Modify: `/Users/ozger/Desktop/MegaSaver/apps/cli/src/hooks/saver.ts`
- Test: `/Users/ozger/Desktop/MegaSaver/apps/cli/test/hooks/saver.test.ts`
- Modify (fixture-only, mechanical): `/Users/ozger/Desktop/MegaSaver/apps/cli/test/hooks/saver-worktree-inheritance.test.ts` (deps literals at lines 102-103 and 137-138), `/Users/ozger/Desktop/MegaSaver/apps/cli/test/doctor-saver.test.ts` (deps literal at line 256-257), `/Users/ozger/Desktop/MegaSaver/apps/cli/test/hooks/saver.test.ts` (`realDeps` at line 295 and the inline literal near line 399)

**Interfaces:**
```ts
// SaverDeps additions (apps/cli/src/hooks/saver.ts, after recordSeenOutput):
readCacheBoundary: (storeRoot: string) => CacheBoundaryRecord | null;
recordBoundaryOutcome: (
  storeRoot: string,
  workspaceKey: string,
  outcome: "allow" | "refuse",
) => void;
```
`evaluateCacheBoundary` + `type CacheBoundaryRecord` are imported directly
from `@megasaver/llm-proxy` (already a dependency, apps/cli/package.json:48;
the verdict is pure so it is not injected).

**Steps:**

- [ ] RED — in `apps/cli/test/hooks/saver.test.ts`: extend the `deps()`
  fixture (line 25) with two defaults —
  `readCacheBoundary: () => null,` and `recordBoundaryOutcome: vi.fn(),` —
  then append a new describe (mimics the existing decision-table style; note
  the fixture's `storeRoot` is `"/store"` and payload cwd is
  `"/Users/x/proj"`):

```ts
describe("buildSaverDecision cache-boundary guard (B4)", () => {
  const fresh = (messageCount: number, lastBreakpointIndex: number | null) => ({
    version: 1 as const,
    // Fresh vs the 1h TTL — ms-scale test runs can never cross it (no
    // timing-tight window).
    current: { messageCount, lastBreakpointIndex, observedAt: new Date().toISOString() },
    previous: null,
  });

  it("refuse → passthrough with ZERO record() calls and a refuse receipt", async () => {
    // forged bp >= mc trips the wire deterministically
    const d = deps({ readCacheBoundary: () => fresh(5, 5) });
    const out = await buildSaverDecision(bigBash("X".repeat(50_000)), d);
    expect(out).toEqual({ passthrough: true });
    expect(d.record).not.toHaveBeenCalled();
    expect(d.recordBoundaryOutcome).toHaveBeenCalledOnce();
    expect((d.recordBoundaryOutcome as Mock).mock.calls[0]).toEqual([
      "/store",
      encodeWorkspaceKey("/Users/x/proj"),
      "refuse",
    ]);
  });

  it("allow → compression proceeds with an allow receipt", async () => {
    const d = deps({ readCacheBoundary: () => fresh(10, 7) });
    const out = await buildSaverDecision(bigBash("X".repeat(50_000)), d);
    expect("updatedToolOutput" in out).toBe(true);
    expect(d.record).toHaveBeenCalledOnce();
    expect((d.recordBoundaryOutcome as Mock).mock.calls).toEqual([
      ["/store", encodeWorkspaceKey("/Users/x/proj"), "allow"],
    ]);
  });

  it("no record → no consult recorded, exactly today's behavior", async () => {
    const d = deps();
    const out = await buildSaverDecision(bigBash("X".repeat(50_000)), d);
    expect("updatedToolOutput" in out).toBe(true);
    expect(d.recordBoundaryOutcome).not.toHaveBeenCalled();
  });

  it("guard sits AFTER the seen-hash gate: a seen repeat consults nothing", async () => {
    const d = deps({ hasSeenOutput: () => true, readCacheBoundary: () => fresh(5, 5) });
    const out = await buildSaverDecision(bigBash("X".repeat(50_000)), d);
    expect(out).toEqual({ passthrough: true });
    // A receipt only ever counts a compression that would actually have
    // proceeded (Locked Decision 5) — honest counting.
    expect(d.recordBoundaryOutcome).not.toHaveBeenCalled();
  });

  it('a throwing readCacheBoundary dep stays passthrough under the "resolve" stage', async () => {
    const d = deps({
      readCacheBoundary: () => {
        throw new Error("boom");
      },
    });
    const out = await buildSaverDecision(bigBash("X".repeat(50_000)), d);
    expect(out).toEqual({ passthrough: true });
    expect(d.recordFailure).toHaveBeenCalledOnce();
    const [, , kind] = (d.recordFailure as unknown as Mock).mock.calls[0] as [string, string, string];
    expect(kind).toBe("resolve");
  });
});
```
  Also extend the other SaverDeps object literals (they are exact-typed, so
  the build breaks without this): add
  `readCacheBoundary: () => null,` and `recordBoundaryOutcome: () => {},` to
  `realDeps` (saver.test.ts:295), the inline literal near saver.test.ts:399,
  saver-worktree-inheritance.test.ts:102-103 and :137-138, and
  doctor-saver.test.ts:256-257. No assertion in any existing test changes —
  that suite is the regression evidence.

- [ ] Run: `pnpm --filter @megasaver/cli test -- test/hooks/saver.test.ts`
  — expect FAIL: the refuse test gets `{ updatedToolOutput: … }` instead of
  `{ passthrough: true }` (no gate exists yet).

- [ ] GREEN — in `apps/cli/src/hooks/saver.ts`: add the import
  `import { type CacheBoundaryRecord, evaluateCacheBoundary } from "@megasaver/llm-proxy";`,
  add the two fields to `SaverDeps` (after `recordSeenOutput`, line 102-107):

```ts
  // B4 cache-boundary guard. Impure edges injected (fail-open wrappers live
  // in saver-run.ts); the verdict itself is pure and imported directly.
  readCacheBoundary: (storeRoot: string) => CacheBoundaryRecord | null;
  recordBoundaryOutcome: (
    storeRoot: string,
    workspaceKey: string,
    outcome: "allow" | "refuse",
  ) => void;
```
  and insert the gate in `decide()` between the seen-hash check (line 382)
  and `const label = …` / `ctx.stage = "record"` (lines 384-386) so a guard
  throw still surfaces under the existing `"resolve"` stage:

```ts
  // B4 positional guard (Locked Decisions 4-5): after the seen-hash gate so
  // every refusal receipts a compression that would actually have proceeded;
  // before record() so a refusal persists nothing. "no-consult" (missing or
  // expired record) is exactly today's behavior and records nothing. The
  // read is synchronous — the decision path gains no awaited I/O.
  const verdict = evaluateCacheBoundary(deps.readCacheBoundary(deps.storeRoot), Date.now());
  if (verdict !== "no-consult") deps.recordBoundaryOutcome(deps.storeRoot, workspaceKey, verdict);
  if (verdict === "refuse") return PASSTHROUGH;
```

- [ ] Run: `pnpm --filter @megasaver/cli test -- test/hooks/saver.test.ts test/hooks/saver-worktree-inheritance.test.ts test/hooks/saver-roundtrip.test.ts`
  — expect PASS (new describe green, every pre-existing saver test green
  unchanged).
- [ ] Commit: `feat(cli): cache-boundary gate in saver`

---

### Task 8: fail-open wiring in `saver-run.ts`

**Files:**
- Modify: `/Users/ozger/Desktop/MegaSaver/apps/cli/src/hooks/saver-run.ts`
- Test: `/Users/ozger/Desktop/MegaSaver/apps/cli/test/hooks/saver-run.test.ts`

**Interfaces:**
```ts
// Exported for tests, like makeRecord (saver-run.ts:108):
export function readCacheBoundaryFailOpen(storeRoot: string): CacheBoundaryRecord | null;
export function recordBoundaryOutcomeFailOpen(
  storeRoot: string,
  workspaceKey: string,
  outcome: "allow" | "refuse",
): void;
```

**Steps:**

- [ ] RED — append to `apps/cli/test/hooks/saver-run.test.ts` (mkdtemp
  harness mirrors the makeRecord tests in the same file; extend imports:
  `readCacheBoundaryFailOpen, recordBoundaryOutcomeFailOpen` from
  `../../src/hooks/saver-run.js`, `recordCacheBoundaryObservation` from
  `@megasaver/llm-proxy`, `readBoundaryGuardStats` from
  `@megasaver/context-gate`, plus `mkdirSync, writeFileSync` from `node:fs`):

```ts
describe("boundary-guard fail-open wiring", () => {
  let store: string;
  beforeEach(() => {
    store = mkdtempSync(join(tmpdir(), "saver-run-bg-"));
  });
  afterEach(() => {
    rmSync(store, { recursive: true, force: true });
  });

  it("reads a real proxy-written record back (happy path)", () => {
    recordCacheBoundaryObservation({
      storeRoot: store,
      messageCount: 12,
      lastBreakpointIndex: 9,
      observedAt: "2026-08-06T12:00:00.000Z",
    });
    expect(readCacheBoundaryFailOpen(store)?.current.messageCount).toBe(12);
  });

  it("corrupt record → null, never a throw", () => {
    mkdirSync(join(store, "proxy-usage"), { recursive: true });
    writeFileSync(join(store, "proxy-usage", "cache-boundary.json"), "{ corrupt");
    expect(readCacheBoundaryFailOpen(store)).toBeNull();
  });

  it("outcome receipts land in stats/<wk>/boundary-guard.json", () => {
    recordBoundaryOutcomeFailOpen(store, "wk-a", "refuse");
    const s = readBoundaryGuardStats(store, "wk-a");
    expect(s?.consults).toBe(1);
    expect(s?.refusals).toBe(1);
  });

  it("a failing receipt write is swallowed (fail-open)", () => {
    // stats path collides with a FILE so the writer's mkdir throws inside.
    writeFileSync(join(store, "stats"), "not a dir");
    expect(() => recordBoundaryOutcomeFailOpen(store, "wk-a", "allow")).not.toThrow();
  });
});
```

- [ ] Run: `pnpm --filter @megasaver/cli test -- test/hooks/saver-run.test.ts`
  — expect FAIL: `does not provide an export named 'readCacheBoundaryFailOpen'`.

- [ ] GREEN — in `saver-run.ts`: extend the `@megasaver/context-gate` import
  (line 2-13) with `recordBoundaryGuardOutcome`, add
  `import { type CacheBoundaryRecord, readCacheBoundaryRecord } from "@megasaver/llm-proxy";`,
  then beside the `recordSeenOutput` wrapper (line 81-92) add:

```ts
// B4: both boundary-guard deps are best-effort at this layer (mirroring
// recordSeenOutput above): a read anomaly is "no record" (guard stands
// down), a dropped receipt only undercounts. Both are synchronous fs — the
// decision path gains no awaited I/O. Exported for tests.
export function readCacheBoundaryFailOpen(storeRoot: string): CacheBoundaryRecord | null {
  try {
    return readCacheBoundaryRecord(storeRoot);
  } catch {
    return null;
  }
}
export function recordBoundaryOutcomeFailOpen(
  storeRoot: string,
  workspaceKey: string,
  outcome: "allow" | "refuse",
): void {
  try {
    recordBoundaryGuardOutcome(storeRoot, workspaceKey, outcome, new Date().toISOString());
  } catch {
    /* receipts are best-effort */
  }
}
```
  and wire both into the `deps` object in `runSaverHookFromProcess`
  (lines 166-177):

```ts
      readCacheBoundary: readCacheBoundaryFailOpen,
      recordBoundaryOutcome: recordBoundaryOutcomeFailOpen,
```
  `runSaverHookFromProcess` itself is otherwise unchanged (exit 0 catch-all
  stays, saver-run.ts:154-189).

- [ ] Run: `pnpm --filter @megasaver/cli test -- test/hooks/saver-run.test.ts`
  — expect PASS.
- [ ] Commit: `feat(cli): fail-open boundary guard wiring`

---

### Task 9: doctor receipts line

**Files:**
- Modify: `/Users/ozger/Desktop/MegaSaver/apps/cli/src/commands/doctor-saver.ts`
- Test: `/Users/ozger/Desktop/MegaSaver/apps/cli/test/doctor-saver.test.ts`

**Steps:**

- [ ] RED — append to the `runSaverChecks` describe in
  `apps/cli/test/doctor-saver.test.ts` (helpers `find`, `fakeBinary`,
  `quotedBin`, `writeHookSettings`, `iso`, `NOW` already exist in the file;
  extend the `@megasaver/context-gate` import with
  `recordBoundaryGuardOutcome`):

```ts
  it("saver-boundary-guard sums receipts across workspaces and always passes", () => {
    const settingsPath = writeHookSettings(`${quotedBin(fakeBinary())} hooks saver`);
    recordBoundaryGuardOutcome(storeRoot, "wk-a", "refuse", iso(NOW - 1000));
    recordBoundaryGuardOutcome(storeRoot, "wk-b", "allow", iso(NOW - 500));
    const check = find(runSaverChecks({ settingsPath, storeRoot }), "saver-boundary-guard");
    expect(check?.pass).toBe(true);
    expect(check?.value).toContain("2 consults");
    expect(check?.value).toContain("1 refusals");
    expect(check?.value).toContain(iso(NOW - 1000));
  });

  it("saver-boundary-guard with no receipts is informational and passes", () => {
    const settingsPath = writeHookSettings(`${quotedBin(fakeBinary())} hooks saver`);
    const check = find(runSaverChecks({ settingsPath, storeRoot }), "saver-boundary-guard");
    expect(check).toEqual({ key: "saver-boundary-guard", value: "no consults yet", pass: true });
  });
```

- [ ] Run: `pnpm --filter @megasaver/cli test -- test/doctor-saver.test.ts`
  — expect FAIL: `find(…)` returns `undefined` (`expected undefined to be true`).

- [ ] GREEN — in `doctor-saver.ts`: extend the `@megasaver/context-gate`
  import with `sumBoundaryGuardStats`, and inside `runSaverChecks` push one
  Check after the `saver-proxy-route` block and before
  `checks.push(...refreshNetEffectVerdicts(…))` (the tail of the function,
  around line 538):

```ts
  // B4 boundary-guard receipts — informational only: a refusal is a
  // conservative skip (one compression forgone at baseline cost), never a
  // fault, so this line can never fail doctor.
  const guard = sumBoundaryGuardStats(storeRoot);
  checks.push({
    key: "saver-boundary-guard",
    value:
      guard.consults === 0
        ? "no consults yet"
        : `${guard.consults} consults, ${guard.refusals} refusals${
            guard.lastRefusalAt !== null ? ` (last refusal ${guard.lastRefusalAt})` : ""
          }`,
    pass: true,
  });
```

- [ ] Run: `pnpm --filter @megasaver/cli test -- test/doctor-saver.test.ts`
  — expect PASS.
- [ ] Commit: `feat(cli): doctor boundary-guard receipts line`

---

### Task 10: changeset, full verify, smoke evidence

**Files:**
- Create: `/Users/ozger/Desktop/MegaSaver/.changeset/cache-boundary-guard.md`

**Steps:**

- [ ] Create `.changeset/cache-boundary-guard.md` (format mirrors
  `.changeset/bench-replay.md`):

```md
---
"@megasaver/llm-proxy": minor
"@megasaver/context-gate": minor
"@megasaver/cli": minor
---

Cache-boundary guard (B4): the proxy observes the last `cache_control`
breakpoint POSITION of each 2xx `/v1/messages` request (integer indices +
timestamps only — never content), persists the last two observations
atomically at `proxy-usage/cache-boundary.json`, and `buildSaverDecision`
refuses a rewrite whose projected target index falls at or before a fresh
recorded boundary. Fail-open everywhere: no record → exactly prior behavior.
Receipts (`consults`/`refusals`) land in `stats/<wk>/boundary-guard.json`
and surface as an informational `mega doctor` line. Steady-state refusals
are expected ≈ 0 on today's client; firings mark rebuild windows or forged
records (tripwire).
```

- [ ] Run: `pnpm verify` — expect PASS (biome + tsc project refs + full
  vitest + conventions:check). Fix any drift before proceeding; do NOT use
  `--no-verify` anywhere.
- [ ] Smoke evidence (DoD 5, spec §Testing): in a scratch store, run
  `mega proxy` supervised, point a real client at it
  (`ANTHROPIC_BASE_URL=http://127.0.0.1:<port>`), make two calls, and
  capture: (a) `cache-boundary.json` contents after each call showing the
  current→previous shift, (b) the `mega doctor` output containing the
  `saver-boundary-guard` line. Save the captured terminal session with the
  feature evidence.
- [ ] Commit: `chore: changeset for cache-boundary guard`
- [ ] Self-review the full diff against the spec's Locked Decisions 1-7,
  then hand off per §Risk & process: `code-reviewer` AND `critic` in
  separate fresh contexts, then `verifier`. Author is never reviewer.
