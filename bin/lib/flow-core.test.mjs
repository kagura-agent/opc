// flow-core.test.mjs — handshake field/evidence validation

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validateHandshakeData } from "./flow-core.mjs";
import { validHandshake } from "./flow-core.test-helpers.mjs";

describe("validateHandshakeData — fields, evidence, review", () => {
  test("valid handshake → no errors", () => {
    const { errors, warnings } = validateHandshakeData(validHandshake());
    assert.equal(errors.length, 0);
    assert.equal(warnings.length, 0);
  });

  for (const field of ["nodeId", "nodeType", "runId", "status", "summary", "timestamp"]) {
    test(`missing '${field}' → error`, () => {
      const data = validHandshake({ [field]: undefined });
      delete data[field];
      const { errors } = validateHandshakeData(data);
      assert.ok(errors.some((e) => e.includes(field)), `expected error about ${field}`);
    });

    test(`empty string '${field}' → error`, () => {
      const data = validHandshake({ [field]: "" });
      const { errors } = validateHandshakeData(data);
      assert.ok(errors.some((e) => e.includes(field)));
    });
  }

  test("invalid nodeType → error", () => {
    const { errors } = validateHandshakeData(validHandshake({ nodeType: "bogus" }));
    assert.ok(errors.some((e) => e.includes("invalid nodeType")));
  });

  test("invalid status → error", () => {
    const { errors } = validateHandshakeData(validHandshake({ status: "running" }));
    assert.ok(errors.some((e) => e.includes("invalid status")));
  });

  test("invalid verdict → error", () => {
    const { errors } = validateHandshakeData(validHandshake({ verdict: "MAYBE" }));
    assert.ok(errors.some((e) => e.includes("invalid verdict")));
  });

  test("null verdict is allowed", () => {
    const { errors } = validateHandshakeData(validHandshake({ verdict: null }));
    assert.ok(!errors.some((e) => e.includes("verdict")));
  });

  test("artifacts not an array → error", () => {
    const { errors } = validateHandshakeData(validHandshake({ artifacts: "nope" }));
    assert.ok(errors.some((e) => e.includes("artifacts must be an array")));
  });

  test("artifact missing type → error (with baseDir)", () => {
    const { errors } = validateHandshakeData(validHandshake({
      artifacts: [{ path: "foo.txt" }],
    }), { baseDir: "/tmp" });
    assert.ok(errors.some((e) => e.includes("missing type or path")));
  });

  test("artifact missing path → error (with baseDir)", () => {
    const { errors } = validateHandshakeData(validHandshake({
      artifacts: [{ type: "log" }],
    }), { baseDir: "/tmp" });
    assert.ok(errors.some((e) => e.includes("missing type or path")));
  });

  test("artifact with nonexistent file → error (with baseDir)", () => {
    const { errors } = validateHandshakeData(validHandshake({
      artifacts: [{ type: "log", path: "does-not-exist.txt" }],
    }), { baseDir: "/tmp/nonexistent-base-xyz" });
    assert.ok(errors.some((e) => e.includes("file not found")));
  });

  test("execute node completed with no evidence → error", () => {
    const { errors } = validateHandshakeData(validHandshake({
      nodeType: "execute",
      artifacts: [],
    }), { checkEvidence: true });
    assert.ok(errors.some((e) => e.includes("executor node missing evidence")));
  });

  test("execute node completed with evidence → no error", () => {
    const { errors } = validateHandshakeData(validHandshake({
      nodeType: "execute",
      artifacts: [
        { type: "test-result", path: "test.log" },
      ],
    }), { checkEvidence: true });
    assert.ok(!errors.some((e) => e.includes("completed execute node needs evidence")));
  });

  test("execute node not completed → evidence not checked", () => {
    const { errors } = validateHandshakeData(validHandshake({
      nodeType: "execute",
      status: "blocked",
      artifacts: [],
    }));
    assert.ok(!errors.some((e) => e.includes("needs evidence")));
  });

  test("non-execute node → evidence not checked", () => {
    const { errors } = validateHandshakeData(validHandshake({
      nodeType: "gate",
      artifacts: [],
    }));
    assert.ok(!errors.some((e) => e.includes("needs evidence")));
  });

  test("softEvidence → warning instead of error for missing evidence", () => {
    const { errors, warnings } = validateHandshakeData(validHandshake({
      nodeType: "execute",
      artifacts: [],
    }), { checkEvidence: true, softEvidence: true });
    assert.ok(!errors.some((e) => e.includes("needs evidence")));
    assert.ok(warnings.some((w) => w.includes("missing standard evidence")));
  });

  test("polished tier: missing screenshot → error", () => {
    const { errors } = validateHandshakeData(validHandshake({
      nodeType: "execute",
      artifacts: [
        { type: "test-result", path: "test.log" },
      ],
    }), { checkEvidence: true, tier: "polished" });
    assert.ok(errors.some((e) => e.includes("screenshot")));
  });

  test("polished tier: missing cli/test → error", () => {
    const { errors } = validateHandshakeData(validHandshake({
      nodeType: "execute",
      artifacts: [
        { type: "screenshot", path: "shot.png" },
      ],
    }), { checkEvidence: true, tier: "polished" });
    assert.ok(errors.some((e) => e.includes("cli-output or test-result")));
  });

  test("polished tier: both screenshot + test → no tier errors", () => {
    const { errors } = validateHandshakeData(validHandshake({
      nodeType: "execute",
      artifacts: [
        { type: "screenshot", path: "shot.png" },
        { type: "test-result", path: "test.log" },
      ],
    }), { checkEvidence: true, tier: "polished" });
    assert.ok(!errors.some((e) => e.includes("screenshot")));
    assert.ok(!errors.some((e) => e.includes("cli-output/test-result")));
  });

  test("delightful tier: needs ≥2 screenshots", () => {
    const { errors } = validateHandshakeData(validHandshake({
      nodeType: "execute",
      artifacts: [
        { type: "screenshot", path: "one.png" },
        { type: "test-result", path: "test.log" },
      ],
    }), { checkEvidence: true, tier: "delightful" });
    assert.ok(errors.some((e) => e.includes("≥2 screenshot evidence")));
  });

  test("delightful tier: 2 screenshots + test → no tier errors", () => {
    const { errors } = validateHandshakeData(validHandshake({
      nodeType: "execute",
      artifacts: [
        { type: "screenshot", path: "one.png" },
        { type: "screenshot", path: "two.png" },
        { type: "test-result", path: "test.log" },
      ],
    }), { checkEvidence: true, tier: "delightful" });
    assert.ok(!errors.some((e) => e.includes("screenshots")));
  });

  test("review node completed with <2 eval artifacts → error", () => {
    const { errors } = validateHandshakeData(validHandshake({
      nodeType: "review",
      artifacts: [
        { type: "eval", path: "one.md" },
      ],
    }));
    assert.ok(errors.some((e) => e.includes("≥2 eval artifacts")));
  });

  test("review node completed with 0 eval artifacts → error", () => {
    const { errors } = validateHandshakeData(validHandshake({
      nodeType: "review",
      artifacts: [
        { type: "log", path: "log.txt" },
      ],
    }));
    assert.ok(errors.some((e) => e.includes("≥2 eval artifacts")));
  });

  test("review node completed with ≥2 eval artifacts → no independence error", () => {
    const { errors } = validateHandshakeData(validHandshake({
      nodeType: "review",
      artifacts: [
        { type: "eval", path: "a.md" },
        { type: "eval", path: "b.md" },
      ],
    }));
    assert.ok(!errors.some((e) => e.includes("independent eval")));
  });

  test("review node not completed → independence not checked", () => {
    const { errors } = validateHandshakeData(validHandshake({
      nodeType: "review",
      status: "blocked",
      artifacts: [],
    }));
    assert.ok(!errors.some((e) => e.includes("independent eval")));
  });
});
