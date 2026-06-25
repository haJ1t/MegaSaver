import { describe, expect, it } from "vitest";
import { buildRestartScript } from "../../bridge/restart-claude.js";

describe("buildRestartScript", () => {
  it("quits then relaunches the desktop binary with the proxy env", () => {
    const script = buildRestartScript("http://127.0.0.1:8787", "/Applications/Claude.app/x/Claude");
    expect(script).toContain('tell application "Claude" to quit');
    expect(script).toContain("ANTHROPIC_BASE_URL='http://127.0.0.1:8787'");
    expect(script).toContain("'/Applications/Claude.app/x/Claude'");
    // quit must precede relaunch
    expect(script.indexOf("quit")).toBeLessThan(script.indexOf("ANTHROPIC_BASE_URL"));
  });

  it("rejects a non-loopback url (no shell injection via baseUrl)", () => {
    expect(() => buildRestartScript("http://evil.test'; rm -rf ~ #")).toThrow();
    expect(() => buildRestartScript("https://api.anthropic.com")).toThrow();
  });
});
