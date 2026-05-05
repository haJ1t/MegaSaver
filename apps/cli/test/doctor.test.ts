import { describe, expect, it } from "vitest";
import { checkCwd, checkNode, checkPlatform } from "../src/commands/doctor.js";

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
