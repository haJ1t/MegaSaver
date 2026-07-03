---
title: Saver activation inheritance across Git worktrees
status: draft
risk: HIGH
created: 2026-07-02
design_branch: feat/persistent-proxy-routing
implementation_branch: feat/saver-activation-inheritance
implementation_order: "1 of 2 — ships before persistent proxy routing"
design_reviews_completed: [architect, critic]
counter_review:
  # Fresh-context counter-review (Codex unavailable). A separate-git-dir BLOCKING
  # introduced by the round-2 family-identity edit was caught and fixed; canonical
  # common-dir path identity now converges main + worktrees. Final APPROVE.
  # Artifact: docs/superpowers/reviews/2026-07-03-round2-round3-counter-review.md
  status: approved-fresh-context
required_implementation_reviews: [code-reviewer, critic, verifier]
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

1. **Exact override → repository family → verified legacy main-root → explicit
   global default → disabled (selected).** Covers nested and externally located
   worktrees without making one project opt-in affect unrelated repositories.
2. Lexical parent inheritance only. Rejected because it fixes
   `.claude/worktrees/...` but misses standard worktrees stored elsewhere.
3. Machine-wide enabled default only. Rejected because one workspace opt-in
   would unexpectedly alter every Claude project.
4. `git rev-parse` on every hook call. Rejected because it adds a process and
   failure latency to every intercepted tool result.

## Locked precedence

The five precedence *levels* below are not evaluated as a naive top-down ladder,
because whether a legacy unversioned exact record counts as a stage-1 override
depends on the Git resolution at stage 2. `resolveWorkspaceTokenSaverSettings
(storeRoot, cwd)` executes in this concrete order:

0. Read the record at the requested exact key `encodeWorkspaceKey(cwd)` and
   classify it as **v1-exact** (`version:1, scope:"exact"`), **legacy-
   unversioned** (a shipped `{enabled,mode}`/`{enabled,mode,updatedAt}` shape),
   or **absent/malformed**. A malformed (non-union) record fails closed to
   disabled immediately.
1. A **v1-exact** record wins outright — enabled or disabled — and is returned
   without running Git resolution. It is a deliberate per-workspace override and
   is never affected by `.git` state.
2. Run repository-family resolution to obtain `not_git | ok | degraded` plus,
   on `ok`, the family key. A `degraded` result (`budget_exceeded`/
   `metadata_invalid`/`reciprocal_mismatch`/`foreign_worktree_admin`) is
   authoritative-unavailable: it does NOT fall through to the **family** or
   **legacy-root** stages (both are git-derived), but the git-independent
   **global default** at step 4 still applies.
3. A **legacy-unversioned** exact record is applied as a stage-1 exact override
   **only** when family resolution returned `not_git` (the workspace is not in a
   repo, so the record *is* the workspace). On `ok` it is ignored here (the
   family and legacy-root stages own it). On `degraded` it is treated as
   `invalid`, which **stops resolution at disabled** — a transient metadata or
   budget failure can never resurrect a legacy enabled record over a possible
   family disable it cannot currently see. (Absence of a legacy record on
   `degraded` is not ambiguous and does not force disabled; it proceeds to the
   global default at step 4.)
4. Resolve the fallback:
   - family `ok`: a **family** record for the family key wins (enabled or
     disabled); else the **legacy-root** fallback (a verified main-root legacy
     record) applies; else the **global default**; else disabled;
   - family `not_git` (and no legacy-unversioned record applied at step 3): the
     **global default**; else disabled;
   - family `degraded` (and no legacy-unversioned record present): the
     **global default**; else disabled.

At every level both `enabled=true` and `enabled=false` are authoritative. A
malformed or unreadable record at the level being consulted fails closed to
disabled; corruption never falls through to a more permissive parent.

Fresh install has no exact, family, or global record and therefore remains
disabled.

## Repository-family identity

The resolver starts from `path.resolve(cwd)` and walks at most 32 lexical
ancestors, with a total budget of 40 metadata `lstat/read/realpath` operations.
Budget exhaustion returns `family_unavailable:budget_exceeded`; it never blocks
the hook or spawns Git. It finds the nearest `.git` entry:

- `.git` directory: canonicalize that directory as the common directory;
- `.git` file: parse one `gitdir: <path>` line and resolve it relative to the
  file's parent. If the resolved gitdir contains a `commondir` file, this is a
  **linked worktree**: parse that pointer relative to the admin directory,
  validate the reciprocal admin `gitdir` pointer back to the discovered worktree
  `.git` file, and the common directory is the resolved commondir. If the
  resolved gitdir has NO `commondir` file, this is the repository's **primary**
  git directory (separate-git-dir and submodule case): the common directory is
  the resolved gitdir itself. Family identity is the common directory in both
  branches, so a separate-git-dir main checkout and any linked worktree added to
  it converge — the main `.git` file resolves to gitdir `G` (no commondir ⇒
  common dir `G`) and each worktree's `commondir` also resolves to `G`;
- no valid `.git`: repository-family resolution is unavailable.

A `.git` file with no `commondir` whose `gitdir` points into another
repository's `worktrees/<name>/` admin directory is rejected
(`family_unavailable:foreign_worktree_admin`): a primary git directory is never
itself a worktree admin dir, so this shape is either corruption or a crafted
pointer. A hostile standalone `.git` file that points directly at an unrelated
repository's primary git directory is not otherwise distinguishable from a
legitimate separate-git-dir setup without running Git; the bounded consequence
is that such a checkout inherits that repository's Saver *activation state*
(compression on/off) — no credential, settings, route, or data exposure — and
it requires the operator to have cloned and run an agent inside a crafted repo.
This is a documented low-severity limitation, not a silent correctness gap.

Pointer files are UTF-8, at most 4 KiB, contain no NUL, and accept only one
optional trailing LF or CRLF. `gitdir:` requires exactly one ASCII space and a
non-empty value; `commondir`/reciprocal values reject leading/trailing spaces
after newline removal. Multi-line or malformed input is rejected. Fixtures pin
LF, CRLF, relative pointers, and paths containing spaces.

External worktree pointers are expected to leave the worktree directory, so
lexical containment is not the rule. Parent path components and user-selected
cwd aliases may be symlinks and are canonicalized. Only the `.git` entry and
the `gitdir`/`commondir` metadata objects themselves are refused when they are
symlinks. Targets must exist, `realpath.native` canonicalizes aliases, the
reciprocal pointer must match for linked worktrees, and the common directory
must have Git control markers (`HEAD` plus `objects` or a valid linked layout).
Reciprocal mismatch—for example a moved worktree needing `git worktree repair`—
returns `family_unavailable:reciprocal_mismatch` in status rather than silently
pretending the workspace is unrelated.

Family identity is the canonical common-directory **path**, produced by an
explicit, platform-aware canonicalization. Durable state never keys on
`stat.dev`/`stat.ino`: device numbers change across reboots and remounts and
inodes change on copy-based restore or migration, so a file-id key silently
orphans activation or — worse — lets a recycled identity activate compression
in an unrelated repository. Canonical-path identity survives reboot, remount,
and restore; the intentional consequence is that a different repository
appearing at the same canonical path inherits that path's activation, which
matches the product's existing path-keyed workspace semantics and is the safe
direction to be wrong in.

The injected filesystem adapter reports the containing volume's
`caseMode` as `sensitive | insensitive | unknown` from non-mutating platform
metadata; platform name alone never determines casing:

- all platforms use `realpath.native`, Unicode NFC, and `/` separators;
- only a positively established `insensitive` volume receives
  locale-independent lowercase, including the Windows drive letter;
- `sensitive` and `unknown` preserve the realpath casing. `unknown` also emits
  `case_mode_unknown`, accepting a visible false-negative alias split rather
  than conflating distinct repositories.

The identity token is
`git-family:v1:path:<platform>:<caseMode>:<canonicalPath>`, encoded as
`gf1_<base64url(SHA-256(UTF8(token)))>` through a new `RepositoryFamilyKey`
type; the security-sensitive family lookup never uses the legacy FNV workspace
key. `realpath.native` makes `/tmp` ↔ `/private/tmp`, symlinked-parent,
drive-letter, and separator aliases converge. Family records store the full
SHA-256 `identityDigest` plus the canonical `identityPath`; the reader verifies
the digest matches the filename key before applying the record, and
`identityPath` gives operators and tests a human-checkable record of what the
key denotes. Aliases realpath cannot unify (bind mounts, network double-mounts)
remain distinct identities — a visible limitation, not silent misbehavior.
Tests inject case-sensitive and case-insensitive APFS, Windows,
and Linux adapters. They prove aliases converge only where the volume contract
says they are aliases and prove two case-distinct directories never conflate.

Bare repositories have no worktree and therefore no activation family from a
tool cwd. Separate git dirs and submodules key to their primary git directory
(shared by their worktrees). The legacy main-root fallback is available only
when the common directory is the root's actual in-tree `.git` directory and
that relationship is verified; separate-git-dir layouts have no in-tree `.git`
directory and therefore require a new family record.

The exact-override stage (0/1) keys on the raw, un-canonicalized cwd via the
existing `encodeWorkspaceKey`, deliberately: that is where every shipped exact
record lives and where the workspace toggle has always written, and
canonicalizing the exact key would orphan those records. The consequence is that
an exact override is alias-sensitive — the SAME checkout reached through a
symlink or case alias may miss its exact record — while the family stage (2) is
alias-unifying by canonical path. This asymmetry is intentional: exact is an
explicit per-spelling override; cross-alias unification is the family layer's
job. The earlier claim that path-family identity "matches existing path-keyed
workspace semantics" refers only to *path*-keying, not to raw-vs-canonical
behavior, which differs by stage as described here.

Legacy exact settings contain only an FNV key, not their source path, so arbitrary
aliases cannot be reversed. The fallback probes deduplicated raw and canonical
main-root candidates available from the un-realpathed `.git` pointer/ancestor,
the canonical common-dir parent, and the current nested-worktree ancestry. If
none matches, status reports `legacy_alias_unresolved` and asks for one explicit
repository enable; it never claims inheritance succeeded. This covers the raw
spellings observable from the current session plus canonical forms; an
enable-time alias that is no longer observable (for example an external
worktree added from an already-realpathed shell after enabling under
`/tmp/...`) is *visible* rather than covered — `legacy_alias_unresolved` names
the one-command fix. No guessing and no scanning of unrelated store entries.

## Shared component and storage

Move schema, identity resolution, atomic read/write, and precedence into an
agent-neutral module in `@megasaver/context-gate`.

```ts
type ResolvedWorkspaceTokenSaver = {
  enabled: boolean;
  mode: TokenSaverMode;
  requestedWorkspaceKey: WorkspaceKey;
  repositoryFamilyKey: RepositoryFamilyKey | null;
  source: "exact" | "repository" | "legacy-root" | "global" | "missing" | "invalid";
  sourceKey: WorkspaceKey | RepositoryFamilyKey | null;
  familyUnavailableReason:
    | "not_git"
    | "budget_exceeded"
    | "metadata_invalid"
    | "reciprocal_mismatch"
    | "foreign_worktree_admin"
    | "legacy_alias_unresolved"
    | null;
  familyIdentityDiagnostic: "case_mode_unknown" | null;
};
```

Storage remains under the MegaSaver store:

- exact: `stats/<workspaceKey>/workspace-token-saver.json`;
- family: `stats/saver-families/<repositoryFamilyKey>.json`;
- global default: `stats/workspace-token-saver-default.json`;
- bounded heartbeat registry: `stats/saver-hook-heartbeats.json` with strict
  `{version:1, latest:{ts,workspaceKey}|null, latestCompression:{ts,workspaceKey}|null, workspaces:Record<WorkspaceKey,ts>}`;
  maximum 256 workspace entries, latest-only per key, 30-day TTL. `latest` is
  the invocation heartbeat; `latestCompression` is the most recent qualifying
  compression across all workspaces, updated on the compression path under the
  same heartbeat lock so proxy status has a single global compression source
  (cross-spec contract with the proxy telemetry reader). Both `latest` and
  `latestCompression` are always DERIVED (recomputed as the max retained `ts`)
  after each guarded per-key write; neither is written directly, so a
  clock-regressed payload can never move either backward.

`TokenSaverMode` and `WorkspaceKey` are the existing `@megasaver/shared` types,
reused not redefined. `RepositoryFamilyKey` is a new branded type with a
concrete validator: `^gf1_[A-Za-z0-9_-]{43}$` (base64url of a 32-byte SHA-256
digest, no padding), branded via Zod exactly like the existing
`workspaceKeySchema`. It lives in `@megasaver/shared` alongside `WorkspaceKey`.

New records use distinct strict v1 schemas:

```ts
type ExactSaverRecord = {
  version: 1;
  enabled: boolean;
  mode: TokenSaverMode;
  updatedAt: string;
  scope: "exact" | "global";
};

type FamilySaverRecord = {
  version: 1;
  enabled: boolean;
  mode: TokenSaverMode;
  updatedAt: string;
  scope: "repository";
  identityDigest: string;
  identityPath: string;
};
```

`FamilySaverRecord.identityDigest` is the exact 32-byte SHA-256 digest encoded
by its `RepositoryFamilyKey`; missing or mismatched digests fail closed. Exact
reads accept a strict legacy union for
the two shipped shapes—`{enabled,mode}` and
`{enabled,mode,updatedAt}`—then normalize in memory. New exact/global writes
emit only `ExactSaverRecord`; family writes emit only `FamilySaverRecord`.
Records use atomic write + file/directory `fsync`, safe path segments, and one
owner-only activation lock.

All activation, family, and heartbeat reads use lstat-open-fstat identity checks,
require owner-controlled parent directories and regular-file leaves, and use
no-follow semantics where available. Symlinked, multiply-linked, wrong-owner,
or permission-broadened leaves fail closed at their precedence level. New
directories are `0700` and files are `0600`; writes preserve stricter existing
modes. The activation lock stores boot id, PID, process-start token, random
fence token, operation, acquisition time, and a 30-second renewable lease. Same-boot
PID/start-token identity protects a live writer; owner death, token mismatch,
prior boot, or lease expiry permits inode-verified quarantine-and-recreate.
Immediately before every durable mutation, the owner revalidates the lock
path/inode, fence token, and unexpired lease; a resumed expired owner self-aborts
after takeover. Recovery re-reads the target record after acquiring the
replacement lock and never applies a cached pre-lock value. The 10 ms heartbeat
lock uses the same identity format but skips a live contention rather than
blocking the hook.

Reading the shipped unversioned shapes is an on-disk migration for currently
supported user state, not a pre-1.0 API compatibility shim. After any successful
mutation, that record is rewritten as strict v1; no legacy shape is emitted.
The rewrite scope is pinned: only an explicit exact-scope mutation (`--exact`
or the GUI this-checkout-only action) rewrites a legacy record, and it writes
`scope:"exact"` because that is the operator's stated intent. Repository- and
global-scope mutations never touch the legacy file; untouched, it stays
permanently outranked by any family record via the legacy-root stage. No path
silently promotes a legacy fallback into a stage-1 override.

## Activation write policy

The existing workspace enable/disable command and GUI toggle become
repository-aware: **anywhere the resolver yields a family key — a verified main
Git root OR a linked worktree** — they default to writing one family record;
only in a non-Git directory (or on an explicit opt-down) do they write an exact
record. Because the resolver already derives the same common-dir family key from
a worktree `.git` file, a developer sets up the feature's own use case
(worktree inherits repo activation) from inside the worktree. `--exact` and the
GUI “this checkout only” action explicitly force exact scope. This is a
public behavior change and requires a changeset. Every enable/disable response
— CLI text and JSON, and the GUI confirmation — states the scope it actually
wrote and its coverage: `repository family (covers all worktrees of <root>)` or
`this workspace only`. Silent family-wide activation is not permitted.

Unversioned settings at a verified main root are reclassified as
`legacy-root`, not stage-1 exact, so a new family disabled record outranks an
old enabled file. A v1 `scope:"exact"` record remains an intentional override
and wins; repository commands/status must enumerate such winning overrides
instead of claiming the whole family changed. Family writes never mirror into
exact files and each mutation touches one record under the activation lock.

The asymmetry is explicit: a legacy main-root exact disable is a family-wide
fallback when no family record exists, while a linked-worktree exact disable is
local. `mega session saver default enable|disable` is the only global-default
writer and is never called as a side effect of project activation.

CLI, GUI bridge, and hook all call the shared module. Browser code does not
reimplement identity or precedence.

## Hook and event flow

For every syntactically valid PostToolUse payload received by `mega hooks saver`:

1. Best-effort update the requested key in the bounded heartbeat registry
   (deriving `latest` from the pruned map) before activation and size gates.
2. Resolve exact/family/legacy-root/global activation.
3. Disabled, missing, invalid, small, or ineligible output returns passthrough.
4. Enabled output uses the resolved mode and existing evidence-preserving
   compression path.
5. On a qualifying compression, best-effort update `latestCompression` in the
   same registry under the heartbeat lock (derived, never moved backward).
6. Chunks and compression events remain under the **requested worktree key and
   live session id**, not the family key.

The registry stores no live session id, prompt, command, raw path, tool name,
tool input, or output. `workspaceKey` is an FNV hash of a path and is
dictionary-checkable; it is a pseudonymous lookup key, not anonymous data. The
file is mode `0600` under an owner-only directory. It avoids creating one stats
directory per never-enabled workspace.

A non-blocking heartbeat lock waits at most 10 ms. RFC3339 timestamps are parsed
to epoch milliseconds; an update is accepted only when strictly newer than the
stored key timestamp. Equal/older input—including wall-clock regression—is a
no-op with a `clock_regression` diagnostic, so concurrency never moves liveness
backward. An incoming or stored timestamp more than five minutes ahead of
`now` is rejected/dropped with `future_skew`; it can never become the comparison
baseline. Status reads are non-mutating: they compute the filtered view (TTL,
cap, future-skew) in memory and never take the heartbeat lock, so GUI polling
can never starve hook writers. Pruning — dropping future entries and entries
older than 30 days, capping the map to the 256 newest, and recomputing both
`latest` and `latestCompression` from retained entries — happens only on
successful hook writes under the heartbeat lock;
because every write prunes, retention stays bounded even across a wall-clock
rollback. Lock contention or write failure skips heartbeat update
and never blocks or mutates the tool result.

Two bounded limitations are documented, not structural: a single payload up to
the five-minute future-skew threshold ahead can become the accepted baseline and
freeze that key's liveness for the window (sub-threshold, so never a persistent
freeze); and on a machine with more than 256 active workspaces the 256-cap can
evict a genuinely-enabled workspace's heartbeat, under-reporting *invocation*
in status. Neither ever affects activation resolution.

## Status and liveness

CLI/GUI status returns:

- requested workspace key;
- repository family key, when available;
- effective source and mode;
- `familyUnavailableReason` and any exact overrides that still outrank a
  repository action;
- `familyIdentityDiagnostic` (`case_mode_unknown`) when the volume's case
  semantics could not be positively established;
- hook configuration state;
- requested-workspace `lastSaverHookInvocationAt/AgeMs`, plus separate global
  last-invocation evidence;
- requested workspace `lastCompressionAt/AgeMs` from saver events.

UI wording is factual:

- configured + recent heartbeat: the saver hook is being invoked;
- configured + no heartbeat: configured, but no invocation observed;
- heartbeat + no compression: hook active; no qualifying compression observed;
- family/legacy-root/global: show the inherited source;
- family unavailable: show the specific metadata/budget/alias reason and the
  exact command that creates a family record;
- invalid override: disabled with the read/validation error.

No timeout converts absence into a definitive failure because the user may not
have invoked an eligible tool.

## Failure handling

- Missing records at all levels: disabled passthrough.
- Malformed nearest-precedence record: disabled/invalid; do not inherit through
  corruption.
- A v1 `scope:"exact"` record at the requested key is evaluated and wins
  (enabled or disabled) BEFORE any Git resolution and is unaffected by `.git`
  corruption — it is not derived from Git (precedence step 1).
- Invalid, non-reciprocal, oversized, structurally invalid, or leaf-symlinked
  `.git` metadata (with no v1 exact override): report a precise
  family-unavailable reason and skip the
  family and legacy-root stages. If an unversioned record exists at the
  requested exact key, it is treated as `invalid` and resolution fails closed
  to disabled (see Locked precedence); otherwise only the explicit global
  default is evaluated. Parent/cwd
  symlink aliases remain supported through realpath canonicalization.
- Settings read permission error: fail closed at that precedence level.
- Heartbeat failure: continue normal saver decision.
- Compression/event write failure: preserve the hook invariant—emit no
  replacement output so Claude receives the original result.

## Testing strategy (TDD)

| Case | Required result |
| --- | --- |
| Exact override | exact enabled/disabled wins over family/global |
| Platform identity | SHA-256 filename/digest + `identityPath` verification; canonical-path aliases (`/tmp` ↔ `/private/tmp`, symlinked parents); case-sensitive and insensitive APFS; win32 drive/case/separators; linux case rules; unknown-case diagnostic pinned without repository conflation; family records survive simulated dev/inode change (reboot, remount, copy-restore) |
| Degraded precedence | budget/metadata failure treats an unversioned main-root record as invalid (fail closed), never stage-1 exact; `not_git` applies it as exact |
| Scope echo | enable/disable CLI/GUI responses state the written scope and coverage |
| Status reads | non-mutating; no heartbeat lock taken; pruning happens only on write paths |
| Main + nested worktree | shared common-dir resolves the same family |
| External worktree | `gitdir` + `commondir` + reciprocal pointer resolve the same family without spawning Git |
| Separate git dir | main checkout (`.git` file, no commondir ⇒ common dir = gitdir) and a linked worktree added to it (`commondir` ⇒ same gitdir) resolve to the SAME family key; submodule same; bare has no worktree family |
| Foreign worktree admin | a `.git` file whose gitdir points into another repo's `worktrees/<name>/` is rejected with `foreign_worktree_admin` |
| v1 exact vs corrupt .git | a v1 `scope:"exact"` record wins before Git resolution and survives corrupt/missing `.git` metadata |
| Worktree family write | `enable` from inside a linked worktree defaults to a family record covering the repo; `--exact` opts down to this-checkout-only |
| Legacy activation | raw + canonical main-root key candidates cover `/tmp` aliases; unresolved alias is visible; family disable outranks legacy enabled |
| Global default | applies only when exact/family are absent; missing default stays disabled |
| Invalid nearer record | disabled/invalid; lower precedence is not consulted |
| Metadata parser | LF/CRLF, exact single-space prefix, relative/space path, multiline/NUL/oversize rejection, 32-ancestor/40-syscall budget |
| Path safety | parent symlink alias allowed; leaf metadata symlink and invalid reciprocal pointer rejected with diagnostic |
| Legacy schema | both shipped exact shapes normalize; all new writes are strict v1 |
| Scope semantics | main-root AND linked worktree default family; non-Git dir defaults exact; `--exact` works; exact override is enumerated after repository change |
| CLI/GUI parity | both write one record through the same locked scoped store |
| Hook heartbeat | valid passthrough updates bounded registry; `latest` and `latestCompression` derived not written; strict-newer compare, clock regression, >5-minute future rejection, 30-day TTL, 256 cap, and 10ms contention pinned |
| Global compression source | a qualifying compression updates `latestCompression`; proxy telemetry reader consumes it; clock regression never moves it backward |
| Store security | wrong owner/mode/type, symlink/hardlink and lstat-open-fstat swap, stale activation lock, live-lock contention, owner death, and post-lock reread are pinned |
| Hook integration | family enable compresses eligible output and records under requested worktree key |
| Regression | disabled/small/ineligible/error paths preserve original output |

Use temporary stores and synthetic Git directory/file layouts. No test reads
real Claude configuration or executes Git.

## Risk and governance

Risk is **HIGH** because activation determines whether native tool output is
replaced by evidence-preserving compressed output. This implementation ships
first on its own `feat/saver-activation-inheritance` worktree. Required gates:
full superpowers chain, architect and critic design passes, TDD, `pnpm verify`,
hook smoke evidence, **separate code-reviewer and critic implementation
passes**, verifier pass, and changesets for public package changes.

The two specs share a design-doc branch only; the CRITICAL proxy gate set
governs that branch. Their implementation branches and plans remain separate.

## Acceptance criteria

- Enabling a Git repository activates all worktrees sharing its common-dir
  identity, including external worktrees.
- Darwin and Windows aliases converge when canonicalization or positively known
  case-insensitive volume semantics establish equivalence; case-sensitive and
  unknown volumes never conflate distinct paths.
- Family activation survives reboot, remount, and copy-based restore; a
  different repository at the same canonical path inherits that path's
  activation by documented design.
- An explicit worktree disable wins over family/global settings.
- Repository disable outranks legacy main-root enabled state and reports any
  intentional v1 exact override that still wins.
- Existing main-root activation works without destructive migration.
- CLI, GUI, and hook resolve identical effective settings.
- Compression events remain keyed to the actual worktree/session.
- Status separates configured hooks, observed invocation, and compression.
- Invalid/moved Git metadata reports why family inheritance is unavailable.
- Heartbeat metadata is bounded to 256 keys/30 days, rejects excessive future
  skew, and never moves backward.
- Fresh install and unrelated repositories remain disabled.
