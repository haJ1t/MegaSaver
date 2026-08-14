import { describe, expect, it } from "vitest";
import { addStopHook, hasStopHook, removeStopHook } from "../src/hook-settings.js";

const CMD = "mega hooks verify-reminder";

describe("Stop hook settings helpers", () => {
  it("addStopHook creates hooks.Stop with the command and NO matcher", () => {
    const next = addStopHook({}, CMD);
    expect(hasStopHook(next, CMD)).toBe(true);
    const stop = (next as { hooks: { Stop: unknown[] } }).hooks.Stop;
    expect(stop).toEqual([{ hooks: [{ type: "command", command: CMD, timeout: 10 }] }]);
  });

  it("addStopHook is idempotent", () => {
    const once = addStopHook({}, CMD);
    const twice = addStopHook(once, CMD);
    expect(twice).toEqual(once);
  });

  it("removeStopHook strips only the owned command, keeping co-located user hooks", () => {
    const seeded = {
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command: "user-cleanup" },
              { type: "command", command: CMD },
            ],
          },
        ],
      },
    };
    const next = removeStopHook(seeded, CMD);
    expect(hasStopHook(next, CMD)).toBe(false);
    expect((next as { hooks: { Stop: unknown[] } }).hooks.Stop).toEqual([
      { hooks: [{ type: "command", command: "user-cleanup" }] },
    ]);
  });

  it("removeStopHook drops the Stop key and the whole hooks key when empty", () => {
    const next = removeStopHook({ hooks: { Stop: [{ hooks: [{ type: "command", command: CMD }] }] } }, CMD);
    expect(next).toEqual({});
  });

  it("removeStopHook on an absent entry is a no-op", () => {
    const seeded = { hooks: { Stop: [{ hooks: [{ type: "command", command: "user-cleanup" }] }] } };
    expect(removeStopHook(seeded, CMD)).toEqual(seeded);
  });

  it("hasStopHook is false on missing or non-object settings", () => {
    expect(hasStopHook(undefined, CMD)).toBe(false);
    expect(hasStopHook({ hooks: {} }, CMD)).toBe(false);
  });
});
