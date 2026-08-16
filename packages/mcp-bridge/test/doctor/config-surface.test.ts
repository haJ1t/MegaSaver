import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nonLocalhostOrigin, readConfigSurface } from "../../src/doctor/config-surface.js";

const CLAUDE_CONFIG = {
  mcpServers: {
    megasaver: { command: "mega", args: ["mcp", "serve"] },
    cloudfetch: {
      command: "npx",
      args: ["-y", "cloudfetch-mcp", "--endpoint", "https://api.cloudfetch.example/v1"],
      env: { CLOUDFETCH_TOKEN: "sk-live-9f3a" },
    },
    filetools: { url: "http://192.168.1.44:8931/sse" },
  },
};

describe("readConfigSurface", () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "mcp-doctor-cfg-"));
    const dir = join(home, ".config", "claude");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "mcp.json"), JSON.stringify(CLAUDE_CONFIG));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("reports all four agent paths, present only for claude-code", async () => {
    const result = await readConfigSurface({ home, platform: "linux" });
    expect(result.agents).toHaveLength(4);
    const claude = result.agents.find((a) => a.agentId === "claude-code");
    expect(claude?.present).toBe(true);
    expect(claude?.serverKeys.sort()).toEqual(["cloudfetch", "filetools", "megasaver"]);
    expect(result.agents.filter((a) => a.present)).toHaveLength(1);
  });

  it("flags non-localhost origins from url AND args, naming env keys not values", async () => {
    const result = await readConfigSurface({ home, platform: "linux" });
    const urls = result.findings.filter((f) => f.code === "non_localhost_url");
    expect(urls.map((f) => f.serverKey).sort()).toEqual(["cloudfetch", "filetools"]);
    for (const f of urls) expect(f.message).not.toContain("sk-live-9f3a");
    expect(urls.find((f) => f.serverKey === "filetools")?.message).toContain("http://192.168.1.44:8931");
  });

  it.skipIf(process.platform === "win32")("world-writable config is critical", async () => {
    chmodSync(join(home, ".config", "claude", "mcp.json"), 0o666);
    const result = await readConfigSurface({ home, platform: process.platform });
    const f = result.findings.find((x) => x.code === "config_world_writable");
    expect(f?.severity).toBe("critical");
    expect(f?.remediation).toContain("chmod 600");
  });

  it("malformed JSON degrades to config_unreadable, never throws", async () => {
    writeFileSync(join(home, ".config", "claude", "mcp.json"), "{not json");
    const result = await readConfigSurface({ home, platform: "linux" });
    expect(result.findings.some((f) => f.code === "config_unreadable")).toBe(true);
  });

  it("win32 reports permission evidence as unknown", async () => {
    const result = await readConfigSurface({ home, platform: "win32" });
    expect(result.findings.some((f) => f.code === "evidence_gap" && f.severity === "info")).toBe(true);
  });
});

describe("nonLocalhostOrigin", () => {
  it.each([
    ["http://localhost:3000/x", null],
    ["http://127.0.0.1:8080", null],
    ["http://0.0.0.0:8931", null],
    ["https://dev.localhost/api", null],
    ["not a url", null],
    ["file:///etc/passwd", null],
    ["https://api.cloudfetch.example/v1", "https://api.cloudfetch.example"],
    ["http://192.168.1.44:8931/sse", "http://192.168.1.44:8931"],
  ])("%s -> %s", (raw, expected) => {
    expect(nonLocalhostOrigin(raw)).toBe(expected);
  });
});
