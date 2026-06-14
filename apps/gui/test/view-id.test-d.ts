import { describe, expectTypeOf, it } from "vitest";
import type { VIEW_IDS, ViewId } from "../src/view-id.js";

describe("ViewId tuple ordering", () => {
  it("pins alphabetic order", () => {
    expectTypeOf<typeof VIEW_IDS>().toEqualTypeOf<
      readonly [
        "agent-setup",
        "claude-sessions",
        "context",
        "index",
        "memory",
        "overview",
        "rules",
        "sessions",
        "tasks",
        "tools",
      ]
    >();
  });

  it("ViewId is the union of the tuple members", () => {
    expectTypeOf<ViewId>().toEqualTypeOf<
      | "agent-setup"
      | "claude-sessions"
      | "context"
      | "index"
      | "memory"
      | "overview"
      | "rules"
      | "sessions"
      | "tasks"
      | "tools"
    >();
  });
});
