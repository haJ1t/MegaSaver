import { memoryEntryIdSchema } from "@megasaver/shared";
import { z } from "zod";
import { NAME_CONTROL_CHARS_MESSAGE } from "../../errors.js";

const SHOW_KEY_WIDTH = 12;

export const contentSchema = z
  .string()
  .trim()
  .min(1)
  // C0/C1 control chars and DEL break the line-oriented output protocol.
  // U+2028 (LINE SEPARATOR) and U+2029 (PARAGRAPH SEPARATOR) are also blocked:
  // they are treated as line terminators by JS engines and break downstream rendering.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional
  .regex(/^[^\x00-\x1f\x7f-\x9f\u2028\u2029]+$/, NAME_CONTROL_CHARS_MESSAGE)
  .transform((value) => value.normalize("NFC"));

export { memoryEntryIdSchema };

export function formatMemoryShowLines(entry: {
  id: string;
  projectId: string;
  sessionId: string | null;
  scope: "project" | "session";
  content: string;
  createdAt: string;
}): string[] {
  return [
    `${pad("id")}${entry.id}`,
    `${pad("project")}${entry.projectId}`,
    `${pad("session")}${entry.sessionId ?? "-"}`,
    `${pad("scope")}${entry.scope}`,
    `${pad("content")}${entry.content}`,
    `${pad("createdAt")}${entry.createdAt}`,
  ];
}

function pad(key: string): string {
  return key.padEnd(SHOW_KEY_WIDTH, " ");
}

const SCOPE_COLUMN_WIDTH = 7;
const SESSION_COLUMN_WIDTH = 36;
const CONTENT_TRUNCATE_AT = 60;

export function formatMemoryListLine(entry: {
  id: string;
  sessionId: string | null;
  scope: "project" | "session";
  content: string;
}): string {
  const id = entry.id;
  const scope = entry.scope.padEnd(SCOPE_COLUMN_WIDTH, " ");
  const session = (entry.sessionId ?? "-").padEnd(SESSION_COLUMN_WIDTH, " ");
  const content = truncate(entry.content, CONTENT_TRUNCATE_AT);
  return `${id}  ${scope}  ${session}  ${content}`;
}

function truncate(value: string, max: number): string {
  // W7: codepoint-only truncation accepted for v0.1; grapheme-aware via Intl.Segmenter deferred (low real-world impact, edge case for emoji content)
  if ([...value].length <= max) return value;
  return `${[...value].slice(0, max - 1).join("")}…`;
}
