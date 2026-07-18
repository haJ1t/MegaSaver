import { describe, expect, it } from "vitest";
import {
  MEGA_SAVER_BLOCK_END,
  MEGA_SAVER_BLOCK_START,
  MEGA_SAVER_CG_BLOCK_END,
  MEGA_SAVER_CG_BLOCK_START,
  MEGA_SAVER_HANDOFF_BLOCK_END,
  MEGA_SAVER_HANDOFF_BLOCK_START,
} from "../src/constants.js";
import { ConnectorError } from "../src/errors.js";
import { projectionPreflight } from "../src/preflight.js";

const B = MEGA_SAVER_BLOCK_START;
const E = MEGA_SAVER_BLOCK_END;
const CB = MEGA_SAVER_CG_BLOCK_START;
const CE = MEGA_SAVER_CG_BLOCK_END;

const HB = MEGA_SAVER_HANDOFF_BLOCK_START;
const HE = MEGA_SAVER_HANDOFF_BLOCK_END;

const MANAGED = `${B}\nmanaged content\n${E}\n`;
const CG = `${CB}\ngate content\n${CE}\n`;
const HANDOFF = `${HB}\nhandoff content\n${HE}\n`;

function expectProjectionInvalid(fn: () => void): void {
  let thrown: unknown;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(ConnectorError);
  expect((thrown as ConnectorError).code).toBe("projection_invalid");
}

describe("projectionPreflight", () => {
  it("passes a single balanced managed block", () => {
    expect(() => projectionPreflight(MANAGED)).not.toThrow();
  });

  it("passes a managed block plus a balanced CONTEXT_GATE block", () => {
    expect(() => projectionPreflight(`${MANAGED}${CG}`)).not.toThrow();
  });

  it("rejects output with no managed block", () => {
    expectProjectionInvalid(() => projectionPreflight("just some prose\nno block here\n"));
  });

  it("rejects output with two begin sentinels", () => {
    expectProjectionInvalid(() => projectionPreflight(`${B}\n${B}\nx\n${E}\n`));
  });

  it("rejects output with an unbalanced CONTEXT_GATE block", () => {
    expectProjectionInvalid(() => projectionPreflight(`${MANAGED}${CB}\ngate content\n`));
  });

  it("passes a managed block plus a balanced HANDOFF block", () => {
    expect(() => projectionPreflight(`${MANAGED}${CG}${HANDOFF}`)).not.toThrow();
  });

  it("rejects output with an unbalanced HANDOFF block", () => {
    expectProjectionInvalid(() => projectionPreflight(`${MANAGED}${HB}\nhandoff content\n`));
  });

  it("rejects a header target whose managed block is at the top (frontmatter eaten)", () => {
    expectProjectionInvalid(() => projectionPreflight(MANAGED, { expectHeader: true }));
  });

  it("passes a header target with text before the managed block", () => {
    const withHeader = `---\ndescription: x\n---\n\n${MANAGED}`;
    expect(() => projectionPreflight(withHeader, { expectHeader: true })).not.toThrow();
  });
});
