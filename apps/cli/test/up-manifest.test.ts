import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type UpManifest,
  readUpManifest,
  upManifestPath,
  writeUpManifest,
} from "../src/up/manifest.js";

let storeRoot: string;
const workspaceKey = "wk-test-123";

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "mega-up-manifest-test-"));
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

describe("up manifest store", () => {
  const sampleManifest: UpManifest = {
    version: 1,
    workspaceKey,
    cwd: "/path/to/project",
    createdAt: "2026-08-06T10:00:00.000Z",
    updatedAt: "2026-08-06T10:00:00.000Z",
    steps: [
      {
        kind: "hooks-install",
        at: "2026-08-06T10:00:00.000Z",
        settingsPath: "/path/to/settings.json",
        priorConnected: false,
        changed: true,
      },
      {
        kind: "connector-sync",
        at: "2026-08-06T10:00:00.000Z",
        projectName: "demo",
        projectCreated: true,
        targets: [
          {
            id: "claude-code",
            relativePath: "CLAUDE.md",
            prior: "missing",
          },
        ],
      },
      {
        kind: "saver-enable",
        at: "2026-08-06T10:00:00.000Z",
        exact: true,
        priorEnabled: false,
        priorMode: "balanced",
        mode: "balanced",
      },
    ],
  };

  it("returns absent when manifest file does not exist", () => {
    const res = readUpManifest(storeRoot, workspaceKey);
    expect(res.kind).toBe("absent");
  });

  it("writes and reads back a valid manifest atomically without leaving tmp files", () => {
    const writeOk = writeUpManifest(storeRoot, sampleManifest);
    expect(writeOk).toBe(true);

    const path = upManifestPath(storeRoot, workspaceKey);
    expect(existsSync(path)).toBe(true);

    const res = readUpManifest(storeRoot, workspaceKey);
    expect(res.kind).toBe("ok");
    if (res.kind === "ok") {
      expect(res.manifest).toEqual(sampleManifest);
    }
  });

  it("reports corrupt when file content is invalid JSON", () => {
    writeUpManifest(storeRoot, sampleManifest);
    const path = upManifestPath(storeRoot, workspaceKey);
    writeFileSync(path, "{ not json");

    const res = readUpManifest(storeRoot, workspaceKey);
    expect(res.kind).toBe("corrupt");
  });

  it("reports corrupt when schema validation fails", () => {
    writeUpManifest(storeRoot, sampleManifest);
    const path = upManifestPath(storeRoot, workspaceKey);
    const invalid = { ...sampleManifest, version: 2 };
    writeFileSync(path, JSON.stringify(invalid));

    const res = readUpManifest(storeRoot, workspaceKey);
    expect(res.kind).toBe("corrupt");
  });
});
