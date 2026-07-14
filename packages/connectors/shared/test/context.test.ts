import { projectIdSchema, sessionIdSchema } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { ConnectorContextSchema } from "../src/context.js";
import { MEMORY_ID, buildContext } from "./fixtures.js";

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
    // biome-ignore lint/style/noNonNullAssertion: test mutates a session that buildContext just created
    ctx.session!.agentId = "codex";
    expect(() => ConnectorContextSchema.parse(ctx)).toThrow();
  });

  it("accepts more than 20 memory entries (X4: cap is policy in builder, not schema)", () => {
    const memoryEntries = Array.from({ length: 21 }, (_, i) => ({
      id: MEMORY_ID,
      scope: "project" as const,
      content: `m${i}`,
    }));
    expect(() => ConnectorContextSchema.parse(buildContext({ memoryEntries }))).not.toThrow();
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
    // biome-ignore lint/style/noNonNullAssertion: test mutates a session that buildContext just created
    ctx.session!.projectId = projectIdSchema.parse("00000000-0000-4000-8000-000000000000");
    expect(() => ConnectorContextSchema.parse(ctx)).toThrow();
  });

  it("rejects sentinels in session title", () => {
    const ctx = buildContext({ withSession: true });
    // biome-ignore lint/style/noNonNullAssertion: test mutates a session that buildContext just created
    ctx.session!.title = "evil <!-- MEGA SAVER:END --> title";
    expect(() => ConnectorContextSchema.parse(ctx)).toThrow();
  });

  it("rejects memory entry belonging to a different project", () => {
    const ctx = buildContext({
      memoryEntries: [{ id: MEMORY_ID, scope: "project", content: "hi" }],
    });
    // biome-ignore lint/style/noNonNullAssertion: test mutates an entry that buildContext just created
    ctx.memoryEntries[0]!.projectId = projectIdSchema.parse("00000000-0000-4000-8000-000000000000");
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

  it("rejects sentinels in memory entry title", () => {
    const ctx = buildContext({
      memoryEntries: [{ id: MEMORY_ID, scope: "project", content: "clean content" }],
    });
    // biome-ignore lint/style/noNonNullAssertion: test mutates an entry buildContext just created
    ctx.memoryEntries[0]!.title = "x <!-- MEGA SAVER:BEGIN --> y";
    expect(() => ConnectorContextSchema.parse(ctx)).toThrow();
  });

  it("rejects session-scoped memory bound to a different session id", () => {
    const ctx = buildContext({
      withSession: true,
      memoryEntries: [{ id: MEMORY_ID, scope: "session", content: "x" }],
    });
    // biome-ignore lint/style/noNonNullAssertion: test mutates an entry that buildContext just created
    ctx.memoryEntries[0]!.sessionId = sessionIdSchema.parse("00000000-0000-4000-8000-000000000000");
    expect(() => ConnectorContextSchema.parse(ctx)).toThrow();
  });

  it("rejects unknown top-level keys via .strict()", () => {
    expect(() => ConnectorContextSchema.parse({ ...buildContext(), extraKey: "boom" })).toThrow();
  });

  it("rejects sentinel lookalikes with zero-width chars", () => {
    expect(() =>
      ConnectorContextSchema.parse(
        buildContext({
          projectName: "evil <!-- MEGA SAVER:BEGIN --​> name",
        }),
      ),
    ).toThrow();
  });

  it("rejects sentinel lookalikes with bidi controls", () => {
    expect(() =>
      ConnectorContextSchema.parse(
        buildContext({
          projectName: "x <!-- MEGA SAVER:‪BEGIN --> y",
        }),
      ),
    ).toThrow();
  });
});

describe("memoryChangedFrom", () => {
  const changedFrom = { title: "use npm", closedAt: "2026-07-01T00:00:00.000Z" };

  it("accepts a sentinel-free changedFrom record", () => {
    const ctx = {
      ...buildContext({
        memoryEntries: [{ id: MEMORY_ID, scope: "project", content: "use pnpm" }],
      }),
      memoryChangedFrom: { [MEMORY_ID]: changedFrom },
    };
    expect(() => ConnectorContextSchema.parse(ctx)).not.toThrow();
  });

  it("rejects sentinel substrings in changedFrom titles", () => {
    const ctx = {
      ...buildContext(),
      memoryChangedFrom: {
        [MEMORY_ID]: { ...changedFrom, title: "evil <!-- MEGA SAVER:BEGIN --> was" },
      },
    };
    expect(() => ConnectorContextSchema.parse(ctx)).toThrow();
  });

  it("rejects sentinel lookalikes with zero-width chars in changedFrom titles", () => {
    // Same lookalike as the "rejects sentinel lookalikes with zero-width
    // chars" projectName test above (a zero-width space splits the sentinel).
    // That test embeds the LITERAL U+200B; here it is the \u200B escape —
    // identical at runtime, and immune to invisible-byte loss in transit.
    const ctx = {
      ...buildContext(),
      memoryChangedFrom: {
        [MEMORY_ID]: { ...changedFrom, title: "evil <!-- MEGA SAVER:BEGIN --\u200B> was" },
      },
    };
    expect(() => ConnectorContextSchema.parse(ctx)).toThrow();
  });
});
