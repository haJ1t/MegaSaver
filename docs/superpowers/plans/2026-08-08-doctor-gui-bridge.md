# Doctor → GUI Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relocate `runSaverChecks`' orchestration from `apps/cli` to
`@megasaver/context-gate` (a package both `apps/cli` and `apps/gui`
already depend on), expose it as `GET /api/doctor` on the GUI bridge,
and add a "Saver health" panel so a GUI-only user gets the same
depth of diagnostic visibility a CLI user already has via `mega
doctor` (spec: `docs/superpowers/specs/2026-08-08-doctor-gui-bridge-design.md`).

**Architecture:** `runSaverChecks`/`refreshNetEffectVerdicts` move
into a new `packages/context-gate/src/saver-doctor.ts`, with
`hookCommandMatches` (previously a direct import from
`@megasaver/connector-claude-code`, which WOULD create a dependency
cycle if imported by `context-gate`) converted to a required injected
parameter. `apps/cli/src/commands/doctor-saver.ts` becomes a thin
re-export supplying the real `spawn`/`cliVersion`/`hookCommandMatches`.
A new GUI bridge route supplies its own `spawn`/`hookCommandMatches`
(both already-available implementations, no new packages) and omits
`cliVersion`.

**Tech Stack:** TypeScript strict ESM, Vitest, existing
`RouteContext`/citty conventions, `node:child_process` (`spawnSync`,
duplicated per-caller by design — spec Component 4).

## Global Constraints

- `context-gate` must NEVER import `@megasaver/connector-claude-code` — this would create the exact cycle spec Locked Decision 1 identifies (`context-gate → connector-claude-code → core → context-gate`). `hookCommandMatches` is ALWAYS an injected required parameter in the relocated module, never a default import.
- `mega doctor`'s CLI output stays byte-for-byte identical before and after this plan — every task that touches `apps/cli/src/commands/doctor-saver.ts` or `doctor.ts` must re-run the existing CLI test suite and confirm zero diffs (spec Non-Goals, Risk & process).
- `refreshNetEffectVerdicts`' existing best-effort `writeNetEffectRecord` side effect is preserved EXACTLY — no new persistence, no new write path (spec Non-Goals).
- `GET /api/doctor` (no query, or `selfTest=false`) must NEVER spawn a process — this is the opt-in boundary the whole GUI-safety argument rests on (spec Locked Decision 3); Task 3's test suite asserts this with a spy, not just documentation.
- The existing `apps/cli/test/doctor-saver.test.ts` calls `runSaverChecks({...})` at ~10+ call sites without an explicit `hookCommandMatches` — EVERY one of these must be updated once the field becomes required, or the test suite will fail to typecheck. This is not optional cleanup; it is a compile error if skipped.
- `checkNode`/`checkPlatform`/`checkCwd` are NOT part of this relocation and NOT part of the GUI panel (spec Non-Goals) — do not accidentally widen scope to the full `runChecks()` triad.

---

### Task 1: Relocate `runSaverChecks`/`refreshNetEffectVerdicts` to `@megasaver/context-gate`

**Files:**
- Create: `packages/context-gate/src/saver-doctor.ts`
- Modify: `packages/context-gate/src/index.ts` (export the new surface)
- Modify: `packages/context-gate/package.json` (add `@megasaver/daemon`, `@megasaver/proxy-control` dependencies)
- Modify: `apps/cli/src/commands/doctor-saver.ts` (rewrite to thin re-export + CLI-specific `defaultSpawn`/`runningCliVersion`/real `hookCommandMatches` wiring)
- Modify: `apps/cli/test/doctor-saver.test.ts` (move to `packages/context-gate/test/saver-doctor.test.ts`, OR keep in place importing from the new path — see Step 1's decision point)

**Interfaces:**

```ts
// packages/context-gate/src/saver-doctor.ts
export type Check = { key: string; value: string; pass: boolean; reason?: string };

export type DoctorSaverDeps = {
  settingsPath?: string;
  storeRoot?: string;
  spawn?: (cmd: string, stdinJson: string, timeoutMs: number) => { status: number | null; stdout?: string; error?: string };
  now?: () => number;
  cliVersion?: string;
  hookCommandMatches: (command: string, subcommand: string) => boolean; // REQUIRED, no default
  skipSelfTest?: boolean; // NEW, default false
};

export function refreshNetEffectVerdicts(storeRoot: string, nowIso: string): Check[];
export function runSaverChecks(deps: DoctorSaverDeps): Check[]; // deps no longer defaults to {} — hookCommandMatches makes it required
```

**Steps:**

- [ ] Read `apps/cli/src/commands/doctor-saver.ts` in full (already reviewed during investigation, re-read immediately before this task) and `apps/cli/test/doctor-saver.test.ts` in full — decide HERE whether the test file moves to `packages/context-gate/test/saver-doctor.test.ts` (co-located with the relocated source, this repo's own convention per every other package) or stays in `apps/cli/test` importing from `@megasaver/context-gate` (testing the re-export, not the implementation). PREFER moving the bulk of the test suite to `context-gate` (tests the real implementation where it lives) and leaving a SMALL new test in `apps/cli/test` that only asserts the re-export wires the CLI-specific deps correctly (spawn/cliVersion/hookCommandMatches) and that `mega doctor`'s full CLI output is unchanged — this split avoids one giant file duplicating coverage in two places.
- [ ] Add `"@megasaver/daemon": "workspace:*"` and `"@megasaver/proxy-control": "workspace:*"` to `packages/context-gate/package.json`'s `dependencies` (verified non-cyclic during spec-writing — re-verify by running `pnpm --filter @megasaver/context-gate install` and confirming no pnpm cycle warning).
- [ ] Create `packages/context-gate/src/saver-doctor.ts` by moving `doctor-saver.ts`'s ENTIRE body (imports, constants, every function) into it verbatim, with exactly these targeted edits:
  - Remove the `import { hookCommandMatches } from "@megasaver/connector-claude-code";` line.
  - Add `hookCommandMatches: (command: string, subcommand: string) => boolean;` as a REQUIRED field on `DoctorSaverDeps` (no `?`).
  - Every internal call site that used the imported `hookCommandMatches` now reads `deps.hookCommandMatches` (thread it through `registeredCommand`'s call signature — it currently doesn't take `deps`, so either add a `deps` parameter to `registeredCommand` or partially-apply `deps.hookCommandMatches` at the call site inside `runSaverChecks`; prefer partially-applying at the call site to keep `registeredCommand`'s signature otherwise unchanged).
  - Add `skipSelfTest?: boolean;` to `DoctorSaverDeps`; wrap the ENTIRE E22.4 self-test block (`doctor-saver.ts`'s `if (saverCmd !== null) { const beforeView = ...` block through its closing brace) in `if (deps.skipSelfTest !== true) { ... }`.
  - `runSaverChecks(deps: DoctorSaverDeps = {})`'s default `= {}` MUST be removed — a required field means the caller cannot omit the whole object either; change the signature to `runSaverChecks(deps: DoctorSaverDeps)`.
- [ ] Export `Check`, `DoctorSaverDeps`, `runSaverChecks`, `refreshNetEffectVerdicts` from `packages/context-gate/src/index.ts`.
- [ ] Rewrite `apps/cli/src/commands/doctor-saver.ts` to:

```ts
import { hookCommandMatches } from "@megasaver/connector-claude-code";
import {
  type Check,
  type DoctorSaverDeps as SharedDoctorSaverDeps,
  refreshNetEffectVerdicts,
  runSaverChecks as sharedRunSaverChecks,
} from "@megasaver/context-gate";
// ... existing defaultSpawn, runningCliVersion, SELF_TEST_TIMEOUT_MS
// (these CLI-specific pieces STAY here, per spec Locked Decision 2)

export type DoctorSaverDeps = Omit<SharedDoctorSaverDeps, "hookCommandMatches">;

export function runSaverChecks(deps: DoctorSaverDeps = {}): Check[] {
  return sharedRunSaverChecks({
    spawn: deps.spawn ?? defaultSpawn,
    cliVersion: deps.cliVersion ?? runningCliVersion(),
    hookCommandMatches,
    ...deps,
  });
}

export { refreshNetEffectVerdicts };
```

  (Confirm the exact merge order above doesn't let a spread `...deps` silently override the CLI's own `hookCommandMatches` — reorder so `hookCommandMatches` is NOT spreadable by the public `DoctorSaverDeps` type, which the `Omit<>` already guarantees at the type level; this is a belt-and-suspenders re-check, not a new requirement.)
- [ ] Confirm `doctor.ts`'s existing call site `runSaverChecks()` (no args) still compiles and behaves identically — it should, since every field it relied on being defaulted still defaults the same way inside the new wrapper.
- [ ] Move the bulk of `apps/cli/test/doctor-saver.test.ts` to `packages/context-gate/test/saver-doctor.test.ts`, updating every `runSaverChecks({...})` call site to include `hookCommandMatches: () => false` (or a real/fake matcher per what each test actually needs — check whether any EXISTING test relies on real hook-command matching behavior, in which case port a minimal fake that mimics `hookCommandMatches`'s real contract: exact-string-equality on the subcommand name after the binary, not a full reimplementation).
- [ ] Write a SMALL new `apps/cli/test/doctor-saver.test.ts` (replacing the moved one) asserting only: the re-exported `runSaverChecks` wires `defaultSpawn`/`runningCliVersion`/real `hookCommandMatches` correctly (one or two focused tests, not the full matrix — that lives in context-gate now).
- [ ] RED then GREEN: run both test files (`pnpm --filter @megasaver/context-gate exec vitest run test/saver-doctor.test.ts` and `pnpm --filter @megasaver/cli exec vitest run test/doctor-saver.test.ts`) — confirm the relocation compiles and every behavioral assertion still holds.
- [ ] Run `pnpm --filter @megasaver/cli exec vitest run test/commands/doctor.test.ts` (or wherever `mega doctor`'s own CLI-level test lives — find via `rg -l "doctorCommand\|runChecks()" apps/cli/test`) — this is the byte-for-byte regression gate (spec Testing table, row 3).
- [ ] Commit:

```bash
git add packages/context-gate/src/saver-doctor.ts packages/context-gate/src/index.ts packages/context-gate/package.json apps/cli/src/commands/doctor-saver.ts apps/cli/test/doctor-saver.test.ts packages/context-gate/test/saver-doctor.test.ts pnpm-lock.yaml
git commit -m "refactor(context-gate,cli): relocate runSaverChecks to context-gate, inject hookCommandMatches"
```

---

### Task 2: GUI bridge route — `GET /api/doctor`

**Files:**
- Create: `apps/gui/bridge/routes/doctor.ts`
- Modify: `apps/gui/bridge/handler.ts` (register the route + import)
- Create: `apps/gui/test/bridge/doctor-route.test.ts`

**Interfaces:**

```ts
// apps/gui/bridge/routes/doctor.ts
export async function handleGetDoctor(ctx: RouteContext): Promise<void>;
```

**Steps:**

- [ ] Read `apps/gui/bridge/proxy-control.ts` and `apps/gui/bridge/handler.ts`'s existing `resolveClaudeCodeSettingsPath` usage (both already confirmed to import `@megasaver/connector-claude-code` directly during investigation) — the new route reuses the SAME already-imported `hookCommandMatches` from that package (also exported from it, confirmed during investigation: `packages/connectors/claude-code/src/index.ts:40`).
- [ ] Write the failing test in `apps/gui/test/bridge/doctor-route.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { startTestBridge } from "./test-helpers.js"; // or the equivalent used by sibling *-route.test.ts files

describe("GET /api/doctor", () => {
  it("returns a Check[] array and never spawns without selfTest=true", async () => {
    const server = await startTestBridge({ /* seeded store as needed */ });
    const res = await fetch(`${server.baseUrl}/api/doctor`);
    expect(res.status).toBe(200);
    const checks = await res.json();
    expect(Array.isArray(checks)).toBe(true);
    expect(checks.some((c: { key: string }) => c.key === "saver-self-test")).toBe(false);
    await server.close();
  });

  it("selfTest=true includes the self-test check", async () => {
    const server = await startTestBridge({ /* seeded store with a registered saver hook, so the self-test has something to spawn against */ });
    const res = await fetch(`${server.baseUrl}/api/doctor?selfTest=true`);
    const checks = await res.json();
    expect(checks.some((c: { key: string }) => c.key === "saver-self-test")).toBe(true);
    await server.close();
  });
});
```

- [ ] Confirm the exact test-bridge-startup helper this GUI test directory already uses (check a sibling like `apps/gui/test/bridge/analytics-route.test.ts`'s own `startTestBridge`/`seedWorkspaceCwd` pattern investigated earlier) and port that exact pattern rather than inventing a new store-seeding approach.
- [ ] RED: run the new test file — expect FAIL (route not implemented).
- [ ] Implement `guiSpawn` and `handleGetDoctor` in `apps/gui/bridge/routes/doctor.ts`:

```ts
import { spawnSync } from "node:child_process";
import { hookCommandMatches, resolveClaudeCodeSettingsPath } from "@megasaver/connector-claude-code";
import { runSaverChecks, type Check } from "@megasaver/context-gate";
import type { RouteContext } from "../route-context.js";

// Structurally mirrors apps/cli/src/commands/doctor-saver.ts's defaultSpawn
// (same sh -c / win32-shell branching) — declared locally because the GUI
// bridge cannot import apps/cli (spec Component 4: one deliberate, justified
// small duplication).
function guiSpawn(
  cmd: string,
  stdinJson: string,
  timeoutMs: number,
): { status: number | null; stdout?: string; error?: string } {
  const r =
    process.platform === "win32"
      ? spawnSync(cmd, { shell: true, input: stdinJson, timeout: timeoutMs, encoding: "utf8" })
      : spawnSync("sh", ["-c", cmd], { input: stdinJson, timeout: timeoutMs, encoding: "utf8" });
  return {
    status: r.status,
    ...(typeof r.stdout === "string" ? { stdout: r.stdout } : {}),
    ...(r.error !== undefined ? { error: r.error.message } : {}),
  };
}

export async function handleGetDoctor(ctx: RouteContext): Promise<void> {
  const selfTest = ctx.query.get("selfTest") === "true";
  const checks: Check[] = runSaverChecks({
    storeRoot: ctx.storeRoot,
    settingsPath: ctx.claudeSettingsPath,
    spawn: guiSpawn,
    hookCommandMatches,
    skipSelfTest: !selfTest,
  });
  ctx.sendJson(ctx.res, 200, checks, ctx.origin);
}
```

- [ ] Confirm `ctx.claudeSettingsPath` is the correct field name on `RouteContext` (already confirmed present during investigation, `route-context.ts`'s existing `claudeSettingsPath` field) and that it resolves the same path `resolveClaudeCodeSettingsPath()` would — if `ctx` already carries the resolved path, prefer using `ctx.claudeSettingsPath` over calling `resolveClaudeCodeSettingsPath()` again (consistency with every other route's convention).
- [ ] Decide whether `checkSettingsPermissions`/`checkHookTelemetry` (spec Component 3's open question) get folded into this same route's response or deferred — for v1, PREFER folding them in (compose `[...runSaverChecks(...), checkSettingsPermissions(...), checkHookTelemetry(...)]` inside `handleGetDoctor`) so the GUI panel gets full parity with `mega doctor`'s CLI output in one response, matching spec Goal's explicit promise ("the same six check categories... in the same pass/warn/fail vocabulary"). These two functions are small and already exported from `apps/cli/src/commands/doctor.ts` — check whether importing them from `apps/cli` is possible (it is NOT, GUI cannot depend on CLI) — so either relocate these two alongside `runSaverChecks` in Task 1 (revisit Task 1 if this is discovered here) or re-derive them locally in the GUI bridge route file (both are short, pure-ish functions; a small justified duplication here is consistent with `guiSpawn`'s own precedent in this same task).
- [ ] Register the route in `apps/gui/bridge/handler.ts`: `if (path === "/api/doctor") { if (method !== "GET") return methodNotAllowed(res, method, origin); await handleGetDoctor(ctx); return; }` — placed near the other simple GET routes (check the file's existing ordering convention, likely alphabetical or grouped by feature area, and match it).
- [ ] GREEN: re-run — expect PASS.
- [ ] Commit:

```bash
git add apps/gui/bridge/routes/doctor.ts apps/gui/bridge/handler.ts apps/gui/test/bridge/doctor-route.test.ts
git commit -m "feat(gui): add GET /api/doctor bridging runSaverChecks"
```

---

### Task 3: GUI panel — `SaverDoctorPanel`

**Files:**
- Modify: `apps/gui/src/lib/claude-sessions-client.ts` (add `fetchDoctorReport`)
- Create: `apps/gui/src/components/saver-doctor-panel.tsx`
- Modify: `apps/gui/src/views/overview-page.tsx` (render the panel)
- Create: `apps/gui/test/components/saver-doctor-panel.test.tsx`

**Interfaces:**

```ts
// claude-sessions-client.ts
export type DoctorCheck = { key: string; value: string; pass: boolean; reason?: string };
export function fetchDoctorReport(selfTest?: boolean): Promise<DoctorCheck[]>;
```

**Steps:**

- [ ] Add `fetchDoctorReport` to `claude-sessions-client.ts`, following the file's existing `getJson<T>(path)` convention exactly (mirrors `fetchCacheStatus`'s one-liner shape):

```ts
export type DoctorCheck = { key: string; value: string; pass: boolean; reason?: string };
export function fetchDoctorReport(selfTest?: boolean): Promise<DoctorCheck[]> {
  return getJson<DoctorCheck[]>(selfTest ? "/api/doctor?selfTest=true" : "/api/doctor");
}
```

- [ ] Write the failing test in `apps/gui/test/components/saver-doctor-panel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { SaverDoctorPanel } from "../../src/components/saver-doctor-panel.js";
import * as client from "../../src/lib/claude-sessions-client.js";

describe("SaverDoctorPanel", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders pass/warn/fail badges from the fetched checks", async () => {
    vi.spyOn(client, "fetchDoctorReport").mockResolvedValue([
      { key: "saver-hooks-registered", value: "3/3", pass: true },
      { key: "saver-liveness", value: "failing", pass: false, reason: "run: mega hooks install" },
      { key: "saver-net-effect", value: "unknown", pass: true, reason: "warn: not enough traffic" },
    ]);
    render(<SaverDoctorPanel />);
    await waitFor(() => expect(screen.getByText("saver-hooks-registered")).toBeDefined());
    // assert pass/fail/warn visual distinction exists per row (exact assertion depends on the chosen badge implementation)
  });

  it("Run full self-test button triggers a selfTest=true fetch", async () => {
    const spy = vi.spyOn(client, "fetchDoctorReport").mockResolvedValue([]);
    render(<SaverDoctorPanel />);
    await waitFor(() => expect(spy).toHaveBeenCalledWith(false));
    fireEvent.click(screen.getByText(/Run full self-test/));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(true));
  });
});
```

- [ ] RED: `pnpm --filter @megasaver/gui exec vitest run test/components/saver-doctor-panel.test.tsx` — expect FAIL.
- [ ] Implement `SaverDoctorPanel`, following the existing card components' structure (`cache-doctor-card.tsx`/`token-budget-card.tsx` as style precedent — `useState`/`useEffect` fetch-on-mount, simple Tailwind classes matching this file's existing design tokens):

```tsx
import { useEffect, useState } from "react";
import { type DoctorCheck, fetchDoctorReport } from "../lib/claude-sessions-client.js";

function badgeFor(c: DoctorCheck): "pass" | "warn" | "fail" {
  if (!c.pass) return "fail";
  return c.reason?.startsWith("warn:") ? "warn" : "pass";
}

export function SaverDoctorPanel(): JSX.Element {
  const [checks, setChecks] = useState<DoctorCheck[] | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    fetchDoctorReport(false).then(setChecks).catch(() => setChecks([]));
  }, []);

  const runFull = async () => {
    setRunning(true);
    try {
      setChecks(await fetchDoctorReport(true));
    } catch {
      // keep prior checks on failure
    } finally {
      setRunning(false);
    }
  };

  if (checks === null) return <></>;

  return (
    <div className="flex flex-col gap-2 p-4 rounded-xl border border-border bg-surface text-xs">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-text-primary">Saver health</span>
        <button type="button" onClick={runFull} disabled={running} className="text-[10px] px-2 py-0.5 rounded border border-border text-text-secondary hover:bg-surface-elevated cursor-pointer disabled:opacity-40">
          {running ? "Running…" : "Run full self-test"}
        </button>
      </div>
      {checks.map((c) => (
        <div key={c.key} className="flex items-center gap-2">
          <span aria-hidden="true" className={`w-2 h-2 rounded-full ${badgeFor(c) === "pass" ? "bg-ok" : badgeFor(c) === "warn" ? "bg-warn" : "bg-danger"}`} />
          <span className="font-mono">{c.key}</span>
          <span className="text-text-muted">{c.value}</span>
          {c.reason ? <span className="text-text-secondary">{c.reason}</span> : null}
        </div>
      ))}
    </div>
  );
}
```

- [ ] Verify the exact CSS custom-property names used for pass/warn/fail elsewhere in this codebase (`bg-ok`/`bg-warn`/`bg-danger` are guesses based on `overview-page.tsx`'s `badge-status-live`/`badge-status-warn` classes seen during investigation — confirm the real Tailwind token names before finalizing, do not invent new ones if existing tokens already cover this).
- [ ] Add `<SaverDoctorPanel />` to `apps/gui/src/views/overview-page.tsx`, placed alongside (not replacing) the existing "System readiness" section per spec Component 6's resolved placement decision — read that section's exact JSX location first and add the new panel as a sibling section, collapsed/secondary by default (e.g. below the existing readiness card, not above it, so the existing primary UX is undisturbed).
- [ ] GREEN: re-run — expect PASS.
- [ ] Commit:

```bash
git add apps/gui/src/lib/claude-sessions-client.ts apps/gui/src/components/saver-doctor-panel.tsx apps/gui/src/views/overview-page.tsx apps/gui/test/components/saver-doctor-panel.test.tsx
git commit -m "feat(gui): add SaverDoctorPanel to the overview page"
```

---

### Task 4: Full verification, changeset, wiki

**Files:**
- Create: `.changeset/doctor-gui-bridge.md`
- Modify: `wiki/log.md`

**Steps:**

- [ ] Run `pnpm --filter @megasaver/context-gate exec vitest run` and `pnpm --filter @megasaver/cli exec vitest run` and `pnpm --filter @megasaver/gui exec vitest run` individually first (fast, isolated feedback before the full monorepo gate).
- [ ] Run the full monorepo gate:

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
pnpm verify
```

- [ ] Confirm all Turbo tasks green, INCLUDING both `apps/cli/test/dependency-graph.test.ts` and any equivalent `apps/gui` guard (record the observed pass count).
- [ ] Manually diff `mega doctor`'s full text output against a pre-relocation baseline if one was captured during Task 1 (or re-derive: run `mega doctor` on `main` before this branch's changes and again after, against the identical seeded store, and confirm byte-identical output) — this is the concrete regression evidence, not just "the tests pass."
- [ ] Create the changeset `.changeset/doctor-gui-bridge.md`:

```markdown
---
"@megasaver/context-gate": minor
"@megasaver/cli": patch
"@megasaver/gui": minor
---

Relocate `mega doctor`'s saver-health orchestration (`runSaverChecks`)
into `@megasaver/context-gate` so it can be shared with the GUI
bridge. Adds `GET /api/doctor` and a "Saver health" panel so a GUI-
only user gets the same registration/liveness/self-test/net-effect
diagnostics a CLI user already had via `mega doctor` — previously
invisible to anyone who only used the dashboard. `mega doctor`'s CLI
output is unchanged.
```

- [ ] Append a timestamped `wiki/log.md` entry: the GUI-visibility gap this closes (cite the specific finding — six check categories, zero GUI surface, `apps/gui` structurally cannot import `apps/cli`), the relocation approach (injected `hookCommandMatches` to avoid a real dependency cycle), verification evidence.
- [ ] Final commit:

```bash
git add .changeset/doctor-gui-bridge.md wiki/log.md
git commit -m "docs: changeset + wiki log for doctor-gui-bridge"
```
