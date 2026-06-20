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

  // \r?\n throughout so CRLF wiki pages parse identically to LF.
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fm) {
    const lines = (fm[1] as string).split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = (lines[i] as string).replace(/\r$/, "");
      const m = line.match(/^([A-Za-z_]+):\s*(.*)$/);
      if (!m) continue;
      const key = m[1] as string;
      const rest = (m[2] as string).trim();
      const collectList = (): string[] => {
        if (rest.startsWith("[")) return parseInlineArray(rest);
        const out: string[] = [];
        while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1] as string)) {
          out.push(
            stripQuotes((lines[++i] as string).replace(/\r$/, "").replace(/^\s*-\s+/, "")).trim(),
          );
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
        .map((mm) => {
          let s = (mm[1] as string).trim();
          // Reject [[wikilink]]-shaped refs — they are page links, not file paths.
          if (s.startsWith("[[")) return null;
          // Strip wrapping backticks or quotes added by wiki authors.
          if (
            (s.startsWith("`") && s.endsWith("`")) ||
            (s.startsWith("'") && s.endsWith("'")) ||
            (s.startsWith('"') && s.endsWith('"'))
          ) {
            s = s.slice(1, -1).trim();
          }
          // Strip a trailing space-separated Obsidian/markdown anchor before the
          // line-number strip so `path.md:12 #8` collapses to `path.md`; the file
          // node must unify with the same path cited without an anchor.
          s = s.replace(/\s+#\S.*$/, "").trim();
          // Strip line number suffix including ranges (ASCII hyphen or en-dash).
          s = s.replace(/:\d+(?:[-–]\d+)?$/, "").trim();
          // Canonicalize leading ./
          if (s.startsWith("./")) s = s.slice(2);
          return s;
        })
        .filter((s): s is string => s !== null && looksLikePath(s)),
    ),
  ];

  return { path: relPath, title, tags, status, links, sources, fileCites };
}
