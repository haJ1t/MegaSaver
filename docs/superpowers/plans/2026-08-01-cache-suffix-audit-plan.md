# Cache Suffix Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Extend \`mega cache\` with a read-only suffix audit that separates measured global cache usage from static configuration risks.

**Architecture:** Pro Analytics computes the cache-token composition; the Claude connector checks settings shape without retaining content; the CLI owns opt-in local settings I/O and rendering. JSON labels facts as \`measured-global\` or \`configuration-risk\` to prevent false project/hook attribution.

**Tech Stack:** TypeScript strict ESM, Zod, Vitest, existing Cache Doctor and Claude connector settings helpers.

## Global Constraints

- The existing \`mega cache\` Pro gate runs before settings or usage I/O.
- Proxy rows without workspace attribution remain global-only.
- The audit never writes settings, request bodies, hashes, prompt content, or secret-bearing command text.
- Cache-creation share is measured composition, not an avoidable-savings claim.

---

### Task 1: Compute measured cache-token composition

**Files:**

- Modify: \`packages/pro-analytics/src/cache-doctor.ts\`
- Modify: \`packages/pro-analytics/src/index.ts\`
- Modify: \`packages/pro-analytics/test/cache-doctor.test.ts\`

**Interfaces:**

    export type CacheComposition = {
      scope: "measured-global";
      cacheCreationShare: number;
      cacheReadShare: number;
      inputShare: number;
      outputShare: number;
    };
    export function cacheComposition(input: {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
    }): CacheComposition;

- [ ] **Step 1: Write failing composition tests**

    it("reports cache creation as a share of all measured token classes", () => {
      expect(cacheComposition({
        inputTokens: 10,
        outputTokens: 10,
        cacheReadTokens: 20,
        cacheCreationTokens: 60,
      })).toMatchObject({ scope: "measured-global", cacheCreationShare: 0.6, cacheReadShare: 0.2 });
    });

    it("returns zero shares for an empty ledger", () => {
      expect(cacheComposition({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      }).cacheCreationShare).toBe(0);
    });

- [ ] **Step 2: Run it to verify it fails**

Run: \`pnpm --filter @megasaver/pro-analytics exec vitest run test/cache-doctor.test.ts\`

Expected: FAIL because \`cacheComposition\` is absent.

- [ ] **Step 3: Implement and attach the composition**

Use denominator \`input + output + cacheRead + cacheCreation\`; return all zero shares for zero denominator. Add a \`composition\` field to the existing \`CacheDoctorReport\`, returning it from \`diagnoseCache\` without changing D1–D4 behavior.

- [ ] **Step 4: Run it to verify it passes**

Run: \`pnpm --filter @megasaver/pro-analytics exec vitest run test/cache-doctor.test.ts\`

Expected: PASS.

- [ ] **Step 5: Commit**

    git add packages/pro-analytics/src/cache-doctor.ts packages/pro-analytics/src/index.ts packages/pro-analytics/test/cache-doctor.test.ts
    git commit -m "feat(analytics): report cache write composition"

### Task 2: Classify static Claude settings risks

**Files:**

- Create: \`packages/connectors/claude-code/src/cache-suffix-audit.ts\`
- Modify: \`packages/connectors/claude-code/src/index.ts\`
- Create: \`packages/connectors/claude-code/test/cache-suffix-audit.test.ts\`

**Interfaces:**

    export type CacheSuffixRiskCode =
      | "duplicate_megasaver_hook"
      | "custom_base_url_without_first_party_flag"
      | "invalid_settings";
    export type CacheSuffixRisk = {
      scope: "configuration-risk";
      code: CacheSuffixRiskCode;
      detail: string;
    };
    export function auditClaudeCacheSuffix(settings: unknown): CacheSuffixRisk[];

- [ ] **Step 1: Write failing classifier tests**

    it("flags duplicate Mega Saver hooks but leaves unrelated hooks outside details", () => {
      const result = auditClaudeCacheSuffix({
        hooks: {
          PreToolUse: [{
            hooks: [
              { type: "command", command: "mega hooks log" },
              { type: "command", command: "mega hooks log" },
              { type: "command", command: "user command contains API_KEY=secret" },
            ],
          }],
        },
      });
      expect(result).toContainEqual(expect.objectContaining({ code: "duplicate_megasaver_hook" }));
      expect(JSON.stringify(result)).not.toContain("API_KEY");
    });

    it("flags a custom base URL only when the first-party flag is absent", () => {
      expect(auditClaudeCacheSuffix({ env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:4567" } }))
        .toContainEqual(expect.objectContaining({ code: "custom_base_url_without_first_party_flag" }));
      expect(auditClaudeCacheSuffix({
        env: {
          ANTHROPIC_BASE_URL: "http://127.0.0.1:4567",
          _CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL: "1",
        },
      })).toEqual([]);
    });

- [ ] **Step 2: Run it to verify it fails**

Run: \`pnpm --filter @megasaver/connector-claude-code exec vitest run test/cache-suffix-audit.test.ts\`

Expected: FAIL because the classifier is absent.

- [ ] **Step 3: Implement content-free inspection**

Accept only object-like settings. Walk PreToolUse, PostToolUse, UserPromptSubmit, and SessionStart arrays; count commands matching \`mega hooks <name>\` with \`hookCommandMatches\`, and flag only count greater than one. A non-empty \`ANTHROPIC_BASE_URL\` without \`FIRST_PARTY_FLAG === "1"\` is a risk. \`detail\` names the code category only, never a URL or command.

- [ ] **Step 4: Run it to verify it passes**

Run: \`pnpm --filter @megasaver/connector-claude-code exec vitest run test/cache-suffix-audit.test.ts\`

Expected: PASS.

- [ ] **Step 5: Commit**

    git add packages/connectors/claude-code/src/cache-suffix-audit.ts packages/connectors/claude-code/src/index.ts packages/connectors/claude-code/test/cache-suffix-audit.test.ts
    git commit -m "feat(connector): audit cache suffix risks"

### Task 3: Add the \`--suffix-audit\` cache command surface

**Files:**

- Modify: \`apps/cli/src/commands/cache.ts\`
- Modify: \`apps/cli/test/commands/cache.test.ts\`

**Interfaces:**

    export type RunCacheInput = {
      // Existing fields remain.
      suffixAudit?: boolean;
      readClaudeSettings?: () => unknown | null;
    };

- [ ] **Step 1: Write failing CLI tests**

    it("returns measured composition and separate configuration risks in JSON", async () => {
      activatePro();
      const result = await run({ log: usage, suffixAudit: true, settings: duplicateSettings });
      const json = JSON.parse(out.join("\n"));
      expect(json.composition).toMatchObject({ scope: "measured-global", cacheCreationShare: expect.any(Number) });
      expect(json.suffixAudit).toContainEqual(expect.objectContaining({ scope: "configuration-risk" }));
      expect(result.code).toBe(0);
    });

    it("does not read usage or settings before the Pro gate", async () => {
      const readSettings = vi.fn();
      await run({ suffixAudit: true, readSettings });
      expect(readSettings).not.toHaveBeenCalled();
    });

- [ ] **Step 2: Run it to verify it fails**

Run: \`pnpm --filter @megasaver/cli exec vitest run test/commands/cache.test.ts\`

Expected: FAIL because suffix audit is not in the input/output contract.

- [ ] **Step 3: Implement the read-only seam**

Add Citty Boolean \`suffix-audit\` default false. After entitlement success, parse usage as today. When requested, read the Claude settings through the injectable; unreadable/malformed settings contribute the \`invalid_settings\` risk rather than throwing. Text mode prints:

    cache write share: N% (measured global usage)
    configuration risks:
      - <risk code>

JSON adds \`suffixAudit\` while preserving every existing cache report field.

- [ ] **Step 4: Run it to verify it passes**

Run: \`pnpm --filter @megasaver/cli exec vitest run test/commands/cache.test.ts\`

Expected: PASS.

- [ ] **Step 5: Commit**

    git add apps/cli/src/commands/cache.ts apps/cli/test/commands/cache.test.ts
    git commit -m "feat(cli): audit cache suffix risks"

### Task 4: Verify and document this phase

**Files:**

- Create: \`.changeset/cache-suffix-audit.md\`
- Modify: \`wiki/entities/cli.md\`
- Modify: \`wiki/log.md\`

- [ ] **Step 1: Add claim-boundary documentation**

Document that \`measured-global\` uses aggregate proxy counts and a configuration risk has no dollar or token attribution.

- [ ] **Step 2: Run phase verification**

Run: \`pnpm --filter @megasaver/pro-analytics test && pnpm --filter @megasaver/connector-claude-code test && pnpm --filter @megasaver/cli test && pnpm verify\`

Expected: PASS.

- [ ] **Step 3: Capture privacy evidence**

Use a settings fixture with a custom base URL, duplicate Mega hook, and fake secret in an unrelated hook. Run \`mega cache --suffix-audit --json\`; archive the risk codes and prove the output contains neither fake secret nor URL.

- [ ] **Step 4: Commit**

    git add .changeset/cache-suffix-audit.md wiki/entities/cli.md wiki/log.md
    git commit -m "docs(cache): record suffix audit evidence"
