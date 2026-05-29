import { projectIdSchema } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { type EvaluatePathReadResult, evaluatePathRead } from "../src/evaluate-path-read.js";

const PROJECT = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");

function evalPath(path: string): EvaluatePathReadResult {
  return evaluatePathRead({ path, project: PROJECT });
}

describe("evaluatePathRead — secret-path denylist (spec §4a)", () => {
  const denied: ReadonlyArray<readonly [string, string]> = [
    ["**/.env", "project/.env"],
    ["**/.env.*", "project/.env.local"],
    ["**/.ssh/**", "home/.ssh/known_hosts"],
    ["**/.aws/credentials", "home/.aws/credentials"],
    ["**/.aws/config", "home/.aws/config"],
    ["**/.gcp/**", "home/.gcp/keys/key.json"],
    ["**/.azure/**", "home/.azure/accessTokens.json"],
    ["**/private_keys/**", "vault/private_keys/server.key"],
    ["**/secrets/**", "app/secrets/db.txt"],
    ["**/id_rsa", "home/.ssh/id_rsa"],
    ["**/id_ed25519", "home/keys/id_ed25519"],
    ["**/*.pem", "certs/server.pem"],
    ["**/*.key", "certs/server.key"],
    ["**/credentials.json", "config/credentials.json"],
    ["**/service-account*.json", "config/service-account-prod.json"],
  ];

  for (const [pattern, path] of denied) {
    it(`denies secret_path_read for ${pattern} via ${path}`, () => {
      expect(evalPath(path)).toEqual({ allowed: false, reason: "secret_path_read" });
    });
  }

  // `**/` must match zero-or-more leading segments, so root-level
  // secret files (no directory prefix) are denied at gate 1.
  const deniedRoot: ReadonlyArray<readonly [string, string]> = [
    ["**/.env", ".env"],
    ["**/.env.*", ".env.local"],
    ["**/id_rsa", "id_rsa"],
    ["**/id_ed25519", "id_ed25519"],
    ["**/*.pem", "server.pem"],
    ["**/*.key", "server.key"],
    ["**/credentials.json", "credentials.json"],
    ["**/service-account*.json", "service-account-prod.json"],
    ["**/secrets/**", "secrets/db.txt"],
    ["**/.ssh/**", ".ssh/id_rsa"],
    ["**/private_keys/**", "private_keys/x"],
  ];

  for (const [pattern, path] of deniedRoot) {
    it(`denies secret_path_read for ${pattern} via root path ${path}`, () => {
      expect(evalPath(path)).toEqual({ allowed: false, reason: "secret_path_read" });
    });
  }

  it("matches case-insensitively", () => {
    expect(evalPath("Project/.ENV")).toEqual({
      allowed: false,
      reason: "secret_path_read",
    });
  });

  it("treats backslash as a path separator", () => {
    expect(evalPath("home\\.ssh\\id_rsa")).toEqual({
      allowed: false,
      reason: "secret_path_read",
    });
  });
});

describe("evaluatePathRead — allow + reason policy (spec §4, §4b)", () => {
  it("allows a benign project-relative path", () => {
    expect(evalPath("src/index.ts")).toEqual({ allowed: true });
  });

  it("never emits path_denied", () => {
    const probes = ["src/index.ts", "project/.env", "home/.ssh/id_rsa", "../../etc/x"];
    for (const path of probes) {
      const result = evalPath(path);
      if (result.allowed === false) {
        expect(result.reason).not.toBe("path_denied");
      }
    }
  });
});
