import {
  deleteRole,
  ensurePredefinedRoles,
  listRoles,
  roleModelSchema,
  rolePermissionModeSchema,
  roleSchema,
  saveRole,
} from "@megasaver/agent-office";
import { agentIdSchema, titleSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import {
  invalidPermissionModeMessage,
  invalidRoleModelMessage,
  invalidToolMessage,
  mapErrorToCliMessage,
} from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { readTestEnv } from "../session/shared.js";

// ─── Shared store-env input fields ──────────────────────────────────────────

export type RoleStoreEnvInput = {
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

// ─── role list ───────────────────────────────────────────────────────────────

export type RunOfficeRoleListInput = RoleStoreEnvInput & {
  json?: boolean;
};

export async function runOfficeRoleList(input: RunOfficeRoleListInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    void registry; // registry not used for office (file-based store)
    const roles = await listRoles({ storeRoot: rootDir });
    if (input.json) {
      input.stdout(JSON.stringify(roles));
    } else {
      for (const r of roles) {
        input.stdout(`${r.id}  ${r.name}  ${r.kind}  ${r.model}  ${r.permissionMode}`);
      }
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "office_role" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const officeRoleListCommand = defineCommand({
  meta: { name: "list", description: "List all roles." },
  args: {
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runOfficeRoleList({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});

// ─── role create ─────────────────────────────────────────────────────────────

export type RunOfficeRoleCreateInput = RoleStoreEnvInput & {
  nameFlag: string;
  personaFlag: string;
  modelFlag: string;
  permissionModeFlag: string;
  kindFlag?: string;
  toolsFlag?: string;
  workdirFlag?: string;
  json?: boolean;
  newId?: () => string;
  now?: () => string;
};

export async function runOfficeRoleCreate(input: RunOfficeRoleCreateInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  // Validate model
  const modelResult = roleModelSchema.safeParse(input.modelFlag);
  if (!modelResult.success) {
    const cli = invalidRoleModelMessage(input.modelFlag);
    input.stderr(cli.message);
    return cli.exitCode;
  }

  // Validate permission-mode
  const permResult = rolePermissionModeSchema.safeParse(input.permissionModeFlag);
  if (!permResult.success) {
    const cli = invalidPermissionModeMessage(input.permissionModeFlag);
    input.stderr(cli.message);
    return cli.exitCode;
  }

  // Validate kind (defaults to claude-code)
  const kindResult = agentIdSchema.safeParse(input.kindFlag ?? "claude-code");
  if (!kindResult.success) {
    const cli = mapErrorToCliMessage(new Error(`invalid kind "${input.kindFlag}"`), {
      kind: "office_role",
    });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  // Parse tools: split comma-separated, check each for leading '-'
  const tools: string[] = input.toolsFlag
    ? input.toolsFlag
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
    : [];

  for (const tool of tools) {
    if (tool.startsWith("-")) {
      const cli = invalidToolMessage(tool);
      input.stderr(cli.message);
      return cli.exitCode;
    }
  }

  // Validate name via titleSchema
  const nameResult = titleSchema.safeParse(input.nameFlag);
  if (!nameResult.success) {
    const cli = mapErrorToCliMessage(nameResult.error, { kind: "name" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    void registry;

    const newId = input.newId ?? (() => crypto.randomUUID());
    const now = input.now ?? (() => new Date().toISOString());
    const id = readTestEnv("MEGA_TEST_OFFICE_ROLE_ID") ?? newId();
    const createdAt = readTestEnv("MEGA_TEST_NOW") ?? now();

    const role = roleSchema.parse({
      id,
      name: nameResult.data,
      kind: kindResult.data,
      persona: input.personaFlag,
      model: modelResult.data,
      allowedTools: tools,
      skillPacks: [],
      permissionMode: permResult.data,
      ...(input.workdirFlag !== undefined ? { defaultWorkdir: input.workdirFlag } : {}),
      createdAt,
    });

    await saveRole({ storeRoot: rootDir, role });
    input.stdout(input.json ? JSON.stringify(role) : role.id);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "office_role" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const officeRoleCreateCommand = defineCommand({
  meta: { name: "create", description: "Create a role." },
  args: {
    name: { type: "string", required: true, description: "Role name." },
    persona: { type: "string", required: true, description: "System prompt persona." },
    model: { type: "string", required: true, description: "Model (opus | sonnet | haiku)." },
    "permission-mode": {
      type: "string",
      required: true,
      description: "Permission mode (plan | acceptEdits | full).",
    },
    kind: {
      type: "string",
      default: "claude-code",
      description: "Launcher kind (default: claude-code).",
    },
    tools: { type: "string", description: "Comma-separated allowed tools." },
    workdir: { type: "string", description: "Default working directory." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const kindStr = typeof args.kind === "string" ? args.kind : undefined;
    const toolsStr = typeof args.tools === "string" ? args.tools : undefined;
    const workdirStr = typeof args.workdir === "string" ? args.workdir : undefined;
    const code = await runOfficeRoleCreate({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      nameFlag: typeof args.name === "string" ? args.name : "",
      personaFlag: typeof args.persona === "string" ? args.persona : "",
      modelFlag: typeof args.model === "string" ? args.model : "",
      permissionModeFlag:
        typeof args["permission-mode"] === "string" ? args["permission-mode"] : "",
      ...(kindStr !== undefined ? { kindFlag: kindStr } : {}),
      ...(toolsStr !== undefined ? { toolsFlag: toolsStr } : {}),
      ...(workdirStr !== undefined ? { workdirFlag: workdirStr } : {}),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});

// ─── role rm ─────────────────────────────────────────────────────────────────

export type RunOfficeRoleRmInput = RoleStoreEnvInput & {
  roleId: string;
};

export async function runOfficeRoleRm(input: RunOfficeRoleRmInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    void registry;
    await deleteRole({ storeRoot: rootDir, roleId: input.roleId });
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "office_role" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const officeRoleRmCommand = defineCommand({
  meta: { name: "rm", description: "Delete a role." },
  args: {
    roleId: { type: "positional", required: true, description: "Role id to delete." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const code = await runOfficeRoleRm({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      roleId: typeof args.roleId === "string" ? args.roleId : "",
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});

// ─── role seed ─────────────────────────────────────────────────────────────

export type RunOfficeRoleSeedInput = RoleStoreEnvInput & {
  json?: boolean;
  newId?: () => string;
  now?: () => string;
};

export async function runOfficeRoleSeed(input: RunOfficeRoleSeedInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    const { initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);

    const newId = input.newId ?? (() => crypto.randomUUID());
    const now = input.now ?? (() => new Date().toISOString());
    const result = await ensurePredefinedRoles({ storeRoot: rootDir, now, newId });
    input.stdout(
      input.json
        ? JSON.stringify(result)
        : result.seeded > 0
          ? `seeded ${result.seeded} predefined roles`
          : "roles already present; nothing seeded",
    );
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "office_role" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const officeRoleSeedCommand = defineCommand({
  meta: { name: "seed", description: "Seed the predefined role roster (idempotent)." },
  args: {
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runOfficeRoleSeed({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});

// ─── role command group ───────────────────────────────────────────────────────

export const officeRoleCommand = defineCommand({
  meta: { name: "role", description: "Manage office roles." },
  subCommands: {
    list: officeRoleListCommand,
    create: officeRoleCreateCommand,
    seed: officeRoleSeedCommand,
    rm: officeRoleRmCommand,
  },
});
