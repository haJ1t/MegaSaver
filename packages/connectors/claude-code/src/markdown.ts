import {
  parseBlock,
  removeBlock,
  renderBlock,
  upsertBlock,
} from "@megasaver/connectors-shared";
import { type ClaudeCodeContext, assertClaudeCodeContext } from "./context.js";
import { wrapSharedConnectorError } from "./errors.js";

export interface ClaudeMdDocument {
  hasManagedBlock: boolean;
  contentBeforeBlock: string;
  managedBlock: string | null;
  contentAfterBlock: string;
}

interface UpsertMegaSaverBlockInput {
  existingContent: string;
  context: ClaudeCodeContext;
}

export function renderClaudeCodeContext(input: ClaudeCodeContext): string {
  const context = assertClaudeCodeContext(input);
  return renderBlock(context);
}

export function parseClaudeMd(content: string): ClaudeMdDocument {
  try {
    const parsed = parseBlock(content);
    return {
      hasManagedBlock: parsed.block !== null,
      contentBeforeBlock: parsed.before,
      managedBlock: parsed.block,
      contentAfterBlock: parsed.after,
    };
  } catch (error) {
    wrapSharedConnectorError(error, null);
    return undefined as never;
  }
}

export function upsertMegaSaverBlock(input: UpsertMegaSaverBlockInput): string {
  const context = assertClaudeCodeContext(input.context);
  try {
    return upsertBlock({ existingContent: input.existingContent, context });
  } catch (error) {
    wrapSharedConnectorError(error, null);
    return undefined as never;
  }
}

export function removeMegaSaverBlock(content: string): string {
  try {
    return removeBlock(content);
  } catch (error) {
    wrapSharedConnectorError(error, null);
    return undefined as never;
  }
}
