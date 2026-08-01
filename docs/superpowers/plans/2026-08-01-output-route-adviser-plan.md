# PreToolUse Output-Route Adviser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Detect a narrow class of potentially high-output, read-only Bash calls and offer a lossless \`mega output exec\` route without changing the current Bash input or permission decision.

**Architecture:** Extend the Batch-Read Adviser’s fail-open cache-advice hook with a pure conservative classifier. Only simple \`rg\`, \`grep\`, \`find\`, \`git log\`, and \`git diff\` shapes qualify. The response is generic additional context; command text is used in memory only and never emitted or persisted.

**Tech Stack:** TypeScript strict ESM, Zod, Vitest, existing hook settings helpers, existing policy-gated output executor.

## Global Constraints

- No Bash input is rewritten and no permission decision is returned.
- Shell operators, redirection, substitution, environment assignment, pipes, and unknown programs are passthrough.
- Advice is once per command family per session and never echoes a command.
- The existing \`mega output exec\` path remains the sole running/filtering path, including policy gate, redaction-before-store, and recovery footer.
- Automatic command mutation needs a separate HIGH-risk approved design and is not introduced here.

---

### Task 1: Parse only safe, potentially large read-only command forms

**Files:**

- Create: \`apps/cli/src/hooks/output-route-command.ts\`
- Create: \`apps/cli/test/hooks/output-route-command.test.ts\`

**Interfaces:**

    export type OutputRouteFamily = "rg" | "grep" | "find" | "git-log" | "git-diff";
    export function classifyOutputRouteCommand(command: string): OutputRouteFamily | null;

- [ ] **Step 1: Write failing grammar tests**

    it.each([
      ["rg TODO src", "rg"],
      ["grep -R error src", "grep"],
      ["find src -type f", "find"],
      ["git log --oneline", "git-log"],
      ["git diff main", "git-diff"],
    ])("accepts simple %s", (command, family) => {
      expect(classifyOutputRouteCommand(command)).toBe(family);
    });

    it.each([
      "rg x | head",
      "FOO=1 rg x",
      "git diff > out",
      "$(rg x)",
      "npm test",
      "git status",
    ])("rejects shell-bearing or unknown input", (command) => {
      expect(classifyOutputRouteCommand(command)).toBeNull();
    });

- [ ] **Step 2: Run it to verify it fails**

Run: \`pnpm --filter @megasaver/cli exec vitest run test/hooks/output-route-command.test.ts\`

Expected: FAIL because the classifier is absent.

- [ ] **Step 3: Implement conservative grammar**

Return null for any string containing \`|\`, \`;\`, \`&\`, \`<\`, \`>\`, a backtick, \`$(\`, newline, or a leading variable assignment. Split only whitespace-delimited simple commands. Return the literal family only for documented program prefixes; every ambiguity is null.

- [ ] **Step 4: Run it to verify it passes**

Run: \`pnpm --filter @megasaver/cli exec vitest run test/hooks/output-route-command.test.ts\`

Expected: PASS.

- [ ] **Step 5: Commit**

    git add apps/cli/src/hooks/output-route-command.ts apps/cli/test/hooks/output-route-command.test.ts
    git commit -m "feat(cli): classify safe output route commands"

### Task 2: Add one-shot output-route advice to cache-advice

**Files:**

- Modify: \`apps/cli/src/hooks/cache-advice-state.ts\`
- Modify: \`apps/cli/src/hooks/cache-advice-run.ts\`
- Modify: \`apps/cli/test/hooks/cache-advice-state.test.ts\`
- Modify: \`apps/cli/test/hooks/cache-advice-run.test.ts\`

**Interfaces:**

    export type BatchAdviceState = {
      offeredDirectories: string[];
      offeredOutputRouteFamilies: OutputRouteFamily[];
      recent: AdviceCall[];
    };

- [ ] **Step 1: Write failing advice tests**

    it("offers generic output-route advice once for a classified rg command", async () => {
      const one = JSON.parse(await buildCacheAdviceHookOutput({
        payload: bashPayload("rg TODO src"),
        storeRoot,
        now,
      }));
      const two = await buildCacheAdviceHookOutput({
        payload: bashPayload("rg FIXME src"),
        storeRoot,
        now: later,
      });
      expect(one.hookSpecificOutput.additionalContext).toContain("mega output exec");
      expect(one.hookSpecificOutput.additionalContext).not.toContain("rg TODO src");
      expect(one.hookSpecificOutput).not.toHaveProperty("permissionDecision");
      expect(two).toBe("");
    });

    it("passes shell syntax and unknown Bash through", async () => {
      await expect(buildCacheAdviceHookOutput({
        payload: bashPayload("rg TODO | head"),
        storeRoot,
        now,
      })).resolves.toBe("");
    });

- [ ] **Step 2: Run it to verify it fails**

Run: \`pnpm --filter @megasaver/cli exec vitest run test/hooks/cache-advice-state.test.ts test/hooks/cache-advice-run.test.ts\`

Expected: FAIL because Bash input is ignored.

- [ ] **Step 3: Implement the generic advice branch**

For \`tool_name === "Bash"\`, inspect \`tool_input.command\` only in memory with \`classifyOutputRouteCommand\`. Persist only the family tag when it has not been offered. Return:

    {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext:
          "Mega Saver: this read-only command may produce a large result. To keep it lossless and recoverable, run the same argv through mega output exec <session-id> --intent <goal> -- <command> when a Mega Saver session is available."
      }
    }

Never copy command text into state or response. Do not call a permission API.

- [ ] **Step 4: Run it to verify it passes**

Run: \`pnpm --filter @megasaver/cli exec vitest run test/hooks/cache-advice-state.test.ts test/hooks/cache-advice-run.test.ts\`

Expected: PASS.

- [ ] **Step 5: Commit**

    git add apps/cli/src/hooks/cache-advice-state.ts apps/cli/src/hooks/cache-advice-run.ts apps/cli/test/hooks/cache-advice-state.test.ts apps/cli/test/hooks/cache-advice-run.test.ts
    git commit -m "feat(cli): advise lossless output routing"

### Task 3: Extend the existing advice matcher to Bash

**Files:**

- Modify: \`packages/connectors/claude-code/src/hook-settings.ts\`
- Modify: \`apps/cli/test/hooks/install.test.ts\`
- Modify: \`apps/cli/test/hooks/status.test.ts\`

**Interfaces:** The existing cache-advice matcher changes from \`^(?:Read|Grep|Glob)$\` to \`^(?:Read|Grep|Glob|Bash)$\`.

- [ ] **Step 1: Write the failing migration test**

    it("repairs an installed advice entry to include Bash without duplication", () => {
      const next = addCacheAdviceHook(legacySettings, "mega hooks cache-advice");
      const entries = next.hooks?.PreToolUse ?? [];
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ matcher: "^(?:Read|Grep|Glob|Bash)$" });
    });

- [ ] **Step 2: Run it to verify it fails**

Run: \`pnpm --filter @megasaver/connector-claude-code test && pnpm --filter @megasaver/cli exec vitest run test/hooks/install.test.ts test/hooks/status.test.ts\`

Expected: FAIL because the old matcher excludes Bash.

- [ ] **Step 3: Repair the installed entry in place**

Change only the named cache-advice matcher. Reuse \`repairEntry\`, ensuring reinstallation updates the known entry instead of appending a new entry; leave unrelated user/log/guard entries unchanged.

- [ ] **Step 4: Run it to verify it passes**

Run: \`pnpm --filter @megasaver/connector-claude-code test && pnpm --filter @megasaver/cli exec vitest run test/hooks/install.test.ts test/hooks/status.test.ts\`

Expected: PASS.

- [ ] **Step 5: Commit**

    git add packages/connectors/claude-code/src/hook-settings.ts apps/cli/test/hooks/install.test.ts apps/cli/test/hooks/status.test.ts
    git commit -m "feat(connector): route bash advice hook"

### Task 4: Verify preservation and record evidence

**Files:**

- Create: \`.changeset/output-route-adviser.md\`
- Modify: \`wiki/entities/cli.md\`
- Modify: \`wiki/log.md\`

- [ ] **Step 1: Document the public contract**

State that this phase does not run, rewrite, deny, or grant a Bash command; it only tells the agent how to elect the existing lossless route.

- [ ] **Step 2: Run the phase gate**

Run: \`pnpm --filter @megasaver/cli test && pnpm --filter @megasaver/connector-claude-code test && pnpm verify\`

Expected: PASS.

- [ ] **Step 3: Capture command-preservation evidence**

Feed an eligible rg fixture and an \`rg | head\` fixture into the hook. Archive that the eligible output has only additional context, the shell form returns empty output, and neither response contains the original command. In the benchmark record adoption separately; advice events do not prove use.

- [ ] **Step 4: Commit**

    git add .changeset/output-route-adviser.md wiki/entities/cli.md wiki/log.md
    git commit -m "docs(cli): record output route evidence"
