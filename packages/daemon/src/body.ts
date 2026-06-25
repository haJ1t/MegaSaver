import type { IncomingMessage } from "node:http";

// 16 MiB default cap: tool outputs can be large (the whole point), but an
// unbounded reader is a trivial local DoS. Empty body → {} so zod surfaces a
// structured validation error instead of a JSON.parse throw.
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;

export function readJsonBody(req: IncomingMessage, maxBytes = DEFAULT_MAX_BYTES): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("request body too large"));
        // Guarded: real IncomingMessage is a Readable with destroy(); the test
        // fake is a bare EventEmitter without it.
        if (typeof req.destroy === "function") req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}
