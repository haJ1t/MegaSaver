import { defineCommand } from "citty";
import { memoryApproveCommand, memoryRejectCommand } from "./approve.js";
import { memoryCreateCommand } from "./create.js";
import { memoryDeleteCommand } from "./delete.js";
import { memoryExplainCommand } from "./explain.js";
import { memoryFromSessionCommand } from "./from-session.js";
import { memoryGraphCommand } from "./graph.js";
import { memoryHistoryCommand } from "./history.js";
import { memoryIndexBuildCommand } from "./index-build.js";
import { memoryListCommand } from "./list.js";
import { memoryReopenCommand } from "./reopen.js";
import { memoryReviewCommand } from "./review.js";
import { memorySearchCommand } from "./search.js";
import { memoryShowCommand } from "./show.js";
import { memorySweepCommand } from "./sweep.js";
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
export {
  type RunMemoryReviewInput,
  runMemoryReview,
  memoryReviewCommand,
} from "./review.js";
export {
  type RunMemoryGraphInput,
  runMemoryGraph,
  memoryGraphCommand,
} from "./graph.js";
export {
  type RunMemoryIndexBuildInput,
  runMemoryIndexBuild,
  memoryIndexBuildCommand,
} from "./index-build.js";
export {
  type RunMemorySweepInput,
  runMemorySweep,
  memorySweepCommand,
} from "./sweep.js";
export {
  type RunMemoryFromSessionInput,
  runMemoryFromSession,
  memoryFromSessionCommand,
} from "./from-session.js";
export {
  type RunMemoryHistoryInput,
  runMemoryHistory,
  memoryHistoryCommand,
} from "./history.js";
export {
  type RunMemoryReopenInput,
  runMemoryReopen,
  memoryReopenCommand,
} from "./reopen.js";

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
    review: memoryReviewCommand,
    graph: memoryGraphCommand,
    index: memoryIndexBuildCommand,
    sweep: memorySweepCommand,
    "from-session": memoryFromSessionCommand,
    history: memoryHistoryCommand,
    reopen: memoryReopenCommand,
  },
});
