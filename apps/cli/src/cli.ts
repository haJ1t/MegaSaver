import { isMainThread } from "node:worker_threads";

if (isMainThread) {
  const [{ runMain }, { mainCommand }] = await Promise.all([import("citty"), import("./main.js")]);
  runMain(mainCommand);
} else {
  await import("./hooks/task-kickoff-worker.js");
}
