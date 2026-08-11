import { defineCommand } from "citty";
import { runSessionsLive } from "../../sessions/live.js";
import { readStoreEnv } from "../../store.js";

export const sessionsLiveCommand = defineCommand({
  meta: {
    name: "live",
    description: "Show live agent sessions (presence + burn + claim warnings).",
  },
  args: {
    json: { type: "boolean", default: false, description: "Emit JSON LiveTable." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    // @ts-ignore: noPropertyAccessFromIndexSignature
    const json = !!args.json;
    // @ts-ignore: noPropertyAccessFromIndexSignature
    const storeFlag = typeof args.store === "string" ? String(args.store) : undefined;
    const { home, xdgDataHome, platform, localAppData } = readStoreEnv(storeFlag);
    const code = await runSessionsLive({
      home,
      ...(storeFlag !== undefined ? { storeFlag } : {}),
      ...(xdgDataHome !== undefined ? { xdgDataHome } : {}),
      platform,
      ...(localAppData !== undefined ? { localAppData } : {}),
      json,
      stdout: (l) => console.log(l),
      stderr: (l) => console.error(l),
    });
    if (code !== 0) process.exitCode = code;
  },
});

export const sessionsCommand = defineCommand({
  meta: { name: "sessions", description: "Live session presence." },
  subCommands: { live: sessionsLiveCommand },
});

export { runSessionsLive } from "../../sessions/live.js";
