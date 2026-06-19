import type { WikiInput } from "./inputs.js";

function stripQuotes(s: string): string {
  const t = s.trim();
  return (t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))
    ? t.slice(1, -1)
    : t;
}

function parseInlineArray(s: string): string[] {
  const t = s.trim();
  if (!t.startsWith("[") || !t.endsWith("]")) return [];
  return t
    .slice(1, -1)
    .split(",")
    .map((x) => stripQuotes(x).trim())
    .filter((x) => x.length > 0);
}

function basename(relPath: string): string {
  const last = relPath.split("/").pop() ?? relPath;
  return last.endsWith(".md") ? last.slice(0, -3) : last;
}

function looksLikePath(s: string): boolean {
  return s.includes("/") || /\.[A-Za-z0-9]+$/.test(s);
}

export function parseWikiPage(relPath: string, content: string): WikiInput {
  let title = basename(relPath);
  const tags: string[] = [];
  const sources: string[] = [];
  let status = "active";

  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (fm) {
    const lines = (fm[1] as string).split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as string;
      const m = line.match(/^([A-Za-z_]+):\s*(.*)$/);
      if (!m) continue;
      const key = m[1] as string;
      const rest = (m[2] as string).trim();
      const collectList = (): string[] => {
        if (rest.startsWith("[")) return parseInlineArray(rest);
        const out: string[] = [];
        while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1] as string)) {
          out.push(stripQuotes((lines[++i] as string).replace(/^\s*-\s+/, "")).trim());
        }
        return out;
      };
      if (key === "title") title = stripQuotes(rest) || title;
      else if (key === "status") status = stripQuotes(rest) || status;
      else if (key === "tags") tags.push(...collectList());
      else if (key === "sources") sources.push(...collectList());
    }
  }

  const body = fm ? content.slice((fm[0] as string).length) : content;
  const links = [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((mm) => {
    const ref = mm[1] as string;
    const withoutAlias = ref.split("|")[0] ?? ref;
    return (withoutAlias.split("#")[0] ?? withoutAlias).trim();
  });
  const fileCites = [
    ...new Set(
      [...body.matchAll(/\(source:\s*([^)]+)\)/g)]
        .map((mm) => (mm[1] as string).trim().replace(/:\d+$/, "").trim())
        .filter(looksLikePath),
    ),
  ];

  return { path: relPath, title, tags, status, links, sources, fileCites };
}
