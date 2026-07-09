import { defineCommand } from "citty";
import { outputChunkCommand } from "./chunk.js";
import { outputExecCommand } from "./exec.js";
import { outputFileCommand } from "./file.js";
import { outputFilterCommand } from "./filter.js";
import { outputGcCommand } from "./gc.js";

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
export {
  type RunOutputExecInput,
  runOutputExec,
  outputExecCommand,
} from "./exec.js";
export {
  type RunOutputGcInput,
  runOutputGc,
  outputGcCommand,
} from "./gc.js";

export const outputCommand = defineCommand({
  meta: { name: "output", description: "Filter and chunk tool output." },
  subCommands: {
    file: outputFileCommand,
    filter: outputFilterCommand,
    chunk: outputChunkCommand,
    exec: outputExecCommand,
    gc: outputGcCommand,
  },
});
