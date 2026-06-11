import type { CoreRegistry, Project } from "@megasaver/core";
import type { CodeBlock } from "@megasaver/indexer";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, resolveStorePath } from "../../store.js";
import { projectNameSchema } from "../shared/schemas.js";

export type StoreEnv = {
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
};

export type ProjectContext = { rootDir: string; registry: CoreRegistry; project: Project };

// Shared store+project resolution for scan/index commands. Prints the matching
// CLI error to stderr and returns null on any failure (caller returns exit 1).
export async function loadProjectContext(
  projectName: string,
  env: StoreEnv,
  stderr: (line: string) => void,
): Promise<ProjectContext | null> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath(env);
  } catch (err) {
    stderr(mapErrorToCliMessage(err, { kind: "store" }).message);
    return null;
  }

  let name: string;
  try {
    name = projectNameSchema.parse(projectName);
  } catch (err) {
    stderr(mapErrorToCliMessage(err, { kind: "name" }).message);
    return null;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) stderr(`note: initialized store at ${rootDir}`);
    const project = registry.listProjects().find((p) => p.name === name);
    if (!project) {
      stderr(projectNotFoundMessage(name).message);
      return null;
    }
    return { rootDir, registry, project };
  } catch (err) {
    stderr(mapErrorToCliMessage(err).message);
    return null;
  }
}

const TYPE_COLUMN_WIDTH = 10;

export function formatIndexSearchLine(score: number, block: CodeBlock): string {
  const type = block.blockType.padEnd(TYPE_COLUMN_WIDTH, " ");
  return `${score.toFixed(3)}  ${type}  ${block.filePath}:${block.startLine}  ${block.name ?? "-"}`;
}
