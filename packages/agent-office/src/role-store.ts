import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFile } from "./atomic-write.js";
import { AgentOfficeError } from "./errors.js";
import { rolePath, rolesDir } from "./paths.js";
import { type Role, roleSchema } from "./role.js";

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function parseRoleFile(path: string, raw: string): Role {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new AgentOfficeError("store_corrupt", `Corrupt role file: ${path}`, { cause: error });
  }
  try {
    return roleSchema.parse(parsed);
  } catch (error) {
    throw new AgentOfficeError("store_corrupt", `Corrupt role file: ${path}`, { cause: error });
  }
}

export async function saveRole(input: { storeRoot: string; role: Role }): Promise<void> {
  let role: Role;
  try {
    role = roleSchema.parse(input.role);
  } catch (error) {
    throw new AgentOfficeError("schema_invalid", "Role is invalid.", { cause: error });
  }
  const path = rolePath({ storeRoot: input.storeRoot, roleId: role.id });
  atomicWriteFile(path, `${JSON.stringify(role, null, 2)}\n`);
}

export async function loadRole(input: { storeRoot: string; roleId: string }): Promise<Role> {
  const path = rolePath({ storeRoot: input.storeRoot, roleId: input.roleId });
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") {
      throw new AgentOfficeError("not_found", `Role not found: ${input.roleId}`);
    }
    throw error;
  }
  return parseRoleFile(path, raw);
}

export async function listRoles(input: { storeRoot: string }): Promise<readonly Role[]> {
  const dir = rolesDir(input.storeRoot);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") return [];
    throw error;
  }
  const roles: Role[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    roles.push(parseRoleFile(path, readFileSync(path, "utf8")));
  }
  return roles;
}

export async function deleteRole(input: { storeRoot: string; roleId: string }): Promise<void> {
  const path = rolePath({ storeRoot: input.storeRoot, roleId: input.roleId });
  try {
    rmSync(path, { force: true });
  } catch (error) {
    throw new AgentOfficeError("write_failed", `Delete failed: ${input.roleId}`, { cause: error });
  }
}
