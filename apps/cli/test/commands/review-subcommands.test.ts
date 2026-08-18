import { describe, expect, it } from "vitest";
import { reviewCommand } from "../../src/commands/review/index.js";

describe("reviewCommand subcommands", () => {
  it("exposes attest, check, and pack subcommands", async () => {
    const subCommands = await (typeof reviewCommand.subCommands === "function"
      ? reviewCommand.subCommands()
      : reviewCommand.subCommands);
    expect(subCommands).toHaveProperty("attest");
    expect(subCommands).toHaveProperty("check");
    expect(subCommands).toHaveProperty("pack");
  });
});
