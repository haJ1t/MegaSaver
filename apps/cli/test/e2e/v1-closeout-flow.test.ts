// Excluded from per-package typecheck (apps/cli/tsconfig.test.json) because this
// e2e deliberately imports another package's SOURCE (../../../../apps/gui/bridge/*),
// which falls outside the CLI's rootDir. vitest still runs it at runtime.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJsonDirectoryCoreRegistry } from "@megasaver/core";
import { DEFAULT_MCP_ARGS, DEFAULT_MCP_COMMAND } from "@megasaver/mcp-bridge";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBridgeHandler } from "../../../../apps/gui/bridge/handler.js";
import { createMcpOps } from "../../../../apps/gui/bridge/mcp-ops.js";

// Real built binary (Task 1 Step 1 builds it). The e2e shells the actual
// `mega` CLI so the flow is proven end-to-end, not via in-process units.
const CLI = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));

function mega(args: string[], store: string): { stdout: string } {
  // Hermetic env: pin HOME/XDG to the temp store so neither the JSON store
  // nor any MCP-config install touches a real ~/.config / ~/.local.
  const stdout = execFileSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, HOME: store, XDG_DATA_HOME: store, NODE_ENV: "production" },
  });
  return { stdout };
}

// Recursively collect every file under a directory (the store layout nests
// content/stats by projectId/sessionId; the e2e does not hard-code those ids).
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

describe("v1.0 closeout end-to-end flow (plan L1672-L1702)", () => {
  let store: string;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    // Single throwaway store, shared by every CLI leg (--store) and the
    // in-process GUI bridge. `--store <abs>` resolves AS-IS (apps/cli/src/
    // store.ts), so the on-disk layout is <store>/{content,stats,...}.
    store = mkdtempSync(join(tmpdir(), "ms-e2e-"));
    const registry = createJsonDirectoryCoreRegistry({ rootDir: store });
    // Production GUI wiring: storePath feeds the token-saver /stats route,
    // and a real McpSetupOps (home pinned to the temp store) backs the
    // AgentSetupDoctor /api/mcp/* routes. command/args mirror server.ts.
    const mcpOps = createMcpOps({
      registry,
      home: store,
      command: DEFAULT_MCP_COMMAND,
      args: [...DEFAULT_MCP_ARGS],
    });
    const handler = createBridgeHandler({ registry, storePath: store, mcpOps });
    server = createServer(handler);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(store, { recursive: true, force: true });
  });

  it("[A1+A2] seeds a project+session, enables Balanced, persists tokenSaver", () => {
    // Plan 1-3: create project + session. projectName is POSITIONAL. --root
    // pins the connector-write root inside the temp store (hermetic [A7]).
    mega(["project", "create", "demo", "--store", store, "--root", store], store);
    const created = JSON.parse(
      mega(
        [
          "session",
          "create",
          "demo",
          "--agent",
          "claude-code",
          "--title",
          "first session",
          "--store",
          store,
          "--json",
        ],
        store,
      ).stdout,
    ) as { id: string; tokenSaver?: unknown };
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.tokenSaver).toBeUndefined(); // pre-enable

    // Plan 4-5: enable Mega Saver Mode -> Balanced.
    const enabled = JSON.parse(
      mega(
        [
          "session",
          "saver",
          "enable",
          created.id,
          "--mode",
          "balanced",
          "--store",
          store,
          "--json",
        ],
        store,
      ).stdout,
    ) as {
      sessionId: string;
      tokenSaver: { enabled: boolean; mode: string; maxReturnedBytes: number };
    };
    expect(enabled.tokenSaver.enabled).toBe(true);
    expect(enabled.tokenSaver.mode).toBe("balanced");
    expect(enabled.tokenSaver.maxReturnedBytes).toBe(12_000); // modeToBudget("balanced"), AA1 §4a
  });

  it("[A3+A5] output exec spawns a gated child, returns savingRatio, writes chunkSet + stats", () => {
    const sid = JSON.parse(
      mega(
        [
          "session",
          "create",
          "demo",
          "--agent",
          "claude-code",
          "--title",
          "exec session",
          "--store",
          store,
          "--json",
        ],
        store,
      ).stdout,
    ).id as string;
    mega(
      ["session", "saver", "enable", sid, "--mode", "balanced", "--store", store, "--json"],
      store,
    );

    // Plan 8-9: agent action (CLI twin of mega_run_command; AA1 §8d same
    // orchestrator). `node` is an ALLOWED_COMMAND (AA1 §9b); the policy does
    // an EXACT-STRING membership check (allowed-commands.ts: no path/basename
    // normalisation), so the command MUST be the literal "node", not
    // process.execPath. `-e` emits stdout+stderr (combined-capture path).
    const out = JSON.parse(
      mega(
        [
          "output",
          "exec",
          sid,
          "--intent",
          "auth failures",
          "--store",
          store,
          "--json",
          "--",
          "node",
          "-e",
          "console.error('FAIL auth.test'); console.log('ok')",
        ],
        store,
      ).stdout,
    ) as {
      sessionId: string;
      result: {
        rawBytes: number;
        returnedBytes: number;
        bytesSaved: number;
        savingRatio: number;
        chunkSetId?: string;
      };
    };

    expect(out.result.rawBytes).toBeGreaterThan(0);
    expect(out.result.returnedBytes).toBeGreaterThan(0);
    expect(out.result.bytesSaved).toBeGreaterThanOrEqual(0);
    expect(typeof out.result.savingRatio).toBe("number");
    expect(out.result.savingRatio).toBeGreaterThanOrEqual(0);
    expect(out.result.savingRatio).toBeLessThanOrEqual(1);
    expect(out.result.chunkSetId).toBeTruthy();

    // Plan 9: raw chunkSet persisted (AA1 §10a path = <store>/content/...).
    const chunkFiles = walk(join(store, "content"));
    const chunkFile = chunkFiles.find((f) => f.endsWith(`${out.result.chunkSetId}.json`));
    expect(chunkFile).toBeTruthy();
    const chunkSet = JSON.parse(readFileSync(chunkFile as string, "utf8")) as {
      chunkSetId: string;
      chunks: unknown[];
    };
    expect(chunkSet.chunkSetId).toBe(out.result.chunkSetId);
    expect(Array.isArray(chunkSet.chunks)).toBe(true);

    // Plan 9: stats event persisted (AA1 §13b paths = <store>/stats/...).
    const statsFiles = walk(join(store, "stats"));
    const summaryFile = statsFiles.find((f) => f.endsWith(`${sid}.json`));
    const eventsFile = statsFiles.find((f) => f.endsWith(`${sid}.events.jsonl`));
    expect(summaryFile).toBeTruthy();
    expect(eventsFile).toBeTruthy();
    const summary = JSON.parse(readFileSync(summaryFile as string, "utf8")) as {
      eventsTotal: number;
    };
    expect(summary.eventsTotal).toBeGreaterThanOrEqual(1);
    expect(
      readFileSync(eventsFile as string, "utf8")
        .trim()
        .split("\n").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("[A4+A7] mcp repair installs config + sync writes the CONTEXT_GATE connector block", () => {
    // Plan 6: install/repair MCP, sync connector. `mega mcp repair` requires
    // --project (it does install + connector sync for that agent, AA1 §5c).
    mega(
      ["mcp", "repair", "--target", "claude-code", "--project", "demo", "--store", store, "--json"],
      store,
    );

    // CLI `mega mcp status --json` is a bare array of McpAgentStatus, keyed by
    // `agentId`. It reports the install bit (project-agnostic). The CLI command
    // hard-codes projectRoot=undefined, so its connectorSynced is always false;
    // the connectorSynced=true proof lives on the GUI doctor leg below
    // (AA1 §7 DoD maps connectorSynced to the /api/mcp/* doctor leg).
    const status = JSON.parse(
      mega(["mcp", "status", "--store", store, "--json"], store).stdout,
    ) as Array<{
      agentId: string;
      mcpInstalled: boolean;
      connectorSynced: boolean;
    }>;
    const cc = status.find((s) => s.agentId === "claude-code");
    expect(cc?.mcpInstalled).toBe(true);

    // AA1 §7: the CONTEXT_GATE block coexists with the legacy block. The
    // connector writes into the project root CLAUDE.md; --root pinned that
    // root to the temp store. Enable a session first so the CG block renders
    // (it is emitted ONLY for a tokenSaver-enabled session).
    const sid = JSON.parse(
      mega(
        [
          "session",
          "create",
          "demo",
          "--agent",
          "claude-code",
          "--title",
          "cg session",
          "--store",
          store,
          "--json",
        ],
        store,
      ).stdout,
    ).id as string;
    mega(
      ["session", "saver", "enable", sid, "--mode", "balanced", "--store", store, "--json"],
      store,
    );
    // `connector sync` takes the project name as a POSITIONAL (not --project);
    // --target seeds the named target's file when absent (AA1 §7).
    mega(["connector", "sync", "demo", "--target", "claude-code", "--store", store], store);

    // The synced file path is reported by `connector status --json`
    // (relativePath, relative to the project root = the temp store).
    const conn = JSON.parse(
      mega(
        ["connector", "status", "demo", "--target", "claude-code", "--store", store, "--json"],
        store,
      ).stdout,
    ) as Array<{ relativePath: string }>;
    const rel = (conn[0] as { relativePath: string }).relativePath;
    const body = readFileSync(join(store, rel), "utf8");
    expect(body).toContain("<!-- MEGA SAVER:BEGIN -->"); // legacy still present
    expect(body).toContain("<!-- MEGA SAVER:CONTEXT_GATE BEGIN -->"); // additive CG block
    expect(body).toContain("proxy_run_command"); // block instructs the agent, proxy default naming (AA1 §7)
    const cgStart = body.indexOf("<!-- MEGA SAVER:CONTEXT_GATE BEGIN -->");
    const cgEnd = body.indexOf("<!-- MEGA SAVER:CONTEXT_GATE END -->");
    expect(cgEnd - cgStart).toBeGreaterThan(0); // block bytes > 0
  });

  it("[A6] GUI bridge serves token-saver status + stats for the enabled session", async () => {
    const sid = JSON.parse(
      mega(
        [
          "session",
          "create",
          "demo",
          "--agent",
          "claude-code",
          "--title",
          "gui session",
          "--store",
          store,
          "--json",
        ],
        store,
      ).stdout,
    ).id as string;
    mega(
      ["session", "saver", "enable", sid, "--mode", "balanced", "--store", store, "--json"],
      store,
    );
    mega(
      [
        "output",
        "exec",
        sid,
        "--intent",
        "x",
        "--store",
        store,
        "--json",
        "--",
        "node",
        "-e",
        "console.log('hello world '.repeat(50))",
      ],
      store,
    );

    // BB10 route shape: GET /token-saver/status -> { enabled, settings }.
    const statusRes = await fetch(`${baseUrl}/api/sessions/${sid}/token-saver/status`);
    expect(statusRes.status).toBe(200);
    const status = (await statusRes.json()) as {
      enabled: boolean;
      settings: { mode: string } | null;
    };
    expect(status.enabled).toBe(true);
    expect(status.settings?.mode).toBe("balanced");

    // GET /token-saver/stats -> SessionTokenSaverStats (savingRatio ∈ [0,1]).
    const statsRes = await fetch(`${baseUrl}/api/sessions/${sid}/token-saver/stats`);
    expect(statsRes.status).toBe(200);
    const stats = (await statsRes.json()) as {
      savingRatio: number;
      rawBytesTotal: number;
      returnedBytesTotal: number;
    };
    expect(typeof stats.savingRatio).toBe("number");
    expect(stats.savingRatio).toBeGreaterThanOrEqual(0);
    expect(stats.savingRatio).toBeLessThanOrEqual(1);
    expect(stats.rawBytesTotal).toBeGreaterThan(0);
    expect(stats.returnedBytesTotal).toBeGreaterThan(0);
  });

  it("[A4+A6] GUI AgentSetupDoctor drives /api/mcp/* end-to-end (BB8-backed ops)", async () => {
    // AA1 §1 [A4]/[A6]: the GUI doctor half. createMcpOps(...) is wired into
    // the bridge handler (beforeAll), so /api/mcp/* runs real install/repair/
    // status ops against the temp HOME. GET status: per-agent flags present
    // and well-typed (AA1 §5c, §6c). Agents are keyed by `agentId`.
    const statusRes = await fetch(`${baseUrl}/api/mcp/status`);
    expect(statusRes.status).toBe(200);
    const doctor = (await statusRes.json()) as {
      agents: Array<{
        agentId: string;
        mcpInstalled: boolean;
        connectorSynced: boolean;
        restartRequired: boolean;
        restartHint: string;
      }>;
    };
    expect(Array.isArray(doctor.agents)).toBe(true);
    expect(doctor.agents.length).toBeGreaterThan(0);
    const ccBefore = doctor.agents.find((a) => a.agentId === "claude-code");
    expect(ccBefore).toBeDefined();
    expect(typeof (ccBefore as { mcpInstalled: boolean }).mcpInstalled).toBe("boolean");
    expect(typeof (ccBefore as { connectorSynced: boolean }).connectorSynced).toBe("boolean");
    expect(typeof (ccBefore as { restartRequired: boolean }).restartRequired).toBe("boolean");
    expect(typeof (ccBefore as { restartHint: string }).restartHint).toBe("string");

    // Repair a previously-missing agent for a real before->after transition.
    // `codex` (AGENTS.md) was never installed by the CLI legs (those targeted
    // claude-code). The GUI connectorSynced resolver resolves the project via
    // the agent's latest OPEN session (createMcpOps -> resolveProjectRoot), so
    // the codex agent needs an open, saver-enabled session in `demo` for the
    // post-repair connectorSynced flag to reflect the freshly-written block.
    const target = "codex";
    const codexBefore = doctor.agents.find((a) => a.agentId === target);
    expect(codexBefore).toBeDefined();
    expect((codexBefore as { mcpInstalled: boolean }).mcpInstalled).toBe(false);

    const csid = JSON.parse(
      mega(
        [
          "session",
          "create",
          "demo",
          "--agent",
          "codex",
          "--title",
          "codex session",
          "--store",
          store,
          "--json",
        ],
        store,
      ).stdout,
    ).id as string;
    mega(
      ["session", "saver", "enable", csid, "--mode", "balanced", "--store", store, "--json"],
      store,
    );

    // POST repair: install MCP config + sync the connector block for that
    // agent. The repair body requires { target, project } (MEGA_MCP_TARGET_BODY).
    const repairRes = await fetch(`${baseUrl}/api/mcp/repair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, project: "demo" }),
    });
    expect(repairRes.status).toBe(200);

    // GET status again: the repaired agent's flags MUST flip to true (AA1 §5c).
    const afterRes = await fetch(`${baseUrl}/api/mcp/status`);
    expect(afterRes.status).toBe(200);
    const afterDoctor = (await afterRes.json()) as {
      agents: Array<{ agentId: string; mcpInstalled: boolean; connectorSynced: boolean }>;
    };
    const repaired = afterDoctor.agents.find((a) => a.agentId === target);
    expect(repaired).toBeDefined();
    expect((repaired as { mcpInstalled: boolean }).mcpInstalled).toBe(true);
    expect((repaired as { connectorSynced: boolean }).connectorSynced).toBe(true);
  });
});
