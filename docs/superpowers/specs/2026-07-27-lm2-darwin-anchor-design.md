---
title: LM2 Darwin Anchor Alias Repair
status: approved
risk: high
sources:
  - docs/superpowers/specs/2026-07-20-long-memory-lm2-hybrid-recall-design.md
  - packages/long-memory/src/lm2-secure-fs.ts
  - LongMemEval-V2 real-data transport reproduction, 2026-07-27
---

# LM2 Darwin Anchor Alias Repair

## Problem

LM2's directory-anchor defense opens every ancestor with `O_NOFOLLOW`. On
macOS, `/tmp` and `/var` are root-owned system aliases to `/private/tmp` and
`/private/var`. A benchmark cache beneath either alias is valid and is created
successfully, but the later vector-store anchor rejects the alias before the
first sidecar can be indexed. The synthetic transport fixture calls `realpath`
before constructing its cache path and therefore did not exercise this path.

## Options considered

1. Canonicalize only verified Darwin system aliases at the directory-anchor
   boundary — selected. It preserves `O_NOFOLLOW` for every user-controlled
   path segment and fixes both benchmark and product store roots.
2. Canonicalize every benchmark configuration path — rejected. Resolving an
   arbitrary configured ancestor would silently bless a user-controlled
   symlink, weakening the trusted-root contract.
3. Remove no-follow opening for directory ancestors — rejected. That would
   permit symlink substitution in a high-risk persistent-memory path.

## Design

Before `openDirectoryAnchor` enumerates and opens ancestors, it will recognize
only `/tmp` and `/var` on Darwin. It must verify that the alias is a
root-owned symlink below a root-owned, non-group/non-world-writable parent and
that its resolved target is exactly the corresponding `/private/...` target.
Only then it replaces that first path segment with the physical target. All
other paths retain their existing absolute spelling and no-follow checks.
The normalization helper lives in its own small module so the secure descriptor
implementation remains within the repository's one-responsibility source-size
limit.

The canonicalized path is used only for the descriptor chain. Caller-facing
benchmark configuration remains unchanged, and the control file continues to
bind the created run by device/inode. This is not a general symlink resolver,
does not add a configuration fallback, and does not alter Windows behavior.

## Acceptance evidence

- A Darwin-only transport regression uses a literal `/tmp/...` cache root,
  opens a run, inserts a public trajectory, and receives
  `indexingComplete: true`.
- A unit boundary test proves an arbitrary symlink is still rejected.
- Existing LM2 benchmark transport, filesystem-security, package tests, and
  repository verification remain green.

## Review notes

Scope is one anchor normalization rule. It does not change memory selection,
model behavior, benchmark scoring, or the official-evidence gate. The design
was selected under the user's standing instruction to make implementation
decisions autonomously and is an amendment to the already-approved LM2 design.
