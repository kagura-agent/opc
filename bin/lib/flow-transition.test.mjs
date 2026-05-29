// flow-transition.test.mjs — Step 1.5 structured result check

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkStructuredResults } from "./flow-transition.mjs";

const TMPBASE = join(tmpdir(), `ft-test-${Date.now()}`);

// Minimal template with build-verify topology
const TEMPLATE = {
  nodeTypes: {
    build: "build",
    "code-review": "review",
    gate: "gate",
  },
};

// Minimal flow state: build → code-review → gate
function makeState() {
  return {
    flowTemplate: "build-verify",
    currentNode: "gate",
    history: [
      { nodeId: "build", runId: "run_1" },
      { nodeId: "code-review", runId: "run_1" },
      { nodeId: "gate", runId: "run_1" },
    ],
  };
}

function setupDir(name, handshakes) {
  const dir = join(TMPBASE, name);
  for (const [nodeId, hs] of Object.entries(handshakes)) {
    const nodeDir = join(dir, "nodes", nodeId);
    mkdirSync(nodeDir, { recursive: true });
    writeFileSync(join(nodeDir, "handshake.json"), JSON.stringify(hs));
    // Write artifact files referenced by handshake
    if (Array.isArray(hs.artifacts)) {
      for (const art of hs.artifacts) {
        if (art._content !== undefined) {
          const artDir = join(nodeDir, art.path.includes("/") ? art.path.split("/").slice(0, -1).join("/") : "");
          mkdirSync(artDir, { recursive: true });
          const content = typeof art._content === "string" ? art._content : JSON.stringify(art._content);
          writeFileSync(join(nodeDir, art.path), content);
        }
      }
    }
  }
  return dir;
}

// Cleanup after all tests
test.after(() => {
  try { rmSync(TMPBASE, { recursive: true, force: true }); } catch {}
});

describe("checkStructuredResults — Step 1.5", () => {
  test("no artifacts → empty reasons (backward compat)", () => {
    const dir = setupDir("t1-no-artifacts", {
      build: { artifacts: [] },
      "code-review": { artifacts: [] },
    });
    const reasons = checkStructuredResults(dir, makeState(), TEMPLATE, "gate");
    assert.equal(reasons.length, 0, "should pass with no artifacts");
  });

  test("test_fail_count=3 → FAIL", () => {
    const dir = setupDir("t2-test-fail", {
      build: {
        artifacts: [{
          type: "test-result",
          path: "run_1/test-report.json",
          _content: { test_fail_count: 3, dead_test_count: 0 },
        }],
      },
      "code-review": { artifacts: [] },
    });
    const reasons = checkStructuredResults(dir, makeState(), TEMPLATE, "gate");
    assert.ok(reasons.length > 0, "should have fail reasons");
    assert.ok(reasons.some(r => r.includes("3 test(s) failed")));
  });

  test("dead_test_count=5 → FAIL", () => {
    const dir = setupDir("t3-dead-tests", {
      build: {
        artifacts: [{
          type: "test-result",
          path: "run_1/test-report.json",
          _content: { test_fail_count: 0, dead_test_count: 5 },
        }],
      },
      "code-review": { artifacts: [] },
    });
    const reasons = checkStructuredResults(dir, makeState(), TEMPLATE, "gate");
    assert.ok(reasons.some(r => r.includes("5 dead test(s)")));
  });

  test("p0_count=2 → FAIL", () => {
    const dir = setupDir("t4-p0", {
      build: {
        artifacts: [{
          type: "report",
          path: "run_1/report.json",
          _content: { p0_count: 2 },
        }],
      },
      "code-review": { artifacts: [] },
    });
    const reasons = checkStructuredResults(dir, makeState(), TEMPLATE, "gate");
    assert.ok(reasons.some(r => r.includes("2 P0 issue(s)")));
  });

  test("sync_check_status=FAIL → FAIL", () => {
    const dir = setupDir("t5-sync-fail", {
      build: {
        artifacts: [{
          type: "report",
          path: "run_1/sync-report.json",
          _content: { sync_check_status: "FAIL", test_fail_count: 0 },
        }],
      },
      "code-review": { artifacts: [] },
    });
    const reasons = checkStructuredResults(dir, makeState(), TEMPLATE, "gate");
    assert.ok(reasons.some(r => r.includes("sync-check failed")));
  });

  test("malformed artifact JSON → fail-closed FAIL", () => {
    const dir = setupDir("t6-malformed", {
      build: {
        artifacts: [{
          type: "report",
          path: "run_1/bad-report.json",
          _content: "NOT VALID JSON{{{",
        }],
      },
      "code-review": { artifacts: [] },
    });
    const reasons = checkStructuredResults(dir, makeState(), TEMPLATE, "gate");
    assert.ok(reasons.some(r => r.includes("unreadable")));
  });

  test("all zeros → empty reasons (PASS)", () => {
    const dir = setupDir("t7-all-zero", {
      build: {
        artifacts: [{
          type: "test-result",
          path: "run_1/test-report.json",
          _content: { test_fail_count: 0, dead_test_count: 0, p0_count: 0, sync_check_status: "PASS" },
        }],
      },
      "code-review": { artifacts: [] },
    });
    const reasons = checkStructuredResults(dir, makeState(), TEMPLATE, "gate");
    assert.equal(reasons.length, 0, "all zeros should pass");
  });

  test("string type coercion: test_fail_count='3' → FAIL", () => {
    const dir = setupDir("t8-string-coerce", {
      build: {
        artifacts: [{
          type: "test-result",
          path: "run_1/test-report.json",
          _content: { test_fail_count: "3" },
        }],
      },
      "code-review": { artifacts: [] },
    });
    const reasons = checkStructuredResults(dir, makeState(), TEMPLATE, "gate");
    assert.ok(reasons.some(r => r.includes("3 test(s) failed")));
  });

  test("artifact type=screenshot → ignored (PASS)", () => {
    const dir = setupDir("t9-screenshot-ignored", {
      build: {
        artifacts: [{
          type: "screenshot",
          path: "run_1/screenshot.png",
          _content: "binary-data-irrelevant",
        }],
      },
      "code-review": { artifacts: [] },
    });
    const reasons = checkStructuredResults(dir, makeState(), TEMPLATE, "gate");
    assert.equal(reasons.length, 0, "screenshot artifacts should be ignored");
  });
});
