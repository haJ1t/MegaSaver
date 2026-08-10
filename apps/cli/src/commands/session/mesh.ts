import { SessionMeshHub, meshSocketPath } from "@megasaver/daemon";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../../store.js";

export const sessionMeshStatusCommand = defineCommand({
  meta: { name: "status", description: "Show session mesh socket and active sessions (IPC)." },
  args: {
    json: { type: "boolean", default: false, description: "Emit JSON." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const root = resolveStorePath(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    const hub = new SessionMeshHub(root);
    const info = { socket: meshSocketPath(root), sessions: hub.listSessions() };
    if (args.json) console.log(JSON.stringify(info));
    else console.log(`mesh ${info.socket} — ${info.sessions.length} sessions`);
  },
});

export const sessionMeshLogCommand = defineCommand({
  meta: { name: "log", description: "Show recent mesh broadcast events (in-memory log)." },
  args: {
    json: { type: "boolean", default: false, description: "Emit JSON array." },
    tail: { type: "string", description: "Number of recent events (default 20)." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const root = resolveStorePath(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    const hub = new SessionMeshHub(root);
    const tail = typeof args.tail === "string" ? Number(args.tail) : 20;
    const n = Number.isFinite(tail) && tail > 0 ? Math.floor(tail) : 20;
    const events = hub.log().slice(-n);
    if (args.json) console.log(JSON.stringify(events));
    else if (events.length === 0) console.log("no mesh events");
    else for (const e of events) console.log(JSON.stringify(e));
  },
});

export const sessionMeshCommand = defineCommand({
  meta: { name: "mesh", description: "Session mesh status/log (IPC)." },
  subCommands: {
    status: sessionMeshStatusCommand,
    log: sessionMeshLogCommand,
  },
});
