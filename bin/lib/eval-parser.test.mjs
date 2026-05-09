import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  SEVERITY_MAP,
  SEVERITY_RE,
  FILE_REF_RE,
  HEDGING_RE,
  ASPIRATIONAL_RE,
  VERDICT_RE,
  FINDINGS_N_RE,
  checkEvalDistinctness,
} from "./eval-parser.mjs";

describe("SEVERITY_RE", () => {
  test("matches 🔴 🟡 🔵", () => {
    for (const emoji of ["🔴", "🟡", "🔵"]) {
      assert.ok(SEVERITY_RE.test(emoji));
      assert.ok(SEVERITY_RE.test(`[${emoji}]`));
      assert.ok(SEVERITY_RE.test(`foo ${emoji} bar`));
    }
  });

  test("does not match other emoji", () => {
    assert.ok(!SEVERITY_RE.test("🟢"));
    assert.ok(!SEVERITY_RE.test("plain text"));
  });
});

describe("FILE_REF_RE", () => {
  test("matches file:line references", () => {
    assert.ok(FILE_REF_RE.test("src/foo.js:42"));
    assert.ok(FILE_REF_RE.test("lib/bar/baz.ts:1"));
  });

  test("does not match without line number", () => {
    assert.ok(!FILE_REF_RE.test("src/foo.js"));
  });
});

describe("HEDGING_RE", () => {
  test("matches hedging words", () => {
    assert.ok(HEDGING_RE.test("you might want to"));
    assert.ok(HEDGING_RE.test("could potentially break"));
    assert.ok(HEDGING_RE.test("Consider adding"));
  });

  test("does not match unrelated text", () => {
    assert.ok(!HEDGING_RE.test("This is broken"));
  });
});

describe("ASPIRATIONAL_RE", () => {
  test("matches aspirational phrases", () => {
    assert.ok(ASPIRATIONAL_RE.test("should consider refactoring"));
    assert.ok(ASPIRATIONAL_RE.test("worth exploring alternatives"));
    assert.ok(ASPIRATIONAL_RE.test("it would be nice to add"));
    assert.ok(ASPIRATIONAL_RE.test("may want to refactor"));
    assert.ok(ASPIRATIONAL_RE.test("could be improved"));
    assert.ok(ASPIRATIONAL_RE.test("ideally we would"));
    assert.ok(ASPIRATIONAL_RE.test("down the road"));
  });

  test("does not match actionable text", () => {
    assert.ok(!ASPIRATIONAL_RE.test("must fix this bug"));
    assert.ok(!ASPIRATIONAL_RE.test("long-term improvement"));
  });
});

describe("VERDICT_RE", () => {
  test("matches verdict lines", () => {
    const m = "VERDICT: PASS FINDINGS[0]".match(VERDICT_RE);
    assert.ok(m);
    assert.equal(m[1], "PASS FINDINGS[0]");
  });

  test("case insensitive", () => {
    assert.ok(VERDICT_RE.test("verdict: fail"));
  });

  test("no match without colon", () => {
    assert.ok(!VERDICT_RE.test("VERDICT PASS"));
  });
});

describe("FINDINGS_N_RE", () => {
  test("extracts count", () => {
    const m = "FINDINGS[3]".match(FINDINGS_N_RE);
    assert.equal(m[1], "3");
  });

  test("no match without brackets", () => {
    assert.ok(!FINDINGS_N_RE.test("FINDINGS 3"));
  });
});

describe("SEVERITY_MAP", () => {
  test("maps emoji to severity names", () => {
    assert.equal(SEVERITY_MAP["🔴"], "critical");
    assert.equal(SEVERITY_MAP["🟡"], "warning");
    assert.equal(SEVERITY_MAP["🔵"], "suggestion");
  });
});

describe("checkEvalDistinctness", () => {
  test("returns empty for <2 items", () => {
    const r = checkEvalDistinctness([{ path: "a", content: "x" }]);
    assert.deepEqual(r, { errors: [], warnings: [] });
  });

  test("returns empty for non-array", () => {
    const r = checkEvalDistinctness(null);
    assert.deepEqual(r, { errors: [], warnings: [] });
  });

  test("identical content → error", () => {
    const r = checkEvalDistinctness([
      { path: "a.md", content: "same" },
      { path: "b.md", content: "same" },
    ]);
    assert.equal(r.errors.length, 1);
    assert.ok(r.errors[0].includes("identical"));
  });

  test(">70% overlap → warning", () => {
    const shared = Array.from({ length: 8 }, (_, i) => `This is shared line number ${i}`);
    const a = [...shared, "unique a line that is long enough"].join("\n");
    const b = [...shared, "unique b line that is long enough"].join("\n");
    const r = checkEvalDistinctness([
      { path: "a.md", content: a },
      { path: "b.md", content: b },
    ]);
    assert.equal(r.warnings.length >= 1, true);
    assert.ok(r.warnings.some((w) => w.includes("overlap")));
  });

  test("identical headings → warning", () => {
    const r = checkEvalDistinctness([
      { path: "a.md", content: "# Code Review\nContent A is different" },
      { path: "b.md", content: "# Code Review\nContent B is different" },
    ]);
    assert.ok(r.warnings.some((w) => w.includes("identical headings")));
  });

  test("identical role tags → error", () => {
    const r = checkEvalDistinctness([
      { path: "a.md", content: "Role: Security\nDifferent content A" },
      { path: "b.md", content: "Role: Security\nDifferent content B" },
    ]);
    assert.ok(r.errors.some((e) => e.includes("role tag")));
  });

  test("distinct evals → no errors/warnings", () => {
    const r = checkEvalDistinctness([
      { path: "a.md", content: "# Security Review\nRole: Security\nAll good" },
      { path: "b.md", content: "# Perf Review\nRole: Performance\nNeeds work" },
    ]);
    assert.equal(r.errors.length, 0);
    assert.equal(r.warnings.length, 0);
  });
});
