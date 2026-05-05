import { describe, expect, it } from "vitest";
import {
  type Check,
  checkCwd,
  checkNode,
  checkPlatform,
  exitCodeFor,
  renderReport,
  runChecks,
} from "../src/commands/doctor.js";

describe("checkNode", () => {
  it("PASSes for Node 22.x", () => {
    expect(checkNode("22.11.0")).toEqual({
      key: "node",
      value: "v22.11.0",
      pass: true,
    });
  });

  it("PASSes for Node 23.x", () => {
    expect(checkNode("23.0.0")).toEqual({
      key: "node",
      value: "v23.0.0",
      pass: true,
    });
  });

  it("PASSes for the lower bound 22.0.0", () => {
    expect(checkNode("22.0.0")).toEqual({
      key: "node",
      value: "v22.0.0",
      pass: true,
    });
  });

  it("PASSes for a 22.x pre-release", () => {
    expect(checkNode("22.0.0-rc.1")).toEqual({
      key: "node",
      value: "v22.0.0-rc.1",
      pass: true,
    });
  });

  it("FAILs for Node 20.x with reason", () => {
    expect(checkNode("20.10.0")).toEqual({
      key: "node",
      value: "v20.10.0",
      pass: false,
      reason: "need ≥22",
    });
  });

  it("FAILs for Node 18.x", () => {
    expect(checkNode("18.20.0")).toEqual({
      key: "node",
      value: "v18.20.0",
      pass: false,
      reason: "need ≥22",
    });
  });
});

describe("checkPlatform", () => {
  it("PASSes and returns the platform string", () => {
    expect(checkPlatform("darwin")).toEqual({
      key: "platform",
      value: "darwin",
      pass: true,
    });
  });

  it("PASSes for linux", () => {
    expect(checkPlatform("linux")).toEqual({
      key: "platform",
      value: "linux",
      pass: true,
    });
  });
});

describe("checkCwd", () => {
  it("PASSes and returns the cwd string", () => {
    expect(checkCwd("/foo/bar")).toEqual({
      key: "cwd",
      value: "/foo/bar",
      pass: true,
    });
  });
});

describe("runChecks", () => {
  it("returns three checks in fixed order on the current process", () => {
    const checks = runChecks();
    expect(checks).toHaveLength(3);
    expect(checks[0]?.key).toBe("node");
    expect(checks[1]?.key).toBe("platform");
    expect(checks[2]?.key).toBe("cwd");
  });
});

describe("renderReport", () => {
  it("formats an all-PASS report with summary", () => {
    const checks: Check[] = [
      { key: "node", value: "v22.11.0", pass: true },
      { key: "platform", value: "darwin", pass: true },
      { key: "cwd", value: "/foo", pass: true },
    ];
    expect(renderReport(checks)).toBe(
      "node v22.11.0 PASS\nplatform darwin PASS\ncwd /foo PASS\n\n3 PASS / 0 FAIL",
    );
  });

  it("includes the parenthesized reason for FAIL rows", () => {
    const checks: Check[] = [
      { key: "node", value: "v20.10.0", pass: false, reason: "need ≥22" },
      { key: "platform", value: "darwin", pass: true },
      { key: "cwd", value: "/foo", pass: true },
    ];
    expect(renderReport(checks)).toBe(
      "node v20.10.0 FAIL (need ≥22)\nplatform darwin PASS\ncwd /foo PASS\n\n2 PASS / 1 FAIL",
    );
  });
});

describe("exitCodeFor", () => {
  it("returns 0 when all checks PASS", () => {
    const checks: Check[] = [
      { key: "node", value: "v22.11.0", pass: true },
      { key: "platform", value: "darwin", pass: true },
      { key: "cwd", value: "/foo", pass: true },
    ];
    expect(exitCodeFor(checks)).toBe(0);
  });

  it("returns 1 when any check FAILs", () => {
    const checks: Check[] = [
      { key: "node", value: "v20.10.0", pass: false, reason: "need ≥22" },
      { key: "platform", value: "darwin", pass: true },
      { key: "cwd", value: "/foo", pass: true },
    ];
    expect(exitCodeFor(checks)).toBe(1);
  });
});
