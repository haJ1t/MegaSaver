import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type LaunchctlRunner,
  MANAGED_LABEL,
  ensureManagedService,
  renderLaunchAgentPlist,
  uninstallManagedService,
} from "../src/launchagent.js";

let dir: string;
let plistPath: string;
let backupDir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mega-la-"));
  plistPath = join(dir, "com.megasaver.proxy.plist");
  backupDir = join(dir, "backups");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const MANAGED_ARGV = ["/usr/local/bin/mega", "proxy", "supervise", "--store", "/store"];
const LEGACY_ARGV = ["/usr/local/bin/mega", "proxy", "start"];

// A fake launchctl: `loaded` maps label → programArguments (or absent).
function fakeRunner(loaded: Record<string, string[] | undefined> = {}): LaunchctlRunner & {
  calls: string[];
} {
  const state: Record<string, string[] | undefined> = { ...loaded };
  const calls: string[] = [];
  return {
    calls,
    print: (label) => {
      const argv = state[label];
      return argv ? { loaded: true, programArguments: argv } : null;
    },
    bootout: (label) => {
      calls.push(`bootout ${label}`);
      state[label] = undefined;
    },
    bootstrap: (p) => {
      calls.push(`bootstrap ${p}`);
      state[MANAGED_LABEL] = MANAGED_ARGV;
    },
    kickstart: (label, force) => {
      calls.push(`kickstart ${label} ${force}`);
    },
  };
}

const deps = (runner: ReturnType<typeof fakeRunner>) => ({
  plistPath,
  backupDir,
  runner,
  superviseArgv: MANAGED_ARGV,
});

describe("renderLaunchAgentPlist", () => {
  it("renders a fixed-label, argv-array plist and XML-escapes values", () => {
    const xml = renderLaunchAgentPlist({
      label: MANAGED_LABEL,
      programArguments: ["/bin/mega", "proxy", "supervise", "--store", "/a & b/<x>"],
    });
    expect(xml).toContain("<key>Label</key>");
    expect(xml).toContain(`<string>${MANAGED_LABEL}</string>`);
    expect(xml).toContain("<key>RunAtLoad</key>");
    expect(xml).toContain("<key>KeepAlive</key>");
    expect(xml).toContain("SuccessfulExit");
    expect(xml).toContain("/a &amp; b/&lt;x&gt;"); // escaped, no shell
    expect(xml).not.toContain("/a & b/<x>");
  });
});

describe("ensureManagedService", () => {
  it("a LOADED legacy job is refused (legacy_service_present) and never booted out", () => {
    const runner = fakeRunner({ [MANAGED_LABEL]: LEGACY_ARGV });
    const r = ensureManagedService(deps(runner));
    expect(r.status).toBe("legacy_service_present");
    if (r.status === "legacy_service_present") expect(r.instruction).toContain("bootout");
    expect(runner.calls).not.toContain(`bootout ${MANAGED_LABEL}`); // never stops what we didn't start
  });

  it("a LOADED managed job is idempotent (already_managed)", () => {
    const runner = fakeRunner({ [MANAGED_LABEL]: MANAGED_ARGV });
    expect(ensureManagedService(deps(runner)).status).toBe("already_managed");
  });

  it("a fresh install writes the managed plist and bootstraps", () => {
    const runner = fakeRunner();
    const r = ensureManagedService(deps(runner));
    expect(r.status).toBe("installed");
    expect(existsSync(plistPath)).toBe(true);
    expect(readFileSync(plistPath, "utf8")).toContain("supervise");
    expect(runner.calls.some((c) => c.startsWith("bootstrap"))).toBe(true);
  });

  it("an UNLOADED legacy plist file is backed up, then the managed plist is installed", () => {
    writeFileSync(
      plistPath,
      renderLaunchAgentPlist({ label: MANAGED_LABEL, programArguments: LEGACY_ARGV }),
    );
    const runner = fakeRunner();
    const r = ensureManagedService(deps(runner));
    expect(r.status).toBe("installed");
    // Legacy plist moved into the backup dir.
    expect(readdirSync(backupDir).length).toBeGreaterThan(0);
    expect(readFileSync(plistPath, "utf8")).toContain("supervise");
  });

  it("a foreign plist file (unknown argv) is refused without mutation", () => {
    writeFileSync(
      plistPath,
      renderLaunchAgentPlist({ label: MANAGED_LABEL, programArguments: ["/usr/bin/other", "run"] }),
    );
    const runner = fakeRunner();
    const r = ensureManagedService(deps(runner));
    expect(r.status).toBe("blocked");
    expect(runner.calls.length).toBe(0);
  });
});

describe("uninstallManagedService", () => {
  it("boots out and moves a dormant managed plist to backup", () => {
    writeFileSync(
      plistPath,
      renderLaunchAgentPlist({ label: MANAGED_LABEL, programArguments: MANAGED_ARGV }),
    );
    const runner = fakeRunner({ [MANAGED_LABEL]: MANAGED_ARGV });
    const r = uninstallManagedService(deps(runner));
    expect(r.status).toBe("uninstalled");
    expect(runner.calls).toContain(`bootout ${MANAGED_LABEL}`);
    expect(existsSync(plistPath)).toBe(false);
    expect(readdirSync(backupDir).length).toBeGreaterThan(0);
  });

  it("a foreign loaded job is not touched", () => {
    const runner = fakeRunner({ [MANAGED_LABEL]: ["/usr/bin/other", "run"] });
    const r = uninstallManagedService(deps(runner));
    expect(r.status).toBe("blocked");
    expect(runner.calls.length).toBe(0);
  });
});
