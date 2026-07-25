import { readFileSync, statSync } from "node:fs";
import type { ProjectId } from "@megasaver/shared";
import { defineCommand } from "citty";
import { HANDOFF_BADGE_NOTE, MAX_PACKET_BYTES } from "./shared.js";

// evaluatePathRead's `project` field is a vestigial label the function never
// reads (context-gate read.ts:122); inspect has no project context.
const INSPECT_PROJECT_ID = "00000000-0000-4000-8000-000000000000" as ProjectId;
const VERIFIED_QUALIFIER = "sender anchor — not yet checked against this repo";

export type RunHandoffInspectInput = {
  filePath: string;
  now: () => number;
  json: boolean;
  /** Override for tests; defaults to MAX_PACKET_BYTES. */
  maxPacketBytes?: number;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runHandoffInspect(input: RunHandoffInspectInput): Promise<0 | 1> {
  const cap = input.maxPacketBytes ?? MAX_PACKET_BYTES;
  let text: string;
  try {
    if (statSync(input.filePath).size > cap) {
      input.stderr(`error: packet exceeds ${cap} bytes`);
      return 1;
    }
    text = readFileSync(input.filePath, "utf8");
  } catch {
    input.stderr(`error: cannot read packet at ${input.filePath}`);
    return 1;
  }

  const { diagnoseHandoffPacket, verificationBadgeFor } = await import("@megasaver/core");
  const { evaluatePathRead, redactWithFindings } = await import("@megasaver/policy");
  const diag = diagnoseHandoffPacket(text, { now: input.now() });

  // The report is derived from the PAYLOAD, not manifest self-claims: an
  // honest packet was redacted and path-filtered at pack time, so any
  // recomputed finding means the manifest cannot be trusted.
  let recomputed: {
    redactionFindings: number;
    secretPaths: string[];
    badges: { memoryId: string; badge: string }[];
    resume: string;
    summary: string;
  } | null = null;
  let mismatch = false;
  if (diag.parsedPayload !== undefined) {
    const p = diag.parsedPayload;
    const resume = redactWithFindings(p.resumeInstructions);
    const summary = redactWithFindings(p.taskSummary.text);
    const rest = [
      p.git?.diff === null || p.git === null ? "" : p.git.diff.text,
      ...p.failures.flatMap((f) => [
        f.task,
        f.failedStep,
        f.errorOutput ?? "",
        f.suspectedCause ?? "",
        f.resolution ?? "",
      ]),
      ...p.memories.flatMap((m) => [m.title, m.content]),
    ];
    const redactionFindings =
      resume.count + summary.count + rest.reduce((n, t) => n + redactWithFindings(t).count, 0);
    const secretPaths = (p.git?.changedFiles ?? [])
      .map((f) => f.path)
      .filter((path) => !evaluatePathRead({ path, project: INSPECT_PROJECT_ID }).allowed);
    const badges = p.memories.map((m) => ({
      memoryId: m.id,
      badge: verificationBadgeFor(m),
    }));
    recomputed = {
      redactionFindings,
      secretPaths,
      badges,
      resume: resume.redacted,
      summary: summary.redacted,
    };
    if (diag.parsedManifest !== undefined) {
      // Scoped to security-relevant claims only (redactions/secret paths and
      // the entry counts a reviewer trusts); diffFiles/commits are cosmetic and
      // would just add false-positive warnings.
      mismatch =
        redactionFindings > 0 ||
        secretPaths.length > 0 ||
        diag.parsedManifest.counts.memories !== p.memories.length ||
        diag.parsedManifest.counts.failures !== p.failures.length;
    }
  }

  if (input.json) {
    input.stdout(
      JSON.stringify({
        version: diag.version,
        manifest: diag.manifest,
        hash: diag.hash,
        expiry: diag.expiry,
        payloadSchema: diag.payloadSchema,
        mismatch,
        ...(recomputed === null
          ? {}
          : {
              recomputed: {
                redactionFindings: recomputed.redactionFindings,
                secretPaths: recomputed.secretPaths,
                badges: recomputed.badges,
              },
              badgeNote: HANDOFF_BADGE_NOTE,
            }),
      }),
    );
    if (mismatch) {
      input.stderr("warning: payload scan disagrees with manifest claims");
    }
    return 0;
  }

  input.stdout(`version: ${diag.version}`);
  input.stdout(`manifest: ${diag.manifest}`);
  input.stdout(`hash: ${diag.hash}`);
  input.stdout(`expiry: ${diag.expiry}`);
  input.stdout(`payload: ${diag.payloadSchema}`);
  if (diag.parsedManifest !== undefined) {
    const m = diag.parsedManifest;
    // sourceProject.name is free-form (z.string) and NOT hash-protected, so a
    // hostile packet embeds newlines/ANSI to forge verdict lines onto this
    // trust surface; scrub control chars before printing (schema stays open).
    const projectName = Array.from(m.sourceProject.name, (ch) =>
      ch < " " || ch === "\u007f" ? " " : ch,
    ).join("");
    input.stdout(
      `from ${m.sourceAgent} to ${m.targetAgent} | project ${projectName} | expires ${m.expiresAt}`,
    );
    input.stdout(
      `manifest claims: redactions ${m.redactionFindings} | secret paths ${m.secretPathsExcluded} | memories ${m.counts.memories} | failures ${m.counts.failures}`,
    );
  }
  if (recomputed !== null) {
    input.stdout(
      `recomputed: redactions ${recomputed.redactionFindings} | secret paths ${recomputed.secretPaths.length}`,
    );
    for (const b of recomputed.badges) {
      const note = b.badge === "verified" ? ` (${VERIFIED_QUALIFIER})` : "";
      input.stdout(`badge: ${b.memoryId} ${b.badge}${note}`);
    }
    if (mismatch) {
      input.stderr("warning: payload scan disagrees with manifest claims");
    }
    input.stdout("--- resume ---");
    input.stdout(recomputed.resume);
    input.stdout("--- summary ---");
    input.stdout(recomputed.summary);
  }
  return 0;
}

export const handoffInspectCommand = defineCommand({
  meta: {
    name: "inspect",
    description: "Report a .megahandoff packet's integrity, redaction scan, and payload (free).",
  },
  args: {
    file: { type: "positional", required: true, description: "Path to the .megahandoff packet." },
    json: { type: "boolean", default: false, description: "Emit the report as JSON." },
  },
  async run({ args }) {
    const code = await runHandoffInspect({
      filePath: String(args.file),
      now: () => Date.now(),
      json: !!args.json,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
