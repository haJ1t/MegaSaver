const HINT = /^ {0,8}\(use "git [^"\n]{1,120}"[^)\n]{0,80}\)$/;
const PORCELAIN = /^[ MADRCU?!]{2} \S/;
const MAX_PER_STATUS = 20;

// Human format: the `(use "git …")` coaching lines are pure boilerplate — the
// agent knows git. Porcelain: a same-status run past the cap is inventory,
// not evidence; the cap keeps the head and counts the rest.
export function compressGitStatus(text: string): string {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const out: string[] = [];
  let hints = 0;
  let runCode = "";
  let run: string[] = [];
  const flushRun = (): void => {
    out.push(...run.slice(0, MAX_PER_STATUS));
    if (run.length > MAX_PER_STATUS) {
      out.push(`… [${run.length - MAX_PER_STATUS} more ${runCode.trim()}]`);
    }
    run = [];
    runCode = "";
  };
  for (const line of lines) {
    if (HINT.test(line)) {
      hints += 1;
      continue;
    }
    const code = PORCELAIN.test(line) ? line.slice(0, 2) : "";
    if (code !== "" && code === runCode) {
      run.push(line);
      continue;
    }
    flushRun();
    if (code !== "") {
      runCode = code;
      run = [line];
      continue;
    }
    out.push(line);
  }
  flushRun();
  if (hints > 0) out.push(`… [${hints} hint lines]`);
  return out.join("\n");
}
