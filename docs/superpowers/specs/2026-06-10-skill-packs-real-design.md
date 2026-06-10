---
title: Skill-packs real implementation (loader + installer + CLI)
risk: HIGH
status: design
created: 2026-06-10
updated: 2026-06-10
related:
  - docs/superpowers/specs/2026-05-10-hh-skill-packs-design.md
  - packages/skill-packs/
process:
  - architect design pass: DONE 2026-06-10 (GO-WITH-CHANGES; all changes folded in)
  - critic review: required pre-merge (HIGH per CLAUDE.md §12)
---

# Skill-packs real implementation — loader + installer + CLI

## §0 TL;DR

Implements the subsystem the HH placeholder spec locked: a real
`loadPack`, filesystem discovery, a workspace-local installer, and the
`mega pack {install,list,remove,info}` CLI. Two sub-PRs: **SP1**
(library) and **SP2** (installer ops + CLI). HH §3 pack format, §4
discovery order, §5 install semantics, §6 conflict rules, §7 error
taxonomy are treated as locked contracts — this spec implements them
and resolves the points HH explicitly deferred to "the loader spec".

## §1 Scope

**In:** loadPack (real), discoverPacks, skill-id conflict scan, error
enum widening, installPack/removePack, `mega pack` CLI (4 subcommands,
`--json` parity), security guards (path containment, symlink
rejection), copy atomicity, tests, changeset, wiki.

**Out (documented deferrals):** URL installs (HH §5 `path-or-url` —
path only for now), `MEGASAVER_PACK_PATH` env roots (HH §4.3, v0.4+),
lockfile `packs.lock.json` (HH §6 — single installed version per name
makes it redundant until a registry exists), pack signing/checksums,
remote registry, skill *runtime* (invocation wiring — separate epic).

## §2 SP1 — library (`@megasaver/skill-packs`)

### §2a `loadPack(packRoot: string): Promise<SkillPackManifest>`

1. Read `<packRoot>/megasaver-pack.json`.
   - File absent → `SkillPackError("manifest_missing")`.
   - Other IO error → `SkillPackError("pack_unreadable")`.
   - JSON parse failure → `pack_unreadable` (broken bytes, not a
     schema issue).
2. Validate with `skillPackManifestSchema` → failure:
   `manifest_invalid`.
3. For every `skills[].entry`:
   - Reject absolute paths → `pack_path_escape`.
   - Containment check uses the `path.relative()` + `realpath`
     pattern from
     `packages/output-filter/src/resolve-safe-read-path.ts` (NOT a
     lexical `startsWith` — `/x/packs-evil` must not pass a `/x/packs`
     prefix) → escape: `pack_path_escape`.
   - Entry file must exist and (via `lstat`) must not be a symlink;
     missing → `pack_unreadable` (HH §7: "IO error reading manifest
     or entries"); symlink → `pack_path_escape` with a
     symlink-specific message (no new enum member — stays within the
     HH §7 reserved list).
4. Returns the validated manifest.

### §2b `discoverPacks(input): DiscoveryResult`

```ts
type DiscoverInput = {
  workspaceRoot: string;
  home: string;
  xdgDataHome: string | undefined; // fallback <home>/.local/share (mirrors apps/cli/src/store.ts)
};
type DiscoveredPack = {
  manifest: SkillPackManifest;
  root: string;             // absolute pack dir
  source: "workspace" | "global";
};
type DiscoveryResult = {
  packs: DiscoveredPack[];  // deduped: workspace wins on name (HH §4)
  warnings: string[];       // skipped packs: "<dir>: <code/message>"
};
```

Scan order: `<workspaceRoot>/.megasaver/packs/*/` then
`<global>/megasaver/packs/*/` where global =
`xdgDataHome ?? join(home, ".local", "share")`. Each candidate dir
goes through `loadPack`; failures are **skipped with a warning**, never
fail the scan (a corrupt manifest cannot mask a skill-id conflict —
its skills can't load anyway; the fail-closed permissions precedent is
a security gate, not enumeration). Missing roots → empty scan, no
warning.

### §2c `scanSkillIdConflicts(packs: DiscoveredPack[]): SkillIdConflict[]`

Pure function over the **effective** (already name-deduped) set:
returns `{ skillId, packs: [name, name] }[]` for every `skill.id`
declared by ≥2 packs. Shadow-aware by construction: callers dedupe by
name BEFORE scanning, and an installer replacing/shadowing a same-name
pack excludes the displaced pack from the scan set (architect finding
#1 — otherwise `--force` reinstall and workspace-shadows-global would
self-conflict).

### §2d Error enum widening

`skillPackErrorCodeSchema` becomes (alphabetic, AA3 tuple pin updated
in the same PR):

```
manifest_invalid | manifest_missing | pack_already_installed |
pack_not_found | pack_path_escape | pack_unreadable | skill_id_conflict
```

`not_implemented` is **removed**: grep confirms zero external
importers (package is 0.x; no backward-compat shims pre-1.0, CLAUDE.md
§13). `packages/mcp-bridge/src/errors.ts` has its own separate
`not_implemented` member — untouched. SP1 ships
`pack_already_installed`/`pack_not_found` with no SP1 caller: codes
are data; HH §7 mandates a single widening + pin update in one PR —
explicitly NOT a half-implementation.

## §3 SP2 — installer + CLI

### §3a `installPack({ sourceDir, workspaceRoot, force }): Promise<InstalledPack>`

1. `loadPack(sourceDir)` — validate BEFORE any copy (HH §5).
2. Symlink sweep: `lstat`-walk the ENTIRE source tree; any symlink →
   `pack_path_escape` (symlink-specific message). Preserving a
   symlink would plant an escape pointer inside the workspace;
   dereferencing would copy external content in. (Architect finding
   #5b; extends the S5 `writeTargetFile` no-symlink stance.)
3. Effective-set conflict scan: `discoverPacks(...)`, drop any pack
   whose name equals the incoming manifest name (it is being
   replaced/shadowed), add the incoming pack, run
   `scanSkillIdConflicts` → conflict: `skill_id_conflict`.
4. Collision: `<workspaceRoot>/.megasaver/packs/<name>` exists →
   `pack_already_installed` unless `force` (then replaced).
5. **Atomic copy** (HH §5 deferred "atomicWriteFile semantics" to this
   spec): recursive copy to `<packs-root>/.tmp-<name>`, then `rm` the
   old dir (force path) and `rename` into place; on any failure the
   temp dir is removed — an interrupted install must never poison a
   later `pack_already_installed` check. `.tmp-*` dirs are ignored by
   discovery.
6. Install root is workspace-local ONLY (HH §5); the global root is
   discovery-only (user-managed).

### §3b `removePack({ name, workspaceRoot })`

`rm -rf <workspaceRoot>/.megasaver/packs/<name>`; absent →
`pack_not_found`. Workspace-only; never touches the global root.
Leaves memory entries/sessions untouched (HH §5).

### §3c CLI `mega pack` (mounted in `apps/cli/src/main.ts` subCommands)

| Command | Behavior |
|---|---|
| `install <path> [--force]` | §3a; text `Installed <name>@<version> (<kind>, N skills)` |
| `list` | discovery over both roots; one line per pack `name@version kind source`; discovery warnings → stderr |
| `remove <name>` | §3b; text `Removed <name>` |
| `info <name>` | workspace-beats-global resolution; renders manifest fields |

All four take `--root <dir>` (workspace root, default
`process.cwd()` — mirrors `mega project create --root`; future skill
runtime will key off the registered `project.rootPath`, so the spec
notes install root must equal the registered project root) and
`--json` (repo parity: `type: "boolean"`, `default: false`,
description `"Emit JSON output."`). Failure paths: text stderr, exit
1, no stdout. `list --json` carries `{ packs, warnings }`.
`SkillPackError` codes map to canonical `error: <code>: <detail>`
lines in `apps/cli/src/errors.ts` (one helper, code-driven — the enum
is closed).

## §4 Testing

- **SP1 unit (temp-dir fixtures):** valid pack loads; missing
  manifest → `manifest_missing`; garbage JSON → `pack_unreadable`;
  schema fail → `manifest_invalid`; `../escape` entry, absolute
  entry, symlinked entry → `pack_path_escape`; missing entry file →
  `pack_unreadable`; discovery order + workspace-wins dedupe;
  corrupt pack skipped with warning while siblings load; conflict
  scan incl. shadow case (workspace pack shadows same-name global —
  NO self-conflict).
- **SP1 type pins:** rewritten `.test-d.ts` tuple pins for the
  7-member error enum; kind/capability pins unchanged.
- **SP2 unit:** install happy path; validate-before-copy (invalid
  pack leaves packs-root untouched); collision ± `--force`;
  skill-id conflict blocks install; symlink-in-tree rejected;
  interrupted-copy cleanup (temp dir absent after failure; second
  install succeeds); remove happy + `pack_not_found`.
- **CLI:** 4 commands × text/`--json` success + failure-path policy
  tests (stderr only, exit 1); drift guards on `--json` flag shape
  (describe.each pattern); `info` workspace-beats-global.
- **E2E smoke:** temp store + temp workspace: install → list → info
  → remove round-trip in both output modes.

## §5 Definition of Done (HIGH)

CLAUDE.md §9 + §12 HIGH: spec (this) + plan + TDD + `pnpm verify`
green + smoke evidence + **critic** (adversarial) review with
author ≠ reviewer + verifier evidence + changeset
(`@megasaver/skill-packs` minor — public surface; `@megasaver/cli`
minor — new command group) + wiki (`entities/skill-packs.md` NEW page
— closes the index "pending" slot — plus `entities/cli.md`,
`index.md`, `log.md`).
