import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { type RunInitDeps, confirmYesNo, runInit } from "../../src/commands/init.js";

type Overrides = {
  mode?: "safe" | "balanced" | "aggressive";
  yes?: boolean;
  openGui?: boolean;
  isTTY?: boolean;
  prompt?: () => Promise<boolean>;
  hooksInstall?: RunInitDeps["hooksInstall"];
  mcpInstall?: RunInitDeps["mcpInstall"];
  saverEnable?: RunInitDeps["saverEnable"];
  gui?: RunInitDeps["gui"];
};

function harness(overrides: Overrides = {}) {
  const lines: string[] = [];
  const hooksInstall = overrides.hooksInstall ?? vi.fn(async () => 0 as const);
  const mcpInstall = overrides.mcpInstall ?? vi.fn(async () => 0 as const);
  const saverEnable = overrides.saverEnable ?? vi.fn(async () => 0 as const);
  const gui = overrides.gui ?? vi.fn(async () => undefined);
  const prompt = overrides.prompt ?? vi.fn(async () => true);
  const deps: RunInitDeps = {
    hooksInstall,
    mcpInstall,
    saverEnable,
    gui,
    prompt,
    stdout: (line: string) => lines.push(line),
    isTTY: overrides.isTTY ?? false,
  };
  return {
    lines,
    deps,
    hooksInstall,
    mcpInstall,
    saverEnable,
    gui,
    prompt,
    run: () =>
      runInit({
        mode: overrides.mode ?? "balanced",
        yes: overrides.yes ?? false,
        openGui: overrides.openGui ?? true,
        deps,
      }),
  };
}

describe("mega init — runInit", () => {
  it("happy path (yes) runs hooks + mcp(claude-code) + saver(balanced) + gui, resolves 0", async () => {
    const h = harness({ yes: true });
    const code = await h.run();
    expect(code).toBe(0);
    expect(h.hooksInstall).toHaveBeenCalledTimes(1);
    expect(h.mcpInstall).toHaveBeenCalledTimes(1);
    expect(h.saverEnable).toHaveBeenCalledTimes(1);
    expect(h.gui).toHaveBeenCalledTimes(1);
    const summary = h.lines.join("\n");
    expect(summary).toContain("hooks");
    expect(summary).toContain("mcp");
    expect(summary).toContain("claude-code");
    expect(summary).toContain("saver");
    expect(summary).toContain("balanced");
  });

  it("passes the mode to saverEnable (aggressive)", async () => {
    const h = harness({ yes: true, mode: "aggressive" });
    await h.run();
    expect(h.saverEnable).toHaveBeenCalledWith("aggressive");
    expect(h.lines.join("\n")).toContain("aggressive");
  });

  it("openGui:false does not call gui and still resolves 0", async () => {
    const h = harness({ yes: true, openGui: false });
    const code = await h.run();
    expect(code).toBe(0);
    expect(h.gui).not.toHaveBeenCalled();
  });

  it("a failing step does not abort the rest; resolves 1 and marks it failed", async () => {
    const mcpInstall = vi.fn(async () => 1 as const);
    const h = harness({ yes: true, mcpInstall });
    const code = await h.run();
    expect(code).toBe(1);
    // continue-and-report: hooks + saver still ran after mcp failed
    expect(h.hooksInstall).toHaveBeenCalledTimes(1);
    expect(mcpInstall).toHaveBeenCalledTimes(1);
    expect(h.saverEnable).toHaveBeenCalledTimes(1);
    const summary = h.lines.join("\n");
    // the failed step is marked with ✗, the others with ✓
    expect(summary).toMatch(/✗.*mcp/);
    expect(summary).toMatch(/✓.*hooks/);
  });

  it("gui still runs after a failed step (summary printed before the blocking handoff)", async () => {
    const hooksInstall = vi.fn(async () => 1 as const);
    const h = harness({ yes: true, hooksInstall });
    const code = await h.run();
    expect(code).toBe(1);
    expect(h.gui).toHaveBeenCalledTimes(1);
  });

  it("a THROWING step is treated like a failure: rest still run, summary marks it ✗, resolves 1", async () => {
    const mcpInstall = vi.fn(async () => {
      throw new Error("EACCES: permission denied");
    });
    const h = harness({ yes: true, mcpInstall });
    // runInit must resolve 1, not reject
    const code = await h.run();
    expect(code).toBe(1);
    // continue-and-report: hooks + saver still ran after mcp threw
    expect(h.hooksInstall).toHaveBeenCalledTimes(1);
    expect(mcpInstall).toHaveBeenCalledTimes(1);
    expect(h.saverEnable).toHaveBeenCalledTimes(1);
    const summary = h.lines.join("\n");
    // the throwing step is marked with ✗, the others with ✓
    expect(summary).toMatch(/✗.*mcp/);
    expect(summary).toMatch(/✓.*hooks/);
    expect(summary).toMatch(/✓.*saver/);
    // the summary was still printed even though a step threw
    expect(summary).toContain("Summary:");
  });

  it("interactive + declined prompt runs nothing and resolves 0", async () => {
    const prompt = vi.fn(async () => false);
    const h = harness({ isTTY: true, yes: false, prompt });
    const code = await h.run();
    expect(code).toBe(0);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(h.hooksInstall).not.toHaveBeenCalled();
    expect(h.mcpInstall).not.toHaveBeenCalled();
    expect(h.saverEnable).not.toHaveBeenCalled();
    expect(h.gui).not.toHaveBeenCalled();
  });

  it("interactive + accepted prompt runs every step", async () => {
    const prompt = vi.fn(async () => true);
    const h = harness({ isTTY: true, yes: false, prompt });
    const code = await h.run();
    expect(code).toBe(0);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(h.hooksInstall).toHaveBeenCalledTimes(1);
  });

  it("yes:true never calls the prompt", async () => {
    const prompt = vi.fn(async () => true);
    const h = harness({ isTTY: true, yes: true, prompt });
    await h.run();
    expect(prompt).not.toHaveBeenCalled();
  });

  it("non-TTY never calls the prompt (CI-safe)", async () => {
    const prompt = vi.fn(async () => true);
    const h = harness({ isTTY: false, yes: false, prompt });
    await h.run();
    expect(prompt).not.toHaveBeenCalled();
    expect(h.hooksInstall).toHaveBeenCalledTimes(1);
  });

  it("prints the 4-line plan before running (plan lists all four steps)", async () => {
    const h = harness({ yes: true });
    await h.run();
    const out = h.lines.join("\n");
    expect(out).toContain("hooks");
    expect(out).toContain("mcp");
    expect(out).toContain("saver");
    expect(out).toContain("gui");
  });
});

describe("mega init — confirmYesNo", () => {
  it("resolves false (declined) on EOF: stdin ends with no data, no hang", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const answered = confirmYesNo("Proceed? [y/N] ", { input, output });
    // simulate EOF / closed stdin: end the stream with no data written
    input.end();
    await expect(answered).resolves.toBe(false);
  });

  it("resolves true when the user types 'y'", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const answered = confirmYesNo("Proceed? [y/N] ", { input, output });
    input.write("y\n");
    await expect(answered).resolves.toBe(true);
  });

  it("resolves false when the user types 'n'", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const answered = confirmYesNo("Proceed? [y/N] ", { input, output });
    input.write("n\n");
    await expect(answered).resolves.toBe(false);
  });
});
