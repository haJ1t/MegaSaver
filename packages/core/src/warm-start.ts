import { estimateTokens } from "@megasaver/output-filter";
import { searchFailedAttempts } from "./failed-attempt-search.js";
import type { FailedAttempt } from "./failed-attempt.js";
import {
  type MemoryEntry,
  type MemoryType,
  effectiveConfidence,
  isRecallable,
} from "./memory-entry.js";
import { rankApplicableRules } from "./project-rule-ranking.js";
import type { ProjectRule } from "./project-rule.js";
import { changedFromFor } from "./supersession.js";

export type WarmStartMode = "micro" | "standard" | "reonboard";

export type GitDelta = {
  commits: { sha: string; subject: string; date: string }[];
  changedFiles: { path: string; churn: number }[];
  branch?: string | null;
};

export type WarmStartInput = {
  projectName: string;
  branch: string | null;
  now: string;
  budgetTokens?: number;
  mode?: WarmStartMode;
  lastSeenAt: string | null;
  reonboardUnlocked: boolean;
  timeless: boolean;
  memories: readonly MemoryEntry[];
  rules: readonly ProjectRule[];
  failedAttempts: readonly FailedAttempt[];
  gitDelta: GitDelta | null;
};

export type WarmStartBrief = {
  text: string;
  tokenEstimate: number;
  mode: WarmStartMode;
  sectionCounts: Record<string, number>;
};

export const DEFAULT_WARM_START_BUDGET = 2000;
export const MICRO_BUDGET = 300;
// ponytail: hardcoded thresholds (spec locked decision 3) — only budget is a flag
const MICRO_MS = 4 * 60 * 60 * 1000;
const REONBOARD_MS = 14 * 24 * 60 * 60 * 1000;
const SECTION_ITEM_CAP = 8;
const CLAMP_CHARS = 140;

export const REONBOARD_UPSELL_LINE =
  "Pro: expanded absence diff (what expired/changed while you were away) — mega license activate <key>.";

export function selectWarmStartMode(now: string, lastSeenAt: string | null): WarmStartMode {
  if (lastSeenAt === null) return "standard";
  const gap = Date.parse(now) - Date.parse(lastSeenAt);
  if (Number.isNaN(gap)) return "standard";
  if (gap < MICRO_MS) return "micro";
  if (gap > REONBOARD_MS) return "reonboard";
  return "standard";
}

function ageDays(now: string, iso: string): number {
  return Math.max(0, Math.floor((Date.parse(now) - Date.parse(iso)) / 86_400_000));
}

function clampSentence(content: string): string {
  const first = content.split(/(?<=[.!?])\s/)[0] ?? content;
  return first.length > CLAMP_CHARS ? `${first.slice(0, CLAMP_CHARS - 1)}…` : first;
}

function memLine(m: MemoryEntry, now: string, byId: ReadonlyMap<string, MemoryEntry>): string {
  const base = `- [${m.type}] ${m.title} — ${clampSentence(m.content)} (${m.confidence}, ${ageDays(now, m.updatedAt)}d)`;
  const changedFrom = changedFromFor(m, byId);
  if (changedFrom === undefined) return base;
  return `${base} (was: "${changedFrom.title}" until ${changedFrom.closedAt.slice(0, 10)})`;
}

type Section = { key: string; lines: string[] };

function byScore(now: string) {
  return (a: MemoryEntry, b: MemoryEntry): number =>
    effectiveConfidence(b, now) - effectiveConfidence(a, now) || a.id.localeCompare(b.id);
}

function memSection(
  key: string,
  heading: string,
  memories: readonly MemoryEntry[],
  type: MemoryType,
  now: string,
  byId: ReadonlyMap<string, MemoryEntry>,
): Section {
  const items = memories
    .filter((m) => m.type === type)
    .sort(byScore(now))
    .slice(0, SECTION_ITEM_CAP)
    .map((m) => memLine(m, now, byId));
  return { key, lines: items.length === 0 ? [] : ["", heading, ...items] };
}

function rulesSection(rules: readonly ProjectRule[]): Section {
  const ranked = rankApplicableRules(rules, { limit: SECTION_ITEM_CAP });
  const items = ranked.map(
    ({ rule }) => `- [${rule.severity}] ${rule.title}: ${clampSentence(rule.rule)}`,
  );
  return { key: "rules", lines: items.length === 0 ? [] : ["", "## Project rules", ...items] };
}

function failuresSection(attempts: readonly FailedAttempt[], gitDelta: GitDelta | null): Section {
  const recent = searchFailedAttempts(attempts, { limit: 20 });
  const changed = gitDelta === null ? null : new Set(gitDelta.changedFiles.map((f) => f.path));
  const relevant =
    changed === null
      ? recent.slice(0, 5)
      : recent.filter((a) => a.relatedFiles.some((f) => changed.has(f))).slice(0, SECTION_ITEM_CAP);
  const items = relevant.map(
    (a) =>
      `- tried: ${a.task} — failed at ${a.failedStep}${a.errorOutput === undefined ? "" : ` (${clampSentence(a.errorOutput)})`}`,
  );
  return {
    key: "failures",
    lines: items.length === 0 ? [] : ["", "## Do not retry (known failures)", ...items],
  };
}

function gitSection(gitDelta: GitDelta | null, expanded: boolean): Section {
  if (gitDelta === null || (gitDelta.commits.length === 0 && gitDelta.changedFiles.length === 0)) {
    return { key: "git", lines: [] };
  }
  const commitCap = expanded ? 15 : 5;
  const commits = gitDelta.commits.slice(0, commitCap).map((c) => `- ${c.sha} ${c.subject}`);
  const files = [...gitDelta.changedFiles]
    .sort((a, b) => b.churn - a.churn || a.path.localeCompare(b.path))
    .slice(0, 5)
    .map((f) => f.path)
    .join(", ");
  const lines = ["", `## Since your last visit (${gitDelta.commits.length} commits)`, ...commits];
  if (files.length > 0) lines.push(`- most-churned: ${files}`);
  return { key: "git", lines };
}

function entitiesSection(memories: readonly MemoryEntry[]): Section {
  const counts = new Map<string, number>();
  for (const m of memories) {
    for (const e of [...(m.relatedFiles ?? []), ...(m.relatedSymbols ?? [])]) {
      counts.set(e, (counts.get(e) ?? 0) + 1);
    }
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5);
  if (top.length === 0) return { key: "entities", lines: [] };
  return {
    key: "entities",
    lines: ["", `## Hot spots: ${top.map(([name, n]) => `${name} (${n})`).join(", ")}`],
  };
}

function absenceSection(
  memories: readonly MemoryEntry[],
  rules: readonly ProjectRule[],
  lastSeenAt: string,
  now: string,
): Section {
  const from = Date.parse(lastSeenAt);
  const to = Date.parse(now);
  const inWindow = (iso: string | null | undefined): boolean => {
    if (iso == null) return false;
    const t = Date.parse(iso);
    return t >= from && t < to;
  };
  const expired = memories
    .filter((m) => inWindow(m.validTo) || inWindow(m.expiresAt))
    .slice(0, SECTION_ITEM_CAP)
    .map((m) => `- expired/superseded: [${m.type}] ${m.title}`);
  const newRules = rules
    .filter((r) => inWindow(r.createdAt))
    .slice(0, SECTION_ITEM_CAP)
    .map((r) => `- new rule: ${r.title}`);
  const items = [...expired, ...newRules];
  return {
    key: "absence",
    lines: items.length === 0 ? [] : ["", "## Changed while you were away", ...items],
  };
}

export function assembleWarmStartBrief(input: WarmStartInput): WarmStartBrief {
  const now = input.now;
  const recallable = input.memories.filter((m) => isRecallable(m, now) && !m.stale);
  const mode = input.mode ?? selectWarmStartMode(now, input.lastSeenAt);
  const budget = input.budgetTokens ?? DEFAULT_WARM_START_BUDGET;
  const effectiveBudget = mode === "micro" ? Math.min(budget, MICRO_BUDGET) : budget;

  const visitAge =
    input.lastSeenAt === null ? "first visit" : `last visit ${ageDays(now, input.lastSeenAt)}d ago`;
  const headerLines = input.timeless
    ? [`# Warm Start — ${input.projectName}`]
    : [`# Warm Start — ${input.projectName} (${input.branch ?? "no branch"}, ${visitAge})`];
  if (mode === "reonboard" && !input.reonboardUnlocked) headerLines.push(REONBOARD_UPSELL_LINE);
  const header: Section = { key: "header", lines: headerLines };

  const rules = rulesSection(input.rules);
  // changedFrom lookups go over the UNFILTERED input.memories — the closed
  // predecessor is exactly the row the recallable filter drops.
  const byId = new Map<string, MemoryEntry>(input.memories.map((m) => [m.id, m]));
  const decisions = memSection(
    "decisions",
    "## Standing decisions",
    recallable,
    "decision",
    now,
    byId,
  );
  const todos = memSection("todos", "## Open todos", recallable, "todo", now, byId);
  const failures = failuresSection(input.failedAttempts, input.gitDelta);
  const git = gitSection(input.gitDelta, mode === "reonboard");
  const entities = entitiesSection(recallable);

  let sections: Section[];
  if (input.timeless) {
    sections = [header, rules, decisions, todos, failuresSection(input.failedAttempts, null)];
  } else if (mode === "micro") {
    sections = [header, rules, todos];
  } else if (mode === "reonboard" && input.reonboardUnlocked && input.lastSeenAt !== null) {
    sections = [
      header,
      absenceSection(input.memories, input.rules, input.lastSeenAt, now),
      git,
      rules,
      decisions,
      todos,
      failures,
    ];
  } else {
    sections = [header, rules, decisions, todos, failures, git, entities];
  }

  // Greedy fill with the invariant checked on the JOINED text after every
  // candidate line — per-item token sums drift from the joined estimate
  // (separators, headings), so this is the only sound check.
  const kept: string[] = [];
  const sectionCounts: Record<string, number> = {};
  outer: for (const section of sections) {
    let addedInSection = 0;
    for (const line of section.lines) {
      const candidate = [...kept, line].join("\n");
      if (estimateTokens(candidate) > effectiveBudget) {
        if (section.key === "header") break outer;
        break;
      }
      kept.push(line);
      if (line.startsWith("- ")) addedInSection += 1;
    }
    sectionCounts[section.key] = addedInSection;
  }

  const text = kept.join("\n");
  return { text, tokenEstimate: estimateTokens(text), mode, sectionCounts };
}
