import { z } from "zod";

// C0/C1 control chars and DEL break the CLI line-oriented output
// protocol. U+2028 (LINE SEPARATOR) and U+2029 (PARAGRAPH SEPARATOR)
// are blocked because JS engines treat them as line terminators in
// source text. The error message MUST match NAME_CONTROL_CHARS_MESSAGE
// in apps/cli/src/errors.ts (NAME_CONTROL_CHARS_MESSAGE = "name must not contain
// control characters") so the CLI error-mapper keeps discriminating the regex-
// failure case by string equality. The word "name" is intentional — it is the
// value of that constant, shared across project, memory, and session schemas.
export const titleSchema = z
  .string()
  .trim()
  .min(1)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional
  .regex(/^[^\x00-\x1f\x7f-\x9f\u2028\u2029]+$/, "name must not contain control characters")
  .transform((value) => value.normalize("NFC"));

export type Title = z.infer<typeof titleSchema>;
