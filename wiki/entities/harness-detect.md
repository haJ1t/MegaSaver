---
title: '@megasaver/harness-detect'
tags: [entity, detection, connector, harness-autodetect]
sources:
  - docs/superpowers/specs/2026-08-26-harness-autodetect-design.md
  - docs/superpowers/plans/2026-08-26-harness-autodetect-plan.md
status: shipped (reviewer-approved)
created: 2026-08-26
updated: 2026-08-26
---

# `@megasaver/harness-detect`

Machine-level agent-harness detection (2026-08-26, harness-autodetect).
Leaf package — depends only on `@megasaver/shared` (AgentId) + zod; no
core edge, no fs in the pure engine. Powers `mega detect` and the
`mega init` harness-scan/auto-configure step.

## Catalog — `HARNESS_CATALOG` (39 entries)

The researched 2026 popular-harness set (spec §3): 28 cli + 6 ide +
5 extension. User-named anchors present: deepseek, cursor, openclaw,
hermes.

Each `HarnessDescriptor`: `{ id (AgentId), name, category, binaries[],
configDirs[] (~/-relative), extensionDirs[] ({parent, prefix}),
projectMarkers[], connectorTargetId | null, coveredByTargetId | null }`.

- **Dedicated targets (16)**: claude-code, codex, gemini, aider,
  opencode (`.opencode/rules/megasaver.md`), amazon-q, copilot, qwen,
  cursor, windsurf, continue, trae, antigravity + the new extension
  targets cline (`.clinerules/`), roo-code (`.roo/rules/`),
  kilo-code (`.kilocode/rules/`).
- **AGENTS.md family folds onto `codex`** (`coveredByTargetId`): goose,
  crush, amp, iflow, droid, warp, zed — one file, many readers, one
  sync.
- **Detection-only (16)**: plandex, openclaw, deepseek, hermes,
  openhands, gptme, grok, bits, tabby, refact, cody, mentat,
  gpt-engineer, devin, qodo, avante.

## Detection engine

- `detectHarnesses({ probes, ids? })` → one `HarnessDetection` per
  catalog entry (catalog order): `{ id, name, category, detected,
  matchedSignals[{kind, detail}], connectorTargetId, coveredByTargetId,
  effectiveTargetId }`. `effectiveTargetId` = dedicated ?? coveredBy ??
  null — the auto-configure key.
- `createNodeProbes({ home, projectRoot, platform, envPath })` — real
  adapters: PATH lookup (PATHEXT on win32), home-relative dirs
  (`~/…` only — never outside home), extension-dir prefix scan
  (`saoudrizwan.claude-dev-*` versioned folders), project markers
  (root-escape refused).

## Honest-detection contract

- `detected` iff ≥ 1 real signal matched; `matchedSignals` records
  exactly what matched. No confidence tiers, no version claims, no
  content reads, no binary spawns, no network.
- Real-machine receipt (2026-08-26, this dev Mac): `detected 6 of 39`
  — claude-code, codex, gemini, opencode, hermes, cursor. (The earlier
  12-count included the AGENTS.md-marker false positives that critic F1
  removed — the post-fix number is the honest one.)

## CLI surfaces

- `mega detect [--json]` — 39 text lines + `detected N of 39` summary;
  `--json` full record array; always exit 0.
- `mega init` step 4 "harness scan + auto-configure" — detects, prints
  detected harnesses with their target mapping, then seeds connector
  blocks (`runConnectorSync --target <id>` per unique
  `effectiveTargetId`) when cwd resolves to a registered project;
  otherwise an honest skip + `mega project create` hint.
  `filterSyncLine` drops the per-sync `skipped` noise (15 of 16 lines).
  Init smoke receipt (isolated HOME): detected 4 (claude-code, codex,
  opencode, hermes — hermes maps to no target), seeded CLAUDE.md +
  AGENTS.md + `.opencode/rules/megasaver.md`, all steps ✓.

## Related

- [[entities/connectors-generic-cli]] (targets 6 → 15)
- [[entities/shared]] (agentIdSchema 8 → 40)
- [[entities/cli]] (`mega detect`, init step)
- [[concepts/agent-agnostic-core]]
