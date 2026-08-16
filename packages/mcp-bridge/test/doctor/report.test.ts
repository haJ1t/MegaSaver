import { describe, expect, it } from "vitest";
import {
  type McpSecurityFinding,
  SEVERITY_RANK,
  compareFindings,
  mcpDoctorCheckIdSchema,
  mcpFindingCodeSchema,
  mcpFindingSeveritySchema,
  usageEvidenceSchema,
} from "../../src/doctor/report.js";

// Enum order contract (AA1 §8/§17): members alphabetic; closed-enum tripwire.
describe("doctor enums stay alphabetic", () => {
  for (const [label, schema] of [
    ["severity", mcpFindingSeveritySchema],
    ["checkId", mcpDoctorCheckIdSchema],
    ["findingCode", mcpFindingCodeSchema],
    ["usageEvidence", usageEvidenceSchema],
  ] as const) {
    it(`${label} options are sorted`, () => {
      expect([...schema.options]).toEqual([...schema.options].sort());
    });
  }
});

describe("compareFindings", () => {
  const base: McpSecurityFinding = {
    checkId: "config_surface",
    code: "non_localhost_url",
    severity: "medium",
    message: "m",
    remediation: "r",
  };
  it("ranks critical before info regardless of code order", () => {
    const info: McpSecurityFinding = { ...base, code: "evidence_gap", severity: "info" };
    const crit: McpSecurityFinding = {
      ...base,
      code: "config_world_writable",
      severity: "critical",
    };
    expect([info, crit].sort(compareFindings)[0]).toBe(crit);
  });
  it("breaks severity ties by code, then agent/server/tool", () => {
    const a: McpSecurityFinding = {
      ...base,
      code: "clone_exact",
      severity: "high",
      serverKey: "aaa",
    };
    const b: McpSecurityFinding = {
      ...base,
      code: "clone_exact",
      severity: "high",
      serverKey: "bbb",
    };
    const c: McpSecurityFinding = { ...base, code: "shadows_bridge_tool", severity: "high" };
    expect([c, b, a].sort(compareFindings)).toEqual([a, b, c]);
  });
  it("SEVERITY_RANK covers every severity member once", () => {
    expect(Object.keys(SEVERITY_RANK).sort()).toEqual([...mcpFindingSeveritySchema.options]);
  });
});
