import { describe, expect, it } from "vitest";
import { hooksCommand } from "../../src/commands/hooks/index.js";

describe("hooks command group", () => {
  it("registers the intent subcommand", () => {
    expect(hooksCommand.subCommands).toHaveProperty("intent");
    expect((hooksCommand.subCommands?.intent as { meta?: { name?: string } })?.meta?.name).toBe(
      "intent",
    );
  });
});
