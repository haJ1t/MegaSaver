import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// Random free port (no collision) + a temp settings path (don't touch the real
// ~/.claude/settings.json). Set before importing — read at module load.
const SETTINGS = join(mkdtempSync(join(tmpdir(), "proxy-settings-")), "settings.json");
Object.assign(process.env, { MEGA_PROXY_PORT: "0", MEGA_PROXY_SETTINGS_PATH: SETTINGS });
const { startProxy, stopProxy, proxyStatus } = await import("../../bridge/proxy-control.js");

describe("proxy-control", () => {
  let store: string;
  afterEach(async () => {
    await stopProxy();
    if (store) rmSync(store, { recursive: true, force: true });
  });

  it("start → running + loopback url; stop → not running", async () => {
    store = mkdtempSync(join(tmpdir(), "proxy-ctl-"));
    const started = await startProxy(store);
    expect(started.running).toBe(true);
    expect(started.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(proxyStatus().running).toBe(true);

    const stopped = await stopProxy();
    expect(stopped.running).toBe(false);
    expect(stopped.url).toBeUndefined();
  });
});
