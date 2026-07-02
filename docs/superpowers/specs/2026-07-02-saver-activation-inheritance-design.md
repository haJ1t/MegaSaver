---
title: Saver activation inheritance across Git worktrees
status: draft
risk: HIGH
created: 2026-07-02
branch: feat/persistent-proxy-routing
reviewers: [architect, critic]
sources:
  - docs/superpowers/specs/2026-06-15-realized-saver-hook-design.md
  - docs/superpowers/specs/2026-06-25-intent-aware-hook-design.md
  - wiki/log.md
  - wiki/agent-channel.md
---

# Saver activation inheritance across Git worktrees

## Problem

Saver Mode activation is stored only at
`stats/<encodeWorkspaceKey(cwd)>/workspace-token-saver.json`. The PostToolUse
hook hashes its exact payload `cwd`, so an enabled repository root does not
cover another worktree. The 2026-07-02 live investigation confirmed this with a
Claude-managed worktree whose hash had no settings file while the repository's
main workspace was enabled.

Hook installation has a separate observability gap: “configured” can be shown
even when a long-running Claude process has not loaded or invoked the saver
hook. A compression timestamp alone also cannot distinguish a dead hook from a
healthy hook that only saw small passthrough outputs.

## Goal

An explicit repository-family Saver Mode setting applies to all worktrees that
share the same canonical Git common directory, unless an exact worktree override
exists. CLI, GUI, and hook use one resolver and one atomic settings store.
Every valid saver-hook invocation writes a metadata-only heartbeat, including
passthrough, so configuration, invocation, and compression are observable as
separate facts.

## Non-goals

- Enabling Saver Mode globally on fresh install.
- Automatically restarting Claude to reload hooks.
- Treating “no recent event” as proof of failure.
- Changing compression budgets, classifiers, ranking, or evidence retention.
- Running Git subprocesses on the PostToolUse critical path.

## Approaches considered

1. **Exact override → repository family → explicit global default → disabled
   (selected).** Covers nested and externally located worktrees without making
   one project opt-in affect unrelated repositories.
2. Lexical parent inheritance only. Rejected because it fixes
   `.claude/worktrees/...` but misses standard worktrees stored elsewhere.
3. Machine-wide enabled default only. Rejected because one workspace opt-in
   would unexpectedly alter every Claude project.
4. `git rev-parse` on every hook call. Rejected because it adds a process and
   failure latency to every intercepted tool result.

## Locked precedence

`resolveWorkspaceTokenSaverSettings(storeRoot, cwd)` resolves in this order:

1. exact workspace override for `encodeWorkspaceKey(cwd)`;
2. repository-family setting derived from the canonical Git common directory;
3. legacy exact setting at a verified main repository root;
4. explicit global default;
5. disabled.

At each level, both `enabled=true` and `enabled=false` are authoritative. A
malformed or unreadable record stops resolution at that level and fails closed
to disabled; corruption never falls through to a more permissive parent.

Fresh install has no exact, family, or global record and therefore remains
disabled.

## Repository-family identity

The resolver finds the nearest `.git` entry by walking lexical parents:

- `.git` directory: canonicalize that directory as the common directory;
- `.git` file: parse one bounded `gitdir:` pointer and resolve it relative to
  the file's parent. If the target contains `commondir`, parse that bounded
  pointer relative to the admin directory and validate the reciprocal admin
  `gitdir` pointer back to the discovered worktree `.git` file. Without
  `commondir`, a structurally valid Git directory is its own common directory
  (separate-git-dir and submodule case);
- no valid `.git`: repository-family resolution is unavailable.

External worktree pointers are expected to leave the worktree directory, so
lexical containment is not the safety rule. Instead, every referenced file is
size-bounded, symlinks are refused, targets must exist, `realpath` canonicalizes
them, the reciprocal pointer must match for linked worktrees, and the resolved
common directory must have Git control markers (`HEAD` plus `objects` or a
valid linked layout). The parser never reads Git config, executes hooks, or
spawns Git. `repositoryFamilyKey` is the existing fixed-length workspace hash
over the canonical common-directory path.

Bare repositories have no worktree and therefore no activation family from a
tool cwd. Separate git dirs and submodules get their own common-directory
identity. The legacy main-root fallback is available only when the common
directory is the root's actual `.git` directory and that relationship is
verified; separate-git-dir layouts require a new family record.

The main repository root's legacy exact activation is a family fallback when
no family record exists. This makes existing root activation cover worktrees
without a destructive migration.

## Shared component and storage

Move schema, identity resolution, atomic read/write, and precedence into an
agent-neutral module in `@megasaver/context-gate`.

```ts
type ResolvedWorkspaceTokenSaver = {
  enabled: boolean;
  mode: TokenSaverMode;
  requestedWorkspaceKey: WorkspaceKey;
  repositoryFamilyKey: WorkspaceKey | null;
  source: "exact" | "repository" | "legacy-root" | "global" | "missing" | "invalid";
  sourceKey: WorkspaceKey | null;
};
```

Storage remains under the MegaSaver store:

- exact: `stats/<workspaceKey>/workspace-token-saver.json`;
- family: `stats/saver-families/<repositoryFamilyKey>.json`;
- global default: `stats/workspace-token-saver-default.json`;
- global heartbeat: `stats/saver-hook-heartbeat.json` with strict
  `{version:1,ts:string,workspaceKey}`;
- workspace heartbeat: `stats/<workspaceKey>/saver-hook-heartbeat.json` with
  strict `{version:1,ts:string}`.

New records use a strict v1 schema. Exact reads accept a strict legacy union for
the two shipped shapes—`{enabled,mode}` and
`{enabled,mode,updatedAt}`—then normalize in memory. New writes emit only
`{version:1,enabled,mode,updatedAt,scope}`. Records use atomic write +
file/directory `fsync`, safe path segments, and one owner-only activation lock.

## Activation write policy

The existing workspace enable/disable command and GUI toggle keep their current
exact-write semantics. When that exact record belongs to a verified main Git
root, worktrees consume it through the legacy-root family fallback, so today's
activation fixes the observed case without changing the public default.

New `mega session saver repository enable|disable` controls write one family
record; they never mirror into an exact file. Exact disable blocks an enabled
family. `mega session saver default enable|disable` is the only global-default
writer and is never called as a side effect of project activation. GUI may
expose the same three scopes but keeps its existing workspace toggle exact by
default. Each mutation touches one record under the activation lock, so there
is no multi-file partial-commit state and no ambiguity between generated
mirrors and intentional exact overrides.

CLI, GUI bridge, and hook all call the shared module. Browser code does not
reimplement identity or precedence.

## Hook and event flow

For every syntactically valid PostToolUse payload received by `mega hooks saver`:

1. Best-effort update both a global and requested-workspace metadata-only
   heartbeat before activation and size gates.
2. Resolve exact/family/global activation.
3. Disabled, missing, invalid, small, or ineligible output returns passthrough.
4. Enabled output uses the resolved mode and existing evidence-preserving
   compression path.
5. Chunks and compression events remain under the **requested worktree key and
   live session id**, not the family key.

Heartbeat records are minimal: global `{version,ts,workspaceKey}` and workspace
`{version,ts}`. They store no live session id, prompt, command, path, tool name,
tool input, or output. Files are mode `0600` under owner-only directories. A
short non-blocking heartbeat lock compares timestamps and writes only when the
incoming timestamp is newer, so concurrent hook processes cannot move liveness
backward. Lock contention or write failure skips the heartbeat and never blocks
or mutates the tool result.

## Status and liveness

CLI/GUI status returns:

- requested workspace key;
- repository family key, when available;
- effective source and mode;
- hook configuration state;
- requested-workspace `lastSaverHookInvocationAt/AgeMs`, plus separate global
  last-invocation evidence;
- requested workspace `lastCompressionAt/AgeMs` from saver events.

UI wording is factual:

- configured + recent heartbeat: the saver hook is being invoked;
- configured + no heartbeat: configured, but no invocation observed;
- heartbeat + no compression: hook active; no qualifying compression observed;
- family/global: show the inherited source;
- invalid override: disabled with the read/validation error.

No timeout converts absence into a definitive failure because the user may not
have invoked an eligible tool.

## Failure handling

- Missing records at all levels: disabled passthrough.
- Malformed nearest-precedence record: disabled/invalid; do not inherit through
  corruption.
- Invalid, non-reciprocal, symlinked, oversized, or structurally invalid `.git`
  metadata: skip family identity, then evaluate only explicit global default;
  never execute referenced content.
- Settings read permission error: fail closed at that precedence level.
- Heartbeat failure: continue normal saver decision.
- Compression/event write failure: preserve the hook invariant—emit no
  replacement output so Claude receives the original result.

## Testing strategy (TDD)

| Case | Required result |
| --- | --- |
| Exact override | exact enabled/disabled wins over family/global |
| Main + nested worktree | shared common-dir resolves the same family |
| External worktree | `gitdir` + `commondir` + reciprocal pointer resolve the same family without spawning Git |
| Separate git dir/submodule/bare | separate identity is deterministic; bare has no worktree family |
| Legacy activation | verified main-root exact enables a worktree when family record is absent |
| Global default | applies only when exact/family are absent; missing default stays disabled |
| Invalid nearer record | disabled/invalid; lower precedence is not consulted |
| Path safety | symlink/escape/malformed `.git` pointer rejected |
| Legacy schema | both shipped exact shapes normalize; all new writes are strict v1 |
| CLI/GUI parity | both write one record through the same locked scoped store |
| Hook heartbeat | valid small/disabled passthrough updates monotonic per-workspace + global metadata only; contention never blocks |
| Hook integration | family enable compresses eligible output and records under requested worktree key |
| Regression | disabled/small/ineligible/error paths preserve original output |

Use temporary stores and synthetic Git directory/file layouts. No test reads
real Claude configuration or executes Git.

## Risk and governance

Risk is **HIGH** because activation determines whether native tool output is
replaced by evidence-preserving compressed output. Required gates: full
superpowers chain, worktree, architect and critic design passes, TDD,
`pnpm verify`, hook smoke evidence, code-reviewer and verifier passes, and
changesets for public package changes.

## Acceptance criteria

- Enabling a Git repository activates all worktrees sharing its common-dir
  identity, including external worktrees.
- An explicit worktree disable wins over family/global settings.
- Existing main-root activation works without destructive migration.
- CLI, GUI, and hook resolve identical effective settings.
- Compression events remain keyed to the actual worktree/session.
- Status separates configured hooks, observed invocation, and compression.
- Fresh install and unrelated repositories remain disabled.
