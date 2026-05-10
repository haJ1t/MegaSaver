---
title: HH — skill-packs scaffolding (placeholder spec)
risk: LOW
status: design
created: 2026-05-10
updated: 2026-05-10
related:
  - packages/skill-packs/
  - docs/superpowers/specs/2026-05-10-hh-mcp-bridge-design.md
  - docs/superpowers/plans/2026-05-10-hh-mcp-skillpacks.md
---

# HH — `@megasaver/skill-packs` scaffolding (placeholder spec)

## §0 TL;DR

`skill-packs` is the v0.3+ subsystem that lets Mega Saver
distribute **skill bundles** — Mega-Saver-native packages of
skills, prompt templates, and capability manifests — installable
into a Mega Saver workspace. Think OMC `superpowers` / `omc`
plugins, but versioned, signed, and addressable through the
Mega Saver CLI.

v0.3 ships a **scaffold-only placeholder**: workspace slot
reserved, manifest types locked, `loadPack(path)` factory throws
`not_implemented`. Real loader / installer defers to a follow-up
spec.

## §1 Motivation

The fikri calls out "skill packs" as one of the six subsystems.
v0.2 shipped:

- A connector matrix that pushes per-agent config files into the
  user's repo.
- A memory/session/project model in `@megasaver/core`.

What is **missing**: a way for users to install a third-party
**bundle** of skills that the Mega Saver CLI can list, enable,
and route to. Today, OMC users do this manually
(`~/.claude/skills/*`); Mega Saver should offer a first-class,
auditable equivalent.

Reserving the package slot now means:

- `@megasaver/skill-packs` enters `pnpm-workspace.yaml` with a
  pinned manifest type.
- Future authors of skill packs have a stable manifest schema
  to target — no churning the format once packs exist in the
  wild.
- Discovery / install / version / conflict rules are surfaced
  in this spec, locked, before the loader lands.

## §2 Public surface (v0.3 placeholder)

```ts
import {
  loadPack,
  type SkillPackManifest,
  type SkillPackCapability,
  type SkillPackKind,
} from "@megasaver/skill-packs";

const manifest = await loadPack("/path/to/pack");
// throws SkillPackError("not_implemented", ...) in v0.3
```

### §2a Manifest type (locked)

```ts
type SkillPackManifest = {
  readonly name: string;            // kebab-case; globally unique per workspace
  readonly version: string;         // SemVer 2.0.0 (validated by Zod)
  readonly kind: SkillPackKind;     // closed enum
  readonly skills: ReadonlyArray<SkillRef>;
  readonly capabilities: ReadonlyArray<SkillPackCapability>;
  readonly description: string | null;
};

type SkillRef = {
  readonly id: string;              // kebab-case
  readonly entry: string;           // relative path inside the pack
};
```

The manifest is validated against `skillPackManifestSchema`
(Zod) at every boundary — `loadPack`, `install`, `list`. The
schema **is** the contract; the TS type is `z.infer<...>`.

### §2b Closed enums (compile-time pinned)

Two closed-enum surfaces ship in v0.3:

1. **`SkillPackKind`** — top-level category. v0.3 members:
   `prompt | skill | workflow`. Tuple order: alphabetic
   (parallels `agentIdSchema`). Rationale:
   - `prompt` — a bundle of prompt templates only (no
     executable hooks).
   - `skill` — a bundle of skill definitions (OMC-style
     trigger + body markdown).
   - `workflow` — a bundle wiring multiple skills + tools
     together (chained skills, e.g. `autopilot`-style).
2. **`SkillPackCapability`** — declared permissions a pack
   needs. v0.3 members: `network | read-memory | write-memory`.
   Tuple order: alphabetic. Rationale:
   - `network` — pack may issue outbound HTTP (web search,
     doc fetch).
   - `read-memory` — pack may read project / session memory
     entries via Core.
   - `write-memory` — pack may write project / session memory
     entries via Core.

Both schemas live in `packages/skill-packs/src/` and re-export
from `index.ts`. `.test-d.ts` regression suites parallel
`packages/shared/test/agent-id.test-d.ts`.

### §2c `loadPack(path)` contract

- Async; no IO performed in v0.3 (throws before touching the
  filesystem).
- Validates `path` is a non-empty string at the boundary.
- v0.3: always rejects with `SkillPackError("not_implemented", ...)`.

### §2d `SkillPackError` shape

Mirrors `CorePersistenceError`:

```ts
export class SkillPackError extends Error {
  readonly code: SkillPackErrorCode;
  readonly packPath: string | null;
  constructor(
    code: SkillPackErrorCode,
    message: string,
    options?: { packPath?: string; cause?: unknown },
  );
}
```

v0.3 `SkillPackErrorCode` members: `not_implemented` (sole
member). Future reserved codes documented in §7.

## §3 Pack format (future scope)

Locked here so authors do not need to retro-fit:

```
my-pack/
├─ megasaver-pack.json    # manifest (SkillPackManifest as JSON)
├─ skills/                # if kind === "skill"
│  └─ <skill-id>.md       # markdown body with frontmatter
├─ prompts/               # if kind === "prompt"
│  └─ <prompt-id>.md
└─ workflows/             # if kind === "workflow"
   └─ <workflow-id>.yaml  # composition file
```

Required:

- `megasaver-pack.json` at pack root; validates against
  `skillPackManifestSchema`.
- One subdirectory matches `manifest.kind`; siblings allowed
  for mixed packs (forward-compat).
- `manifest.skills[].entry` paths are relative; resolved
  against pack root; must stay within pack root (no `..`).

## §4 Discovery rules (future scope)

The installer (future spec) scans, in order:

1. `<workspace>/.megasaver/packs/*/megasaver-pack.json` —
   workspace-local installs (per-project).
2. `<XDG_DATA_HOME>/megasaver/packs/*/megasaver-pack.json` —
   user-global installs (cross-project).
3. `<MEGASAVER_PACK_PATH>` env var, colon-separated list of
   roots (deferred to v0.4+).

First match wins on `manifest.name` collision (workspace beats
global — conflict resolution per §6).

## §5 Install / uninstall semantics (future scope)

CLI surface (future v0.3+ spec lands when the loader does):

```
mega pack install <path-or-url>
mega pack list
mega pack remove <name>
mega pack info <name>
```

Install:

- Copies the pack directory to the workspace-local install
  root.
- Validates `megasaver-pack.json` BEFORE copy (`atomicWriteFile`
  semantics deferred to the install spec).
- Refuses if `manifest.name` already exists at the install
  root unless `--force`.

Uninstall:

- Removes the directory at `<install-root>/<name>`.
- Does **not** remove related memory entries / sessions; pack
  data is install-time, not workspace-state.

## §6 Version pinning + conflict resolution (future scope)

- `manifest.version` is SemVer 2.0.0; validated by
  `semverSchema = z.string().regex(/^.../)` (regex locked in
  loader spec).
- Workspace lockfile (`<workspace>/.megasaver/packs.lock.json`)
  pins the installed version per pack name; format mirrors
  `pnpm-lock.yaml`'s philosophy (humans rarely edit).
- Conflict resolution:
  - Same name, different version installed at workspace vs
    global: **workspace wins**.
  - Two packs declaring the same `skill.id`: **error at install
    time** — the user must rename or pick one. Surfaces as
    `SkillPackError("skill_id_conflict", ...)`.

## §7 Error taxonomy

v0.3 codes (one member, alphabetic):

- `not_implemented`

Reserved future codes (NOT in v0.3 schema, listed for
forward-compat):

- `manifest_invalid` — Zod validation failed.
- `manifest_missing` — `megasaver-pack.json` absent.
- `pack_already_installed` — name collision without `--force`.
- `pack_not_found` — `mega pack remove <name>` for unknown.
- `pack_path_escape` — `skill.entry` resolved outside pack
  root (path traversal guard).
- `pack_unreadable` — IO error reading manifest or entries.
- `skill_id_conflict` — two installed packs declare the same
  `skill.id`.

Schema widens in the loader spec; tuple-ordering pin updates
in the same PR (single source of truth — same convention as
`agentIdSchema`).

## §8 Out of scope (v0.3 placeholder)

- The loader implementation (filesystem walk, manifest parse,
  ID conflict scan).
- The installer CLI (`mega pack install/list/remove/info`).
- Pack signing / checksums.
- Pack registry (a curated remote source — possibly v0.5+).
- Skill runtime (how a loaded skill is *invoked*; that ties
  into mcp-bridge + connector adapters).
- Lockfile format.

## §9 Files (v0.3 placeholder)

```
packages/skill-packs/
├─ package.json
├─ tsconfig.json
├─ tsconfig.test.json
├─ tsconfig.test-d.json
├─ tsup.config.ts
├─ vitest.config.ts
├─ src/
│  ├─ index.ts              # public surface re-exports
│  ├─ load-pack.ts          # loadPack factory
│  ├─ manifest.ts           # SkillPackManifest schema + types
│  ├─ kind.ts               # SkillPackKind enum + schema
│  ├─ capability.ts         # SkillPackCapability enum + schema
│  └─ errors.ts             # SkillPackError + code schema
└─ test/
   ├─ load-pack.test.ts     # smoke + not_implemented assertion
   ├─ manifest.test.ts      # manifest schema parses valid + rejects invalid
   ├─ kind.test-d.ts        # SkillPackKind tuple-ordering pin
   ├─ capability.test-d.ts  # SkillPackCapability tuple-ordering pin
   └─ errors.test-d.ts      # SkillPackErrorCode tuple-ordering pin
```

LOC budget: ≤ 80 lines per source file (placeholders are
trivial).

## §10 Acceptance criteria

- `pnpm --filter @megasaver/skill-packs build` succeeds; emits
  `dist/index.{js,d.ts}` with the public surface.
- `pnpm --filter @megasaver/skill-packs test` green; smoke
  test imports `loadPack`, awaits it, asserts rejection with
  `SkillPackError({ code: "not_implemented" })`.
- Manifest test asserts `skillPackManifestSchema` accepts a
  minimal valid manifest and rejects an empty object.
- `.test-d.ts` files prove tuple-ordering for all three closed
  enums (`SkillPackKind`, `SkillPackCapability`,
  `SkillPackErrorCode`).
- `pnpm lint` green.
- `pnpm typecheck` green.
- `pnpm verify` from worktree root passes.
- Wiki entry appended to `wiki/log.md` and slot referenced in
  `wiki/index.md` § "Entities".

## §11 References

- **HH plan** — `docs/superpowers/plans/2026-05-10-hh-mcp-skillpacks.md`.
- **HH mcp-bridge spec** — `docs/superpowers/specs/2026-05-10-hh-mcp-bridge-design.md`.
- **CLAUDE.md §2** — repo layout (skill-packs slot named).
- **CLAUDE.md §8** — Zod-at-boundary rule.
- **CLAUDE.md §13** — no half-implementations.
- **AA3 convention** — schema tuple-ordering pin.
- **OMC `superpowers` plugin** — model for "user installs a
  bundle of skills" pattern; Mega Saver's equivalent must be
  first-class to the CLI, not an external plugin.
