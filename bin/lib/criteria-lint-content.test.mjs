// criteria-lint-content.test.mjs — content checks, warnings, return shape

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runLint } from "./criteria-lint.mjs";
import { failChecks, validDoc, warnChecks } from "./criteria-lint.test-helpers.mjs";

describe("runLint — content checks", () => {
  test("no-vague-outcomes fails on vague word without measurement", () => {
    const r = runLint(validDoc({
      outcomes: [
        "- OUT-1: The API is fast",
        "- OUT-2: Returns error on invalid input",
        "- OUT-3: Response body contains result field",
      ],
    }));
    assert.ok(failChecks(r).includes("no-vague-outcomes"));
    const f = r.failures.find((f) => f.check === "no-vague-outcomes");
    assert.ok(f.message.includes("OUT-1"));
    assert.ok(f.message.includes("fast"));
  });

  test("no-vague-outcomes passes when vague word has measurement", () => {
    const r = runLint(validDoc({
      outcomes: [
        "- OUT-1: The API is fast — responds within 200ms",
        "- OUT-2: Returns error on invalid input",
        "- OUT-3: Response body contains result field",
      ],
    }));
    assert.ok(!failChecks(r).includes("no-vague-outcomes"));
  });

  test("no-vague-outcomes passes with no vague words", () => {
    const r = runLint(validDoc());
    assert.ok(!failChecks(r).includes("no-vague-outcomes"));
  });

  test("no-impossible-to-fail flags 'should work' without concrete test", () => {
    const r = runLint(validDoc({
      outcomes: [
        "- OUT-1: The feature should work",
        "- OUT-2: Returns error on failure",
        "- OUT-3: Response contains result",
      ],
    }));
    assert.ok(failChecks(r).includes("no-impossible-to-fail"));
    const f = r.failures.find((f) => f.check === "no-impossible-to-fail");
    assert.ok(f.message.includes("OUT-1"));
    assert.ok(f.message.includes("should work"));
  });

  test("no-impossible-to-fail passes when 'as expected' has concrete test", () => {
    const r = runLint(validDoc({
      outcomes: [
        "- OUT-1: Endpoint as expected returns status code 200",
        "- OUT-2: Returns error on failure",
        "- OUT-3: Response contains result",
      ],
    }));
    assert.ok(!failChecks(r).includes("no-impossible-to-fail"));
  });

  test("verification-not-manual fails on manual-only verification", () => {
    const r = runLint(validDoc({
      verification: [
        "- OUT-1: manual inspection of output",
        "- OUT-2: assert error response",
        "- OUT-3: assert field exists",
      ].join("\n"),
    }));
    assert.ok(failChecks(r).includes("verification-not-manual"));
    const f = r.failures.find((f) => f.check === "verification-not-manual");
    assert.ok(f.message.includes("OUT-1"));
  });

  test("verification-not-manual passes when manual + mechanical", () => {
    const r = runLint(validDoc({
      verification: [
        "- OUT-1: manual inspection, also asserts status code matches",
        "- OUT-2: assert error response",
        "- OUT-3: assert field exists",
      ].join("\n"),
    }));
    assert.ok(!failChecks(r).includes("verification-not-manual"));
  });

  test("outcomes-unique fails when two outcomes are >80% similar", () => {
    const r = runLint(validDoc({
      outcomes: [
        "- OUT-1: The system writes records to the database table and logs the count of rows written",
        "- OUT-2: The system writes records to the database table and logs the count of rows written successfully",
        "- OUT-3: Error handling returns 400 on invalid input",
      ],
    }));
    assert.ok(failChecks(r).includes("outcomes-unique"));
    const f = r.failures.find((f) => f.check === "outcomes-unique");
    assert.ok(f.message.includes("OUT-1"));
    assert.ok(f.message.includes("OUT-2"));
  });

  test("outcomes-unique passes with distinct outcomes", () => {
    const r = runLint(validDoc());
    assert.ok(!failChecks(r).includes("outcomes-unique"));
  });

  test("pipeline-e2e-trigger fails when pipeline keyword present but no e2e trigger OUT", () => {
    const r = runLint(validDoc({
      outcomes: [
        "- OUT-1: The pipeline processes records correctly and returns status code 200",
        "- OUT-2: Error handling rejects invalid pipeline input",
        "- OUT-3: Logging outputs pipeline stage metrics",
      ],
    }));
    assert.ok(failChecks(r).includes("pipeline-e2e-trigger"));
    const f = r.failures.find((f) => f.check === "pipeline-e2e-trigger");
    assert.ok(f.message.includes("pipeline"));
  });

  test("pipeline-e2e-trigger passes when e2e trigger outcome exists", () => {
    const r = runLint(validDoc({
      outcomes: [
        "- OUT-1: The pipeline processes records and returns 200",
        "- OUT-2: Error handling rejects invalid input",
        "- OUT-3: End-to-end trigger verification from upstream to downstream passes",
      ],
    }));
    assert.ok(!failChecks(r).includes("pipeline-e2e-trigger"));
  });

  test("pipeline-e2e-trigger skipped when no pipeline keywords", () => {
    const r = runLint(validDoc());
    assert.ok(!failChecks(r).includes("pipeline-e2e-trigger"));
  });
});

describe("runLint — warnings", () => {
  test("scope-empty warns when Out of Scope has no bullet items", () => {
    const r = runLint(validDoc({ scope: "\n(empty)\n" }));
    assert.ok(warnChecks(r).includes("scope-empty"));
  });

  test("scope-empty no warning when Out of Scope has items", () => {
    const r = runLint(validDoc());
    assert.ok(!warnChecks(r).includes("scope-empty"));
  });

  test("no-failure-modes warns when no outcomes mention failure/error", () => {
    const r = runLint(validDoc({
      outcomes: [
        "- OUT-1: Returns status code 200 for valid requests",
        "- OUT-2: Response contains JSON body with result field",
        "- OUT-3: Response includes timestamp in ISO format",
      ],
    }));
    assert.ok(warnChecks(r).includes("no-failure-modes"));
  });

  test("no-failure-modes no warning when an outcome mentions error", () => {
    const r = runLint(validDoc());
    assert.ok(!warnChecks(r).includes("no-failure-modes"));
  });

  test("high-outcome-count warns with 6 outcomes", () => {
    const outs = Array.from({ length: 6 }, (_, i) =>
      `- OUT-${i + 1}: Unique outcome ${i + 1} returns status code ${200 + i * 100}`
    );
    const ver = outs.map((o) => `- ${o.match(/OUT-\d+/)[0]}: assert result`).join("\n");
    const r = runLint(validDoc({ outcomes: outs, verification: ver }));
    assert.ok(warnChecks(r).includes("high-outcome-count"));
    assert.ok(r.warnings.find((w) => w.check === "high-outcome-count").message.includes("6"));
  });

  test("high-outcome-count no warning with 5 outcomes", () => {
    const outs = Array.from({ length: 5 }, (_, i) =>
      `- OUT-${i + 1}: Unique outcome ${i + 1} returns status code ${200 + i * 100}`
    );
    const ver = outs.map((o) => `- ${o.match(/OUT-\d+/)[0]}: assert result`).join("\n");
    const r = runLint(validDoc({ outcomes: outs, verification: ver }));
    assert.ok(!warnChecks(r).includes("high-outcome-count"));
  });
});

describe("runLint — return value shape", () => {
  test("returns correct shape with all fields", () => {
    const r = runLint(validDoc());
    assert.ok(typeof r.passed === "number");
    assert.ok(typeof r.checksRun === "number");
    assert.ok(Array.isArray(r.failures));
    assert.ok(Array.isArray(r.warnings));
  });

  test("passed = checksRun - failures.length", () => {
    const r = runLint(validDoc());
    assert.equal(r.passed, r.checksRun - r.failures.length);
  });

  test("failure entries have check and message", () => {
    const text = "nothing here";
    const r = runLint(text);
    assert.ok(r.failures.length > 0);
    for (const f of r.failures) {
      assert.ok(typeof f.check === "string");
      assert.ok(typeof f.message === "string");
    }
  });
});
