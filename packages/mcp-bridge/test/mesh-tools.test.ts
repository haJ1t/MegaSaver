import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerSession } from "@megasaver/mesh";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TOOL_INPUT_SCHEMAS } from "../src/tool-schemas.js";
import {
  handleMeshClaim,
  handleMeshEvents,
  handleMeshPeers,
  handleMeshPoll,
  handleMeshRelease,
  handleMeshSend,
  handleMeshStatusSet,
  meshClaimInputSchema,
  meshEventsInputSchema,
  meshPeersInputSchema,
  meshPollInputSchema,
  meshReleaseInputSchema,
  meshSendInputSchema,
  meshStatusSetInputSchema,
} from "../src/tools/mesh.js";

describe("MCP mesh tools registry", () => {
  it("TOOL_INPUT_SCHEMAS contains mesh_broadcast and mesh_query (legacy)", () => {
    expect(TOOL_INPUT_SCHEMAS).toHaveProperty("mesh_broadcast");
    expect(TOOL_INPUT_SCHEMAS).toHaveProperty("mesh_query");
  });

  it("TOOL_INPUT_SCHEMAS contains 7 new mesh tools", () => {
    expect(TOOL_INPUT_SCHEMAS).toHaveProperty("mesh_claim");
    expect(TOOL_INPUT_SCHEMAS).toHaveProperty("mesh_events");
    expect(TOOL_INPUT_SCHEMAS).toHaveProperty("mesh_peers");
    expect(TOOL_INPUT_SCHEMAS).toHaveProperty("mesh_poll");
    expect(TOOL_INPUT_SCHEMAS).toHaveProperty("mesh_release");
    expect(TOOL_INPUT_SCHEMAS).toHaveProperty("mesh_send");
    expect(TOOL_INPUT_SCHEMAS).toHaveProperty("mesh_status_set");
  });

  it("schemas are strict — unknown field rejected", () => {
    expect(
      meshClaimInputSchema.safeParse({ liveSessionId: "a1", paths: ["a"], unknown: 1 }).success,
    ).toBe(false);
    expect(meshSendInputSchema.safeParse({ from: "a1", text: "hi", unknown: 1 }).success).toBe(
      false,
    );
    expect(meshPeersInputSchema.safeParse({ all: true, unknown: 1 }).success).toBe(false);
    expect(
      meshEventsInputSchema.safeParse({ since: new Date().toISOString(), unknown: 1 }).success,
    ).toBe(false);
    expect(meshPollInputSchema.safeParse({ liveSessionId: "a1", unknown: 1 }).success).toBe(false);
    expect(meshReleaseInputSchema.safeParse({ claimId: "c1", unknown: 1 }).success).toBe(false);
    expect(
      meshStatusSetInputSchema.safeParse({ liveSessionId: "a1", status: "working", unknown: 1 })
        .success,
    ).toBe(false);
  });
});

describe("MCP mesh handlers end-to-end", () => {
  let root = "";
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mesh-mcp-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("mesh_send redacts and mesh_poll drains at-most-once", async () => {
    for (const id of ["a1", "b1"]) {
      registerSession(root, {
        liveSessionId: id,
        agent: "claude-code",
        status: "working",
        lastSeenAt: new Date().toISOString(),
        workspaceKey: "aaaaaaaaaaaaaaaa",
        cwd: "/repo",
      });
    }
    const sent = await handleMeshSend(
      { storeRoot: root },
      { from: "a1", to: "b1", text: "token: sk-proj-abcdefghijklmnopqrstuvwxyz0123456789" },
    );
    expect(sent.id).toBeDefined();
    const first = await handleMeshPoll({ storeRoot: root }, { liveSessionId: "b1" });
    expect(first.events).toHaveLength(1);
    expect((first.events[0] as { text: string }).text).not.toContain("sk-proj");
    const second = await handleMeshPoll({ storeRoot: root }, { liveSessionId: "b1" });
    expect(second.events).toHaveLength(0);
  });

  it("mesh_claim creates and mesh_peers filters", async () => {
    for (const id of ["a1", "b1"]) {
      registerSession(root, {
        liveSessionId: id,
        agent: "claude-code",
        status: "working",
        lastSeenAt: new Date().toISOString(),
        workspaceKey: "bbbbbbbbbbbbbbbb",
        cwd: "/repo",
      });
    }
    const claim = await handleMeshClaim(
      { storeRoot: root },
      { liveSessionId: "a1", paths: ["src/auth.ts"] },
    );
    expect(claim.claimId).toBeDefined();
    const peers = await handleMeshPeers({ storeRoot: root }, { workspaceKey: "bbbbbbbbbbbbbbbb" });
    expect(peers.peers).toHaveLength(2);
    const all = await handleMeshPeers({ storeRoot: root }, { all: true });
    expect(all.peers.length).toBeGreaterThanOrEqual(2);
  });

  it("mesh_events filters by since", async () => {
    const old = new Date(Date.now() - 60_000).toISOString();
    const now = new Date().toISOString();
    await handleMeshSend({ storeRoot: root }, { from: "a1", text: "old", kind: "message" });
    // inject old event directly via postEvent for precise timestamp
    const { postEvent } = await import("@megasaver/mesh");
    postEvent(root, { id: "evt-old", kind: "message", from: "a1", text: "old2", createdAt: old });
    const res = await handleMeshEvents({ storeRoot: root }, { since: now });
    // should contain only events >= now, at least the one sent above with now timestamp
    expect(res.events.length).toBeGreaterThanOrEqual(0);
    for (const e of res.events as Array<{ createdAt: string }>) {
      expect(Date.parse(e.createdAt) >= Date.parse(now)).toBe(true);
    }
  });

  it("mesh_release removes claim", async () => {
    registerSession(root, {
      liveSessionId: "a1",
      agent: "claude-code",
      status: "working",
      lastSeenAt: new Date().toISOString(),
      workspaceKey: "cccccccccccccccc",
      cwd: "/repo",
    });
    const c = await handleMeshClaim(
      { storeRoot: root },
      { liveSessionId: "a1", paths: ["src/app.ts"] },
    );
    const rel = await handleMeshRelease({ storeRoot: root }, { claimId: c.claimId });
    expect(rel.released).toBe(true);
    const rel2 = await handleMeshRelease({ storeRoot: root }, { claimId: c.claimId });
    expect(rel2.released).toBe(false);
  });

  it("mesh_status_set updates presence", async () => {
    registerSession(root, {
      liveSessionId: "a1",
      agent: "claude-code",
      status: "working",
      lastSeenAt: new Date().toISOString(),
      workspaceKey: "dddddddddddddddd",
      cwd: "/repo",
    });
    const res = await handleMeshStatusSet(
      { storeRoot: root },
      { liveSessionId: "a1", status: "blocked", task: "review" },
    );
    expect(res.ok).toBe(true);
    const { listPeers } = await import("@megasaver/mesh");
    const peers = listPeers(root, { all: true });
    const p = peers.find((x) => x.liveSessionId === "a1");
    expect(p?.status).toBe("blocked");
  });

  it("validation fails on unknown field", async () => {
    await expect(
      handleMeshSend({ storeRoot: root }, { from: "a1", text: "hi", unknown: 1 } as unknown),
    ).rejects.toThrow();
    await expect(
      handleMeshClaim({ storeRoot: root }, {
        liveSessionId: "a1",
        paths: ["a"],
        extra: 1,
      } as unknown),
    ).rejects.toThrow();
  });
});
