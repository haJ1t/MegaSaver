import { describe, expect, it } from "vitest";
import { COMMAND_FILTERS } from "../../src/filters/index.js";
import { compressTerraformPlan } from "../../src/filters/terraform-plan.js";
import { assertFilterConformance } from "./conformance.js";

const filter = COMMAND_FILTERS.find((f) => f.name === "terraform-plan");
if (filter === undefined) throw new Error("terraform-plan not registered");

const attr = (k: string, v: string): string => `      + ${k.padEnd(24)} = ${v}`;
const PLAN = [
  "Terraform will perform the following actions:",
  "",
  "  # aws_instance.web will be created",
  '  + resource "aws_instance" "web" {',
  attr("ami", '"ami-0f1e2d3c4b5a69788"'),
  attr("instance_type", '"t3.micro"'),
  attr("subnet_id", '"subnet-0aa1bb2cc3dd4ee5f"'),
  ...Array.from({ length: 15 }, (_, i) => attr(`attribute_${i}`, "(known after apply)")),
  "    }",
  "",
  "  # aws_security_group.web will be updated in-place",
  '  ~ resource "aws_security_group" "web" {',
  '      ~ description = "old" -> "new"',
  "    }",
  "",
  "Plan: 1 to add, 1 to change, 0 to destroy.",
].join("\n");

describe("terraform-plan filter", () => {
  it("collapses created-resource attribute bodies, keeps updates whole", () => {
    const out = assertFilterConformance(filter, PLAN);
    expect(out).toContain("  # aws_instance.web will be created");
    expect(out).toContain('  + resource "aws_instance" "web" {');
    expect(out).not.toContain("ami-0f1e2d3c4b5a69788");
    expect(out).toContain("… [18 attributes]");
    expect(out).toContain('      ~ description = "old" -> "new"');
    expect(out).toContain("Plan: 1 to add, 1 to change, 0 to destroy.");
  });

  it("passes non-plan text through verbatim", () => {
    expect(compressTerraformPlan("No changes. Your infrastructure matches.")).toBe(
      "No changes. Your infrastructure matches.",
    );
  });
});
