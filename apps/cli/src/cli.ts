import { isMainThread } from "node:worker_threads";
import { recordTaskKickoffProcessEntry } from "./hooks/task-kickoff-deadline.js";

if (isMainThread) {
  recordTaskKickoffProcessEntry();
  const [{ runMain }, { mainCommand }] = await Promise.all([import("citty"), import("./main.js")]);
  runMain(mainCommand);
} else {
  await import("./hooks/task-kickoff-worker.js");
}
