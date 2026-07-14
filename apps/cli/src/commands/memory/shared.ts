import type { MemoryEntry, MemoryValidation } from "@megasaver/core";
import { memoryEntryIdSchema } from "@megasaver/shared";
import { z } from "zod";
import { NAME_CONTROL_CHARS_MESSAGE } from "../../errors.js";

const SHOW_KEY_WIDTH = 12;
const EXPLAIN_KEY_WIDTH = 16;

// Citty yields a bare string for a single repeated flag and string[] for
// multiple; normalize both (and absent) to a string[] at the boundary.
export function toStringArray(value: unknown): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return typeof value === "string" ? [value] : [];
}

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
const APPROVAL_COLUMN_WIDTH = 9;
const CONTENT_TRUNCATE_AT = 60;

export function formatMemoryListLine(entry: {
  id: string;
  sessionId: string | null;
  scope: "project" | "session";
  approval: string;
  content: string;
}): string {
  const id = entry.id;
  const scope = entry.scope.padEnd(SCOPE_COLUMN_WIDTH, " ");
  const session = (entry.sessionId ?? "-").padEnd(SESSION_COLUMN_WIDTH, " ");
  const approval = entry.approval.padEnd(APPROVAL_COLUMN_WIDTH, " ");
  const content = truncate(entry.content, CONTENT_TRUNCATE_AT);
  return `${id}  ${scope}  ${session}  ${approval}  ${content}`;
}

function truncate(value: string, max: number): string {
  // W7: codepoint-only truncation accepted for v0.1; grapheme-aware via Intl.Segmenter deferred (low real-world impact, edge case for emoji content)
  if ([...value].length <= max) return value;
  return `${[...value].slice(0, max - 1).join("")}…`;
}

const TYPE_COLUMN_WIDTH = 15;
const CONFIDENCE_COLUMN_WIDTH = 6;
const TITLE_TRUNCATE_AT = 60;

export function formatMemorySearchLine(entry: {
  id: string;
  type: string;
  confidence: string;
  title: string;
}): string {
  const type = entry.type.padEnd(TYPE_COLUMN_WIDTH, " ");
  const confidence = entry.confidence.padEnd(CONFIDENCE_COLUMN_WIDTH, " ");
  const title = truncate(entry.title, TITLE_TRUNCATE_AT);
  return `${entry.id}  ${type}  ${confidence}  ${title}`;
}

export function formatMemoryExplainLines(entry: MemoryEntry): string[] {
  const list = (values: readonly string[] | undefined): string =>
    values && values.length > 0 ? values.join(", ") : "-";
  return [
    `${padExplain("id")}${entry.id}`,
    `${padExplain("type")}${entry.type}`,
    `${padExplain("title")}${entry.title}`,
    `${padExplain("scope")}${entry.scope}`,
    `${padExplain("session")}${entry.sessionId ?? "-"}`,
    `${padExplain("confidence")}${entry.confidence}`,
    `${padExplain("source")}${entry.source}`,
    `${padExplain("approval")}${entry.approval}`,
    `${padExplain("stale")}${entry.stale}`,
    `${padExplain("keywords")}${list(entry.keywords)}`,
    `${padExplain("content")}${entry.content}`,
    `${padExplain("reason")}${entry.reason ?? "-"}`,
    `${padExplain("goal")}${entry.goal ?? "-"}`,
    `${padExplain("evidence")}${list(entry.evidence)}`,
    `${padExplain("relatedFiles")}${list(entry.relatedFiles)}`,
    `${padExplain("relatedSymbols")}${list(entry.relatedSymbols)}`,
    `${padExplain("createdAt")}${entry.createdAt}`,
    `${padExplain("updatedAt")}${entry.updatedAt}`,
    `${padExplain("expiresAt")}${entry.expiresAt ?? "-"}`,
  ];
}

function padExplain(key: string): string {
  return key.padEnd(EXPLAIN_KEY_WIDTH, " ");
}

export function formatMemoryValidationLines(v: MemoryValidation | null): string[] {
  if (v === null) {
    return [`${padExplain("validationStatus")}unvalidated`];
  }
  return [
    `${padExplain("validationStatus")}${v.validationStatus}`,
    `${padExplain("validatedAt")}${v.validatedAt}`,
    `${padExplain("validatedBy")}${v.validatedBy}`,
    `${padExplain("policyVersion")}${v.policyVersion}`,
    `${padExplain("reasons")}${v.reasons.length > 0 ? v.reasons.join(", ") : "-"}`,
    `${padExplain("conflictIds")}${v.conflictIds.length > 0 ? v.conflictIds.join(", ") : "-"}`,
  ];
}

// Shared by the search/list --as-of gates: one sentence, two commands.
export const MEMORY_AS_OF_UPSELL =
  "Time-travel queries (--as-of) are a Mega Saver Pro feature. Activate a key: mega license activate <key>.";

export function formatMemoryLineageLines(
  entry: MemoryEntry,
  all: readonly MemoryEntry[],
): string[] {
  const lines: string[] = [];
  if (entry.validFrom !== undefined) lines.push(`${padExplain("validFrom")}${entry.validFrom}`);
  if (entry.validTo != null) lines.push(`${padExplain("validTo")}${entry.validTo}`);
  if (entry.supersedesId !== undefined) {
    lines.push(`${padExplain("supersedesId")}${entry.supersedesId}`);
    const predecessor = all.find((e) => e.id === entry.supersedesId);
    if (predecessor !== undefined) {
      lines.push(`${padExplain("supersedes")}${predecessor.id} ("${predecessor.title}")`);
    }
  }
  const successor = all
    .filter((e) => e.supersedesId === entry.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (successor !== undefined) {
    lines.push(`${padExplain("supersededBy")}${successor.id} ("${successor.title}")`);
  }
  return lines;
}
