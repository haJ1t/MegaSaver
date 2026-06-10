import { type FetchChunkResult, fetchChunk } from "@megasaver/core";
import { defineCommand } from "citty";
import {
  chunkNotFoundMessage,
  chunkSetNotFoundMessage,
  invalidChunkIdMessage,
  invalidChunkSetIdMessage,
  mapErrorToCliMessage,
  storeCorruptMessage,
} from "../../errors.js";
import { readStoreEnv, resolveStorePath } from "../../store.js";

export type RunOutputChunkInput = {
  chunkSetId: string;
  chunkId: string;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
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
      platform: input.platform,
      localAppData: input.localAppData,
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

  let outcome: FetchChunkResult;
  try {
    outcome = await fetchChunk({
      storeRoot: rootDir,
      chunkSetId: input.chunkSetId,
      chunkId: input.chunkId,
    });
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }

  if (!outcome.ok) {
    const cli = (() => {
      switch (outcome.reason) {
        case "chunk_set_not_found":
          return chunkSetNotFoundMessage();
        case "chunk_not_found":
          return chunkNotFoundMessage();
        case "store_corrupt":
          return storeCorruptMessage(outcome.detail);
      }
    })();
    input.stderr(cli.message);
    return cli.exitCode;
  }

  const { chunk } = outcome;
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
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
