# Brain Doctor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `mega brain doctor <project>` — a deterministic, read-only health report over one project's agent memory with six finding families (stale/decayed, contradicted, lineage conflicts, suggestion backlog, hook coverage, sync freshness), each carrying severity, a local-evidence citation, and an existing repair command; human table + `--json`.

**Architecture:** A pure, agent-agnostic analyzer `diagnoseMemoryHealth(entries, now)` in `@megasaver/core` (`packages/core/src/brain-doctor.ts`) reuses `isRecallable`, `DECAY_HALF_LIFE_MS`, `checkConflicts`, and `verificationBadgeFor`. Agent-specific inputs stay in the CLI: `buildHookCoverageFindings` consumes `readClaudeCodeHookStatus` (`@megasaver/connector-claude-code`), `buildSyncFreshnessFindings` reads local `brain-sync.json`/keyfile state (`@megasaver/brain-sync`). `runBrainDoctor` composes all three and renders. No mutation, no network.

**Tech Stack:** TypeScript strict/ESM, Zod (existing schemas only), Vitest, Citty, @megasaver/core, @megasaver/connector-claude-code, @megasaver/brain-sync.

Spec: `docs/superpowers/specs/2026-08-06-brain-doctor-design.md`.

## Global Constraints

- Risk MEDIUM: full superpowers chain, worktree `feat/brain-doctor`, reviewer `code-reviewer` (fresh context, never the author).
- READ-ONLY hard rule: the new code calls no `create*`/`update*`/`delete*` registry method and no brain-sync write helper (`saveConfig`/`updateLastSeen`/`push`/`pull`). Acceptance: `grep -n "createMemoryEntry\|updateMemoryEntry\|deleteMemoryEntry\|saveConfig\|updateLastSeen" packages/core/src/brain-doctor.ts apps/cli/src/commands/brain/doctor.ts apps/cli/src/commands/brain/doctor-sources.ts` returns nothing.
- Deterministic: every age computation takes an injected ISO `now`; no `Date.now()`/`new Date()` without an argument in new source files. No timing-tight tests — age boundaries are exercised with fixed ISO strings (repo rule; wiki/workflows/cli-test-pattern.md).
- No network I/O anywhere (sync freshness is local file state only); no LLM/API calls.
- `@megasaver/core` gains no import of connectors or brain-sync (§1 agent-agnostic core). The CLI imports core via `@megasaver/core` only (it never imports `@megasaver/stats` directly — core re-exports).
- Findings never change process exit: exit 0 with findings, 1 only on operational errors via `mapErrorToCliMessage`.
- One responsibility per file, ≤300 LOC; new CLI tests follow wiki/workflows/cli-test-pattern.md (mkdtemp store, injected `now`, `stdout`/`stderr` callbacks).
- Before requesting review: `pnpm verify` green plus `pnpm --filter @megasaver/core test` and `pnpm --filter @megasaver/cli test`.

## File Structure

| File | Responsibility |
| --- | --- |
| packages/core/src/memory-entry.ts | Export existing `DECAY_HALF_LIFE_MS` (modify, one line). |
| packages/core/src/brain-doctor.ts | Pure memory-health analyzer: types, thresholds, `diagnoseMemoryHealth`. |
| packages/core/src/index.ts | Re-export the brain-doctor surface (modify). |
| apps/cli/src/commands/brain/doctor-sources.ts | Hook-coverage + sync-freshness finding builders. |
| apps/cli/src/commands/brain/doctor.ts | `runBrainDoctor`, table/JSON render, Citty command. |
| apps/cli/src/commands/brain/index.ts | Register `doctor` subcommand + exports (modify). |

---

### Task 1: Core analyzer — types, summary, stale + decay findings

**Files:**
- Modify: packages/core/src/memory-entry.ts (make `DECAY_HALF_LIFE_MS` at line 205 `export const`)
- Create: packages/core/src/brain-doctor.ts
- Create: packages/core/test/brain-doctor.test.ts
- Modify: packages/core/src/index.ts

**Interfaces:**
- Consumes: `MemoryEntry`, `isRecallable`, `DECAY_HALF_LIFE_MS` (packages/core/src/memory-entry.ts), `MemoryEntryId` (@megasaver/shared).
- Produces:

```ts
export type DoctorSeverity = "info" | "warn" | "error";
export type DoctorCheck =
  | "stale-flagged"
  | "decayed"
  | "contradicted-by-code"
  | "rule-contradiction"
  | "lineage-conflict"
  | "suggestion-backlog"
  | "conflict-scan-truncated"
  | "hook-coverage"
  | "sync-freshness";
export type DoctorFinding = {
  check: DoctorCheck;
  severity: DoctorSeverity;
  message: string;
  evidence: { entryIds?: readonly MemoryEntryId[]; files?: readonly string[] };
  repair: string;
};
export type MemoryHealthSummary = {
  total: number;
  recallableNow: number;
  suggested: number;
  staleFlagged: number;
};
export type MemoryHealthReport = { findings: DoctorFinding[]; summary: MemoryHealthSummary };
export const DOCTOR_DECAYED_AGE_MS = 2 * DECAY_HALF_LIFE_MS; // weight <= 0.25
export const DOCTOR_BACKLOG_WARN_COUNT = 10;
export const DOCTOR_BACKLOG_WARN_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const DOCTOR_CONFLICT_SCAN_CAP = 200;
export function diagnoseMemoryHealth(
  entries: readonly MemoryEntry[],
  now: string,
): MemoryHealthReport;
```

- [ ] **Step 1 (RED): failing tests** — fixture `mk` mirrors packages/core/test/conflict-checker.test.ts (cast literal `as MemoryEntry`, `PROJECT_ID = "11111111-1111-4111-8111-111111111111"`); `const NOW = "2026-08-06T00:00:00.000Z"`.

```ts
it("flags a stale entry with its id and a sweep repair", () => {
  const stale = mk("00000000-0000-4000-8000-0000000000a1", { stale: true });
  const { findings } = diagnoseMemoryHealth([stale], NOW);
  const f = findings.find((x) => x.check === "stale-flagged");
  expect(f?.severity).toBe("warn");
  expect(f?.evidence.entryIds).toEqual([stale.id]);
  expect(f?.repair).toContain("mega memory sweep");
});

it("flags decay strictly past two half-lives, keyed on lastActiveAt", () => {
  const at = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString();
  const fresh = mk("00000000-0000-4000-8000-0000000000a2", {
    lastActiveAt: at(DOCTOR_DECAYED_AGE_MS),
  });
  const old = mk("00000000-0000-4000-8000-0000000000a3", {
    lastActiveAt: at(DOCTOR_DECAYED_AGE_MS + 1),
  });
  const { findings } = diagnoseMemoryHealth([fresh, old], NOW);
  const decayed = findings.filter((x) => x.check === "decayed");
  expect(decayed.flatMap((x) => x.evidence.entryIds)).toEqual([old.id]);
  expect(decayed[0]?.severity).toBe("info");
});

it("decay falls back lastActiveAt -> updatedAt -> createdAt and skips stale/suggested rows", () => {
  const oldTs = new Date(Date.parse(NOW) - DOCTOR_DECAYED_AGE_MS - 1).toISOString();
  const viaUpdated = mk("00000000-0000-4000-8000-0000000000a4", { updatedAt: oldTs });
  const staleOld = mk("00000000-0000-4000-8000-0000000000a5", { updatedAt: oldTs, stale: true });
  const suggestedOld = mk("00000000-0000-4000-8000-0000000000a6", {
    updatedAt: oldTs,
    approval: "suggested",
  });
  const { findings } = diagnoseMemoryHealth([viaUpdated, staleOld, suggestedOld], NOW);
  const ids = findings.filter((x) => x.check === "decayed").flatMap((x) => x.evidence.entryIds);
  expect(ids).toEqual([viaUpdated.id]);
});

it("summary reuses isRecallable for recallableNow", () => {
  const ok = mk("00000000-0000-4000-8000-0000000000a7");
  const suggested = mk("00000000-0000-4000-8000-0000000000a8", { approval: "suggested" });
  const archival = mk("00000000-0000-4000-8000-0000000000a9", { tier: "archival" });
  const closed = mk("00000000-0000-4000-8000-0000000000aa", { validTo: "2026-08-01T00:00:00.000Z" });
  const { summary } = diagnoseMemoryHealth([ok, suggested, archival, closed], NOW);
  expect(summary).toEqual({ total: 4, recallableNow: 1, suggested: 1, staleFlagged: 0 });
});
```

- [ ] **Step 2: run RED** — `pnpm --filter @megasaver/core test -- brain-doctor` fails (module missing).
- [ ] **Step 3 (GREEN):** export `DECAY_HALF_LIFE_MS`; implement `brain-doctor.ts`: stale pass (`entry.stale`), decay pass (approved && `isRecallable(entry, now)` && !stale && `Date.parse(now) - Date.parse(lastActiveAt ?? updatedAt ?? createdAt) > DOCTOR_DECAYED_AGE_MS`; NaN parse ⇒ skip, mirroring `effectiveConfidence` NaN discipline), summary via `isRecallable`. One finding per affected entry. Core repair strings carry the bare command (`"mega memory sweep"`, `"mega memory update <id> --no-stale"`) — core does not know the project name; the CLI render step (Task 5) appends it to project-level commands.
- [ ] **Step 4:** add re-exports to packages/core/src/index.ts; `pnpm --filter @megasaver/core test` green; `pnpm --filter @megasaver/core typecheck` green.
- [ ] **Step 5:** commit `feat(core): brain doctor stale and decay findings`

### Task 2: Core analyzer — contradiction findings (badge + conflict-checker)

**Files:**
- Modify: packages/core/src/brain-doctor.ts
- Modify: packages/core/test/brain-doctor.test.ts

**Interfaces:**
- Consumes: `verificationBadgeFor` (packages/core/src/verification-badge.ts:9), `checkConflicts` (packages/core/src/conflict-checker.ts:26), `DOCTOR_CONFLICT_SCAN_CAP`.

- [ ] **Step 1 (RED): failing tests.** Note `checkConflicts` precedence: same-type + file-overlap classifies as `supersession` first, so the contradiction fixture pairs a `project_rule` with a `decision` (different types) sharing `relatedFiles` with negation-keyword divergence.

```ts
it("reports a stored code contradiction as error citing the verify stamp", () => {
  const entry = mk("00000000-0000-4000-8000-0000000000b1", {
    anchor: { repoHead: "deadbeef", capturedAt: NOW, files: [], symbols: [] },
    lastVerified: { headSha: "deadbeef", at: NOW, result: "contradicted", closedByCodeTruth: false },
  });
  const { findings } = diagnoseMemoryHealth([entry], NOW);
  const f = findings.find((x) => x.check === "contradicted-by-code");
  expect(f?.severity).toBe("error");
  expect(f?.evidence.entryIds).toEqual([entry.id]);
  expect(f?.repair).toContain("mega memory verify");
});

it("reports one deduped rule-polarity contradiction pair", () => {
  const rule = mk("00000000-0000-4000-8000-0000000000c1", {
    type: "project_rule",
    keywords: ["skip", "ci"],
    relatedFiles: ["turbo.json"],
    content: "skip ci on docs-only changes",
  });
  const other = mk("00000000-0000-4000-8000-0000000000c2", {
    type: "decision",
    keywords: ["ci"],
    relatedFiles: ["turbo.json"],
    content: "always run ci",
  });
  const { findings } = diagnoseMemoryHealth([rule, other], NOW);
  const pairs = findings.filter((x) => x.check === "rule-contradiction");
  expect(pairs).toHaveLength(1);
  expect([...(pairs[0]?.evidence.entryIds ?? [])].sort()).toEqual([rule.id, other.id].sort());
  expect(pairs[0]?.severity).toBe("warn");
  expect(pairs[0]?.repair).toContain("mega memory reject");
});

it("caps the pairwise scan at DOCTOR_CONFLICT_SCAN_CAP and discloses truncation", () => {
  const many = Array.from({ length: DOCTOR_CONFLICT_SCAN_CAP + 1 }, (_, i) =>
    mk(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, {
      content: `unique content ${i}`,
      relatedFiles: [],
    }),
  );
  const { findings } = diagnoseMemoryHealth(many, NOW);
  expect(findings.some((x) => x.check === "conflict-scan-truncated")).toBe(true);
});
```

- [ ] **Step 2: run RED**, confirm the three new tests fail.
- [ ] **Step 3 (GREEN):** badge pass over all entries (`verificationBadgeFor(entry) === "contradicted-by-code"`, message cites `lastVerified.headSha`). Conflict pass: corpus = approved && `isRecallable(entry, now)` entries sorted by `Date.parse(lastActiveAt ?? updatedAt ?? createdAt)` descending, id ascending tiebreak, sliced to `DOCTOR_CONFLICT_SCAN_CAP`; for each entry run `checkConflicts(entry, rest)`; keep only `outcome === "contradiction"`; dedupe unordered id pairs via a `Set` of sorted joined ids; over-cap corpus emits one `conflict-scan-truncated` info finding.
- [ ] **Step 4:** core tests + typecheck green.
- [ ] **Step 5:** commit `feat(core): brain doctor contradiction findings`

### Task 3: Core analyzer — lineage conflicts + suggestion backlog

**Files:**
- Modify: packages/core/src/brain-doctor.ts
- Modify: packages/core/test/brain-doctor.test.ts
- Verified: core's export-shape tests are per-feature files that each import the index barrel (packages/core/test/exports-tools.test.ts:2 does `import * as core from "../src/index.js"` and asserts the Phase 7 tool-router surface only; same pattern in index-forge.test.ts, audit-reexport.test.ts, handoff-packet-exports.test.ts). Follow that convention: assert the brain-doctor exports via an import-from-`../src/index.js` test inside brain-doctor.test.ts — do not append to exports-tools.test.ts

**Interfaces:**
- Consumes: `supersedesId`/`validTo` fields (memory-entry.ts), `isRecallable`, `DOCTOR_BACKLOG_WARN_COUNT`, `DOCTOR_BACKLOG_WARN_AGE_MS`. (`applySupersession`/`saveMemoryWithLineage` in packages/core/src/supersession.ts:17/220 are the write-side owners this check audits — the doctor only detects targets they left/never closed.)

- [ ] **Step 1 (RED): failing tests**

```ts
it("flags an approved supersession whose target is still open", () => {
  const target = mk("00000000-0000-4000-8000-0000000000d1");
  const winner = mk("00000000-0000-4000-8000-0000000000d2", {
    supersedesId: target.id,
    content: "replacement rule",
  });
  const { findings } = diagnoseMemoryHealth([target, winner], NOW);
  const f = findings.find((x) => x.check === "lineage-conflict");
  expect(f?.severity).toBe("error");
  expect(f?.evidence.entryIds).toEqual([winner.id, target.id]);
  expect(f?.repair).toContain("mega memory history");
});

it("does not flag a properly closed supersession", () => {
  const target = mk("00000000-0000-4000-8000-0000000000d3", {
    validTo: "2026-08-01T00:00:00.000Z",
  });
  const winner = mk("00000000-0000-4000-8000-0000000000d4", { supersedesId: target.id });
  const { findings } = diagnoseMemoryHealth([target, winner], NOW);
  expect(findings.some((x) => x.check === "lineage-conflict")).toBe(false);
});

it("flags a dangling supersedesId as warn", () => {
  const winner = mk("00000000-0000-4000-8000-0000000000d5", {
    supersedesId: "00000000-0000-4000-8000-00000000dead",
  });
  const { findings } = diagnoseMemoryHealth([winner], NOW);
  const f = findings.find((x) => x.check === "lineage-conflict");
  expect(f?.severity).toBe("warn");
});

it("aggregates the suggested backlog; old backlog escalates to warn", () => {
  const freshSuggested = mk("00000000-0000-4000-8000-0000000000e1", {
    approval: "suggested",
    createdAt: "2026-08-05T00:00:00.000Z",
  });
  const info = diagnoseMemoryHealth([freshSuggested], NOW);
  expect(info.findings.find((x) => x.check === "suggestion-backlog")?.severity).toBe("info");

  const oldSuggested = mk("00000000-0000-4000-8000-0000000000e2", {
    approval: "suggested",
    createdAt: "2026-07-01T00:00:00.000Z", // 36d >= 14d threshold
  });
  const warn = diagnoseMemoryHealth([oldSuggested], NOW);
  const f = warn.findings.find((x) => x.check === "suggestion-backlog");
  expect(f?.severity).toBe("warn");
  expect(f?.repair).toContain("mega memory review");
});
```

- [ ] **Step 2: run RED.**
- [ ] **Step 3 (GREEN):** lineage pass — for each approved entry with `supersedesId`: missing target ⇒ warn (dangling); target with `validTo == null` && `isRecallable(target, now)` ⇒ error (both current — the close `applySupersession` performs at approve/save never landed). Backlog pass — `suggested` entries: none ⇒ no finding; else one aggregate finding (count + oldest `createdAt` age in days), warn when `count >= DOCTOR_BACKLOG_WARN_COUNT` or oldest age ≥ `DOCTOR_BACKLOG_WARN_AGE_MS`.
- [ ] **Step 4:** full `pnpm --filter @megasaver/core test` + typecheck green.
- [ ] **Step 5:** commit `feat(core): doctor lineage and backlog findings`

### Task 4: CLI finding sources — hook coverage + sync freshness

**Files:**
- Create: apps/cli/src/commands/brain/doctor-sources.ts
- Create: apps/cli/test/brain-doctor-sources.test.ts

**Interfaces:**
- Consumes: `DoctorFinding` (@megasaver/core), `type ClaudeCodeHookStatus`, `readClaudeCodeHookStatus` (@megasaver/connector-claude-code, hook-settings.ts:604 — already a CLI dependency via apps/cli/src/commands/doctor.ts), `BrainSyncError`, `configPath`, `deriveBrainId`, `keyfilePath`, `loadConfig`, `loadKeyfile` (@megasaver/brain-sync, already a CLI dependency via brain/sync/ops.ts), `existsSync` (node:fs).
- Produces:

```ts
export function buildHookCoverageFindings(
  status: ClaudeCodeHookStatus,
  settingsPath: string,
): DoctorFinding[];
export type SyncFreshnessInput = { storeRoot: string; projectName: string };
export function buildSyncFreshnessFindings(input: SyncFreshnessInput): DoctorFinding[];
```

- [ ] **Step 1 (RED): failing tests** (pure builders — no Citty needed):

```ts
const allOn: ClaudeCodeHookStatus = {
  connected: true,
  preInstalled: true,
  postInstalled: true,
  intentInstalled: true,
  warmupInstalled: true,
  guardInstalled: true,
  cacheAdviceInstalled: true,
};

it("not connected -> warn with mega hooks install repair", () => {
  const f = buildHookCoverageFindings({ ...allOn, connected: false, postInstalled: false }, "/tmp/s.json");
  const warn = f.find((x) => x.severity === "warn");
  expect(warn?.check).toBe("hook-coverage");
  expect(warn?.evidence.files).toEqual(["/tmp/s.json"]);
  expect(warn?.repair).toBe("mega hooks install claude-code");
});

it("connected with optional hooks missing -> info per missing hook, none when all on", () => {
  expect(buildHookCoverageFindings(allOn, "/tmp/s.json")).toEqual([]);
  const f = buildHookCoverageFindings({ ...allOn, guardInstalled: false }, "/tmp/s.json");
  expect(f).toHaveLength(1);
  expect(f[0]?.severity).toBe("info");
});

it("sync: missing config -> info not-configured with init repair", () => {
  const f = buildSyncFreshnessFindings({ storeRoot: root, projectName: "demo" });
  expect(f[0]?.check).toBe("sync-freshness");
  expect(f[0]?.severity).toBe("info");
  expect(f[0]?.repair).toBe("mega brain sync init demo");
});

it("sync: configured but never synced -> warn with push repair", async () => {
  const key = generateKey();
  saveKeyfile(keyfilePath(root), key);
  saveConfig(root, {
    schemaVersion: 1,
    endpoint: "https://s3.example.com",
    bucket: "b",
    prefix: "p/",
    region: "auto",
    pathStyle: true,
    conditionalWritesVerified: true,
    lastSeen: {},
  });
  const f = buildSyncFreshnessFindings({ storeRoot: root, projectName: "demo" });
  expect(f[0]?.severity).toBe("warn");
  expect(f[0]?.repair).toBe("mega brain sync push demo");
});

it("sync: synced -> info reporting the local lastSeen generation", () => {
  const key = generateKey();
  saveKeyfile(keyfilePath(root), key);
  saveConfig(root, { ...baseConfig, lastSeen: { [deriveBrainId(key, "demo")]: 7 } });
  const f = buildSyncFreshnessFindings({ storeRoot: root, projectName: "demo" });
  expect(f[0]?.message).toContain("generation 7");
  expect(f[0]?.repair).toBe("mega brain sync status demo");
});
```

Tests use `mkdtemp` roots and brain-sync's own `generateKey`/`saveKeyfile`/`saveConfig` (test setup only — production doctor code never imports the write helpers).

- [ ] **Step 2: run RED.**
- [ ] **Step 3 (GREEN):** hook builder — `connected === false` ⇒ one warn (message names the missing pre/post/intent booleans); each of `warmupInstalled`/`guardInstalled`/`cacheAdviceInstalled` false ⇒ info; evidence `files: [settingsPath]`. Sync builder — `!existsSync(configPath(storeRoot))` ⇒ info not-configured (`mega brain sync init <project>`); `loadConfig` throws ⇒ warn config-invalid citing `configPath`; `loadKeyfile(keyfilePath(storeRoot))` throws ⇒ warn keyfile problem; else `generation = config.lastSeen[deriveBrainId(key, projectName)] ?? 0`; 0 ⇒ warn never-synced (`mega brain sync push <project>`), >0 ⇒ info with generation (`mega brain sync status <project>`). Catch only `BrainSyncError`; rethrow anything else.
- [ ] **Step 4:** `pnpm --filter @megasaver/cli test -- brain-doctor-sources` green; typecheck green.
- [ ] **Step 5:** commit `feat(cli): doctor hook and sync freshness findings`

### Task 5: `mega brain doctor` command — compose, render, register

**Files:**
- Create: apps/cli/src/commands/brain/doctor.ts
- Create: apps/cli/test/brain-doctor.test.ts
- Modify: apps/cli/src/commands/brain/index.ts (subCommands + re-exports)

**Interfaces:**
- Consumes: `diagnoseMemoryHealth`, `DoctorFinding` (@megasaver/core), the two Task-4 builders, `readClaudeCodeHookStatus`, `resolveClaudeCodeSettingsPath` (@megasaver/connector-claude-code), `ensureStoreReady`/`resolveStorePath` (apps/cli/src/store.ts), `mapErrorToCliMessage`/`projectNotFoundMessage` (apps/cli/src/errors.ts), `projectNameSchema` (apps/cli/src/commands/shared/schemas.ts), `registry.listMemoryEntries` (packages/core/src/registry.ts:85).
- Produces:

```ts
export type RunBrainDoctorInput = {
  projectName: string;
  storeFlag: string | undefined;
  jsonFlag: boolean;
  settingsPath: string;
  now: () => string;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};
export async function runBrainDoctor(input: RunBrainDoctorInput): Promise<0 | 1>;
export const brainDoctorCommand: ReturnType<typeof defineCommand>;
export const BRAIN_DOCTOR_JSON_SCHEMA_VERSION = 1;
```

- [ ] **Step 1 (RED): failing tests** — seed a store the way apps/cli/test/memory-approve.test.ts does (`projects.json`, `sessions.json`, `memory/<PROJECT_ID>.jsonl` with one JSON entry per line); fixed `now: () => "2026-08-06T00:00:00.000Z"`; `settingsPath` pointing into the temp dir.

```ts
it("prints summary plus one aligned row per finding and exits 0", async () => {
  await seedStore({ stale: true, suggested: 1 });
  const code = await runBrainDoctor(makeInput({}));
  expect(code).toBe(0);
  expect(lines.some((l) => l.includes("recallable"))).toBe(true);
  const staleRow = lines.find((l) => l.includes("stale-flagged"));
  expect(staleRow).toContain("warn");
  expect(staleRow).toContain(MEMORY_ID);
  expect(staleRow).toContain("mega memory sweep demo");
});

it("--json emits schemaVersion, summary, and findings with evidence ids", async () => {
  await seedStore({ stale: true, suggested: 1 });
  const code = await runBrainDoctor(makeInput({ jsonFlag: true }));
  expect(code).toBe(0);
  const report = JSON.parse(lines.join("\n"));
  expect(report.schemaVersion).toBe(1);
  expect(report.project).toBe("demo");
  expect(report.generatedAt).toBe("2026-08-06T00:00:00.000Z");
  expect(report.summary.total).toBeGreaterThan(0);
  expect(report.findings.some((f) => f.check === "hook-coverage")).toBe(true);
  expect(report.findings.some((f) => f.check === "sync-freshness")).toBe(true);
});

it("unknown project -> exit 1 via projectNotFoundMessage", async () => {
  await seedStore({});
  const code = await runBrainDoctor(makeInput({ projectName: "nope" }));
  expect(code).toBe(1);
  expect(errLines.join("\n")).toContain("nope");
});

it("healthy empty-ish store still reports coverage + sync findings, exit 0", async () => {
  await seedStore({});
  const code = await runBrainDoctor(makeInput({}));
  expect(code).toBe(0);
});
```

- [ ] **Step 2: run RED.**
- [ ] **Step 3 (GREEN):** `runBrainDoctor` mirrors `runMemoryReview` (apps/cli/src/commands/memory/review.ts): resolve store → `ensureStoreReady` → find project by name → `registry.listMemoryEntries(project.id)` → `diagnoseMemoryHealth(entries, input.now())` → `buildHookCoverageFindings(readClaudeCodeHookStatus({ settingsPath: input.settingsPath }), input.settingsPath)` → `buildSyncFreshnessFindings({ storeRoot: rootDir, projectName })`. Render: human mode prints a summary line (`total/recallable/suggested/stale` counts) then `severity | check | evidence (first id or file) | repair` rows padded with `padEnd`; core repair strings that name a project-level command get the project name appended once here. JSON mode: one `JSON.stringify({ schemaVersion: 1, project, generatedAt, summary, findings })`. Citty wrapper per cli-test-pattern: positional `projectName`, `--store`, `--json`; `settingsPath: resolveClaudeCodeSettingsPath(process.env)`; `now` from `MEGA_TEST_NOW` via the gated `readTestEnv` helper, else `() => new Date().toISOString()`.
- [ ] **Step 4:** register `doctor: brainDoctorCommand` in apps/cli/src/commands/brain/index.ts subCommands and re-export `runBrainDoctor`/`RunBrainDoctorInput`; `pnpm --filter @megasaver/cli test` + typecheck + `pnpm exec biome check` green.
- [ ] **Step 5:** commit `feat(cli): add mega brain doctor command`

### Task 6: Changeset, verification evidence, docs

**Files:**
- Create: .changeset/brain-doctor.md (`@megasaver/core` minor — new exports; `@megasaver/cli` minor — new command)
- Modify: wiki/entities/cli.md, wiki/entities/core.md, wiki/index.md, wiki/log.md (post-work wiki updates per §0)

- [ ] **Step 1:** `pnpm verify` at branch tip — must be green (lint, typecheck, all tests).
- [ ] **Step 2:** smoke evidence (DoD #5): captured terminal session on a seeded temp store showing (a) human table with at least one finding from each of the six families, (b) `--json` output, (c) exit codes 0/1. Save transcript to the PR description.
- [ ] **Step 3:** confirm the read-only acceptance grep from Global Constraints returns nothing.
- [ ] **Step 4:** commit `chore: brain doctor changeset and evidence`
- [ ] **Step 5:** request `code-reviewer` pass (fresh context; author ≠ reviewer), then `verifier` evidence check per DoD #6–7.
