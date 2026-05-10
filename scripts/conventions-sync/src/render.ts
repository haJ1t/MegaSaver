import type { BlockSpec } from "./manifest.ts";
import type { ParsedBlock, ParsedFile } from "./parse.ts";

export function renderHeader(spec: BlockSpec): string {
  const fragment = spec.fragment === undefined ? "" : ` fragment="${spec.fragment}"`;
  return `<!-- conventions:start id="${spec.id}" source="${spec.source}"${fragment} -->`;
}

export function renderFooter(spec: BlockSpec): string {
  return `<!-- conventions:end id="${spec.id}" -->`;
}

export function renderBlock(spec: BlockSpec, body: string): string {
  const normalizedBody = body.replace(/\r\n/g, "\n").replace(/^\n+/, "").replace(/\n+$/, "");
  return `${renderHeader(spec)}\n${normalizedBody}\n${renderFooter(spec)}`;
}

export type RenderInput = {
  readonly spec: BlockSpec;
  readonly body: string;
};

export function applyBlocks(parsed: ParsedFile, renders: ReadonlyMap<string, string>): string {
  const lines = [...parsed.lines];
  // Replace from the end so earlier line indices stay valid.
  const ordered = [...parsed.blocks].sort((a, b) => b.startLine - a.startLine);
  for (const block of ordered) {
    const replacement = renders.get(block.id);
    if (replacement === undefined) continue;
    const replacementLines = replacement.split("\n");
    lines.splice(block.startLine, block.endLine - block.startLine + 1, ...replacementLines);
  }
  return lines.join("\n");
}

export function findBlock(blocks: readonly ParsedBlock[], id: string): ParsedBlock | undefined {
  return blocks.find((b) => b.id === id);
}
