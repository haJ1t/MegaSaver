---
title: v1.0.0 stable reset — version pin down + legacy purge
tags: [decision, release, versioning]
sources:
  - PR #365 (chore/release-1-0-0, merged as feab158e)
  - PR #366 (docs/wiki-v1-release)
  - release.yml (tag-triggered publish pipeline)
status: active
created: 2026-08-24
updated: 2026-08-24
---

# v1.0.0 Stable Reset

**Decision (2026-08-24):** the product's first stable line is
`@megasaver/cli@1.0.0` + GitHub Release `v1.0.0`, cut from `main` at
`feab158e` (PR #365). Three locked-in sub-decisions:

## 1. Version pinned DOWN to 1.0.0 (from npm's 2.6.0)

The number was free: npm history starts at **1.0.2** (2026-06-17); the
May-era git tags `v1.0.0` / `v1.0.1` never reached npm, so the reuse is
clean under npm's no-version-reuse rule. Accepted cost (intentional):
`^2.x` consumers never see 1.x as an update — semver regression is part
of the reset, not an accident.

## 2. All prior GitHub releases and tags deleted

22 releases + every tag (including stale `v1.0.0`/`v1.0.1`) purged at
operator request. GitHub now shows exactly one release — **v1.0.0**
(Latest) with `mega.mjs` + `mega-1.0.0.mjs` assets from `release.yml`.
History is preserved in this wiki ([[syntheses/release-history]],
[[log]]), not in GitHub artifacts.

## 3. npm legacy versions deprecated, not deleted

`npm unpublish` is blocked in practice (>72h rule + EOTP 2FA), and a
deleted version number can never be republished — so deprecation is the
honest mechanism. Sweep over the 23 legacy versions (1.0.2 → 2.6.0)
pending operator 2FA authentication; command handed off in session
2026-08-24. Until then legacy versions stay installable but unmarked.

## Why a reset at all

One honest "stable" marker instead of a 23-version tail. The changeset
backlog (17 files) was versioned in the same cut so CHANGELOGs are true
as of 1.0.0.

## Disambiguation (critical)

"v1.0" of **2026-05-13** was the AA1 Context Gate epic. It briefly wore a
git `v1.0.0` tag but was never on npm and that tag is now deleted. The
**2026-08-24** `v1.0.0` is THE product stable. Any pre-2026-08 reference
to "v1.0" in the wiki means the AA1 epic, not this release.
