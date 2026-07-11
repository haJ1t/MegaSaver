---
title: Brain Sync (E7) — E2E-encrypted BYO S3 brain sync
tags: [feature, cli, pro, 2.1, e7, crypto, critical, anti-lock-in]
sources:
  - docs/superpowers/specs/2026-07-11-brain-sync-design.md
  - docs/superpowers/plans/2026-07-11-brain-sync-plan.md
status: active
created: 2026-07-11
updated: 2026-07-11
---

The 2.1 flagship: `mega brain sync` keeps a project brain identical across the
user's machines through their OWN S3-compatible bucket (Cloudflare R2, AWS S3,
B2, MinIO). All content is AES-256-GCM encrypted client-side — the provider
only ever sees ciphertext. First cloud service; recurring infra justifies the
recurring price; the Team-tier foundation. Package `@megasaver/brain-sync`;
branch `worktree-brain-sync`. Reuses 2.0 [[entities/brain-portability]]
export/import (opaque `bundleText`); it does NOT import [[entities/core]].

## Module surface

- `crypto` — AES-256-GCM seal/open, brainId-bound AAD.
- `brain-id` — `deriveBrainId(key, name) = sha256(key ‖ normalize(name))`:
  the cross-machine identity (same key + same project name → same brain).
- `keyfile` — 256-bit key at `<store-root>/brain-sync.key` + one-time recovery
  code (RFC4648 base32); no passphrase derivation.
- `config` — `brain-sync.json` schema + `assertSafeEndpoint` (HTTPS-only).
- `manifest` — sealed sync manifest (`generation`, content hashes).
- `transport` — S3 client (in-memory bodies, path-style) + conditional-write
  probe; `@aws-sdk/client-s3` lazy dynamic-imported.
- `sync` — CAS engine: `pull`/`push`/`status` over content-addressed objects.

## CLI commands (5)

`init` (probe endpoint, write keyfile+config, print recovery code) ·
`push` · `pull` · `status` · `reset <project> --force`. Pro-gated on the
existing `"brain-portability"` entitlement key.

## Key decisions

- **brainId-bound AAD** — every AAD binds `brainId` (the key-salted
  cross-machine identity), so a bundle sealed for one brain cannot be opened
  as another (cross-brain binding), and the same brain syncs across machines.
- **Content-addressed objects + manifest CAS** — push is a compare-and-swap on
  the manifest generation; concurrent writers conflict, never clobber.
- **Conditional-write init probe** — `init` rejects endpoints that do not
  enforce `If-Match`/`If-None-Match` (protocol needs real CAS).
- **Config-first / keyfile-last** — durable keyfile+config write precedes the
  recovery-code print, so no unrecoverable half-state.
- **Bundle externalize** ([[decisions/bundle-externalize-native-chain]]) —
  `@aws-sdk/client-s3` inlined +1.26MB and breached the 12MB `mega.mjs` guard
  (12.88 MiB); externalized (optionalDependency) → back to 11.68 MiB. Absent →
  friendly `transport_error`.

## Risk & status

Risk **CRITICAL** (E2E crypto, [[concepts/risk-aware-development]]). Implemented
(16-task TDD plan, subagent-driven) + whole-branch gauntlet PASSED: it found
2 design blockers (B1 cross-machine identity → now a key-salted `brainId`;
B2 remote-regression → push-guard) + HIGH/M1 (reset clears last-seen), all
fixed and re-verified closed with no new Critical/High. Full repo `pnpm verify`
green. Pending only: real-endpoint (MinIO/R2) smoke evidence + explicit user
release approval before PR/merge (see [[log]] 2026-07-11).
