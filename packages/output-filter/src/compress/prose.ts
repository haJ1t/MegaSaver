// Extractive prose/markdown compressor. Deterministic, no model.
// Only changes what is RETURNED — raw text persists in ChunkSet as-is.
//
// Rules:
//   - Every ATX heading kept verbatim.
//   - First paragraph per section kept verbatim; extra paragraphs collapsed
//     to "… [N paragraphs]".
//   - Fenced code blocks (``` ... ```) and indented code kept verbatim.
//   - Bullet/numbered lists: keep first 3 items + "… [N more items]" for the rest.
//   - Short docs (≤500 chars, ≤5 body paragraphs) pass through unchanged.

const ATX_HEADING = /^#{1,6} /;
const FENCE_OPEN = /^```/;
const BULLET_ITEM = /^[-*+] /;
const NUMBERED_ITEM = /^\d+\. /;
const BLOCKQUOTE = /^> /;
const INDENTED_CODE = /^ {4}/;

const SHORT_DOC_MAX_CHARS = 500;
const SHORT_DOC_MAX_PARAS = 5;
const LIST_KEEP_FIRST = 3;

type Block =
  | { type: "heading"; line: string }
  | { type: "fence"; lines: string[] }
  | { type: "paragraph"; lines: string[] }
  | { type: "list"; items: string[] }
  | { type: "blockquote"; lines: string[] }
  | { type: "blank" };

function parseBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] as string;

    if (line.trim() === "") {
      blocks.push({ type: "blank" });
      i++;
      continue;
    }

    if (ATX_HEADING.test(line)) {
      blocks.push({ type: "heading", line });
      i++;
      continue;
    }

    if (FENCE_OPEN.test(line)) {
      const fenceLines = [line];
      i++;
      while (i < lines.length) {
        const fl = lines[i] as string;
        fenceLines.push(fl);
        i++;
        // closing fence: a ``` line that isn't the opening line
        if (FENCE_OPEN.test(fl) && fenceLines.length > 1) break;
      }
      blocks.push({ type: "fence", lines: fenceLines });
      continue;
    }

    if (BLOCKQUOTE.test(line)) {
      const bqLines = [line];
      i++;
      while (i < lines.length && BLOCKQUOTE.test(lines[i] as string)) {
        bqLines.push(lines[i] as string);
        i++;
      }
      blocks.push({ type: "blockquote", lines: bqLines });
      continue;
    }

    if (BULLET_ITEM.test(line) || NUMBERED_ITEM.test(line)) {
      const items = [line];
      i++;
      while (i < lines.length) {
        const nl = lines[i] as string;
        if (BULLET_ITEM.test(nl) || NUMBERED_ITEM.test(nl)) {
          items.push(nl);
          i++;
        } else if (nl.startsWith("  ") && nl.trim() !== "") {
          // list-item continuation
          items[items.length - 1] += `\n${nl}`;
          i++;
        } else {
          break;
        }
      }
      blocks.push({ type: "list", items });
      continue;
    }

    // ponytail: indented code treated same as a fence block (verbatim)
    if (INDENTED_CODE.test(line)) {
      const codeLines = [line];
      i++;
      while (
        i < lines.length &&
        (INDENTED_CODE.test(lines[i] as string) || (lines[i] as string).trim() === "")
      ) {
        codeLines.push(lines[i] as string);
        i++;
      }
      blocks.push({ type: "fence", lines: codeLines });
      continue;
    }

    // Regular paragraph — accumulate until a structural break
    const paraLines = [line];
    i++;
    while (i < lines.length) {
      const nl = lines[i] as string;
      if (
        nl.trim() === "" ||
        ATX_HEADING.test(nl) ||
        FENCE_OPEN.test(nl) ||
        BULLET_ITEM.test(nl) ||
        NUMBERED_ITEM.test(nl) ||
        BLOCKQUOTE.test(nl)
      ) {
        break;
      }
      paraLines.push(nl);
      i++;
    }
    blocks.push({ type: "paragraph", lines: paraLines });
  }

  return blocks;
}

export function compressProse(text: string): string {
  const blocks = parseBlocks(text);

  // Short-doc pass-through: only when nothing would actually be compressed.
  // A list with >LIST_KEEP_FIRST items would be compressed even in a small doc,
  // so the pass-through only fires when there are no such lists.
  const paraCount = blocks.filter((b) => b.type === "paragraph").length;
  const hasLongList = blocks.some((b) => b.type === "list" && b.items.length > LIST_KEEP_FIRST);
  if (!hasLongList && text.length <= SHORT_DOC_MAX_CHARS && paraCount <= SHORT_DOC_MAX_PARAS) {
    return text;
  }

  const out: string[] = [];
  let parasSeenInSection = 0;
  let pendingParas = 0;

  const flushPendingParas = () => {
    if (pendingParas > 0) {
      out.push(`… [${pendingParas} paragraph${pendingParas === 1 ? "" : "s"}]`);
      pendingParas = 0;
    }
  };

  for (const block of blocks) {
    switch (block.type) {
      case "heading":
        flushPendingParas();
        parasSeenInSection = 0;
        out.push(block.line);
        break;

      case "fence":
      case "blockquote":
        flushPendingParas();
        out.push(...block.lines);
        break;

      case "paragraph":
        parasSeenInSection++;
        if (parasSeenInSection === 1) {
          flushPendingParas();
          out.push(block.lines.join("\n"));
        } else {
          pendingParas++;
        }
        break;

      case "list":
        flushPendingParas();
        if (block.items.length <= LIST_KEEP_FIRST) {
          out.push(...block.items);
        } else {
          out.push(...block.items.slice(0, LIST_KEEP_FIRST));
          const tail = block.items.length - LIST_KEEP_FIRST;
          out.push(`… [${tail} more item${tail === 1 ? "" : "s"}]`);
        }
        break;

      case "blank":
        if (pendingParas === 0) out.push("");
        break;
    }
  }

  flushPendingParas();
  return out.join("\n");
}
