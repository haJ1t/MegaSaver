import type { Project } from "@megasaver/core";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../errors.js";
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
