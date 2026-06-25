export { daemonDir, discoveryPath, lockPath } from "./paths.js";
export { type Discovery, clearDiscovery, readDiscovery, writeDiscovery } from "./discovery.js";
export { acquireLock, clearLock } from "./lock.js";
export {
  type RunningDaemon,
  type StartDaemonOptions,
  startDaemonServer,
} from "./server.js";
export { daemonSpawnArgs, spawnDaemon } from "./spawn.js";
export { type DaemonHandle, type GetDaemonOptions, getDaemon } from "./client.js";
export {
  type HandlerResponse,
  type ExecHandlerDeps,
  type SearchHandlerDeps,
  excerptHandler,
  expandHandler,
  execHandler,
  recallHandler,
  searchHandler,
} from "./handlers.js";
export { readJsonBody } from "./body.js";
