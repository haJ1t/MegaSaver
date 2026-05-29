import { z } from "zod";

export const derivedIntentSourceSchema = z.enum([
  "auto",
  "command",
  "explicit",
  "file-path",
  "recent-memory",
  "session-title",
]);
export type DerivedIntentSource = z.infer<typeof derivedIntentSourceSchema>;

export type DerivedIntent = {
  query: string;
  keywords: readonly string[];
  source: DerivedIntentSource;
};

export type DeriveIntentInput = {
  intent?: string;
  sessionTitle?: string;
  recentMemory?: readonly string[];
  source?:
    | { kind: "command"; command: string; args: readonly string[] }
    | { kind: "file"; path: string }
    | { kind: "grep"; query: string }
    | { kind: "fetch"; url: string };
};

const RECENT_MEMORY_LIMIT = 3;

function tokenize(query: string): readonly string[] {
  const seen = new Set<string>();
  for (const token of query.toLowerCase().split(/\W+/)) {
    if (token.length > 0) {
      seen.add(token);
    }
  }
  return [...seen];
}

function build(query: string, source: DerivedIntentSource): DerivedIntent {
  return { query, keywords: tokenize(query), source };
}

export function deriveIntent(input: DeriveIntentInput): DerivedIntent {
  const intent = input.intent?.trim();
  if (intent) {
    return build(intent, "explicit");
  }

  const sessionTitle = input.sessionTitle?.trim();
  if (sessionTitle) {
    return build(sessionTitle, "session-title");
  }

  const recent = input.recentMemory?.slice(0, RECENT_MEMORY_LIMIT) ?? [];
  if (recent.length > 0) {
    return build(recent.join(" "), "recent-memory");
  }

  const source = input.source;
  if (source?.kind === "command") {
    const firstArg = source.args[0];
    const query = firstArg ? `${source.command} ${firstArg}` : source.command;
    return build(query, "command");
  }

  if (source?.kind === "file") {
    const base = source.path.split("/").pop() ?? source.path;
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    return build(stem, "file-path");
  }

  return { query: "", keywords: [], source: "auto" };
}
