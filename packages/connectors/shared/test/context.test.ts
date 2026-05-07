import { describe, expect, it } from "vitest";
import { ConnectorContextSchema } from "../src/context.js";
import { buildContext, MEMORY_ID } from "./fixtures.js";

describe("ConnectorContextSchema", () => {
  it("accepts a minimal valid context", () => {
    expect(() => ConnectorContextSchema.parse(buildContext())).not.toThrow();
  });

  it("rejects sentinel substrings in project name", () => {
    expect(() =>
      ConnectorContextSchema.parse(
        buildContext({ projectName: "evil <!-- MEGA SAVER:BEGIN --> project" }),
      ),
    ).toThrow();
  });

  it("rejects mismatched session.agentId vs context.agentId", () => {
    const ctx = buildContext({ withSession: true });
    ctx.session!.agentId = "codex";
    expect(() => ConnectorContextSchema.parse(ctx)).toThrow();
  });

  it("rejects more than 20 memory entries", () => {
    const memoryEntries = Array.from({ length: 21 }, (_, i) => ({
      id: MEMORY_ID,
      scope: "project" as const,
      content: `m${i}`,
    }));
    expect(() => ConnectorContextSchema.parse(buildContext({ memoryEntries }))).toThrow();
  });

  it("rejects session-scoped memory without session", () => {
    expect(() =>
      ConnectorContextSchema.parse(
        buildContext({
          memoryEntries: [{ id: MEMORY_ID, scope: "session", content: "x" }],
        }),
      ),
    ).toThrow();
  });
});
