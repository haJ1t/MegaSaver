import { describe, expect, it } from "vitest";
import { COMMAND_FILTERS } from "../../src/filters/index.js";
import { compressPipInstall } from "../../src/filters/pip-install.js";
import { assertFilterConformance } from "./conformance.js";

const filter = COMMAND_FILTERS.find((f) => f.name === "pip-install");
if (filter === undefined) throw new Error("pip-install not registered");

const PIP = [
  "Collecting requests==2.32.3",
  "  Downloading requests-2.32.3-py3-none-any.whl (64 kB)",
  ...Array.from(
    { length: 12 },
    (_, i) =>
      `Requirement already satisfied: dep-${i} in ./venv/lib/python3.12/site-packages (1.0.${i})`,
  ),
  "Collecting urllib3<3,>=1.21.1",
  "  Downloading urllib3-2.2.2-py3-none-any.whl (121 kB)",
  "Installing collected packages: urllib3, requests",
  "Successfully installed requests-2.32.3 urllib3-2.2.2",
].join("\n");

describe("pip-install filter", () => {
  it("folds satisfied/download noise, keeps install evidence", () => {
    const out = assertFilterConformance(filter, PIP);
    expect(out).toContain("Requirement already satisfied: dep-0");
    expect(out).not.toContain("dep-7");
    expect(out).toContain("… [11 already satisfied]");
    expect(out).toContain("… [2 download lines]");
    expect(out).toContain("Successfully installed requests-2.32.3 urllib3-2.2.2");
  });
});
