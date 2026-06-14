import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkspaceKey } from "@megasaver/shared";
import type { z } from "zod";
import { CorePersistenceError } from "./errors.js";
import { type ProjectRule, projectRuleSchema } from "./project-rule.js";
import { type ToolDefinition, toolDefinitionSchema } from "./tool-definition.js";

// Read-only, workspace-keyed siblings of readProjectRulesForProject /
// readToolDefinitionsForProject. They read <storeRoot>/<feature>/<key>.jsonl with
// the same ENOENT→[] and corrupt→CorePersistenceError contract as
// json-directory-store's readJsonLines (no atomic-write machinery — these never
// write). Entity bodies stay project-shaped; the workspaceKey is the path only.
export function readWorkspaceRules(storeRoot: string, key: WorkspaceKey): ProjectRule[] {
  const filePath = join(storeRoot, "rules", `${key}.jsonl`);
  return readJsonLines(filePath).map((entry) => parseEntity(projectRuleSchema, entry, filePath));
}

export function readWorkspaceTools(storeRoot: string, key: WorkspaceKey): ToolDefinition[] {
  const filePath = join(storeRoot, "tools", `${key}.jsonl`);
  return readJsonLines(filePath).map((entry) => parseEntity(toolDefinitionSchema, entry, filePath));
}

function readJsonLines(filePath: string): unknown[] {
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw new CorePersistenceError("store_read_failed", "Store read failed.", {
      filePath,
      cause: error,
    });
  }

  if (content.length === 0) {
    throw new CorePersistenceError("store_json_invalid", `Store JSONL file is empty: ${filePath}`, {
      filePath,
    });
  }

  const lines = content.split("\n");
  if (content.endsWith("\n")) {
    lines.pop();
  }

  return lines.map((line) => {
    if (line.trim().length === 0) {
      throw new CorePersistenceError(
        "store_json_invalid",
        `Store JSONL has a blank line: ${filePath}`,
        { filePath },
      );
    }

    try {
      return JSON.parse(line) as unknown;
    } catch (error) {
      throw new CorePersistenceError("store_json_invalid", `Store JSON is invalid: ${filePath}`, {
        filePath,
        cause: error,
      });
    }
  });
}

function parseEntity<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
  filePath: string,
): z.output<T> {
  try {
    return schema.parse(value);
  } catch (error) {
    throw new CorePersistenceError("store_entity_invalid", `Store entity is invalid: ${filePath}`, {
      filePath,
      cause: error,
    });
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
