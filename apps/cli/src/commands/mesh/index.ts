import { defineCommand } from "citty";
import { meshClaimsCommand } from "./claims.js";
import { meshEventsCommand } from "./events.js";
import { meshGcCommand } from "./gc.js";
import { meshSendCommand } from "./send.js";
import { meshStatusCommand } from "./status.js";

export const meshCommand = defineCommand({
  meta: { name: "mesh", description: "Session mesh: presence, messaging, claims, events." },
  subCommands: {
    status: meshStatusCommand,
    send: meshSendCommand,
    claims: meshClaimsCommand,
    events: meshEventsCommand,
    gc: meshGcCommand,
  },
});

export { meshClaimsCommand } from "./claims.js";
export { meshEventsCommand } from "./events.js";
export { meshGcCommand } from "./gc.js";
export { meshSendCommand } from "./send.js";
export { meshStatusCommand } from "./status.js";
export { runMeshClaims } from "./claims.js";
export { runMeshEvents } from "./events.js";
export { runMeshGc } from "./gc.js";
export { runMeshSend } from "./send.js";
export { runMeshStatus } from "./status.js";
