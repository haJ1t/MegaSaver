import { defineCommand } from "citty";
import { boardListCommand } from "./list.js";
import { boardPostCommand } from "./post.js";
import { boardPromoteCommand } from "./promote.js";
import { boardResolveCommand } from "./resolve.js";

export const boardCommand = defineCommand({
  meta: { name: "board", description: "Structured board: post/list/resolve/promote facts (§13)." },
  subCommands: {
    post: boardPostCommand,
    list: boardListCommand,
    resolve: boardResolveCommand,
    promote: boardPromoteCommand,
  },
});

export { boardListCommand } from "./list.js";
export { boardPostCommand } from "./post.js";
export { boardPromoteCommand } from "./promote.js";
export { boardResolveCommand } from "./resolve.js";
export { runBoardList } from "./list.js";
export { runBoardPost } from "./post.js";
export { runBoardPromote } from "./promote.js";
export { runBoardResolve } from "./resolve.js";
