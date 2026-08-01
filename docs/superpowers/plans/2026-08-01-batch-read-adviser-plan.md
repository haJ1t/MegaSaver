# Batch-Read Adviser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** After repeated same-directory Read, Grep, or Glob exploration, inject one concise batch-read suggestion while the original native tool call continues unchanged.

**Architecture:** A session-scoped private state file stores only eligible tool kind, directory, and timestamp. A new fail-open \`mega hooks cache-advice\` handler turns the second matching call within sixty seconds into \`additionalContext\`; it never returns a permission decision.

**Tech Stack:** TypeScript strict ESM, Zod, Vitest, Claude Code hook settings helpers.

## Global Constraints

- Advice is at most once per directory per session and expires after 60,000 ms.
- No file contents or Bash command text is persisted.
- Invalid payloads, unsafe session ids, and all I/O errors emit empty stdout and exit zero.
- State is owner-only under \`stats/<workspace>/cache-advice/\`.

---

### Task 1: Create the pure sequence-state decision

**Files:**

- Create: \`apps/cli/src/hooks/cache-advice-state.ts\`
- Create: \`apps/cli/test/hooks/cache-advice-state.test.ts\`

**Interfaces:**

    export const BATCH_WINDOW_MS = 60_000;
    export type AdviceCall = { tool: "Read" | "Grep" | "Glob"; directory: string; at: number };
    export type BatchAdviceState = { offeredDirectories: string[]; recent: AdviceCall[] };
    export function recordBatchCall(state: BatchAdviceState, call: AdviceCall): {
      state: BatchAdviceState;
      advise: boolean;
    };

- [ ] **Step 1: Write the failing decision tests**

    it("advises only on the second same-directory call in the window", () => {
      const first = recordBatchCall(empty, { tool: "Read", directory: "src", at: 1_000 });
      const second = recordBatchCall(first.state, { tool: "Grep", directory: "src", at: 61_000 });
      expect(first.advise).toBe(false);
      expect(second.advise).toBe(true);
    });

    it("does not advise twice, across directories, or after expiry", () => {
      expect(recordBatchCall(alreadyOffered, { tool: "Glob", directory: "src", at: 2_000 }).advise).toBe(false);
      expect(recordBatchCall(otherDirectory, { tool: "Read", directory: "test", at: 2_000 }).advise).toBe(false);
      expect(recordBatchCall(expiredFirst, { tool: "Read", directory: "src", at: 61_001 }).advise).toBe(false);
    });

- [ ] **Step 2: Run it to verify it fails**

Run: \`pnpm --filter @megasaver/cli exec vitest run test/hooks/cache-advice-state.test.ts\`

Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement bounded state**

Reject empty directory. Drop calls older than the window, keep at most two recent records per directory and 64 offered directories, and set \`advise\` only when exactly one live prior call exists and the directory has not been offered.

- [ ] **Step 4: Run it to verify it passes**

Run: \`pnpm --filter @megasaver/cli exec vitest run test/hooks/cache-advice-state.test.ts\`

Expected: PASS.

- [ ] **Step 5: Commit**

    git add apps/cli/src/hooks/cache-advice-state.ts apps/cli/test/hooks/cache-advice-state.test.ts
    git commit -m "feat(cli): track batch read advice"

### Task 2: Implement the fail-open PreToolUse advice handler

**Files:**

- Create: \`apps/cli/src/hooks/cache-advice-run.ts\`
- Create: \`apps/cli/src/commands/hooks/cache-advice.ts\`
- Create: \`apps/cli/test/hooks/cache-advice-run.test.ts\`

**Interfaces:**

    export async function buildCacheAdviceHookOutput(input: {
      payload: unknown;
      storeRoot: string;
      now: () => number;
    }): Promise<string>;

- [ ] **Step 1: Write failing hook-output tests**

    it("returns additionalContext on the second eligible same-directory call", async () => {
      await buildCacheAdviceHookOutput({ payload: readPayload("src/a.ts"), storeRoot, now });
      const result = JSON.parse(await buildCacheAdviceHookOutput({
        payload: grepPayload("src"),
        storeRoot,
        now: plusOneSecond,
      }));
      expect(result.hookSpecificOutput).toEqual({
        hookEventName: "PreToolUse",
        additionalContext: expect.stringContaining("Batch remaining exploration"),
      });
      expect(result.hookSpecificOutput).not.toHaveProperty("permissionDecision");
    });

    it("returns empty output for unknown tools, missing paths, and unsafe ids", async () => {
      await expect(buildCacheAdviceHookOutput({ payload: invalidPayload, storeRoot, now })).resolves.toBe("");
    });

- [ ] **Step 2: Run it to verify it fails**

Run: \`pnpm --filter @megasaver/cli exec vitest run test/hooks/cache-advice-run.test.ts\`

Expected: FAIL because the handler is absent.

- [ ] **Step 3: Implement payload handling and private state I/O**

Accept only \`session_id\`, \`cwd\`, \`tool_name\`, and \`tool_input\`. Map Read’s \`file_path\` and Grep/Glob’s \`path\` to a directory with \`node:path\`; map cwd with \`encodeWorkspaceKey\`. Reuse intent hook safe-segment, 0700 directory, 0600 temporary-file, and atomic-rename posture. On advice return:

    {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext:
          "Mega Saver: Batch remaining exploration in this directory with one targeted search or mega output file / mega output exec; keep an intent so omitted evidence stays recoverable."
      }
    }

Do not include a \`permissionDecision\` key.

- [ ] **Step 4: Run focused tests and stdin smoke**

Run: \`pnpm --filter @megasaver/cli exec vitest run test/hooks/cache-advice-run.test.ts && printf '%s' '{"session_id":"11111111-1111-4111-8111-111111111111","cwd":"/tmp/repo","tool_name":"Read","tool_input":{"file_path":"src/a.ts"}}' | pnpm --filter @megasaver/cli exec tsx src/cli.ts hooks cache-advice\`

Expected: tests pass; first call exits zero with empty stdout.

- [ ] **Step 5: Commit**

    git add apps/cli/src/hooks/cache-advice-run.ts apps/cli/src/commands/hooks/cache-advice.ts apps/cli/test/hooks/cache-advice-run.test.ts
    git commit -m "feat(cli): advise batched exploration"

### Task 3: Install and remove the advice hook deterministically

**Files:**

- Modify: \`packages/connectors/claude-code/src/hook-settings.ts\`
- Modify: \`apps/cli/src/commands/hooks/install.ts\`
- Modify: \`apps/cli/src/commands/hooks/uninstall.ts\`
- Modify: \`apps/cli/test/hooks/install.test.ts\`
- Modify: \`apps/cli/test/hooks/uninstall.test.ts\`

**Interfaces:**

    export const CACHE_ADVICE_HOOK_COMMAND = "mega hooks cache-advice";
    export const CACHE_ADVICE_HOOK_MATCHER = "^(?:Read|Grep|Glob)$";
    // buildHookCommand accepts "cache-advice".

- [ ] **Step 1: Write failing configuration tests**

    it("installs a distinct Read/Grep/Glob advice hook by default", () => {
      const next = addCacheAdviceHook({}, "mega hooks cache-advice");
      expect(next.hooks?.PreToolUse).toContainEqual(expect.objectContaining({
        matcher: "^(?:Read|Grep|Glob)$",
      }));
    });

    it("skips with --no-cache-advice and removes only the advice command", () => {
      // Assert user hooks and existing log/guard hooks remain after removal.
    });

- [ ] **Step 2: Run it to verify it fails**

Run: \`pnpm --filter @megasaver/cli exec vitest run test/hooks/install.test.ts test/hooks/uninstall.test.ts\`

Expected: FAIL because the command is not installed.

- [ ] **Step 3: Extend connector settings**

Add \`cache-advice\` to the command union. Implement \`hasCacheAdviceHook\`, \`addCacheAdviceHook\`, and \`removeCacheAdviceHook\` using existing \`repairEntry\` and \`stripCommand\`; thread an optional \`cacheAdvice\` flag into installation. Add a Boolean Citty argument named \`cache-advice\` defaulting true so \`--no-cache-advice\` disables only this hook.

- [ ] **Step 4: Run it to verify it passes**

Run: \`pnpm --filter @megasaver/cli exec vitest run test/hooks/install.test.ts test/hooks/uninstall.test.ts && pnpm --filter @megasaver/connector-claude-code test\`

Expected: PASS.

- [ ] **Step 5: Commit**

    git add packages/connectors/claude-code/src/hook-settings.ts apps/cli/src/commands/hooks/install.ts apps/cli/src/commands/hooks/uninstall.ts apps/cli/test/hooks/install.test.ts apps/cli/test/hooks/uninstall.test.ts
    git commit -m "feat(connector): install batch advice hook"

### Task 4: Verify and document this phase

**Files:**

- Create: \`.changeset/batch-read-adviser.md\`
- Modify: \`wiki/entities/cli.md\`
- Modify: \`wiki/log.md\`

- [ ] **Step 1: Document the advisory-only contract**

State that an advice event is not a token-saving event and that the current tool call remains native and permission-controlled.

- [ ] **Step 2: Run the phase verification gate**

Run: \`pnpm --filter @megasaver/cli test && pnpm --filter @megasaver/connector-claude-code test && pnpm verify\`

Expected: PASS.

- [ ] **Step 3: Capture a hook receipt**

Run Read then Grep in the same temporary directory and session; archive the second response and assert it has no \`permissionDecision\`. Run the controlled benchmark and record turn counts separately from cache-creation tokens.

- [ ] **Step 4: Commit**

    git add .changeset/batch-read-adviser.md wiki/entities/cli.md wiki/log.md
    git commit -m "docs(cli): record batch advice evidence"
