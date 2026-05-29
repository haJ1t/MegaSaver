import { defineCommand } from "citty";
import { outputChunkCommand } from "./chunk.js";
import { outputFileCommand } from "./file.js";
import { outputFilterCommand } from "./filter.js";

export {
  type RunOutputFileInput,
  runOutputFile,
  outputFileCommand,
} from "./file.js";
export {
  type RunOutputFilterInput,
  runOutputFilter,
  outputFilterCommand,
} from "./filter.js";
export {
  type RunOutputChunkInput,
  runOutputChunk,
  outputChunkCommand,
} from "./chunk.js";

export const outputCommand = defineCommand({
  meta: { name: "output", description: "Filter and chunk tool output." },
  subCommands: {
    file: outputFileCommand,
    filter: outputFilterCommand,
    chunk: outputChunkCommand,
  },
});
