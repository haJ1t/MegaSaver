import { randomUUID } from "node:crypto";
import type { Project } from "@megasaver/core";
import { projectIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { z } from "zod";
import { duplicateNameMessage, mapErrorToCliMessage } from "../errors.js";
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
    for (const project of projects) {
      input.stdout(formatProjectLine(project));
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
  },
  async run({ args }) {
    const code = await runProjectList({
      storeFlag: typeof args.store === "string" ? args.store : undefined,
      cwd: process.cwd(),
      home: process.env["HOME"] ?? "",
      xdgDataHome: process.env["XDG_DATA_HOME"],
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});

const nameSchema = z.string().trim().min(1);

export type RunProjectCreateInput = {
  name: string;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  /** Override for tests; defaults to crypto.randomUUID. */
  newId?: () => string;
  /** Override for tests; defaults to () => new Date().toISOString(). */
  now?: () => string;
};

export async function runProjectCreate(
  input: RunProjectCreateInput,
): Promise<0 | 1> {
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
      rootPath: input.cwd,
      createdAt: now,
      updatedAt: now,
    });
    input.stdout(formatProjectLine(created));
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
  },
  async run({ args }) {
    const code = await runProjectCreate({
      name: typeof args.name === "string" ? args.name : "",
      storeFlag: typeof args.store === "string" ? args.store : undefined,
      cwd: process.cwd(),
      home: process.env["HOME"] ?? "",
      xdgDataHome: process.env["XDG_DATA_HOME"],
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
