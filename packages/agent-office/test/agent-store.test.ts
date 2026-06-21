import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { officeAgentIdSchema, roleIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteAgent, listAgents, loadAgent, saveAgent } from "../src/agent-store.js";
import { type OfficeAgent, officeAgentSchema } from "../src/agent.js";
import { agentPath } from "../src/paths.js";

let storeRoot: string;
const workspaceKey = "0123456789abcdef";
beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "agent-office-agents-"));
});
afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

function makeAgent(overrides: Partial<OfficeAgent> = {}): OfficeAgent {
  return officeAgentSchema.parse({
    id: officeAgentIdSchema.parse(randomUUID()),
    name: "Archie",
    roleId: roleIdSchema.parse(randomUUID()),
    kind: "claude-code",
    workspaceKey,
    workdir: "/repo",
    status: "idle",
    createdAt: "2026-06-22T12:00:00.000Z",
    ...overrides,
  });
}

describe("agent store", () => {
  it("round-trips a saved agent", async () => {
    const agent = makeAgent();
    await saveAgent({ storeRoot, agent });
    expect(await loadAgent({ storeRoot, workspaceKey, officeAgentId: agent.id })).toEqual(agent);
  });

  it("throws not_found for a missing agent", async () => {
    await expect(
      loadAgent({
        storeRoot,
        workspaceKey,
        officeAgentId: officeAgentIdSchema.parse(randomUUID()),
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("lists agents scoped to a workspace and returns [] when none exist", async () => {
    expect(await listAgents({ storeRoot, workspaceKey })).toEqual([]);
    const a = makeAgent();
    await saveAgent({ storeRoot, agent: a });
    const ids = (await listAgents({ storeRoot, workspaceKey })).map((x) => x.id);
    expect(ids).toEqual([a.id]);
  });

  it("deletes an agent (idempotent)", async () => {
    const agent = makeAgent();
    await saveAgent({ storeRoot, agent });
    await deleteAgent({ storeRoot, workspaceKey, officeAgentId: agent.id });
    await expect(
      loadAgent({ storeRoot, workspaceKey, officeAgentId: agent.id }),
    ).rejects.toMatchObject({ code: "not_found" });
    await deleteAgent({ storeRoot, workspaceKey, officeAgentId: agent.id });
  });

  it("throws store_corrupt for a non-json file", async () => {
    const agent = makeAgent();
    await saveAgent({ storeRoot, agent });
    writeFileSync(agentPath({ storeRoot, workspaceKey, officeAgentId: agent.id }), "{ not json");
    await expect(
      loadAgent({ storeRoot, workspaceKey, officeAgentId: agent.id }),
    ).rejects.toMatchObject({ code: "store_corrupt" });
  });
});
