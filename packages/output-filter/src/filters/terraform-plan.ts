const CREATED = /^ {0,8}# \S{1,200} will be created$/;
const OPENER = /^( {0,8})\+ resource "/;

// A create block's attribute body is derivable intent, not diff evidence;
// update/destroy blocks show real state change and pass through whole. If a
// closer is never found (shape drift) the count runs to EOF — degraded but
// counted, never silently dropped.
export function compressTerraformPlan(text: string): string {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    const open = OPENER.exec(line);
    const prev = i > 0 ? (lines[i - 1] as string) : "";
    if (open !== null && CREATED.test(prev)) {
      const closer = `${open[1] ?? ""}  }`;
      out.push(line);
      i += 1;
      let attrs = 0;
      while (i < lines.length && (lines[i] as string).trimEnd() !== closer) {
        attrs += 1;
        i += 1;
      }
      if (attrs > 0) out.push(`… [${attrs} attributes]`);
      continue;
    }
    out.push(line);
    i += 1;
  }
  return out.join("\n");
}
