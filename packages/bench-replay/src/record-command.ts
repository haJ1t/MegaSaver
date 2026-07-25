// Verbatim from the TASKS array in scripts/run-megasaver-claude-limit-test.sh.
// The whole point of replaying these is to compare against the benchmark results
// already saved for them, so a reworded prompt silently invalidates that
// comparison; a test re-reads the shell script and asserts these stay identical.
export const TASK_PROMPTS = [
  "Add a date picker to the event creation form.",
  "Add a completed flag to events with a toggle endpoint and UI checkbox.",
  "Add rate limiting to POST /api/events so users can create at most 5 events per minute.",
  "Deleting an event does not update the UI list. Find the root cause and fix it.",
] as const;

// Mirrors FIRST_PARTY_FLAG in packages/connectors/claude-code/src/proxy-route.ts
// (not exported from that package's public surface, so it cannot be imported; a
// test asserts the two spellings stay in sync). Claude Code drops to a
// non-first-party mode for ANY custom ANTHROPIC_BASE_URL — tools inlined, hook
// output past the last cache_control breakpoint, cold-cache rewrites — which
// cost 2.6x in this repo's own forensic investigation. A recording made without
// this flag freezes that distorted cache pattern into every replay of it.
export const FIRST_PARTY_FLAG = "_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL";

export type RecordCommand = {
  bin: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
};

// Pure so the flags that decide whether a recording is valid can be asserted
// without spawning an agent or spending a cent.
export function buildRecordCommand(input: {
  claudeBin: string;
  prompt: string;
  repoDir: string;
  proxyUrl: string;
  baseEnv: Readonly<Record<string, string | undefined>>;
}): RecordCommand {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.baseEnv)) {
    if (v !== undefined) env[k] = v;
  }

  return {
    bin: input.claudeBin,
    args: [
      // `--settings` MERGES onto the discovered sources rather than replacing
      // them, so an empty `--setting-sources` is the only thing that keeps
      // ~/.claude/settings.json — and with it MegaSaver's `mega hooks` PostToolUse
      // saver — out of the recording. Recorded with the saver live, the
      // tool_results are ALREADY compressed: the "baseline" arm becomes secretly a
      // megasaver run, the megasaver arm becomes a double-compression, and the
      // ratio collapses toward 1.00 reading as a clean "no effect".
      "--setting-sources",
      "",
      "--add-dir",
      input.repoDir,
      "--dangerously-skip-permissions",
      // Emits the real `usage` block that becomes this conversation's own
      // same-conversation cost reference (end-to-end.json).
      "--output-format",
      "json",
      "-p",
      input.prompt,
    ],
    env: {
      ...env,
      ANTHROPIC_BASE_URL: input.proxyUrl,
      [FIRST_PARTY_FLAG]: "1",
    },
  };
}
