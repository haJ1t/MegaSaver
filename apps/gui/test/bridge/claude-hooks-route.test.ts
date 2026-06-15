import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startTestBridge } from "./test-helpers.js";

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  if (close) await close();
  close = null;
});

async function bridgeWithSettings(): Promise<{ baseUrl: string; settingsPath: string }> {
  const settingsPath = join(mkdtempSync(join(tmpdir(), "ms-bridge-hooks-")), "settings.json");
  const started = await startTestBridge({ claudeSettingsPath: settingsPath });
  close = started.close;
  return { baseUrl: started.baseUrl, settingsPath };
}

describe("GET/POST/DELETE /api/hooks/claude-code", () => {
  it("reports disconnected on a fresh settings path", async () => {
    const { baseUrl } = await bridgeWithSettings();
    const res = await fetch(`${baseUrl}/api/hooks/claude-code`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      connected: false,
      preInstalled: false,
      postInstalled: false,
    });
  });

  it("POST connects (installs both hooks); GET then reports connected", async () => {
    const { baseUrl, settingsPath } = await bridgeWithSettings();
    const post = await fetch(`${baseUrl}/api/hooks/claude-code`, { method: "POST" });
    expect(post.status).toBe(200);
    expect((await post.json()).connected).toBe(true);
    expect(existsSync(settingsPath)).toBe(true);
    const get = await fetch(`${baseUrl}/api/hooks/claude-code`);
    expect((await get.json()).connected).toBe(true);
  });

  it("DELETE disconnects (removes the hooks)", async () => {
    const { baseUrl, settingsPath } = await bridgeWithSettings();
    await fetch(`${baseUrl}/api/hooks/claude-code`, { method: "POST" });
    const del = await fetch(`${baseUrl}/api/hooks/claude-code`, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect((await del.json()).connected).toBe(false);
    expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual({});
  });

  it("rejects an unsupported method with 405", async () => {
    const { baseUrl } = await bridgeWithSettings();
    const res = await fetch(`${baseUrl}/api/hooks/claude-code`, { method: "PUT" });
    expect(res.status).toBe(405);
  });
});
