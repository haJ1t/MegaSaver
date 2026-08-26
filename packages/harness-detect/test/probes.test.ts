import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNodeProbes, resolveProjectMarkerPath } from "../src/probes.js";

describe("createNodeProbes — real filesystem adapters", () => {
  let home: string;
  let projectRoot: string;
  let binDir: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "megasaver-detect-home-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-detect-root-"));
    binDir = await mkdtemp(join(tmpdir(), "megasaver-detect-bin-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
    await rm(binDir, { recursive: true, force: true });
  });

  function probes(envPath: string, platform: NodeJS.Platform = "darwin") {
    return createNodeProbes({ home, projectRoot, platform, envPath });
  }

  describe("binaryExists — PATH lookup", () => {
    it("finds an executable file on the injected PATH", async () => {
      await writeFile(join(binDir, "claude"), "#!/bin/sh\n", { mode: 0o755 });
      expect(probes(`${binDir}:/nonexistent`).binaryExists("claude")).toBe(true);
    });

    it("reports false for a binary absent from every PATH entry", () => {
      expect(probes(`${binDir}:/nonexistent`).binaryExists("claude")).toBe(false);
    });

    it("does not treat a directory named like the binary as an executable", async () => {
      await mkdir(join(binDir, "goose"));
      expect(probes(`${binDir}:/nonexistent`).binaryExists("goose")).toBe(false);
    });

    it("win32: resolves through PATHEXT (.cmd/.exe/.bat)", async () => {
      await writeFile(join(binDir, "q.cmd"), "@echo off\n");
      const winProbes = probes(`${binDir}:/nonexistent`, "win32");
      expect(winProbes.binaryExists("q")).toBe(true);
      expect(winProbes.binaryExists("missing")).toBe(false);
    });

    it("darwin: does not PATHEXT-resolve (a bare q is not q.cmd)", async () => {
      await writeFile(join(binDir, "q.cmd"), "@echo off\n");
      expect(probes(`${binDir}:/nonexistent`).binaryExists("q")).toBe(false);
    });

    it("resolves across multiple PATH entries", async () => {
      const otherBin = await mkdtemp(join(tmpdir(), "megasaver-detect-bin2-"));
      try {
        await writeFile(join(otherBin, "gemini"), "#!/bin/sh\n", { mode: 0o755 });
        expect(probes(join(binDir, `:${otherBin}`)).binaryExists("gemini")).toBe(true);
      } finally {
        await rm(otherBin, { recursive: true, force: true });
      }
    });
  });

  describe("homePathExists — home-relative dirs", () => {
    it("resolves ~/.cursor under the injected home", async () => {
      await mkdir(join(home, ".cursor"), { recursive: true });
      expect(probes("").homePathExists("~/.cursor")).toBe(true);
      expect(probes("").homePathExists("~/.codex")).toBe(false);
    });

    it("resolves nested paths (~/.config/goose)", async () => {
      await mkdir(join(home, ".config", "goose"), { recursive: true });
      expect(probes("").homePathExists("~/.config/goose")).toBe(true);
    });

    it("rejects non-home-relative paths (must start with ~/)", () => {
      expect(probes("").homePathExists("/etc")).toBe(false);
      expect(probes("").homePathExists(".cursor")).toBe(false);
    });
  });

  describe("extensionDirExists — versioned extension prefix scan", () => {
    it("matches saoudrizwan.claude-dev-1.2.3 by prefix", async () => {
      const extRoot = join(home, ".vscode", "extensions");
      await mkdir(join(extRoot, "saoudrizwan.claude-dev-1.2.3"), { recursive: true });
      expect(probes("").extensionDirExists("~/.vscode/extensions", "saoudrizwan.claude-dev")).toBe(
        true,
      );
      expect(probes("").extensionDirExists("~/.vscode/extensions", "kilocode.kilo-code")).toBe(
        false,
      );
    });

    it("does not match when only an unrelated extension exists", async () => {
      const extRoot = join(home, ".vscode", "extensions");
      await mkdir(join(extRoot, "github.copilot-1.0.0"), { recursive: true });
      expect(probes("").extensionDirExists("~/.vscode/extensions", "saoudrizwan.claude-dev")).toBe(
        false,
      );
    });
  });

  describe("projectMarkerExists — project-root-relative markers", () => {
    it("resolves AGENTS.md and nested .cursor/rules under the project root", async () => {
      await writeFile(join(projectRoot, "AGENTS.md"), "# agents\n");
      await mkdir(join(projectRoot, ".cursor", "rules"), { recursive: true });
      const p = probes("");
      expect(p.projectMarkerExists("AGENTS.md")).toBe(true);
      expect(p.projectMarkerExists(".cursor/rules")).toBe(true);
      expect(p.projectMarkerExists(".windsurfrules")).toBe(false);
    });

    it("refuses path escapes (never probes outside the project root)", () => {
      expect(probes("").projectMarkerExists("../outside.txt")).toBe(false);
      expect(probes("").projectMarkerExists("/etc/passwd")).toBe(false);
    });

    it("does not confuse the root with a sibling directory sharing its prefix", () => {
      // rootWithSep must include the separator: projectRoot "/a/b" must NOT
      // claim to own resolved paths under "/a/bc/" (bare-prefix startsWith bug).
      const p = probes("");
      expect(p.projectMarkerExists("../bc/x")).toBe(false);
      expect(p.projectMarkerExists("nested/../AGENTS.md")).toBe(false);
    });
  });

  describe("resolveProjectMarkerPath — platform boundary contract (win32)", () => {
    it("resolves with backslashes under a win32 root", () => {
      expect(resolveProjectMarkerPath("C:\\repo", "AGENTS.md", "win32")).toBe(
        "C:\\repo\\AGENTS.md",
      );
      expect(resolveProjectMarkerPath("C:\\repo", ".cursor/rules", "win32")).toBe(
        "C:\\repo\\.cursor\\rules",
      );
    });

    it("refuses win32 absolute paths, backslash escapes, and drive switches", () => {
      expect(resolveProjectMarkerPath("C:\\repo", "D:\\other\\file", "win32")).toBeNull();
      expect(resolveProjectMarkerPath("C:\\repo", "..\\outside.txt", "win32")).toBeNull();
      expect(resolveProjectMarkerPath("C:\\repo", "C:\\repo2\\x.md", "win32")).toBeNull();
      expect(resolveProjectMarkerPath("C:\\repo", "\\\\unc\\share", "win32")).toBeNull();
    });

    it("win32 sibling-prefix confusion is refused (C:\\repo vs C:\\repo-sibling)", () => {
      expect(resolveProjectMarkerPath("C:\\repo", "..\\repo-sibling\\x.md", "win32")).toBeNull();
    });

    it("posix roots still resolve forward-slash markers", () => {
      expect(resolveProjectMarkerPath("/home/u/repo", "AGENTS.md", "linux")).toBe(
        "/home/u/repo/AGENTS.md",
      );
      expect(resolveProjectMarkerPath("/home/u/repo", "../outside", "linux")).toBeNull();
      expect(resolveProjectMarkerPath("/home/u/repo", "/etc/passwd", "linux")).toBeNull();
    });
  });
});
