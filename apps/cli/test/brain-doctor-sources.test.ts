import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configPath,
  deriveBrainId,
  generateKey,
  keyfilePath,
  saveConfig,
  saveKeyfile,
} from "@megasaver/brain-sync";
import type { ClaudeCodeHookStatus } from "@megasaver/connector-claude-code";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildHookCoverageFindings,
  buildSyncFreshnessFindings,
} from "../src/commands/brain/doctor-sources.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "brain-doctor-src-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const allOn: ClaudeCodeHookStatus = {
  connected: true,
  preInstalled: true,
  postInstalled: true,
  intentInstalled: true,
  warmupInstalled: true,
  guardInstalled: true,
  cacheAdviceInstalled: true,
  meshHintInstalled: false,
  execRewriteInstalled: false,
};

describe("doctor sources", () => {
  it("not connected -> warn with mega hooks install repair", () => {
    const f = buildHookCoverageFindings(
      { ...allOn, connected: false, postInstalled: false },
      "/tmp/s.json",
    );
    const warn = f.find((x) => x.severity === "warn");
    expect(warn?.check).toBe("hook-coverage");
    expect(warn?.evidence.files).toEqual(["/tmp/s.json"]);
    expect(warn?.repair).toBe("mega hooks install claude-code");
  });

  it("connected with optional hooks missing -> info per missing hook, none when all on", () => {
    expect(buildHookCoverageFindings(allOn, "/tmp/s.json")).toEqual([]);
    const f = buildHookCoverageFindings({ ...allOn, guardInstalled: false }, "/tmp/s.json");
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe("info");
  });

  it("sync: missing config -> info not-configured with init repair", () => {
    const f = buildSyncFreshnessFindings({ storeRoot: root, projectName: "demo" });
    expect(f[0]?.check).toBe("sync-freshness");
    expect(f[0]?.severity).toBe("info");
    expect(f[0]?.repair).toBe("mega brain sync init demo");
  });

  it("sync: configured but never synced -> warn with push repair", () => {
    const key = generateKey();
    saveKeyfile(keyfilePath(root), key);
    saveConfig(root, {
      schemaVersion: 1,
      endpoint: "https://s3.example.com",
      bucket: "b",
      prefix: "p/",
      region: "auto",
      pathStyle: true,
      conditionalWritesVerified: true,
      lastSeen: {},
    });
    const f = buildSyncFreshnessFindings({ storeRoot: root, projectName: "demo" });
    expect(f[0]?.severity).toBe("warn");
    expect(f[0]?.repair).toBe("mega brain sync push demo");
  });

  it("sync: synced -> info reporting the local lastSeen generation", () => {
    const key = generateKey();
    saveKeyfile(keyfilePath(root), key);
    const baseConfig = {
      schemaVersion: 1 as const,
      endpoint: "https://s3.example.com",
      bucket: "b",
      prefix: "p/",
      region: "auto" as const,
      pathStyle: true as const,
      conditionalWritesVerified: true as const,
      lastSeen: { [deriveBrainId(key, "demo")]: 7 } as Record<string, number>,
    };
    saveConfig(root, baseConfig);
    const f = buildSyncFreshnessFindings({ storeRoot: root, projectName: "demo" });
    expect(f[0]?.message).toContain("generation 7");
    expect(f[0]?.repair).toBe("mega brain sync status demo");
  });
});
