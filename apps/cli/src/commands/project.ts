import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { Project } from "@megasaver/core";
import { projectIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { z } from "zod";
import {
  NAME_CONTROL_CHARS_MESSAGE,
  duplicateNameMessage,
  mapErrorToCliMessage,
} from "../errors.js";
import { ensureStoreReady, resolveStorePath } from "../store.js";

export function formatProjectLine(project: Pick<Project, "id" | "name">): string {
  return `${project.id}  ${project.name}`;
}

export type RunProjectListInput = {
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
};

export async function runProjectList(input: RunProjectListInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath({
      storeFlag: input.storeFlag,
      cwd: input.cwd,
      home: input.home,
      xdgDataHome: input.xdgDataHome,
    });
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) {
      input.stderr(`note: initialized store at ${rootDir}`);
    }
    const projects = registry.listProjects();
    if (input.json) {
      input.stdout(JSON.stringify(projects));
    } else {
      for (const project of projects) {
        input.stdout(formatProjectLine(project));
      }
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const projectListCommand = defineCommand({
  meta: { name: "list", description: "List persisted projects." },
  args: {
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runProjectList({
      storeFlag: typeof args.store === "string" ? args.store : undefined,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: TS noPropertyAccessFromIndexSignature requires bracket access for process.env
      home: process.env["HOME"] ?? "",
      // biome-ignore lint/complexity/useLiteralKeys: TS noPropertyAccessFromIndexSignature requires bracket access for process.env
      xdgDataHome: process.env["XDG_DATA_HOME"],
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});

const nameSchema = z
  .string()
  .trim()
  .min(1)
  // C0/C1 control chars and DEL break the line-oriented output protocol.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — this regex IS the guard against control chars
  .regex(/^[^\x00-\x1f\x7f-\x9f]+$/, NAME_CONTROL_CHARS_MESSAGE)
  .transform((value) => value.normalize("NFC"));

export type RunProjectCreateInput = {
  name: string;
  storeFlag: string | undefined;
  rootFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
  /** Override for tests; defaults to crypto.randomUUID. */
  newId?: () => string;
  /** Override for tests; defaults to () => new Date().toISOString(). */
  now?: () => string;
};

export async function runProjectCreate(input: RunProjectCreateInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath({
      storeFlag: input.storeFlag,
      cwd: input.cwd,
      home: input.home,
      xdgDataHome: input.xdgDataHome,
    });
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  let trimmedName: string;
  try {
    trimmedName = nameSchema.parse(input.name);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "name" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) {
      input.stderr(`note: initialized store at ${rootDir}`);
    }
    const existing = registry.listProjects();
    if (existing.some((p) => p.name === trimmedName)) {
      const cli = duplicateNameMessage(trimmedName);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    const id = projectIdSchema.parse((input.newId ?? randomUUID)());
    const now = (input.now ?? (() => new Date().toISOString()))();
    const created = registry.createProject({
      id,
      name: trimmedName,
      rootPath: input.rootFlag !== undefined ? resolve(input.rootFlag) : input.cwd,
      createdAt: now,
      updatedAt: now,
    });
    input.stdout(input.json ? JSON.stringify(created) : formatProjectLine(created));
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const projectCreateCommand = defineCommand({
  meta: { name: "create", description: "Create a new project." },
  args: {
    name: {
      type: "positional",
      required: true,
      description: "Project name (non-empty after trim).",
    },
    store: { type: "string", description: "Override store directory." },
    root: {
      type: "string",
      description: "Project root directory (absolute or relative; defaults to current directory).",
    },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runProjectCreate({
      name: typeof args.name === "string" ? args.name : "",
      storeFlag: typeof args.store === "string" ? args.store : undefined,
      rootFlag: typeof args.root === "string" ? args.root : undefined,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: TS noPropertyAccessFromIndexSignature requires bracket access for process.env
      home: process.env["HOME"] ?? "",
      // biome-ignore lint/complexity/useLiteralKeys: TS noPropertyAccessFromIndexSignature requires bracket access for process.env
      xdgDataHome: process.env["XDG_DATA_HOME"],
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});

export const projectCommand = defineCommand({
  meta: { name: "project", description: "Manage Mega Saver projects." },
  subCommands: {
    create: projectCreateCommand,
    list: projectListCommand,
  },
});
