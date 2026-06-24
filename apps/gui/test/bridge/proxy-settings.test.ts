import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyProxyEnv } from "../../bridge/proxy-settings.js";

describe("applyProxyEnv", () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "proxy-settings-"));
    path = join(dir, "settings.local.json");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const read = () =>
    JSON.parse(readFileSync(path, "utf8")) as { env?: { ANTHROPIC_BASE_URL?: string } };

  it("writes ANTHROPIC_BASE_URL into a fresh settings file", () => {
    applyProxyEnv("http://127.0.0.1:8787", path);
    expect(read().env?.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:8787");
  });

  it("removes it on null, preserving other settings", () => {
    writeFileSync(
      path,
      JSON.stringify({
        permissions: { allow: ["x"] },
        env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:8787", FOO: "1" },
      }),
    );
    applyProxyEnv(null, path);
    const s = read() as {
      env?: { ANTHROPIC_BASE_URL?: string; FOO?: string };
      permissions?: unknown;
    };
    expect(s.env?.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(s.env?.FOO).toBe("1"); // other env kept
    expect(s.permissions).toEqual({ allow: ["x"] }); // other keys kept
  });

  it("leaves a corrupt file untouched", () => {
    writeFileSync(path, "{ not json");
    applyProxyEnv("http://127.0.0.1:8787", path);
    expect(readFileSync(path, "utf8")).toBe("{ not json");
  });
});
