import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { Lm2Error } from "./lm2-errors.js";
import { type DirectoryAnchor, readAnchoredFile } from "./lm2-secure-fs.js";

export type ExactAnchoredFileRead = {
  raw: Buffer;
  stat: Stats;
  contentDigest: string;
};

export function readExactAnchoredFile(input: {
  anchor: DirectoryAnchor;
  name: string;
  expectedSerialized: string;
  expectedContentDigest: string;
  maximumBytes: number;
}): ExactAnchoredFileRead {
  const read = readAnchoredFile(input.anchor, input.name, input.maximumBytes);
  if (read.status !== "valid") {
    throw new Lm2Error("index_lock_unavailable", "LM2 durable replacement is unavailable.");
  }
  const expected = Buffer.from(input.expectedSerialized, "utf8");
  const contentDigest = createHash("sha256").update(read.raw).digest("hex");
  if (
    contentDigest !== input.expectedContentDigest ||
    read.raw.byteLength !== expected.byteLength ||
    !read.raw.equals(expected)
  ) {
    throw new Lm2Error("index_lock_unavailable", "LM2 durable replacement content changed.");
  }
  return { raw: read.raw, stat: read.stat, contentDigest };
}
