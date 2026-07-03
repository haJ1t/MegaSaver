---
"@megasaver/shared": minor
"@megasaver/context-gate": minor
"@megasaver/cli": minor
"@megasaver/gui": minor
---

Saver activation inheritance across Git worktrees: a repository-family setting is
inherited by every worktree sharing the same canonical Git common directory, so an
enabled repo covers its `.claude/worktrees/...` sessions. Fixes the live case where
an enabled main repo left its worktree sessions uncompressed.

- `@megasaver/shared`: new `RepositoryFamilyKey` branded type (`gf1_` + base64url
  SHA-256), browser-safe validator.
- `@megasaver/context-gate`: canonical-path family identity (platform/volume-aware,
  durable across reboot/remount/restore), a bounded Git common-directory resolver
  (no subprocess; separate-git-dir main + worktrees converge; foreign worktree-admin
  pointers rejected), a hardened v1 activation store (exact/family/global records +
  legacy-shape normalization, atomic 0600/0700 writes, digest fail-closed, activation
  lock), the `resolveWorkspaceTokenSaverSettings` precedence (exact → repository →
  legacy-root → global → disabled; degraded git never resurrects a legacy record but
  the global default still applies), a bounded heartbeat registry (256/30d/future-skew,
  derived `latest`/`latestCompression`, non-mutating reads) that also feeds proxy
  status, and the shared `resolveActivationScope`/`writeActivation` helpers.
- `@megasaver/cli`: the PostToolUse saver hook now resolves activation through the
  repository-family precedence (a worktree inherits its repo's enable) and writes
  invocation/compression liveness heartbeats. `mega session saver workspace
  {enable,disable}` is repository-aware (family record by default in a repo, `--exact`
  for this checkout only, scope echo); new `default {enable,disable}` writes the global
  default; new `resolve` shows the resolved activation + liveness. **Public behavior
  change:** the activation record shape is now strict v1 and the workspace toggle
  defaults to family scope inside a repo.
- `@megasaver/gui`: the workspace saver toggle writes through the same shared scope
  helper (family inside a repo) and reports the effective inherited activation + source.
