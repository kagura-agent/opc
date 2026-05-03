// flow-core.test.mjs — Unit tests for flow-core.mjs
// Run: node --test bin/lib/flow-core.test.mjs

import { test, describe, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { validateHandshakeData, RULE_VALIDATORS, cmdRoute } from "./flow-core.mjs";

// ─── helpers ────────────────────────────────────────────────────

/** Minimal valid handshake data object. */
function validHandshake(overrides = {}) {
  return {
    nodeId: "gate-1",
    nodeType: "gate",
    runId: "run_1",
    status: "completed",
    verdict: "PASS",
    summary: "All good",
    timestamp: new Date().toISOString(),
    artifacts: [],
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// validateHandshakeData — pure function, heavy coverage
// ═══════════════════════════════════════════════════════════════

describe("validateHandshakeData", () => {
  // ─── required fields ──────────────────────────────────────────

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
      assert.ok(errors.some(e => e.includes(field)), `expected error about ${field}`);
    });

    test(`empty string '${field}' → error`, () => {
      const data = validHandshake({ [field]: "" });
      const { errors } = validateHandshakeData(data);
      assert.ok(errors.some(e => e.includes(field)));
    });
  }

  // ─── enum validation ─────────────────────────────────────────

  test("invalid nodeType → error", () => {
    const { errors } = validateHandshakeData(validHandshake({ nodeType: "bogus" }));
    assert.ok(errors.some(e => e.includes("invalid nodeType")));
  });

  test("invalid status → error", () => {
    const { errors } = validateHandshakeData(validHandshake({ status: "running" }));
    assert.ok(errors.some(e => e.includes("invalid status")));
  });

  test("invalid verdict → error", () => {
    const { errors } = validateHandshakeData(validHandshake({ verdict: "MAYBE" }));
    assert.ok(errors.some(e => e.includes("invalid verdict")));
  });

  test("null verdict is allowed", () => {
    const { errors } = validateHandshakeData(validHandshake({ verdict: null }));
    assert.ok(!errors.some(e => e.includes("verdict")));
  });

  // ─── artifacts ────────────────────────────────────────────────

  test("artifacts not an array → error", () => {
    const { errors } = validateHandshakeData(validHandshake({ artifacts: "nope" }));
    assert.ok(errors.some(e => e.includes("artifacts must be an array")));
  });

  test("artifact missing type → error (with baseDir)", () => {
    const { errors } = validateHandshakeData(
      validHandshake({ artifacts: [{ path: "foo.md" }] }),
      { baseDir: "/nonexistent" },
    );
    assert.ok(errors.some(e => e.includes("artifact[0]: missing type or path")));
  });

  test("artifact missing path → error (with baseDir)", () => {
    const { errors } = validateHandshakeData(
      validHandshake({ artifacts: [{ type: "source" }] }),
      { baseDir: "/nonexistent" },
    );
    assert.ok(errors.some(e => e.includes("artifact[0]: missing type or path")));
  });

  test("artifact with nonexistent file → error (with baseDir)", () => {
    const { errors } = validateHandshakeData(
      validHandshake({ artifacts: [{ type: "source", path: "does-not-exist.md" }] }),
      { baseDir: "/tmp/definitely-not-a-real-dir-" + Date.now() },
    );
    assert.ok(errors.some(e => e.includes("file not found")));
  });

  // ─── evidence checks for execute nodes ────────────────────────

  test("execute node completed with no evidence → error", () => {
    const { errors } = validateHandshakeData(
      validHandshake({ nodeType: "execute", status: "completed", artifacts: [] }),
      { checkEvidence: true },
    );
    assert.ok(errors.some(e => e.includes("executor node missing evidence")));
  });

  test("execute node completed with evidence → no error", () => {
    const { errors } = validateHandshakeData(
      validHandshake({
        nodeType: "execute",
        status: "completed",
        artifacts: [{ type: "test-result", path: "t.json" }],
      }),
      { checkEvidence: true },
    );
    assert.ok(!errors.some(e => e.includes("evidence")));
  });

  test("execute node not completed → evidence not checked", () => {
    const { errors } = validateHandshakeData(
      validHandshake({ nodeType: "execute", status: "failed", artifacts: [] }),
      { checkEvidence: true },
    );
    assert.ok(!errors.some(e => e.includes("evidence")));
  });

  test("non-execute node → evidence not checked", () => {
    const { errors } = validateHandshakeData(
      validHandshake({ nodeType: "gate", status: "completed", artifacts: [] }),
      { checkEvidence: true },
    );
    assert.ok(!errors.some(e => e.includes("evidence")));
  });

  // ─── softEvidence mode ────────────────────────────────────────

  test("softEvidence → warning instead of error for missing evidence", () => {
    const { errors, warnings } = validateHandshakeData(
      validHandshake({ nodeType: "execute", status: "completed", artifacts: [] }),
      { checkEvidence: true, softEvidence: true },
    );
    assert.ok(!errors.some(e => e.includes("evidence")));
    assert.ok(warnings.some(w => w.includes("softEvidence")));
  });

  // ─── tier-based evidence requirements ─────────────────────────

  test("polished tier: missing screenshot → error", () => {
    const { errors } = validateHandshakeData(
      validHandshake({
        nodeType: "execute",
        status: "completed",
        artifacts: [{ type: "test-result", path: "t.json" }],
      }),
      { checkEvidence: true, tier: "polished" },
    );
    assert.ok(errors.some(e => e.includes("screenshot")));
  });

  test("polished tier: missing cli/test → error", () => {
    const { errors } = validateHandshakeData(
      validHandshake({
        nodeType: "execute",
        status: "completed",
        artifacts: [{ type: "screenshot", path: "s.png" }],
      }),
      { checkEvidence: true, tier: "polished" },
    );
    assert.ok(errors.some(e => e.includes("cli-output or test-result")));
  });

  test("polished tier: both screenshot + test → no tier errors", () => {
    const { errors } = validateHandshakeData(
      validHandshake({
        nodeType: "execute",
        status: "completed",
        artifacts: [
          { type: "screenshot", path: "s.png" },
          { type: "test-result", path: "t.json" },
        ],
      }),
      { checkEvidence: true, tier: "polished" },
    );
    assert.ok(!errors.some(e => e.includes("tier requires")));
  });

  test("delightful tier: needs ≥2 screenshots", () => {
    const { errors } = validateHandshakeData(
      validHandshake({
        nodeType: "execute",
        status: "completed",
        artifacts: [
          { type: "screenshot", path: "s.png" },
          { type: "test-result", path: "t.json" },
        ],
      }),
      { checkEvidence: true, tier: "delightful" },
    );
    assert.ok(errors.some(e => e.includes("delightful tier requires ≥2 screenshot")));
  });

  test("delightful tier: 2 screenshots + test → no tier errors", () => {
    const { errors } = validateHandshakeData(
      validHandshake({
        nodeType: "execute",
        status: "completed",
        artifacts: [
          { type: "screenshot", path: "s1.png" },
          { type: "screenshot", path: "s2.png" },
          { type: "cli-output", path: "c.txt" },
        ],
      }),
      { checkEvidence: true, tier: "delightful" },
    );
    assert.ok(!errors.some(e => e.includes("tier requires")));
  });

  // ─── review independence ──────────────────────────────────────

  test("review node completed with <2 eval artifacts → error", () => {
    const { errors } = validateHandshakeData(
      validHandshake({
        nodeType: "review",
        status: "completed",
        artifacts: [{ type: "eval", path: "e.md" }],
      }),
    );
    assert.ok(errors.some(e => e.includes("≥2 eval artifacts")));
  });

  test("review node completed with 0 eval artifacts → error", () => {
    const { errors } = validateHandshakeData(
      validHandshake({
        nodeType: "review",
        status: "completed",
        artifacts: [],
      }),
    );
    assert.ok(errors.some(e => e.includes("≥2 eval artifacts")));
  });

  test("review node completed with ≥2 eval artifacts → no independence error", () => {
    const { errors } = validateHandshakeData(
      validHandshake({
        nodeType: "review",
        status: "completed",
        artifacts: [
          { type: "eval", path: "e1.md" },
          { type: "eval", path: "e2.md" },
        ],
      }),
    );
    assert.ok(!errors.some(e => e.includes("≥2 eval artifacts")));
  });

  test("review node not completed → independence not checked", () => {
    const { errors } = validateHandshakeData(
      validHandshake({
        nodeType: "review",
        status: "failed",
        artifacts: [{ type: "eval", path: "e.md" }],
      }),
    );
    assert.ok(!errors.some(e => e.includes("eval artifacts")));
  });

  // ─── findings vs verdict consistency ──────────────────────────

  test("findings.critical > 0 with PASS verdict → error", () => {
    const { errors } = validateHandshakeData(
      validHandshake({ verdict: "PASS", findings: { critical: 1 } }),
    );
    assert.ok(errors.some(e => e.includes("findings.critical > 0")));
  });

  test("findings.critical > 0 with FAIL verdict → no consistency error", () => {
    const { errors } = validateHandshakeData(
      validHandshake({ verdict: "FAIL", findings: { critical: 2 } }),
    );
    assert.ok(!errors.some(e => e.includes("findings.critical")));
  });

  test("findings.critical = 0 with PASS → no consistency error", () => {
    const { errors } = validateHandshakeData(
      validHandshake({ verdict: "PASS", findings: { critical: 0, warning: 3 } }),
    );
    assert.ok(!errors.some(e => e.includes("findings.critical")));
  });

  test("no findings object → no consistency error", () => {
    const { errors } = validateHandshakeData(
      validHandshake({ verdict: "PASS", findings: null }),
    );
    assert.ok(!errors.some(e => e.includes("findings")));
  });

  // ─── loopback validation ──────────────────────────────────────

  test("loopback not an object → error", () => {
    const { errors } = validateHandshakeData(
      validHandshake({ loopback: "bad" }),
    );
    assert.ok(errors.some(e => e.includes("loopback must be an object")));
  });

  test("loopback missing from → error", () => {
    const { errors } = validateHandshakeData(
      validHandshake({ loopback: { reason: "retry", iteration: 1 } }),
    );
    assert.ok(errors.some(e => e.includes("loopback.from is required")));
  });

  test("loopback missing reason → error", () => {
    const { errors } = validateHandshakeData(
      validHandshake({ loopback: { from: "gate-1", iteration: 1 } }),
    );
    assert.ok(errors.some(e => e.includes("loopback.reason is required")));
  });

  test("loopback.iteration not a number → error", () => {
    const { errors } = validateHandshakeData(
      validHandshake({ loopback: { from: "gate-1", reason: "retry", iteration: "1" } }),
    );
    assert.ok(errors.some(e => e.includes("loopback.iteration must be a number")));
  });

  test("valid loopback → no errors", () => {
    const { errors } = validateHandshakeData(
      validHandshake({ loopback: { from: "gate-1", reason: "retry", iteration: 2 } }),
    );
    assert.ok(!errors.some(e => e.includes("loopback")));
  });

  test("loopback null → no errors", () => {
    const { errors } = validateHandshakeData(
      validHandshake({ loopback: null }),
    );
    assert.ok(!errors.some(e => e.includes("loopback")));
  });

  // ─── tier coverage for execute nodes ──────────────────────────

  test("execute node with tier but no tierCoverage → error", () => {
    const { errors } = validateHandshakeData(
      validHandshake({
        nodeType: "execute",
        status: "completed",
        artifacts: [{ type: "test-result", path: "t.json" }],
      }),
      { tier: "polished", checkEvidence: true },
    );
    // 'polished' has required keys, so tierCoverage is required
    assert.ok(errors.some(e => e.includes("tierCoverage")));
  });

  test("execute node with tier and tierCoverage.covered not array → error", () => {
    const { errors } = validateHandshakeData(
      validHandshake({
        nodeType: "execute",
        status: "completed",
        tierCoverage: { covered: "not-array", skipped: [] },
        artifacts: [{ type: "test-result", path: "t.json" }],
      }),
      { tier: "polished" },
    );
    assert.ok(errors.some(e => e.includes("tierCoverage.covered must be an array")));
  });

  test("execute node with tier and skipped entry missing reason → error", () => {
    const { errors } = validateHandshakeData(
      validHandshake({
        nodeType: "execute",
        status: "completed",
        tierCoverage: { covered: [], skipped: [{ key: "some-key" }] },
        artifacts: [],
      }),
      { tier: "polished" },
    );
    assert.ok(errors.some(e => e.includes("missing 'reason'")));
  });

  test("execute node with tier and skipped entry with short reason → error", () => {
    const { errors } = validateHandshakeData(
      validHandshake({
        nodeType: "execute",
        status: "completed",
        tierCoverage: { covered: [], skipped: [{ key: "k", reason: "short" }] },
        artifacts: [],
      }),
      { tier: "polished" },
    );
    assert.ok(errors.some(e => e.includes("min 10 chars")));
  });

  test("functional tier (no required keys) → no tierCoverage needed", () => {
    const { errors } = validateHandshakeData(
      validHandshake({
        nodeType: "execute",
        status: "completed",
        artifacts: [{ type: "test-result", path: "t.json" }],
      }),
      { tier: "functional", checkEvidence: true },
    );
    assert.ok(!errors.some(e => e.includes("tierCoverage")));
  });
});

// ═══════════════════════════════════════════════════════════════
// RULE_VALIDATORS
// ═══════════════════════════════════════════════════════════════

describe("RULE_VALIDATORS", () => {
  test("non-empty-array: valid", () => {
    assert.equal(RULE_VALIDATORS["non-empty-array"]([1]), true);
  });
  test("non-empty-array: empty → false", () => {
    assert.equal(RULE_VALIDATORS["non-empty-array"]([]), false);
  });
  test("non-empty-array: non-array → false", () => {
    assert.equal(RULE_VALIDATORS["non-empty-array"]("hi"), false);
  });

  test("non-empty-object: valid", () => {
    assert.equal(RULE_VALIDATORS["non-empty-object"]({ a: 1 }), true);
  });
  test("non-empty-object: empty → false", () => {
    assert.equal(RULE_VALIDATORS["non-empty-object"]({}), false);
  });
  test("non-empty-object: array → false", () => {
    assert.equal(RULE_VALIDATORS["non-empty-object"]([1]), false);
  });
  test("non-empty-object: null → falsy", () => {
    assert.ok(!RULE_VALIDATORS["non-empty-object"](null));
  });

  test("non-empty-string: valid", () => {
    assert.equal(RULE_VALIDATORS["non-empty-string"]("hi"), true);
  });
  test("non-empty-string: empty → false", () => {
    assert.equal(RULE_VALIDATORS["non-empty-string"](""), false);
  });
  test("non-empty-string: non-string → false", () => {
    assert.equal(RULE_VALIDATORS["non-empty-string"](42), false);
  });

  test("positive-integer: valid", () => {
    assert.equal(RULE_VALIDATORS["positive-integer"](5), true);
  });
  test("positive-integer: zero → false", () => {
    assert.equal(RULE_VALIDATORS["positive-integer"](0), false);
  });
  test("positive-integer: negative → false", () => {
    assert.equal(RULE_VALIDATORS["positive-integer"](-1), false);
  });
  test("positive-integer: float → false", () => {
    assert.equal(RULE_VALIDATORS["positive-integer"](1.5), false);
  });
});

// ═══════════════════════════════════════════════════════════════
// cmdRoute — mock console/process
// ═══════════════════════════════════════════════════════════════

describe("cmdRoute", () => {
  let logOutput, errOutput, exitCode;
  let origLog, origErr, origExit;

  beforeEach(() => {
    logOutput = [];
    errOutput = [];
    exitCode = null;
    origLog = console.log;
    origErr = console.error;
    origExit = process.exit;
    console.log = (...a) => logOutput.push(a.join(" "));
    console.error = (...a) => errOutput.push(a.join(" "));
    process.exit = (code) => { exitCode = code; throw new Error("EXIT"); };
  });

  afterEach(() => {
    console.log = origLog;
    console.error = origErr;
    process.exit = origExit;
  });

  test("missing --node → exits 1", () => {
    assert.throws(() => cmdRoute(["--verdict", "PASS", "--flow", "linear"]), /EXIT/);
    assert.equal(exitCode, 1);
  });

  test("missing --verdict → exits 1", () => {
    assert.throws(() => cmdRoute(["--node", "gate-1", "--flow", "linear"]), /EXIT/);
    assert.equal(exitCode, 1);
  });

  test("node not in flow → valid=false", () => {
    cmdRoute(["--node", "nonexistent", "--verdict", "PASS", "--flow", "review"]);
    const out = JSON.parse(logOutput[0]);
    assert.equal(out.valid, false);
    assert.ok(out.error.includes("not in flow"));
  });

  test("valid route → valid=true with next node", () => {
    cmdRoute(["--node", "review", "--verdict", "PASS", "--flow", "review"]);
    const out = JSON.parse(logOutput[0]);
    assert.equal(out.valid, true);
    assert.equal(out.next, "gate");
  });

  test("no edge for verdict → valid=false", () => {
    cmdRoute(["--node", "review", "--verdict", "BLOCKED", "--flow", "review"]);
    const out = JSON.parse(logOutput[0]);
    assert.equal(out.valid, false);
    assert.ok(out.error.includes("no edge for verdict"));
  });
});
