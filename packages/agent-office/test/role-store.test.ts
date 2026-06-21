import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { roleIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentOfficeError } from "../src/errors.js";
import { rolePath, rolesDir } from "../src/paths.js";
import { deleteRole, listRoles, loadRole, saveRole } from "../src/role-store.js";
import { type Role, roleSchema } from "../src/role.js";

let storeRoot: string;
beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "agent-office-roles-"));
});
afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

function makeRole(overrides: Partial<Role> = {}): Role {
  return roleSchema.parse({
    id: roleIdSchema.parse(randomUUID()),
    name: "Architect",
    kind: "claude-code",
    persona: "Design systems.",
    model: "opus",
    allowedTools: [],
    skillPacks: [],
    permissionMode: "plan",
    createdAt: "2026-06-22T12:00:00.000Z",
    ...overrides,
  });
}

describe("role store", () => {
  it("round-trips a saved role", async () => {
    const role = makeRole();
    await saveRole({ storeRoot, role });
    expect(await loadRole({ storeRoot, roleId: role.id })).toEqual(role);
  });

  it("throws not_found for a missing role", async () => {
    await expect(
      loadRole({ storeRoot, roleId: roleIdSchema.parse(randomUUID()) }),
    ).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("lists saved roles and returns [] when none exist", async () => {
    expect(await listRoles({ storeRoot })).toEqual([]);
    const a = makeRole();
    const b = makeRole();
    await saveRole({ storeRoot, role: a });
    await saveRole({ storeRoot, role: b });
    const ids = (await listRoles({ storeRoot })).map((r) => r.id).sort();
    expect(ids).toEqual([a.id, b.id].sort());
  });

  it("deletes a role (idempotent)", async () => {
    const role = makeRole();
    await saveRole({ storeRoot, role });
    await deleteRole({ storeRoot, roleId: role.id });
    await expect(loadRole({ storeRoot, roleId: role.id })).rejects.toMatchObject({
      code: "not_found",
    });
    await deleteRole({ storeRoot, roleId: role.id }); // no throw second time
  });

  it("throws store_corrupt for a non-json file", async () => {
    const role = makeRole();
    const path = rolePath({ storeRoot, roleId: role.id });
    // ensure dir exists by saving then clobbering
    await saveRole({ storeRoot, role });
    writeFileSync(path, "{ not json");
    await expect(loadRole({ storeRoot, roleId: role.id })).rejects.toBeInstanceOf(AgentOfficeError);
    expect(rolesDir(storeRoot)).toContain("office");
  });
});
