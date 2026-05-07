import { projectIdSchema, sessionIdSchema } from "@megasaver/shared";
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

  it("rejects session belonging to a different project", () => {
    const ctx = buildContext({ withSession: true });
    ctx.session!.projectId = projectIdSchema.parse(
      "00000000-0000-4000-8000-000000000000",
    );
    expect(() => ConnectorContextSchema.parse(ctx)).toThrow();
  });

  it("rejects sentinels in session title", () => {
    const ctx = buildContext({ withSession: true });
    ctx.session!.title = "evil <!-- MEGA SAVER:END --> title";
    expect(() => ConnectorContextSchema.parse(ctx)).toThrow();
  });

  it("rejects memory entry belonging to a different project", () => {
    const ctx = buildContext({
      memoryEntries: [{ id: MEMORY_ID, scope: "project", content: "hi" }],
    });
    ctx.memoryEntries[0]!.projectId = projectIdSchema.parse(
      "00000000-0000-4000-8000-000000000000",
    );
    expect(() => ConnectorContextSchema.parse(ctx)).toThrow();
  });

  it("rejects sentinels in memory entry content", () => {
    expect(() =>
      ConnectorContextSchema.parse(
        buildContext({
          memoryEntries: [
            { id: MEMORY_ID, scope: "project", content: "x <!-- MEGA SAVER:BEGIN --> y" },
          ],
        }),
      ),
    ).toThrow();
  });

  it("rejects session-scoped memory bound to a different session id", () => {
    const ctx = buildContext({
      withSession: true,
      memoryEntries: [{ id: MEMORY_ID, scope: "session", content: "x" }],
    });
    ctx.memoryEntries[0]!.sessionId = sessionIdSchema.parse(
      "00000000-0000-4000-8000-000000000000",
    );
    expect(() => ConnectorContextSchema.parse(ctx)).toThrow();
  });

  it("rejects unknown top-level keys via .strict()", () => {
    expect(() =>
      ConnectorContextSchema.parse({ ...buildContext(), extraKey: "boom" }),
    ).toThrow();
  });
});
