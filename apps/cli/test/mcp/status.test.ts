import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMcpInstall } from "../../src/commands/mcp/install.js";
import { runMcpStatus } from "../../src/commands/mcp/status.js";

describe("runMcpStatus", () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "cli-mcp-status-"));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("emits one JSON row per agent carrying connectorSynced + restartRequired (F4)", async () => {
    await runMcpInstall({
      targetFlag: "claude-code",
      home,
      stdout: () => undefined,
      stderr: () => undefined,
      json: true,
    });
    const out: string[] = [];
    const code = await runMcpStatus({
      home,
      projectRoot: undefined,
      stdout: (l) => out.push(l),
      stderr: () => undefined,
      json: true,
    });
    expect(code).toBe(0);
    const rows = JSON.parse(out[0] ?? "[]") as Array<{
      agentId: string;
      mcpInstalled: boolean;
      connectorSynced: boolean;
      restartRequired: boolean;
    }>;
    expect(rows).toHaveLength(4);
    const claude = rows.find((r) => r.agentId === "claude-code");
    expect(claude).toMatchObject({
      mcpInstalled: true,
      connectorSynced: false, // no connector file in a bare temp home
      restartRequired: true,
    });
  });
});
