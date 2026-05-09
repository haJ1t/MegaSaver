import { z } from "zod";
import { NAME_CONTROL_CHARS_MESSAGE } from "../../errors.js";

// Shared title schema — reused by create.ts and update.ts.
// C0/C1 control chars and DEL break the line-oriented output protocol.
export const titleSchema = z
  .string()
  .trim()
  .min(1)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional
  .regex(/^[^\x00-\x1f\x7f-\x9f]+$/, NAME_CONTROL_CHARS_MESSAGE)
  .transform((value) => value.normalize("NFC"));

/**
 * Read a deterministic test-injection env var. Returns the raw string
 * value only when NODE_ENV is "test"; in production builds the env var
 * is silently ignored so a leaked `MEGA_TEST_*` shell export cannot
 * override `randomUUID()` or `Date.now()`. Vitest sets NODE_ENV=test
 * automatically.
 */
export function readTestEnv(name: string): string | undefined {
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  if (process.env["NODE_ENV"] !== "test") return undefined;
  const raw = process.env[name];
  return typeof raw === "string" ? raw : undefined;
}

export function formatSessionLine(session: {
  id: string;
  agentId: string;
  riskLevel: string;
  title: string | null;
}): string {
  return `${session.id}  ${session.agentId}  ${session.riskLevel}  ${session.title ?? "-"}`;
}

const SHOW_KEY_WIDTH = 12;

export function formatShowLines(session: {
  id: string;
  projectId: string;
  agentId: string;
  riskLevel: string;
  title: string | null;
  startedAt: string;
  endedAt: string | null;
}): string[] {
  const pairs: Array<[string, string]> = [
    ["id", session.id],
    ["project", session.projectId],
    ["agent", session.agentId],
    ["risk", session.riskLevel],
    ["title", session.title ?? "-"],
    ["startedAt", session.startedAt],
    ["endedAt", session.endedAt ?? "-"],
  ];
  return pairs.map(([key, value]) => `${key.padEnd(SHOW_KEY_WIDTH, " ")}${value}`);
}
