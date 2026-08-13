import type { CompressorName } from "../compress/index.js";
import { compressDockerPs } from "./docker-ps.js";
import { compressGitLog } from "./git-log.js";
import { compressGitStatus } from "./git-status.js";

export type CommandFilterIntegrity = "line-subset" | "rewrite";

export interface CommandFilter {
  name: CompressorName;
  command: RegExp;
  integrity: CommandFilterIntegrity;
  // The exact structural forms this filter may synthesize. Declared at the
  // emitter and consumed by both the conformance harness and the W4
  // no-fabrication allowlist, so the two can never drift apart.
  markers: readonly RegExp[];
  compress(text: string): string;
}

// Ordered, first-match-wins; the order is append-only (observable contract).
export const COMMAND_FILTERS: readonly CommandFilter[] = [
  {
    name: "git-status",
    command: /\bgit\s+status\b/,
    integrity: "line-subset",
    markers: [/^… \[\d+ more [MADRCU?!]{1,2}\]$/, /^… \[\d+ hint lines\]$/],
    compress: compressGitStatus,
  },
  {
    name: "git-log",
    command: /\bgit\s+log\b/,
    integrity: "line-subset",
    markers: [/^… \[\d+ commits omitted\]$/],
    compress: compressGitLog,
  },
  {
    name: "docker-ps",
    command: /\bdocker\s+ps\b/,
    integrity: "line-subset",
    markers: [/^… \[\d+ similar: [^\]\n]{1,200}\]$/],
    compress: compressDockerPs,
  },
];

export const COMMAND_FILTER_MARKERS: readonly RegExp[] = COMMAND_FILTERS.flatMap(
  (f) => f.markers,
);

export function matchCommandFilter(command: string): CommandFilter | undefined {
  return COMMAND_FILTERS.find((f) => f.command.test(command));
}
