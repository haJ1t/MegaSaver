import { describe, expect, it } from "vitest";
import { handoffCommand } from "../../src/commands/handoff/index.js";
import { handoffPackCommand } from "../../src/commands/handoff/pack.js";
import { mainCommand } from "../../src/main.js";

describe("handoff registration", () => {
  it("main registers handoff", () => {
    const subs = mainCommand.subCommands as Record<string, unknown>;
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(subs["handoff"]).toBe(handoffCommand);
  });

  it("root run is pack; subcommands are open/inspect/clear", () => {
    const subs = handoffCommand.subCommands as Record<string, unknown>;
    expect(Object.keys(subs).sort()).toEqual(["clear", "inspect", "open"]);
    expect(handoffCommand.run).toBe(handoffPackCommand.run);
    expect(handoffCommand.args).toBe(handoffPackCommand.args);
  });
});
