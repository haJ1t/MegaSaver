# Variance-Controlled Benchmark Harness (L0 + L1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a ≤5% cost effect resolvable — kill the fast-mode billing artifact with token-derived cost (L0), and remove agent-path nondeterminism by replaying one recorded conversation through both arms (L1).

**Architecture:** L0 is a pure cost function in `@megasaver/stats` reading rates from a single JSON source that the existing bash/python harness also reads (one source, guard test). L1 is a new private package `@megasaver/bench-replay`: a capture proxy records real `/v1/messages` bodies, a transform applier rewrites each `tool_result` per arm — the megasaver arm by **spawning the real `mega hooks saver` binary**, exactly as Claude Code does, so the shipped code path is what gets measured — and a sender replays both arms against the real API and reports normalized cost with a calibration guard.

**Tech Stack:** TypeScript strict ESM, Vitest, tsup, Node builtins (`node:http`, `node:child_process`), pnpm workspaces.

**Worktree:** create via `superpowers:using-git-worktrees`: branch `feat/bench-replay` off `main`.

**Verification baseline:** `pnpm install --frozen-lockfile && pnpm build && pnpm --filter @megasaver/gui build && pnpm verify` must be green BEFORE Task 1. (The `gui build` is required: turbo's cache does not restore `apps/gui/dist-bridge`, and `@megasaver/gui/bridge` fails to resolve without it — a known, unrelated infra gap.)

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `scripts/benchmark-rates.json` | create | single source of truth for per-Mtok rates |
| `packages/stats/src/benchmark-cost.ts` | create | pure `normalizedCostUsd(usage)` + rate constants |
| `packages/stats/src/index.ts` | modify | export it |
| `packages/stats/test/benchmark-cost.test.ts` | create | cost table tests + rates-JSON sync guard |
| `scripts/run-megasaver-claude-limit-test.sh` | modify | gate on normalized cost, report raw alongside |
| `packages/bench-replay/package.json` | create | private package manifest |
| `packages/bench-replay/tsconfig.json` | create | extends base |
| `packages/bench-replay/tsup.config.ts` | create | build config |
| `packages/bench-replay/src/types.ts` | create | `RecordedRequest`, `ArmUsage`, `ReplayVerdict` |
| `packages/bench-replay/src/capture-proxy.ts` | create | record `/v1/messages` bodies verbatim |
| `packages/bench-replay/src/transform.ts` | create | per-arm `tool_result` rewriting (spawns the saver hook) |
| `packages/bench-replay/src/replay.ts` | create | send a recorded sequence, collect usage |
| `packages/bench-replay/src/report.ts` | create | normalized-cost verdict + calibration guard |
| `packages/bench-replay/src/index.ts` | create | public surface |
| `packages/bench-replay/test/*.test.ts` | create | unit tests (no network) |
| `.changeset/bench-replay.md` | create | release note |

---

### Task 1: Rates JSON + `normalizedCostUsd` (L0 core)

**Files:**
- Create: `scripts/benchmark-rates.json`
- Create: `packages/stats/src/benchmark-cost.ts`
- Modify: `packages/stats/src/index.ts` (append export)
- Test: `packages/stats/test/benchmark-cost.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/stats/test/benchmark-cost.test.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BENCHMARK_RATES_PER_MTOK, normalizedCostUsd } from "../src/benchmark-cost.js";

// A usage object shaped like `claude --output-format json` .usage
const usage = (o: Partial<Parameters<typeof normalizedCostUsd>[0]>) => ({
  input_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  output_tokens: 0,
  ...o,
});

describe("normalizedCostUsd", () => {
  it("prices each token class at its documented rate", () => {
    // 1M of each class, one at a time.
    expect(normalizedCostUsd(usage({ input_tokens: 1_000_000 }))).toBeCloseTo(5, 6);
    expect(normalizedCostUsd(usage({ cache_creation_input_tokens: 1_000_000 }))).toBeCloseTo(10, 6);
    expect(normalizedCostUsd(usage({ cache_read_input_tokens: 1_000_000 }))).toBeCloseTo(0.5, 6);
    expect(normalizedCostUsd(usage({ output_tokens: 1_000_000 }))).toBeCloseTo(25, 6);
  });

  it("sums the classes", () => {
    const cost = normalizedCostUsd(
      usage({
        input_tokens: 20_000,
        cache_creation_input_tokens: 48_000,
        cache_read_input_tokens: 134_000,
        output_tokens: 1_000,
      }),
    );
    // 0.1 + 0.48 + 0.067 + 0.025
    expect(cost).toBeCloseTo(0.672, 6);
  });

  // THE artifact that broke the old gate: two runs of the same work, one served
  // at fast-mode (2x billed) and one standard, must normalize to the same cost.
  it("is identical for identical tokens regardless of how the request was billed", () => {
    const tokens = usage({
      input_tokens: 8,
      cache_creation_input_tokens: 48_681,
      cache_read_input_tokens: 134_075,
      output_tokens: 993,
    });
    const fastModeBilled = { ...tokens, speed: "fast" as const, total_cost_usd: 0.5787 };
    const standardBilled = { ...tokens, speed: "standard" as const, total_cost_usd: 0.3972 };
    expect(normalizedCostUsd(fastModeBilled)).toBe(normalizedCostUsd(standardBilled));
  });

  it("treats missing token fields as zero", () => {
    expect(normalizedCostUsd({} as never)).toBe(0);
  });

  it("constants stay in sync with scripts/benchmark-rates.json (single source)", () => {
    const jsonPath = fileURLToPath(new URL("../../../scripts/benchmark-rates.json", import.meta.url));
    const onDisk = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(onDisk).toEqual(BENCHMARK_RATES_PER_MTOK);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd <worktree> && pnpm --filter @megasaver/stats exec vitest run test/benchmark-cost.test.ts`
Expected: FAIL — `Cannot find module '../src/benchmark-cost.js'`

- [ ] **Step 3: Write the rates JSON**

```json
{
  "input": 5,
  "cacheCreation": 10,
  "cacheRead": 0.5,
  "output": 25
}
```

Save as `scripts/benchmark-rates.json`. These are the standard-tier claude-opus-4-8 rates verified against 11 real `result.json` files on 2026-07-14 (fast-mode-served requests bill 2x on every class; normalization deliberately prices everything at 1x).

- [ ] **Step 4: Write the implementation**

```ts
// packages/stats/src/benchmark-cost.ts

// Benchmark cost normalization. `total_cost_usd` from the Claude CLI mixes
// 1x- and 2x-billed (fast-mode) requests, so two runs of identical work can
// differ ~1.45x — larger than any effect a benchmark is trying to measure.
// Pricing the token breakdown at fixed standard rates removes that artifact:
// identical tokens always cost the same. Rates mirror scripts/benchmark-rates.json
// (a test asserts they stay in sync); that JSON is what the bash/python harness
// reads, so both consumers share one source.
export const BENCHMARK_RATES_PER_MTOK = {
  input: 5,
  cacheCreation: 10,
  cacheRead: 0.5,
  output: 25,
} as const;

export type BenchmarkUsage = {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
};

const PER_TOKEN = 1 / 1_000_000;

export function normalizedCostUsd(usage: BenchmarkUsage): number {
  const r = BENCHMARK_RATES_PER_MTOK;
  return (
    ((usage.input_tokens ?? 0) * r.input +
      (usage.cache_creation_input_tokens ?? 0) * r.cacheCreation +
      (usage.cache_read_input_tokens ?? 0) * r.cacheRead +
      (usage.output_tokens ?? 0) * r.output) *
    PER_TOKEN
  );
}
```

Append to `packages/stats/src/index.ts`:

```ts
export {
  BENCHMARK_RATES_PER_MTOK,
  normalizedCostUsd,
  type BenchmarkUsage,
} from "./benchmark-cost.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @megasaver/stats exec vitest run test/benchmark-cost.test.ts`
Expected: 5 passed. Then `pnpm --filter @megasaver/stats typecheck` clean and `pnpm biome check --write packages/stats/src/benchmark-cost.ts packages/stats/test/benchmark-cost.test.ts scripts/benchmark-rates.json`.

- [ ] **Step 6: Commit**

```bash
git add scripts/benchmark-rates.json packages/stats/src/benchmark-cost.ts packages/stats/src/index.ts packages/stats/test/benchmark-cost.test.ts
git commit -m "feat(stats): token-derived benchmark cost normalization"
```

---

### Task 2: Gate the existing end-to-end harness on normalized cost

**Files:**
- Modify: `scripts/run-megasaver-claude-limit-test.sh` (summary writer ~line 290-300; METRICS list ~line 341; footer ~line 399)

- [ ] **Step 1: Read the script's two python blocks**

Read `scripts/run-megasaver-claude-limit-test.sh`. Locate (a) the per-task summary writer that builds `summary` from `result.json` (it currently records `"total_cost_usd": r.get("total_cost_usd", 0.0)`), and (b) the report block whose `METRICS` list drives the table.

- [ ] **Step 2: Add normalized cost to the summary writer**

In the summary-writing python block, after the existing `summary.update({...})`, add (adjust variable names to the block's actuals — `u` is the usage dict, `summary` the output dict):

```python
    import json as _json, pathlib as _pathlib
    _rates = _json.loads(
        (_pathlib.Path(__file__).parent / "benchmark-rates.json").read_text()
    ) if False else _json.loads(open("scripts/benchmark-rates.json").read_text())
    summary["normalized_cost_usd"] = (
        u.get("input_tokens", 0) * _rates["input"]
        + u.get("cache_creation_input_tokens", 0) * _rates["cacheCreation"]
        + u.get("cache_read_input_tokens", 0) * _rates["cacheRead"]
        + u.get("output_tokens", 0) * _rates["output"]
    ) / 1_000_000
```

NOTE: the script `cd`s into `$REPO` before running tasks, so a relative `scripts/benchmark-rates.json` will not resolve. Pass the repo root in explicitly: the script already knows it — capture `RATES_JSON="$(cd "$(dirname "$0")" && pwd)/benchmark-rates.json"` near the top (beside the other path constants) and pass it as an argv to the python block, reading it with `open(sys.argv[N])`. Wire it that way rather than the relative-path form above.

- [ ] **Step 3: Gate the report on normalized cost**

In the report block, change `METRICS` so `normalized_cost_usd` is the gating metric and the raw stays visible:

```python
METRICS = [
    'billable_input_tokens',
    'cache_read_input_tokens',
    'cache_creation_input_tokens',
    'output_tokens',
    'normalized_cost_usd',
    'total_cost_usd',
    'wall_seconds',
]
```

and update the aggregate footer text so it states which metric is authoritative:

```python
print('Gate metric: normalized_cost_usd (token breakdown priced at fixed standard')
print('rates from scripts/benchmark-rates.json). Raw total_cost_usd is shown for')
print('transparency only — it mixes 1x and 2x (fast-mode) billed requests, so it')
print('is NOT comparable across runs.')
```

- [ ] **Step 4: Verify against saved real data (no API spend)**

The Stage A runs are saved at `/tmp/stagea-run1-results` and `/tmp/stagea-run2-results`. Confirm normalization removes the artifact:

```bash
cd <worktree> && python3 -c "
import json, pathlib
rates = json.load(open('scripts/benchmark-rates.json'))
def norm(u):
    return (u.get('input_tokens',0)*rates['input'] + u.get('cache_creation_input_tokens',0)*rates['cacheCreation'] + u.get('cache_read_input_tokens',0)*rates['cacheRead'] + u.get('output_tokens',0)*rates['output'])/1e6
for run in ('stagea-run1-results','stagea-run2-results'):
    p = pathlib.Path('/tmp')/run/'task_1_megasaver'/'result.json'
    if not p.exists(): print(run, 'MISSING — skip'); continue
    d = json.load(open(p))
    print(f\"{run}: raw \${d['total_cost_usd']:.4f}  normalized \${norm(d['usage']):.4f}\")
"
```

Expected: the two runs' RAW task_1 costs differ ~1.45x ($0.5787 vs $0.3972) while their NORMALIZED costs land within a few percent of each other — that gap closing is the whole point of L0. If the saved dirs are gone, note it and rely on the unit test instead.

- [ ] **Step 5: Commit**

```bash
git add scripts/run-megasaver-claude-limit-test.sh
git commit -m "chore(scripts): gate the end-to-end benchmark on normalized cost"
```

---

### Task 3: `@megasaver/bench-replay` package skeleton + types

**Files:**
- Create: `packages/bench-replay/package.json`, `tsconfig.json`, `tsup.config.ts`, `src/types.ts`, `src/index.ts`
- Test: `packages/bench-replay/test/types.test.ts`

- [ ] **Step 1: Copy an existing private package's scaffolding**

Read `packages/stats/package.json`, `packages/stats/tsconfig.json`, `packages/stats/tsup.config.ts` and mirror them. The new manifest must be private and depend on `@megasaver/stats`:

```json
{
  "name": "@megasaver/bench-replay",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "typecheck": "tsc -b --noEmit && tsc -p tsconfig.test.json --noEmit"
  },
  "dependencies": { "@megasaver/stats": "workspace:*", "zod": "^3.23.8" }
}
```

Match the exact `zod` version, `devDependencies`, and `tsconfig`/`tsup` contents used by `packages/stats` — copy them rather than inventing. Add a `tsconfig.test.json` mirroring stats' if stats has one.

- [ ] **Step 2: Write the failing test**

```ts
// packages/bench-replay/test/types.test.ts
import { describe, expect, it } from "vitest";
import { recordedRequestSchema } from "../src/types.js";

describe("recordedRequestSchema", () => {
  it("accepts a minimal recorded /v1/messages body", () => {
    const parsed = recordedRequestSchema.safeParse({
      model: "claude-opus-4-8",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts tool_result blocks inside message content", () => {
    const parsed = recordedRequestSchema.safeParse({
      model: "claude-opus-4-8",
      messages: [
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", content: "big output" }],
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a body with no messages array", () => {
    expect(recordedRequestSchema.safeParse({ model: "x" }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run, verify FAIL** (module not found)

Run: `pnpm --filter @megasaver/bench-replay exec vitest run test/types.test.ts`

- [ ] **Step 4: Implement types**

```ts
// packages/bench-replay/src/types.ts
import { z } from "zod";

// A recorded /v1/messages request body. Deliberately permissive: the recorder
// stores bodies VERBATIM and the replayer must round-trip unknown fields
// untouched, so only the parts we rewrite are described here.
export const recordedRequestSchema = z
  .object({
    model: z.string(),
    messages: z.array(z.unknown()),
  })
  .passthrough();

export type RecordedRequest = z.infer<typeof recordedRequestSchema>;

export type Arm = "baseline" | "megasaver";

export type ArmUsage = {
  arm: Arm;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  normalizedCostUsd: number;
};

export type ReplayVerdict = {
  task: string;
  baseline: ArmUsage;
  megasaver: ArmUsage;
  // baseline ÷ megasaver on normalized cost; >1 means megasaver is cheaper.
  costRatio: number;
};
```

```ts
// packages/bench-replay/src/index.ts
export { recordedRequestSchema, type Arm, type ArmUsage, type RecordedRequest, type ReplayVerdict } from "./types.js";
```

- [ ] **Step 5: Run, verify GREEN** (3 passed), plus `pnpm --filter @megasaver/bench-replay typecheck`.

- [ ] **Step 6: Commit**

```bash
git add packages/bench-replay pnpm-lock.yaml
git commit -m "feat(bench-replay): package skeleton and recorded-request types"
```

---

### Task 4: Capture proxy (record)

**Files:**
- Create: `packages/bench-replay/src/capture-proxy.ts`
- Modify: `packages/bench-replay/src/index.ts`
- Test: `packages/bench-replay/test/capture-proxy.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/bench-replay/test/capture-proxy.test.ts
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startCaptureProxy } from "../src/capture-proxy.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "bench-capture-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("startCaptureProxy", () => {
  it("writes each /v1/messages body verbatim, in order, and forwards the upstream response", async () => {
    // Fake upstream: echoes a fixed body so the test needs no network.
    const upstream = await startFakeUpstream('{"ok":true}');
    const proxy = await startCaptureProxy({ port: 0, upstream: upstream.url, outDir: dir });
    try {
      const bodies = [{ model: "m", messages: [{ role: "user", content: "one" }] },
                      { model: "m", messages: [{ role: "user", content: "two" }] }];
      for (const b of bodies) {
        const res = await fetch(`${proxy.url}/v1/messages`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(b),
        });
        expect(await res.text()).toBe('{"ok":true}');
      }
      const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
      expect(files).toEqual(["req-001.json", "req-002.json"]);
      expect(JSON.parse(readFileSync(join(dir, "req-001.json"), "utf8"))).toEqual(bodies[0]);
      expect(JSON.parse(readFileSync(join(dir, "req-002.json"), "utf8"))).toEqual(bodies[1]);
    } finally {
      await proxy.stop();
      await upstream.stop();
    }
  });

  it("ignores non-/v1/messages paths (no recording, still forwards)", async () => {
    const upstream = await startFakeUpstream('{"pong":1}');
    const proxy = await startCaptureProxy({ port: 0, upstream: upstream.url, outDir: dir });
    try {
      await fetch(`${proxy.url}/v1/models`);
      expect(readdirSync(dir).filter((f) => f.endsWith(".json"))).toEqual([]);
    } finally {
      await proxy.stop();
      await upstream.stop();
    }
  });
});

// Minimal in-process upstream so these tests never touch the network.
async function startFakeUpstream(body: string) {
  const { createServer } = await import("node:http");
  const server = createServer((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(body); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;
  return { url: `http://127.0.0.1:${port}`, stop: () => new Promise<void>((r) => server.close(() => r())) };
}
```

- [ ] **Step 2: Run, verify FAIL** (module not found)

- [ ] **Step 3: Implement**

```ts
// packages/bench-replay/src/capture-proxy.ts
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Records every /v1/messages request body verbatim so a task's conversation can
// later be replayed identically through both arms. Deliberately dumb: it does
// not parse, validate, or rewrite anything on the way through — a recording
// that differs from what the client actually sent would poison every downstream
// measurement.
export type CaptureProxy = { url: string; stop: () => Promise<void>; count: () => number };

const HOP_BY_HOP = new Set([
  "host", "connection", "content-length", "transfer-encoding", "keep-alive", "proxy-connection",
]);

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

export async function startCaptureProxy(input: {
  port: number;
  upstream: string;
  outDir: string;
}): Promise<CaptureProxy> {
  mkdirSync(input.outDir, { recursive: true });
  let seq = 0;

  const server: Server = createServer((req, res) => {
    void (async () => {
      const body = await readBody(req);
      const url = req.url ?? "/";
      if (url.startsWith("/v1/messages") && body.length > 0) {
        seq += 1;
        writeFileSync(join(input.outDir, `req-${String(seq).padStart(3, "0")}.json`), body);
      }
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined || HOP_BY_HOP.has(k.toLowerCase())) continue;
        headers[k] = Array.isArray(v) ? v.join(", ") : v;
      }
      const upstreamRes = await fetch(input.upstream + url, {
        method: req.method ?? "GET",
        headers,
        ...(body.length > 0 ? { body } : {}),
        redirect: "manual",
      });
      const outHeaders: Record<string, string> = {};
      upstreamRes.headers.forEach((v, k) => {
        if (!["content-encoding", "content-length", "transfer-encoding", "connection"].includes(k)) {
          outHeaders[k] = v;
        }
      });
      res.writeHead(upstreamRes.status, outHeaders);
      res.end(Buffer.from(await upstreamRes.arrayBuffer()));
    })();
  });

  await new Promise<void>((resolve) => server.listen(input.port, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : input.port;

  return {
    url: `http://127.0.0.1:${port}`,
    count: () => seq,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
```

Append to `src/index.ts`: `export { startCaptureProxy, type CaptureProxy } from "./capture-proxy.js";`

- [ ] **Step 4: Run, verify GREEN** (2 passed) + typecheck + biome.

- [ ] **Step 5: Commit**

```bash
git add packages/bench-replay/src/capture-proxy.ts packages/bench-replay/src/index.ts packages/bench-replay/test/capture-proxy.test.ts
git commit -m "feat(bench-replay): capture proxy records request bodies verbatim"
```

---

### Task 5: Per-arm `tool_result` transform

**Files:**
- Create: `packages/bench-replay/src/transform.ts`
- Modify: `packages/bench-replay/src/index.ts`
- Test: `packages/bench-replay/test/transform.test.ts`

The megasaver arm must exercise the REAL shipped saver, not a reimplementation. Claude Code invokes it by spawning the hook binary with a PostToolUse payload on stdin and reading a JSON decision on stdout:
`{"hookSpecificOutput":{"hookEventName":"PostToolUse","updatedToolOutput":<rebuilt tool_response>}}`.
A passthrough decision emits no `updatedToolOutput`. The transform therefore takes an injected `applySaver` function so tests need no subprocess.

- [ ] **Step 1: Write the failing test**

```ts
// packages/bench-replay/test/transform.test.ts
import { describe, expect, it } from "vitest";
import { transformRequest } from "../src/transform.js";

const body = {
  model: "claude-opus-4-8",
  system: [{ type: "text", text: "sys" }],
  messages: [
    { role: "user", content: "do the thing" },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "t1", content: "RAW OUTPUT" },
        { type: "text", text: "keep me" },
      ],
    },
  ],
};

describe("transformRequest", () => {
  it("baseline returns the body unchanged (deep equal, new object)", () => {
    const out = transformRequest(body, "baseline", () => "IGNORED");
    expect(out).toEqual(body);
    expect(out).not.toBe(body);
  });

  it("megasaver rewrites tool_result content and leaves everything else intact", () => {
    const out = transformRequest(body, "megasaver", (raw) => `COMPRESSED(${raw.length})`);
    const content = (out.messages[2] as { content: { type: string; content?: string; text?: string }[] }).content;
    expect(content[0]).toEqual({ type: "tool_result", tool_use_id: "t1", content: "COMPRESSED(10)" });
    expect(content[1]).toEqual({ type: "text", text: "keep me" });
    expect(out.model).toBe("claude-opus-4-8");
    expect(out.system).toEqual(body.system);
    expect((out.messages[0] as { content: string }).content).toBe("do the thing");
  });

  it("a passthrough saver decision (null) leaves the tool_result untouched", () => {
    const out = transformRequest(body, "megasaver", () => null);
    expect(out).toEqual(body);
  });

  it("does not mutate the input body", () => {
    const snapshot = JSON.parse(JSON.stringify(body));
    transformRequest(body, "megasaver", () => "X");
    expect(body).toEqual(snapshot);
  });

  it("leaves string-content messages alone (nothing to rewrite)", () => {
    const plain = { model: "m", messages: [{ role: "user", content: "just text" }] };
    expect(transformRequest(plain, "megasaver", () => "X")).toEqual(plain);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement**

```ts
// packages/bench-replay/src/transform.ts
import type { Arm, RecordedRequest } from "./types.js";

// Returns the replacement text for a tool_result's content, or null to leave it
// as recorded (the saver's passthrough decision). Injected so unit tests need no
// subprocess; production wiring spawns the real `mega hooks saver` binary.
export type ApplySaver = (rawToolResult: string) => string | null;

function isToolResult(block: unknown): block is { type: "tool_result"; content: string } {
  return (
    typeof block === "object" &&
    block !== null &&
    (block as { type?: unknown }).type === "tool_result" &&
    typeof (block as { content?: unknown }).content === "string"
  );
}

// Produces the body to send for one arm. Baseline is a deep copy of the
// recording; megasaver is the same conversation with each tool_result's text
// replaced by the saver's decision. Everything else — model, system, tools,
// message order, roles, non-tool_result blocks — round-trips untouched, because
// the two arms must differ ONLY by the saver's transform for the comparison to
// mean anything.
export function transformRequest(
  body: RecordedRequest,
  arm: Arm,
  applySaver: ApplySaver,
): RecordedRequest {
  const copy = structuredClone(body) as RecordedRequest;
  if (arm === "baseline") return copy;

  for (const message of copy.messages) {
    if (typeof message !== "object" || message === null) continue;
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!isToolResult(block)) continue;
      const replacement = applySaver(block.content);
      if (replacement !== null) block.content = replacement;
    }
  }
  return copy;
}
```

Append to `src/index.ts`: `export { transformRequest, type ApplySaver } from "./transform.js";`

- [ ] **Step 4: Run, verify GREEN** (5 passed) + typecheck + biome.

- [ ] **Step 5: Commit**

```bash
git add packages/bench-replay/src/transform.ts packages/bench-replay/src/index.ts packages/bench-replay/test/transform.test.ts
git commit -m "feat(bench-replay): per-arm tool_result transform"
```

---

### Task 6: Real-saver `ApplySaver` (spawns the shipped hook)

**Files:**
- Create: `packages/bench-replay/src/saver-subprocess.ts`
- Modify: `packages/bench-replay/src/index.ts`
- Test: `packages/bench-replay/test/saver-subprocess.test.ts`

- [ ] **Step 1: Write the failing test** (injects a fake spawn — no real binary needed)

```ts
// packages/bench-replay/test/saver-subprocess.test.ts
import { describe, expect, it } from "vitest";
import { makeSpawnedSaver } from "../src/saver-subprocess.js";

describe("makeSpawnedSaver", () => {
  it("returns the updatedToolOutput text when the hook compresses", () => {
    const apply = makeSpawnedSaver({
      megaBin: "mega",
      cwd: "/repo",
      sessionId: "s1",
      run: () =>
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PostToolUse",
            updatedToolOutput: { stdout: "SHORT", stderr: "" },
          },
        }),
    });
    expect(apply("LONG RAW")).toBe("SHORT");
  });

  it("returns null on a passthrough decision (no updatedToolOutput)", () => {
    const apply = makeSpawnedSaver({
      megaBin: "mega", cwd: "/repo", sessionId: "s1", run: () => "",
    });
    expect(apply("LONG RAW")).toBeNull();
  });

  it("returns null when the hook emits unparseable output (fail-open)", () => {
    const apply = makeSpawnedSaver({
      megaBin: "mega", cwd: "/repo", sessionId: "s1", run: () => "{not json",
    });
    expect(apply("LONG RAW")).toBeNull();
  });

  it("feeds the hook a PostToolUse payload carrying the raw output", () => {
    let seen = "";
    const apply = makeSpawnedSaver({
      megaBin: "mega", cwd: "/repo", sessionId: "s1",
      run: (payload) => { seen = payload; return ""; },
    });
    apply("RAW HERE");
    const parsed = JSON.parse(seen);
    expect(parsed.session_id).toBe("s1");
    expect(parsed.cwd).toBe("/repo");
    expect(parsed.tool_name).toBe("Bash");
    expect(parsed.tool_response.stdout).toBe("RAW HERE");
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement**

```ts
// packages/bench-replay/src/saver-subprocess.ts
import { execFileSync } from "node:child_process";
import type { ApplySaver } from "./transform.js";

// Runs the REAL shipped saver the way Claude Code does — spawn the hook binary,
// PostToolUse payload on stdin, decision JSON on stdout. Measuring a
// reimplementation would prove nothing about the product.
export type RunHook = (payloadJson: string) => string;

const defaultRun =
  (megaBin: string): RunHook =>
  (payloadJson) =>
    execFileSync(megaBin, ["hooks", "saver"], { input: payloadJson, encoding: "utf8" });

export function makeSpawnedSaver(input: {
  megaBin: string;
  cwd: string;
  sessionId: string;
  run?: RunHook;
}): ApplySaver {
  const run = input.run ?? defaultRun(input.megaBin);
  return (rawToolResult) => {
    const payload = JSON.stringify({
      session_id: input.sessionId,
      cwd: input.cwd,
      tool_name: "Bash",
      tool_input: { command: "replay" },
      tool_response: { stdout: rawToolResult, stderr: "" },
    });
    let out: string;
    try {
      out = run(payload);
    } catch {
      return null; // hook failed → treat as passthrough, same as production
    }
    try {
      const parsed = JSON.parse(out) as {
        hookSpecificOutput?: { updatedToolOutput?: { stdout?: unknown } };
      };
      const stdout = parsed.hookSpecificOutput?.updatedToolOutput?.stdout;
      return typeof stdout === "string" ? stdout : null;
    } catch {
      return null;
    }
  };
}
```

Append to `src/index.ts`: `export { makeSpawnedSaver, type RunHook } from "./saver-subprocess.js";`

- [ ] **Step 4: Run, verify GREEN** (4 passed) + typecheck + biome.

- [ ] **Step 5: Commit**

```bash
git add packages/bench-replay/src/saver-subprocess.ts packages/bench-replay/src/index.ts packages/bench-replay/test/saver-subprocess.test.ts
git commit -m "feat(bench-replay): apply the real saver hook via subprocess"
```

---

### Task 7: Replay sender + verdict report + calibration guard

**Files:**
- Create: `packages/bench-replay/src/replay.ts`, `packages/bench-replay/src/report.ts`
- Modify: `packages/bench-replay/src/index.ts`
- Test: `packages/bench-replay/test/replay.test.ts`, `packages/bench-replay/test/report.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/bench-replay/test/replay.test.ts
import { describe, expect, it } from "vitest";
import { replayArm } from "../src/replay.js";

const recorded = [
  { model: "m", messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "RAW" }] }] },
  { model: "m", messages: [{ role: "user", content: "second" }] },
];

describe("replayArm", () => {
  it("sends every recorded request in order and sums usage", async () => {
    const sent: unknown[] = [];
    const usage = await replayArm({
      arm: "baseline",
      requests: recorded,
      applySaver: () => null,
      send: async (body) => {
        sent.push(body);
        return { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 1 };
      },
    });
    expect(sent).toHaveLength(2);
    expect(usage.inputTokens).toBe(20);
    expect(usage.cacheCreationTokens).toBe(200);
    expect(usage.cacheReadTokens).toBe(2000);
    expect(usage.outputTokens).toBe(2);
    // 20*5 + 200*10 + 2000*0.5 + 2*25 = 100+2000+1000+50 = 3150 per 1e6
    expect(usage.normalizedCostUsd).toBeCloseTo(0.00315, 8);
  });

  it("megasaver arm sends transformed tool_result content", async () => {
    const sent: string[] = [];
    await replayArm({
      arm: "megasaver",
      requests: recorded,
      applySaver: () => "SHORT",
      send: async (body) => {
        sent.push(JSON.stringify(body));
        return { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 };
      },
    });
    expect(sent[0]).toContain("SHORT");
    expect(sent[0]).not.toContain("RAW");
  });
});
```

```ts
// packages/bench-replay/test/report.test.ts
import { describe, expect, it } from "vitest";
import { buildVerdict, calibrationOk } from "../src/report.js";

const arm = (cost: number) => ({
  arm: "baseline" as const, inputTokens: 0, cacheCreationTokens: 0,
  cacheReadTokens: 0, outputTokens: 0, normalizedCostUsd: cost,
});

describe("buildVerdict", () => {
  it("ratio is baseline ÷ megasaver (>1 = megasaver cheaper)", () => {
    const v = buildVerdict("task_1", arm(1.0), { ...arm(0.8), arm: "megasaver" });
    expect(v.costRatio).toBeCloseTo(1.25, 6);
  });

  it("a zero-cost megasaver arm yields Infinity rather than NaN", () => {
    const v = buildVerdict("task_1", arm(1.0), { ...arm(0), arm: "megasaver" });
    expect(v.costRatio).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("calibrationOk", () => {
  it("passes when the replayed baseline is within tolerance of the real one", () => {
    expect(calibrationOk({ replayedBaselineUsd: 0.50, realBaselineUsd: 0.52, tolerance: 0.1 })).toBe(true);
  });

  it("fails when the replayed baseline drifts beyond tolerance", () => {
    expect(calibrationOk({ replayedBaselineUsd: 0.50, realBaselineUsd: 0.80, tolerance: 0.1 })).toBe(false);
  });

  it("fails (not passes) when the real baseline is zero — cannot calibrate against nothing", () => {
    expect(calibrationOk({ replayedBaselineUsd: 0.5, realBaselineUsd: 0, tolerance: 0.1 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement**

```ts
// packages/bench-replay/src/replay.ts
import { normalizedCostUsd } from "@megasaver/stats";
import { transformRequest } from "./transform.js";
import type { ApplySaver } from "./transform.js";
import type { Arm, ArmUsage, RecordedRequest } from "./types.js";

// The API response fields we consume. Injected `send` keeps unit tests offline;
// production passes a real fetch against /v1/messages.
export type SendResult = {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
};
export type Send = (body: RecordedRequest) => Promise<SendResult>;

export async function replayArm(input: {
  arm: Arm;
  requests: readonly RecordedRequest[];
  applySaver: ApplySaver;
  send: Send;
}): Promise<ArmUsage> {
  const total = {
    input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 0,
  };
  // Sequential on purpose: the API's prompt cache is order-dependent, so
  // parallelising would measure a different (and meaningless) cache pattern.
  for (const request of input.requests) {
    const body = transformRequest(request, input.arm, input.applySaver);
    const usage = await input.send(body);
    total.input_tokens += usage.input_tokens ?? 0;
    total.cache_creation_input_tokens += usage.cache_creation_input_tokens ?? 0;
    total.cache_read_input_tokens += usage.cache_read_input_tokens ?? 0;
    total.output_tokens += usage.output_tokens ?? 0;
  }
  return {
    arm: input.arm,
    inputTokens: total.input_tokens,
    cacheCreationTokens: total.cache_creation_input_tokens,
    cacheReadTokens: total.cache_read_input_tokens,
    outputTokens: total.output_tokens,
    normalizedCostUsd: normalizedCostUsd(total),
  };
}
```

```ts
// packages/bench-replay/src/report.ts
import type { ArmUsage, ReplayVerdict } from "./types.js";

export function buildVerdict(
  task: string,
  baseline: ArmUsage,
  megasaver: ArmUsage,
): ReplayVerdict {
  return {
    task,
    baseline,
    megasaver,
    costRatio:
      megasaver.normalizedCostUsd === 0
        ? Number.POSITIVE_INFINITY
        : baseline.normalizedCostUsd / megasaver.normalizedCostUsd,
  };
}

// The harness must never report a green gate it cannot vouch for. If the
// replayed baseline drifts from the real end-to-end baseline beyond tolerance,
// the recording or the cache model has gone stale and the verdict is void —
// a silently-drifting measurement tool is worse than no tool.
export function calibrationOk(input: {
  replayedBaselineUsd: number;
  realBaselineUsd: number;
  tolerance: number;
}): boolean {
  if (!(input.realBaselineUsd > 0)) return false;
  const drift = Math.abs(input.replayedBaselineUsd - input.realBaselineUsd) / input.realBaselineUsd;
  return drift <= input.tolerance;
}
```

Append to `src/index.ts`:

```ts
export { replayArm, type Send, type SendResult } from "./replay.js";
export { buildVerdict, calibrationOk } from "./report.js";
```

- [ ] **Step 4: Run, verify GREEN**

Run: `pnpm --filter @megasaver/bench-replay exec vitest run` — expect all pass (types 3 + capture 2 + transform 5 + saver 4 + replay 2 + report 5 = 21). Then typecheck + biome.

- [ ] **Step 5: Commit**

```bash
git add packages/bench-replay/src packages/bench-replay/test
git commit -m "feat(bench-replay): replay sender, verdict, and calibration guard"
```

---

### Task 8: Changeset + full verify

- [ ] **Step 1: Write `.changeset/bench-replay.md`**

```markdown
---
"@megasaver/stats": minor
---

Add `normalizedCostUsd`: benchmark cost derived from the token breakdown at
fixed standard rates, so identical token counts always price identically.
The Claude CLI's `total_cost_usd` mixes 1x- and 2x-billed (fast-mode)
requests and swung ~1.45x across runs of identical work, which exceeded the
effects the benchmark existed to measure. Rates live in
`scripts/benchmark-rates.json`, shared with the bash/python harness.
```

(`@megasaver/bench-replay` is private and unpublished, so it takes no changeset entry.)

- [ ] **Step 2: Run full verify**

Run: `cd <worktree> && pnpm build && pnpm --filter @megasaver/gui build && pnpm verify`
Expected: all turbo tasks succeed. Fix anything red (`pnpm lint:fix` for format).

- [ ] **Step 3: Commit**

```bash
git add .changeset/bench-replay.md
git commit -m "chore: changeset for benchmark cost normalization"
```

---

### Task 9: Wire the runner and re-gate Stage A

This is the payoff task: use the harness on the parked Stage A branch.

- [ ] **Step 1: Add a runner script**

Create `scripts/bench-replay.mjs` that: (1) starts `startCaptureProxy` pointed at `https://api.anthropic.com`, (2) prints the `ANTHROPIC_BASE_URL` the operator should run one `claude -p` task under (recording phase), (3) on a second invocation, loads `req-*.json` from the recording dir and calls `replayArm` twice — baseline with `() => null`, megasaver with `makeSpawnedSaver({megaBin, cwd, sessionId, ...})` — sending real requests, (4) prints `buildVerdict` per task plus the pooled ratio and the `calibrationOk` result. Keep it a thin CLI over the tested library: no measurement logic in the script.

- [ ] **Step 2: Record all 4 benchmark tasks**

Run each of the 4 task prompts from `scripts/run-megasaver-claude-limit-test.sh` once through the capture proxy against the throwaway repo. Store recordings under `/tmp/bench-recordings/task_N/`.

- [ ] **Step 3: Replay both arms per task, with the Stage A build installed globally**

Build and install the Stage A branch bundle globally (so `mega hooks saver` is the Stage A saver), then replay. Expected spend ~$2-5 total.

- [ ] **Step 4: Check calibration, then read the gate**

Calibration reference: the saved real baselines in `/tmp/stagea-run1-results/task_N_baseline/result.json` (normalized). If `calibrationOk` fails at tolerance 0.25, STOP — report the harness as uncalibrated and do not issue a verdict.

- [ ] **Step 5: Record the result honestly**

Append a "Stage A re-gate (L1 replay)" section to `wiki/syntheses/saver-cache-churn.md` with the per-task and pooled ratios and the calibration figure — **including if Stage A fails again**. Add a `wiki/log.md` entry. Commit.

- [ ] **Step 6: Reviews and merge decision**

`code-reviewer`-equivalent + `critic` on `git diff main`, then `superpowers:finishing-a-development-branch`.

---

## Self-review notes

- **Spec coverage:** L0 rates+function (T1) and its wiring into the existing harness (T2); L1 record (T4), transform (T5), real-saver application (T6), replay+verdict+calibration guard (T7); gate semantics — normalized metric, breakdown reporting, calibration void — in T2/T7/T9; testing requirements in every task; DoD in T8/T9. L2/L3 correctly absent (deferred by the spec).
- **Determinism assertion:** the spec asks the harness to prove repeat stability. T7's `replayArm` is deterministic given a fixed recording, and T5 asserts the transform does not mutate input; the ±1% repeat check is exercised operationally in T9 (replay twice) rather than as a unit test, since it needs the real API.
- **Type consistency:** `ApplySaver` (T5) returns `string | null` and is what `makeSpawnedSaver` (T6) produces and `replayArm` (T7) consumes. `ArmUsage`/`ReplayVerdict`/`RecordedRequest`/`Arm` are defined once in T3 and used unchanged. `normalizedCostUsd` (T1) is called only in T7.
- **Known adaptation points, each with explicit instructions rather than a placeholder:** T2's rates-path wiring (argv, because the script `cd`s away from the repo root), T3's scaffolding (copy `packages/stats`' config verbatim), T9's runner shape.
