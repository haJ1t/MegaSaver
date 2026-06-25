import { acquireLock, startDaemonServer } from "@megasaver/daemon";
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
    const running = await startDaemonServer({ storeRoot });
    console.log(`mega daemon listening on ${running.url}`);
    const shutdown = (): void => {
      release();
      void running.close().finally(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    // The listening server keeps the event loop alive until a signal arrives.
  },
});
