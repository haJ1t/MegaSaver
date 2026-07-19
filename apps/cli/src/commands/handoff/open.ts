import { type KeyObject, randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { defineCommand } from "citty";
import { invalidTargetMessage } from "../../errors.js";
import {
  type EnsureStoreReadyResult,
  ensureStoreReady,
  readStoreEnv,
  resolveStorePath,
} from "../../store.js";
import { findProjectByCwd } from "../warmup.js";
import { gate } from "./shared.js";

const MAX_PACKET_BYTES = 10 * 1024 * 1024;

export type RunHandoffOpenInput = {
  storeRoot: string;
  cwd: string;
  now: () => number;
  publicKey?: KeyObject | string;
  filePath: string;
  merge: boolean;
  json: boolean;
  /** Override for tests; defaults to MAX_PACKET_BYTES. */
  maxPacketBytes?: number;
  /** Override for tests; defaults to crypto.randomUUID. */
  newId?: () => string;
  ensureStore: () => Promise<EnsureStoreReadyResult>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runHandoffOpen(input: RunHandoffOpenInput): Promise<0 | 1> {
  if (!gate(input)) return 0;

  const { registry } = await input.ensureStore();
  const project = findProjectByCwd(registry.listProjects(), input.cwd);
  if (project === null) {
    input.stderr(`error: no project matches ${input.cwd} — run: mega init`);
    return 1;
  }

  const cap = input.maxPacketBytes ?? MAX_PACKET_BYTES;
  let packetText: string;
  try {
    // ponytail: TOCTOU — file could grow between stat and read; acceptable for a
    // local single-user CLI (brain-import precedent).
    if (statSync(input.filePath).size > cap) {
      input.stderr(`error: packet exceeds ${cap} bytes`);
      return 1;
    }
    packetText = readFileSync(input.filePath, "utf8");
  } catch {
    input.stderr(`error: cannot read packet at ${input.filePath}`);
    return 1;
  }

  // Lazy import after the gate: never load core's handoff surface on the free path.
  const { HandoffPacketError, appendHandoffEvent, applyHandoffMemories, parseHandoffPacket } =
    await import("@megasaver/core");
  const { redactWithFindings } = await import("@megasaver/policy");
  const {
    ConnectorError,
    readTargetFile,
    renderHandoffBlockText,
    upsertHandoffBlockText,
    writeTargetFile,
  } = await import("@megasaver/connectors-shared");
  const { KNOWN_TARGETS } = await import("../../known-targets.js");

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

  const target = KNOWN_TARGETS.find((t) => t.id === packet.manifest.targetAgent);
  if (target === undefined) {
    input.stderr(invalidTargetMessage(packet.manifest.targetAgent).message);
    return 1;
  }

  // Open-side redaction (untrusted path): a hostile or older-weaker-redaction
  // packet must never persist raw secrets into a user file.
  const git = packet.payload.git;
  const gitLineRaw =
    git === null
      ? null
      : `branch ${git.branch}${git.headSha === null ? "" : ` @ ${git.headSha}`}${git.dirty ? " (dirty)" : ""}`;
  const resume = redactWithFindings(packet.payload.resumeInstructions);
  const summary = redactWithFindings(packet.payload.taskSummary.text);
  const gitLine = gitLineRaw === null ? null : redactWithFindings(gitLineRaw);
  const diff = git === null || git.diff === null ? null : redactWithFindings(git.diff.text);
  const openFindings = resume.count + summary.count + (gitLine?.count ?? 0) + (diff?.count ?? 0);

  const absPath = join(project.rootPath, target.relativePath);
  try {
    const block = renderHandoffBlockText({
      resumeInstructions: resume.redacted,
      summaryText: summary.redacted,
      gitLine: gitLine === null ? null : gitLine.redacted,
      diffText: diff === null ? null : diff.redacted,
      expiresAt: packet.manifest.expiresAt,
    });
    const existing = await readTargetFile(absPath);
    const seed = existing ?? ("header" in target ? (target.header ?? "") : "");
    const content = upsertHandoffBlockText(seed, block);
    if (existing === null) {
      await mkdir(dirname(absPath), { recursive: true });
    }
    await writeTargetFile({ absPath, content });
  } catch (error) {
    if (error instanceof ConnectorError) {
      input.stderr(`error: ${error.message}`);
      return 1;
    }
    throw error;
  }

  const mergeReport = input.merge
    ? applyHandoffMemories({
        registry,
        projectId: project.id,
        packet,
        now: input.now(),
        newId: input.newId ?? randomUUID,
      })
    : null;

  try {
    appendHandoffEvent(
      { root: input.storeRoot },
      {
        id: (input.newId ?? randomUUID)(),
        projectId: project.id,
        kind: "open",
        targetAgent: target.id,
        // payload lengths, not manifest counts: the manifest is attacker-writable
        memories: packet.payload.memories.length,
        failures: packet.payload.failures.length,
        redactionFindings: openFindings,
        createdAt: new Date(input.now()).toISOString(),
      },
    );
  } catch {
    // stats are advisory — never fail the open over a bad event write
  }

  if (openFindings > 0) {
    input.stderr(`warning: open-side redaction replaced ${openFindings} secret(s) from the packet`);
  }
  if (input.json) {
    input.stdout(
      JSON.stringify({
        status: "opened",
        target: target.id,
        path: absPath,
        expiresAt: packet.manifest.expiresAt,
        redactionFindings: openFindings,
        ...(mergeReport === null
          ? {}
          : {
              merge: {
                ...mergeReport,
                badgeNote:
                  "badges reflect sender-supplied anchors, not yet checked against this repo",
              },
            }),
      }),
    );
    return 0;
  }
  input.stdout(
    `applied handoff from ${packet.manifest.sourceAgent} to ${target.relativePath} (expires ${packet.manifest.expiresAt})`,
  );
  if (mergeReport !== null) {
    input.stdout(
      `merged ${mergeReport.imported} memories (suggested, skipped ${mergeReport.skipped}) — run: mega memory approve`,
    );
  }
  return 0;
}

export const handoffOpenCommand = defineCommand({
  meta: {
    name: "open",
    description: "Apply a .megahandoff packet as a HANDOFF block (Mega Saver Pro).",
  },
  args: {
    file: { type: "positional", required: true, description: "Path to the .megahandoff packet." },
    merge: {
      type: "boolean",
      default: false,
      description: "Also import packet memories as suggested knowledge.",
    },
    json: { type: "boolean", default: false, description: "Emit the open report as JSON." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeRoot = resolveStorePath(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    const code = await runHandoffOpen({
      storeRoot,
      cwd: process.cwd(),
      now: () => Date.now(),
      filePath: String(args.file),
      merge: !!args.merge,
      json: !!args.json,
      ensureStore: () => ensureStoreReady(storeRoot),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
