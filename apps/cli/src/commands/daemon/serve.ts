import { type RunningDaemon, acquireLock, startDaemonServer } from "@megasaver/daemon";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../../store.js";

export const daemonServeCommand = defineCommand({
  meta: {
    name: "serve",
    description: "Run the local Mega Saver context daemon (machine-wide singleton).",
  },
  args: {
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeRoot = resolveStorePath(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    const release = acquireLock(storeRoot);
    if (!release) {
      console.log("mega daemon already running (lock held)");
      return;
    }
    let running: RunningDaemon;
    try {
      running = await startDaemonServer({ storeRoot });
    } catch (err) {
      release();
      throw err;
    }
    console.log(`mega daemon listening on ${running.url}`);
    let shuttingDown = false;
    const shutdown = (): void => {
      if (shuttingDown) return;
      shuttingDown = true;
      release();
      void running.close().finally(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    // The listening server keeps the event loop alive until a signal arrives.
  },
});
