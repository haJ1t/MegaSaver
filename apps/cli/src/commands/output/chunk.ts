import { ContentStoreError, loadChunkSet } from "@megasaver/content-store";
import { defineCommand } from "citty";
import {
  chunkNotFoundMessage,
  chunkSetNotFoundMessage,
  invalidChunkIdMessage,
  invalidChunkSetIdMessage,
  mapErrorToCliMessage,
  storeCorruptMessage,
} from "../../errors.js";
import { resolveStorePath } from "../../store.js";
import { locateChunkSet } from "./locate-chunk-set.js";

export type RunOutputChunkInput = {
  chunkSetId: string;
  chunkId: string;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
};

function isSingleSegment(value: string): boolean {
  return value.length > 0 && !value.includes("/") && value !== "." && value !== "..";
}

export async function runOutputChunk(input: RunOutputChunkInput): Promise<0 | 1> {
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

  if (!isSingleSegment(input.chunkSetId)) {
    const cli = invalidChunkSetIdMessage();
    input.stderr(cli.message);
    return cli.exitCode;
  }
  if (input.chunkId.length === 0) {
    const cli = invalidChunkIdMessage();
    input.stderr(cli.message);
    return cli.exitCode;
  }

  const located = locateChunkSet({ storeRoot: rootDir, chunkSetId: input.chunkSetId });
  if (located === null) {
    const cli = chunkSetNotFoundMessage();
    input.stderr(cli.message);
    return cli.exitCode;
  }

  let chunkSet: Awaited<ReturnType<typeof loadChunkSet>>;
  try {
    chunkSet = await loadChunkSet({
      storeRoot: rootDir,
      projectId: located.projectId,
      sessionId: located.sessionId,
      chunkSetId: input.chunkSetId,
    });
  } catch (err) {
    if (err instanceof ContentStoreError) {
      if (err.code === "not_found") {
        const cli = chunkSetNotFoundMessage();
        input.stderr(cli.message);
        return cli.exitCode;
      }
      const cli = storeCorruptMessage(err.message);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }

  const chunk = chunkSet.chunks.find((c) => c.id === input.chunkId);
  if (chunk === undefined) {
    const cli = chunkNotFoundMessage();
    input.stderr(cli.message);
    return cli.exitCode;
  }

  if (input.json) {
    input.stdout(JSON.stringify({ chunkSetId: input.chunkSetId, chunkId: input.chunkId, chunk }));
  } else {
    input.stdout(
      `Chunk ${chunk.id} of ${input.chunkSetId} (lines ${chunk.startLine}-${chunk.endLine}, ${chunk.bytes} B)`,
    );
    input.stdout(chunk.text);
  }
  return 0;
}

export const outputChunkCommand = defineCommand({
  meta: { name: "chunk", description: "Return a single chunk from a stored chunk-set." },
  args: {
    chunkSetId: { type: "positional", required: true, description: "Chunk-set id." },
    chunkId: { type: "positional", required: true, description: "Chunk id." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runOutputChunk({
      chunkSetId: typeof args.chunkSetId === "string" ? args.chunkSetId : "",
      chunkId: typeof args.chunkId === "string" ? args.chunkId : "",
      storeFlag: typeof args.store === "string" ? args.store : undefined,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      xdgDataHome: process.env["XDG_DATA_HOME"],
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
