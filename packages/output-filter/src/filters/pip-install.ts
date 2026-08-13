const SATISFIED = /^Requirement already satisfied: /;
const DOWNLOAD = /^ {0,8}(?:Downloading|Using cached) \S/;

export function compressPipInstall(text: string): string {
  const lines = text.split("\n");
  const trailing = text.endsWith("\n");
  if (lines.at(-1) === "") lines.pop();
  const out: string[] = [];
  let satisfied = 0;
  let downloads = 0;
  for (const line of lines) {
    if (SATISFIED.test(line)) {
      satisfied += 1;
      if (satisfied === 1) out.push(line);
      continue;
    }
    if (DOWNLOAD.test(line)) {
      downloads += 1;
      continue;
    }
    out.push(line);
  }
  if (satisfied > 1) out.push(`… [${satisfied - 1} already satisfied]`);
  if (downloads > 0) out.push(`… [${downloads} download lines]`);
  return out.join("\n") + (trailing ? "\n" : "");
}
