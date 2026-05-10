import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ConventionsError } from "./errors.ts";

export type ResolveInput = {
  readonly conventionsDir: string;
  readonly source: string;
  readonly fragment: string | undefined;
};

export async function resolveSource(input: ResolveInput): Promise<string> {
  const fullPath = join(input.conventionsDir, input.source);
  let raw: string;
  try {
    raw = await readFile(fullPath, "utf8");
  } catch {
    throw new ConventionsError("source-missing", `cannot read ${fullPath}`);
  }
  const normalized = raw.replace(/\r\n/g, "\n");
  if (input.fragment === undefined) {
    return stripWrappingBlankLines(stripLeadingH1(normalized));
  }
  return extractFragment(normalized, input.fragment, fullPath);
}

function stripLeadingH1(text: string): string {
  // Convention files start with "# Title". The slim mirrors do not want
  // a duplicate H1 since the consumer file already provides one.
  const lines = text.split("\n");
  if (lines[0]?.startsWith("# ")) {
    let idx = 1;
    while (idx < lines.length && lines[idx]?.trim() === "") {
      idx += 1;
    }
    return lines.slice(idx).join("\n");
  }
  return text;
}

function stripWrappingBlankLines(text: string): string {
  return text.replace(/^\n+/, "").replace(/\n+$/, "");
}

function extractFragment(text: string, fragment: string, fullPath: string): string {
  const heading = `## ${fragment}`;
  const lines = text.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i] === heading) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) {
    throw new ConventionsError(
      "source-fragment-missing",
      `fragment "${fragment}" not found in ${fullPath}`,
    );
  }
  let end = lines.length;
  for (let j = start; j < lines.length; j += 1) {
    if (lines[j]?.startsWith("## ")) {
      end = j;
      break;
    }
  }
  return stripWrappingBlankLines(lines.slice(start, end).join("\n"));
}
