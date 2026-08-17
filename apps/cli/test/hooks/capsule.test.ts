import type { ChunkSetSummary } from "@megasaver/content-store";
import { estimateTokens } from "@megasaver/output-filter";
import { describe, expect, it } from "vitest";
import {
  CAPSULE_TOKEN_BUDGET,
  buildWorkStateCapsule,
  redactCapsule,
  renderCapsuleContext,
} from "../../src/hooks/capsule.js";

function summary(
  chunkSetId: string,
  createdAt: string,
  source: ChunkSetSummary["source"],
): ChunkSetSummary {
  return { chunkSetId, createdAt, source, rawBytes: 100, redacted: true, chunkCount: 3 };
}

describe("buildWorkStateCapsule", () => {
  it("partitions sources into files, commands, and counters, newest first", () => {
    const capsule = buildWorkStateCapsule({
      summaries: [
        summary("cs-old", "2026-08-06T10:00:00.000Z", { kind: "file", path: "src/a.ts" }),
        summary("cs-new", "2026-08-06T11:00:00.000Z", { kind: "file", path: "src/b.ts" }),
        summary("cs-cmd", "2026-08-06T10:30:00.000Z", {
          kind: "command",
          command: "pnpm test",
          args: [],
        }),
        summary("cs-grep", "2026-08-06T10:31:00.000Z", {
          kind: "grep",
          query: "resolveStorePath",
        }),
        summary("cs-fetch", "2026-08-06T10:32:00.000Z", {
          kind: "fetch",
          url: "https://example.com/doc",
        }),
      ],
      trigger: "auto",
      now: () => Date.parse("2026-08-06T12:00:00.000Z"),
    });
    expect(capsule.filesTouched.map((f) => f.path)).toEqual(["src/b.ts", "src/a.ts"]);
    expect(capsule.commandsRun).toEqual([
      { command: "pnpm test", chunkSetId: "cs-cmd", createdAt: "2026-08-06T10:30:00.000Z" },
    ]);
    expect(capsule.searchCount).toBe(1);
    expect(capsule.fetchCount).toBe(1);
    expect(capsule.trigger).toBe("auto");
    expect(capsule.openDecisions).toEqual([]);
  });

  it("dedupes re-reads of the same path, keeping the newest chunk-set pointer", () => {
    const capsule = buildWorkStateCapsule({
      summaries: [
        summary("cs-1", "2026-08-06T10:00:00.000Z", { kind: "file", path: "src/a.ts" }),
        summary("cs-2", "2026-08-06T11:00:00.000Z", { kind: "file", path: "src/a.ts" }),
      ],
      trigger: "manual",
      now: () => 0,
    });
    expect(capsule.filesTouched).toEqual([
      { path: "src/a.ts", chunkSetId: "cs-2", createdAt: "2026-08-06T11:00:00.000Z" },
    ]);
  });
});

describe("redactCapsule", () => {
  it("passes every string field through the redactor", () => {
    const capsule = buildWorkStateCapsule({
      summaries: [
        summary("cs-1", "2026-08-06T10:00:00.000Z", {
          kind: "command",
          command: "curl -H secret",
          args: [],
        }),
      ],
      intent: { prompt: "use secret", ts: 1 },
      trigger: "auto",
      now: () => 0,
    });
    const redacted = redactCapsule(capsule, (s) => s.replaceAll("secret", "[REDACTED]"));
    expect(redacted.commandsRun[0]?.command).toBe("curl -H [REDACTED]");
    expect(redacted.intent?.prompt).toBe("use [REDACTED]");
  });
});

describe("renderCapsuleContext", () => {
  it("stays under the token budget for a huge session and points at the store", () => {
    const summaries: ChunkSetSummary[] = [];
    for (let i = 0; i < 800; i += 1) {
      summaries.push(
        summary(`cs-f${i}`, "2026-08-06T10:00:00.000Z", {
          kind: "file",
          path: `packages/core/src/very/long/path/file-${i}.ts`,
        }),
      );
      summaries.push(
        summary(`cs-c${i}`, "2026-08-06T10:00:01.000Z", {
          kind: "command",
          command: `pnpm --filter pkg-${i} test`,
          args: [],
        }),
      );
    }
    const text = renderCapsuleContext(
      buildWorkStateCapsule({ summaries, trigger: "auto", now: () => 0 }),
    );
    expect(estimateTokens(text)).toBeLessThanOrEqual(CAPSULE_TOKEN_BUDGET);
    expect(text).toContain("more in store");
    expect(text).toContain("mega output chunk");
  });

  it("clamps a giant pasted intent prompt so the budget holds even with zero entries", () => {
    const text = renderCapsuleContext(
      buildWorkStateCapsule({
        summaries: [],
        // ~260 KB — the scale of a max-size UserPromptSubmit stdin (256 KB cap).
        intent: { prompt: "a very long pasted prompt ".repeat(10_000), ts: 1 },
        trigger: "auto",
        now: () => 0,
      }),
    );
    expect(estimateTokens(text)).toBeLessThanOrEqual(CAPSULE_TOKEN_BUDGET);
    expect(text).toContain("Task intent:");
  });

  it("lists chunk-set ids next to each receipt so details expand losslessly", () => {
    const text = renderCapsuleContext(
      buildWorkStateCapsule({
        summaries: [
          summary("cs-abc", "2026-08-06T10:00:00.000Z", { kind: "file", path: "src/a.ts" }),
        ],
        intent: { prompt: "fix auth", ts: 1 },
        trigger: "auto",
        now: () => 0,
      }),
    );
    expect(text).toContain("src/a.ts");
    expect(text).toContain("cs-abc");
    expect(text).toContain("fix auth");
  });
});
