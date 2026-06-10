---
title: '@megasaver/skill-packs'
tags: [entity, package, skill-packs, installer]
sources:
  - docs/superpowers/specs/2026-05-10-hh-skill-packs-design.md
  - docs/superpowers/specs/2026-06-10-skill-packs-real-design.md
status: active
created: 2026-06-10
updated: 2026-06-10
---

# `@megasaver/skill-packs`

Skill-pack loader, discovery, and workspace installer. Placeholder
(HH, v0.3) became real on 2026-06-10 (skill-packs-real spec). Risk
HIGH (new public surface + writes user files).

## Public surface

- `loadPack(packRoot)` — reads + Zod-validates `megasaver-pack.json`,
  guards every `skills[].entry` (structural containment, absolute-path
  and symlink rejection, existence check).
- `discoverPacks({ workspaceRoot, home, xdgDataHome })` — scans
  workspace then global root; workspace wins on name collision (HH
  §4); corrupt packs are skipped with `warnings`, never fail the scan.
- `scanSkillIdConflicts(packs)` — cross-pack duplicate `skill.id`
  detection over an effective (name-deduped) set; shadow-aware.
- `installPack({ sourceDir, workspaceRoot, home, xdgDataHome, force })`
  — validate-before-copy, full-tree symlink sweep, shadow-aware
  conflict scan, atomic copy via `.tmp-<name>` staging + rename.
- `removePack({ name, workspaceRoot })` — workspace-only.
- `SkillPackError` — 7-member closed enum: `manifest_invalid`,
  `manifest_missing`, `pack_already_installed`, `pack_not_found`,
  `pack_path_escape`, `pack_unreadable`, `skill_id_conflict`
  (`not_implemented` retired).

## On-disk layout

```
<workspace>/.megasaver/packs/<name>/   # installs (workspace-local only)
<XDG_DATA_HOME|~/.local/share>/megasaver/packs/<name>/  # global, discovery-only
<packs-root>/.tmp-<name>/              # install staging (ignored by discovery)
```

## Security guards

Containment via `path.relative` (not lexical prefix); absolute entry
paths rejected; symlinks rejected both as entries and anywhere in an
install source tree (escape-pointer prevention, extends the S5
no-symlink stance). All surface as `pack_path_escape`.

## Boundary rules

Depends only on `zod`. apps/cli consumes it directly (`mega pack`) —
admitted to the CLI dependency-graph allow-list; core does NOT depend
on skill-packs.

## Related

- [[entities/cli]] — `mega pack {install,list,remove,info}`.
- Deferred: URL installs, `MEGASAVER_PACK_PATH`, lockfile, signing,
  registry, skill runtime (spec §1).
