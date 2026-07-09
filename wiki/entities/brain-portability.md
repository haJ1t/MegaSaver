---
title: Brain Portability (E5) — portable project brain
tags: [feature, cli, core, pro, 2.0, e5, anti-lock-in]
sources:
  - docs/superpowers/specs/2026-07-09-brain-portability-design.md
  - docs/superpowers/plans/2026-07-09-brain-portability-plan.md
status: active
created: 2026-07-09
updated: 2026-07-09
---

The 2.0 flagship: export a project's knowledge layer to a portable,
integrity-hashed `.megabrain` bundle and import it into another project.
Anti-lock-in ("your brain travels"); Pro-gated. Branch `feat/brain-portability`,
awaiting review + merge.

## Surface

- `mega brain export <project> [--out] [--json]` — writes the bundle.
- `mega brain import <project> <file> [--json]` — merges it in.
- Both Pro-gated on entitlement key `brain-portability` (gate FIRST; free path
  prints upsell, exit 0, never opens the store or reads the file).

## Bundle format ([[entities/core]] `brain-bundle.ts`)

Two-line NDJSON: line 1 = manifest JSON, line 2 = payload JSON.
`payloadSha256` = SHA-256 over the raw payload-line bytes (integrity, not
authenticity — no keypairs in 2.0). Manifest carries `schemaVersion "1"`,
`kind "megabrain"`, `sourceProject`, `counts`, `redactionFindings`.

## Export (`brain-export.ts`)

Only `approval === "approved"` AND `scope === "project"` memories (session-scoped
ones reference sessions absent in the target); all rules; all failures. Every
free-text field passes `redactWithFindings` (@megasaver/policy firewall); findings
counted in the manifest. Atomic tmp+rename write.

## Import (`brain-import.ts`)

`parseBrainBundle` verifies the hash BEFORE any write (tamper → `BrainBundleError`,
nothing written). Merge-only: every entity created as NEW (fresh lowercase-UUID id,
target projectId), memories forced `approval: "suggested"`, `sessionId: null`,
`scope: "project"`, `supersedesId` dropped, provenance `brain-import:<src>` appended
to `evidence[]`, original `source` enum preserved. Exact-match dedupe (memory by
content, rule by rule text, failure by `task\0failedStep`) against project-scoped
existing rows + within-bundle; skips counted. Nothing reaches agents until
`mega memory approve`.

## Deferred (not in 2.0)

Embeddings/sessions/stats in bundle; Ed25519 authenticity; semantic dedupe;
graph serialization (derived — `buildGraph` rebuilds post-import); remote/Team
sharing (N6); `--replace`.

## Public core API

`exportBrain` / `importBrain` / `parseBrainBundle` / `serializeBrainBundle`
(+ `brainManifestSchema` / `brainPayloadSchema` / `BrainBundleError`).
