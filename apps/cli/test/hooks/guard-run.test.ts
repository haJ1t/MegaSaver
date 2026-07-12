import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendGuardCorpusRow } from "@megasaver/context-gate";
import {
  DEFAULT_GUARD_STATE,
  readGuardEvents,
  readGuardState,
  writeGuardState,
} from "@megasaver/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildGuardHookOutput } from "../../src/hooks/guard-run.js";
import { ensureStoreReady } from "../../src/store.js";

const NOW = "2026-07-12T10:00:00.000Z";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-guardhook-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function seed(rootPath: string) {
  const { registry } = await ensureStoreReady(root);
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath,
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
  return registry;
}

function corpusRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    command: "pnpm vitest --shard 2",
    errorOutput: "Error: unknown option '--shard' in src/run.ts",
    wastedTokens: 4200,
    createdAt: "2026-07-11T10:00:00.000Z",
    ...over,
  } as never;
}

function bashPayload(command: string) {
  return {
    session_id: "s1",
    cwd: "/work/demo",
    tool_name: "Bash",
    tool_input: { command },
  };
}

function call(payload: unknown) {
  return buildGuardHookOutput({ payload, storeRoot: root, now: () => Date.parse(NOW) });
}

describe("buildGuardHookOutput", () => {
  it("warns via additionalContext on a T1 corpus match, never permissionDecision", async () => {
    await seed("/work/demo");
    appendGuardCorpusRow(root, PROJECT_ID, corpusRow());
    const out = JSON.parse(await call(bashPayload("pnpm vitest --shard 2")));
    expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(out.hookSpecificOutput.additionalContext).toContain("Mistake Firewall");
    expect(out.hookSpecificOutput.additionalContext).toContain("2026-07-11");
    expect(out.hookSpecificOutput.additionalContext).toContain("4200 tokens");
    expect(out.hookSpecificOutput.permissionDecision).toBeUndefined();
  });

  it("denies only in strict mode on T1", async () => {
    await seed("/work/demo");
    appendGuardCorpusRow(root, PROJECT_ID, corpusRow());
    writeGuardState(root, PROJECT_ID, { ...DEFAULT_GUARD_STATE, mode: "strict" });
    const out = JSON.parse(await call(bashPayload("pnpm vitest --shard 2")));
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("mega guard mode warn");
  });

  it("appends an intercept event and cooldown state on warn", async () => {
    await seed("/work/demo");
    appendGuardCorpusRow(root, PROJECT_ID, corpusRow());
    await call(bashPayload("pnpm vitest --shard 2"));
    const events = readGuardEvents({ root }, PROJECT_ID as never);
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({
      type: "intercept",
      tier: "t1",
      action: "warn",
      estimated: true,
    });
    const state = readGuardState(root, PROJECT_ID);
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    expect(state?.sessions["s1"]?.firedIds).toContain("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    const interceptEntry = Object.values(state?.sessions["s1"]?.intercepts ?? {})[0];
    expect(interceptEntry?.command).toBe("pnpm vitest --shard 2");
    expect(interceptEntry?.signatures).toContain("src/run.ts");
    expect(interceptEntry?.candidateId).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  });

  it("same candidate fires once per session (cooldown)", async () => {
    await seed("/work/demo");
    appendGuardCorpusRow(root, PROJECT_ID, corpusRow());
    await call(bashPayload("pnpm vitest --shard 2"));
    const second = await call(bashPayload("pnpm vitest --shard 2"));
    expect(second).toBe("");
  });

  it("fail-open: empty output on bad payload, missing project, or mid-flight throw", async () => {
    expect(await call({ nope: true })).toBe("");
    await seed("/work/demo");
    expect(await call({ ...bashPayload("ls"), cwd: "/nowhere" })).toBe("");
    // unreadable store root → internal throw → ""
    expect(
      await buildGuardHookOutput({
        payload: bashPayload("ls"),
        storeRoot: "/nonexistent/nope",
        now: () => Date.parse(NOW),
      }),
    ).toBe("");
  });

  it("ignores non-matched tools and empty stores silently", async () => {
    await seed("/work/demo");
    expect(await call({ ...bashPayload("ls"), tool_name: "Read" })).toBe("");
    expect(await call(bashPayload("ls"))).toBe(""); // empty corpus, no failed attempts
  });
});
