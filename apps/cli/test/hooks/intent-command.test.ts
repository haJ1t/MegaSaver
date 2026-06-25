import { describe, expect, it } from "vitest";
import { hooksCommand } from "../../src/commands/hooks/index.js";

describe("hooks command group", () => {
  it("registers the intent subcommand", () => {
    const sub = hooksCommand.subCommands as Record<string, unknown>;
    expect(sub).toHaveProperty("intent");
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect((sub["intent"] as { meta?: { name?: string } })?.meta?.name).toBe("intent");
  });
});
