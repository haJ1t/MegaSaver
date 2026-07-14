import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClaudeRouteAdapter } from "../src/proxy-route.js";

let dir: string;
let settings: string;
const URL_OURS = "http://127.0.0.1:8787";
const URL_FOREIGN = "http://127.0.0.1:9999";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mega-route-"));
  settings = join(dir, "settings.json");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const adapter = () => createClaudeRouteAdapter(settings);
const readEnv = () =>
  (JSON.parse(readFileSync(settings, "utf8")) as { env?: { ANTHROPIC_BASE_URL?: string } }).env
    ?.ANTHROPIC_BASE_URL;

describe("inspect", () => {
  it("absent when the file or env is missing", () => {
    expect(adapter().inspect(URL_OURS)).toBe("absent");
    writeFileSync(settings, JSON.stringify({ other: 1 }));
    expect(adapter().inspect(URL_OURS)).toBe("absent");
  });

  it("exact when env matches the expected url", () => {
    writeFileSync(settings, JSON.stringify({ env: { ANTHROPIC_BASE_URL: URL_OURS } }));
    expect(adapter().inspect(URL_OURS)).toBe("exact");
  });

  it("foreign when env holds a different url", () => {
    writeFileSync(settings, JSON.stringify({ env: { ANTHROPIC_BASE_URL: URL_FOREIGN } }));
    expect(adapter().inspect(URL_OURS)).toBe("foreign");
  });

  it("invalid on a corrupt file", () => {
    writeFileSync(settings, "{corrupt");
    expect(adapter().inspect(URL_OURS)).toBe("invalid");
  });

  it("invalid on a symlinked settings file", () => {
    if (process.platform === "win32") return;
    writeFileSync(
      join(dir, "real.json"),
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: URL_OURS } }),
    );
    symlinkSync(join(dir, "real.json"), settings);
    expect(adapter().inspect(URL_OURS)).toBe("invalid");
  });
});

describe("apply", () => {
  it("writes the route and preserves other keys", () => {
    writeFileSync(settings, JSON.stringify({ env: { FOO: "1" }, model: "x" }));
    adapter().apply(URL_OURS);
    expect(readEnv()).toBe(URL_OURS);
    const s = JSON.parse(readFileSync(settings, "utf8"));
    expect(s.env.FOO).toBe("1");
    expect(s.model).toBe("x");
    expect(adapter().inspect(URL_OURS)).toBe("exact");
  });

  it("creates a fresh settings file when none exists", () => {
    adapter().apply(URL_OURS);
    expect(readEnv()).toBe(URL_OURS);
  });

  it("never overwrites a foreign route value (value-guard, defense in depth)", () => {
    writeFileSync(settings, JSON.stringify({ env: { ANTHROPIC_BASE_URL: URL_FOREIGN } }));
    adapter().apply(URL_OURS);
    expect(readEnv()).toBe(URL_FOREIGN); // preserved
  });

  it("never clobbers an unparseable settings file", () => {
    writeFileSync(settings, "{corrupt");
    adapter().apply(URL_OURS);
    expect(readFileSync(settings, "utf8")).toBe("{corrupt"); // untouched
  });

  it("preserves the existing file's mode across a route edit", () => {
    if (process.platform === "win32") return;
    writeFileSync(settings, JSON.stringify({ env: { FOO: "1" } }));
    chmodSync(settings, 0o640);
    adapter().apply(URL_OURS);
    expect(statSync(settings).mode & 0o777).toBe(0o640);
  });

  it("creates a fresh settings file 0600 (conservative default)", () => {
    if (process.platform === "win32") return;
    adapter().apply(URL_OURS);
    expect(statSync(settings).mode & 0o777).toBe(0o600);
  });
});

describe("inspectHooks (read-only)", () => {
  it("reports false without ever creating or mutating the settings file", () => {
    expect(adapter().inspectHooks()).toBe(false);
    expect(existsSync(settings)).toBe(false); // a read must not write
  });

  it("reports true once the hooks are installed", () => {
    adapter().ensureHooks();
    expect(adapter().inspectHooks()).toBe(true);
  });
});

describe("removeExpected (value-guard)", () => {
  it("removes ONLY the exact owned url", () => {
    writeFileSync(settings, JSON.stringify({ env: { ANTHROPIC_BASE_URL: URL_OURS, FOO: "1" } }));
    adapter().removeExpected(URL_OURS);
    expect(readEnv()).toBeUndefined();
    expect(JSON.parse(readFileSync(settings, "utf8")).env.FOO).toBe("1");
  });

  it("never removes a foreign url", () => {
    writeFileSync(settings, JSON.stringify({ env: { ANTHROPIC_BASE_URL: URL_FOREIGN } }));
    adapter().removeExpected(URL_OURS);
    expect(readEnv()).toBe(URL_FOREIGN); // preserved
  });
});

describe("ensureHooks", () => {
  it("installs the MegaSaver hooks and reports configured", () => {
    const r = adapter().ensureHooks();
    expect(r.configured).toBe(true);
    const s = JSON.parse(readFileSync(settings, "utf8"));
    expect(JSON.stringify(s)).toContain("mega hooks saver");
  });
});

describe("assumeFirstParty option", () => {
  const FLAG = "_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL";
  const fpAdapter = () => createClaudeRouteAdapter(settings, { assumeFirstParty: true });
  const readFullEnv = () =>
    (JSON.parse(readFileSync(settings, "utf8")) as { env?: Record<string, string> }).env ?? {};

  it("apply writes the first-party flag next to the base url", () => {
    fpAdapter().apply(URL_OURS);
    expect(readFullEnv()).toEqual({ ANTHROPIC_BASE_URL: URL_OURS, [FLAG]: "1" });
  });

  it("apply without the option writes only the base url (back-compat)", () => {
    adapter().apply(URL_OURS);
    expect(readFullEnv()).toEqual({ ANTHROPIC_BASE_URL: URL_OURS });
  });

  it("removeExpected drops both keys and preserves foreign env keys", () => {
    writeFileSync(
      settings,
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: URL_OURS, [FLAG]: "1", OTHER: "keep" } }),
    );
    fpAdapter().removeExpected(URL_OURS);
    expect(readFullEnv()).toEqual({ OTHER: "keep" });
  });

  it("removeExpected without the option still drops a stale flag", () => {
    writeFileSync(settings, JSON.stringify({ env: { ANTHROPIC_BASE_URL: URL_OURS, [FLAG]: "1" } }));
    adapter().removeExpected(URL_OURS);
    expect(readFullEnv()).toEqual({});
  });

  it("removeExpected on a foreign base url touches nothing", () => {
    writeFileSync(
      settings,
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: URL_FOREIGN, [FLAG]: "1" } }),
    );
    fpAdapter().removeExpected(URL_OURS);
    expect(readFullEnv()).toEqual({ ANTHROPIC_BASE_URL: URL_FOREIGN, [FLAG]: "1" });
  });

  it("inspect reports absent when the route exists but the flag is missing (self-heal)", () => {
    writeFileSync(settings, JSON.stringify({ env: { ANTHROPIC_BASE_URL: URL_OURS } }));
    expect(fpAdapter().inspect(URL_OURS)).toBe("absent");
  });

  it("inspect reports exact when both keys are present", () => {
    writeFileSync(settings, JSON.stringify({ env: { ANTHROPIC_BASE_URL: URL_OURS, [FLAG]: "1" } }));
    expect(fpAdapter().inspect(URL_OURS)).toBe("exact");
  });

  it("inspect without the option ignores the flag (unchanged semantics)", () => {
    writeFileSync(settings, JSON.stringify({ env: { ANTHROPIC_BASE_URL: URL_OURS } }));
    expect(adapter().inspect(URL_OURS)).toBe("exact");
  });

  it("apply is idempotent when re-run to heal a missing flag", () => {
    writeFileSync(settings, JSON.stringify({ env: { ANTHROPIC_BASE_URL: URL_OURS } }));
    fpAdapter().apply(URL_OURS);
    expect(readFullEnv()).toEqual({ ANTHROPIC_BASE_URL: URL_OURS, [FLAG]: "1" });
  });
});
