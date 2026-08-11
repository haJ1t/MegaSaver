# On-Demand Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** `mega --on-demand <read-cmd>` runs read-only commands without `mega daemon start` by forking the standalone bundle `dist-bundle/mega.mjs` as a one-shot worker (one JSON req in → one JSON resp out → exit). Writes remain daemon-gated via closed allow-list.

**Architecture:** Allow-list gate (`packages/policy/src/on-demand-gate.ts`) + spawn/run worker (`apps/cli/src/core/worker.ts`) + config `core` field + dispatch branch in `main.ts`. Same core/content-store read path, only entry differs.

**Tech Stack:** TypeScript strict ESM, Zod strict, Vitest, citty, node:child_process spawn/execFile, node:fs, `@megasaver/policy`, `@megasaver/core`, `@megasaver/content-store`, `@megasaver/stats`.

## Global Constraints

- Allow-list is closed enum, not substring — unknown cmd denied.
- One request → one response → exit; 10s total timeout then SIGTERM→500ms→SIGKILL.
- Bundle is sole worker artifact; stale bundle refuses.
- Same core code path (`createRegistry`, `content-store` reads) — no alternate impl.
- Config precedence: `--on-demand`/`--daemon` flag > `mega.config.json core` > `daemon` default.
- Env forward allow-list: HOME, MEGASAVER_HOME, MEGASAVER_STORE, NODE_ENV, CI only.
- No shell, argv array only; SAFE_SEGMENT + realpath before reads.

---

### Task 1: policy gate + config `core` field

**Files:**
- Create: `packages/policy/src/on-demand-gate.ts`
- Modify: `packages/policy/src/index.ts` (export)
- Modify: `apps/cli/src/config.ts` (add `core` field)
- Test: `packages/policy/test/on-demand-gate.test.ts` + `apps/cli/test/config-core.test.ts`

**Interfaces:**
```ts
// packages/policy/src/on-demand-gate.ts
export const ON_DEMAND_ALLOWLIST: readonly string[]; // closed: "output:filter","output:file","context:why","context:hotspots","context:yield","preflight:snapshot","preflight:diff","sessions:live","doctor","sweep:scan","inspect","deja-vu","audit","version"
export function isOnDemandAllowed(cmd: string): boolean;
export const onDemandCmdSchema: z.ZodType<string>; // enum strict

// apps/cli/src/config.ts
export const megaConfigSchema = z.object({ core: z.enum(["daemon","on-demand"]).optional(), ... }).strict();
```

- [ ] Write failing tests:
```ts
import { describe, expect, it } from "vitest";
import { isOnDemandAllowed, ON_DEMAND_ALLOWLIST } from "../src/on-demand-gate.js";
describe("on-demand gate",()=>{
  it("allows reads",()=>{ expect(isOnDemandAllowed("output:filter")).toBe(true); expect(isOnDemandAllowed("sessions:live")).toBe(true); });
  it("denies writes",()=>{ expect(isOnDemandAllowed("memory:create")).toBe(false); expect(isOnDemandAllowed("handoff:pack")).toBe(false); });
  it("denies unknown",()=>{ expect(isOnDemandAllowed("unknown:cmd")).toBe(false); });
  it("allowlist closed",()=>{ expect(ON_DEMAND_ALLOWLIST).toContain("context:yield"); });
});
```
  plus `config-core.test.ts` — parse `{core:"on-demand"}` valid, `{core:"invalid"}` strict rejects, precedence flag>config.
- [ ] Run `pnpm --filter @megasaver/policy exec vitest run test/on-demand-gate.test.ts` + `pnpm --filter @megasaver/cli exec vitest run test/config-core.test.ts` — FAIL
- [ ] Implement `on-demand-gate.ts` (closed Set, strict) + `config.ts` field + export
- [ ] Run tests — PASS
- [ ] Commit: `feat(policy): on-demand allowlist + config core`

---

### Task 2: one-shot worker spawn + run

**Files:**
- Create: `apps/cli/src/core/worker.ts`
- Test: `apps/cli/test/core/worker.test.ts` (integration with tmp bundle mock)

**Interfaces:**
```ts
export const WORKER_TIMEOUT_MS = 10_000;
export async function spawnOnDemandWorker(input: {
  bundlePath: string; home: string; storeFlag?: string;
  request: unknown; // strict Zod validated before write
}): Promise<{ response: unknown }>;
export async function runOnDemandWorker(input: {
  bundlePath: string; stdin: NodeJS.ReadableStream; stdout: NodeJS.WritableStream;
}): Promise<0|1>; // single-shot worker entry inside bundle
export function isBundleStale(bundlePath: string): boolean;
```

- [ ] Write failing test `apps/cli/test/core/worker.test.ts`:
```ts
import { mkdtempSync, rmSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isBundleStale, spawnOnDemandWorker } from "../../src/core/worker.js";
describe("on-demand worker",()=>{
  it("stale bundle refuses",()=>{ expect(isBundleStale("/tmp/bundle-missing.mjs")).toBe(true); });
  it("echoes one request",async()=>{ /* tmp bundle mock that echoes */ });
  it("timeout kills",async()=>{ /* child sleeps 11s → parent KILL */ }, 15000);
});
```
- [ ] Run — FAIL
- [ ] Implement `worker.ts` (spawn `node --experimental-strip-types bundle --worker --on-demand`, bounded 1MB stdin frame, 5s per leg, SIGTERM→KILL, stderr passthrough, stale check via `stat` mtime vs `dist-bundle/mega.mjs` built at `tsup` time)
- [ ] Run — PASS (isolated, no daemon)
- [ ] Commit: `feat(cli): on-demand one-shot worker`

---

### Task 3: main dispatch + read-command wiring + doctor reporting

**Files:**
- Modify: `apps/cli/src/main.ts`
- Modify: `apps/cli/src/commands/sessions/live.ts`, `apps/cli/src/commands/context/yield.ts`, `apps/cli/src/commands/output/filter.ts` (thread `coreMode` into receipt if not already)
- Modify: `apps/cli/src/commands/doctor/index.ts` (report `coreMode` + `onDemandReads`)
- Test: `apps/cli/test/commands/on-demand-dispatch.test.ts`

**Interfaces:**
```ts
// main.ts parsing
const coreMode: "daemon"|"on-demand" = flagOnDemand ? "on-demand" : flagDaemon ? "daemon" : config.core ?? "daemon";
if (coreMode==="on-demand" && !isOnDemandAllowed(cmd)) throw new PolicyError(`...requires daemon`);
```

- [ ] Write failing test `on-demand-dispatch.test.ts` — `runMain(["--on-demand","sessions","live","--json"])` with daemon stopped → exits 0 and returns valid JSON; `runMain(["--on-demand","memory","create","--content","x"])` → exits 1 before spawn (spy on `spawnOnDemandWorker` not called).
- [ ] Run — FAIL
- [ ] Implement dispatch branch in `main.ts` (pre-citty flag peel, gate check, worker path vs daemonClient path), thread `coreMode` into stats.
- [ ] Run tests — PASS, `pnpm --filter @megasaver/cli test` green
- [ ] Commit: `feat(cli): on-demand dispatch`

---

### Task 4: changeset, wiki, verify

**Files:** `.changeset/on-demand-core.md`, `wiki/entities/cli.md`, `wiki/decisions/on-demand-core.md`, `wiki/index.md`, `wiki/log.md`

- [ ] Add changeset (`@megasaver/policy` minor, `@megasaver/cli` minor)
- [ ] Create `wiki/decisions/on-demand-core.md` (closed allowlist rationale, single-shot lifecycle, same-path parity proof note)
- [ ] Update `wiki/entities/cli.md` (`--on-demand` flag, `core` config), `wiki/index.md` quick links, append `wiki/log.md: ## [2026-08-11] plan | wave-4 3of3 HIGH`
- [ ] Run `pnpm verify` — lint+typecheck+test green (both linux+windows branches)
- [ ] Smoke (daemon stopped): `mega --on-demand sessions live --json` parses; `mega --on-demand memory create --content "x"` exits 1 gated; `mega --on-demand context yield --json` parses on seeded store
- [ ] Commit: `chore: changeset + wiki for on-demand core`
- [ ] Hand off to `architect` + `critic` separate passes (HIGH gate)

---

## Self-review checklist

- [ ] allowlist closed, unknown denied, writes gated before spawn
- [ ] one-shot lifecycle, no keep-alive, SIGTERM→KILL verified
- [ ] same code path, coreMode only in receipt
- [ ] env forward allow-list, no shell, SAFE_SEGMENT+realpath
- [ ] stale bundle refuses, timeout kills
