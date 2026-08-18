import { execFileSync } from "node:child_process";
import {
  closeSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import type { DeriveSeams } from "./derive.js";

const MAX_READ_SIZE = 1024 * 1024; // 1 MiB
const HEAD_BUFFER_SIZE = 2048; // 2 KiB

export function createDefaultDeriveSeams(root: string): DeriveSeams {
  return {
    listTrackedFiles: () => {
      try {
        const out = execFileSync("git", ["ls-files", "-z"], {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        return out.split("\0").filter((f) => f.length > 0);
      } catch {
        return null;
      }
    },
    readFileHead: (relPath: string) => {
      const fullPath = join(root, relPath);
      try {
        const st = statSync(fullPath);
        if (!st.isFile() || st.size > MAX_READ_SIZE) {
          return null;
        }
        const fd = openSync(fullPath, "r");
        try {
          const buf = Buffer.alloc(HEAD_BUFFER_SIZE);
          const bytesRead = readSync(fd, buf, 0, HEAD_BUFFER_SIZE, 0);
          return buf.subarray(0, bytesRead).toString("utf8");
        } finally {
          closeSync(fd);
        }
      } catch {
        return null;
      }
    },
    dirExists: (relPath: string) => {
      const fullPath = join(root, relPath);
      try {
        const st = statSync(fullPath);
        return st.isDirectory();
      } catch {
        return false;
      }
    },
    readGitattributes: () => {
      const fullPath = join(root, ".gitattributes");
      try {
        return readFileSync(fullPath, "utf8");
      } catch {
        return null;
      }
    },
  };
}
