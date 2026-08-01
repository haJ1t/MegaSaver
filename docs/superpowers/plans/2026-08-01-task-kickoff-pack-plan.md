# Stable Task Kickoff Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Add one bounded, byte-stable task kickoff pack to the first UserPromptSubmit event in a Claude Code session.

**Architecture:** The intent hook uses the existing Context Pruner index, renders path/range/reason metadata only, and caches that exact text in the private store. It remains fail-open: invalid input, missing index, tokeniser failure, or deadline returns empty output and exits zero.

**Tech Stack:** TypeScript strict ESM, Zod, Vitest, Context Pruner, Indexer, Output Filter tokenizer.

## Global Constraints

- Final context is at most 2,000 measured tokens; do not fall back to bytes/4.
- One safe session id always gets the exact text computed for its first prompt.
- Source bodies, prompt bodies beyond existing redacted intent, and tool output never enter the pack.
- Current intent persistence happens before pack work.
- The hook must not grant or deny a permission.
- Turbo build output must include \`dist-bridge/**\`, otherwise a cache-restored GUI package breaks CLI tests.

---

### Task 1: Restore the GUI bridge build artifact in Turbo cache

**Files:**

- Modify: \`turbo.json\`
- Create: \`apps/gui/test/turbo-output.test.ts\`

**Interfaces:** Turbo build outputs include both \`dist/**\` and \`dist-bridge/**\`.

- [ ] **Step 1: Write the failing configuration test**

    import { readFileSync } from "node:fs";
    import { fileURLToPath } from "node:url";
    import { expect, it } from "vitest";

    const path = fileURLToPath(new URL("../../../turbo.json", import.meta.url));

    it("declares the GUI bridge as a restored build output", () => {
      const config = JSON.parse(readFileSync(path, "utf8")) as {
        tasks: { build: { outputs: string[] } };
      };
      expect(config.tasks.build.outputs).toContain("dist-bridge/**");
    });

- [ ] **Step 2: Run it to verify it fails**

Run: \`pnpm --filter @megasaver/gui exec vitest run test/turbo-output.test.ts\`

Expected: FAIL because \`dist-bridge/**\` is absent.

- [ ] **Step 3: Add the missing output**

Change the build task outputs to:

    ["dist/**", "dist-bridge/**"]

- [ ] **Step 4: Run the recovery proof**

Run: \`pnpm --filter @megasaver/gui build && pnpm --filter @megasaver/gui exec vitest run test/turbo-output.test.ts && pnpm --filter @megasaver/cli exec vitest run test/commands/gui.test.ts test/commands/firewall.test.ts test/version-source.test.ts test/commands/handoff-registration.test.ts\`

Expected: all selected tests pass and \`apps/gui/dist-bridge/index.js\` exists.

- [ ] **Step 5: Commit**

    git add turbo.json apps/gui/test/turbo-output.test.ts
    git commit -m "fix(build): cache gui bridge output"

### Task 2: Render a bounded deterministic task pack

**Files:**

- Create: \`apps/cli/src/hooks/task-pack.ts\`
- Create: \`apps/cli/test/hooks/task-pack.test.ts\`

**Interfaces:**

    export const TASK_PACK_MAX_TOKENS = 2_000;
    export type RenderedTaskPack = { text: string; tokenCount: number };
    export async function renderTaskPack(input: {
      task: string;
      pack: ContextPack;
      countTokens: (text: string) => Promise<number>;
    }): Promise<RenderedTaskPack | null>;

- [ ] **Step 1: Write failing renderer tests**

    it("renders stable path/range/reason metadata only", async () => {
      const one = await renderTaskPack({ task: "fix parser", pack: fixture, countTokens: async () => 24 });
      const two = await renderTaskPack({ task: "fix parser", pack: fixture, countTokens: async () => 24 });
      expect(one).toEqual(two);
      expect(one?.text).toContain("src/parser.ts:10-29");
      expect(one?.text).not.toContain("function secretImplementation");
    });

    it("omits over-budget or unmeasurable output", async () => {
      await expect(renderTaskPack({ task: "x", pack: fixture, countTokens: async () => 2_001 })).resolves.toBeNull();
      await expect(renderTaskPack({ task: "x", pack: fixture, countTokens: async () => { throw new Error("cold"); } })).resolves.toBeNull();
    });

- [ ] **Step 2: Run it to verify it fails**

Run: \`pnpm --filter @megasaver/cli exec vitest run test/hooks/task-pack.test.ts\`

Expected: FAIL because the renderer is absent.

- [ ] **Step 3: Implement the renderer**

Use the supplied \`pack.included\` order and only block metadata:

    const lines = ["Mega Saver task kickoff", "Task: " + input.task.trim(), "Candidate files:"];
    for (const block of input.pack.included) {
      lines.push("- " + block.filePath + ":" + block.startLine + "-" + block.endLine + " — " + block.reasons.join(", "));
    }
    const text = lines.join("\n") + "\n";

Call the injected tokenizer once on final text. Return \`null\` for no included block, a non-finite count, over-cap count, or a throw.

- [ ] **Step 4: Run it to verify it passes**

Run: \`pnpm --filter @megasaver/cli exec vitest run test/hooks/task-pack.test.ts\`

Expected: PASS.

- [ ] **Step 5: Commit**

    git add apps/cli/src/hooks/task-pack.ts apps/cli/test/hooks/task-pack.test.ts
    git commit -m "feat(cli): render stable task kickoff packs"

### Task 3: Store and replay the pack by safe session id

**Files:**

- Create: \`apps/cli/src/hooks/task-pack-store.ts\`
- Create: \`apps/cli/test/hooks/task-pack-store.test.ts\`

**Interfaces:**

    export type StoredTaskPack = { text: string; tokenCount: number; createdAt: string };
    export function taskPackPath(storeRoot: string, workspaceKey: string, sessionId: string): string;
    export function readTaskPack(storeRoot: string, workspaceKey: string, sessionId: string): StoredTaskPack | undefined;
    export function writeTaskPack(storeRoot: string, workspaceKey: string, sessionId: string, pack: StoredTaskPack): void;

- [ ] **Step 1: Write failing persistence tests**

    it("replays the exact pack for a safe session", () => {
      writeTaskPack(root, "wk", SID, { text: "brief", tokenCount: 3, createdAt: NOW });
      expect(readTaskPack(root, "wk", SID)).toEqual({ text: "brief", tokenCount: 3, createdAt: NOW });
    });

    it("does not resolve hostile ids or malformed rows", () => {
      expect(readTaskPack(root, "wk", "../../x")).toBeUndefined();
      writeFileSync(taskPackPath(root, "wk", SID), "{}", "utf8");
      expect(readTaskPack(root, "wk", SID)).toBeUndefined();
    });

- [ ] **Step 2: Run it to verify it fails**

Run: \`pnpm --filter @megasaver/cli exec vitest run test/hooks/task-pack-store.test.ts\`

Expected: FAIL because the store module is absent.

- [ ] **Step 3: Implement strict private storage**

Reuse the intent hook safe-session grammar. Write a strict Zod row at \`stats/<workspace>/task-pack/<session>.json\`, creating a 0700 directory and a 0600 temporary file before atomic rename. Every read/parse error returns \`undefined\`.

- [ ] **Step 4: Run it to verify it passes**

Run: \`pnpm --filter @megasaver/cli exec vitest run test/hooks/task-pack-store.test.ts\`

Expected: PASS.

- [ ] **Step 5: Commit**

    git add apps/cli/src/hooks/task-pack-store.ts apps/cli/test/hooks/task-pack-store.test.ts
    git commit -m "feat(cli): cache task packs per session"

### Task 4: Emit the pack from UserPromptSubmit

**Files:**

- Modify: \`apps/cli/src/hooks/intent-run.ts\`
- Modify: \`apps/cli/src/commands/hooks/intent.ts\`
- Modify: \`apps/cli/test/hooks/intent-run.test.ts\`
- Create: \`apps/cli/test/hooks/intent-pack-integration.test.ts\`

**Interfaces:**

    export async function buildIntentHookOutput(input: {
      payload: unknown;
      storeRoot: string;
      now: () => number;
      buildPack: (input: { cwd: string; task: string }) => Promise<RenderedTaskPack | null>;
    }): Promise<string>;

- [ ] **Step 1: Write failing integration tests**

    it("persists the first pack and returns exact bytes later", async () => {
      const first = await buildIntentHookOutput({ payload, storeRoot, now, buildPack });
      const second = await buildIntentHookOutput({
        payload: { ...payload, prompt: "different" },
        storeRoot,
        now,
        buildPack: async () => { throw new Error("must replay"); },
      });
      expect(second).toBe(first);
      expect(JSON.parse(first).hookSpecificOutput).toMatchObject({ hookEventName: "UserPromptSubmit" });
    });

    it("keeps redacted intent but emits nothing after pack failure", async () => {
      await expect(buildIntentHookOutput({ payload, storeRoot, now, buildPack: async () => null })).resolves.toBe("");
      expect(readSessionIntent(storeRoot, workspaceKey, sessionId, now)).toBe("redacted task");
    });

- [ ] **Step 2: Run it to verify it fails**

Run: \`pnpm --filter @megasaver/cli exec vitest run test/hooks/intent-run.test.ts test/hooks/intent-pack-integration.test.ts\`

Expected: FAIL because \`buildIntentHookOutput\` is absent.

- [ ] **Step 3: Implement fail-open orchestration**

Capture intent first. A safe session reads a stored pack. On miss, find the project from cwd, read indexed blocks through \`readBlocks(resolveIndexPaths(...))\`, call \`buildContextPack\` with the redacted task, and render with real \`countTokens\`. Persist a non-null result and emit a JSON \`hookSpecificOutput\` with \`hookEventName: "UserPromptSubmit"\` and \`additionalContext\`. Id-less or unsafe sessions still save intent but return empty output. Make the process entry/Citty command async and await it.

- [ ] **Step 4: Run focused tests and fail-open smoke**

Run: \`pnpm --filter @megasaver/cli exec vitest run test/hooks/intent-run.test.ts test/hooks/intent-pack-integration.test.ts && printf '%s' '{"prompt":"fix parser","cwd":"/missing","session_id":"11111111-1111-4111-8111-111111111111"}' | pnpm --filter @megasaver/cli exec tsx src/cli.ts hooks intent\`

Expected: tests pass; missing project exits zero with empty stdout.

- [ ] **Step 5: Commit**

    git add apps/cli/src/hooks/intent-run.ts apps/cli/src/commands/hooks/intent.ts apps/cli/test/hooks/intent-run.test.ts apps/cli/test/hooks/intent-pack-integration.test.ts
    git commit -m "feat(cli): inject stable task kickoff context"

### Task 5: Record phase evidence

**Files:**

- Create: \`.changeset/task-kickoff-pack.md\`
- Modify: \`wiki/entities/cli.md\`
- Modify: \`wiki/log.md\`

- [ ] **Step 1: Document the release contract**

Record 2,000-token cap, byte-stable replay, metadata-only output, and fail-open behavior.

- [ ] **Step 2: Run the phase gate**

Run: \`pnpm --filter @megasaver/cli test && pnpm verify\`

Expected: PASS. Any failure starts systematic debugging before a repair.

- [ ] **Step 3: Capture field evidence**

With disposable Claude settings, send two UserPromptSubmit payloads for one session and archive byte-identical output plus stored row. Then run the fresh-store isolated benchmark and record task parity, turns, cache creation, cache read, and normalized cost without a one-cell saving claim.

- [ ] **Step 4: Commit**

    git add .changeset/task-kickoff-pack.md wiki/entities/cli.md wiki/log.md
    git commit -m "docs(cli): record task kickoff evidence"
