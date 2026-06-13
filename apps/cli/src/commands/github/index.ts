import { defineCommand } from "citty";
import { githubPrCommentCommand } from "./pr-comment.js";

export {
  type RunGithubPrCommentInput,
  runGithubPrComment,
  githubPrCommentCommand,
} from "./pr-comment.js";

export const githubCommand = defineCommand({
  meta: { name: "github", description: "GitHub integration commands." },
  subCommands: { "pr-comment": githubPrCommentCommand },
});
