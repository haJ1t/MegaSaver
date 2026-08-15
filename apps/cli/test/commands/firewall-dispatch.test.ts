import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mainCommand } from "../../src/main.js";

const roots: string[] = [];
let store: string;

beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "megasaver-fw-dispatch-"));
  roots.push(store);
});
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// Architect B1: nothing previously exercised the citty dispatch layer — every
// firewall test called runFirewall directly, so the shipped `subCommands:
// { airlock }` defect (`--days 7` → E_UNKNOWN_COMMAND) went unnoticed.
describe("firewall positional dispatch (citty layer)", () => {
  it("--days 7 reaches the audit body, NOT E_UNKNOWN_COMMAND", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await runCommand(mainCommand, {
      rawArgs: ["firewall", "--days", "7", "--store", store],
    });
    const logs = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    const errs = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(errs).not.toContain("E_UNKNOWN_COMMAND");
    // Free tier: the audit upsell path (the store has no Pro license).
    expect(logs).toContain("Mega Saver Pro");
  });

  it("status verb reaches the status report", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await runCommand(mainCommand, {
      rawArgs: ["firewall", "status", "--store", store],
    });
    const logs = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logs).toContain("cache: none");
    expect(logs).not.toContain("Mega Saver Pro");
  });

  it("airlock verb keeps working through the same dispatch", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await runCommand(mainCommand, {
      rawArgs: ["firewall", "airlock", "list", "--store", store, "--session", "s-1"],
    });
    const logs = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logs).toContain("no airlock rules");
  });

  it("an unknown verb falls through to the audit body (not a crash)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await runCommand(mainCommand, {
      rawArgs: ["firewall", "bogus-verb", "--store", store],
    });
    const logs = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logs).toContain("Mega Saver Pro");
  });
});
