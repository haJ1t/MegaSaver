# One-Command Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `mega up` runs the activation funnel as one idempotent DETECT → PLAN → APPLY → VERIFY transaction (hooks install, connector block sync, workspace saver enable), printing exactly what will be written before writing, recording each step's prior state in an atomic store-persisted manifest; `mega down` reverses only what that manifest recorded. Verify claims "working" only on an observed heartbeat event; otherwise it says "installed, not yet observed".

**Architecture:** New CLI orchestration in `apps/cli/src/up/` (manifest, detect, plan, apply, verify, reverse) plus two Citty commands, composing the EXISTING installers unchanged: `installClaudeCodeHook`/`uninstallClaudeCodeHook`/`readClaudeCodeHookStatus` (packages/connectors/claude-code/src/hook-settings.ts:540/568/604), `runConnectorSync` (apps/cli/src/commands/connector/sync.ts:47), `runSessionSaverWorkspaceEnable` (apps/cli/src/commands/session/saver/workspace.ts:55), `runProjectCreate` (apps/cli/src/commands/project.ts:112). One connector-package addition: a pure dry-run `planClaudeCodeHookInstall` factored out of `installClaudeCodeHook`'s existing value-diff (hook-settings.ts:558–565) so PLAN can report install/repair/ok without writing. Daemon and proxy routing are untouched (spec Locked Decisions 8 and Non-Goals).

**Tech Stack:** TypeScript strict ESM, Zod, Vitest, Citty, `withFileLock` from `@megasaver/shared/node` (packages/shared/src/file-lock.ts:25), pnpm workspaces + tsup. No pnpm catalog.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-06-one-command-up-design.md`; risk HIGH → worktree `feat/one-command-up`, `code-reviewer` AND `critic` passes, no `main` edits.
- Real `~/.claude` is untouchable in tests: EVERY test injects a temp `settingsPath` and temp `storeRoot` (mkdtemp), mirroring the connector suite (hook-settings.ts:639 SAFETY comment; wiki/workflows/cli-test-pattern.md).
- Single-writer invariant: settings.json mutations happen ONLY inside `installClaudeCodeHook`/`uninstallClaudeCodeHook` (which use `writeSettingsFile`, packages/connectors/claude-code/src/settings-write.ts:20). Up/down code never calls `writeSettingsFile` or writes the settings file directly.
- Foreign preservation (wiki/agent-channel.md 2026-07-02 18:20 condition 3 posture): hook removal stays command-level (`stripCommand`, hook-settings.ts:344 keeps co-located foreign hooks); connector edits touch only the sentinel-bounded block; `env.ANTHROPIC_BASE_URL` is never read or written (persistent-proxy-routing spec is CRITICAL and out of scope).
- Hooks always exit 0 → exit codes prove nothing; verify's only "observed" evidence is a heartbeat advance (`readHeartbeatView`, doctor-saver E22.4 precedent at apps/cli/src/commands/doctor-saver.ts:440–497).
- apps/cli never imports `@megasaver/stats` directly — verify uses `readHeartbeatView` from `@megasaver/context-gate` and plain file existence for the hook log (`HOOK_LOG_RELATIVE_PATH`, apps/cli/src/hooks/logger.ts:42).
- Manifest writes: tmp+rename under `withFileLock` (`deadlineMs: 2000, staleMs: 30_000` — interactive command, not a hook hot path).
- No timing-tight tests; `now`, `spawn`, `prompt`, and all runner deps are injected (RunInitDeps precedent, apps/cli/src/commands/init.ts:14).
- Every commit: conventional format (§10), subject ≤ 50 chars, `pnpm exec biome check <changed files>` + affected package tests green before commit.

---

### Task 1: connector dry-run — export `planClaudeCodeHookInstall`

**Files:**
- `packages/connectors/claude-code/src/hook-settings.ts` (edit)
- `packages/connectors/claude-code/src/index.ts` (edit — re-export)
- `packages/connectors/claude-code/test/hook-settings-plan.test.ts` (new)

**Interfaces:** `planClaudeCodeHookInstall(input: InstallClaudeCodeHookInput): ClaudeCodeHookResult` — same input/result types as `installClaudeCodeHook` (hook-settings.ts:524–533), computes `changed` by the SAME value-diff, writes nothing. Factor the desired-state composition out of `installClaudeCodeHook` (lines 540–566) so the diff lives in one place.

**Steps:**

- [ ] Write the failing test `packages/connectors/claude-code/test/hook-settings-plan.test.ts`:
```ts
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installClaudeCodeHook, planClaudeCodeHookInstall } from "../src/index.js";

const tempSettings = (content?: string): string => {
  const path = join(mkdtempSync(join(tmpdir(), "mega-up-")), "settings.json");
  if (content !== undefined) writeFileSync(path, content);
  return path;
};

describe("planClaudeCodeHookInstall", () => {
  it("reports changed=true for a missing file and writes nothing", () => {
    const settingsPath = tempSettings();
    expect(planClaudeCodeHookInstall({ settingsPath, platform: "darwin" }).changed).toBe(true);
    expect(() => readFileSync(settingsPath, "utf8")).toThrow();
  });

  it("reports changed=false after a real install (value-diff parity)", () => {
    const settingsPath = tempSettings();
    installClaudeCodeHook({ settingsPath, platform: "darwin" });
    expect(planClaudeCodeHookInstall({ settingsPath, platform: "darwin" }).changed).toBe(false);
  });

  it("reports changed=true on a drifted matcher without repairing the file", () => {
    const settingsPath = tempSettings();
    installClaudeCodeHook({ settingsPath, platform: "darwin" });
    const drifted = readFileSync(settingsPath, "utf8").replace("^(?:Read|", "^(?:");
    writeFileSync(settingsPath, drifted);
    expect(planClaudeCodeHookInstall({ settingsPath, platform: "darwin" }).changed).toBe(true);
    expect(readFileSync(settingsPath, "utf8")).toBe(drifted);
  });
});
```
- [ ] Run `pnpm --filter @megasaver/connector-claude-code test -- hook-settings-plan` — expect FAIL: `planClaudeCodeHookInstall` is not exported.
- [ ] Implement in `hook-settings.ts`: extract the add/remove chain from `installClaudeCodeHook` into a private `desiredHookSettings(existing: unknown, input: InstallClaudeCodeHookInput): unknown`; `installClaudeCodeHook` becomes read → desired → value-diff → `writeSettingsFile`; add:
```ts
// Same value-diff as installClaudeCodeHook (drift repair precedent above),
// but a pure read: `mega up` prints install/repair/ok BEFORE any write.
export function planClaudeCodeHookInstall(
  input: InstallClaudeCodeHookInput,
): ClaudeCodeHookResult {
  const existing = readSettings(input.settingsPath);
  const next = desiredHookSettings(existing, input);
  return {
    settingsPath: input.settingsPath,
    changed: JSON.stringify(next) !== JSON.stringify(existing),
  };
}
```
- [ ] Re-export from `packages/connectors/claude-code/src/index.ts` next to `installClaudeCodeHook`.
- [ ] Run the new test — PASS; run `pnpm --filter @megasaver/connector-claude-code test` — the full existing suite must stay green (refactor must not change install behavior).
- [ ] Commit: `feat(connector-claude-code): hook install dry-run`

---

### Task 2: up manifest store (schema + atomic locked read/write)

**Files:**
- `apps/cli/src/up/manifest.ts` (new)
- `apps/cli/test/up-manifest.test.ts` (new)

**Interfaces:**
```ts
export type UpManifest = z.infer<typeof upManifestSchema>;
export type UpManifestRead =
  | { kind: "absent" }
  | { kind: "ok"; manifest: UpManifest }
  | { kind: "corrupt"; message: string };
export function upManifestPath(storeRoot: string, workspaceKey: string): string;
export function readUpManifest(storeRoot: string, workspaceKey: string): UpManifestRead;
export function writeUpManifest(storeRoot: string, manifest: UpManifest): boolean; // false = lock busy
```

**Steps:**

- [ ] Write the failing test `apps/cli/test/up-manifest.test.ts` (temp `storeRoot` via `mkdtempSync`): round-trips a manifest with one step of each kind; `readUpManifest` on a missing file → `{ kind: "absent" }`; on `"{ not json"` → `kind: "corrupt"`; on valid JSON failing the schema (`version: 2`) → `kind: "corrupt"` with the Zod message; `writeUpManifest` returns `true` and leaves no `.tmp` residue in the directory.
- [ ] Run `pnpm --filter @megasaver/cli test -- up-manifest` — expect FAIL (module not found).
- [ ] Implement `apps/cli/src/up/manifest.ts`:
```ts
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tokenSaverModeSchema } from "@megasaver/shared";
import { withFileLock } from "@megasaver/shared/node";
import { z } from "zod";

const ts = z.string().min(1);
// Prior state is what `mega down` restores — record it, never infer it.
const hooksStepSchema = z.object({
  kind: z.literal("hooks-install"),
  at: ts,
  settingsPath: z.string().min(1),
  priorConnected: z.boolean(),
  changed: z.boolean(),
});
const connectorStepSchema = z.object({
  kind: z.literal("connector-sync"),
  at: ts,
  projectName: z.string().min(1),
  projectCreated: z.boolean(),
  targets: z.array(
    z.object({
      id: z.string().min(1),
      relativePath: z.string().min(1),
      prior: z.enum(["missing", "no-block", "block"]),
    }),
  ),
});
const saverStepSchema = z.object({
  kind: z.literal("saver-enable"),
  at: ts,
  exact: z.boolean(),
  priorEnabled: z.boolean(),
  priorMode: tokenSaverModeSchema,
  mode: tokenSaverModeSchema,
});
export const upManifestSchema = z.object({
  version: z.literal(1),
  workspaceKey: z.string().min(1),
  cwd: z.string().min(1),
  createdAt: ts,
  updatedAt: ts,
  steps: z.array(z.discriminatedUnion("kind", [hooksStepSchema, connectorStepSchema, saverStepSchema])),
  reversedAt: ts.optional(),
});
export type UpManifest = z.infer<typeof upManifestSchema>;

export function upManifestPath(storeRoot: string, workspaceKey: string): string {
  return join(storeRoot, "up", workspaceKey, "manifest.json");
}

export type UpManifestRead =
  | { kind: "absent" }
  | { kind: "ok"; manifest: UpManifest }
  | { kind: "corrupt"; message: string };

export function readUpManifest(storeRoot: string, workspaceKey: string): UpManifestRead {
  const path = upManifestPath(storeRoot, workspaceKey);
  if (!existsSync(path)) return { kind: "absent" };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    return { kind: "corrupt", message: err instanceof Error ? err.message : String(err) };
  }
  const parsed = upManifestSchema.safeParse(raw);
  return parsed.success
    ? { kind: "ok", manifest: parsed.data }
    : { kind: "corrupt", message: parsed.error.message };
}

export function writeUpManifest(storeRoot: string, manifest: UpManifest): boolean {
  const dir = join(storeRoot, "up", manifest.workspaceKey);
  mkdirSync(dir, { recursive: true });
  return withFileLock(join(dir, "manifest.lock"), { deadlineMs: 2000, staleMs: 30_000 }, () => {
    const tmp = join(dir, `.manifest.${randomUUID()}.tmp`);
    writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`);
    renameSync(tmp, join(dir, "manifest.json"));
  });
}
```
- [ ] Run the test — PASS.
- [ ] Commit: `feat(cli): up manifest schema + atomic store`

---

### Task 3: detect — read-only state of the three surfaces

**Files:**
- `apps/cli/src/up/detect.ts` (new)
- `apps/cli/test/up-detect.test.ts` (new)

**Interfaces:**
```ts
export type UpHooksDetect =
  | { kind: "unreadable"; message: string }               // parse error != absent: conflict, never rewrite
  | { kind: "readable"; changed: boolean; priorConnected: boolean };
export type UpTargetDetect = {
  id: string; relativePath: string;
  prior: "missing" | "no-block" | "block";
  inSync: boolean; // prior === "block" only: upsert-equality per connector/status.ts:103-104; false otherwise
};
export type UpDetectedState = {
  settingsPath: string;
  hooks: UpHooksDetect;
  saver: { enabled: boolean; mode: TokenSaverMode };
  targets: UpTargetDetect[];
};
export function detectUpState(input: {
  settingsPath: string; storeRoot: string; cwd: string;
  targets: readonly ConnectorTarget[]; config: HookCommandConfig; platform: NodeJS.Platform;
}): Promise<UpDetectedState>;
```
Uses `readClaudeCodeHookStatus` + `planClaudeCodeHookInstall` (Task 1) for hooks — but parses the file itself FIRST, because `readClaudeCodeHookStatus` swallows parse errors into all-false (hook-settings.ts:607–619) and up must treat unreadable as `conflict`, not "not installed". Saver state via `resolveWorkspaceTokenSaverSettings(storeRoot, cwd, nodeResolverDeps())` (verified: exported at packages/context-gate/src/resolve-saver-settings.ts:232, re-exported at packages/context-gate/src/index.ts:123). Targets via `readTargetFile` + `parseBlock` (`@megasaver/connectors-shared`, used the same way at apps/cli/src/commands/connector/status.ts:70–87), rooted at `cwd`. For a target with an existing block, `inSync` comes from the SAME upsert-equality the spec locks (Locked Decision 6): when a registry project matching `cwd` exists, build the context via `buildConnectorContext` (apps/cli/src/commands/connector/shared.ts, exactly as status.ts does) and compare `normalizeEol(upsertBlock({ existingContent, context })) === normalizeEol(existingContent)` (status.ts:103–104); no registered project yet → `inSync: false` (sync will rewrite once the project exists).

**Steps:**

- [ ] Write the failing test `apps/cli/test/up-detect.test.ts` (temp settingsPath + temp storeRoot in every case):
  - no settings file → `hooks: { kind: "readable", changed: true, priorConnected: false }`;
  - after `installClaudeCodeHook({ settingsPath, platform: "darwin" })` → `changed: false, priorConnected: true`;
  - settings containing `"{ nope"` → `kind: "unreadable"`;
  - no `CLAUDE.md` in temp cwd → target prior `"missing"`, `inSync: false`; a `CLAUDE.md` without sentinels → `"no-block"`; with a block synced for a registered temp-store project (write via `runConnectorSync`) → `"block"`, `inSync: true`; hand-mutate one byte inside the sentinels → `"block"`, `inSync: false`;
  - fresh store → `saver.enabled === false`.
- [ ] Run `pnpm --filter @megasaver/cli test -- up-detect` — expect FAIL.
- [ ] Implement `detectUpState`: hooks branch reads the file with its own try/JSON.parse (absent file → readable/empty), then `planClaudeCodeHookInstall({ settingsPath, config, platform })` for `changed` and `readClaudeCodeHookStatus({ settingsPath }).connected` for `priorConnected`; targets loop `readTargetFile(join(cwd, t.relativePath))` → `null` ⇒ `missing`, `parseBlock(existing).block === null` ⇒ `no-block`, else `block` with `inSync` from the upsert-equality comparison above (project/sessions/memory read from the store the same way `runConnectorStatus` does; no matching project ⇒ `inSync: false`). Target-branch core:
```ts
const existing = await readTargetFile(join(input.cwd, target.relativePath));
if (existing === null) { targets.push({ id: target.id, relativePath: target.relativePath, prior: "missing", inSync: false }); continue; }
if (parseBlock(existing).block === null) { targets.push({ ...base, prior: "no-block", inSync: false }); continue; }
const inSync = project !== null &&
  normalizeEol(upsertBlock({ existingContent: existing, context: buildConnectorContext(target, project, sessions, memoryEntries, now) })) === normalizeEol(existing);
targets.push({ ...base, prior: "block", inSync });
```
- [ ] Run the test — PASS.
- [ ] Commit: `feat(cli): mega up state detection`

---

### Task 4: plan — pure diff + renderer (the drift report)

**Files:**
- `apps/cli/src/up/plan.ts` (new)
- `apps/cli/test/up-plan.test.ts` (new)

**Interfaces:**
```ts
export type UpAction = "install" | "repair" | "ok" | "conflict";
export type UpPlan = {
  hooks: { action: UpAction; detail: string };      // detail: settingsPath or conflict message
  connector: { action: UpAction; targets: UpTargetDetect[]; detail: string };
  saver: { action: UpAction; mode: TokenSaverMode; detail: string };
  hasWork: boolean;    // any action in {install, repair}
  hasConflict: boolean;
};
export function buildUpPlan(state: UpDetectedState, mode: TokenSaverMode): UpPlan;
export function renderUpPlan(plan: UpPlan): string[];  // exact "will write" lines, one per surface
```
Mapping: hooks unreadable → `conflict`; `changed && priorConnected` → `repair` (the hook-settings value-diff drift case); `changed && !priorConnected` → `install`; else `ok`. Connector: any target `missing`/`no-block` → `install`; all `block` and all `inSync` → `ok` (the spec's idempotence requirement: second up plans all-ok); all `block` with any `!inSync` → `repair` (sync refreshes block content deterministically; rendered as "refresh block"), rendered per-target with the absolute path that will be written. Saver: `enabled && same mode` → `ok`, `enabled && other mode` → `repair`, disabled → `install`.

**Steps:**

- [ ] Write the failing test: table-driven over the mapping above — including connector `[{ prior: "block", inSync: true }]` → `ok` and `[{ prior: "block", inSync: false }]` → `repair` — plus: `renderUpPlan` output names the settings path and each target's absolute path; a conflict plan sets `hasConflict` and its rendered line contains `"fix manually"`; an all-`ok` plan has `hasWork === false`.
- [ ] Run `pnpm --filter @megasaver/cli test -- up-plan` — expect FAIL.
- [ ] Implement (pure functions, no I/O):
```ts
export function buildUpPlan(state: UpDetectedState, mode: TokenSaverMode): UpPlan {
  const hooks =
    state.hooks.kind === "unreadable"
      ? { action: "conflict" as const, detail: state.hooks.message }
      : {
          action: state.hooks.changed ? (state.hooks.priorConnected ? ("repair" as const) : ("install" as const)) : ("ok" as const),
          detail: state.settingsPath,
        };
  const connectorAction: UpAction = state.targets.some((t) => t.prior !== "block")
    ? "install"
    : state.targets.every((t) => t.inSync)
      ? "ok"
      : "repair";
  const saverAction: UpAction = !state.saver.enabled ? "install" : state.saver.mode === mode ? "ok" : "repair";
  const actions = [hooks.action, connectorAction, saverAction];
  return {
    hooks,
    connector: { action: connectorAction, targets: state.targets, detail: connectorDetail(state.targets) },
    saver: { action: saverAction, mode, detail: saverDetail(state.saver, mode) },
    hasWork: actions.some((a) => a === "install" || a === "repair"),
    hasConflict: actions.includes("conflict"),
  };
}
```
- [ ] Run the test — PASS.
- [ ] Commit: `feat(cli): mega up plan builder`

---

### Task 5: apply — execute plan, record prior state per step

**Files:**
- `apps/cli/src/up/apply.ts` (new)
- `apps/cli/test/up-apply.test.ts` (new)

**Interfaces:**
```ts
export type UpApplyDeps = {
  hooksInstall: () => 0 | 1;                                     // wraps runHooksInstall (install.ts:54)
  ensureProject: () => Promise<{ code: 0 | 1; name: string; created: boolean }>; // wraps runProjectCreate (project.ts:112) after a listProjects rootPath match
  connectorSync: (projectName: string) => Promise<0 | 1>;        // wraps runConnectorSync (sync.ts:47)
  saverEnable: () => Promise<0 | 1>;                             // wraps runSessionSaverWorkspaceEnable (workspace.ts:55)
  now: () => string;
};
export type UpApplyResult = { code: 0 | 1; failedStep?: "hooks-install" | "connector-sync" | "saver-enable" };
export function runUpApply(input: {
  plan: UpPlan; state: UpDetectedState; storeRoot: string; workspaceKey: string;
  cwd: string; mode: TokenSaverMode; exact: boolean; deps: UpApplyDeps;
}): Promise<UpApplyResult>;
```
Semantics (spec Locked Decision 10): steps run in order hooks → connector → saver; `ok`/`conflict` steps are skipped (conflict already blocked upstream); BEFORE each executed step the prior state from `state` is captured, AFTER success the step is appended and the manifest rewritten via `writeUpManifest`; first failure stops apply (fail-fast), manifest keeps completed steps. Re-running is the repair path. Manifest is loaded first with `readUpManifest`; an existing `ok` manifest is extended (steps appended, `updatedAt` bumped), never duplicated for skipped steps; `corrupt` → refuse apply.

**Steps:**

- [ ] Write the failing test with stub deps recording call order (temp storeRoot): full-install plan → three deps called in order, manifest has 3 steps with correct priors (`priorConnected: false`, target priors from state, `priorEnabled: false`); `saverEnable` failing → `code: 1`, `failedStep: "saver-enable"`, manifest holds exactly the 2 completed steps; all-`ok` plan → zero dep calls, manifest unchanged. Idempotence is tested END-TO-END, not with a hand-built plan: run `runUpApply` once with REAL runner deps pointed at temp settings/store/cwd fixtures (Task 8's round-trip style), then re-run `detectUpState` → `buildUpPlan` against the same fixtures — the second plan must be all-`ok` (`hasWork === false`, spec Testing "second up plans all-ok") — and a second `runUpApply` with that plan appends nothing.
- [ ] Run `pnpm --filter @megasaver/cli test -- up-apply` — expect FAIL.
- [ ] Implement `runUpApply` exactly per the semantics block (no logic in the command layer); skeleton:
```ts
const read = readUpManifest(input.storeRoot, input.workspaceKey);
if (read.kind === "corrupt") return { code: 1 };
let manifest = read.kind === "ok" ? read.manifest : freshManifest(input);
const steps: Array<{ key: "hooks-install" | "connector-sync" | "saver-enable"; action: UpAction; run: () => Promise<UpStep> }> = [
  { key: "hooks-install", action: input.plan.hooks.action, run: async () => hooksStepFrom(input, await input.deps.hooksInstall()) },
  { key: "connector-sync", action: input.plan.connector.action, run: connectorStepRunner(input) }, // ensureProject → connectorSync
  { key: "saver-enable", action: input.plan.saver.action, run: saverStepRunner(input) },
];
for (const s of steps) {
  if (s.action !== "install" && s.action !== "repair") continue; // ok/conflict skipped
  const step = await s.run().catch(() => null);
  if (step === null || failed(step)) return persist(manifest), { code: 1, failedStep: s.key };
  manifest = { ...manifest, updatedAt: input.deps.now(), steps: [...manifest.steps, step] };
  if (!writeUpManifest(input.storeRoot, manifest)) return { code: 1, failedStep: s.key }; // lock busy
}
return { code: 0 };
```
- [ ] Run the test — PASS.
- [ ] Commit: `feat(cli): mega up apply engine + manifest`

---

### Task 6: verify — observed-event honesty

**Files:**
- `apps/cli/src/up/verify.ts` (new)
- `apps/cli/test/up-verify.test.ts` (new)

**Interfaces:**
```ts
export type UpVerifyDeps = {
  spawn: (cmd: string, stdinJson: string, timeoutMs: number) =>
    { status: number | null; stdout?: string; error?: string };  // shape of DoctorSaverDeps.spawn (doctor-saver.ts:22)
  now: () => number;
};
export type UpVerifyResult = {
  saver:
    | { kind: "observed"; detail: string }        // exit 0 AND invocation+completion heartbeat advanced
    | { kind: "failed"; detail: string }          // probe ran, evidence missing → repair hint
    | { kind: "not-probeable"; detail: string };  // no registered saver command found
  passive: string[];   // one "installed, not yet observed — run a Claude Code session; check `mega hooks status`" line per unprobeable hook (log/intent/warmup/guard)
  daemon: string;      // informational only: running | not running (in-process fallback is by design)
};
export function runUpVerify(input: {
  settingsPath: string; storeRoot: string; cwd: string; deps: UpVerifyDeps;
}): UpVerifyResult;
```
Mirrors doctor-saver E22.4 (doctor-saver.ts:440–497): find the registered saver command by walking `hooks.PostToolUse` entries for a command where `hookCommandMatches(cmd, "saver")` (hook-settings.ts:189); snapshot `readHeartbeatView(storeRoot)` before; spawn with payload `{ session_id: "up-verify-<uuid>", tool_name: "Bash", cwd, tool_response: { stdout: "x".repeat(200), stderr: "" } }`; require exit 0 AND invocation AND completion timestamps to advance. Any other outcome is `failed` with the doctor repair hint (`run: mega hooks install`). Daemon presence via `readDiscovery(storeRoot)` (`@megasaver/daemon`, as used at doctor-saver.ts:499). NEVER a "✓ working" wording without the heartbeat advance — hooks always exit 0, so exit codes alone are not evidence.

**Steps:**

- [ ] Write the failing test (temp settingsPath with a real `installClaudeCodeHook` result; temp storeRoot): stub spawn exit 0 that also writes an advancing heartbeat via `recordInvocationHeartbeat` + `recordCompletionHeartbeat` (verified exports, packages/context-gate/src/index.ts:137/139) → `kind: "observed"`. Stub exit 0 with NO heartbeat write → `kind: "failed"` and detail containing `"no heartbeat"`; settings without a saver hook → `not-probeable`; `passive` always lists the four unprobeable hooks with the exact "installed, not yet observed" wording; assert the string `"✓ working"` appears nowhere in any result.
- [ ] Run `pnpm --filter @megasaver/cli test -- up-verify` — expect FAIL.
- [ ] Implement per the interface block; skeleton:
```ts
const saverCmd = findSaverCommand(input.settingsPath); // walk hooks.PostToolUse for hookCommandMatches(cmd, "saver")
if (saverCmd === null) return { saver: { kind: "not-probeable", detail: "no registered saver hook" }, passive, daemon };
const before = readHeartbeatView(input.storeRoot);
const res = input.deps.spawn(saverCmd, JSON.stringify(probePayload(input.cwd)), 5000);
const after = readHeartbeatView(input.storeRoot);
const advanced = advancedInvocation(before, after) && advancedCompletion(before, after);
const saver = res.status === 0 && advanced
  ? { kind: "observed" as const, detail: `heartbeat advanced (${after.lastInvocationAt})` }
  : { kind: "failed" as const, detail: res.status !== 0 ? `probe exit ${res.status} — run: mega hooks install` : "exit 0 but no heartbeat advance — run: mega hooks install" };
```
- [ ] Run the test — PASS.
- [ ] Commit: `feat(cli): mega up verify via heartbeat`

---

### Task 7: `mega up` command

**Files:**
- `apps/cli/src/commands/up.ts` (new)
- `apps/cli/src/main.ts` (edit — register `up` in the subCommands map at main.ts:60)
- `apps/cli/test/up-command.test.ts` (new)

**Interfaces:**
```ts
export type RunUpInput = {
  mode?: TokenSaverMode; yes: boolean; planOnly: boolean; exact: boolean; gui: boolean;
  targetIds: string[]; settingsPath: string; storeFlag: string | undefined;
  cwd: string; home: string; xdgDataHome: string | undefined; platform: NodeJS.Platform;
  localAppData: string | undefined; isTTY: boolean; json: boolean;
  deps: { apply: UpApplyDeps; verify: UpVerifyDeps; prompt: () => Promise<boolean>; gui: () => Promise<unknown> };
  stdout: (line: string) => void; stderr: (line: string) => void;
};
export function runUp(input: RunUpInput): Promise<0 | 1>;
```
Flow: resolve store (`resolveStorePath`/`readStoreEnv`, apps/cli/src/store.ts) → `detectUpState` → `buildUpPlan` → print `renderUpPlan` (or JSON). Then gates: `hasConflict` → exit 1, nothing written; `planOnly` → exit 0; `!hasWork` → print all-ok drift report, skip apply, still run verify; TTY without `--yes` → `confirmYesNo` (init.ts:107), decline → exit 0 nothing written; **non-TTY without `--yes` → exit 1, nothing written** (spec Locked Decision 2 — deliberate divergence from `mega init`). Then `runUpApply` → `runUpVerify` → report; `--gui` opens `runGui` last (non-fatal, init.ts:88 precedent). Default targets: `[CLAUDE_CODE_TARGET]` (apps/cli/src/known-targets.ts:12); `--target` values validated with `isKnownTargetId`. Hook command config built with `resolveInvokedCliPath(process.argv[1])` + `resolveBakedStoreRoot` (install.ts:31/44) in the Citty `run`, not in `runUp`.

**Steps:**

- [ ] Write the failing handler test (temp settingsPath + storeRoot; injected deps; capture stdout): plan lines are printed BEFORE any dep is called; `planOnly` → zero dep calls, exit 0; non-TTY without yes → exit 1, zero dep calls, stderr mentions `--yes`; TTY prompt declined → exit 0, zero dep calls; `--yes` full run → apply then verify deps called, exit 0; conflict state (unparseable temp settings) → exit 1, zero dep calls, settings bytes untouched.
- [ ] Run `pnpm --filter @megasaver/cli test -- up-command` — expect FAIL.
- [ ] Implement `runUp` + `upCommand` (Citty args: `mode`, `yes`, `plan`, `exact`, `target` repeatable, `settings`, `store`, `gui` default false, `json`; mode parsed with `tokenSaverModeSchema.safeParse` and `invalidModeMessage` like init.ts:151–162); register in `main.ts`. `runUp` gate order, line by line:
```ts
const storeRoot = resolveStorePath(readStoreEnv(input.storeFlag), envFrom(input));
const state = await detectUpState({
  settingsPath: input.settingsPath, storeRoot, cwd: input.cwd,
  targets, config, platform: input.platform,
});
const plan = buildUpPlan(state, mode);
for (const line of renderUpPlan(plan)) input.stdout(line); // or one JSON object with --json
if (plan.hasConflict) return 1;                     // nothing written
if (input.planOnly) return 0;
if (plan.hasWork) {
  if (!input.yes && !input.isTTY) { input.stderr("refusing to write without --yes in non-TTY"); return 1; }
  if (!input.yes && !(await input.deps.prompt())) return 0;
  const applied = await runUpApply({ plan, state, storeRoot, workspaceKey, cwd: input.cwd, mode, exact: input.exact, deps: input.deps.apply });
  if (applied.code === 1) return 1;
}
const verdict = runUpVerify({ settingsPath: input.settingsPath, storeRoot, cwd: input.cwd, deps: input.deps.verify });
// print verdict; --gui → await input.deps.gui() last, non-fatal
```
- [ ] Run the test — PASS; run `pnpm --filter @megasaver/cli test` for the full suite.
- [ ] Commit: `feat(cli): mega up command`

---

### Task 8: `mega down` — manifest-driven reversal

**Files:**
- `apps/cli/src/up/reverse.ts` (new)
- `apps/cli/src/commands/down.ts` (new)
- `apps/cli/src/main.ts` (edit — register `down`)
- `apps/cli/test/up-down-roundtrip.test.ts` (new)

**Interfaces:**
```ts
export type DownDeps = {
  hooksUninstall: () => ClaudeCodeHookResult;   // wraps uninstallClaudeCodeHook (hook-settings.ts:568)
  saverRestore: (enabled: boolean, mode: TokenSaverMode, exact: boolean) => void; // writeActivation(storeRoot, resolveActivationScope(cwd, exact), enabled, mode) (activation-scope.ts:53/27)
  now: () => string;
};
export function runDownReverse(input: {
  manifest: UpManifest; storeRoot: string; cwd: string; deps: DownDeps;
}): { code: 0 | 1; lines: string[] };
export function stripSentinelBlock(content: string): { next: string; removed: boolean };
```
Reversal rules (spec Locked Decision 4) — steps processed in REVERSE order:
- `saver-enable`: restore the recorded prior exactly — `saverRestore(priorEnabled, priorMode, exact)`. Previously-enabled stays enabled (with its prior mode); only an up-enabled saver is disabled.
- `connector-sync`: per recorded target, `prior === "block"` → leave untouched (up only refreshed content it already owned); `"no-block"` → strip only the sentinel-bounded block, keep every byte outside it; `"missing"` → strip the block and delete the file ONLY if the stripped remainder is whitespace-only (spec Risk flag: reviewers may strike the deletion). Sentinels: `MEGA_SAVER_BLOCK_START`/`MEGA_SAVER_BLOCK_END` (defined at packages/connectors/shared/src/constants.ts:1–2; verified re-exported from `@megasaver/connectors-shared` at packages/connectors/shared/src/index.ts:2–3).
- `hooks-install`: call `hooksUninstall()` ONLY when `priorConnected === false`; a pre-existing installation is not ours to remove.
- Registry data (`projectCreated: true`) is NEVER reversed — report "project '<name>' kept (store data)".
- Finish: stamp `reversedAt`, rewrite manifest via `writeUpManifest`.
`runDown` command flow mirrors `runUp`: `readUpManifest` → `absent` → "nothing to reverse", exit 0; `corrupt` → print Zod message + manual path hint (`mega hooks uninstall`, `mega session saver workspace disable`), exit 1; else print the reversal plan, same `--yes`/TTY gates, then execute.

**Steps:**

- [ ] Write the failing round-trip test `apps/cli/test/up-down-roundtrip.test.ts` (the review gate for the whole feature; temp everything):
```ts
const foreign = {
  env: { ANTHROPIC_BASE_URL: "http://localhost:4141" },
  hooks: { PostToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "my-linter --fix" }] }] },
};
writeFileSync(settingsPath, JSON.stringify(foreign, null, 2));
```
  up (via `runUpApply` with real runner deps pointed at temp paths) then down (via `runDownReverse`): parsed settings afterwards deep-equal `foreign` (foreign env + foreign hook preserved, ours gone); a pre-seeded `CLAUDE.md` reading `"# Mine\n"` + our block → down leaves exactly `"# Mine\n"`; a `CLAUDE.md` up created (`prior: "missing"`) is deleted; saver pre-enabled `aggressive` before up(`balanced`) → after down: enabled `aggressive` (via `resolveWorkspaceTokenSaverSettings`); `priorConnected: true` manifest → `hooksUninstall` never called.
- [ ] Run `pnpm --filter @megasaver/cli test -- up-down-roundtrip` — expect FAIL.
- [ ] Implement `stripSentinelBlock`, `runDownReverse`, `runDown` + `downCommand`, register in `main.ts`. Core:
```ts
export function stripSentinelBlock(content: string): { next: string; removed: boolean } {
  const start = content.indexOf(MEGA_SAVER_BLOCK_START);
  const endAt = content.indexOf(MEGA_SAVER_BLOCK_END);
  if (start === -1 || endAt === -1 || endAt < start) return { next: content, removed: false };
  const end = endAt + MEGA_SAVER_BLOCK_END.length;
  const next = (content.slice(0, start) + content.slice(end)).replace(/\n{3,}/g, "\n\n");
  return { next, removed: true };
}
```
  `runDownReverse` walks `manifest.steps` in reverse with a `switch (step.kind)` applying the reversal rules above verbatim; each processed step pushes a report line; finish stamps `reversedAt` and rewrites via `writeUpManifest`.
- [ ] Run the test — PASS; run `pnpm --filter @megasaver/cli test`.
- [ ] Commit: `feat(cli): mega down manifest reversal`

---

### Task 9: changeset, full verify, smoke evidence

**Files:**
- `.changeset/one-command-up.md` (new)
- `wiki/log.md` (edit — timestamped entry) and `wiki/entities/cli.md` (edit — `mega up`/`mega down` surface)

**Steps:**

- [ ] Add the changeset (public API changed in two packages — DoD 9):
```md
---
"@megasaver/connector-claude-code": minor
"@megasaver/cli": minor
---

`mega up` one-command activation (plan/apply/verify + undo manifest), `mega down` manifest-driven reversal, and a `planClaudeCodeHookInstall` dry-run on the Claude Code connector.
```
- [ ] Run `pnpm verify` at repo root — lint + typecheck + all tests green (DoD 4).
- [ ] Capture smoke evidence (DoD 5, CLI feature) against a TEMP settings path and TEMP store — never the real `~/.claude`:
```bash
export UP_TMP=$(mktemp -d)
mega up --settings "$UP_TMP/settings.json" --store "$UP_TMP/store" --plan
mega up --settings "$UP_TMP/settings.json" --store "$UP_TMP/store" --yes
mega up --settings "$UP_TMP/settings.json" --store "$UP_TMP/store" --plan   # drift report: all ok
mega down --settings "$UP_TMP/settings.json" --store "$UP_TMP/store" --yes
```
  Save the captured session under `docs/superpowers/evidence/2026-08-06-one-command-up-smoke.txt`; the verify section of the capture must show either the heartbeat-observed line or the honest "installed, not yet observed" line — never an unevidenced success claim.
- [ ] Update `wiki/entities/cli.md` + append a `wiki/log.md` entry (wiki-first §0).
- [ ] Request review: `code-reviewer` pass, then `critic` pass (HIGH — both required, fresh contexts; author ≠ reviewer).
- [ ] Commit: `docs(cli): one-command-up changeset + evidence`

---

## Self-review

- Every APPLY writer is an existing, verified function; the only new public connector symbol (`planClaudeCodeHookInstall`) is a pure factoring of the existing value-diff, keeping the drift-repair logic in one place.
- Verify can never lie: the "observed" branch structurally requires a heartbeat advance; the test in Task 6 asserts the absence of "✓ working" wording.
- The riskiest write is `down`'s conditional file deletion (Task 8); it is double-gated (manifest `prior: "missing"` + whitespace-only remainder) and flagged in the spec's Risk section for reviewer strike-down.
- No open ASSUMPTIONs: the three former re-export assumptions (`nodeResolverDeps`, the heartbeat writers, the sentinel constants) are verified against the repo and cited inline in Tasks 3, 6, and 8.
