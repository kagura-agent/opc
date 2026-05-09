export function validHandshake(overrides = {}) {
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
