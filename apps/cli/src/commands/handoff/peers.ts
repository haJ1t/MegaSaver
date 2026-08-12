import { readFileSync } from "node:fs";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../../store.js";
import { handoffFieldsFromPacket } from "./shared.js";

export type HandoffPeer = { sessionId: string; agent: string; status: string };

export type RunHandoffPeersInput = {
  now: () => number;
  packetPath: string | null;
  json: boolean;
  all: boolean;
  workspaceKey: string;
  listPeers: (filter: { workspaceKey?: string }) =>
    | Promise<readonly HandoffPeer[]>
    | readonly HandoffPeer[];
  readPacket: (path: string) => string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runHandoffPeers(input: RunHandoffPeersInput): Promise<0 | 1> {
  let peers: readonly HandoffPeer[];
  try {
    const result = await input.listPeers(input.all ? {} : { workspaceKey: input.workspaceKey });
    peers = result;
  } catch {
    input.stderr("error: session mesh not initialized — run: mega mesh status");
    return 1;
  }
  const { evaluateHandoffFit } = await import("@megasaver/connectors-shared");
  const { KNOWN_TARGETS } = await import("../../known-targets.js");

  let fields: ReturnType<typeof handoffFieldsFromPacket> | null = null;
  if (input.packetPath !== null) {
    const { HandoffPacketError, parseHandoffPacket } = await import("@megasaver/core");
    try {
      fields = handoffFieldsFromPacket(
        parseHandoffPacket(input.readPacket(input.packetPath), { now: input.now() }),
      );
    } catch (error) {
      if (error instanceof HandoffPacketError) {
        input.stderr(`error: ${error.message}`);
        return 1;
      }
      throw error;
    }
  }

  const rows = peers.map((peer) => {
    const target = KNOWN_TARGETS.find((t) => t.agentId === peer.agent);
    const verdict =
      target === undefined
        ? "no target"
        : fields === null
          ? "receivable"
          : evaluateHandoffFit({ fields, profile: target.handoff, mode: "strict" }).ok
            ? "fits"
            : "refuses (open needs --fit)";
    return { sessionId: peer.sessionId, agent: peer.agent, status: peer.status, verdict };
  });

  if (input.json) {
    input.stdout(JSON.stringify({ peers: rows }));
  } else {
    for (const row of rows) {
      input.stdout(`${row.sessionId}  ${row.agent}  ${row.status}  ${row.verdict}`);
    }
    if (rows.length === 0) input.stdout("no live peers");
  }
  return 0;
}

export const handoffPeersCommand = defineCommand({
  meta: { name: "peers", description: "List live mesh peers that can receive a handoff." },
  args: {
    packet: { type: "string", description: "Show each peer's fit verdict for this packet." },
    all: {
      type: "boolean",
      default: false,
      description: "List peers in every workspace, not just this repo's.",
    },
    json: { type: "boolean", default: false, description: "Emit the peer list as JSON." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const { listPeers } = await import("@megasaver/mesh");
    const { encodeWorkspaceKey } = await import("@megasaver/shared");
    const storeRoot = resolveStorePath(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    const cwd = process.cwd();
    const code = await runHandoffPeers({
      now: Date.now,
      packetPath: typeof args.packet === "string" ? args.packet : null,
      json: !!args.json,
      all: !!args.all,
      workspaceKey: encodeWorkspaceKey(cwd),
      listPeers: async (filter) =>
        listPeers(storeRoot, filter as never).map((p) => ({
          sessionId: p.liveSessionId,
          agent: p.agent,
          status: p.status,
        })),
      readPacket: (path) => readFileSync(path, "utf8"),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
