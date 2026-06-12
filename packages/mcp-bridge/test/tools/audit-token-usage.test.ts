import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AuditEvent, appendAuditEvent } from "@megasaver/core";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { McpBridgeError } from "../../src/errors.js";
import { handleAuditTokenUsage } from "../../src/tools/audit-token-usage.js";

const PROJECT_ID = "22222222-2222-4222-8222-222222222222" as ProjectId;
const SESSION_ID = "11111111-1111-4111-8111-111111111111" as SessionId;

// Minimal registry stub: only listProjects is consulted by the handler.
const registry = {
  listProjects: () => [{ id: PROJECT_ID, name: "demo" }],
} as unknown as Parameters<typeof handleAuditTokenUsage>[0]["registry"];

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-audit-mcp-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const packEvent = (): AuditEvent =>
  ({
    id: "e1",
    sessionId: SESSION_ID,
    projectId: PROJECT_ID,
    createdAt: "2026-06-12T12:00:00.000Z",
    kind: "context_pack_built",
    filesConsidered: 5,
    filesIncluded: 2,
    filesExcluded: 3,
    blocksConsidered: 8,
    blocksIncluded: 3,
    blocksExcluded: 5,
    tokensBefore: 7000,
    tokensAfter: 2300,
  }) as AuditEvent;

describe("handleAuditTokenUsage", () => {
  it("summarizes a session window", async () => {
    appendAuditEvent({ store: { root }, event: packEvent() });
    const out = await handleAuditTokenUsage(
      { registry, storeRoot: root, now: () => "2026-06-12T12:00:00.000Z" },
      { projectId: PROJECT_ID, sessionId: SESSION_ID, window: "session" },
    );
    expect(out.tokensBefore).toBe(7000);
    expect(out.tokensAfter).toBe(2300);
    expect(out.percentageSaved).toBe(67);
  });

  it("requires a sessionId for the session window", async () => {
    await expect(
      handleAuditTokenUsage(
        { registry, storeRoot: root, now: () => "2026-06-12T12:00:00.000Z" },
        { projectId: PROJECT_ID, window: "session" },
      ),
    ).rejects.toBeInstanceOf(McpBridgeError);
  });

  it("rejects a bad window", async () => {
    await expect(
      handleAuditTokenUsage(
        { registry, storeRoot: root, now: () => "2026-06-12T12:00:00.000Z" },
        { projectId: PROJECT_ID, window: "year" },
      ),
    ).rejects.toBeInstanceOf(McpBridgeError);
  });

  it("maps an unknown project to resource_not_found", async () => {
    try {
      await handleAuditTokenUsage(
        { registry, storeRoot: root, now: () => "2026-06-12T12:00:00.000Z" },
        { projectId: "99999999-9999-4999-8999-999999999999", window: "all" },
      );
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(McpBridgeError);
      expect((err as McpBridgeError).code).toBe("resource_not_found");
    }
  });
});
