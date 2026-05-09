export function validDoc(opts = {}) {
  const outcomes = opts.outcomes ?? [
    "- OUT-1: The API returns status code 200 for valid requests",
    "- OUT-2: The API returns status code 400 for invalid input with error details",
    "- OUT-3: The response contains a JSON body with a `result` field",
  ];
  const verification = opts.verification ?? outcomes
    .map((o) => {
      const id = o.match(/OUT-\d+/)[0];
      return `- ${id}: assert HTTP status code matches expected value`;
    })
    .join("\n");
  const quality = opts.quality ?? "- No N+1 queries";
  const scope = opts.scope ?? "- No UI changes";
  const extra = opts.extra ?? "";

  return [
    "## Outcomes",
    outcomes.join("\n"),
    "",
    "## Verification",
    verification,
    "",
    "## Quality Constraints",
    quality,
    "",
    "## Out of Scope",
    scope,
    extra,
  ].join("\n");
}

export function failChecks(result) {
  return result.failures.map((f) => f.check);
}

export function warnChecks(result) {
  return result.warnings.map((w) => w.check);
}
