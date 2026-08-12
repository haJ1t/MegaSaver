# Exec-Rewrite Saver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opt-in PreToolUse mode that rewrites eligible agent Bash commands to run through `mega output exec-live` BEFORE execution, so the compressed (chunk-store-backed, recovery-footer'd) output is the only version the client ever caches — zero cache churn by construction, lossless via the existing overlay chunk store, with honest per-origin stats (spec: `docs/superpowers/specs/2026-08-06-exec-rewrite-saver-design.md`).

**Architecture:** Five additive seams, no new package. (1) A flat-token classifier `classifyExecRewrite` in `apps/cli/src/hooks/exec-rewrite-command.ts` (LD5, discipline of `apps/cli/src/hooks/output-route-command.ts`). (2) A fail-open hook runner `buildExecRewriteHookOutput` + `mega hooks exec-rewrite` subcommand emitting `hookSpecificOutput.updatedInput` (LD1/LD2). (3) A new `mega output exec-live` CLI that pipelines `runChild` → `makeRecord` (daemon-first `recordAndFilterOverlayOutput`) with semantics parity and failure-tee (LD3/LD4/LD6/LD7). (4) An additive `origin: "exec-rewrite"` field threaded context-gate → stats event → daemon excerpt schema (LD8). (5) Connector install surface: own `^Bash$` PreToolUse entry with tri-state `--exec-rewrite` install flag (LD9), guard-trio model.

**Tech Stack:** TypeScript strict ESM (NodeNext), Node 22, pnpm workspaces + Turborepo, tsup builds, Vitest, Biome, Citty (CLI), Zod ^3.24.1.

## Global Constraints

- Hook entry: own PreToolUse entry, matcher exactly `^Bash$`, timeout `10` (the `timeoutFor` non-saver default, packages/connectors/claude-code/src/hook-settings.ts:201-203); never piggybacked on guard (LD1).
- Hook contract: never throws, emits `""` on ANY failure, always exits 0 — fail-open, original command runs untouched (contract of `buildGuardHookOutput`, apps/cli/src/hooks/guard-run.ts:98-103, 240-252).
- Never emit `permissionDecision` — output is `hookSpecificOutput.updatedInput` only; the user's permission system evaluates the rewritten command (LD2; guard-run.ts:221 "NEVER allow" discipline).
- Classifier caps: ≤64 tokens, ≤4096 bytes, `SAFE_TOKEN = /^[A-Za-z0-9_./:@%+=,-]+$/`, ASCII-space separator only, null-biased (mirror apps/cli/src/hooks/output-route-command.ts:7-10, 69-80).
- exec-live defaults (LD11/LD15): timeout 600 s default; when the hook payload carries `tool_input.timeout` (ms), the hook threads `--timeout ceil(ms/1000)`; max-bytes default 100_000_000 (documented deviation: `runChild` KILLS at maxBytes where the native Bash tool truncates display and lets the command finish — deliberate, bounded wrapper memory). Exit code ALWAYS mirrors the child (`childExitCode ?? 0`, exec.ts:165-167 precedent).
- exec-live record input always carries `storeRawOutput: true`, `includeFooter: true`, `origin: "exec-rewrite"`, `evidenceStoreRoot: storeRoot`, and a content-derived `newId` (LD7/LD8/LD14); delivery goes daemon-first through `makeRecord` (1500 ms daemon timeout, apps/cli/src/hooks/saver-run.ts:102, 150-181).
- LD13: exec-live re-runs `classifyExecRewrite` on its own positionals; non-conforming command → stderr `error: refused: command not allowlisted`, exit 1, NO spawn (the flat-token allowlist is a structural invariant of the delivery path).
- LD12: the PostToolUse saver exempts exec-live invocations — extend the C13 passthrough (apps/cli/src/hooks/saver.ts:337-344) to `/\bmega\s+output\s+(?:chunk|exec-live)\b/`; test proves no double compression / footer-on-footer.
- LD6 parity: any mega-internal failure (store resolve, settings, record throw, daemon error, unsafe session id) degrades to raw byte-identical delivery with mirrored exit code — the rewrite may improve delivery, never behavior.
- `origin` is additive-optional in every `.strict()` schema it touches (packages/stats/src/event.ts:72-100, packages/daemon/src/handlers.ts:23-46); an old daemon 400s and the hook client falls back in-process (existing makeRecord behavior).
- `childExitCode` on saver EVENTS is owned by claim-verification-gate (docs/superpowers/specs/2026-08-06-claim-verification-gate-design.md) — consume once merged, NEVER add it here.
- Dual activation gate (LD9): rewrite fires only when the hook entry is installed AND `resolveWorkspaceTokenSaverSettings(storeRoot, cwd, nodeResolverDeps())` reports enabled (packages/context-gate/src/resolve-saver-settings.ts:68, 232).
- No new package, no MCP tools, no new persisted file formats, no `withFileLock` (all persistence rides existing overlay chunk-store/stats appenders), no CLI stats surfacing (architect YAGNI cut 2026-08-13: `splitOverlayEventsByOrigin` is DEFERRED — no consumer can call it; `origin` still ships as honest data).
- LD10: the rewrite is emitted ONLY when the launcher path AND store path are SAFE_TOKEN-class (`/^[A-Za-z0-9_./:@%+=,-]+$/`) — no shell quoting anywhere; a non-SAFE_TOKEN path (e.g. `C:\...\mega.cmd`, paths with spaces) DECLINES the rewrite (fail-open, raw Bash runs). `quoteForPosixShell` stays internal to the connector and is NOT exported.
- Tests: injected `runChildImpl` + `record` — no real spawn, no timing-tight assertions; enum value lists are append-only (enum order is a contract; apps/cli/test/enum-pin-audit.test.ts pins).
- CLI never imports `@megasaver/stats` directly (reads via `@megasaver/core` re-exports); the Task 4 selector deliberately gets NO core re-export this wave (spec component 6).
- Process: HIGH risk (§12) — work in a worktree (no `main` edits), `pnpm verify` green before any "done", `code-reviewer` AND `critic` in separate fresh contexts, conventional commits with ≤50-char imperative subjects.

---

### Task 0: Q1 contract gate (BLOCKING — before any code)

**Files:**
- Create: none (evidence goes in the PR description / wiki log entry)
- Modify: none
- Test: none

**Interfaces:**
- Consumes: Claude Code hooks documentation / runtime (PreToolUse `hookSpecificOutput` contract).
- Produces: a recorded verdict on LD2's ASSUMPTION gate.

**Steps:**

- [x] Q1 DOCS VERIFICATION (done 2026-08-13, spec refresh): the official hooks reference documents PreToolUse `hookSpecificOutput.updatedInput` — full replacement of the `tool_input` object ("include unchanged fields alongside modified ones"), no `permissionDecision` documented as required, only `"defer"` nullifies it, no version gate, no re-fire documented, cross-hook precedence `deny > defer > ask > allow`. Spec LD2 corrected to echo `{ ...toolInput, command }`.
- [ ] Q1 RUNTIME PROBE (remaining gate, before Task 6 hook wiring): with an installed exec-rewrite hook, confirm `updatedInput` ALONE (no `permissionDecision`) actually rewrites the command in the current Claude Code runtime. If it requires `permissionDecision: "allow"` to take effect: **STOP. LD2 forbids that. Return the spec to review — do not implement any task below.**
- [ ] Record the verified contract (doc link + probe transcript) in the worktree PR description and in `wiki/log.md`.

---

### Task 1: Classifier — `classifyExecRewrite`

**Files:**
- Create: `apps/cli/src/hooks/exec-rewrite-command.ts`
- Modify: none
- Test: `apps/cli/test/hooks/exec-rewrite-command.test.ts`

**Interfaces:**
- Consumes: nothing outside `node:buffer` (pure module, mirror of apps/cli/src/hooks/output-route-command.ts).
- Produces:
  - `export function classifyExecRewrite(command: string): { command: string; args: string[] } | null`
  - `export const MAX_EXEC_REWRITE_COMMAND_BYTES = 4_096`

**Steps:**

- [ ] Write the failing test. Mimic the `it.each` accept/reject table harness of `apps/cli/test/hooks/output-route-command.test.ts:1-27`:

```ts
// apps/cli/test/hooks/exec-rewrite-command.test.ts
import { describe, expect, it } from "vitest";
import {
  MAX_EXEC_REWRITE_COMMAND_BYTES,
  classifyExecRewrite,
} from "../../src/hooks/exec-rewrite-command.js";

describe("classifyExecRewrite — accepted grammar", () => {
  it.each([
    ["vitest run", "vitest", ["run"]],
    ["tsc --noEmit", "tsc", ["--noEmit"]],
    ["pytest -q tests", "pytest", ["-q", "tests"]],
    ["eslint src", "eslint", ["src"]],
    ["go test ./...", "go", ["test", "./..."]],
    ["cargo test", "cargo", ["test"]],
    ["cargo clippy", "cargo", ["clippy"]],
    ["git status", "git", ["status"]],
    ["git log --oneline -5", "git", ["log", "--oneline", "-5"]],
    ["git diff HEAD", "git", ["diff", "HEAD"]],
    ["ls -la src", "ls", ["-la", "src"]],
    ["grep -rn TODO src", "grep", ["-rn", "TODO", "src"]],
    ["grep -w exact src/a.ts", "grep", ["-w", "exact", "src/a.ts"]],
    ["rg TODO src", "rg", ["TODO", "src"]],
    ["find src -type f", "find", ["src", "-type", "f"]],
  ] as const)("accepts %s", (command, program, args) => {
    expect(classifyExecRewrite(command)).toEqual({ command: program, args: [...args] });
  });
});

describe("classifyExecRewrite — rejects (null-biased)", () => {
  it.each([
    // script runners (Open Q2 — not v1)
    "pnpm test",
    "npm run build",
    // watchers
    "vitest --watch",
    "vitest watch",
    "vitest -w",
    "tsc -w",
    "tsc --watch",
    // find mutators
    "find . -delete",
    "find . -type f -exec rm {} ;",
    "find . -execdir touch x ;",
    "find . -ok rm x ;",
    "find . -okdir rm x ;",
    // mega launchers anywhere (loop safety)
    "mega output chunk cs-1 0",
    "./node_modules/.bin/mega hooks guard",
    "node dist/mega.mjs output gc",
    // non-allowlisted programs / subcommands
    "sudo ls",
    "git push",
    "git rebase main",
    "cargo run",
    "go build ./...",
    "vim src/a.ts",
    "python repl.py",
    // shell syntax / env-prefix (unsafe tokens or unlisted program)
    "vitest run | tee out.log",
    'vitest "run"',
    "FOO=1 vitest run",
    "vitest run > out.txt",
    "vitest run && echo ok",
    "vitest\trun",
    " vitest run",
    "",
  ])("rejects %j", (command) => {
    expect(classifyExecRewrite(command)).toBeNull();
  });

  it("rejects above the byte cap", () => {
    const long = `grep ${"a".repeat(MAX_EXEC_REWRITE_COMMAND_BYTES)}`;
    expect(classifyExecRewrite(long)).toBeNull();
  });

  it("rejects above the 64-token cap", () => {
    const many = `ls ${Array.from({ length: 70 }, (_, i) => `f${i}`).join(" ")}`;
    expect(classifyExecRewrite(many)).toBeNull();
  });
});
```

- [ ] RED: `pnpm --filter @megasaver/cli exec vitest run test/hooks/exec-rewrite-command.test.ts` — expected failure: `Cannot find module '../../src/hooks/exec-rewrite-command.js'`.
- [ ] Implement `apps/cli/src/hooks/exec-rewrite-command.ts` (LD5 — same tokenization discipline as output-route-command.ts:69-80: byte cap, `/[^\S ]/` rejection, trim equality, ASCII-space split, token count cap, no empty tokens):

```ts
// Flat-token allowlist grammar for the exec-rewrite saver (LD5). Discipline of
// output-route-command.ts: ASCII-space tokens only, SAFE_TOKEN class, caps,
// null-biased — a false positive would rewrite a command the user never
// approved in that shape, so every ambiguity is null.
export const MAX_EXEC_REWRITE_COMMAND_BYTES = 4_096;
const MAX_EXEC_REWRITE_TOKENS = 64;
const SAFE_TOKEN = /^[A-Za-z0-9_./:@%+=,-]+$/;

// Re-entry safety (LD5): a rewritten command starts with a mega launcher, so
// refusing launchers ANYWHERE makes a second hook pass a structural no-op.
const MEGA_LAUNCHERS = new Set(["mega", "mega.mjs", "mega.cmd", "mega.exe"]);
const GIT_READONLY = new Set(["status", "log", "diff", "show", "branch"]);
const CARGO_ALLOWED = new Set(["test", "build", "check", "clippy"]);
const FIND_MUTATORS = new Set(["-delete", "-exec", "-execdir", "-ok", "-okdir"]);
// -w means watch for these programs; for grep it is word-match and stays legal.
const WATCH_W_PROGRAMS = new Set(["vitest", "tsc"]);
const PLAIN_PROGRAMS = new Set(["vitest", "tsc", "pytest", "eslint", "ls", "grep", "rg", "find"]);

function isSafeToken(token: string): boolean {
  if (!SAFE_TOKEN.test(token)) return false;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control rejection is the point
  return !/[\x00-\x1f\x7f]/.test(token);
}

function basenameOf(token: string): string {
  const i = token.lastIndexOf("/");
  return i === -1 ? token : token.slice(i + 1);
}

export function classifyExecRewrite(command: string): { command: string; args: string[] } | null {
  if (command.length === 0) return null;
  if (Buffer.byteLength(command, "utf8") > MAX_EXEC_REWRITE_COMMAND_BYTES) return null;
  if (/[^\S ]/.test(command) || command !== command.trim()) return null;
  const tokens = command.split(" ");
  if (tokens.length > MAX_EXEC_REWRITE_TOKENS || tokens.some((t) => t.length === 0)) return null;
  if (!tokens.every(isSafeToken)) return null;
  if (tokens.some((t) => MEGA_LAUNCHERS.has(basenameOf(t).toLowerCase()))) return null;

  const program = tokens[0] ?? "";
  if (tokens.includes("--watch")) return null;
  if (WATCH_W_PROGRAMS.has(program) && tokens.includes("-w")) return null;
  if (program === "vitest" && tokens[1] === "watch") return null;

  if (program === "go") {
    if (tokens[1] !== "test") return null;
  } else if (program === "cargo") {
    if (!CARGO_ALLOWED.has(tokens[1] ?? "")) return null;
  } else if (program === "git") {
    if (!GIT_READONLY.has(tokens[1] ?? "")) return null;
  } else if (!PLAIN_PROGRAMS.has(program)) {
    return null;
  }
  if (program === "find" && tokens.some((t) => FIND_MUTATORS.has(t))) return null;

  return { command: program, args: tokens.slice(1) };
}
```

- [ ] GREEN: `pnpm --filter @megasaver/cli exec vitest run test/hooks/exec-rewrite-command.test.ts` — all pass.
- [ ] Commit: `feat(cli): exec-rewrite classifier grammar`

---

### Task 2: Connector install surface (guard-trio model)

**Files:**
- Create: none
- Modify: `packages/connectors/claude-code/src/hook-settings.ts`, `packages/connectors/claude-code/src/index.ts` (only if the new symbols are not covered by an existing `export *`; check first)
- Test: `packages/connectors/claude-code/test/hook-settings.test.ts`, `packages/connectors/claude-code/test/public-export.test.ts`

**Interfaces:**
- Consumes: existing module internals — `CommandHook`, `SettingsObject`, `subcommandOf`, `repairEntry`, `stripCommand`, `pruneHooks`, `timeoutFor` (hook-settings.ts:201-203), `buildHookCommand` (hook-settings.ts:35-44), `writeSettingsFile`.
- Produces (all from `@megasaver/connector-claude-code`):
  - `export const EXEC_REWRITE_HOOK_COMMAND = "mega hooks exec-rewrite"`
  - `export const EXEC_REWRITE_HOOK_MATCHER = "^Bash$"`
  - `export function hasExecRewriteHook(settings: unknown, command: string): boolean`
  - `export function addExecRewriteHook(settings: unknown, command: string): SettingsObject`
  - `export function removeExecRewriteHook(settings: unknown, command: string): SettingsObject`
  - `buildHookCommand` subcommand union widened: `"log" | "saver" | "intent" | "warmup" | "guard" | "cache-advice" | "exec-rewrite"`
  - `InstallClaudeCodeHookInput` (hook-settings.ts:524) gains `execRewrite?: boolean` — TRI-STATE: `true` adds, `false` removes, `undefined` preserves current state (differs from `warmup`/`guard`, which default-add)
  - `ClaudeCodeHookStatus` gains `execRewriteInstalled: boolean`

**Steps:**

- [ ] Write failing tests. Mimic the `describe("guard hook", …)` block (hook-settings.test.ts:312-350) and the install-path tests that read back the written temp `settings.json`:

```ts
// append to packages/connectors/claude-code/test/hook-settings.test.ts
describe("exec-rewrite hook", () => {
  it("adds its own PreToolUse entry with matcher ^Bash$ and timeout 10", () => {
    const next = addExecRewriteHook({}, EXEC_REWRITE_HOOK_COMMAND) as {
      hooks: {
        PreToolUse: Array<{ matcher?: string; hooks?: Array<Record<string, unknown>> }>;
      };
    };
    expect(next.hooks.PreToolUse[0]?.matcher).toBe(EXEC_REWRITE_HOOK_MATCHER);
    expect(next.hooks.PreToolUse[0]?.hooks?.[0]).toEqual({
      type: "command",
      command: EXEC_REWRITE_HOOK_COMMAND,
      timeout: 10,
    });
  });

  it("has/add/remove round-trips without touching other PreToolUse entries", () => {
    const withGuard = addGuardHook({}, GUARD_HOOK_COMMAND);
    expect(hasExecRewriteHook(withGuard, EXEC_REWRITE_HOOK_COMMAND)).toBe(false);
    const added = addExecRewriteHook(withGuard, EXEC_REWRITE_HOOK_COMMAND);
    expect(hasExecRewriteHook(added, EXEC_REWRITE_HOOK_COMMAND)).toBe(true);
    const removed = removeExecRewriteHook(added, EXEC_REWRITE_HOOK_COMMAND);
    expect(hasExecRewriteHook(removed, EXEC_REWRITE_HOOK_COMMAND)).toBe(false);
    expect(hasGuardHook(removed, GUARD_HOOK_COMMAND)).toBe(true);
  });

  it("install tri-state: true adds, absent preserves, false removes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mega-hooks-"));
    const settingsPath = join(dir, "settings.json");
    installClaudeCodeHook({ settingsPath, execRewrite: true });
    let written = JSON.parse(await readFile(settingsPath, "utf8"));
    expect(hasExecRewriteHook(written, EXEC_REWRITE_HOOK_COMMAND)).toBe(true);
    installClaudeCodeHook({ settingsPath }); // absent → preserved
    written = JSON.parse(await readFile(settingsPath, "utf8"));
    expect(hasExecRewriteHook(written, EXEC_REWRITE_HOOK_COMMAND)).toBe(true);
    installClaudeCodeHook({ settingsPath, execRewrite: false });
    written = JSON.parse(await readFile(settingsPath, "utf8"));
    expect(hasExecRewriteHook(written, EXEC_REWRITE_HOOK_COMMAND)).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });

  it("uninstall removes the exec-rewrite entry; status reports it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mega-hooks-"));
    const settingsPath = join(dir, "settings.json");
    installClaudeCodeHook({ settingsPath, execRewrite: true });
    expect(readClaudeCodeHookStatus({ settingsPath }).execRewriteInstalled).toBe(true);
    uninstallClaudeCodeHook({ settingsPath });
    const written = JSON.parse(await readFile(settingsPath, "utf8"));
    expect(hasExecRewriteHook(written, EXEC_REWRITE_HOOK_COMMAND)).toBe(false);
    expect(readClaudeCodeHookStatus({ settingsPath }).execRewriteInstalled).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });
});
```

- [ ] RED: `pnpm --filter @megasaver/connector-claude-code exec vitest run test/hook-settings.test.ts` — expected failure: `addExecRewriteHook`/`EXEC_REWRITE_HOOK_COMMAND` are not exported.
- [ ] Implement in `hook-settings.ts`:
  - Constants next to the guard pair (hook-settings.ts:18-23): `EXEC_REWRITE_HOOK_COMMAND = "mega hooks exec-rewrite"`, `EXEC_REWRITE_HOOK_MATCHER = "^Bash$"` with a WHY comment (own auditable, independently-removable entry — LD1; anchored like the sibling matchers).
  - Trio `hasExecRewriteHook`/`addExecRewriteHook`/`removeExecRewriteHook`: copy the guard trio bodies (hook-settings.ts:453-484) substituting `EXEC_REWRITE_HOOK_MATCHER`. The subcommand-keyed `entryMatchesSubcommand`/`repairEntry` machinery already isolates entries per subcommand — `cache-advice` proves the dashed-subcommand path works.
  - Widen `buildHookCommand`'s subcommand union with `"exec-rewrite"` (hook-settings.ts:35); `timeoutFor` already yields 10 for it (hook-settings.ts:201-203) — no change.
  - NO export of `quoteForPosixShell` (LD10 — the hook runner quotes nothing; non-SAFE_TOKEN paths decline).
  - `installClaudeCodeHook` (hook-settings.ts:540): after the cacheAdvice block insert the tri-state — `if (input.execRewrite === true) next = addExecRewriteHook(next, buildHookCommand("exec-rewrite", cfg)); else if (input.execRewrite === false) next = removeExecRewriteHook(next, buildHookCommand("exec-rewrite", cfg));` (undefined touches nothing; the JSON-diff no-op check at the bottom keeps `changed` honest).
  - `uninstallClaudeCodeHook` (hook-settings.ts:568): add `!hasExecRewriteHook(existing, EXEC_REWRITE_HOOK_COMMAND)` to the no-op conjunction and `next = removeExecRewriteHook(next, EXEC_REWRITE_HOOK_COMMAND);` to the removal chain.
  - `ClaudeCodeHookStatus` + `readClaudeCodeHookStatus` (fields read at hook-settings.ts:621-624): add `execRewriteInstalled` to the type, the catch-fallback object, and the computed return. `connected` stays `pre && post && intent`.
- [ ] Update `public-export.test.ts` (it pins the sorted export list of `dist/index.js`, lines 12-30): add `"EXEC_REWRITE_HOOK_COMMAND"`, `"EXEC_REWRITE_HOOK_MATCHER"`, `"addExecRewriteHook"`, `"hasExecRewriteHook"`, `"removeExecRewriteHook"` in sorted position (NOT `quoteForPosixShell` — it stays internal, LD10). Note: this test imports `../dist/index.js` — run `pnpm --filter @megasaver/connector-claude-code build` before the test run.
- [ ] GREEN: `pnpm --filter @megasaver/connector-claude-code build && pnpm --filter @megasaver/connector-claude-code test`.
- [ ] Commit: `feat(connector): exec-rewrite hook trio`

---

### Task 3: Origin thread — context-gate → stats event → daemon schema

**Files:**
- Create: `packages/context-gate/test/record-output-origin.test.ts`
- Modify: `packages/stats/src/event.ts`, `packages/context-gate/src/record-output.ts`, `packages/daemon/src/handlers.ts`
- Test: `packages/stats/test/event.test.ts`, `packages/context-gate/test/record-output-origin.test.ts`, `packages/daemon/test/handlers.test.ts`

**Interfaces:**
- Consumes: `overlayTokenSaverEventSchema` (`.strict()`, packages/stats/src/event.ts:72-100); `RecordOverlayOutputInput` (packages/context-gate/src/record-output.ts:91-128, re-exported by core via packages/core/src/context-gate.ts:19 — type flows automatically, no core edit); `excerptRequestSchema` (`.strict()`, packages/daemon/src/handlers.ts:23-46); the `...rest` forwarding in both `makeRecord` (apps/cli/src/hooks/saver-run.ts:117-121) and `excerptHandler` (handlers.ts:53-66), which carries any new field with NO code change.
- Produces:
  - `RecordOverlayOutputInput.origin?: "exec-rewrite"` (context-gate)
  - `overlayTokenSaverEventSchema` field `origin: z.enum(["exec-rewrite"]).optional()` (stats; appended LAST in the object — enum/field order is a contract, additions are append-only)
  - `excerptRequestSchema` field `origin: z.enum(["exec-rewrite"]).optional()` (daemon)

**Steps:**

- [ ] Write failing stats test (append to `packages/stats/test/event.test.ts`, mimicking its `safeParse` style, event.test.ts:26-45; build on the file's existing valid overlay-event fixture):

```ts
describe("overlayTokenSaverEventSchema origin (exec-rewrite)", () => {
  it("accepts origin: exec-rewrite", () => {
    const r = overlayTokenSaverEventSchema.safeParse({ ...validOverlayEvent, origin: "exec-rewrite" });
    expect(r.success).toBe(true);
  });
  it("rejects unknown origin values", () => {
    const r = overlayTokenSaverEventSchema.safeParse({ ...validOverlayEvent, origin: "post-tool-use" });
    expect(r.success).toBe(false);
  });
  it("still parses pre-wave-2 rows without origin", () => {
    expect(overlayTokenSaverEventSchema.safeParse(validOverlayEvent).success).toBe(true);
  });
});
```

  (Use the file's existing valid overlay fixture name; if none exists, construct one from the schema fields at event.ts:72-100.)
- [ ] Write failing context-gate test `packages/context-gate/test/record-output-origin.test.ts`: real temp store (mkdtempSync, pattern of apps/cli/test/hooks/saver-run.test.ts:31-55 — `encodeWorkspaceKey`, ~50 KB `LARGE_RAW` to force a compressed decision), call `recordAndFilterOverlayOutput({ ...base, storeRawOutput: true, origin: "exec-rewrite" })`, then read `<store>/stats/<workspaceKey>/<liveSessionId>.events.jsonl` (path per packages/stats/src/store.ts:215) with `readFileSync`, `JSON.parse` the last line, and assert `origin === "exec-rewrite"`. Second case: same call WITHOUT `origin` → parsed event has no `origin` key (absent-field back-compat).
- [ ] Write failing daemon test (append to `packages/daemon/test/handlers.test.ts`, following its existing `excerptHandler` cases): POST body including `origin: "exec-rewrite"` → status 200 (schema accepts); the forwarding needs no assertion beyond the context-gate test because `origin` rides the `...rest` spread (handlers.ts:53-66).
- [ ] RED: `pnpm --filter @megasaver/stats test`, `pnpm --filter @megasaver/context-gate exec vitest run test/record-output-origin.test.ts`, `pnpm --filter @megasaver/daemon exec vitest run test/handlers.test.ts` — stats/daemon fail on strict-schema rejection of `origin`; context-gate fails on the missing input field (TS error) / missing event field.
- [ ] Implement:
  - `packages/stats/src/event.ts`: append to the overlay object literal (after `chunksStored`) — `// Wave-2 exec-rewrite (LD8): which delivery path produced this event. Absent = PostToolUse saver path and every pre-wave-2 row.` `origin: z.enum(["exec-rewrite"]).optional(),`
  - `packages/context-gate/src/record-output.ts`: add `origin?: "exec-rewrite";` to `RecordOverlayOutputInput` (after `includeFooter`, record-output.ts:125) and thread it into the `appendOverlayEvent` event literal (record-output.ts:434-455): `...(input.origin !== undefined ? { origin: input.origin } : {}),`
  - `packages/daemon/src/handlers.ts`: add `origin: z.enum(["exec-rewrite"]).optional(),` to `excerptRequestSchema` (handlers.ts:23-46). No handler-body change — `origin` is not destructured out, so `...rest` forwards it.
- [ ] GREEN: re-run the three package test commands above; then `pnpm --filter @megasaver/cli test` once — if `apps/cli/test/enum-pin-audit.test.ts` pins the overlay schema shape, extend its pin (append-only) in this same commit.
- [ ] Commit: `feat(stats): thread exec-rewrite origin`

---

### Task 4: PostToolUse saver exemption for exec-live (LD12)

> Replaces the original Task 4 (`splitOverlayEventsByOrigin` stats selector) —
> DEFERRED by architect YAGNI cut 2026-08-13: no consumer can call it (CLI may
> not import `@megasaver/stats`; no core re-export allowed). `origin` still
> ships as honest data; the selector lands with the UI/dashboard wave.

**Files:**
- Modify: `apps/cli/src/hooks/saver.ts`
- Test: `apps/cli/test/hooks/saver.test.ts` (or the file hosting the C13 exemption cases)

**Interfaces:**
- Consumes: the saver decide path's C13 passthrough exemption
  (apps/cli/src/hooks/saver.ts:337-344, `/\bmega\s+output\s+chunk\b/`).
- Produces: exec-live invocations classified PASSTHROUGH — no second
  compression, no footer-on-footer, one overlay event (LD12; architect
  F1 regression).

**Steps:**

- [ ] Write the failing test: drive the saver decide path with a
  `mega output exec-live --live-session <sid> -- vitest run` command
  string → expect PASSTHROUGH decision (no record call, no
  updatedToolOutput), mirroring the existing `mega output chunk`
  exemption cases.
- [ ] RED: `pnpm --filter @megasaver/cli exec vitest run <saver test file>` — expected: exec-live command currently reaches the record path.
- [ ] Implement: extend the C13 regex at saver.ts:343 to
  `/\bmega\s+output\s+(?:chunk|exec-live)\b/`. WHY comment: exec-live
  output is already the compressed first-seen version — re-compressing
  it is the exact churn this feature eliminates.
- [ ] GREEN: same file; then `pnpm --filter @megasaver/cli test`.
- [ ] Commit: `fix(cli): saver exempts exec-live invocations`

---

### Task 5: `mega output exec-live` (LD3/LD4/LD6/LD7)

**Files:**
- Create: `apps/cli/src/commands/output/exec-live.ts`
- Modify: `apps/cli/src/commands/output/index.ts` (register + re-export)
- Modify: `packages/context-gate/src/run-command.ts` (make `runChild`'s `spawn` optional; real-spawn default becomes core-owned)
- Test: `apps/cli/test/output/exec-live.test.ts`

**Interfaces:**
- Consumes:
  - `runChild(input: { spawn?; command; args; cwd; originPid; timeoutMs; maxBytes }): Promise<SpawnOutcome>` (`spawn` becomes optional in this task — see the run-command.ts step below; the real-spawn default lives inside core, never in the CLI), `type RunCommandSpawn`, `type SpawnOutcome`, `type Capture = { raw: string; terminated?: "timeout" | "max_bytes"; childExitCode: number | null }` — `@megasaver/context-gate` (run-command.ts:62, 102-127; exported via context-gate index.ts:12-18)
  - `resolveWorkspaceTokenSaverSettings` / `nodeResolverDeps` — `@megasaver/context-gate` (resolve-saver-settings.ts:68, 232; `.enabled`/`.mode` per lines 24-26)
  - `makeRecord(storeRoot: string)` — `../../hooks/saver-run.js` (saver-run.ts:150-181; daemon-first, in-process fallback, never throws)
  - `readSessionIntent(storeRoot, workspaceKey, sessionId?)` — `../../hooks/intent-run.js` (intent-run.ts:87-97)
  - `minBytesFor(tool: string, mode: TokenSaverMode)` — `../../hooks/saver.js` (saver.ts:64)
  - `encodeWorkspaceKey(cwd)` — `@megasaver/shared` (workspace-key.ts:20)
  - `type RecordOverlayOutputInput` / `type RecordOverlayOutputResult` — `@megasaver/core` (core/src/context-gate.ts:19; CLI convention — record types via core, not context-gate)
  - `resolveStorePath` / `readStoreEnv` — `../../store.js` (usage pattern exec.ts:67-81, 213)
- Produces:
  - `export type RunOutputExecLiveInput = { liveSessionId: string; command: string; args: readonly string[]; storeFlag: string | undefined; cwd: string; home: string; xdgDataHome: string | undefined; platform: NodeJS.Platform; localAppData: string | undefined; originPid: string; stdout: (text: string) => void; stderr: (line: string) => void; timeoutSec?: number; maxBytes?: number; spawn?: RunCommandSpawn; runChildImpl?: typeof runChild; record?: (input: RecordOverlayOutputInput) => Promise<RecordOverlayOutputResult>; }`
  - `export async function runOutputExecLive(input: RunOutputExecLiveInput): Promise<number>`
  - `export function execLiveCommandFromPositionals(positionals: readonly unknown[]): { command: string; commandArgs: string[] }`
  - `export const outputExecLiveCommand` (citty), registered as `exec-live` in `outputCommand.subCommands` (output/index.ts:34-43)

**Steps:**

- [ ] Write failing tests `apps/cli/test/output/exec-live.test.ts`. Harness: injected `runChildImpl` + `record` (no real spawn, no FakeChild needed), temp store via `mkdtempSync`, injected `stdout`/`stderr` collectors (cli-test-pattern; store seeding via `writeExactRecord` exactly as packages/context-gate/test/resolve-saver-settings.test.ts:43-49 — a temp non-git cwd hits the v1-exact precedence step):

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeExactRecord } from "@megasaver/context-gate";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  execLiveCommandFromPositionals,
  runOutputExecLive,
} from "../../src/commands/output/exec-live.js";

let store: string;
let cwd: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "mega-execlive-store-"));
  cwd = mkdtempSync(join(tmpdir(), "mega-execlive-cwd-"));
});
afterEach(() => {
  rmSync(store, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

const RAW = "line one\nline two"; // no trailing newline — passthrough must not add one
const SID = "live-abc-1";

function enableWorkspace(): void {
  writeExactRecord(store, encodeWorkspaceKey(cwd), {
    enabled: true,
    mode: "balanced",
    scope: "exact",
  });
}

function baseInput(overrides: Partial<Parameters<typeof runOutputExecLive>[0]> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  return {
    input: {
      liveSessionId: SID,
      command: "vitest",
      args: ["run"] as const,
      storeFlag: store,
      cwd,
      home: "/home/test",
      xdgDataHome: undefined,
      platform: "linux" as NodeJS.Platform,
      localAppData: undefined,
      originPid: "123",
      stdout: (t: string) => out.push(t),
      stderr: (l: string) => err.push(l),
      runChildImpl: vi.fn(async () => ({
        ok: true as const,
        capture: { raw: RAW, childExitCode: 0 },
      })),
      ...overrides,
    },
    out,
    err,
  };
}

describe("runOutputExecLive", () => {
  it("delivers raw byte-identical on a non-compressed decision", async () => {
    enableWorkspace();
    const record = vi.fn(async () => ({
      decision: "passthrough" as const,
      summary: "",
      returnedText: RAW,
      rawBytes: RAW.length,
      returnedBytes: RAW.length,
      bytesSaved: 0,
      savingRatio: 0,
      deltaBytes: 0,
    }));
    const { input, out } = baseInput({ record });
    const code = await runOutputExecLive(input);
    expect(out.join("")).toBe(RAW); // exact bytes, no added newline
    expect(code).toBe(0);
  });

  it("delivers returnedText on compressed and sets the LD7/LD8 record fields", async () => {
    enableWorkspace();
    const record = vi.fn(async () => ({
      decision: "compressed" as const,
      summary: "s",
      returnedText: "COMPRESSED+FOOTER",
      rawBytes: RAW.length,
      returnedBytes: 17,
      bytesSaved: RAW.length - 17,
      savingRatio: 0.5,
      deltaBytes: RAW.length - 17,
    }));
    const { input, out } = baseInput({ record });
    await runOutputExecLive(input);
    expect(out.join("")).toBe("COMPRESSED+FOOTER");
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        storeRawOutput: true,
        includeFooter: true,
        origin: "exec-rewrite",
        sourceKind: "command",
        label: "vitest run",
        mode: "balanced",
        workspaceKey: encodeWorkspaceKey(cwd),
        liveSessionId: SID,
      }),
    );
  });

  it("skips record and delivers raw when the workspace saver is disabled", async () => {
    const record = vi.fn();
    const { input, out } = baseInput({ record });
    const code = await runOutputExecLive(input);
    expect(record).not.toHaveBeenCalled();
    expect(out.join("")).toBe(RAW);
    expect(code).toBe(0);
  });

  it("LD6: a record throw degrades to raw with the child exit mirrored", async () => {
    enableWorkspace();
    const record = vi.fn(async () => {
      throw new Error("store exploded");
    });
    const { input, out } = baseInput({
      record,
      runChildImpl: vi.fn(async () => ({
        ok: true as const,
        capture: { raw: RAW, childExitCode: 3 },
      })),
    });
    const code = await runOutputExecLive(input);
    expect(out.join("")).toBe(RAW);
    expect(code).toBe(3);
  });

  it("mirrors a non-zero child exit with a stderr note", async () => {
    const { input, err } = baseInput({
      runChildImpl: vi.fn(async () => ({
        ok: true as const,
        capture: { raw: RAW, childExitCode: 2 },
      })),
    });
    const code = await runOutputExecLive(input);
    expect(code).toBe(2);
    expect(err).toContain("note: command exited 2");
  });

  it("terminated: delivers the partial, notes it on stderr, exits 1", async () => {
    const { input, out, err } = baseInput({
      runChildImpl: vi.fn(async () => ({
        ok: true as const,
        capture: { raw: "partial", childExitCode: null, terminated: "timeout" as const },
      })),
    });
    const code = await runOutputExecLive(input);
    expect(out.join("")).toBe("partial");
    expect(err).toContain("error: command_failed: terminated: timeout");
    expect(code).toBe(1);
  });

  it("spawn failure: command_failed detail on stderr, exit 1, no stdout", async () => {
    const { input, out, err } = baseInput({
      runChildImpl: vi.fn(async () => ({
        ok: false as const,
        reason: "command_failed" as const,
        detail: "spawn vitest ENOENT",
      })),
    });
    const code = await runOutputExecLive(input);
    expect(out).toEqual([]);
    expect(err).toContain("error: command_failed: spawn vitest ENOENT");
    expect(code).toBe(1);
  });

  it("unsafe live session id degrades to raw without recording", async () => {
    enableWorkspace();
    const record = vi.fn();
    const { input, out } = baseInput({ record, liveSessionId: "../evil" });
    await runOutputExecLive(input);
    expect(record).not.toHaveBeenCalled();
    expect(out.join("")).toBe(RAW);
  });

  it("LD13: non-allowlisted positionals are refused — no spawn, exit 1", async () => {
    const runChildImpl = vi.fn();
    const { input, out, err } = baseInput({
      runChildImpl,
      command: "pnpm",
      args: ["test"],
    });
    const code = await runOutputExecLive(input);
    expect(runChildImpl).not.toHaveBeenCalled();
    expect(out).toEqual([]);
    expect(err).toContain("error: refused: command not allowlisted");
    expect(code).toBe(1);
  });

  it("LD14: identical re-runs mint the same content-derived chunk-set id", async () => {
    enableWorkspace();
    const record = vi.fn(async () => ({
      decision: "compressed" as const,
      summary: "s",
      returnedText: "X",
      rawBytes: RAW.length,
      returnedBytes: 1,
      bytesSaved: RAW.length - 1,
      savingRatio: 0.5,
      deltaBytes: 0,
    }));
    await runOutputExecLive(baseInput({ record }).input);
    await runOutputExecLive(baseInput({ record }).input);
    const first = record.mock.calls[0]?.[0] as { newId?: () => string };
    const second = record.mock.calls[1]?.[0] as { newId?: () => string };
    expect(typeof first.newId).toBe("function");
    expect(first.newId?.()).toBe(second.newId?.());
    expect(first.newId?.()).toMatch(/^cs-[0-9a-f]{32}$/);
  });

  it("LD15: runChildImpl receives the 100MB default maxBytes and 600s timeout", async () => {
    const runChildImpl = vi.fn(async () => ({
      ok: true as const,
      capture: { raw: RAW, childExitCode: 0 },
    }));
    await runOutputExecLive(baseInput({ runChildImpl }).input);
    expect(runChildImpl).toHaveBeenCalledWith(
      expect.objectContaining({ maxBytes: 100_000_000, timeoutMs: 600_000 }),
    );
  });
});

describe("execLiveCommandFromPositionals", () => {
  it("takes the first post-`--` token as the command", () => {
    expect(execLiveCommandFromPositionals(["vitest", "run", "--reporter", "dot"])).toEqual({
      command: "vitest",
      commandArgs: ["run", "--reporter", "dot"],
    });
  });
  it("yields an empty command for no tokens", () => {
    expect(execLiveCommandFromPositionals([])).toEqual({ command: "", commandArgs: [] });
  });
});
```

- [ ] RED: `pnpm --filter @megasaver/cli exec vitest run test/output/exec-live.test.ts` — expected: module not found.
- [ ] Make the real-spawn default core-owned so exec-live never imports `node:child_process` (apps/cli/test/output/no-child-process.test.ts scans EVERY `.ts` file in `apps/cli/src/commands/output/` and asserts the source contains no `child_process` substring and no `spawn(`/`exec*(` call site — a blanket ban with no module list and no exemption mechanism): in `packages/context-gate/src/run-command.ts`, change `runChild`'s input field `spawn: RunCommandSpawn` to `spawn?: RunCommandSpawn` and open the function body with `const spawn = input.spawn ?? nodeSpawn;`, switching the single call site (`input.spawn(...)`, run-command.ts:131) to `spawn(...)`. The two internal callers (run-command.ts:231-233 and 526-528) already pass a resolved `spawn` value, so they stay valid unchanged. Guard: `pnpm --filter @megasaver/context-gate test` stays green.
- [ ] Implement `apps/cli/src/commands/output/exec-live.ts`:

```ts
import { createHash } from "node:crypto";
import type { RecordOverlayOutputInput, RecordOverlayOutputResult } from "@megasaver/core";
import {
  type RunCommandSpawn,
  nodeResolverDeps,
  resolveWorkspaceTokenSaverSettings,
  runChild,
} from "@megasaver/context-gate";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { defineCommand } from "citty";
import { readSessionIntent } from "../../hooks/intent-run.js";
import { minBytesFor } from "../../hooks/saver.js";
import { makeRecord } from "../../hooks/saver-run.js";
import { classifyExecRewrite } from "../../hooks/exec-rewrite-command.js";
import { readStoreEnv, resolveStorePath } from "../../store.js";

const DEFAULT_TIMEOUT_SEC = 600; // LD11: >= Claude Code Bash tool max — the tool's own timeout stays the governing bound
const DEFAULT_MAX_BYTES = 100_000_000; // LD15: kill-vs-truncate deviation documented in spec
// intent-run.ts SAFE_SEGMENT: path-safe live session ids only.
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export type RunOutputExecLiveInput = {
  liveSessionId: string;
  command: string;
  args: readonly string[];
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  originPid: string;
  // Raw text sink — implementations must NOT append a newline (byte parity).
  stdout: (text: string) => void;
  stderr: (line: string) => void;
  timeoutSec?: number;
  maxBytes?: number;
  spawn?: RunCommandSpawn;
  runChildImpl?: typeof runChild;
  record?: (input: RecordOverlayOutputInput) => Promise<RecordOverlayOutputResult>;
};

export function execLiveCommandFromPositionals(positionals: readonly unknown[]): {
  command: string;
  commandArgs: string[];
} {
  const rest = positionals.map(String);
  return { command: rest[0] ?? "", commandArgs: rest.slice(1) };
}

// LD6 semantics-parity invariant: the child ALWAYS runs and its exit code is
// ALWAYS mirrored; everything mega-internal (store resolve, settings, record,
// daemon) sits inside one try/catch whose fallback is raw byte-identical
// delivery. The rewrite may improve delivery, never behavior.
export async function runOutputExecLive(input: RunOutputExecLiveInput): Promise<number> {
  // LD13: the flat-token allowlist is a structural invariant of THIS delivery
  // path, not a caller honor-system — runChild performs no policy check.
  const classified = classifyExecRewrite([input.command, ...input.args].join(" "));
  if (classified === null) {
    input.stderr("error: refused: command not allowlisted");
    return 1;
  }
  const run = input.runChildImpl ?? runChild;
  // No node:child_process here: runChild defaults its own spawn (core-owned).
  // Conditional spread, not `spawn: input.spawn` — exactOptionalPropertyTypes
  // rejects an explicit undefined (exec.ts:110 precedent).
  const outcome = await run({
    ...(input.spawn !== undefined ? { spawn: input.spawn } : {}),
    command: input.command,
    args: input.args,
    cwd: input.cwd,
    originPid: input.originPid,
    timeoutMs: (input.timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1_000,
    maxBytes: input.maxBytes ?? DEFAULT_MAX_BYTES,
  });
  if (!outcome.ok) {
    input.stderr(`error: command_failed: ${outcome.detail}`);
    return 1;
  }
  const { raw, terminated, childExitCode } = outcome.capture;

  let delivered = raw;
  try {
    if (SAFE_SEGMENT.test(input.liveSessionId)) {
      const storeRoot = resolveStorePath({
        storeFlag: input.storeFlag,
        cwd: input.cwd,
        home: input.home,
        xdgDataHome: input.xdgDataHome,
        platform: input.platform,
        localAppData: input.localAppData,
      });
      const settings = resolveWorkspaceTokenSaverSettings(storeRoot, input.cwd, nodeResolverDeps());
      if (settings.enabled) {
        const workspaceKey = encodeWorkspaceKey(input.cwd);
        const record = input.record ?? makeRecord(storeRoot);
        const intent = readSessionIntent(storeRoot, workspaceKey, input.liveSessionId);
        const result = await record({
          storeRoot,
          evidenceStoreRoot: storeRoot,
          workspaceKey,
          liveSessionId: input.liveSessionId,
          raw,
          sourceKind: "command",
          label: [input.command, ...input.args].join(" "),
          mode: settings.mode,
          storeRawOutput: true, // LD7 failure-tee: this path replaced the only copy
          includeFooter: true, // F30 recovery footer, accounted inside record
          compressFloorBytes: minBytesFor("Bash", settings.mode),
          origin: "exec-rewrite", // LD8 honest stats
          newId: () => `cs-${createHash("sha256").update(raw).digest("hex").slice(0, 32)}`, // LD14: identical re-runs mint the same chunk-set id (saver.ts:425 pattern)
          ...(intent !== undefined ? { intent } : {}),
        });
        // Non-compressed decisions already return the raw byte-identical
        // (record-output.ts:260-271); pin `raw` locally so a drift there can
        // never change what the agent receives.
        if (result.decision === "compressed") delivered = result.returnedText;
      }
    }
  } catch {
    delivered = raw; // LD6 parity fallback
  }

  input.stdout(delivered);
  if (terminated !== undefined) {
    input.stderr(`error: command_failed: terminated: ${terminated}`);
    return 1;
  }
  const exitCode = childExitCode ?? 0;
  if (exitCode !== 0) input.stderr(`note: command exited ${exitCode}`);
  return exitCode;
}

export const outputExecLiveCommand = defineCommand({
  meta: {
    name: "exec-live",
    description: "Run a rewritten agent command and deliver filtered output (hook target).",
  },
  args: {
    "live-session": {
      type: "string",
      required: true,
      description: "Live session id from the PreToolUse payload.",
    },
    store: { type: "string", description: "Override store directory." },
    timeout: { type: "string", description: "Max child wall-clock seconds (default 600; hook threads the tool's own timeout)." },
    "max-bytes": { type: "string", description: "Max bytes of child output captured." },
  },
  async run({ args }) {
    // ASSUMPTION: with no named positionals defined, citty's args._ is exactly
    // the post-`--` token list (exec.ts:18-24 documents that consumed
    // positionals ALSO land in _, which is why exec reads [1]; here there are
    // none, so [0] is the command). Covered by execLiveCommandFromPositionals
    // unit tests; verify once against a real `mega output exec-live` run in
    // the Task 8 smoke.
    const { command, commandArgs } = execLiveCommandFromPositionals(args._ ?? []);
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    const inherited = process.env["MEGASAVER_ORIGIN_PID"];
    const timeoutSec = typeof args.timeout === "string" ? Number(args.timeout) : undefined;
    const maxBytesArg =
      typeof args["max-bytes"] === "string" ? Number(args["max-bytes"]) : undefined;
    const code = await runOutputExecLive({
      liveSessionId: typeof args["live-session"] === "string" ? args["live-session"] : "",
      command,
      args: commandArgs,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      originPid: inherited && inherited !== "" ? inherited : String(process.pid),
      stdout: (text) => process.stdout.write(text), // write(), no added newline
      stderr: (line) => console.error(line),
      ...(timeoutSec !== undefined && Number.isFinite(timeoutSec) ? { timeoutSec } : {}),
      ...(maxBytesArg !== undefined && Number.isFinite(maxBytesArg)
        ? { maxBytes: maxBytesArg }
        : {}),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] Register in `apps/cli/src/commands/output/index.ts`: import `outputExecLiveCommand`, add re-export block `export { type RunOutputExecLiveInput, runOutputExecLive, outputExecLiveCommand } from "./exec-live.js";`, and add `"exec-live": outputExecLiveCommand` to `subCommands` (output/index.ts:34-43).
- [ ] GREEN: `pnpm --filter @megasaver/cli exec vitest run test/output/exec-live.test.ts`; also run `pnpm --filter @megasaver/cli exec vitest run test/output/no-child-process.test.ts` — that suite is a blanket directory scan (every `apps/cli/src/commands/output/*.ts`, no pinned module list, no exemption hook) asserting no `child_process` substring and no `spawn(`/`exec*(` call sites. exec-live.ts passes because the run-command.ts step above moved the real-spawn default into core; there is nothing to add or justify in the suite itself.
- [ ] Commit: `feat(cli): mega output exec-live delivery`

---

### Task 6: Hook runner + `mega hooks exec-rewrite` subcommand

**Files:**
- Create: `apps/cli/src/hooks/exec-rewrite-run.ts`, `apps/cli/src/commands/hooks/exec-rewrite.ts`
- Modify: `apps/cli/src/commands/hooks/index.ts` (register + re-export)
- Test: `apps/cli/test/hooks/exec-rewrite-run.test.ts`

**Interfaces:**
- Consumes:
  - `classifyExecRewrite` (Task 1)
  - `resolveWorkspaceTokenSaverSettings` / `nodeResolverDeps` — `@megasaver/context-gate` (LD9 gate b)
  - LD10 SAFE_TOKEN gate: launcher + store path are shell-inert or the rewrite declines — NO connector import, NO shell quoting
  - `resolveStorePath` / `readStoreEnv` — `../store.js`; `resolveInvokedCliPath` — `../commands/hooks/install.js` (install.ts:31-39; hooks→commands import precedent: guard-run.ts:22 imports `../commands/warmup.js`)
  - PreToolUse payload shape `{ session_id, cwd, tool_name, tool_input }` `.passthrough()` (guard-run.ts:27-34); SAFE_SEGMENT regex (intent-run.ts:35)
- Produces:
  - `export type BuildExecRewriteHookInput = { payload: unknown; storeRoot: string; cliPath?: string; storeFlag?: string }`
  - `export function buildExecRewriteHookOutput(input: BuildExecRewriteHookInput): string` — contract identical to `buildGuardHookOutput`: never throws, `""` on any failure (guard-run.ts:98-103); sync because no registry/store-ready is needed
  - `export function runExecRewriteHookFromProcess(storeFlag?: string): void` — mirror of guard-run.ts:240-252
  - `export const hooksExecRewriteCommand` (citty; mirror of apps/cli/src/commands/hooks/guard.ts:9-20), registered as `"exec-rewrite"` in `hooksCommand.subCommands`

**Steps:**

- [ ] Write failing tests `apps/cli/test/hooks/exec-rewrite-run.test.ts` (temp store + temp cwd; enablement via `writeExactRecord` as in Task 5):

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeExactRecord } from "@megasaver/context-gate";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildExecRewriteHookOutput } from "../../src/hooks/exec-rewrite-run.js";

let store: string;
let cwd: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "mega-rewrite-store-"));
  cwd = mkdtempSync(join(tmpdir(), "mega-rewrite-cwd-"));
  writeExactRecord(store, encodeWorkspaceKey(cwd), {
    enabled: true,
    mode: "balanced",
    scope: "exact",
  });
});
afterEach(() => {
  rmSync(store, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

const SID = "sess-1";
function payload(command: string, overrides: Record<string, unknown> = {}): unknown {
  return {
    session_id: SID,
    cwd,
    tool_name: "Bash",
    tool_input: { command },
    ...overrides,
  };
}

describe("buildExecRewriteHookOutput — rewrite", () => {
  it("emits updatedInput with the exec-live command and NO permissionDecision", () => {
    const out = buildExecRewriteHookOutput({ payload: payload("vitest run"), storeRoot: store });
    const parsed = JSON.parse(out) as {
      hookSpecificOutput: Record<string, unknown> & { updatedInput: { command: string } };
    };
    expect(parsed.hookSpecificOutput["hookEventName"]).toBe("PreToolUse");
    expect(parsed.hookSpecificOutput.updatedInput.command).toBe(
      `mega output exec-live --live-session ${SID} -- vitest run`,
    );
    expect("permissionDecision" in parsed.hookSpecificOutput).toBe(false); // LD2
  });

  it("LD2 full-replacement echo: unchanged tool_input fields survive", () => {
    const p = payload("vitest run", { tool_input: { command: "vitest run", description: "run unit tests" } });
    const out = buildExecRewriteHookOutput({ payload: p, storeRoot: store });
    const parsed = JSON.parse(out) as {
      hookSpecificOutput: { updatedInput: { command: string; description: string } };
    };
    expect(parsed.hookSpecificOutput.updatedInput.description).toBe("run unit tests");
    expect(parsed.hookSpecificOutput.updatedInput.command).toContain("output exec-live");
  });

  it("LD11: threads tool_input.timeout (ms) as --timeout seconds", () => {
    const p = payload("vitest run", { tool_input: { command: "vitest run", timeout: 125_000 } });
    const out = buildExecRewriteHookOutput({ payload: p, storeRoot: store });
    const parsed = JSON.parse(out) as {
      hookSpecificOutput: { updatedInput: { command: string } };
    };
    expect(parsed.hookSpecificOutput.updatedInput.command).toBe(
      `mega output exec-live --live-session ${SID} --timeout 125 -- vitest run`,
    );
  });

  it("bakes --store for a SAFE_TOKEN store path", () => {
    const out = buildExecRewriteHookOutput({
      payload: payload("git status"),
      storeRoot: store,
      storeFlag: store,
    });
    const cmd = (JSON.parse(out) as { hookSpecificOutput: { updatedInput: { command: string } } })
      .hookSpecificOutput.updatedInput.command;
    expect(cmd).toBe(
      `mega output exec-live --live-session ${SID} --store ${store} -- git status`,
    );
  });

  it("LD10: non-SAFE_TOKEN launcher path declines (no shell quoting ever)", () => {
    const out = buildExecRewriteHookOutput({
      payload: payload("git status"),
      storeRoot: store,
      cliPath: "/opt/My Tools/mega",
    });
    expect(out).toBe("");
  });

  it("LD10: non-SAFE_TOKEN store flag declines", () => {
    const out = buildExecRewriteHookOutput({
      payload: payload("git status"),
      storeRoot: store,
      storeFlag: "/tmp/my store dir",
    });
    expect(out).toBe("");
  });
});

describe("buildExecRewriteHookOutput — fail-open emits ''", () => {
  it("malformed payload emits ''", () => {
    expect(buildExecRewriteHookOutput({ payload: "not-an-object", storeRoot: store })).toBe("");
  });

  it("non-Bash tool emits ''", () => {
    const p = payload("vitest run", { tool_name: "Read" });
    expect(buildExecRewriteHookOutput({ payload: p, storeRoot: store })).toBe("");
  });

  it("missing command emits ''", () => {
    const p = { session_id: SID, cwd, tool_name: "Bash", tool_input: {} };
    expect(buildExecRewriteHookOutput({ payload: p, storeRoot: store })).toBe("");
  });

  it("classifier null (script runner) emits ''", () => {
    expect(buildExecRewriteHookOutput({ payload: payload("pnpm test"), storeRoot: store })).toBe("");
  });

  it("unsafe session_id emits ''", () => {
    const p = payload("vitest run", { session_id: "../evil" });
    expect(buildExecRewriteHookOutput({ payload: p, storeRoot: store })).toBe("");
  });

  it("disabled workspace emits ''", () => {
    const otherCwd = mkdtempSync(join(tmpdir(), "mega-rewrite-off-"));
    const p = payload("vitest run", { cwd: otherCwd });
    expect(buildExecRewriteHookOutput({ payload: p, storeRoot: store })).toBe("");
    rmSync(otherCwd, { recursive: true, force: true });
  });

  it("re-entry no-op: a rewritten command is never rewritten again", () => {
    const p = payload(`mega output exec-live --live-session ${SID} -- vitest run`);
    expect(buildExecRewriteHookOutput({ payload: p, storeRoot: store })).toBe("");
  });
});
```

- [ ] RED: `pnpm --filter @megasaver/cli exec vitest run test/hooks/exec-rewrite-run.test.ts` — expected: module not found.
- [ ] Implement `apps/cli/src/hooks/exec-rewrite-run.ts`:

```ts
import { readFileSync } from "node:fs";
import { nodeResolverDeps, resolveWorkspaceTokenSaverSettings } from "@megasaver/context-gate";
import { z } from "zod";
import { resolveInvokedCliPath } from "../commands/hooks/install.js";
import { readStoreEnv, resolveStorePath } from "../store.js";
import { classifyExecRewrite } from "./exec-rewrite-command.js";

const preToolUsePayloadSchema = z
  .object({
    session_id: z.string(),
    cwd: z.string(),
    tool_name: z.string(),
    tool_input: z.unknown(),
  })
  .passthrough();

// intent-run.ts SAFE_SEGMENT: the id is interpolated into a shell string and
// later into store paths — reject anything not path/shell-inert.
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

// LD10: the launcher and store paths are never shell-quoted; a path must be
// shell-inert (SAFE_TOKEN-class) or the rewrite declines entirely.
const SAFE_TOKEN = /^[A-Za-z0-9_./:@%+=,-]+$/;

export type BuildExecRewriteHookInput = {
  payload: unknown;
  storeRoot: string;
  cliPath?: string;
  storeFlag?: string;
};

// Contract identical to buildGuardHookOutput: NEVER throws — every failure
// returns "" so a PreToolUse hook can never break a tool call (the original
// command runs untouched).
export function buildExecRewriteHookOutput(input: BuildExecRewriteHookInput): string {
  try {
    const parsed = preToolUsePayloadSchema.safeParse(input.payload);
    if (!parsed.success) return "";
    const { session_id: sessionId, cwd, tool_name: tool } = parsed.data;
    if (tool !== "Bash") return "";
    if (!SAFE_SEGMENT.test(sessionId)) return "";
    const ti =
      typeof parsed.data.tool_input === "object" && parsed.data.tool_input !== null
        ? (parsed.data.tool_input as Record<string, unknown>)
        : {};
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    const command = ti["command"];
    if (typeof command !== "string" || command === "") return "";
    const classified = classifyExecRewrite(command);
    if (classified === null) return "";
    // LD9 gate (b): workspace saver enablement.
    const settings = resolveWorkspaceTokenSaverSettings(input.storeRoot, cwd, nodeResolverDeps());
    if (!settings.enabled) return "";
    // LD10: SAFE_TOKEN-only paths, decline otherwise (no quoting anywhere).
    const launcher = input.cliPath === undefined ? "mega" : input.cliPath;
    if (!SAFE_TOKEN.test(launcher)) return "";
    const storeFlag = input.storeFlag;
    if (storeFlag !== undefined && !SAFE_TOKEN.test(storeFlag)) return "";
    const store = storeFlag === undefined ? "" : ` --store ${storeFlag}`;
    // LD11: thread the tool's own timeout (ms) as the exec-live ceiling.
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    const toolTimeout = ti["timeout"];
    const timeout =
      typeof toolTimeout === "number" && Number.isFinite(toolTimeout) && toolTimeout > 0
        ? ` --timeout ${Math.ceil(toolTimeout / 1000)}`
        : "";
    // Tokens are SAFE_TOKEN-classed (LD5), the session id SAFE_SEGMENT-checked,
    // the launcher/store SAFE_TOKEN-gated — no injection surface beyond what
    // the agent already typed.
    const rewritten = `${launcher} output exec-live --live-session ${sessionId}${store}${timeout} -- ${[
      classified.command,
      ...classified.args,
    ].join(" ")}`;
    // LD2: updatedInput ONLY — never permissionDecision; the permission system
    // evaluates the rewritten command itself. FULL-REPLACEMENT contract: echo
    // every unchanged tool_input field (e.g. `description`) alongside the
    // rewritten command.
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: { ...ti, command: rewritten },
      },
    });
  } catch {
    return "";
  }
}

function readStdinSync(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

// Always exits 0; empty stdout on any failure (PreToolUse "no output" = no
// rewrite, tool call proceeds untouched). Wired by `mega hooks install`.
export function runExecRewriteHookFromProcess(storeFlag?: string): void {
  process.exitCode = 0;
  try {
    const raw = readStdinSync().trim();
    if (raw === "") return;
    const payload: unknown = JSON.parse(raw);
    const storeRoot = resolveStorePath(readStoreEnv(storeFlag));
    const cliPath = resolveInvokedCliPath(process.argv[1]);
    const text = buildExecRewriteHookOutput({
      payload,
      storeRoot,
      ...(cliPath !== undefined ? { cliPath } : {}),
      ...(storeFlag !== undefined ? { storeFlag } : {}),
    });
    if (text !== "") process.stdout.write(text);
  } catch {
    // Swallow — fail-open.
  }
}
```

- [ ] Implement `apps/cli/src/commands/hooks/exec-rewrite.ts` mirroring guard.ts:9-20 (`meta.name: "exec-rewrite"`, `store` arg, `run` → `runExecRewriteHookFromProcess(...)`); register `"exec-rewrite": hooksExecRewriteCommand` in `hooksCommand.subCommands` and add the export line in `apps/cli/src/commands/hooks/index.ts`.
- [ ] GREEN: `pnpm --filter @megasaver/cli exec vitest run test/hooks/exec-rewrite-run.test.ts`.
- [ ] Commit: `feat(cli): exec-rewrite PreToolUse hook`

---

### Task 7: CLI install/uninstall/status — `--exec-rewrite` tri-state

**Files:**
- Create: none
- Modify: `apps/cli/src/commands/hooks/install.ts`, `apps/cli/src/commands/hooks/status.ts`
- Test: `apps/cli/test/hooks/install.test.ts`, `apps/cli/test/hooks/uninstall.test.ts`, `apps/cli/test/hooks/status.test.ts`

**Interfaces:**
- Consumes: Task 2's `execRewrite` tri-state on `installClaudeCodeHook`, `execRewriteInstalled` on `ClaudeCodeHookStatus`; existing `RunHooksInstallInput` (install.ts:13-26), `runHooksInstall` (install.ts:54), citty negation semantics (documented at install.ts:115-118: `--no-<name>` sets the named arg false).
- Produces:
  - `RunHooksInstallInput.execRewrite?: boolean` threaded into `installClaudeCodeHook` only when defined
  - citty arg `"exec-rewrite": { type: "boolean", description: "Install the exec-rewrite PreToolUse hook (--no-exec-rewrite removes; absent preserves)." }` — NO `default`, so the flag's absence preserves state (LD9 gate a)
  - `renderHookInstallation` (status.ts:47-49) extended with `exec rewrite=yes|no`

**Steps:**

- [ ] Write failing tests following the existing harness in `apps/cli/test/hooks/install.test.ts` (temp settings path, injected stdout/stderr, calling `runHooksInstall` directly; where a test drives the citty command object, use the repo's `Command.run?.({...} as never)` pattern):
  - `runHooksInstall({ ..., execRewrite: true })` → written settings has the `^Bash$` entry (`hasExecRewriteHook` true).
  - `runHooksInstall({ ... })` with `execRewrite` absent, run twice around a `true` install → entry preserved (tri-state).
  - `runHooksInstall({ ..., execRewrite: false })` → entry removed.
  - ASSUMPTION: a citty boolean arg WITHOUT `default` yields `undefined` when the flag is absent (needed for tri-state pass-through). Verify with one test through `hooksInstallCommand.run?.({ args: { target: "claude-code", settings: <tmp>, _: [] } } as never)` asserting the settings file is NOT changed for a pre-seeded exec-rewrite entry; if citty instead materializes `false`, switch the arg to `type: "string"` with explicit `"on"|"off"` parsing and update the spec's CLI note.
  - uninstall test: seed settings with exec-rewrite installed, `runHooksUninstall` → `hasExecRewriteHook` false (connector already does the work; this pins the CLI path).
  - status test: `renderHookInstallation` output contains `exec rewrite=yes` / `exec rewrite=no` (update the existing exact-string assertions in status.test.ts in the same commit).
- [ ] RED: `pnpm --filter @megasaver/cli exec vitest run test/hooks/install.test.ts test/hooks/uninstall.test.ts test/hooks/status.test.ts` — expected: TS error on unknown `execRewrite` property / string assertion failures.
- [ ] Implement:
  - `install.ts`: add `execRewrite?: boolean` to `RunHooksInstallInput`; in `runHooksInstall` pass `...(input.execRewrite !== undefined ? { execRewrite: input.execRewrite } : {})`; add the citty arg (no default) and in `run({ args })` pass `...(typeof args["exec-rewrite"] === "boolean" ? { execRewrite: args["exec-rewrite"] } : {})`.
  - `status.ts`: extend `renderHookInstallation` return to `` `Hook installation: connected=…, cache advice=…, exec rewrite=${status.execRewriteInstalled ? "yes" : "no"}` ``.
  - Q4 (spec open question — status warning when installed but workspace disabled) is OUT of scope; leave a `// Q4:` breadcrumb only if the reviewer asks.
- [ ] GREEN: same three test files; then full `pnpm --filter @megasaver/cli test`.
- [ ] Commit: `feat(cli): --exec-rewrite install tri-state`

---

### Task 8: Changesets, verify, smoke evidence

**Files:**
- Create: `.changeset/exec-rewrite-saver.md`
- Modify: `wiki/log.md` (timestamped entry), relevant wiki page(s)
- Test: none new — full-suite + smoke

**Interfaces:**
- Consumes: everything above.
- Produces: DoD items 4/5/9 evidence.

**Steps:**

- [ ] Create `.changeset/exec-rewrite-saver.md` (repo changeset format — YAML frontmatter listing every touched public package, spec Risk section names all five):

```md
---
"@megasaver/cli": minor
"@megasaver/connector-claude-code": minor
"@megasaver/context-gate": minor
"@megasaver/stats": minor
"@megasaver/daemon": minor
---

Exec-Rewrite Saver (wave-2 #1): opt-in PreToolUse mode that rewrites eligible
flat-token Bash commands to `mega output exec-live` before execution, so the
compressed chunk-store-backed output is the only version the client ever
caches. Adds the `^Bash$` exec-rewrite hook entry (tri-state `--exec-rewrite`
install flag), the exec-live delivery path (raw byte-identical on decline,
child exit always mirrored, LD13 self-validation), the PostToolUse saver
exemption for exec-live invocations, and an additive `origin: "exec-rewrite"`
field on overlay saver events (per-origin selector deferred to the UI wave).
```

- [ ] Run `pnpm verify` from the repo root — lint + typecheck + full vitest must be green (includes conventions:check; NO convention-file changes are expected — if it flags one, stop and re-read §7 before touching any managed file).
- [ ] Smoke evidence (DoD §5 — captured terminal session, attach to the PR):
  - `mega hooks install claude-code --exec-rewrite --settings /tmp/<t>/settings.json` then `cat` the settings showing the `^Bash$`/timeout-10 entry.
  - `echo '{"session_id":"smoke-1","cwd":"<enabled-ws>","tool_name":"Bash","tool_input":{"command":"vitest run"}}' | mega hooks exec-rewrite --store <store>` showing the `updatedInput` JSON (enable the workspace first via the existing saver activation command).
  - Run `mega output exec-live --live-session smoke-1 --store <store> -- <fixture command with >minBytes output>` showing the recovery footer, then recover a chunk with `mega output chunk <chunkSetId> 0`.
  - LD12 smoke: with the PostToolUse saver installed, show a session log where the exec-live Bash call produces NO saver event (passthrough) — one overlay event total, no footer-on-footer.
  - LD13 smoke: `mega output exec-live --live-session smoke-1 -- pnpm test` → `error: refused: command not allowlisted`, exit 1.
  - Negative smoke: same payload with `"command":"pnpm test"` → empty stdout, exit 0.
- [ ] Update wiki: add/refresh the feature page for exec-rewrite-saver (status, decisions taken, Q1 verdict) and append a timestamped `wiki/log.md` entry (§0 hard rule).
- [ ] Commit: `chore: exec-rewrite saver changeset + wiki`
- [ ] Hand off per process: `code-reviewer` pass, then `critic` pass (separate fresh contexts — author is never reviewer), then `verifier` with the smoke evidence. No "done" claim before items 4–7 of the DoD hold.

---

## Plan self-check (author-side, before requesting review)

- [ ] Spec coverage: LD1–LD15 each implemented and tested (LD1→T2/T6, LD2→T0/T6, LD3→T5, LD4→T5, LD5→T1, LD6→T5, LD7→T5, LD8→T3, LD9→T2/T6/T7, LD10→T6, LD11→T5/T6, LD12→T4, LD13→T5, LD14→T5, LD15→T5); Non-Goals respected (no script runners, no shell syntax, no new package, no `mega output exec` change, no savings dashboard, no stats selector).
- [ ] Error-handling table of the spec mapped: hook fail-open (T6 tests), exec-live parity/spawn-fail/terminated (T5 tests), daemon 400 fallback (existing makeRecord behavior, T3 daemon schema test).
- [ ] No placeholder text (`TBD`, `add validation`, `similar to Task N`) remains; every cited symbol carries a `path:line` verified against the worktree.
- [ ] Type consistency: `origin` is the literal union `"exec-rewrite"` in context-gate input, `z.enum(["exec-rewrite"])` in both zod schemas; `RunOutputExecLiveInput.stdout` is a raw-text sink (no newline), unlike `RunOutputExecInput.stdout` line sink — do not copy exec.ts's `console.log` wiring.
