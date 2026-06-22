import { describe, expect, it } from "vitest";
import * as api from "../src/index.js";

describe("public surface", () => {
  it("exports schemas, types-by-value, error, stores, and the seed builder", () => {
    for (const name of [
      "roleSchema",
      "rolePermissionModeSchema",
      "roleModelSchema",
      "officeAgentSchema",
      "agentStatusSchema",
      "officeTaskSchema",
      "taskStatusSchema",
      "AgentOfficeError",
      "agentOfficeErrorCodeSchema",
      "saveRole",
      "loadRole",
      "listRoles",
      "deleteRole",
      "saveAgent",
      "loadAgent",
      "listAgents",
      "deleteAgent",
      "saveTask",
      "loadTask",
      "listTasks",
      "deleteTask",
      "buildPredefinedRoles",
      "resolveLauncherPermission",
      "createLauncherRegistry",
      "auditEventSchema",
      "auditEventTypeSchema",
      "appendAudit",
      "listAudit",
      "createSupervisor",
    ]) {
      expect(api).toHaveProperty(name);
    }
  });

  it("does NOT export internal path/atomic-write helpers", () => {
    expect(api).not.toHaveProperty("atomicWriteFile");
    expect(api).not.toHaveProperty("assertSafeSegment");
  });
});
