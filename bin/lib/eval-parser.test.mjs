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
  parseEvaluation,
} from "./eval-parser.mjs";

// ─── Regex constants ─────────────────────────────────────────────

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

// ─── checkEvalDistinctness ───────────────────────────────────────

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
    // Lines must be >10 chars to count
    const shared = Array.from({ length: 8 }, (_, i) => `This is shared line number ${i}`);
    const a = [...shared, "unique a line that is long enough"].join("\n");
    const b = [...shared, "unique b line that is long enough"].join("\n");
    const r = checkEvalDistinctness([
      { path: "a.md", content: a },
      { path: "b.md", content: b },
    ]);
    assert.equal(r.warnings.length >= 1, true);
    assert.ok(r.warnings.some(w => w.includes("overlap")));
  });

  test("identical headings → warning", () => {
    const r = checkEvalDistinctness([
      { path: "a.md", content: "# Code Review\nContent A is different" },
      { path: "b.md", content: "# Code Review\nContent B is different" },
    ]);
    assert.ok(r.warnings.some(w => w.includes("identical headings")));
  });

  test("identical role tags → error", () => {
    const r = checkEvalDistinctness([
      { path: "a.md", content: "Role: Security\nDifferent content A" },
      { path: "b.md", content: "Role: Security\nDifferent content B" },
    ]);
    assert.ok(r.errors.some(e => e.includes("role tag")));
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

// ─── parseEvaluation ─────────────────────────────────────────────

describe("parseEvaluation", () => {
  test("detects verdict when present", () => {
    const r = parseEvaluation("VERDICT: PASS FINDINGS[0]");
    assert.equal(r.verdict_present, true);
    assert.equal(r.verdict, "PASS FINDINGS[0]");
  });

  test("verdict absent", () => {
    const r = parseEvaluation("No verdict here");
    assert.equal(r.verdict_present, false);
    assert.equal(r.verdict, "");
  });

  test("counts severities", () => {
    const text = [
      "🔴 src/a.js:1 — critical bug",
      "🔴 src/b.js:2 — another critical",
      "🟡 src/c.js:3 — a warning",
      "🔵 src/d.js:4 — a suggestion",
    ].join("\n");
    const r = parseEvaluation(text);
    assert.equal(r.critical, 2);
    assert.equal(r.warning, 1);
    assert.equal(r.suggestion, 1);
    assert.equal(r.findings_count, 4);
  });

  test("detects file references", () => {
    const r = parseEvaluation("🔴 src/foo.js:10 — issue");
    assert.equal(r.has_file_refs, true);
  });

  test("no file refs when absent", () => {
    const r = parseEvaluation("🔴 some issue without file ref — bad");
    assert.equal(r.has_file_refs, false);
  });

  test("detects hedging", () => {
    const r = parseEvaluation("🔴 src/a.js:1 — you might want to fix this");
    assert.ok(r.hedging_detected.length > 0);
  });

  test("parses finding with file, line, fix, reasoning", () => {
    const text = [
      "🔴 src/app.js:42 — missing null check",
      "→ Add a null guard before access",
      "Reasoning: prevents runtime crash",
    ].join("\n");
    const r = parseEvaluation(text);
    assert.equal(r.findings.length, 1);
    const f = r.findings[0];
    assert.equal(f.severity, "critical");
    assert.equal(f.file, "src/app.js");
    assert.equal(f.line, 42);
    assert.equal(f.fix, "Add a null guard before access");
    assert.equal(f.reasoning, "prevents runtime crash");
  });

  test("skips section labels like '🔴 Must Fix:'", () => {
    const text = "🔴 Must Fix:\n🔴 src/a.js:1 — real finding";
    const r = parseEvaluation(text);
    assert.equal(r.findings_count, 1);
  });

  test("skips empty markers (None., N/A) after section label", () => {
    const text = "🔴 Must Fix:\n- None.\n🟡 Warnings:\nN/A";
    const r = parseEvaluation(text);
    assert.equal(r.findings_count, 0);
  });

  test("skips bare emoji filler lines like '🔴 None.'", () => {
    const r = parseEvaluation("🔴 None.\n🟡 N/A\n🔵 nothing");
    assert.equal(r.findings_count, 0);
  });

  test("thinEval when lineCount < 50", () => {
    const r = parseEvaluation("short\neval");
    assert.equal(r.thinEval, true);
    assert.ok(r.lineCount < 50);
  });

  test("not thinEval when lineCount >= 50", () => {
    const lines = Array.from({ length: 60 }, (_, i) => `Line ${i}`);
    const r = parseEvaluation(lines.join("\n"));
    assert.equal(r.thinEval, false);
  });

  test("CRLF normalization", () => {
    const r = parseEvaluation("VERDICT: PASS\r\n🔴 src/a.js:1 — bug\r\n");
    assert.equal(r.verdict_present, true);
    assert.equal(r.findings_count, 1);
  });

  test("verdictCountMatch when FINDINGS[N] matches", () => {
    const text = "VERDICT: PASS FINDINGS[2]\n🔴 a.js:1 — x\n🟡 b.js:2 — y";
    const r = parseEvaluation(text);
    assert.equal(r.verdict_count_match, true);
  });

  test("verdictCountMatch false when mismatch", () => {
    const text = "VERDICT: PASS FINDINGS[5]\n🔴 a.js:1 — x";
    const r = parseEvaluation(text);
    assert.equal(r.verdict_count_match, false);
  });

  test("verdictCountMatch null when no FINDINGS[N] but findings exist", () => {
    const text = "VERDICT: PASS\n🔴 a.js:1 — x";
    const r = parseEvaluation(text);
    assert.equal(r.verdict_count_match, null);
  });

  test("noCodeRefs true when no file:line refs", () => {
    const r = parseEvaluation("Just text with no refs");
    assert.equal(r.noCodeRefs, true);
  });

  test("fileLineRefCount counts all refs", () => {
    const r = parseEvaluation("🔴 a.js:1 — x\n🔴 b.js:2 — y");
    assert.equal(r.fileLineRefCount, 2);
  });

  test("lowUniqueContent detects copy-paste padding", () => {
    // 20+ lines with many duplicates → uniqueRatio < 0.6
    const lines = Array.from({ length: 30 }, () => "This is a repeated padding line");
    const r = parseEvaluation(lines.join("\n"));
    assert.equal(r.lowUniqueContent, true);
  });

  test("singleHeading true when only one heading and >=30 lines", () => {
    const lines = ["# Review", ...Array.from({ length: 35 }, (_, i) => `Content line ${i}`)];
    const r = parseEvaluation(lines.join("\n"));
    assert.equal(r.singleHeading, true);
  });

  test("singleHeading false with multiple headings", () => {
    const lines = ["# Review", "## Section", ...Array.from({ length: 35 }, (_, i) => `Line ${i}`)];
    const r = parseEvaluation(lines.join("\n"));
    assert.equal(r.singleHeading, false);
  });

  test("aspirationalClaims detected", () => {
    const text = [
      "🔴 a.js:1 — should consider refactoring this",
      "🔴 b.js:2 — worth exploring alternatives here",
      "🔴 c.js:3 — it would be nice to add tests",
    ].join("\n");
    const r = parseEvaluation(text);
    assert.equal(r.aspirationalClaims, true);
    assert.equal(r.aspirationalLineCount, 3);
  });

  test("aspirationalClaims false for actionable findings", () => {
    const text = [
      "🔴 a.js:1 — missing null check causes crash",
      "🔴 b.js:2 — SQL injection vulnerability",
    ].join("\n");
    const r = parseEvaluation(text);
    assert.equal(r.aspirationalClaims, false);
  });

  test("findingDensityLow when few emoji lines in long doc", () => {
    const lines = [
      "🔴 a.js:1 — one finding",
      ...Array.from({ length: 55 }, (_, i) => `Padding line number ${i} for density`),
    ];
    const r = parseEvaluation(lines.join("\n"));
    assert.equal(r.findingDensityLow, true);
  });

  test("missingReasoningRatio and missingFixRatio", () => {
    const text = "🔴 a.js:1 — issue without fix or reasoning";
    const r = parseEvaluation(text);
    assert.equal(r.missingReasoningRatio, 100);
    assert.equal(r.missingFixRatio, 100);
    assert.equal(r.findingsWithoutReasoning, 1);
    assert.equal(r.findingsWithoutFix, 1);
  });

  test("fix and reasoning bring ratios to 0", () => {
    const text = [
      "🔴 a.js:1 — issue",
      "→ Fix it",
      "Reasoning: because",
    ].join("\n");
    const r = parseEvaluation(text);
    assert.equal(r.missingReasoningRatio, 0);
    assert.equal(r.missingFixRatio, 0);
  });

  test("lineLengthVarianceLow for uniform lines", () => {
    // 15+ content lines all the same length
    const lines = Array.from({ length: 20 }, () => "Exactly the same length line here!!");
    const r = parseEvaluation(lines.join("\n"));
    assert.equal(r.lineLengthVarianceLow, true);
  });

  test("headingCount counts h1-h3 headings", () => {
    const text = "# H1\n## H2\n### H3\n#### H4 not counted";
    const r = parseEvaluation(text);
    assert.equal(r.headingCount, 3);
  });
});
