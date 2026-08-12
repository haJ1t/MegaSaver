import type { KeyObject } from "node:crypto";
import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { defineCommand } from "citty";
import {
  type EnsureStoreReadyResult,
  ensureStoreReady,
  readStoreEnv,
  resolveStorePath,
} from "../../store.js";
import { findProjectByCwd } from "../warmup.js";
import { MAX_PACKET_BYTES, gate, handoffFieldsFromPacket } from "./shared.js";

export type HandoffOfferPointer = {
  packetPath: string;
  payloadSha256: string;
  targetAgent: string;
  expiresAt: string;
  sourceProject: string;
};

export type SendHandoffOffer = (input: {
  toSession: string;
  offer: HandoffOfferPointer;
}) => Promise<{ ok: true } | { ok: false; error: string }>;

export type RunHandoffOfferInput = {
  storeRoot: string;
  cwd: string;
  now: () => number;
  publicKey?: KeyObject | string;
  filePath: string;
  toSession: string;
  json: boolean;
  sendOffer: SendHandoffOffer;
  ensureStore: () => Promise<EnsureStoreReadyResult>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runHandoffOffer(input: RunHandoffOfferInput): Promise<0 | 1> {
  if (!gate(input)) return 0;

  let packetText: string;
  try {
    if (statSync(input.filePath).size > MAX_PACKET_BYTES) {
      input.stderr(`error: packet exceeds ${MAX_PACKET_BYTES} bytes`);
      return 1;
    }
    packetText = readFileSync(input.filePath, "utf8");
  } catch {
    input.stderr(`error: cannot read packet at ${input.filePath}`);
    return 1;
  }

  const { HandoffPacketError, parseHandoffPacket } = await import("@megasaver/core");
  let packet: ReturnType<typeof parseHandoffPacket>;
  try {
    packet = parseHandoffPacket(packetText, { now: input.now() });
  } catch (error) {
    if (error instanceof HandoffPacketError) {
      input.stderr(`error: ${error.message}`);
      return 1;
    }
    throw error;
  }

  const { evaluateHandoffFit } = await import("@megasaver/connectors-shared");
  const { KNOWN_TARGETS } = await import("../../known-targets.js");
  const target = KNOWN_TARGETS.find((t) => t.id === packet.manifest.targetAgent);
  if (target === undefined) {
    input.stderr(`error: packet targets unknown agent "${packet.manifest.targetAgent}"`);
    return 1;
  }
  const fit = evaluateHandoffFit({
    fields: handoffFieldsFromPacket(packet),
    profile: target.handoff,
    mode: "strict",
  });
  if (!fit.ok) {
    input.stderr(
      `error: refusing to offer — ${target.id} would refuse it (${fit.refusals
        .map((r) => r.reason)
        .join(", ")}); re-pack or let the receiver open with --fit`,
    );
    return 1;
  }

  const offer: HandoffOfferPointer = {
    packetPath: resolve(input.filePath),
    payloadSha256: packet.manifest.payloadSha256,
    targetAgent: packet.manifest.targetAgent,
    expiresAt: packet.manifest.expiresAt,
    sourceProject: packet.manifest.sourceProject.name,
  };
  const result = await input.sendOffer({ toSession: input.toSession, offer });
  if (!result.ok) {
    input.stderr(`error: mesh send failed: ${result.error}`);
    return 1;
  }

  try {
    const { registry } = await input.ensureStore();
    const project = findProjectByCwd(registry.listProjects(), input.cwd);
    if (project !== null) {
      const { appendHandoffEvent } = await import("@megasaver/core");
      appendHandoffEvent(
        { root: input.storeRoot },
        {
          id: randomUUID(),
          projectId: project.id,
          kind: "offer",
          targetAgent: packet.manifest.targetAgent,
          memories: packet.manifest.counts.memories,
          failures: packet.manifest.counts.failures,
          redactionFindings: packet.manifest.redactionFindings,
          createdAt: new Date(input.now()).toISOString(),
        },
      );
    }
  } catch {
    // advisory only
  }

  const doneLine = `offered ${offer.packetPath} to ${input.toSession} — the receiving operator applies it with: mega handoff open ${offer.packetPath}`;
  if (input.json)
    input.stdout(JSON.stringify({ offered: true, offer, toSession: input.toSession }));
  else input.stdout(doneLine);
  return 0;
}

export const handoffOfferCommand = defineCommand({
  meta: {
    name: "offer",
    description: "Offer a packed handoff to a live mesh peer (pointer only).",
  },
  args: {
    file: { type: "positional", required: true, description: "Path to a .megahandoff packet." },
    "to-session": { type: "string", required: true, description: "Receiving mesh session id." },
    from: {
      type: "string",
      description: 'Sender mesh session id (defaults to "cli", the mega mesh send convention).',
    },
    json: { type: "boolean", default: false, description: "Emit the offer report as JSON." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const { listPeers, sendMessage } = await import("@megasaver/mesh");
    const { encodeWorkspaceKey } = await import("@megasaver/shared");
    const storeRoot = resolveStorePath(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    const cwd = process.cwd();
    const code = await runHandoffOffer({
      storeRoot,
      cwd,
      now: Date.now,
      filePath: String(args.file),
      toSession: String(args["to-session"]),
      json: !!args.json,
      sendOffer: async ({ toSession, offer }) => {
        const live = listPeers(storeRoot, {} as never).some((p) => p.liveSessionId === toSession);
        if (!live) return { ok: false, error: `no live mesh session "${toSession}"` };
        const sent = sendMessage(storeRoot, {
          workspaceKey: encodeWorkspaceKey(cwd),
          from: typeof args.from === "string" ? args.from : "cli",
          to: toSession,
          kind: "handoff-offer",
          text: `handoff offer: ${offer.packetPath} (target ${offer.targetAgent}, expires ${offer.expiresAt}) — inspect with: mega handoff inspect ${offer.packetPath}`,
          offer,
        });
        return sent === undefined ? { ok: false, error: "mesh send failed" } : { ok: true };
      },
      ensureStore: () => ensureStoreReady(storeRoot),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
