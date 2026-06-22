import { randomUUID } from "node:crypto";
import { officeAgentIdSchema, roleIdSchema } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { type OfficeAgent, agentStatusSchema, officeAgentSchema } from "../src/agent.js";

function makeAgent(overrides: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id: officeAgentIdSchema.parse(randomUUID()),
    name: "Archie",
    roleId: roleIdSchema.parse(randomUUID()),
    kind: "claude-code",
    workspaceKey: "0123456789abcdef",
    workdir: "/repo",
    status: "idle",
    createdAt: "2026-06-22T12:00:00.000Z",
    ...overrides,
  } as OfficeAgent;
}

describe("officeAgentSchema", () => {
  it("accepts a valid idle agent without optional session ids", () => {
    expect(officeAgentSchema.parse(makeAgent())).toMatchObject({ status: "idle" });
  });

  it("accepts optional claudeSessionId and coreSessionId", () => {
    const parsed = officeAgentSchema.parse(
      makeAgent({
        claudeSessionId: "sess-abc",
        coreSessionId: randomUUID() as OfficeAgent["coreSessionId"],
      }),
    );
    expect(parsed.claudeSessionId).toBe("sess-abc");
  });

  it("enumerates statuses alphabetically", () => {
    expect(agentStatusSchema.options).toEqual(["error", "idle", "paused", "stopped", "working"]);
  });

  it("rejects an unknown status", () => {
    expect(() =>
      officeAgentSchema.parse(makeAgent({ status: "busy" as OfficeAgent["status"] })),
    ).toThrow();
  });

  it("rejects extra keys (strict)", () => {
    expect(() => officeAgentSchema.parse({ ...makeAgent(), extra: 1 })).toThrow();
  });

  it("rejects a datetime without timezone offset", () => {
    expect(() =>
      officeAgentSchema.parse(makeAgent({ createdAt: "2026-06-22T12:00:00" })),
    ).toThrow();
  });

  it("rejects an invalid workspaceKey (uppercase)", () => {
    expect(() => officeAgentSchema.parse({ ...makeAgent(), workspaceKey: "WK" })).toThrow();
  });

  it("rejects an invalid workspaceKey (wrong length)", () => {
    expect(() =>
      officeAgentSchema.parse({ ...makeAgent(), workspaceKey: "0123456789ab" }),
    ).toThrow();
  });

  it("rejects an invalid workspaceKey (contains uppercase hex)", () => {
    expect(() =>
      officeAgentSchema.parse({ ...makeAgent(), workspaceKey: "0123456789ABCDEF" }),
    ).toThrow();
  });
});
