import { defineCommand } from "citty";
import { rulesAddCommand } from "./add.js";
import { rulesApplyCommand } from "./apply.js";
import { rulesListCommand } from "./list.js";

export { type RunRulesAddInput, runRulesAdd, rulesAddCommand } from "./add.js";
export { type RunRulesApplyInput, runRulesApply, rulesApplyCommand } from "./apply.js";
export { type RunRulesListInput, runRulesList, rulesListCommand } from "./list.js";

export const rulesCommand = defineCommand({
  meta: { name: "rules", description: "Manage and apply project rules." },
  subCommands: { list: rulesListCommand, add: rulesAddCommand, apply: rulesApplyCommand },
});
