# Context Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `mega contracts run` replays committed `contracts/*.contract.json` fixtures through the existing recall pipeline in a forced-deterministic lexical mode and fails naming the exact missing/stale memory when required evidence falls outside the token-budget cut; `mega contracts add` captures a fixture from a finished session's title and its observed memory injections. Local-CI shaped: `--json`, exit code, no network, no model calls.

**Architecture:** An additive `profile: "safe"` input on `rankProjectMemories` (`@megasaver/memory-recall`) routes ranking through the existing-but-currently-unreached `rankSafe` closure, skipping the vector sidecar and embeddings entirely. A new `contractSchema` + `evaluateContract` pair in the same package ranks a project's entries with the contract intent, cuts the ranked prefix at `tokenBudget` via `estimateTokens`, and classifies each required-evidence miss (`entry-missing` / `entry-stale` / `entry-not-recallable` / `ranked-below-budget` / `no-entry-in-cut`) against core's `isRecallable` gate. Thin citty handlers in `apps/cli/src/commands/contracts/` load fixtures, report text or `--json`, append a local JSONL run record under `withFileLock`, and capture new fixtures from `registry.getSession` + `readSessionDecisionTrace`.

**Tech Stack:** TypeScript strict ESM, citty, Zod, Vitest, node:fs/node:path; packages `@megasaver/memory-recall`, `@megasaver/core`, `@megasaver/output-filter`, `@megasaver/shared`, `apps/cli`.

## Global Constraints

- Deterministic-first (roadmap 2.4, `wiki/syntheses/solo-developer-roadmap.md`): every contract evaluation passes `profile: "safe"`; no network, no model calls, no embedding computation. Tests prove it with an injected `embed` that throws.
- Retrieval-only assertions (Locked Decision 1 of the spec): no outcome-causality language anywhere in output, code, or docs. "Counterfactual replay remains research" is binding.
- `isRecallable` (`packages/core/src/memory-entry.ts:176`) is the single approval/validity/tier gate — the evaluator calls it to NAME failures, never re-implements it.
- Token accounting only via `estimateTokens` from `@megasaver/output-filter` (`packages/output-filter/src/tokens.ts:17`). Never restate the ~4-bytes/token heuristic.
- apps/cli §3c allow-list (`apps/cli/test/dependency-graph.test.ts`): `@megasaver/memory-recall` and `@megasaver/output-filter` are already allowed; `@megasaver/stats` and `@megasaver/retrieval` stay forbidden — the run recorder writes its own JSONL with node:fs, never through stats.
- Every state write under the store root goes through `withFileLock` (`packages/shared/src/file-lock.ts`); a lock miss degrades to a stderr note, never a failed run.
- CLI handlers follow `wiki/workflows/cli-test-pattern.md`: inner `run<Cmd>(input): Promise<0 | 1>` with injected io/env/`now`, thin citty adapter, `mkdtemp` store isolation, `as never` test invocation. No timing-tight tests — `asOf`/`now` are always injected; the only lock test asserts a deterministic post-deadline outcome, not a race.
- Contract `intent` max length is the imported `MAX_LM2_CANDIDATE_TEXT_CODE_UNITS` (from `@megasaver/long-memory/ranker`), because an oversize task silently falls back to task-free search (`rank-project-memories.ts:233`).
- No pnpm catalog in this repo: new deps are per-package `"workspace:*"` / explicit semver entries in `package.json`.
- HIGH risk: all work in a worktree (no `main` edits); `code-reviewer` AND `critic` separate passes before merge; escalate and stop if any step would touch LM2 ranker weights or `isRecallable` itself.
- `apps/cli/src/main.ts` `subCommands` is edited by several wave-2 pairs — rebase over conflicts there; never fork the map.
- Conventional commits, imperative subject ≤ 50 chars, one logical change per commit.

---

### Task 1: deterministic safe profile on `rankProjectMemories`

**Files:**
- `packages/memory-recall/src/rank-project-memories.ts`
- `packages/memory-recall/test/rank-project-memories.test.ts` (extend)

**Interfaces:** `RankProjectMemoriesInput` gains optional `profile?: "safe"`. Verified: the profile currently toggles at line 287 (`vectors.values.size === 0 ? "safe" : "adaptive"`) and the `rankSafe` closure (line 250) is defined but never invoked; this task makes it the executed deterministic path.

- [ ] Write failing test in `packages/memory-recall/test/rank-project-memories.test.ts` (reuse the file's existing `memory()`/`root()` helpers and sidecar-writing pattern so the DEFAULT path would go adaptive):

```ts
it("profile safe skips vectors and embeddings even when a valid sidecar exists", async () => {
  const storeRoot = root();
  const entry = memory({
    id: "00000000-0000-4000-8000-0000000000aa",
    title: "deploy policy",
    content: "use blue-green deploys",
  });
  // Write a hash-valid sidecar exactly as the existing adaptive tests do,
  // so this test proves the safe profile is an override, not a fallback.
  writeSidecarFor(storeRoot, [entry]); // same helper/pattern as the adaptive cases above
  const result = await rankProjectMemories({
    projectId: PROJECT_ID,
    entries: [entry],
    task: "how do we deploy",
    storeRoot,
    query: { includeStale: false, limit: 1 },
    profile: "safe",
    embed: async () => {
      throw new Error("embed must never run in safe profile");
    },
  });
  expect(result.hybrid.profile).toBe("safe");
  expect(result.memory.map((m) => m.id)).toEqual([entry.id]);
});
```

  Verified: the adaptive cases in this file construct hash-valid sidecars inline via `writeVectors(memoryEmbeddingsSidecarPath(storeRoot, PROJECT_ID), [{ id, vector }])` plus `writeFileSync(memoryEmbeddingHashesSidecarPath(...), JSON.stringify({ [id]: memoryEmbeddingContentHash(entry) }))` — see packages/memory-recall/test/rank-project-memories.test.ts:104-110 (imports at lines 7-11; `memory()` at line 20, `root()` at line 44). There is no existing `writeSidecarFor` helper — extract it from that exact construction rather than inventing a new one.
- [ ] Run `pnpm --filter @megasaver/memory-recall test` — expect FAIL (TS: unknown property `profile`; behaviorally the adaptive path would run).
- [ ] Implement in `packages/memory-recall/src/rank-project-memories.ts`: add `profile?: "safe";` to `RankProjectMemoriesInput`, and immediately after the existing `const rankSafe = () => ...` definition (before `let vectors: ReturnType<typeof vectorReader>;`):

```ts
    if (input.profile === "safe") {
      const ranked = await rankSafe();
      return { memory: memoryFor(ranked.orderedCandidateIds), hybrid: ranked.hybrid };
    }
```

- [ ] Run the test — expect PASS. Run `pnpm --filter @megasaver/memory-recall test` and `pnpm --filter @megasaver/memory-recall typecheck` — green.
- [ ] Commit: `feat(memory-recall): opt-in deterministic safe profile`

---

### Task 2: contract schema

**Files:**
- `packages/memory-recall/src/contract.ts` (new)
- `packages/memory-recall/test/contract.test.ts` (new)
- `packages/memory-recall/src/index.ts`
- `packages/memory-recall/package.json` (add `"zod": "^3.24.1"` to dependencies — the package has no zod dep today)

**Interfaces:**

```ts
export const contractEvidenceSchema: z.ZodType<ContractEvidence>;
export type ContractEvidence = {
  kind: "memory-entry-ref" | "file-ref" | "keyword";
  value: string;
};
export const contractSchema: z.ZodType<Contract>;
export type Contract = {
  name: string;
  intent: string;
  requiredEvidence: ContractEvidence[];
  tokenBudget: number;
  createdFrom: SessionId | null;
};
```

- [ ] Write failing test `packages/memory-recall/test/contract.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { contractSchema } from "../src/index.js";

const VALID = {
  name: "deploy-policy-recall",
  intent: "how do we deploy the api service",
  requiredEvidence: [{ kind: "memory-entry-ref", value: "00000000-0000-4000-8000-00000000000a" }],
  tokenBudget: 2000,
  createdFrom: null,
};

describe("contractSchema", () => {
  it("parses a valid contract", () => {
    expect(contractSchema.parse(VALID).name).toBe("deploy-policy-recall");
  });
  it("rejects a path-escaping name", () => {
    expect(contractSchema.safeParse({ ...VALID, name: "../evil" }).success).toBe(false);
  });
  it("rejects empty requiredEvidence", () => {
    expect(contractSchema.safeParse({ ...VALID, requiredEvidence: [] }).success).toBe(false);
  });
  it("rejects unknown keys (strict)", () => {
    expect(contractSchema.safeParse({ ...VALID, extra: 1 }).success).toBe(false);
  });
  it("rejects an intent above the LM2 task cap", () => {
    const oversize = "x".repeat(1_000_000);
    expect(contractSchema.safeParse({ ...VALID, intent: oversize }).success).toBe(false);
  });
});
```

  Verified: `MAX_LM2_CANDIDATE_TEXT_CODE_UNITS` is `50_000` (packages/long-memory/src/lm2-model-contracts.ts:10), so the 1_000_000-char oversize literal is safely above the cap. If the constant ever changes, keep the literal above it.
- [ ] Run `pnpm --filter @megasaver/memory-recall test -- test/contract.test.ts` — expect FAIL (no export `contractSchema`).
- [ ] Implement `packages/memory-recall/src/contract.ts`:

```ts
import { MAX_LM2_CANDIDATE_TEXT_CODE_UNITS } from "@megasaver/long-memory/ranker";
import { sessionIdSchema } from "@megasaver/shared";
import { z } from "zod";

export const contractEvidenceSchema = z
  .object({
    kind: z.enum(["memory-entry-ref", "file-ref", "keyword"]),
    value: z.string().trim().min(1).max(2_000),
  })
  .strict();
export type ContractEvidence = z.infer<typeof contractEvidenceSchema>;

// name doubles as the fixture filename stem — the slug regex is the
// path-escape guard, so keep it strict.
export const contractSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    intent: z.string().trim().min(1).max(MAX_LM2_CANDIDATE_TEXT_CODE_UNITS),
    requiredEvidence: z.array(contractEvidenceSchema).min(1).max(32),
    tokenBudget: z.number().int().positive().max(100_000),
    createdFrom: sessionIdSchema.nullable(),
  })
  .strict();
export type Contract = z.infer<typeof contractSchema>;
```

- [ ] Re-export from `packages/memory-recall/src/index.ts` (`contractSchema`, `contractEvidenceSchema`, `Contract`, `ContractEvidence`).
- [ ] Run the test — expect PASS. Package test + typecheck green.
- [ ] Commit: `feat(memory-recall): context contract schema`

---

### Task 3: `evaluateContract`

**Files:**
- `packages/memory-recall/src/evaluate-contract.ts` (new)
- `packages/memory-recall/test/evaluate-contract.test.ts` (new)
- `packages/memory-recall/src/index.ts`
- `packages/memory-recall/package.json` (add `"@megasaver/output-filter": "workspace:*"` — verified cycle-free: output-filter depends only on evidence-ledger/indexer/policy/shared)

**Interfaces:**

```ts
export type ContractFindingReason =
  | "entry-missing"
  | "entry-stale"
  | "entry-not-recallable"
  | "ranked-below-budget"
  | "no-entry-in-cut";
export type ContractFinding = {
  evidence: ContractEvidence;
  status: "pass" | "fail";
  reason?: ContractFindingReason;
  entryId?: string;
  entryTitle?: string;
  rankPosition?: number;
  detail: string;
};
export type ContractResult = {
  name: string;
  pass: boolean;
  findings: ContractFinding[];
  cut: { size: number; tokenEstimate: number; rankedTotal: number };
};
export async function evaluateContract(input: {
  contract: Contract;
  projectId: ProjectId;
  entries: readonly MemoryEntry[];
  storeRoot: string;
  asOf: string;
}): Promise<ContractResult>;
```

- [ ] Write failing tests `packages/memory-recall/test/evaluate-contract.test.ts` (reuse the `memory()` fixture helper shape from `rank-project-memories.test.ts`). Cases, one `it` each:
  1. all evidence in cut → `pass: true`, every finding `status: "pass"`.
  2. `memory-entry-ref` to an id absent from `entries` → fail `entry-missing`, `detail` contains the id.
  3. ref to an entry with `stale: true` → fail `entry-stale`, `entryTitle` set.
  4. ref to an entry with `approval: "suggested"` → fail `entry-not-recallable`, `detail` names the approval gate; ref to `tier: "archival"` → same reason, detail names the tier gate.
  5. ref to a recallable entry ranked outside a tiny `tokenBudget` (budget fits only the first entry) → fail `ranked-below-budget` with `rankPosition` ≥ 2 and the cut metadata showing `size: 1`.
  6. `file-ref` matching `relatedFiles: ["src\\a.ts"]` against value `src/a.ts` → pass (separator normalization); `keyword` `"REDOS"` matching content `"redos guard"` → pass (case-insensitive); neither present in cut → fail `no-entry-in-cut`.
  7. determinism: two consecutive `evaluateContract` calls over the same fixtures return `JSON.stringify`-identical results with a throwing `embed`-free path (safe profile is internal — assert no throw and identical output).
  8. injected-instant consistency: ref to an entry whose `validTo` lies between the injected `asOf` and real wall-clock now (valid at `asOf`, expired now) → ranked and `status: "pass"` — proves both ranking eligibility and classification evaluate validity at the injected `asOf`, never wall-clock `new Date()`.
- [ ] Run — expect FAIL (no export `evaluateContract`).
- [ ] Implement `packages/memory-recall/src/evaluate-contract.ts`:

```ts
import { type MemoryEntry, isRecallable } from "@megasaver/core";
import { estimateTokens } from "@megasaver/output-filter";
import type { ProjectId } from "@megasaver/shared";
import type { Contract, ContractEvidence } from "./contract.js";
import { rankProjectMemories } from "./rank-project-memories.js";

const normalizePath = (value: string): string => value.replaceAll("\\", "/");

export async function evaluateContract(input: {
  contract: Contract;
  projectId: ProjectId;
  entries: readonly MemoryEntry[];
  storeRoot: string;
  asOf: string;
}): Promise<ContractResult> {
  const ranked = (
    await rankProjectMemories({
      projectId: input.projectId,
      entries: input.entries,
      task: input.contract.intent,
      storeRoot: input.storeRoot,
      // asOf MUST be forwarded: searchMemoryEntries defaults an absent asOf to
      // wall-clock now (packages/core/src/memory-search.ts:58), which would make
      // ranking eligibility and findingFor's isRecallable classification evaluate
      // validity at two different instants and break --json byte-determinism.
      query: { includeStale: false, limit: Math.max(1, input.entries.length), asOf: input.asOf },
      profile: "safe",
    })
  ).memory;
  const cut: MemoryEntry[] = [];
  const rendered: string[] = [];
  for (const entry of ranked) {
    const candidate = [...rendered, `${entry.title}\n${entry.content}`].join("\n");
    if (estimateTokens(candidate) > input.contract.tokenBudget) break;
    rendered.push(`${entry.title}\n${entry.content}`);
    cut.push(entry);
  }
  const findings = input.contract.requiredEvidence.map((evidence) =>
    findingFor(evidence, { cut, ranked, entries: input.entries, asOf: input.asOf }),
  );
  return {
    name: input.contract.name,
    pass: findings.every((f) => f.status === "pass"),
    findings,
    cut: {
      size: cut.length,
      tokenEstimate: estimateTokens(rendered.join("\n")),
      rankedTotal: ranked.length,
    },
  };
}
```

  `findingFor` (same file — this is the classification core, implement exactly; spread-conditionals keep optional fields absent under `exactOptionalPropertyTypes`):

```ts
function findingFor(
  evidence: ContractEvidence,
  ctx: {
    cut: readonly MemoryEntry[];
    ranked: readonly MemoryEntry[];
    entries: readonly MemoryEntry[];
    asOf: string;
  },
): ContractFinding {
  if (evidence.kind === "memory-entry-ref") {
    const inCut = ctx.cut.find((entry) => entry.id === evidence.value);
    if (inCut) {
      return {
        evidence,
        status: "pass",
        entryId: inCut.id,
        entryTitle: inCut.title,
        detail: `entry ${inCut.id} ("${inCut.title}") is in the cut`,
      };
    }
    const entry = ctx.entries.find((candidate) => candidate.id === evidence.value);
    if (!entry) {
      return {
        evidence,
        status: "fail",
        reason: "entry-missing",
        detail: `no memory entry with id ${evidence.value} exists in this project`,
      };
    }
    const named = { entryId: entry.id, entryTitle: entry.title };
    if (entry.stale) {
      return {
        evidence,
        status: "fail",
        reason: "entry-stale",
        ...named,
        detail: `entry ${entry.id} ("${entry.title}") is marked stale`,
      };
    }
    if (!isRecallable(entry, ctx.asOf)) {
      // Name the sub-gate from the entry's own fields; never re-implement the gate.
      const gate =
        entry.approval !== "approved"
          ? `approval is "${entry.approval}", not "approved"`
          : (entry.tier ?? "recall") === "archival"
            ? "tier is archival (hidden from recall)"
            : `validity window [${entry.validFrom ?? "-inf"}, ${entry.validTo ?? "inf"}) excludes ${ctx.asOf}`;
      return {
        evidence,
        status: "fail",
        reason: "entry-not-recallable",
        ...named,
        detail: `entry ${entry.id} ("${entry.title}") is not recallable: ${gate}`,
      };
    }
    const rankPosition = ctx.ranked.findIndex((candidate) => candidate.id === entry.id) + 1;
    return {
      evidence,
      status: "fail",
      reason: "ranked-below-budget",
      ...named,
      ...(rankPosition > 0 ? { rankPosition } : {}),
      detail:
        rankPosition > 0
          ? `entry ${entry.id} ("${entry.title}") ranked #${rankPosition} of ${ctx.ranked.length} but the token-budget cut ends at #${ctx.cut.length}`
          : `entry ${entry.id} ("${entry.title}") was excluded before ranking`,
    };
  }
  const matches =
    evidence.kind === "file-ref"
      ? (entry: MemoryEntry) =>
          (entry.relatedFiles ?? []).some(
            (file) => normalizePath(file) === normalizePath(evidence.value),
          )
      : (entry: MemoryEntry) =>
          [entry.title, entry.content, ...entry.keywords].some((text) =>
            text.toLowerCase().includes(evidence.value.toLowerCase()),
          );
  const hit = ctx.cut.find(matches);
  if (hit) {
    return {
      evidence,
      status: "pass",
      entryId: hit.id,
      entryTitle: hit.title,
      detail: `${evidence.kind} "${evidence.value}" matched entry ${hit.id} ("${hit.title}") in the cut`,
    };
  }
  return {
    evidence,
    status: "fail",
    reason: "no-entry-in-cut",
    detail: `no entry in the ${ctx.cut.length}-entry cut matches ${evidence.kind} "${evidence.value}"`,
  };
}
```
- [ ] Re-export `evaluateContract` + types from `src/index.ts`.
- [ ] Run — expect PASS. `pnpm --filter @megasaver/memory-recall test` + `typecheck` green.
- [ ] Commit: `feat(memory-recall): contract evaluator names failures`

---

### Task 4: `mega contracts run`

**Files:**
- `apps/cli/src/commands/contracts/run.ts` (new)
- `apps/cli/src/commands/contracts/index.ts` (new)
- `apps/cli/src/main.ts` (add `contracts: contractsCommand` to `subCommands`)
- `apps/cli/test/contracts-run.test.ts` (new)

**Interfaces:**

```ts
export type RunContractsRunInput = {
  projectName: string;
  dirFlag: string | undefined;      // default: join(cwd, "contracts")
  contractFlag: string | undefined; // run one contract by name
  jsonFlag: boolean;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  now?: () => string;               // ISO datetime; default () => new Date().toISOString()
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};
export async function runContractsRun(input: RunContractsRunInput): Promise<0 | 1>;
```

- [ ] Write failing tests `apps/cli/test/contracts-run.test.ts` (cli-test-pattern: mkdtemp store + mkdtemp contracts dir, exercise the INNER `runContractsRun` with injected `now`, plus one citty-adapter smoke via `contractsCommand.run?.({ args } as never)`). Cases:
  1. passing contract → stdout `PASS <name>`, exit 0.
  2. failing ref (stale entry) → stdout `FAIL <name>` line containing the entry id, title, and reason `entry-stale`, plus a `repair:` hint line naming an existing command (`mega memory update` / `mega memory approve`); exit 1.
  3. `--json` → single-line JSON `{ asOf, pass: false, contracts: [...] }` that `JSON.parse`s and carries the `ContractResult` findings verbatim; byte-identical across two invocations with the same injected `now` (determinism evidence).
  4. malformed `bad.contract.json` (unparsable JSON or schema-invalid) → exit 1, stderr names the file.
  5. empty/missing contracts dir → stdout note "no contracts found", exit 0.
  6. unknown project → reuses `projectNotFoundMessage`, exit 1.

  Verified: seed the store exactly the way `apps/cli/test/memory-from-session.test.ts` does — its `seed()` helper (lines 53-79) writes `projects.json` and `sessions.json` object arrays directly with node:fs into the mkdtemp store, and its `env()` helper (lines 36-51) shows the injected-input shape. Reuse that pattern verbatim (adding a `memory/` entries file for the ranked entries) rather than inventing new registry seeding.
- [ ] Run `pnpm --filter @megasaver/cli test -- test/contracts-run.test.ts` — expect FAIL (module does not exist).
- [ ] Implement `run.ts`: resolve store via `resolveStorePath`/`ensureStoreReady` and the project via `registry.listProjects().find(...)` (mirror `apps/cli/src/commands/memory/search.ts`); read `*.contract.json` from the dir sorted lexicographically; `contractSchema.safeParse` each (failure → named load failure); `evaluateContract` each with `entries: registry.listMemoryEntries(project.id)` and `asOf: (input.now ?? (() => new Date().toISOString()))()`; exit 1 iff any load failure or failed contract. Citty adapter per cli-test-pattern with `MEGA_TEST_NOW` env injection via `readTestEnv`. The report surface is fixed by the plan — implement exactly:

```ts
// Repair hints name only existing commands; approval repair is the HUMAN
// gate (mega memory approve) — never an auto-approval.
const repairHintFor = (finding: ContractFinding): string => {
  switch (finding.reason) {
    case "entry-missing":
      return `mega memory create (no entry ${finding.evidence.value} in this project)`;
    case "entry-stale":
      return `mega memory update ${finding.entryId}`;
    case "entry-not-recallable":
      return `mega memory approve ${finding.entryId} (human gate) or mega memory update ${finding.entryId}`;
    case "ranked-below-budget":
      return `raise tokenBudget in the contract file or mega memory update ${finding.entryId} to sharpen keywords`;
    default:
      return `mega memory create or mega memory update so an in-cut entry carries "${finding.evidence.value}"`;
  }
};
const renderReport = (results: readonly ContractResult[]): string[] =>
  results.flatMap((result) =>
    result.pass
      ? [`PASS ${result.name} (cut ${result.cut.size}/${result.cut.rankedTotal}, ~${result.cut.tokenEstimate} tokens)`]
      : [
          `FAIL ${result.name}`,
          ...result.findings
            .filter((finding) => finding.status === "fail")
            .flatMap((finding) => [
              `  ${finding.reason}: ${finding.detail}`,
              `  repair: ${repairHintFor(finding)}`,
            ]),
        ],
  );
// --json: exactly one stdout line, key order fixed for byte-determinism.
input.stdout(JSON.stringify({ asOf, pass: results.every((r) => r.pass), contracts: results }));
```
- [ ] Implement `contracts/index.ts` (`defineCommand` with `subCommands: { run: contractsRunCommand }`) and register `contracts: contractsCommand` in `apps/cli/src/main.ts`.
- [ ] Run — expect PASS. `pnpm --filter @megasaver/cli test` + `typecheck` + `pnpm exec biome check apps/cli` green.
- [ ] Commit: `feat(cli): mega contracts run`

---

### Task 5: local run record under `withFileLock`

**Files:**
- `apps/cli/src/commands/contracts/record.ts` (new)
- `apps/cli/test/contracts-record.test.ts` (new)
- `apps/cli/src/commands/contracts/run.ts` (wire in)

**Interfaces:**

```ts
export function recordContractRun(input: {
  storeRoot: string;
  projectId: string;
  at: string; // ISO datetime (injected)
  results: readonly ContractResult[];
  deadlineMs?: number; // withFileLock deadline; default 2_000 — tests pass 50
}): boolean; // false = lock miss, record skipped
```

- [ ] Write failing tests: (1) first call creates `<storeRoot>/contract-runs/<projectId>.jsonl` with one JSON line per contract `{ at, name, pass, failReasons }` (ids/names only — no memory content); (2) second call appends; (3) with a FRESH pre-created lock file at `<storeRoot>/contract-runs/<projectId>.lock` the call returns `false` and the JSONL is unchanged (deterministic post-deadline outcome of `withFileLock` with `deadlineMs: 50` and a fresh lock — an outcome assertion, not a duration assertion).
- [ ] Run — expect FAIL.
- [ ] Implement with `withFileLock(lockPath, { deadlineMs: input.deadlineMs ?? 2_000, staleMs: 30_000 }, () => { mkdirSync(dir, { recursive: true }); appendFileSync(path, lines); })` (`@megasaver/shared`); wire into `runContractsRun` after report emission — `recordContractRun(...) === false` emits a stderr note `note: contract run not recorded (lock held)` and never alters the exit code. Production callers omit `deadlineMs` (2 000 default); tests pass `deadlineMs: 50` through the input field, not a magic sleep.
- [ ] Run — expect PASS; package green.
- [ ] Commit: `feat(cli): record contract runs locally`

---

### Task 6: `mega contracts add`

**Files:**
- `apps/cli/src/commands/contracts/add.ts` (new)
- `apps/cli/src/commands/contracts/index.ts` (add `add` subcommand)
- `apps/cli/test/contracts-add.test.ts` (new)

**Interfaces:**

```ts
export type RunContractsAddInput = {
  projectName: string;
  sessionFlag: string;                    // required session id
  nameFlag: string | undefined;           // default: slug of intent
  intentFlag: string | undefined;         // overrides session title
  budgetFlag: number | undefined;         // default DEFAULT_CONTRACT_TOKEN_BUDGET = 2_000
  evidenceMemoryFlag: string | undefined; // comma-separated memory entry ids
  evidenceFileFlag: string | undefined;   // comma-separated file refs
  evidenceKeywordFlag: string | undefined;// comma-separated keywords
  dirFlag: string | undefined;
  writeFlag: boolean;                     // default false = preview only
  forceFlag: boolean;
  jsonFlag: boolean;
  storeFlag: string | undefined;
  cwd: string; home: string; xdgDataHome: string | undefined;
  platform: NodeJS.Platform; localAppData: string | undefined;
  stdout: (line: string) => void; stderr: (line: string) => void;
};
export async function runContractsAdd(input: RunContractsAddInput): Promise<0 | 1>;
```

- [ ] Write failing tests `apps/cli/test/contracts-add.test.ts`:
  1. session with a title and a replay trace carrying `rankedByMemoryIds` → preview prints a schema-valid contract whose `intent` is the session title, `requiredEvidence` is the deduped trace memory ids as `memory-entry-ref`s, `createdFrom` is the session id; nothing written without `--write`.
  2. `--write` persists `contracts/<name>.contract.json` (pretty JSON + trailing newline) that round-trips through `contractSchema.parse`; a second `--write` without `--force` exits 1 naming the existing file; with `--force` overwrites.
  3. explicit `--evidence-keyword build,deploy` overrides trace derivation entirely.
  4. session without title and no `--intent` → exit 1 with a message telling the user to pass `--intent`.
  5. no trace and no `--evidence-*` flags → exit 1 telling the user to pass explicit evidence.
  6. session belonging to a different project → exit 1.

  Trace fixture: write `<storeRoot>/stats/<projectId>/<sessionId>-traces/replay-traces.jsonl` lines conforming to `replayTraceSchema` (`packages/output-filter/src/replay-trace.ts:114`) with `ranking.rankedByMemoryIds` set — the same file `readSessionDecisionTrace` reads.
- [ ] Run — expect FAIL.
- [ ] Implement `add.ts`: parse session id with `sessionIdSchema` (`@megasaver/shared`); `registry.getSession(id)` must exist and match the project. Intent = `intentFlag ?? session.title` (else exit 1). Evidence = explicit flags (comma-split, trimmed, deduped) if ANY given; else derive:

```ts
import { readSessionDecisionTrace } from "@megasaver/output-filter";
// Placeholder 16-hex workspaceKey: the evidence JOIN needs a real key, but the
// memory ids we consume are stamped INLINE on registry traces
// (wiki/decisions/decision-trace-inline-not-join) — same trick as
// apps/cli/src/commands/trace/explain.ts:15.
const trace = readSessionDecisionTrace(
  { root: rootDir },
  { projectId: project.id, sessionId: session.id, workspaceKey: "0".repeat(16) },
);
const ids = [...new Set(trace.outputs.flatMap((o) => o.memory?.rankedByMemoryIds ?? []))];
```

  Build the candidate object, default `name` = `slugify(intent)`, `tokenBudget` = `budgetFlag ?? 2_000`, then `contractSchema.parse` BEFORE any write (re-parse at the handoff boundary is required here: the file writer persists it verbatim — §8 parse-on-handoff policy; an empty/invalid slug fails this parse and exits 1). The slug rule is fixed by the plan:

```ts
// Must satisfy contractSchema's /^[a-z0-9][a-z0-9-]{0,63}$/ name guard.
const slugify = (intent: string): string =>
  intent
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 64)
    .replace(/-+$/, "");
```

  Preview to stdout (single-line `JSON.stringify(contract)` when `--json`, `JSON.stringify(contract, null, 2)` otherwise); `--write` → `mkdirSync(dir, { recursive: true })`, refuse existing file without `--force`, `writeFileSync(path, \`${JSON.stringify(contract, null, 2)}\n\`)` (pretty JSON + trailing newline, matching test 2).
- [ ] Wire `add: contractsAddCommand` into `contracts/index.ts`.
- [ ] Run — expect PASS. `pnpm --filter @megasaver/cli test` + `typecheck` + biome green.
- [ ] Commit: `feat(cli): mega contracts add captures sessions`

---

### Task 7: changeset, smoke evidence, wiki

**Files:**
- `.changeset/context-contracts.md` (new)
- `wiki/entities/cli.md`, `wiki/entities/memory-recall.md`, `wiki/log.md`

- [ ] Add changeset: `@megasaver/cli` minor (new public `mega contracts run|add` surface). `@megasaver/memory-recall` is `private: true` — include it only if the repo's existing changesets version private packages (check `.changeset/config.json` `privatePackages` before deciding; mirror precedent).
- [ ] Run `pnpm verify` at the branch tip — lint + typecheck + full vitest green (DoD #4).
- [ ] Capture CLI smoke evidence (DoD #5) in the PR description: a real terminal session showing `mega contracts add` (preview + `--write`) → `mega contracts run` FAIL naming a deliberately staled entry → repair via the named existing command → `mega contracts run` PASS with `--json` exit 0. This is the roadmap 2.4 gate replayed end-to-end: fail names the stale memory, passes after an auditable repair, traces local.
- [ ] Update `wiki/entities/cli.md` (contracts surface) and `wiki/entities/memory-recall.md` (schema + evaluator + safe-profile input); append a timestamped `wiki/log.md` entry.
- [ ] Commit: `docs(contracts): changeset + wiki for contracts surface`

---

## Self-review notes

- Verified symbols: `rankProjectMemories` input/result + line-287 profile toggle + unreached `rankSafe` (`packages/memory-recall/src/rank-project-memories.ts`); `isRecallable` (`packages/core/src/memory-entry.ts:176`); `estimateTokens` (`packages/output-filter/src/tokens.ts:17`); `readSessionDecisionTrace` + inline `rankedByMemoryIds` (`packages/output-filter/src/decision-trace.ts:100`); `replayTraceSchema` (`replay-trace.ts:114`); `withFileLock` (`packages/shared/src/file-lock.ts`); `registry.getSession`/`listSessions` (`packages/core/src/registry.ts:73-74`); `sessionIdSchema` (`packages/shared/src/ids.ts:17`); CLI §3c allow-list already contains memory-recall + output-filter (`apps/cli/test/dependency-graph.test.ts:43-44`); `MemorySearchQuery.limit` is positive-int with no max (`packages/core/src/memory-search.ts:32`), so `limit: entries.length` is valid.
- Remaining `ASSUMPTION:` markers: none. The three former markers (Task 1 sidecar helper, Task 2 `MAX_LM2_CANDIDATE_TEXT_CODE_UNITS`, Task 4 store seeding) were verified against the repo and are now stated as facts with file:line citations at their sites.
