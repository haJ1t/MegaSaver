import type { KeyObject } from "node:crypto";
import {
  MEGASAVER_PUBLIC_KEY,
  activateLicense,
  deactivateLicense,
  licenseStatus,
} from "@megasaver/entitlement";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../store.js";

export type RunLicenseActivateInput = {
  key: string;
  storeRoot: string;
  publicKey: KeyObject | string;
  now: () => number;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export function runLicenseActivate(input: RunLicenseActivateInput): 0 | 1 {
  const result = activateLicense(input.storeRoot, input.key, {
    publicKey: input.publicKey,
    now: input.now,
  });
  if (!result.ok) {
    input.stderr(`error: license rejected (${result.reason})`);
    return 1;
  }
  const expiry = result.expiresAt === null ? "no expiry" : `expires ${result.expiresAt}`;
  input.stdout(`Pro activated — tier: ${result.tier} (${expiry}).`);
  return 0;
}

export type RunLicenseStatusInput = {
  storeRoot: string;
  publicKey: KeyObject | string;
  now: () => number;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export function runLicenseStatus(input: RunLicenseStatusInput): 0 | 1 {
  const status = licenseStatus(input.storeRoot, { publicKey: input.publicKey, now: input.now });
  if (status.active) {
    const expiry = status.expiresAt === null ? "no expiry" : `expires ${status.expiresAt}`;
    input.stdout(`Pro (active) — tier: ${status.tier} (${expiry}).`);
    return 0;
  }
  if (status.reason === "no_license") {
    input.stdout("no license (free).");
    return 0;
  }
  if (status.reason === "corrupt") {
    input.stdout("license present but invalid — re-activate: mega license activate <key>.");
    return 0;
  }
  input.stdout(`no license (free) — stored key ${status.reason}.`);
  return 0;
}

export type RunLicenseDeactivateInput = {
  storeRoot: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export function runLicenseDeactivate(input: RunLicenseDeactivateInput): 0 | 1 {
  deactivateLicense(input.storeRoot);
  input.stdout("License removed. Pro features are now locked.");
  return 0;
}

const licenseActivateCommand = defineCommand({
  meta: { name: "activate", description: "Activate a Mega Saver Pro license key." },
  args: {
    key: { type: "positional", required: true, description: "The msp_ license key." },
    store: { type: "string", description: "Override store directory." },
  },
  run({ args }) {
    const code = runLicenseActivate({
      key: typeof args.key === "string" ? args.key : "",
      storeRoot: resolveStorePath(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ),
      publicKey: MEGASAVER_PUBLIC_KEY,
      now: () => Date.now(),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});

const licenseStatusCommand = defineCommand({
  meta: { name: "status", description: "Show the current license status." },
  args: {
    store: { type: "string", description: "Override store directory." },
  },
  run({ args }) {
    const code = runLicenseStatus({
      storeRoot: resolveStorePath(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ),
      publicKey: MEGASAVER_PUBLIC_KEY,
      now: () => Date.now(),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});

const licenseDeactivateCommand = defineCommand({
  meta: { name: "deactivate", description: "Remove the stored license." },
  args: {
    store: { type: "string", description: "Override store directory." },
  },
  run({ args }) {
    const code = runLicenseDeactivate({
      storeRoot: resolveStorePath(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});

export const licenseCommand = defineCommand({
  meta: {
    name: "license",
    description: "Manage the Mega Saver Pro license: activate, status, deactivate.",
  },
  subCommands: {
    activate: licenseActivateCommand,
    status: licenseStatusCommand,
    deactivate: licenseDeactivateCommand,
  },
});
