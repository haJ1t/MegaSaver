import { defineCommand } from "citty";
import { memoryCreateCommand } from "./create.js";
import { memoryListCommand } from "./list.js";
import { memoryShowCommand } from "./show.js";

export {
  type RunMemoryCreateInput,
  runMemoryCreate,
  memoryCreateCommand,
} from "./create.js";
export {
  type RunMemoryListInput,
  runMemoryList,
  memoryListCommand,
} from "./list.js";
export {
  type RunMemoryShowInput,
  runMemoryShow,
  memoryShowCommand,
} from "./show.js";

export const memoryCommand = defineCommand({
  meta: { name: "memory", description: "Manage Mega Saver memory entries." },
  subCommands: {
    create: memoryCreateCommand,
    list: memoryListCommand,
    show: memoryShowCommand,
  },
});
