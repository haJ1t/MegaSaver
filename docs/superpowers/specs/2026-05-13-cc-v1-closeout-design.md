---
title: CC — Mega Saver v1.0 CLOSEOUT (capstone) — design spec
status: proposed
risk: MEDIUM
created: 2026-05-13
updated: 2026-05-13
input-source: ./2026-05-10-aa1-context-gate-epic.md
assumes-merged: [BB7b, BB8, BB10, BB11]
---

# CC — v1.0 CLOSEOUT design spec

> **Capstone.** Executes AFTER the AA1 epic's last code sub-PRs
> (BB7b, BB8, BB10, BB11) merge. Writes no feature code. Job: prove
> the AA1 §1 v1.0 done-list holds end-to-end, fill release gaps
> (docs, version bump, tag), tag a shippable `v1.0.0`. Risk MEDIUM
> (integration only — the CRITICAL spawn surface already shipped and
> was reviewed in BB7b/BB8).
>
> Citations: `AA1 §N` = `docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md`;
> `plan L<n>` = `/Users/halitozger/Desktop/MegaSaver_Context_Gate_Detailed_Plan.txt`.

---

## §1 Acceptance contract — AA1 §1 v1.0 done-list (verbatim)

Every bullet is copied from AA1 §1 ("v1.0 done means…", mirroring
plan L1747–L1777 + L1672–L1702). The closeout is DONE only when each
bullet has a verifying step (§7 maps them).

- **[A1]** Every session carries a `tokenSaver` schema object
  (`enabled`, `mode`, `maxReturnedBytes`, `storeRawOutput`,
  `redactSecrets`, `autoRepair`, `createdAt`, `updatedAt`) persisted
  in the JSON directory store (atomic write, POSIX dir-fsync,
  Windows-aware) without breaking pre-AA sessions. *(BB1)*
- **[A2]** A `mega session saver {enable,disable,status,stats}` CLI
  surface with `--json` parity per
  `apps/cli/test/json-failure-paths.test.ts`. *(BB2)*
- **[A3]** A `mega output {exec,file,filter,chunk}` CLI surface
  routes raw output through redact → chunk → rank → fit → summarize
  and writes the raw chunk set under
  `<store>/content/<projectId>/<sessionId>/<chunkSetId>.json` and a
  stats event under `<store>/stats/<projectId>/<sessionId>.json`.
  `exec` spawns a policy-gated child; the other three read on-disk
  inputs. *(BB7a + BB7b)*
- **[A4]** A `mega mcp {install,repair,status,uninstall}` CLI surface
  does idempotent agent-config install; the GUI AgentSetupDoctor view
  drives the same ops. *(BB8 + BB11)*
- **[A5]** The real `@megasaver/mcp-bridge` ships over `stdio`
  exposing `mega_fetch_chunk`, `mega_read_file`, `mega_recall`,
  `mega_run_command` (alphabetic), policy-gated + redaction-pipelined,
  replacing the v0.3 `not_implemented` placeholder without redesigning
  `createBridge(config)`. *(AA1 §8; BB8)*
- **[A6]** The GUI Sessions detail pane carries a `TokenSaverPanel`
  (mode picker, enable/disable, savings ratio, recent events,
  raw/sent viewer per plan L387–L411); AgentSetupDoctor drives
  setup/repair without a terminal. *(BB10 + BB11)*
- **[A7]** Connector sync writes an additive
  `<!-- MEGA SAVER:CONTEXT_GATE BEGIN -->` block per agent file
  alongside the existing `MEGA SAVER:BEGIN/END` block. *(AA1 §7; BB11)*
- **[A8]** `pnpm verify` green; tuple-ordering pins land for every
  closed enum (AA1 §17); `pnpm conventions:check` green with any new
  anti-pattern entries source-synced from `docs/conventions/`.
  *(AA1 §17, §18)*

User-promise milestone (AA1 §1, F-MAJ-10): the full *"Open GUI →
Click Enable → Done"* promise is live at BB11; the §2 e2e walks it.

---

## §2 End-to-end flow — steps + expected observables

A node-driven script: shells the **real built binary**
`apps/cli/dist/cli.js` (the `mega` bin per `apps/cli/package.json`)
for CLI legs, and drives the GUI bridge in-process via
`createBridgeHandler` + `node:http` + `fetch` (the
`apps/gui/test/smoke/boot.test.ts` precedent — no Vite, no port
race). All legs share one throwaway `--store <tmp>` dir.

Plan step (L1672–L1702) → leg → observable:

1. **Pick session (1–3):** `project create demo`; `session create
   demo --agent claude-code --title "first session"` (note:
   `projectName` is POSITIONAL, not `--project`; `session list` to
   read the new `<sid>`). → session JSON has `id`;
   `tokenSaver === undefined`.
2. **Enable Balanced (4–5):** `session saver enable <sid> --mode
   balanced --json`. → `{ sessionId, tokenSaver: { enabled:true,
   mode:"balanced", maxReturnedBytes:12000, … } }`.
3. **Install/repair MCP + sync connector (6):** `mega mcp repair
   --target claude-code --json`; `connector sync --target claude-code
   --project demo`. → project `CLAUDE.md` contains the CONTEXT_GATE
   block (bytes > 0), legacy `MEGA SAVER:BEGIN/END` block still
   present (both coexist, AA1 §7); `mega mcp status --json` reports
   claude-code `mcpInstalled:true`, `connectorSynced:true`.
4. **Agent runs command (8–9):** `mega output exec <sid> --intent
   "auth failures" --json -- node -e "console.error('FAIL
   auth.test'); console.log('ok')"`. → `{ sessionId, result: {
   summary, excerpts, rawBytes>0, returnedBytes>0, bytesSaved>=0,
   savingRatio∈[0,1] present, chunkSetId } }`.
5. **Raw stored (9):**
   `<tmp>/content/<projectId>/<sid>/<chunkSetId>.json` exists, parses
   as a ChunkSet (AA1 §10d).
6. **Stats init (9):** `<tmp>/stats/<projectId>/<sid>.json` exists,
   `eventsTotal >= 1`; `<sid>.events.jsonl` has ≥ 1 line.
7. **GUI stats (10):** bridge `GET /api/sessions/<sid>/token-saver/
   stats` → 200; `savingRatio∈[0,1]`, `rawBytesTotal>0`,
   `returnedBytesTotal>0`.
8. **GUI status (7):** bridge `GET /api/sessions/<sid>/token-saver/
   status` → 200; `tokenSaver.enabled===true`, `mode==="balanced"`.
9. **GUI Agent Setup Doctor (6–7) — the `/api/mcp/*` half of
   [A4]/[A6]:** bridge `GET /api/mcp/status` → 200 with `agents[]`,
   each carrying `mcpInstalled`/`connectorSynced`/`restartRequired`/
   `restartHint` (AA1 §5c, §6c). Then `POST /api/mcp/repair` (or
   install) for a missing-config agent → on re-`GET /api/mcp/status`
   that agent's `mcpInstalled` and `connectorSynced` flip to `true`.
   BB8's `buildMcpSetupOps(...)` is wired into
   `apps/gui/bridge/server.ts`, so these routes run real ops (not a
   stub). This closes the AgentSetupDoctor coverage that the CLI
   `mega mcp` legs (steps 3) do not exercise.

**Locks:**

- **`mega output exec` stands in for `mega_run_command`.** Both call
  the same orchestrator (`packages/core/src/context-gate/
  run-command.ts`; AA1 §8d "one orchestrator, two entry points").
  The CLI twin is scriptable without an MCP stdio peer; the
  stdio-tool assertion lives in BB8's own acceptance (AA1 §14 BB8)
  and is NOT re-proved here. The e2e DOES assert the CG block text
  contains `mega_run_command` (proves the agent is instructed).
- **Spawn `node -e "…"`** (an ALLOWED_COMMAND, AA1 §9b), not `pnpm
  test` — deterministic, fast, emits stdout+stderr (covers combined
  capture); avoids recursive suite execution.
- **Savings-ratio observability:** `savingRatio` is required on
  `FilterOutputResult` (AA1 §11a) and `SessionTokenSaverStats`
  (AA1 §13a). Assert number ∈ [0,1] on both the `output exec`
  envelope and the bridge `/stats` envelope — presence + range,
  not a specific value (input-dependent).

---

## §3 Closed-enum pin audit (AA1 §17)

One test (`apps/cli/test/enum-pin-audit.test.ts`, repo-root host
since `apps/cli` imports every package) asserts each AA1 §17 pin file
exists and is non-empty. Structural guard only — per-enum tuple
ordering is asserted by the pins themselves under `pnpm typecheck`
(vitest typecheck mode); this proves none was dropped in integration.
Eight pins:

| Enum | Pin file |
|------|----------|
| `TokenSaverMode` | `packages/shared/test/token-saver-mode.test-d.ts` |
| `PolicyDenyCode` | `packages/policy/test/deny-code.test-d.ts` |
| `ContentStoreErrorCode` | `packages/content-store/test/error-code.test-d.ts` |
| `RankFeatureName` | `packages/output-filter/test/rank-features.test-d.ts` |
| `OutputSourceKind` | `packages/output-filter/test/output-source.test-d.ts` |
| `DerivedIntentSource` | `packages/retrieval/test/intent.test-d.ts` |
| `McpToolName` | `packages/mcp-bridge/test/tool-name.test-d.ts` |
| `McpBridgeErrorCode` | `packages/mcp-bridge/test/errors.test-d.ts` |

---

## §4 Docs

- **README "Mega Saver Mode" section.** No such section today (v0.3
  rewrite, PR #56). Add one between "GUI app" (`README.md:325`) and
  "Future packages" (`:352`): one-click flow, three modes with byte
  budgets (safe 32000 / balanced 12000 / aggressive 4000 from
  `modeToBudget`, AA1 §4a/§11d), measurable savings, raw/sent viewer,
  doctor/repair. The `mcp-bridge` "Future packages" subsection
  (`:358`) is no longer future (BB8 shipped) — fold it into the new
  section; `skill-packs` remains the sole future entry (AA1 §2c).
  Full prose: PLAN Task 3.
- **`docs/` user guide.** No `docs/guides|user/` pattern exists
  (only `docs/conventions/`, `docs/superpowers/`). The closeout does
  NOT invent one — the README section is the v1.0 user guide. A
  dedicated guide is a post-v1.0 PR (flagged, not a gap).
- **Wiki close-out + entities.** Append a v1.0 entry to `wiki/log.md`
  + `wiki/index.md` Status; add entity pages for the five new
  packages (`policy`, `content-store`, `output-filter`, `retrieval`,
  `stats`) + a real `mcp-bridge` page (was a reserved slot,
  `wiki/index.md:32`); update `entities/{core,gui,cli,
  connectors-shared}.md`. Each new page ≤ 50 lines, cited, per
  `wiki/CLAUDE.md`. Content: PLAN Tasks 4 + 8.

---

## §5 Release mechanism — LOCKED: Changesets (inspected, not assumed)

- `package.json` devDep `@changesets/cli@^2.27.11`; scripts
  `changeset`, `version-packages` (`changeset version`), `release`
  (`pnpm build && changeset publish`).
- `.changeset/config.json`: `changelog:
  "@changesets/cli/changelog"`, `commit:false`, `access:"restricted"`,
  `baseBranch:"main"`, `updateInternalDependencies:"patch"`,
  `fixed:[]`, `linked:[]`.
- `.changeset/` already holds ~26 per-feature changesets (incl.
  `bb6-…`, `bb7a-…`); every package `version:"0.0.0"`; no CHANGELOG
  yet (changesets generates them on `version`).
- **All 14 `@megasaver/*` packages are `"private": true`.** `changeset
  version` still bumps private packages' `version` fields and writes
  their CHANGELOGs; `changeset publish` SKIPS private packages. So
  the version bump is in scope; the registry push is moot (private +
  no auth) — reinforcing that the closeout deliverable is the tag,
  not a publish.

**Locked v1.0 release flow:**

1. Add ONE changeset bumping all 14 `@megasaver/*` packages to
   `major` (0.0.0 → 1.0.0). `pnpm changeset` is interactive
   (unsupported in this harness), so write the markdown file directly
   (`.changeset/cc-v1-release.md`) in the same format the BB files
   use, listing all 14 packages at `major`. (`fixed`/`linked` empty
   → versions not auto-coupled → explicit list required.)
2. `pnpm version-packages` consumes ALL pending changesets (BB ones +
   release), writes `1.0.0` into every `package.json`, generates
   per-package `CHANGELOG.md`, deletes consumed changeset files.
3. `pnpm install` to refresh the lockfile.
4. `pnpm verify` green.
5. Annotated tag `v1.0.0` (no prior tag exists). `changeset publish`
   (the `release` script) is NOT run by the closeout — `restricted`
   access + no registry auth here ⇒ publish is a human/CI step. The
   deliverable is the tag + release notes. (Flagged for parent.)

---

## §6 §2a orchestrator-extraction decision close

AA1 §2a locked a post-BB7b LOC trigger: `wc -l
packages/core/src/context-gate/*.ts`; > 500 LOC → extract to
`@megasaver/context-gate` (BB12), else keep folded. PR #75
(extraction evaluation) is in flight. The closeout does NOT perform
the extraction — it **records the outcome**: measured LOC,
folded-vs-extracted decision, PR #75 disposition, as a
`wiki/decisions/` record + log entry. LOC is measured live at
execution time (PLAN Task 8).

---

## §7 Definition of Done

Per `CLAUDE.md` §9 plus closeout gates:

1. **Each [A1]–[A8] maps to a verifying step:** A1/A3 → e2e
   store-write + bridge legs; A2/A4 → e2e CLI `mega session
   saver`/`mega output`/`mega mcp` legs + e2e GUI doctor
   `/api/mcp/*` leg (§2 step 9); A5 → enum-pin audit
   (`McpToolName`/`McpBridgeErrorCode`) + e2e CG-block text; A6 →
   e2e bridge token-saver `/status` + `/stats` AND the GUI doctor
   `/api/mcp/*` leg (§2 step 9); A7 → e2e CG-block byte assertion;
   A8 → `pnpm verify` + enum-pin audit.
2. `pnpm verify` exit 0 (lint + typecheck + test + conventions).
3. e2e test green; smoke evidence captured (the e2e IS the smoke).
4. Every `package.json` `version === "1.0.0"`; per-package
   `CHANGELOG.md` present.
5. Annotated tag `v1.0.0` created (local; push is human/CI).
6. Release notes written (PLAN Task 7).
7. Wiki close-out + entity pages + §2a decision record.
8. Zero pending TodoWrite items.
9. `code-reviewer` pass — author ≠ reviewer.

**Hard rule:** no "done"/"shipped"/"tagged" claim before items 2–5
produce evidence.

**Out of scope (flagged, not gaps):** registry publish (deferred to
CI, §5.5); a dedicated `docs/` user guide (no pattern, §4); the §2a
extraction itself (PR #75 owns it; closeout only records, §6).
