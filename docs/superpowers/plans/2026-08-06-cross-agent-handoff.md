# Cross-Agent Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `mega handoff` capability-aware (per-target profiles, fail-closed open-side enforcement with `--fit`) and mesh-discoverable (`peers` listing, pointer-only `offer`), per `docs/superpowers/specs/2026-08-06-cross-agent-handoff-design.md`.

**Architecture:** The packet format is untouched (`HANDOFF_SCHEMA_VERSION` stays `"1"`); all translation is consume-side. `@megasaver/connectors-shared` gains the agent-agnostic capability schema + fit evaluator; each `ConnectorTarget` declares its profile as a new required field; `apps/cli` enforces at `open`, advises at `pack`, and adds mesh-backed `peers`/`offer` with injected mesh deps.

**Tech Stack:** TypeScript strict ESM, Zod at boundaries, Vitest, Citty subcommands, pnpm workspaces.

## Global Constraints

- **Blocked until hot-handoff i10 merges to `main`** — every file this plan touches ships with i10; do not start Task 1 before the merge.
- Tasks 6–7 are additionally blocked until `@megasaver/mesh` (session-mesh plan, build 1 of 11) ships. The mesh v1 kind union is exactly `message | ask | answer` (`meshMessageSchema`, `.strict()`) — it does NOT include `handoff-offer` — so Tasks 6–7 begin with an additive amendment adding the `handoff-offer` kind plus an optional structured `offer` field to `meshMessageSchema` and `sendMessage` (spec ASSUMPTION A2; this feature owns that amendment, the mesh plan as written does not carry it). Tasks 1–5 need only i10.
- `HANDOFF_SCHEMA_VERSION` stays `"1"`; `packages/core/src/handoff-packet.ts` is never modified.
- The `MEGA SAVER:HANDOFF` sentinel pair, `renderHandoffBlockText` block shape, and `upsertHandoffBlockText` are locked — no changes to `packages/connectors/shared/src/{constants,handoff-block,upsert}.ts`.
- ProFeature key is the existing `"hot-handoff"` via `gate()` (`apps/cli/src/commands/handoff/shared.ts`); no new key; `offer` is Pro-gated, `peers` is free.
- Capability refusal = exit 1 + nothing written; refusal reasons are the closed union `"section_diff" | "section_git" | "block_too_large"`.
- `--fit` drop order is deterministic: `diffText` first, then `gitLine`; `resumeInstructions`/`summaryText` are never dropped.
- `maxBlockChars` is measured on `renderHandoffBlockText(fields).length` (rendered block, sentinels + footer included).
- Profile data: aider `acceptsDiff: false`; windsurf `maxBlockChars: 6000` (spec ASSUMPTION A1/OQ1); claude-code/codex/cursor/gemini/continue all-permissive `{ acceptsDiff: true, acceptsGitLine: true, maxBlockChars: null }`.
- Offer messages carry ONLY the pointer `{ packetPath, payloadSha256, targetAgent, expiresAt, sourceProject }` plus the mesh-required advisory `text` line composed from those same pointer fields; packet payload text never enters a mesh message; nothing ever auto-runs `mega handoff open`.
- Risk HIGH (§12): worktree `feat/cross-agent-handoff`, no `main` edits, `code-reviewer` AND `critic` separate passes, author ≠ reviewer.
- No timing-tight tests; all mesh interaction in tests goes through injected functions (no daemon, no real mesh).

---

### Task 1: Capability profile schema + fit evaluator

**Files:**
- Create: `packages/connectors/shared/src/handoff-capability.ts`
- Modify: `packages/connectors/shared/src/index.ts`
- Test: `packages/connectors/shared/test/handoff-capability.test.ts`

**Interfaces:**
- Consumes: `HandoffBlockFields`, `renderHandoffBlockText` (`packages/connectors/shared/src/handoff-block.ts`).
- Produces:
  ```ts
  export interface HandoffCapabilityProfile {
    readonly acceptsDiff: boolean;
    readonly acceptsGitLine: boolean;
    readonly maxBlockChars: number | null;
  }
  export const handoffCapabilityProfileSchema: z.ZodType<HandoffCapabilityProfile>;
  export type HandoffRefusalReason = "section_diff" | "section_git" | "block_too_large";
  export interface HandoffRefusal { readonly reason: HandoffRefusalReason; readonly detail: string; }
  export type HandoffFitResult =
    | { readonly ok: true; readonly fields: HandoffBlockFields; readonly dropped: readonly ("diff" | "git")[] }
    | { readonly ok: false; readonly refusals: readonly HandoffRefusal[] };
  export function evaluateHandoffFit(input: {
    fields: HandoffBlockFields;
    profile: HandoffCapabilityProfile;
    mode: "strict" | "fit";
  }): HandoffFitResult;
  ```

**Steps:**

- [ ] Write the failing test `packages/connectors/shared/test/handoff-capability.test.ts` (mimics `handoff-block.test.ts` in the same directory):

  ```ts
  import { describe, expect, it } from "vitest";
  import { type HandoffBlockFields, renderHandoffBlockText } from "../src/handoff-block.js";
  import {
    type HandoffCapabilityProfile,
    evaluateHandoffFit,
    handoffCapabilityProfileSchema,
  } from "../src/handoff-capability.js";

  const FIELDS: HandoffBlockFields = {
    resumeInstructions: "You are resuming a task handed off from claude-code on project demo.",
    summaryText: "# Task summary\n- [decision] use pnpm\n- TODO: finish parser",
    gitLine: "branch feat/parser @ abc1234 (dirty)",
    diffText: "diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-old\n+new",
    expiresAt: "2026-08-07T12:00:00.000Z",
  };

  const OPEN_PROFILE: HandoffCapabilityProfile = {
    acceptsDiff: true,
    acceptsGitLine: true,
    maxBlockChars: null,
  };

  describe("handoffCapabilityProfileSchema", () => {
    it("accepts a valid profile and rejects a non-positive cap", () => {
      expect(handoffCapabilityProfileSchema.safeParse(OPEN_PROFILE).success).toBe(true);
      expect(
        handoffCapabilityProfileSchema.safeParse({ ...OPEN_PROFILE, maxBlockChars: 0 }).success,
      ).toBe(false);
    });
  });

  describe("evaluateHandoffFit", () => {
    it("passes fields through unchanged on an all-permissive profile", () => {
      expect(evaluateHandoffFit({ fields: FIELDS, profile: OPEN_PROFILE, mode: "strict" })).toEqual(
        { ok: true, fields: FIELDS, dropped: [] },
      );
    });

    it("strict mode refuses a forbidden diff with section_diff", () => {
      const result = evaluateHandoffFit({
        fields: FIELDS,
        profile: { ...OPEN_PROFILE, acceptsDiff: false },
        mode: "strict",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.refusals.map((r) => r.reason)).toEqual(["section_diff"]);
    });

    it("fit mode drops diff first, then gitLine, and reports the drops", () => {
      expect(
        evaluateHandoffFit({
          fields: FIELDS,
          profile: { acceptsDiff: false, acceptsGitLine: false, maxBlockChars: null },
          mode: "fit",
        }),
      ).toEqual({
        ok: true,
        fields: { ...FIELDS, diffText: null, gitLine: null },
        dropped: ["diff", "git"],
      });
    });

    it("measures the cap on the rendered block and refuses block_too_large", () => {
      const bare: HandoffBlockFields = { ...FIELDS, gitLine: null, diffText: null };
      const rendered = renderHandoffBlockText(bare);
      const result = evaluateHandoffFit({
        fields: bare,
        profile: { ...OPEN_PROFILE, maxBlockChars: rendered.length - 1 },
        mode: "fit",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.refusals[0]?.reason).toBe("block_too_large");
    });

    it("fit mode sheds the diff to satisfy a tight cap", () => {
      const withoutDiff = renderHandoffBlockText({ ...FIELDS, diffText: null });
      const result = evaluateHandoffFit({
        fields: FIELDS,
        profile: { ...OPEN_PROFILE, maxBlockChars: withoutDiff.length },
        mode: "fit",
      });
      expect(result).toEqual({ ok: true, fields: { ...FIELDS, diffText: null }, dropped: ["diff"] });
    });
  });
  ```

- [ ] Run `pnpm --filter @megasaver/connectors-shared test`. Expected: FAIL — `Cannot find module '../src/handoff-capability.js'`.
- [ ] Implement `packages/connectors/shared/src/handoff-capability.ts`:

  ```ts
  import { z } from "zod";
  import { type HandoffBlockFields, renderHandoffBlockText } from "./handoff-block.js";

  export interface HandoffCapabilityProfile {
    readonly acceptsDiff: boolean;
    readonly acceptsGitLine: boolean;
    readonly maxBlockChars: number | null;
  }

  export const handoffCapabilityProfileSchema: z.ZodType<HandoffCapabilityProfile> = z
    .object({
      acceptsDiff: z.boolean(),
      acceptsGitLine: z.boolean(),
      maxBlockChars: z.number().int().positive().nullable(),
    })
    .strict();

  export type HandoffRefusalReason = "section_diff" | "section_git" | "block_too_large";

  export interface HandoffRefusal {
    readonly reason: HandoffRefusalReason;
    readonly detail: string;
  }

  export type HandoffFitResult =
    | {
        readonly ok: true;
        readonly fields: HandoffBlockFields;
        readonly dropped: readonly ("diff" | "git")[];
      }
    | { readonly ok: false; readonly refusals: readonly HandoffRefusal[] };

  export function evaluateHandoffFit(input: {
    fields: HandoffBlockFields;
    profile: HandoffCapabilityProfile;
    mode: "strict" | "fit";
  }): HandoffFitResult {
    const { profile, mode } = input;
    let fields = input.fields;
    const dropped: ("diff" | "git")[] = [];
    const refusals: HandoffRefusal[] = [];

    if (fields.diffText !== null && !profile.acceptsDiff) {
      if (mode === "strict") {
        refusals.push({ reason: "section_diff", detail: "target does not accept a diff section" });
      } else {
        fields = { ...fields, diffText: null };
        dropped.push("diff");
      }
    }
    if (fields.gitLine !== null && !profile.acceptsGitLine) {
      if (mode === "strict") {
        refusals.push({ reason: "section_git", detail: "target does not accept a git line" });
      } else {
        fields = { ...fields, gitLine: null };
        dropped.push("git");
      }
    }
    if (refusals.length > 0) return { ok: false, refusals };

    if (profile.maxBlockChars !== null) {
      let size = renderHandoffBlockText(fields).length;
      if (size > profile.maxBlockChars && mode === "fit") {
        // Deterministic shed order: the diff carries the bulk, the git line the least.
        if (fields.diffText !== null) {
          fields = { ...fields, diffText: null };
          dropped.push("diff");
          size = renderHandoffBlockText(fields).length;
        }
        if (size > profile.maxBlockChars && fields.gitLine !== null) {
          fields = { ...fields, gitLine: null };
          dropped.push("git");
          size = renderHandoffBlockText(fields).length;
        }
      }
      if (size > profile.maxBlockChars) {
        return {
          ok: false,
          refusals: [
            {
              reason: "block_too_large",
              detail: `rendered block is ${size} chars; target caps at ${profile.maxBlockChars}`,
            },
          ],
        };
      }
    }
    return { ok: true, fields, dropped };
  }
  ```

- [ ] Append to `packages/connectors/shared/src/index.ts`:

  ```ts
  export {
    type HandoffCapabilityProfile,
    type HandoffFitResult,
    type HandoffRefusal,
    type HandoffRefusalReason,
    evaluateHandoffFit,
    handoffCapabilityProfileSchema,
  } from "./handoff-capability.js";
  ```

- [ ] Run `pnpm --filter @megasaver/connectors-shared test`. Expected: all pass.
- [ ] Commit: `feat(connectors): add handoff capability fit`

---

### Task 2: Per-target profiles on `ConnectorTarget`

**Files:**
- Modify: `packages/connectors/generic-cli/src/targets.ts`, `apps/cli/src/known-targets.ts`
- Test: `packages/connectors/generic-cli/test/targets.test.ts`, `apps/cli/test/known-targets.test.ts`

**Interfaces:**
- Consumes: `HandoffCapabilityProfile`, `handoffCapabilityProfileSchema` (Task 1, via `@megasaver/connectors-shared`).
- Produces: `ConnectorTarget` (`packages/connectors/generic-cli/src/targets.ts:4`) gains a required member `readonly handoff: HandoffCapabilityProfile;` all six builtin targets plus `CLAUDE_CODE_TARGET` (`apps/cli/src/known-targets.ts:12`) declare it. The existing `satisfies readonly ConnectorTarget[]` on `KNOWN_TARGETS` (`known-targets.ts:28`) enforces completeness at compile time.

**Steps:**

- [ ] Append to `packages/connectors/generic-cli/test/targets.test.ts`:

  ```ts
  import { handoffCapabilityProfileSchema } from "@megasaver/connectors-shared";
  import { describe, expect, it } from "vitest";
  import { aiderTarget, builtinTargets, windsurfTarget } from "../src/targets.js";

  describe("handoff capability profiles", () => {
    it("every builtin target declares a schema-valid profile", () => {
      for (const target of builtinTargets) {
        expect(handoffCapabilityProfileSchema.safeParse(target.handoff).success).toBe(true);
      }
    });

    it("aider refuses diffs and windsurf caps the block at 6000 chars", () => {
      expect(aiderTarget.handoff.acceptsDiff).toBe(false);
      expect(windsurfTarget.handoff.maxBlockChars).toBe(6000);
    });
  });
  ```

  (Keep existing imports if the file already imports these symbols; merge, do not duplicate.)

- [ ] Run `pnpm --filter @megasaver/connector-generic-cli test`. Expected: FAIL — `expected false to be true` (`target.handoff` is `undefined`, safeParse fails).
- [ ] Implement in `packages/connectors/generic-cli/src/targets.ts`: add to the imports
  `import { type HandoffCapabilityProfile, handoffCapabilityProfileSchema } from "@megasaver/connectors-shared";`
  then extend the interface and targets:

  ```ts
  export interface ConnectorTarget {
    readonly id: string;
    readonly agentId: AgentId;
    readonly relativePath: string;
    readonly header?: string;
    readonly handoff: HandoffCapabilityProfile;
  }

  const OPEN_HANDOFF_PROFILE: HandoffCapabilityProfile = Object.freeze({
    acceptsDiff: true,
    acceptsGitLine: true,
    maxBlockChars: null,
  });
  ```

  Add `handoff: OPEN_HANDOFF_PROFILE,` to `codexTarget`, `cursorTarget`, `geminiTarget`, and `continueTarget`. Give `aiderTarget`:

  ```ts
  // CONVENTIONS.md carries conventions; Aider derives its own diff context (spec OQ2).
  handoff: { acceptsDiff: false, acceptsGitLine: true, maxBlockChars: null },
  ```

  and `windsurfTarget`:

  ```ts
  // ASSUMPTION A1 (spec OQ1): windsurf's rules-file ceiling; verify before ship.
  handoff: { acceptsDiff: true, acceptsGitLine: true, maxBlockChars: 6000 },
  ```

  Extend the existing module-load loop over `builtinTargets` (targets.ts:80) with `handoffCapabilityProfileSchema.parse(target.handoff);` and add the same call to `validateConnectorTarget`.

- [ ] Run `pnpm --filter @megasaver/connector-generic-cli test`. Expected: pass. Run `pnpm typecheck`. Expected: FAIL — `Property 'handoff' is missing` for `CLAUDE_CODE_TARGET` in `apps/cli/src/known-targets.ts` (the `satisfies` clause enforces the new required field).
- [ ] In `apps/cli/src/known-targets.ts`, add to `CLAUDE_CODE_TARGET`:

  ```ts
  handoff: { acceptsDiff: true, acceptsGitLine: true, maxBlockChars: null },
  ```

- [ ] Append to `apps/cli/test/known-targets.test.ts`:

  ```ts
  import { handoffCapabilityProfileSchema } from "@megasaver/connectors-shared";

  it("every known target declares a schema-valid handoff profile", () => {
    for (const target of KNOWN_TARGETS) {
      expect(handoffCapabilityProfileSchema.safeParse(target.handoff).success).toBe(true);
    }
  });
  ```

  (Place the `it` inside the file's existing top-level `describe`; `KNOWN_TARGETS` is already imported there.)

- [ ] Run `pnpm typecheck && pnpm --filter @megasaver/cli test`. Expected: pass.
- [ ] Commit: `feat(connectors): declare per-target handoff caps`

---

### Task 3: `open` enforces the profile (`--fit`)

**Files:**
- Modify: `apps/cli/src/commands/handoff/open.ts`, `apps/cli/src/commands/handoff/shared.ts`
- Test: `apps/cli/test/handoff-integration.test.ts`

**Interfaces:**
- Consumes: `evaluateHandoffFit`, `HandoffFitResult` (Task 1); `target.handoff` (Task 2); `serializeHandoffPacket` (`@megasaver/core`, re-exported at `packages/core/src/index.ts:165` — serialize recomputes `payloadSha256`, `handoff-packet.ts:101`, so tests may pass a dummy hash).
- Produces:
  ```ts
  // shared.ts — extracted from the inline gitLineRaw formula in open.ts (behavior identical)
  export function handoffGitLine(
    git: { branch: string | null; headSha: string | null; dirty: boolean } | null,
  ): string | null;
  // open.ts — RunHandoffOpenInput gains:
  fit?: boolean;
  ```

**Steps:**

- [ ] Append to `apps/cli/test/handoff-integration.test.ts` (reuses the file's existing harness: `root`, `dirB`, `files`, `keys`, `now`, `NOW`, `seed()`, `stdout`/`stderr`, `out`/`err`):

  ```ts
  import { serializeHandoffPacket } from "@megasaver/core";

  // serializeHandoffPacket recomputes payloadSha256 (handoff-packet.ts:101).
  const DUMMY_SHA = "0".repeat(64);

  function packetFor(targetAgent: string): string {
    return serializeHandoffPacket({
      manifest: {
        schemaVersion: "1",
        kind: "megahandoff",
        sourceProject: { name: "alpha" },
        sourceAgent: "claude-code",
        targetAgent,
        createdAt: NOW,
        expiresAt: "2026-07-16T12:00:00.000Z",
        payloadSha256: DUMMY_SHA,
        redactionFindings: 0,
        secretPathsExcluded: 0,
        counts: { memories: 0, failures: 0, diffFiles: 1, commits: 0 },
      },
      payload: {
        taskSummary: { text: "# Task summary\n- finish parser", tokenEstimate: 12 },
        resumeInstructions:
          "You are resuming a task handed off from claude-code on project alpha.",
        git: {
          branch: "feat/parser",
          headSha: "abc1234",
          dirty: true,
          commits: [],
          changedFiles: [{ path: "src/a.ts", churn: 2 }],
          diff: {
            text: "diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-old\n+new",
            truncated: false,
            excludedPaths: [],
          },
        },
        failures: [],
        memories: [],
      },
    });
  }

  describe("capability enforcement on open", () => {
    it("refuses a packet whose diff the target forbids, writing nothing", async () => {
      await seed();
      const file = join(files, "to-aider.megahandoff");
      writeFileSync(file, packetFor("aider"));
      const code = await runHandoffOpen({
        storeRoot: root,
        cwd: dirB,
        now,
        publicKey: keys.publicKey,
        filePath: file,
        merge: false,
        json: false,
        ensureStore: () => ensureStoreReady(root),
        stdout,
        stderr,
      });
      expect(code).toBe(1);
      expect(err.join("\n")).toContain("aider cannot consume this handoff");
      expect(err.join("\n")).toContain("section_diff");
      expect(existsSync(join(dirB, "CONVENTIONS.md"))).toBe(false);
    });

    it("--fit drops the diff and writes the block without it", async () => {
      await seed();
      const file = join(files, "to-aider-fit.megahandoff");
      writeFileSync(file, packetFor("aider"));
      const code = await runHandoffOpen({
        storeRoot: root,
        cwd: dirB,
        now,
        publicKey: keys.publicKey,
        filePath: file,
        merge: false,
        json: false,
        fit: true,
        ensureStore: () => ensureStoreReady(root),
        stdout,
        stderr,
      });
      expect(code).toBe(0);
      const content = readFileSync(join(dirB, "CONVENTIONS.md"), "utf8");
      expect(content).toContain("MEGA SAVER:HANDOFF BEGIN");
      expect(content).not.toContain("diff --git");
      expect(content).toContain("branch feat/parser @ abc1234 (dirty)");
      expect(out.join("\n")).toContain("fit: dropped diff");
    });
  });
  ```

  Add `writeFileSync` to the file's existing `node:fs` import if absent.

- [ ] Run `pnpm --filter @megasaver/cli test -- handoff-integration`. Expected: FAIL — first test exits 0 and writes `CONVENTIONS.md` (no enforcement yet); second fails on the unknown `fit` input property being ignored plus `expect(content).not.toContain("diff --git")`.
- [ ] Implement in `apps/cli/src/commands/handoff/shared.ts` (structural param type — no new runtime imports):

  ```ts
  // Extracted from open.ts's inline gitLineRaw so open/pack/peers share one formula.
  export function handoffGitLine(
    git: { branch: string | null; headSha: string | null; dirty: boolean } | null,
  ): string | null {
    if (git === null) return null;
    return `branch ${git.branch}${git.headSha === null ? "" : ` @ ${git.headSha}`}${git.dirty ? " (dirty)" : ""}`;
  }
  ```

- [ ] Implement in `apps/cli/src/commands/handoff/open.ts`:
  1. Add `fit?: boolean;` to `RunHandoffOpenInput` (open.ts:16).
  2. Replace the inline `gitLineRaw` ternary with `const gitLineRaw = handoffGitLine(git);` (import from `./shared.js`, which open.ts already imports).
  3. Add `evaluateHandoffFit` to the existing lazy `@megasaver/connectors-shared` import.
  4. Inside the existing `try` that renders and writes (so a `ConnectorError` thrown by the evaluator's internal render maps to the same exit-1 path), BEFORE `renderHandoffBlockText`:

  ```ts
  const fit = evaluateHandoffFit({
    fields: {
      resumeInstructions: resume.redacted,
      summaryText: summary.redacted,
      gitLine: gitLine === null ? null : gitLine.redacted,
      diffText: diff === null ? null : diff.redacted,
      expiresAt: packet.manifest.expiresAt,
    },
    profile: target.handoff,
    mode: input.fit === true ? "fit" : "strict",
  });
  if (!fit.ok) {
    input.stderr(
      `error: ${target.id} cannot consume this handoff: ${fit.refusals
        .map((r) => `${r.reason} (${r.detail})`)
        .join("; ")}`,
    );
    input.stderr(
      "hint: re-run with --fit to drop unsupported sections, or re-pack with a smaller --budget",
    );
    return 1;
  }
  ```

  5. Render from `fit.fields` instead of the hand-built literal; after a successful write, when `fit.dropped.length > 0`, `input.stdout(`fit: dropped ${fit.dropped.join(", ")} for ${target.id}`)`; in the `input.json` report object (open.ts:173) add `fit: { mode: input.fit === true ? "fit" : "strict", dropped: fit.dropped }`.
  6. In `handoffOpenCommand` (open.ts:204) add the arg
     `fit: { type: "boolean", default: false, description: "Drop sections the target cannot consume instead of refusing." },`
     and thread `fit: !!args.fit` into `runHandoffOpen`.

- [ ] Run `pnpm --filter @megasaver/cli test -- handoff-integration`. Expected: all pass (including the pre-existing open tests — codex/cursor targets are all-permissive, so behavior there is unchanged).
- [ ] Commit: `feat(cli): open enforces target handoff caps`

---

### Task 4: `pack` reports the open-side fit verdict

**Files:**
- Modify: `apps/cli/src/commands/handoff/pack.ts`, `apps/cli/src/commands/handoff/shared.ts`
- Test: `apps/cli/test/handoff-fit-verdict.test.ts` (new), `apps/cli/test/handoff-integration.test.ts`

**Interfaces:**
- Consumes: `evaluateHandoffFit`, `HandoffFitResult` (Task 1); `KNOWN_TARGETS` (Task 2); `handoffGitLine` (Task 3); the built packet in `runHandoffPack` (`pack.ts:174` region).
- Produces (both in `shared.ts`; type-only imports are erased at runtime, preserving the lazy-load discipline):
  ```ts
  export function handoffFieldsFromPacket(packet: {
    manifest: { expiresAt: string };
    payload: {
      resumeInstructions: string;
      taskSummary: { text: string };
      git: {
        branch: string | null;
        headSha: string | null;
        dirty: boolean;
        diff: { text: string } | null;
      } | null;
    };
  }): HandoffBlockFields;
  export function handoffFitVerdictLine(targetId: string, result: HandoffFitResult): string;
  ```

**Steps:**

- [ ] Write the failing unit test `apps/cli/test/handoff-fit-verdict.test.ts`:

  ```ts
  import type { HandoffFitResult } from "@megasaver/connectors-shared";
  import { describe, expect, it } from "vitest";
  import { handoffFieldsFromPacket, handoffFitVerdictLine } from "../src/commands/handoff/shared.js";

  const OK: HandoffFitResult = {
    ok: true,
    fields: {
      resumeInstructions: "resume",
      summaryText: "summary",
      gitLine: null,
      diffText: null,
      expiresAt: "2026-08-07T12:00:00.000Z",
    },
    dropped: [],
  };

  describe("handoffFitVerdictLine", () => {
    it("prints ok for a fitting packet", () => {
      expect(handoffFitVerdictLine("codex", OK)).toBe("fit(codex): ok");
    });

    it("prints the refusal reasons and the --fit remedy", () => {
      const refused: HandoffFitResult = {
        ok: false,
        refusals: [{ reason: "section_diff", detail: "target does not accept a diff section" }],
      };
      expect(handoffFitVerdictLine("aider", refused)).toBe(
        "fit(aider): open will refuse (section_diff) — receiver may pass --fit",
      );
    });
  });

  describe("handoffFieldsFromPacket", () => {
    it("maps packet sections onto block fields", () => {
      expect(
        handoffFieldsFromPacket({
          manifest: { expiresAt: "2026-08-07T12:00:00.000Z" },
          payload: {
            resumeInstructions: "resume",
            taskSummary: { text: "summary" },
            git: {
              branch: "main",
              headSha: null,
              dirty: false,
              diff: { text: "diff --git" },
            },
          },
        }),
      ).toEqual({
        resumeInstructions: "resume",
        summaryText: "summary",
        gitLine: "branch main",
        diffText: "diff --git",
        expiresAt: "2026-08-07T12:00:00.000Z",
      });
    });
  });
  ```

- [ ] Run `pnpm --filter @megasaver/cli test -- handoff-fit-verdict`. Expected: FAIL — the two functions do not exist.
- [ ] Implement both in `apps/cli/src/commands/handoff/shared.ts` (add `import type { HandoffBlockFields, HandoffFitResult } from "@megasaver/connectors-shared";`):

  ```ts
  export function handoffFieldsFromPacket(packet: {
    manifest: { expiresAt: string };
    payload: {
      resumeInstructions: string;
      taskSummary: { text: string };
      git: {
        branch: string | null;
        headSha: string | null;
        dirty: boolean;
        diff: { text: string } | null;
      } | null;
    };
  }): HandoffBlockFields {
    const git = packet.payload.git;
    return {
      resumeInstructions: packet.payload.resumeInstructions,
      summaryText: packet.payload.taskSummary.text,
      gitLine: handoffGitLine(git),
      diffText: git === null || git.diff === null ? null : git.diff.text,
      expiresAt: packet.manifest.expiresAt,
    };
  }

  export function handoffFitVerdictLine(targetId: string, result: HandoffFitResult): string {
    if (result.ok) return `fit(${targetId}): ok`;
    const reasons = result.refusals.map((r) => r.reason).join(", ");
    return `fit(${targetId}): open will refuse (${reasons}) — receiver may pass --fit`;
  }
  ```

- [ ] Run `pnpm --filter @megasaver/cli test -- handoff-fit-verdict`. Expected: pass.
- [ ] Append to the pack section of `apps/cli/test/handoff-integration.test.ts`, inside an existing pack test after a successful `runHandoffPack` to `codex` (or as a new `it` using the same pack input literal that test uses): `expect(out.join("\n")).toContain("fit(codex): ok");`
- [ ] Run `pnpm --filter @megasaver/cli test -- handoff-integration`. Expected: FAIL — the verdict line is not printed yet.
- [ ] Implement in `apps/cli/src/commands/handoff/pack.ts`: extend the existing post-gate lazy imports with `const { evaluateHandoffFit } = await import("@megasaver/connectors-shared");` and `const { KNOWN_TARGETS } = await import("../../known-targets.js");` (known-targets loads connector packages, so it stays behind the gate like in open.ts). After the packet is built (`pack.ts:174` region, before/beside the report output; also on the `--dry-run` report path):

  ```ts
  const packTarget = KNOWN_TARGETS.find((t) => t.id === input.to);
  if (packTarget !== undefined) {
    const verdict = evaluateHandoffFit({
      fields: handoffFieldsFromPacket(packet),
      profile: packTarget.handoff,
      mode: "strict",
    });
    input.stdout(handoffFitVerdictLine(packTarget.id, verdict));
  }
  ```

  (`handoffFieldsFromPacket` / `handoffFitVerdictLine` come from `./shared.js`, already imported by pack.ts. `--to` is validated by `isKnownTargetId` before `runHandoffPack` runs, so the `undefined` arm is unreachable in the CLI path; the guard exists only because `runHandoffPack` is a public test seam. pack never refuses — the verdict is advisory, spec LD4.)

- [ ] Run `pnpm --filter @megasaver/cli test -- handoff-integration`. Expected: pass.
- [ ] Commit: `feat(cli): pack reports open-side fit verdict`

---

### Task 5: `offer` kind in the stats handoff event

**Files:**
- Modify: `packages/stats/src/handoff-event.ts`
- Test: `packages/stats/test/handoff-event.test.ts`

**Interfaces:**
- Consumes: `handoffEventSchema` (`packages/stats/src/handoff-event.ts:12`).
- Produces: `kind: z.enum(["pack", "open", "offer"])` — additive member, no other field changes.

**Steps:**

- [ ] Append to `packages/stats/test/handoff-event.test.ts`:

  ```ts
  it("accepts the offer kind", () => {
    expect(
      handoffEventSchema.safeParse({
        id: "evt-offer-1",
        projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        kind: "offer",
        targetAgent: "codex",
        memories: 0,
        failures: 0,
        redactionFindings: 0,
        createdAt: "2026-08-06T12:00:00.000Z",
      }).success,
    ).toBe(true);
  });
  ```

  (Place inside the file's existing `describe` for the schema; `handoffEventSchema` is already imported there.)

- [ ] Run `pnpm --filter @megasaver/stats test`. Expected: FAIL — the enum rejects `"offer"`.
- [ ] Change `packages/stats/src/handoff-event.ts:16` to `kind: z.enum(["pack", "open", "offer"]),`.
- [ ] Run `pnpm --filter @megasaver/stats test`. Expected: pass.
- [ ] Commit: `feat(stats): add offer handoff event kind`

---

### Task 6: `mega handoff peers` (BLOCKED: requires `@megasaver/mesh`)

**Files:**
- Create: `apps/cli/src/commands/handoff/peers.ts`
- Modify: `apps/cli/src/commands/handoff/index.ts`
- Test: `apps/cli/test/handoff-peers.test.ts`

**Interfaces:**
- Consumes: `KNOWN_TARGETS` (Task 2), `evaluateHandoffFit` (Task 1), `handoffFieldsFromPacket` (Task 4), `parseHandoffPacket`/`HandoffPacketError` (`@megasaver/core`); at wiring time only: `@megasaver/mesh` `listPeers(input: { storeRoot: string; workspaceKey?; includeDead?; nowMs? }): PeerView[]` (sync; session-mesh plan Task 3) whose rows carry `liveSessionId`/`agent`/`status` per `presenceRecordSchema` (`agent` is a free-form string matched against `ConnectorTarget.agentId`), `encodeWorkspaceKey` (`@megasaver/shared`, `packages/shared/src/workspace-key.ts:20`), `readStoreEnv`/`resolveStorePath` (`../../store.js`).
- Produces:
  ```ts
  export type HandoffPeer = { sessionId: string; agent: string; status: string };
  export type RunHandoffPeersInput = {
    now: () => number;
    packetPath: string | null;
    json: boolean;
    all: boolean;
    workspaceKey: string;
    listPeers: (filter: { workspaceKey?: string }) => Promise<readonly HandoffPeer[]>;
    readPacket: (path: string) => string;
    stdout: (line: string) => void;
    stderr: (line: string) => void;
  };
  export function runHandoffPeers(input: RunHandoffPeersInput): Promise<0 | 1>;
  export const handoffPeersCommand: ReturnType<typeof defineCommand>;
  ```

**Steps:**

- [ ] Write the failing test `apps/cli/test/handoff-peers.test.ts` (free command — no license harness needed; `packetFor` is duplicated per file, the `signTestLicense` deliberate-duplication convention):

  ```ts
  import { serializeHandoffPacket } from "@megasaver/core";
  import { describe, expect, it } from "vitest";
  import { runHandoffPeers } from "../src/commands/handoff/peers.js";

  const NOW_MS = Date.parse("2026-07-15T12:00:00.000Z");
  const DUMMY_SHA = "0".repeat(64);

  function packetFor(targetAgent: string): string {
    return serializeHandoffPacket({
      manifest: {
        schemaVersion: "1",
        kind: "megahandoff",
        sourceProject: { name: "alpha" },
        sourceAgent: "claude-code",
        targetAgent,
        createdAt: "2026-07-15T12:00:00.000Z",
        expiresAt: "2026-07-16T12:00:00.000Z",
        payloadSha256: DUMMY_SHA,
        redactionFindings: 0,
        secretPathsExcluded: 0,
        counts: { memories: 0, failures: 0, diffFiles: 1, commits: 0 },
      },
      payload: {
        taskSummary: { text: "summary", tokenEstimate: 2 },
        resumeInstructions: "resume",
        git: {
          branch: "main",
          headSha: null,
          dirty: false,
          commits: [],
          changedFiles: [],
          diff: { text: "diff --git a/x b/x", truncated: false, excludedPaths: [] },
        },
        failures: [],
        memories: [],
      },
    });
  }

  const PEERS = [
    { sessionId: "s-codex", agent: "codex", status: "working" },
    { sessionId: "s-aider", agent: "aider", status: "idle" },
    { sessionId: "s-devin", agent: "devin", status: "idle" },
  ] as const;

  describe("runHandoffPeers", () => {
    it("lists peers with per-target fit verdicts for a packet", async () => {
      const out: string[] = [];
      const code = await runHandoffPeers({
        now: () => NOW_MS,
        packetPath: "/tmp/p.megahandoff",
        json: false,
        all: false,
        workspaceKey: "0123456789abcdef",
        listPeers: async () => PEERS,
        readPacket: () => packetFor("codex"),
        stdout: (l) => out.push(l),
        stderr: () => {},
      });
      expect(code).toBe(0);
      const text = out.join("\n");
      expect(text).toContain("s-codex");
      expect(text).toContain("fits");
      expect(text).toContain("refuses"); // aider: packet carries a diff
      expect(text).toContain("no target"); // devin: not in KNOWN_TARGETS
    });

    it("fails with an explicit reason when the mesh is unavailable", async () => {
      const err: string[] = [];
      const code = await runHandoffPeers({
        now: () => NOW_MS,
        packetPath: null,
        json: false,
        all: false,
        workspaceKey: "0123456789abcdef",
        listPeers: async () => {
          throw new Error("no mesh store");
        },
        readPacket: () => "",
        stdout: () => {},
        stderr: (l) => err.push(l),
      });
      expect(code).toBe(1);
      expect(err.join("\n")).toContain("session mesh not initialized");
    });

    it("scopes to the repo workspace key by default and widens with --all", async () => {
      const seen: { workspaceKey?: string }[] = [];
      const run = (all: boolean) =>
        runHandoffPeers({
          now: () => NOW_MS,
          packetPath: null,
          json: false,
          all,
          workspaceKey: "0123456789abcdef",
          listPeers: async (filter) => {
            seen.push(filter);
            return PEERS;
          },
          readPacket: () => "",
          stdout: () => {},
          stderr: () => {},
        });
      await run(false);
      await run(true);
      expect(seen[0]).toEqual({ workspaceKey: "0123456789abcdef" }); // mesh LD6 repo-scoped default
      expect(seen[1]).toEqual({}); // --all omits the filter
    });
  });
  ```

- [ ] Run `pnpm --filter @megasaver/cli test -- handoff-peers`. Expected: FAIL — `Cannot find module '../src/commands/handoff/peers.js'`.
- [ ] Implement `apps/cli/src/commands/handoff/peers.ts`:

  ```ts
  import { readFileSync } from "node:fs";
  import { defineCommand } from "citty";
  import { readStoreEnv, resolveStorePath } from "../../store.js";
  import { handoffFieldsFromPacket } from "./shared.js";

  export type HandoffPeer = { sessionId: string; agent: string; status: string };

  export type RunHandoffPeersInput = {
    now: () => number;
    packetPath: string | null;
    json: boolean;
    all: boolean;
    workspaceKey: string;
    listPeers: (filter: { workspaceKey?: string }) => Promise<readonly HandoffPeer[]>;
    readPacket: (path: string) => string;
    stdout: (line: string) => void;
    stderr: (line: string) => void;
  };

  export async function runHandoffPeers(input: RunHandoffPeersInput): Promise<0 | 1> {
    let peers: readonly HandoffPeer[];
    try {
      peers = await input.listPeers(input.all ? {} : { workspaceKey: input.workspaceKey });
    } catch {
      input.stderr("error: session mesh not initialized — run: mega mesh status");
      return 1;
    }
    // Free command, but fit verdicts need core's parser + the connector profiles;
    // lazy imports keep the no-arg listing path light (open.ts precedent).
    const { evaluateHandoffFit } = await import("@megasaver/connectors-shared");
    const { KNOWN_TARGETS } = await import("../../known-targets.js");

    let fields: ReturnType<typeof handoffFieldsFromPacket> | null = null;
    if (input.packetPath !== null) {
      const { HandoffPacketError, parseHandoffPacket } = await import("@megasaver/core");
      try {
        fields = handoffFieldsFromPacket(
          parseHandoffPacket(input.readPacket(input.packetPath), { now: input.now() }),
        );
      } catch (error) {
        if (error instanceof HandoffPacketError) {
          input.stderr(`error: ${error.message}`);
          return 1;
        }
        throw error;
      }
    }

    const rows = peers.map((peer) => {
      const target = KNOWN_TARGETS.find((t) => t.agentId === peer.agent);
      const verdict =
        target === undefined
          ? "no target"
          : fields === null
            ? "receivable"
            : evaluateHandoffFit({ fields, profile: target.handoff, mode: "strict" }).ok
              ? "fits"
              : "refuses (open needs --fit)";
      return { sessionId: peer.sessionId, agent: peer.agent, status: peer.status, verdict };
    });

    if (input.json) {
      input.stdout(JSON.stringify({ peers: rows }));
    } else {
      for (const row of rows) {
        input.stdout(`${row.sessionId}  ${row.agent}  ${row.status}  ${row.verdict}`);
      }
      if (rows.length === 0) input.stdout("no live peers");
    }
    return 0;
  }

  export const handoffPeersCommand = defineCommand({
    meta: { name: "peers", description: "List live mesh peers that can receive a handoff." },
    args: {
      packet: { type: "string", description: "Show each peer's fit verdict for this packet." },
      all: { type: "boolean", default: false, description: "List peers in every workspace, not just this repo's." },
      json: { type: "boolean", default: false, description: "Emit the peer list as JSON." },
      store: { type: "string", description: "Override store directory." },
    },
    async run({ args }) {
      // BLOCKED until @megasaver/mesh ships (session-mesh plan). Presence rows
      // are PresenceRecord (presenceRecordSchema, .strict()): liveSessionId /
      // agent (free-form string) / status. Repo-scoped default per mesh LD6.
      const { listPeers } = await import("@megasaver/mesh");
      const { encodeWorkspaceKey } = await import("@megasaver/shared");
      const storeRoot = resolveStorePath(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      );
      const code = await runHandoffPeers({
        now: Date.now,
        packetPath: typeof args.packet === "string" ? args.packet : null,
        json: !!args.json,
        all: !!args.all,
        workspaceKey: encodeWorkspaceKey(process.cwd()),
        listPeers: async (filter) =>
          listPeers({ storeRoot, ...filter }).map((p) => ({
            sessionId: p.liveSessionId,
            agent: p.agent,
            status: p.status,
          })),
        readPacket: (path) => readFileSync(path, "utf8"),
        stdout: console.log,
        stderr: console.error,
      });
      process.exitCode = code;
    },
  });
  ```

- [ ] Register in `apps/cli/src/commands/handoff/index.ts`: add `import { handoffPeersCommand } from "./peers.js";`, add `peers: handoffPeersCommand,` to `subCommands`, and export `runHandoffPeers`/types following the file's existing export lines.
- [ ] Run `pnpm --filter @megasaver/cli test -- handoff-peers`. Expected: pass (the handler tests use injected deps; only the citty `run` wiring touches `@megasaver/mesh`).
- [ ] Run `pnpm typecheck`. Expected: pass once `@megasaver/mesh` exists and is added to `apps/cli/package.json` dependencies; until then this task cannot merge (Global Constraints).
- [ ] Commit: `feat(cli): handoff peers lists receivable agents`

---

### Task 7: `mega handoff offer` (BLOCKED: requires `@megasaver/mesh`)

**Files:**
- Create: `apps/cli/src/commands/handoff/offer.ts`
- Modify: `apps/cli/src/commands/handoff/index.ts`
- Test: `apps/cli/test/handoff-offer.test.ts`

**Interfaces:**
- Consumes: `gate`, `MAX_PACKET_BYTES`, `handoffFieldsFromPacket` (`./shared.js`); `parseHandoffPacket`, `HandoffPacketError` (`@megasaver/core`); `evaluateHandoffFit` (Task 1); `KNOWN_TARGETS` (Task 2); `appendHandoffEvent` (`@megasaver/stats`, `packages/stats/src/handoff-event.ts:33`, kind `"offer"` from Task 5); `findProjectByCwd` (`apps/cli/src/commands/warmup.ts`); at wiring time only: `@megasaver/mesh` `sendMessage(input: { storeRoot; workspaceKey; from; to; kind; text; … }): MeshMessage | undefined` (sync, fail-open — an `undefined` result means nothing was delivered; `workspaceKey` per the session-mesh plan's Task 6 implementer NOTE) amended with the additive `handoff-offer` kind + structured `offer` field (spec ASSUMPTION A2), `listPeers` for the live-session pre-check, `encodeWorkspaceKey` (`@megasaver/shared`).
- Produces:
  ```ts
  export type HandoffOfferPointer = {
    packetPath: string;
    payloadSha256: string;
    targetAgent: string;
    expiresAt: string;
    sourceProject: string;
  };
  export type SendHandoffOffer = (input: {
    toSession: string;
    offer: HandoffOfferPointer;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  export type RunHandoffOfferInput = {
    storeRoot: string;
    cwd: string;
    now: () => number;
    publicKey?: KeyObject | string;
    filePath: string;
    toSession: string;
    json: boolean;
    sendOffer: SendHandoffOffer;
    ensureStore: () => Promise<EnsureStoreReadyResult>;
    stdout: (line: string) => void;
    stderr: (line: string) => void;
  };
  export function runHandoffOffer(input: RunHandoffOfferInput): Promise<0 | 1>;
  export const handoffOfferCommand: ReturnType<typeof defineCommand>;
  ```

**Steps:**

- [ ] Write the failing test `apps/cli/test/handoff-offer.test.ts` — clone the license/store harness of `handoff-integration.test.ts` (`signTestLicense`, `beforeEach` store + license activation, `seed()`-style project creation for project `alpha` at `dirA`, and the Task 6 `packetFor` builder — per-file duplication convention), then:

  ```ts
  import { runHandoffOffer } from "../src/commands/handoff/offer.js";

  describe("runHandoffOffer", () => {
    it("sends a pointer-only offer and appends an offer event", async () => {
      await seed();
      const file = join(files, "to-codex.megahandoff");
      writeFileSync(file, packetFor("codex"));
      const sent: unknown[] = [];
      const code = await runHandoffOffer({
        storeRoot: root,
        cwd: dirA,
        now,
        publicKey: keys.publicKey,
        filePath: file,
        toSession: "s-codex",
        json: false,
        sendOffer: async (msg) => {
          sent.push(msg);
          return { ok: true };
        },
        ensureStore: () => ensureStoreReady(root),
        stdout,
        stderr,
      });
      expect(code).toBe(0);
      expect(sent).toHaveLength(1);
      const wire = JSON.stringify(sent[0]);
      expect(wire).toContain(file);
      expect(wire).toContain('"targetAgent":"codex"');
      expect(wire).not.toContain("diff --git"); // pointer only — payload never travels
      expect(wire).not.toContain("summary");
      expect(out.join("\n")).toContain("mega handoff open");
    });

    it("refuses to offer an expired packet and sends nothing", async () => {
      await seed();
      const file = join(files, "expired.megahandoff");
      writeFileSync(file, packetFor("codex"));
      const sent: unknown[] = [];
      const nowPastExpiry = () => Date.parse("2026-07-17T12:00:00.000Z");
      const code = await runHandoffOffer({
        storeRoot: root,
        cwd: dirA,
        now: nowPastExpiry,
        publicKey: keys.publicKey,
        filePath: file,
        toSession: "s-codex",
        json: false,
        sendOffer: async (msg) => {
          sent.push(msg);
          return { ok: true };
        },
        ensureStore: () => ensureStoreReady(root),
        stdout,
        stderr,
      });
      expect(code).toBe(1);
      expect(sent).toHaveLength(0);
      expect(err.join("\n")).toContain("expired");
    });

    it("upsells and sends nothing when unentitled", async () => {
      // beforeEach for this it-block variant skips activateLicense (fresh store root).
      const sent: unknown[] = [];
      const code = await runHandoffOffer({
        storeRoot: unlicensedRoot,
        cwd: dirA,
        now,
        publicKey: keys.publicKey,
        filePath: join(files, "missing.megahandoff"),
        toSession: "s-codex",
        json: false,
        sendOffer: async (msg) => {
          sent.push(msg);
          return { ok: true };
        },
        ensureStore: () => ensureStoreReady(unlicensedRoot),
        stdout,
        stderr,
      });
      expect(code).toBe(0);
      expect(sent).toHaveLength(0);
      expect(out.join("\n")).toContain("Pro");
    });
  });
  ```

  (`unlicensedRoot` is a second `mkdtempSync` store created in `beforeEach` with NO `activateLicense` call.)

- [ ] Run `pnpm --filter @megasaver/cli test -- handoff-offer`. Expected: FAIL — `Cannot find module '../src/commands/handoff/offer.js'`.
- [ ] Implement `apps/cli/src/commands/handoff/offer.ts`:

  ```ts
  import type { KeyObject } from "node:crypto";
  import { randomUUID } from "node:crypto";
  import { readFileSync, statSync } from "node:fs";
  import { resolve } from "node:path";
  import { defineCommand } from "citty";
  import { type EnsureStoreReadyResult, ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
  import { findProjectByCwd } from "../warmup.js";
  import { MAX_PACKET_BYTES, gate, handoffFieldsFromPacket } from "./shared.js";

  export type HandoffOfferPointer = {
    packetPath: string;
    payloadSha256: string;
    targetAgent: string;
    expiresAt: string;
    sourceProject: string;
  };

  export type SendHandoffOffer = (input: {
    toSession: string;
    offer: HandoffOfferPointer;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;

  export type RunHandoffOfferInput = {
    storeRoot: string;
    cwd: string;
    now: () => number;
    publicKey?: KeyObject | string;
    filePath: string;
    toSession: string;
    json: boolean;
    sendOffer: SendHandoffOffer;
    ensureStore: () => Promise<EnsureStoreReadyResult>;
    stdout: (line: string) => void;
    stderr: (line: string) => void;
  };

  export async function runHandoffOffer(input: RunHandoffOfferInput): Promise<0 | 1> {
    if (!gate(input)) return 0;

    let packetText: string;
    try {
      if (statSync(input.filePath).size > MAX_PACKET_BYTES) {
        input.stderr(`error: packet exceeds ${MAX_PACKET_BYTES} bytes`);
        return 1;
      }
      packetText = readFileSync(input.filePath, "utf8");
    } catch {
      input.stderr(`error: cannot read packet at ${input.filePath}`);
      return 1;
    }

    const { HandoffPacketError, parseHandoffPacket } = await import("@megasaver/core");
    let packet: ReturnType<typeof parseHandoffPacket>;
    try {
      // Fail-closed: an unopenable (expired/tampered) packet is never advertised.
      packet = parseHandoffPacket(packetText, { now: input.now() });
    } catch (error) {
      if (error instanceof HandoffPacketError) {
        input.stderr(`error: ${error.message}`);
        return 1;
      }
      throw error;
    }

    const { evaluateHandoffFit } = await import("@megasaver/connectors-shared");
    const { KNOWN_TARGETS } = await import("../../known-targets.js");
    const target = KNOWN_TARGETS.find((t) => t.id === packet.manifest.targetAgent);
    if (target === undefined) {
      input.stderr(`error: packet targets unknown agent "${packet.manifest.targetAgent}"`);
      return 1;
    }
    const fit = evaluateHandoffFit({
      fields: handoffFieldsFromPacket(packet),
      profile: target.handoff,
      mode: "strict",
    });
    if (!fit.ok) {
      input.stderr(
        `error: refusing to offer — ${target.id} would refuse it (${fit.refusals
          .map((r) => r.reason)
          .join(", ")}); re-pack or let the receiver open with --fit`,
      );
      return 1;
    }

    const offer: HandoffOfferPointer = {
      packetPath: resolve(input.filePath),
      payloadSha256: packet.manifest.payloadSha256,
      targetAgent: packet.manifest.targetAgent,
      expiresAt: packet.manifest.expiresAt,
      sourceProject: packet.manifest.sourceProject.name,
    };
    const result = await input.sendOffer({ toSession: input.toSession, offer });
    if (!result.ok) {
      input.stderr(`error: mesh send failed: ${result.error}`);
      return 1;
    }

    // Advisory event (never fails the offer); skipped when cwd is outside a project.
    try {
      const { registry } = await input.ensureStore();
      const project = findProjectByCwd(registry.listProjects(), input.cwd);
      if (project !== null) {
        const { appendHandoffEvent } = await import("@megasaver/stats");
        appendHandoffEvent(
          { root: input.storeRoot },
          {
            id: randomUUID(),
            projectId: project.id,
            kind: "offer",
            targetAgent: packet.manifest.targetAgent,
            memories: packet.manifest.counts.memories,
            failures: packet.manifest.counts.failures,
            redactionFindings: packet.manifest.redactionFindings,
            createdAt: new Date(input.now()).toISOString(),
          },
        );
      }
    } catch {
      // advisory only
    }

    const doneLine = `offered ${offer.packetPath} to ${input.toSession} — the receiving operator applies it with: mega handoff open ${offer.packetPath}`;
    if (input.json) input.stdout(JSON.stringify({ offered: true, offer, toSession: input.toSession }));
    else input.stdout(doneLine);
    return 0;
  }

  export const handoffOfferCommand = defineCommand({
    meta: { name: "offer", description: "Offer a packed handoff to a live mesh peer (pointer only)." },
    args: {
      file: { type: "positional", required: true, description: "Path to a .megahandoff packet." },
      "to-session": { type: "string", required: true, description: "Receiving mesh session id." },
      from: { type: "string", description: 'Sender mesh session id (defaults to "cli", the mega mesh send convention).' },
      json: { type: "boolean", default: false, description: "Emit the offer report as JSON." },
      store: { type: "string", description: "Override store directory." },
    },
    async run({ args }) {
      // BLOCKED until @megasaver/mesh ships AND its kind union gains the
      // additive handoff-offer member + structured offer field (spec
      // ASSUMPTION A2 — this feature owns that amendment; mesh v1 ships
      // message|ask|answer only). The mesh redacts and labels inbox text as
      // untrusted; nothing on the receiving side auto-runs open.
      const { listPeers, sendMessage } = await import("@megasaver/mesh");
      const { encodeWorkspaceKey } = await import("@megasaver/shared");
      const storeRoot = resolveStorePath(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      );
      const code = await runHandoffOffer({
        storeRoot,
        cwd: process.cwd(),
        now: Date.now,
        filePath: String(args.file),
        toSession: String(args["to-session"]),
        json: !!args.json,
        sendOffer: async ({ toSession, offer }) => {
          // Spec error handling: unknown/dead session -> exit 1. sendMessage is
          // fail-open and creates inboxes on demand, so presence is the only
          // place this can be detected.
          const live = listPeers({ storeRoot }).some((p) => p.liveSessionId === toSession);
          if (!live) return { ok: false, error: `no live mesh session "${toSession}"` };
          const sent = sendMessage({
            storeRoot,
            workspaceKey: encodeWorkspaceKey(process.cwd()),
            from: typeof args.from === "string" ? args.from : "cli",
            to: toSession,
            kind: "handoff-offer",
            text: `handoff offer: ${offer.packetPath} (target ${offer.targetAgent}, expires ${offer.expiresAt}) — inspect with: mega handoff inspect ${offer.packetPath}`,
            offer,
          });
          // Fail-open contract: undefined means nothing was delivered — never
          // report success on it (spec: no partial sends, no silent success).
          return sent === undefined ? { ok: false, error: "mesh send failed" } : { ok: true };
        },
        ensureStore: () => ensureStoreReady(storeRoot),
        stdout: console.log,
        stderr: console.error,
      });
      process.exitCode = code;
    },
  });
  ```

  (The `store` arg + `resolveStorePath(readStoreEnv(typeof args.store === "string" ? args.store : undefined))` resolution matches `handoffOpenCommand` in open.ts exactly — `readStoreEnv(storeFlag)` requires its argument, `apps/cli/src/store.ts:52`.)

- [ ] Register in `apps/cli/src/commands/handoff/index.ts`: import + `offer: handoffOfferCommand,` in `subCommands`, export `runHandoffOffer` and its types alongside the existing exports.
- [ ] Run `pnpm --filter @megasaver/cli test -- handoff-offer`. Expected: pass (handler tests use the injected `sendOffer`).
- [ ] Run `pnpm typecheck`. Expected: pass once `@megasaver/mesh` exists (same merge gate as Task 6).
- [ ] Commit: `feat(cli): handoff offer sends mesh pointer`

---

### Task 8: Changeset, wiki, full verify

**Files:**
- Create: `.changeset/cross-agent-handoff.md`
- Modify: `wiki/entities/hot-handoff.md`, `wiki/log.md`

**Interfaces:** none (docs + release metadata).

**Steps:**

- [ ] Write `.changeset/cross-agent-handoff.md`:

  ```md
  ---
  "@megasaver/connectors-shared": minor
  "@megasaver/connector-generic-cli": minor
  "@megasaver/cli": minor
  "@megasaver/stats": patch
  ---

  Cross-agent handoff (A4): per-target handoff capability profiles on
  ConnectorTarget, open-side fit enforcement with --fit, pack fit verdict,
  and mesh-backed `mega handoff peers` / `mega handoff offer` (pointer-only).
  ```

- [ ] Update `wiki/entities/hot-handoff.md` with the A4 delta (capability map, `--fit`, peers/offer, mesh dependency) and append a timestamped entry to `wiki/log.md`.
- [ ] Run `pnpm verify`. Expected: lint + typecheck + all tests green (DoD §4). Capture the output as verifier evidence together with a smoke run: pack → open --fit against an aider target in a scratch project (DoD §5).
- [ ] Commit: `chore: changeset for cross-agent handoff`
- [ ] Commit: `docs(wiki): record cross-agent handoff (A4)`

---

## Self-review notes

- Spec↔plan coverage: LD1 (Global Constraints: core untouched), LD2 (Tasks 1–2), LD3 (Task 1 profile shape), LD4 (Tasks 3–4), LD5 (Task 7 parse-before-offer + pointer-only test), LD6 (Task 7 gate + free Task 6), LD7 (Task 1 result types; profiles never serialized). Spec components 1–7 map to Tasks 1, 2, 3, 4, 6, 7, and "receiver side: no new code" respectively; Task 5 covers the stats delta named in spec component 6.
- Every referenced pre-existing symbol is cited with its real path; new symbols (`HandoffCapabilityProfile`, `evaluateHandoffFit`, `handoffGitLine`, `handoffFieldsFromPacket`, `handoffFitVerdictLine`, `runHandoffPeers`, `runHandoffOffer`) are each defined in exactly one task before use.
- ASSUMPTION markers carried from the spec: A1 (windsurf 6000 cap, Task 2), A2 (mesh `handoff-offer` kind + structured `offer` field — an additive mesh amendment owned by this feature, Task 7 wiring; mesh v1 ships `message | ask | answer` only). Former A3 is resolved, not assumed: Task 6 wiring maps `presenceRecordSchema`'s `liveSessionId`/`agent`/`status` directly (session-mesh plan, `packages/mesh/src/types.ts`).
- No timing-tight tests; mesh is injected everywhere; refusal tests assert write suppression via file absence.
