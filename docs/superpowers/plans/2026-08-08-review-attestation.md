# Review Attestation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `mega review attest <base>..<head> --verdict <v>` and
`mega review check <base>..<head>` — a local, git-native, append-only
record that a review verdict was recorded against a SPECIFIC diff
hash, and a mechanical way to detect when that hash has gone stale
(spec: `docs/superpowers/specs/2026-08-08-review-attestation-design.md`).

**Architecture:** One new core module
(`packages/core/src/review-attestation.ts`) owns the schema, the
sha256 diff-hash computation (reusing the exact `ExecGit` injection
shape `memory-anchor.ts` already established), and the append/read
JSONL functions (mirroring `guard-state.ts`/`firewall-ledger.ts`'s
existing patterns exactly). Two new thin CLI commands
(`apps/cli/src/commands/review/{attest,check}.ts`) compose them.

**Tech Stack:** TypeScript strict ESM, Zod, `node:crypto` (sha256),
`node:child_process` (`execFileSync`, injected), Citty, Vitest.

## Global Constraints

- Diff hash is `sha256(git diff --no-color <range>)`, full 64 hex chars, never truncated (spec Locked Decision 1).
- `ExecGit`'s exact shape — `(args: string[], cwd: string, input?: string) => string` — must match `memory-anchor.ts`'s type precisely (spec Component 2); Task 1 resolves whether to import it (requires exporting it there first) or duplicate the tiny type alias, and states which choice was made and why.
- `appendAttestation` NEVER swallows a write failure — this is the one deliberate departure from every other append-only-ledger precedent in this repo (spec Error handling) — do not copy `appendFirewallEvent`'s try/catch-swallow pattern here.
- `--note` is redacted via `@megasaver/policy`'s `redact()` before it touches disk, no exceptions (spec Security & privacy).
- No existing file's behavior changes — this plan only adds new files (one core module, two CLI command files, their `index.ts`, their tests) plus one line in `apps/cli/src/main.ts` registering the new `review` parent command.
- No entitlement gate on either command (spec Locked Decision 6).
- `mega review check`'s exit code stays informational/report-only in v1 — 0 in every non-usage-error case, including `stale` (spec Non-Goals: no merge gate yet).
- cli-test-pattern: injected `execGit`/store/clock, `mkdtempSync` temp stores, no timing-tight assertions.

---

### Task 1: Core module — schema, diff hash, append/read

**Files:**
- Create: `packages/core/src/review-attestation.ts`
- Modify: `packages/core/src/memory-anchor.ts` (export `ExecGit`, IF that is the chosen path — see Step 1)
- Modify: `packages/core/src/index.ts` (export the new module's public surface)
- Create: `packages/core/test/review-attestation.test.ts`

**Interfaces:**

```ts
// review-attestation.ts
export const reviewVerdictSchema = z.enum(["approve", "request-changes", "needs-work"]);
export type ReviewVerdict = z.infer<typeof reviewVerdictSchema>;

export const reviewAttestationSchema = z.object({
  diffHash: z.string().length(64),
  baseRef: z.string().min(1),
  headRef: z.string().min(1),
  verdict: reviewVerdictSchema,
  reviewerLabel: z.string().min(1),
  note: z.string().optional(),
  reviewPackId: z.string().optional(),
  createdAt: z.string().datetime({ offset: true }),
}).strict();
export type ReviewAttestation = z.infer<typeof reviewAttestationSchema>;

export type ExecGit = (args: string[], cwd: string, input?: string) => string;
export function computeDiffHash(range: string, cwd: string, execGit?: ExecGit): string;
export function attestationLogPath(storeRoot: string, projectId: string): string;
export function appendAttestation(storeRoot: string, projectId: string, record: ReviewAttestation): void;
export function readAttestations(storeRoot: string, projectId: string): ReviewAttestation[];
```

**Steps:**

- [ ] Read `packages/core/src/memory-anchor.ts` in full, specifically its `ExecGit` type (line 77) and `defaultExecGit` (the lines immediately after) — decide HERE, before writing any new code, whether to `export type ExecGit` from that file and import it, or declare an identical local type in the new file. Prefer exporting and importing (avoids type drift between two files describing the same shell-out shape); only duplicate if exporting would require touching unrelated parts of `memory-anchor.ts`'s public surface in a way that feels out of scope. State the choice in the commit body.
- [ ] Read `packages/core/src/guard-state.ts` (schema + `readGuardState`/`writeGuardState`) and `packages/context-gate/src/firewall-ledger.ts` (`appendFirewallEvent`, `firewallLogPath`) in full — `attestationLogPath`/`appendAttestation`/`readAttestations` are a direct structural mirror of these, adjusted only for the deliberate no-swallow write (Global Constraints).
- [ ] Write the failing tests, `packages/core/test/review-attestation.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendAttestation,
  attestationLogPath,
  computeDiffHash,
  readAttestations,
  reviewAttestationSchema,
} from "../src/review-attestation.js";

describe("computeDiffHash", () => {
  it("is deterministic for identical diff content", () => {
    const fakeGit = () => "diff --git a/x b/x\n+hello\n";
    expect(computeDiffHash("main..HEAD", "/repo", fakeGit)).toBe(
      computeDiffHash("main..HEAD", "/repo", fakeGit),
    );
  });
  it("changes when the diff content changes by one character", () => {
    const a = computeDiffHash("main..HEAD", "/repo", () => "+hello\n");
    const b = computeDiffHash("main..HEAD", "/repo", () => "+hellO\n");
    expect(a).not.toBe(b);
  });
  it("returns a 64-char hex string", () => {
    const hash = computeDiffHash("main..HEAD", "/repo", () => "anything");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("passes the exact range and cwd through to execGit as a git diff invocation", () => {
    const spy = vi.fn(() => "");
    computeDiffHash("main..HEAD", "/my/repo", spy);
    expect(spy).toHaveBeenCalledWith(["diff", "--no-color", "main..HEAD"], "/my/repo");
  });
});

describe("appendAttestation / readAttestations", () => {
  let storeRoot: string;
  beforeEach(() => {
    storeRoot = mkdtempSync(join(tmpdir(), "review-attest-test-"));
  });
  afterEach(() => {
    rmSync(storeRoot, { recursive: true, force: true });
  });

  const RECORD = reviewAttestationSchema.parse({
    diffHash: "a".repeat(64),
    baseRef: "main",
    headRef: "HEAD",
    verdict: "approve",
    reviewerLabel: "code-reviewer",
    createdAt: "2026-08-08T00:00:00.000Z",
  });

  it("round-trips every field", () => {
    appendAttestation(storeRoot, "proj1", RECORD);
    const rows = readAttestations(storeRoot, "proj1");
    expect(rows).toEqual([RECORD]);
  });

  it("skips a malformed line without throwing", () => {
    appendAttestation(storeRoot, "proj1", RECORD);
    // append raw garbage manually
    const fs = require("node:fs");
    fs.appendFileSync(attestationLogPath(storeRoot, "proj1"), "not-json\n");
    const rows = readAttestations(storeRoot, "proj1");
    expect(rows).toEqual([RECORD]);
  });

  it("throws on a write failure instead of swallowing it", () => {
    const badRoot = join(storeRoot, "\0invalid"); // or another guaranteed-unwritable path per this repo's existing convention for forcing an fs error in a test — check an existing precedent (e.g. content-store's atomic-write tests) for how a write failure is deterministically forced, and use that exact technique here instead of a NUL-byte path if that precedent differs
    expect(() => appendAttestation(badRoot, "proj1", RECORD)).toThrow();
  });
});
```

- [ ] Check this repo's existing convention for deterministically forcing a write failure in a test (search `packages/content-store/test/atomic-write.test.ts` or similar) before finalizing the last test above — replace the placeholder NUL-byte approach with whatever technique this codebase already uses and trusts.
- [ ] RED: `pnpm --filter @megasaver/core exec vitest run test/review-attestation.test.ts` — expect FAIL (module not found).
- [ ] Implement `review-attestation.ts`:

```ts
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

export const reviewVerdictSchema = z.enum(["approve", "request-changes", "needs-work"]);
export type ReviewVerdict = z.infer<typeof reviewVerdictSchema>;

export const reviewAttestationSchema = z
  .object({
    diffHash: z.string().length(64),
    baseRef: z.string().min(1),
    headRef: z.string().min(1),
    verdict: reviewVerdictSchema,
    reviewerLabel: z.string().min(1),
    note: z.string().optional(),
    reviewPackId: z.string().optional(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type ReviewAttestation = z.infer<typeof reviewAttestationSchema>;

export type ExecGit = (args: string[], cwd: string, input?: string) => string;

function defaultExecGit(args: string[], cwd: string): string {
  const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "ignore"],
    timeout: 10_000,
    maxBuffer: 50 * 1024 * 1024,
  });
}

export function computeDiffHash(range: string, cwd: string, execGit: ExecGit = defaultExecGit): string {
  const raw = execGit(["diff", "--no-color", range], cwd);
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function attestationLogPath(storeRoot: string, projectId: string): string {
  return join(storeRoot, "review-attestation", projectId, "attestations.jsonl");
}

export function appendAttestation(storeRoot: string, projectId: string, record: ReviewAttestation): void {
  const path = attestationLogPath(storeRoot, projectId);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(reviewAttestationSchema.parse(record))}\n`);
}

export function readAttestations(storeRoot: string, projectId: string): ReviewAttestation[] {
  let raw: string;
  try {
    raw = readFileSync(attestationLogPath(storeRoot, projectId), "utf8");
  } catch {
    return [];
  }
  const rows: ReviewAttestation[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      const parsed = reviewAttestationSchema.safeParse(JSON.parse(trimmed));
      if (parsed.success) rows.push(parsed.data);
    } catch {
      // skip malformed line
    }
  }
  return rows;
}
```

- [ ] Replace the `require("node:child_process")` placeholder with a proper top-level `import { execFileSync } from "node:child_process";` — the plan wrote it as a lazy require only to keep the snippet's diff minimal; the real implementation must use a normal ESM import per this repo's `module: NodeNext` / ESM-only convention (`docs/conventions/code-conventions.md`).
- [ ] Use whichever `MAX_BUFFER`/timeout constants this file's sibling git-shelling code already names (check `memory-anchor.ts`'s `defaultExecGit` for its exact `timeout: 3000` / `maxBuffer: 10 * 1024 * 1024` values) — align or deliberately diverge with a stated reason (a diff can legitimately be larger than an anchor lookup's git output; a larger maxBuffer is likely correct — keep the plan's 50MB unless investigation suggests otherwise).
- [ ] GREEN: re-run — expect PASS.
- [ ] Export `reviewVerdictSchema`, `ReviewVerdict`, `reviewAttestationSchema`, `ReviewAttestation`, `computeDiffHash`, `attestationLogPath`, `appendAttestation`, `readAttestations` from `packages/core/src/index.ts`, placed alphabetically/thematically near the other ledger-style exports (check where `guard-state.ts`'s exports sit in that file and add nearby).
- [ ] Commit:

```bash
git add packages/core/src/review-attestation.ts packages/core/src/memory-anchor.ts packages/core/src/index.ts packages/core/test/review-attestation.test.ts
git commit -m "feat(core): add review-attestation module (diff-hash ledger)"
```

---

### Task 2: `mega review attest` CLI command

**Files:**
- Create: `apps/cli/src/commands/review/attest.ts`
- Create: `apps/cli/src/commands/review/index.ts`
- Modify: `apps/cli/src/main.ts` (register `review: reviewCommand`)
- Create: `apps/cli/test/commands/review/attest.test.ts`

**Interfaces:**

```ts
export type RunReviewAttestInput = {
  projectName: string;
  range: string; // "<base>..<head>" as one positional, split internally
  verdictFlag: string;
  reviewerFlag: string | undefined;
  noteFlag: string | undefined;
  reviewPackFlag: string | undefined;
  storeFlag: string | undefined;
  cwd: string; home: string; xdgDataHome: string | undefined;
  platform: NodeJS.Platform; localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
  now?: () => string;
  execGit?: ExecGit;
};
export async function runReviewAttest(input: RunReviewAttestInput): Promise<0 | 1>;
```

**Steps:**

- [ ] Read `apps/cli/src/commands/fail/record.ts` in full (already open from investigation) — `runReviewAttest` mirrors its store-resolve → project-lookup → validate-inputs → construct-record → persist → print skeleton exactly.
- [ ] Decide the range-parsing contract: a single positional `"<base>..<head>"` (git's own range syntax, split on `..` for `baseRef`/`headRef` display fields) vs two separate positionals. Prefer the single-positional git-native form (`mega review attest main..HEAD --verdict approve`) since `computeDiffHash` already takes one `range` string matching `git diff`'s own argument shape — write a small `parseRange(raw: string): { range: string; baseRef: string; headRef: string } | null` pure helper (reject a range missing `..`, reject empty base/head) and unit-test it first.
- [ ] Write the failing tests in `apps/cli/test/commands/review/attest.test.ts`:

```ts
describe("parseRange", () => {
  it("splits a valid base..head range", () => {
    expect(parseRange("main..HEAD")).toEqual({ range: "main..HEAD", baseRef: "main", headRef: "HEAD" });
  });
  it("rejects a range with no '..'", () => {
    expect(parseRange("main")).toBeNull();
  });
  it("rejects an empty base or head", () => {
    expect(parseRange("..HEAD")).toBeNull();
    expect(parseRange("main..")).toBeNull();
  });
});

describe("runReviewAttest", () => {
  it("valid verdict + range → appends one record with the computed diff hash", async () => {
    // seed a project; inject a fake execGit returning fixed diff text;
    // assert readAttestations(storeRoot, projectId) has exactly one row
    // matching computeDiffHash's own output for the same fake execGit
  });
  it("invalid --verdict → usage error, exit 1, no record written", async () => {});
  it("--note containing a secret-shaped string is redacted before the stored bytes", async () => {
    // e.g. an API-key-shaped token in --note; assert the stored record's
    // `note` field does NOT contain the raw secret substring
  });
  it("unknown project → the standard projectNotFoundMessage error", async () => {});
});
```

- [ ] RED: `pnpm --filter @megasaver/cli exec vitest run test/commands/review/attest.test.ts` — expect FAIL.
- [ ] Implement `parseRange` and `runReviewAttest` in `attest.ts`, following `fail/record.ts`'s exact structure: store resolve, project lookup, `parseRange` (usage error on `null`), `reviewVerdictSchema.safeParse(verdictFlag)` (usage error on failure — do not accept an arbitrary string), `redact(noteFlag ?? "").redacted` when `noteFlag` is present, construct the record via `reviewAttestationSchema.parse({...})`, `appendAttestation`, print a one-line confirmation (`attested <diffHash-prefix> verdict=<v>`) or `--json` the full record.
- [ ] Wire `reviewAttestCommand` (citty), args: `range` (positional, required), `--verdict` (required), `--reviewer` (optional, default `"unspecified"` per Locked Decision 3's required-but-free-text field — confirm this default choice makes sense or whether the flag should instead be required; lean toward REQUIRED with no default, since a reviewer label of `"unspecified"` undermines the whole point of the record — resolve this before finalizing and note the decision), `--note`, `--review-pack`, `--project` (required), `--store`, `--json`.
- [ ] GREEN: re-run — expect PASS.
- [ ] Create `apps/cli/src/commands/review/index.ts`:

```ts
import { defineCommand } from "citty";
import { reviewAttestCommand } from "./attest.js";

export { type RunReviewAttestInput, runReviewAttest, parseRange, reviewAttestCommand } from "./attest.js";

export const reviewCommand = defineCommand({
  meta: { name: "review", description: "Review attestation: record and check reviewer verdicts against diff hashes." },
  subCommands: { attest: reviewAttestCommand },
});
```

(Task 3 adds `check` to this file's `subCommands` and export list.)

- [ ] Register in `apps/cli/src/main.ts`: import `reviewCommand` from `./commands/review/index.js`, add `review: reviewCommand` to `subCommands` (alphabetical position).
- [ ] Commit:

```bash
git add apps/cli/src/commands/review/attest.ts apps/cli/src/commands/review/index.ts apps/cli/src/main.ts apps/cli/test/commands/review/attest.test.ts
git commit -m "feat(cli): add mega review attest"
```

---

### Task 3: `mega review check` CLI command

**Files:**
- Create: `apps/cli/src/commands/review/check.ts`
- Modify: `apps/cli/src/commands/review/index.ts` (add `check` subcommand + exports)
- Create: `apps/cli/test/commands/review/check.test.ts`

**Interfaces:**

```ts
export type ReviewCheckStatus = "no-attestations" | "current" | "stale";
export type ReviewCheckResult = {
  status: ReviewCheckStatus;
  currentDiffHash: string;
  current: ReviewAttestation[];
  mostRecentStale: ReviewAttestation | null;
};
export async function runReviewCheck(input: RunReviewCheckInput): Promise<0 | 1>;
export function classifyAttestations(currentHash: string, all: readonly ReviewAttestation[]): ReviewCheckResult;
```

**Steps:**

- [ ] Write the failing tests first, `apps/cli/test/commands/review/check.test.ts`:

```ts
describe("classifyAttestations", () => {
  it("no-attestations when the list is empty", () => {
    expect(classifyAttestations("a".repeat(64), []).status).toBe("no-attestations");
  });
  it("current when the newest matching-hash attestation exists", () => {
    const hash = "a".repeat(64);
    const match = { /* ...fixture with diffHash: hash */ };
    const result = classifyAttestations(hash, [match]);
    expect(result.status).toBe("current");
    expect(result.current).toEqual([match]);
  });
  it("stale when attestations exist but none match the current hash", () => {
    const old = { /* ...fixture with diffHash: "b".repeat(64) */ };
    const result = classifyAttestations("a".repeat(64), [old]);
    expect(result.status).toBe("stale");
    expect(result.mostRecentStale).toEqual(old);
  });
  it("surfaces both current matches and the most recent stale row when history has both", () => {
    // one attestation matching the current hash, one older one that does not
  });
});

describe("runReviewCheck", () => {
  it("reports current with the right verdict/reviewer when a matching attestation exists", async () => {});
  it("reports stale, printing both the stale record and the live hash", async () => {});
  it("reports no-attestations for a project with none", async () => {});
  it("--json emits the full ReviewCheckResult structure", async () => {});
});
```

- [ ] RED: `pnpm --filter @megasaver/cli exec vitest run test/commands/review/check.test.ts` — expect FAIL.
- [ ] Implement `classifyAttestations` (pure, no I/O — sort by `createdAt` descending first, then partition):

```ts
export function classifyAttestations(
  currentHash: string,
  all: readonly ReviewAttestation[],
): ReviewCheckResult {
  if (all.length === 0) {
    return { status: "no-attestations", currentDiffHash: currentHash, current: [], mostRecentStale: null };
  }
  const sorted = [...all].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const current = sorted.filter((r) => r.diffHash === currentHash);
  const mostRecentStale = sorted.find((r) => r.diffHash !== currentHash) ?? null;
  return {
    status: current.length > 0 ? "current" : "stale",
    currentDiffHash: currentHash,
    current,
    mostRecentStale,
  };
}
```

- [ ] Implement `runReviewCheck`: store resolve → project lookup → `parseRange` (reuse from `attest.ts`, import it) → `computeDiffHash` → `readAttestations` → `classifyAttestations` → render text (per spec Locked Decision 4's exact wording: `current` prints verdict+reviewer newest-first; `stale` prints `STALE — diff changed since this review` plus the stale record's verdict/hash/timestamp AND the live hash; `no-attestations` prints a one-line "no reviews recorded for this project yet") or `--json` the full `ReviewCheckResult`.
- [ ] Exit code stays 0 for `current`/`stale`/`no-attestations` (all are successful reports, per spec Non-Goals — report-only in v1); exit 1 reserved for usage errors (bad range, unknown project) only.
- [ ] Wire `reviewCheckCommand` (citty), args: `range` (positional), `--project` (required), `--store`, `--json`.
- [ ] Add `check: reviewCheckCommand` to `review/index.ts`'s `subCommands`, plus its exports.
- [ ] GREEN: re-run — expect PASS.
- [ ] Commit:

```bash
git add apps/cli/src/commands/review/check.ts apps/cli/src/commands/review/index.ts apps/cli/test/commands/review/check.test.ts
git commit -m "feat(cli): add mega review check"
```

---

### Task 4: Full verification, `--json` failure-path coverage, changeset, wiki

**Files:**
- Modify: `apps/cli/test/json-failure-paths.test.ts` (add `mega review attest`/`check` cases)
- Modify: `apps/cli/test/dependency-graph.test.ts` (verify — should need no edit, `review/*.ts` only uses already-allowed `@megasaver/core`, `@megasaver/policy`, `@megasaver/shared`)
- Create: `.changeset/review-attestation.md`
- Modify: `wiki/log.md`

**Steps:**

- [ ] Add `mega review attest`/`mega review check` failure-path cases to `apps/cli/test/json-failure-paths.test.ts`, following that file's existing per-command pattern.
- [ ] Run `pnpm --filter @megasaver/cli exec vitest run test/dependency-graph.test.ts` — confirm PASS with no edit (both new command files only import already-allowed packages).
- [ ] Run the full monorepo gate:

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
pnpm verify
```

- [ ] Confirm all Turbo tasks green (record the observed pass count).
- [ ] **Dogfood this feature on itself before closing the loop**: after this plan's own code review happens (per AGENTS.md's mandatory MEDIUM-risk `code-reviewer` gate), run `mega review attest <base>..<head> --verdict approve --reviewer code-reviewer --project MegaSaver` for real against this feature's own diff, then `mega review check` to confirm it reports `current`. This is the first real attestation this repo will have — a concrete, checkable demonstration of the feature working on the exact process it exists to serve.
- [ ] Create the changeset `.changeset/review-attestation.md`:

```markdown
---
"@megasaver/core": minor
"@megasaver/cli": minor
---

Add `mega review attest`/`mega review check` — a local, git-native,
append-only record that a review verdict was recorded against a
specific diff hash, and a mechanical way to detect a stale approval
(the diff changed after the review). Complements the repo's own
mandatory author≠reviewer process discipline with a checkable
artifact instead of a self-reported claim.
```

- [ ] Append a timestamped `wiki/log.md` entry: the self-reported-compliance gap this closes (cite the recurring "author≠reviewer" claim pattern found in this repo's own log history), what was built, verification evidence including the self-dogfood attestation.
- [ ] Final commit:

```bash
git add apps/cli/test/json-failure-paths.test.ts .changeset/review-attestation.md wiki/log.md
git commit -m "test(cli): review-attestation json-failure-path coverage; changeset + wiki"
```
