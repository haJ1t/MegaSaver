import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compileGlob } from "../src/secret-paths.js";

// The pre-fix implementation, frozen verbatim as the equivalence oracle. It is
// NOT imported from src — it no longer exists there. Keeping the old body here
// is what makes "the LOCKED §9a denylist still decides every path the same way"
// a checkable claim rather than an assertion.
function legacyCompileGlob(glob: string): RegExp {
  let body = "";
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          body += "(?:.*/)?";
          i += 2;
        } else {
          body += ".*";
          i += 1;
        }
      } else {
        body += "[^/]*";
      }
    } else if (char === "?") {
      body += "[^/]";
    } else if (char === ".") {
      body += "\\.";
    } else {
      body += char;
    }
  }
  return new RegExp(`^${body}$`, "i");
}

const DENYLIST_GLOBS = [
  "**/.env",
  "**/.env.*",
  "**/.ssh/**",
  "**/.aws/credentials",
  "**/.aws/config",
  "**/.gcp/**",
  "**/.azure/**",
  "**/private_keys/**",
  "**/secrets/**",
  "**/id_rsa",
  "**/id_ed25519",
  "**/*.pem",
  "**/*.key",
  "**/credentials.json",
  "**/service-account*.json",
] as const;

const PATHS = [
  ".env",
  "a/.env",
  "a/b/.env",
  "a/.env.local",
  ".env.local",
  "x.env",
  ".envx",
  ".ssh/id_rsa",
  "home/u/.ssh/known_hosts",
  "home/u/.ssh/x/y/z",
  ".ssh",
  ".ssh/",
  "home/.aws/credentials",
  "home/.aws/config",
  "home/.aws/configx",
  "home/.gcp/keys/k.json",
  "home/.azure/t.json",
  "vault/private_keys/s.key",
  "app/secrets/db.txt",
  "secrets/db.txt",
  "home/.ssh/id_rsa",
  "id_rsa",
  "id_ed25519",
  "certs/server.pem",
  "server.pem",
  "certs/server.key",
  "config/credentials.json",
  "credentials.json",
  "config/service-account-prod.json",
  "service-account.json",
  "SERVER.PEM",
  "Home/.SSH/id_rsa",
  "src/index.ts",
  "README.md",
  "",
  "/",
  "a//b",
] as const;

describe("compileGlob — LOCKED §9a denylist verdicts are unchanged", () => {
  for (const glob of DENYLIST_GLOBS) {
    it(`${glob} decides every fixture path identically`, () => {
      const legacy = legacyCompileGlob(glob);
      const matcher = compileGlob(glob);
      for (const path of PATHS) {
        expect({ path, hit: matcher.test(path) }).toEqual({
          path,
          hit: legacy.test(path),
        });
      }
    });
  }
});

// Segment corpus deliberately seeded with the real secret basenames. A path
// built from a generic alphabet essentially never matches a denylist glob —
// measured 0/20,000 — which would make the property vacuous: it would only ever
// compare false===false and could not fail. Joining these segments lands 5.0%
// genuine matches instead.
const SEGMENTS = [
  "a",
  "b",
  "home",
  ".env",
  ".env.local",
  ".ssh",
  "id_rsa",
  "id_ed25519",
  ".aws",
  "credentials",
  "config",
  ".gcp",
  ".azure",
  "private_keys",
  "secrets",
  "server.pem",
  "server.key",
  "credentials.json",
  "service-account-prod.json",
  "x.txt",
  "",
] as const;

describe("compileGlob — property equivalence on metachar-free input", () => {
  // Restricted to the alphabet where the two implementations are SUPPOSED to
  // agree. Outside it they diverge on purpose: that divergence is the fix, and
  // it is pinned by glob-redos.test.ts instead.
  const wideGlob = fc.stringOf(fc.constantFrom(..."ab.-_/*?".split("")), { maxLength: 12 });
  const widePath = fc.stringOf(fc.constantFrom(..."ab.-_/".split("")), { maxLength: 20 });

  // A three-character alphabet at short lengths is what makes random globs and
  // random paths actually collide (7.4% match rate vs 1.2% on the wide one).
  const denseGlob = fc.stringOf(fc.constantFrom(..."ab/*?".split("")), { maxLength: 6 });
  const densePath = fc.stringOf(fc.constantFrom(..."ab/".split("")), { maxLength: 6 });

  it("agrees with the frozen regex on wide-alphabet globs and paths", () => {
    fc.assert(
      fc.property(wideGlob, widePath, (glob, path) => {
        expect(compileGlob(glob).test(path)).toBe(legacyCompileGlob(glob).test(path));
      }),
      { numRuns: 20_000 },
    );
  });

  it("agrees on a dense alphabet where random globs and paths collide", () => {
    fc.assert(
      fc.property(denseGlob, densePath, (glob, path) => {
        expect(compileGlob(glob).test(path)).toBe(legacyCompileGlob(glob).test(path));
      }),
      { numRuns: 20_000 },
    );
  });

  it("agrees on segment-corpus paths against each LOCKED denylist glob", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...DENYLIST_GLOBS),
        fc.array(fc.constantFrom(...SEGMENTS), { minLength: 1, maxLength: 4 }),
        (glob, segments) => {
          const path = segments.join("/");
          expect(compileGlob(glob).test(path)).toBe(legacyCompileGlob(glob).test(path));
        },
      ),
      { numRuns: 20_000 },
    );
  });
});
