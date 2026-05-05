export type Check = {
  key: string;
  value: string;
  pass: boolean;
  reason?: string;
};

export function checkNode(version: string = process.versions.node): Check {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  const value = `v${version}`;
  if (major >= 22) {
    return { key: "node", value, pass: true };
  }
  return { key: "node", value, pass: false, reason: "need ≥22" };
}
