# Saver Activation Inheritance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. TDD every task: failing test → red for the right reason → minimal impl → green → commit. `pnpm verify` at every task boundary. Vitest resolves `@megasaver/*` via built dist — run `pnpm build` after cross-package src edits before dependent tests. HIGH risk: code-reviewer AND critic (separate passes) before PR; no `main` edits.

**Goal:** A repository-family Saver Mode setting inherited by all worktrees sharing a canonical Git common directory, resolved by one shared module used by CLI + GUI + the PostToolUse hook, plus a metadata-only heartbeat so configured/invoked/compressed are separately observable. Fixes the 2026-07-02 live finding: an enabled main repo did not cover its `.claude/worktrees/...` sessions.

**Spec:** `docs/superpowers/specs/2026-07-02-saver-activation-inheritance-design.md`
**Branch:** `feat/saver-activation-inheritance` (own worktree; ships **1 of 2**, before persistent-proxy-routing).
**Risk:** HIGH — activation determines whether native tool output is replaced by compressed output. Reviewer: code-reviewer AND critic, separate passes; verifier with hook smoke evidence.

**Execution order:** S1 → S2 → S3 → S4 → S5 → S6 → S7 → S8 → S9 → S10. Pure/leaf modules first (types, identity, store), resolver once its inputs exist, then the hook (the user-visible fix), then CLI/GUI surfaces, docs last.

**Cross-spec note:** S6 adds `latestCompression` to the heartbeat registry — this is the ONLY artifact the persistent-proxy-routing spec (2 of 2) consumes. Do not add a proxy telemetry reader here.

---

## Task S1 — `RepositoryFamilyKey` branded type (shared, browser-safe)

**Files:** `packages/shared/src/repository-family-key.ts` (new), `packages/shared/src/index.ts`, `packages/shared/test/repository-family-key.test.ts`

- Failing tests first: `gf1_` + 43 base64url chars parses and brands; wrong prefix, wrong length, `+`/`/`/`=` chars, empty all reject.
- Impl: mirror `workspace-key.ts` exactly — `repositoryFamilyKeySchema = z.string().regex(/^gf1_[A-Za-z0-9_-]{43}$/, "…").brand<"RepositoryFamilyKey">()`; export `type RepositoryFamilyKey`. **Regex only — no `node:crypto`** (shared must stay in the GUI vite/browser build; the digest is computed in S2 inside context-gate, a node-only package). Re-export from `index.ts` next to `WorkspaceKey`.
- Run `pnpm --filter @megasaver/shared test`, `pnpm --filter @megasaver/shared build`. Commit `feat(shared): add RepositoryFamilyKey branded type`.

## Task S2 — canonical path identity + family-key digest (context-gate, node)

**Files:** `packages/context-gate/src/family-identity.ts` (new), `packages/context-gate/test/family-identity.test.ts`

- Injected filesystem adapter type: `{ realpathNative(p): string; caseMode(p): "sensitive"|"insensitive"|"unknown" }` — so tests never touch the real disk and can simulate APFS/NTFS/ext4.
- Failing tests first: `/tmp/repo` and `/private/tmp/repo` (adapter realpath maps both to `/private/tmp/repo`) → same key; case-insensitive volume lowercases (incl. Windows drive letter `C:` → `c:`) so `/Repo` and `/repo` converge; case-sensitive volume keeps casing so they DON'T; `unknown` preserves casing AND surfaces `case_mode_unknown`; two distinct dirs never collide; output matches `^gf1_[A-Za-z0-9_-]{43}$`.
- Impl: `canonicalFamilyPath(cwd, fs) → { canonicalPath, caseMode, diagnostic }` (realpath.native → NFC (`String.prototype.normalize("NFC")`) → `/` separators → conditional lowercase only on `insensitive`). `familyKeyFromPath(platform, caseMode, canonicalPath) → { key: RepositoryFamilyKey, digestHex, identityPath }`: token `git-family:v1:path:<platform>:<caseMode>:<canonicalPath>`, `createHash("sha256")` (node:crypto — already used across context-gate), `base64url` no padding, `gf1_` prefix; `digestHex` is the 64-char hex of the same 32 bytes for `identityDigest`.
- Run context-gate test + build. Commit `feat(context-gate): canonical path family identity`.

## Task S3 — Git common-directory resolver (context-gate, node)

**Files:** `packages/context-gate/src/git-family.ts` (new), `packages/context-gate/test/git-family.test.ts`

- Failing tests first, using **synthetic on-disk layouts in a tmp dir** (real dirs/files, never spawning git):
  - normal repo (`.git` dir) → `ok`, common dir = realpath(`.git`);
  - main + nested worktree (`.git` file → `gitdir: …/.git/worktrees/w`, admin `commondir` `../..`) → BOTH resolve to the same common dir;
  - **separate-git-dir**: main `.git` file → `gitdir: G` (no `commondir` in G) → common dir = `G`; a worktree whose admin `commondir` resolves to `G` → same `G` — **assert equal keys** (this is BLOCKING-A regression guard);
  - submodule (own gitdir, no commondir) → own common dir; bare → no worktree family (`not_git` from a tool cwd);
  - `foreign_worktree_admin`: `.git` file gitdir points into another repo's `worktrees/<n>/` → `degraded:foreign_worktree_admin`;
  - reciprocal mismatch (moved worktree) → `degraded:reciprocal_mismatch`;
  - budget: 33-deep nesting or >40 syscalls → `degraded:budget_exceeded`;
  - parser: LF/CRLF trailing, exactly one space after `gitdir:`, path-with-spaces ok, multiline/NUL/oversize(>4KiB) → `degraded:metadata_invalid`;
  - leaf `.git`/`gitdir`/`commondir` symlink refused; parent-dir symlink allowed (canonicalized).
- Impl: `resolveGitCommonDir(cwd, fs) → { kind:"not_git" } | { kind:"ok", commonDir } | { kind:"degraded", reason }`. Walk ≤32 lexical ancestors, ≤40 `lstat/read/realpath` ops (counter; exhaustion → `budget_exceeded`). `.git` dir → common dir. `.git` file → parse one `gitdir:` line (bounds above) → resolve relative to file's parent → if resolved gitdir has a `commondir` file, this is a linked worktree (parse commondir, validate reciprocal admin `gitdir` back-pointer, common dir = resolved commondir); else it is the primary gitdir (common dir = the gitdir itself) UNLESS the gitdir path is inside some `worktrees/<name>/` admin dir → `foreign_worktree_admin`. Common dir must have `HEAD` + (`objects` or valid linked layout). No git config read, no hooks, no subprocess.
- Run test + build. Commit `feat(context-gate): git common-directory resolver`.

## Task S4 — activation record schemas + hardened store (context-gate)

**Files:** `packages/context-gate/src/saver-store.ts` (new), `packages/context-gate/test/saver-store.test.ts`

- Failing tests first: `ExactSaverRecord`/`FamilySaverRecord` strict v1 parse; legacy union (`{enabled,mode}`, `{enabled,mode,updatedAt}`) normalizes in memory; `FamilySaverRecord` with digest ≠ its filename key fails closed; atomic write + fsync (temp→rename); leaf symlink / wrong-owner / broadened-mode refused (lstat-open-fstat); activation lock: `wx` create, in-place lease refresh, stale (dead pid / prior boot / expired lease) quarantine-and-recreate, live-owner contention preserved, post-lock reread not cached.
- Impl: Zod schemas (reuse `TokenSaverMode` from shared; `identityDigest` = 64-hex, `identityPath` string). Paths: exact `stats/<workspaceKey>/workspace-token-saver.json`; family `stats/saver-families/<repositoryFamilyKey>.json`; global `stats/workspace-token-saver-default.json`. Reuse `content-store` `assertSafeSegment` pattern for segments. Atomic write helper (mirror `json-directory-store`). Activation lock record `{ownerKind,pid,processStartToken,bootId,instanceId,fenceToken,operation,acquiredAt,leaseExpiresAt}` with an injected process-identity adapter (tests stub start-token/boot-id). New dirs `0700`, files `0600`.
- Run test + build. Commit `feat(context-gate): hardened saver activation store`.

## Task S5 — `resolveWorkspaceTokenSaverSettings` precedence (context-gate)

**Files:** `packages/context-gate/src/resolve-saver-settings.ts` (new), `packages/context-gate/src/index.ts`, `packages/context-gate/test/resolve-saver-settings.test.ts`

- Failing tests first — one per precedence outcome (spec steps 0-4):
  - v1-exact enabled/disabled wins with NO git resolution AND survives a corrupt `.git`;
  - malformed exact record → disabled;
  - `ok` + family record wins; else legacy-root fallback (raw + canonical main-root key candidates, incl `/tmp` alias) applies; else global default; else disabled;
  - `not_git` + legacy-unversioned exact record → applies as exact; + none → global default; else disabled;
  - `degraded` + legacy-unversioned record present → **disabled** (fail-closed); `degraded` + none → **global default**; else disabled;
  - `foreign_worktree_admin`/`reciprocal_mismatch`/`budget_exceeded` all behave as `degraded`.
- Impl: exactly the spec's step 0→4 order returning `ResolvedWorkspaceTokenSaver` (source, keys, `familyUnavailableReason`, `familyIdentityDiagnostic`). Compose S2/S3/S4. Export from `index.ts`. **This is the precedence contradiction that round-3 fixed — pin the degraded+global vs degraded+legacy split explicitly.**
- Run test + build. Commit `feat(context-gate): saver settings precedence resolver`.

## Task S6 — bounded heartbeat registry (context-gate)

**Files:** `packages/context-gate/src/saver-heartbeat.ts` (new), `packages/context-gate/src/index.ts`, `packages/context-gate/test/saver-heartbeat.test.ts`

- Failing tests first: strict schema `{version:1, latest, latestCompression, workspaces}`; per-key strict-newer accept; equal/older (incl clock regression) no-op with `clock_regression`; >5-min-future rejected (`future_skew`, never becomes baseline); 30-day TTL prune; 256-cap eviction (newest kept); `latest` AND `latestCompression` always **derived** (max retained), never moved backward by a regressed payload; a compression update sets `latestCompression`; status read is **non-mutating** and takes NO lock; 10ms lock contention skips without blocking.
- Impl: `recordInvocationHeartbeat(storeRoot, workspaceKey, ts)` and `recordCompressionHeartbeat(storeRoot, workspaceKey, ts)` (both under the 10ms `wx` heartbeat lock, prune-on-write, derive both `latest*`); `readHeartbeatView(storeRoot)` (in-memory filtered view, no lock, no write). File `stats/saver-hook-heartbeats.json`, mode `0600`.
- Run test + build. Commit `feat(context-gate): bounded saver heartbeat registry`.

## Task S7 — wire the PostToolUse hook (cli) ← the user-visible fix

**Files:** `apps/cli/src/hooks/saver-run.ts`, `apps/cli/src/hooks/saver.ts`, `apps/cli/test/hooks/saver-*.test.ts`

- Failing tests first: a payload whose `cwd` is a linked worktree of a repo with a family-enabled record → **compresses** (today it passes through — this is the regression the whole feature fixes); every syntactically valid payload updates the requested-key heartbeat before gates (incl. small/passthrough); a qualifying compression updates `latestCompression`; disabled/small/ineligible still passthrough; missing `cwd` still passthrough.
- Impl: replace `readSettings` (saver-run.ts:23 exact-key-only) with `resolveWorkspaceTokenSaverSettings(storeRoot, cwd)`; gate on the resolved `{enabled,mode}`. Add heartbeat step 1 (invocation, best-effort, before gates) and step 5 (compression, best-effort, after a compressed decision). Keep the daemon-forward/in-process record path unchanged. Chunks/events stay under the requested workspace key + live session id (NOT the family key).
- Run cli test + build. **Feature smoke evidence:** craft a real worktree, write a family record, feed a >4KB Read payload through `mega hooks saver`, capture the compressed envelope + the events.jsonl + the heartbeat file. Commit `fix(cli): saver hook honors repository-family activation`.

## Task S8 — scope-aware `mega session saver` + status (cli)

**Files:** `apps/cli/src/commands/session/saver/{workspace,status}.ts` + new `repository.ts`, `default.ts`, `apps/cli/src/commands/session/saver/index.ts`, tests under `apps/cli/test/`

- Failing tests first: `enable` at a main root writes a **family** record (scope echo `repository family (covers all worktrees of <root>)`); `enable` inside a linked worktree ALSO defaults to family (BLOCKING-A / MAJOR-5 guard); `--exact` (and GUI this-checkout-only) writes an exact record with echo `this workspace only`; `session saver default enable|disable` writes only the global default; status reports source/mode, `familyUnavailableReason`, `familyIdentityDiagnostic`, and enumerates any v1 exact override still outranking a repository change; `--json` parity.
- Impl: route the existing workspace toggle through the resolver's family key when available (family scope default), `--exact` opt-down; new `repository`/`default` subcommands; status assembles from the resolver + heartbeat view (`lastSaverHookInvocationAt/AgeMs`, `lastCompressionAt/AgeMs`, `hooksConfigured`). Public behavior change → changeset in S10.
- Run cli test + build. Commit `feat(cli): repository/exact/default saver activation scopes`.

## Task S9 — GUI bridge + toggle scope + status (gui)

**Files:** `apps/gui/bridge/routes/*saver*`, `apps/gui/src/views/cockpit/token-saver-panel.tsx`, gui tests

- Failing tests first (bridge): enable at a family-capable cwd writes a family record and returns the coverage string; a "this checkout only" action writes exact; status returns the new fields. GUI: panel shows source/scope + the factual liveness wording (configured / invoked / compressed) from the spec's Status section.
- Impl: bridge calls the SAME `@megasaver/context-gate` resolver + store (no reimplementation in browser code — the resolver is node-only, so all identity/precedence runs in the bridge). Panel renders the returned scope/coverage + `familyUnavailableReason` remediation command.
- Run gui test + build. Commit `feat(gui): scope-aware saver toggle and liveness status`.

## Task S10 — changeset + wiki + verification

**Files:** `.changeset/saver-activation-inheritance.md`, `wiki/entities/*` (context-gate, cli, gui, shared), `wiki/concepts/saver-activation-inheritance.md` (status proposed→shipped), `wiki/log.md`

- Changeset: minor bump for `@megasaver/shared` (new type), `@megasaver/context-gate` (new public resolver/store/heartbeat), `@megasaver/cli`, `@megasaver/gui` (public toggle behavior change).
- `pnpm verify` green (biome + tsc -b + vitest). Capture the S7 smoke evidence in the PR.
- Reviewer gate: code-reviewer AND critic (separate contexts). Verifier pass with the worktree-inheritance reproduction.
- Update wiki entities + flip the concept page to shipped; append `wiki/log.md`. Commit `docs(wiki): record saver activation inheritance`.

---

## Definition of done (this feature)

1–2 spec+plan present. 3 TDD throughout. 4 `pnpm verify` green. 5 smoke evidence = the worktree-inheritance reproduction (S7). 6 code-reviewer AND critic pass (HIGH). 7 verifier pass. 8 zero pending todos. 9 changeset added. 10 no conventions changed. **Acceptance:** enabling a repo activates all its worktrees (incl. external + separate-git-dir); explicit worktree disable wins; existing main-root activation works without migration; CLI/GUI/hook resolve identical settings; compression events stay keyed to the actual worktree/session; status separates configured/invoked/compressed; fresh install + unrelated repos disabled.
