import { createHash } from "node:crypto";
import { createServer } from "node:http";

export type S3DoubleEntry = { body: Buffer; etag: string };
export type S3Double = {
  url: string;
  store: Map<string, S3DoubleEntry>;
  close: () => Promise<void>;
};

// Minimal S3-compatible double: path-style /<bucket>/<key>, ETag,
// conditional PUT (If-Match / If-None-Match: *) with S3-style XML errors.
// enforce:false makes it IGNORE conditional headers — simulates a provider
// that does not enforce conditional writes (probe-failure path).
export async function startS3Double(options?: { enforce?: boolean }): Promise<S3Double> {
  const enforce = options?.enforce ?? true;
  const store = new Map<string, S3DoubleEntry>();
  const server = createServer((req, res) => {
    const rawPath = (req.url ?? "").split("?")[0] ?? "";
    const key = decodeURIComponent(rawPath.replace(/^\/[^/]+\//, ""));
    const xml = (code: string) =>
      `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`;

    if (req.method === "GET") {
      const entry = store.get(key);
      if (entry === undefined) {
        res.writeHead(404, { "content-type": "application/xml" }).end(xml("NoSuchKey"));
        return;
      }
      res
        .writeHead(200, { etag: entry.etag, "content-length": String(entry.body.length) })
        .end(entry.body);
      return;
    }

    if (req.method === "DELETE") {
      store.delete(key);
      res.writeHead(204).end();
      return;
    }

    if (req.method === "PUT") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk as Buffer));
      req.on("end", () => {
        const existing = store.get(key);
        const ifMatch = req.headers["if-match"];
        const ifNoneMatch = req.headers["if-none-match"];
        if (enforce && ifNoneMatch === "*" && existing !== undefined) {
          res.writeHead(412, { "content-type": "application/xml" }).end(xml("PreconditionFailed"));
          return;
        }
        if (
          enforce &&
          typeof ifMatch === "string" &&
          (existing === undefined || existing.etag !== ifMatch)
        ) {
          res.writeHead(412, { "content-type": "application/xml" }).end(xml("PreconditionFailed"));
          return;
        }
        const body = Buffer.concat(chunks);
        const etag = `"${createHash("md5").update(body).digest("hex")}"`;
        store.set(key, { body, etag });
        res.writeHead(200, { etag }).end();
      });
      return;
    }

    res.writeHead(405).end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    store,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
