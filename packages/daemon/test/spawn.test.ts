import { describe, expect, it } from "vitest";
import { daemonSpawnArgs } from "../src/spawn.js";

describe("daemonSpawnArgs", () => {
  it("invokes `mega daemon serve --store <root>` by default", () => {
    expect(daemonSpawnArgs("/s", {})).toEqual({
      cmd: "mega",
      args: ["daemon", "serve", "--store", "/s"],
    });
  });

  it("honors MEGA_DAEMON_CMD override", () => {
    expect(daemonSpawnArgs("/s", { MEGA_DAEMON_CMD: "/abs/mega" }).cmd).toBe("/abs/mega");
  });
});
