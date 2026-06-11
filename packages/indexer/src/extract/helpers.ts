import { createHash } from "node:crypto";

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// camelCase / delimiter split → lowercased, de-duplicated keyword tokens.
export function tokenize(name: string): string[] {
  return [
    ...new Set(
      name
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .split(/[^A-Za-z0-9]+/)
        .map((token) => token.toLowerCase())
        .filter((token) => token.length > 0),
    ),
  ];
}
