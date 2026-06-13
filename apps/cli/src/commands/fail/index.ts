import { defineCommand } from "citty";
import { failListCommand } from "./list.js";
import { failRecordCommand } from "./record.js";
import { failShowCommand } from "./show.js";

export { type RunFailRecordInput, runFailRecord, failRecordCommand } from "./record.js";
export { type RunFailListInput, runFailList, failListCommand } from "./list.js";
export { type RunFailShowInput, runFailShow, failShowCommand } from "./show.js";

export const failCommand = defineCommand({
  meta: { name: "fail", description: "Record and inspect failed attempts." },
  subCommands: { record: failRecordCommand, list: failListCommand, show: failShowCommand },
});
