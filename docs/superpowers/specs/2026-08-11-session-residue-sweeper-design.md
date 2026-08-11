---
feature: session-residue-sweeper
date: 2026-08-11
risk: HIGH
status: draft-design
pending: [user-spec-review, architect-pass]
reviewers: [code-reviewer, critic]
build-order: "2 of 9 (wave-3 batch)"
---

# Session Residue Sweeper — Quarantine, Never Delete (P0-2)

## Problem

Agents leave litter: `*.tmp`, half-written test files, `node_modules/.cache` shards, `.DS_Store`, stray `dist/*.js` that was never committed, and "fix attempt" files the user never asked for. `git status` shows the mess but does not tell which files belong to the task and which are residue. Real `rm -rf` is CRITICAL risk (data loss, §12) and forbidden without confirmation. Wave-2 backlog deferred `session-residue-sweeper` as "`agent litter manifest + quarantine sweep (never deletes)`" (`wiki/syntheses/next-wave-2-ideas-2026-08-06.md:72`) — the funnel needs it once preflight snapshots exist.

## Goal

1. `mega sweep scan [--preflight <id>]` builds a **residue manifest** — a ranked list of workspace files that look like litter, with provenance: untracked vs. unstaged, age, size, ignore-match, and which snapshot they appeared in.
2. `mega sweep quarantine <manifest-or-path> [--dry-run]` moves the selected files into `.megasaver/quarantine/<ts>-<id>/` (preserving relative paths), writes a `manifest.json` + `undo.sh`, and never deletes.
3. `mega sweep restore <quarantine-id>` moves them back, detecting collisions (target exists → skip + warn).

Success criteria: scan finds staged/unstaged/untracked residue deterministically; quarantine never deletes (rename only); undo restores byte-identical files; `pnpm verify` green.

## Non-Goals (YAGNI)

- No `delete` command — quarantine only. No `git clean` passthrough (git ignore rules are used for ranking but git is never asked to delete).
- No cross-workspace sweep (same `workspaceKey` only).
- No LLM classifier ("this file looks important") — deterministic heuristics only.
- No automatic sweep on SessionEnd hook in v1 (manual only; hook is follow-up).
- No GUI surface in v1.

## Locked Decisions

1. **Quarantine, not delete — rename is the mutation.** Every swept file is moved by `renameSync` (same device) or `copyFileSync`+`unlinkSync` fallback (cross-device). No `rm`/`rmSync` on user files is executed; the command fails closed if neither rename nor copy succeeds. Manifest records `from` (repo-relative), `to` (quarantine-relative), `size`, `mtimeMs`, `hash(sha256)`, `move` (`rename|copy`), and the preflight snapshot id used as ground truth when present.
2. **Ground truth is the preflight snapshot diff when available.** If `scan --preflight <A>` is given, residue = paths that appear in `snapshot B(current)` but not in `A` and are not covered by the chunk-set evidence (`listPreflightSnapshots` + `listChunkSets`). Without a snapshot, scan falls back to `captureGitState` (`apps/cli/src/preflight/git-capture.ts`, P0-1) + ignore-aware untracked enumeration — same source as `mega preflight snapshot`.
3. **Ranking heuristics (deterministic, no ML).** Each untracked/unstaged path is scored into buckets: `tmp` (`.tmp`, `*.log`, `*.bak`, `.DS_Store`, `thumbs.db`, `*.swp`), `build-output` (untracked under `dist/`, `build/`, `coverage/` that matches tracked `src/` counterparts), `agent-draft` (files whose mtime is within the session window and whose content never landed in a chunk-set), `cache` (`node_modules/.cache`, `.turbo`, `.next/cache`), `other`. Buckets are ordered `tmp > cache > build-output > agent-draft > other`; within-bucket lexicographic.
4. **Never sweep policy fences or secrets.** Paths matching `@megasaver/policy` fence.yaml (`packages/policy/src/fence.ts` pattern set, including `generated-file-fence` `docs/superpowers/specs/2026-08-06-generated-file-fence-design.md` outputs) are excluded. Files whose name contains `secret`/`credential`/`key` hints and files whose content matches the secret redaction table (`packages/policy/src/redact.ts` patterns) are refused (stderr warn + skip) — same defense as `runCapsuleHook` redaction depth.
5. **Quarantine dir contract.** `.megasaver/quarantine/<ts>-<6id>/` lives under the repo root (not inside `store/`), so `git status` shows the quarantine as untracked (auditable). `manifest.json` is the authority; `undo.sh` is a convenience (`mv` back). Quarantine dir is created 0700/0755; manifest 0600. A per-workspace `quarantine-index.json` (`store/stats/<wk>/quarantine-index.json`) lists active quarantines for `restore --last`.
6. **Collision-safe restore.** `restore` checks `existsSync(target)` before each move; collision → skip, record `skipped: [{path, reason:"target exists"}]` in the restore receipt, exit 1 with summary. No overwrite (`--force` does not exist).
7. **Ownership.** `apps/cli` owns all three commands; `@megasaver/policy` provides `isFencedPath` / `redact` helpers; `@megasaver/content-store` provides `listPreflightSnapshots` / `readPreflightSnapshot` (P0-1) consumed read-only; no new store schema beyond `quarantine-index.json`.

## Architecture

```
scan:   resolveStorePath + findProjectByCwd + gitCapture/cached snapshot
        enumerateRepoFiles (readdir walk, ignore-aware, bounded depth)
        join preflight untracked + git untracked + staged/unstaged
        rankIntoBuckets -> ResidueManifest (sorted, capped)

quarantine: load manifest (or build from path list) + policy fence check
            for each entry: rename/copy to .megasaver/quarantine/<ts>-<id>/<relPath>
            write manifest.json + undo.sh + update quarantine-index.json
            stdout: "quarantined N files -> .megasaver/quarantine/<id>"

restore: read manifest.json (Zod strict) -> for each entry move back
         -> receipt JSON (moved/skipped counts)
```

## Components

- **C1 `apps/cli/src/sweep/rank.ts` (pure):** `rankResidue(paths, ctx): RankedBucket[]`, bucket constants, `isFencedPath` glue, `isQuarantinePath` guard (refuse to rank the quarantine dir itself).
- **C2 `apps/cli/src/sweep/quarantine.ts`:** `quarantineFiles`, `restoreQuarantine`, `quarantineIndex` read/write (atomic, Zod strict). No shell, rename/copy only.
- **C3 `apps/cli/src/commands/sweep/{scan,quarantine,restore,index}.ts`:** citty commands `mega sweep scan|quarantine|restore`; index command wires children.
- **C4 `apps/cli/src/commands/sweep/scan.ts`:** `runSweepScan` — the io-injected entry that joins preflight/git sources and renders text/JSON.

## Error handling

- Unsafe path in manifest (`../`, absolute, `//`) → `error: unsafe path "<p>"` exit 1 before any move (mirrors `isSafeHookSessionId` posture).
- Fenced/secret path in selection → skip with `warning: skipped fenced path "<p>"` and continue (fail-open per quarantine, not per file).
- Cross-device rename EXDEV → copy+unlink fallback; if unlink fails, the quarantine copy is removed and that entry is marked `failed` (no partial state).
- No quarantines for `restore --last` → `error: no quarantine found` exit 1.
- Store missing / no project match → same workspace-key refusal as preflight P0-1.

## Security & privacy

- Paths are validated by a strict `SAFE_REL_PATH = /^[A-Za-z0-9][A-Za-z0-9._\-\/]{0,511}$/` plus `path.normalize` + `!path.isAbsolute` + `!rel.startsWith("..")` triple-check before any `renameSync` — no directory traversal.
- Quarantine files retain original permissions; manifest is redacted via `redact()` on path strings before persist (secrets in names never hit the index in cleartext).
- `undo.sh` is generated with single-quoted, shell-escaped paths (`'...'` + `'\''` escape); it is never auto-executed, only printed and written.
- Quarantine dir is repo-local (never leaves the machine), never networked.

## Testing

- **Unit (TDD):** ranking buckets (each suffix → expected bucket), fence skip (generated-file-fence patterns → excluded), unsafe-path guard (traversal → throws), diff vs snapshot join (only new untracked → residue), quarantine naming (`<ts>-<6id>` regex), manifest schema strictness.
- **Integration:** tmp repo + tmp store → `runSweepScan` finds `a.tmp` + `dist/foo.js` while ignoring `.megasaver/quarantine` itself; `quarantine` moves files byte-identically (`sha256` before == after); `restore` moves back and second restore → `skipped: target exists`; fenced file (`fence.yaml` marks `generated/**/*.js` → skip).
- **Regression:** chunk-store listing still green with quarantine dirs present (repo walk never enters `.megasaver/`).

## Risk & process

**HIGH** (§12: mutates user workspace by moving files, even though never deleting). Worktree mandatory; `architect` + `critic` separate passes; `security-reviewer` recommended for the path-validation + EXDEV fallback. Spec frontmatter already `HIGH`. No `--force`, no overwrite.

## Dependencies / build order

- Requires **P0-1 preflight** (`listPreflightSnapshots` + `git-capture` helpers) — consumes, never redefines.
- Consumed by nothing in v1, but **P1-1 evidence-bundle** may embed the quarantine manifest id as bundle metadata.
- Build order **2 of 9 (wave-3 batch)** — after preflight, before evidence-bundle.

## Open questions

1. Should `scan` also flag tracked but never-committed large binaries (>5MB) as residue, or keep to untracked/unstaged only? (v1: untracked/unstaged focus.)
2. Quarantine index in `store/` vs `.megasaver/` — v1 is `store/stats/<wk>/quarantine-index.json` for cross-clone consistency; `.megasaver/quarantine-index.json` is alternative for repo-portability.
