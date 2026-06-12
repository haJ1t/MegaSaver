import { defineCommand } from "citty";
import { memoryApproveCommand, memoryRejectCommand } from "./approve.js";
import { memoryCreateCommand } from "./create.js";
import { memoryDeleteCommand } from "./delete.js";
import { memoryExplainCommand } from "./explain.js";
import { memoryListCommand } from "./list.js";
import { memorySearchCommand } from "./search.js";
import { memoryShowCommand } from "./show.js";
import { memoryUpdateCommand } from "./update.js";

export {
  type RunMemoryApproveInput,
  runMemoryApprove,
  memoryApproveCommand,
  memoryRejectCommand,
} from "./approve.js";
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
export {
  type RunMemorySearchInput,
  runMemorySearch,
  memorySearchCommand,
} from "./search.js";
export {
  type RunMemoryUpdateInput,
  runMemoryUpdate,
  memoryUpdateCommand,
} from "./update.js";
export {
  type RunMemoryDeleteInput,
  runMemoryDelete,
  memoryDeleteCommand,
} from "./delete.js";
export {
  type RunMemoryExplainInput,
  runMemoryExplain,
  memoryExplainCommand,
} from "./explain.js";

export const memoryCommand = defineCommand({
  meta: { name: "memory", description: "Manage Mega Saver memory entries." },
  subCommands: {
    create: memoryCreateCommand,
    list: memoryListCommand,
    show: memoryShowCommand,
    search: memorySearchCommand,
    update: memoryUpdateCommand,
    approve: memoryApproveCommand,
    reject: memoryRejectCommand,
    delete: memoryDeleteCommand,
    explain: memoryExplainCommand,
  },
});
