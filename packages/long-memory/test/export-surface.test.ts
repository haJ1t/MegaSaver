import { expect, it } from "vitest";
import * as lm1Recall from "../src/lm1-recall.js";
import * as lm2SecureFs from "../src/lm2-secure-fs.js";

it("keeps LM1 recall tuning constants module-internal", () => {
  const exported = Object.keys(lm1Recall);

  expect(exported).not.toContain("MAX_LM1_RECORDS_SCANNED");
  expect(exported).not.toContain("MAX_LM1_CANDIDATES");
  expect(exported).not.toContain("MAX_LM1_EVIDENCE_LOOKUPS");
  expect(exported).not.toContain("MAX_LM1_TOKEN_BUDGET");
});

it("exposes no unconsumed LM2 directory traversal helper", () => {
  expect(Object.keys(lm2SecureFs)).not.toContain("listAnchoredDirectory");
});
