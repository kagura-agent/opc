// file-lock.test.mjs — unit tests for file-lock.mjs

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import { lockFile } from "./file-lock.mjs";

/** Generate a unique temp file path (file itself is not created). */
function tmpPath() {
  return join(tmpdir(), `file-lock-test-${randomBytes(8).toString("hex")}.json`);
}

/** Paths to clean up after each test. */
const cleanups = [];

afterEach(() => {
  for (const p of cleanups) {
    for (const f of [p, `${p}.lock`]) {
      try { unlinkSync(f); } catch { /* ignore */ }
    }
  }
  cleanups.length = 0;
});

describe("lockFile — basic acquire and release", () => {
  test("acquire succeeds and creates .lock file, release removes it", () => {
    const fp = tmpPath();
    cleanups.push(fp);

    const result = lockFile(fp, { timeout: 1000 });
    assert.equal(result.acquired, true);
    assert.equal(typeof result.release, "function");
    assert.ok(existsSync(`${fp}.lock`), "lock file should exist after acquire");

    result.release();
    assert.ok(!existsSync(`${fp}.lock`), "lock file should be gone after release");
  });
});

describe("lockFile — lock file content", () => {
  test("lock file contains correct JSON with pid, nonce, timestamp, command", () => {
    const fp = tmpPath();
    cleanups.push(fp);

    const result = lockFile(fp, { command: "test-cmd" });
    assert.equal(result.acquired, true);

    const data = JSON.parse(readFileSync(`${fp}.lock`, "utf8"));
    assert.equal(data.pid, process.pid);
    assert.equal(typeof data.nonce, "string");
    assert.ok(data.nonce.length > 0);
    assert.equal(typeof data.timestamp, "string");
    assert.ok(!isNaN(Date.parse(data.timestamp)), "timestamp should be valid ISO");
    assert.equal(data.command, "test-cmd");

    result.release();
  });

  test("default command is 'unknown'", () => {
    const fp = tmpPath();
    cleanups.push(fp);

    const result = lockFile(fp);
    const data = JSON.parse(readFileSync(`${fp}.lock`, "utf8"));
    assert.equal(data.command, "unknown");
    result.release();
  });

  test("custom command name appears in lock data", () => {
    const fp = tmpPath();
    cleanups.push(fp);

    const result = lockFile(fp, { command: "my-custom-cmd" });
    const data = JSON.parse(readFileSync(`${fp}.lock`, "utf8"));
    assert.equal(data.command, "my-custom-cmd");
    result.release();
  });
});

describe("lockFile — release idempotency", () => {
  test("calling release twice does not throw", () => {
    const fp = tmpPath();
    cleanups.push(fp);

    const result = lockFile(fp);
    assert.equal(result.acquired, true);

    result.release();
    assert.ok(!existsSync(`${fp}.lock`));

    // Second call should be a no-op, not throw
    assert.doesNotThrow(() => result.release());
  });
});

describe("lockFile — stale lock detection (dead PID)", () => {
  test("lock file with dead PID gets cleaned up and new lock acquired", () => {
    const fp = tmpPath();
    cleanups.push(fp);

    // Write a lock file with a PID that is (almost certainly) dead
    const staleLock = {
      pid: 2147483647, // max 32-bit PID — extremely unlikely to be alive
      nonce: "deadbeef",
      timestamp: new Date().toISOString(),
      command: "stale-process",
    };
    writeFileSync(`${fp}.lock`, JSON.stringify(staleLock, null, 2) + "\n", { flag: "wx" });

    const result = lockFile(fp, { timeout: 1000 });
    assert.equal(result.acquired, true);

    const data = JSON.parse(readFileSync(`${fp}.lock`, "utf8"));
    assert.equal(data.pid, process.pid, "new lock should belong to current process");
    assert.notEqual(data.nonce, "deadbeef", "nonce should differ from stale lock");

    result.release();
  });
});

describe("lockFile — corrupt lock file", () => {
  test("invalid JSON in lock file is treated as stale", () => {
    const fp = tmpPath();
    cleanups.push(fp);

    // Write garbage to the lock file
    writeFileSync(`${fp}.lock`, "NOT VALID JSON {{{{", { flag: "wx" });

    const result = lockFile(fp, { timeout: 1000 });
    assert.equal(result.acquired, true);

    const data = JSON.parse(readFileSync(`${fp}.lock`, "utf8"));
    assert.equal(data.pid, process.pid);

    result.release();
  });
});

describe("lockFile — double acquire from same process", () => {
  test("second acquire within timeout succeeds because same PID is alive", () => {
    const fp = tmpPath();
    cleanups.push(fp);

    const first = lockFile(fp, { timeout: 1000 });
    assert.equal(first.acquired, true);

    // The current process holds the lock; since PID is alive, the retry
    // loop will keep spinning until timeout. Use a short timeout.
    const second = lockFile(fp, { timeout: 200 });
    // The second call should time out because the live PID still holds the lock
    assert.equal(second.acquired, false);
    assert.equal(second.holder.pid, process.pid);

    first.release();
  });
});

describe("lockFile — timeout returns holder info", () => {
  test("returns { acquired: false, holder } when lock held by live process", () => {
    const fp = tmpPath();
    cleanups.push(fp);

    const first = lockFile(fp);
    assert.equal(first.acquired, true);

    const second = lockFile(fp, { timeout: 100 });
    assert.equal(second.acquired, false);
    assert.equal(typeof second.holder, "object");
    assert.equal(second.holder.pid, process.pid);
    assert.equal(typeof second.holder.nonce, "string");
    assert.equal(typeof second.holder.timestamp, "string");

    first.release();
  });
});

describe("lockFile — maxRetries safety cap", () => {
  test("returns acquired: false when maxRetries exceeded", () => {
    const fp = tmpPath();
    cleanups.push(fp);

    // Lock held by current (live) process — will never be stale
    const first = lockFile(fp);
    assert.equal(first.acquired, true);

    // Use a very large timeout so that maxRetries (200) is the limiting factor
    // 200 retries * 50ms sleep = ~10s hard limit.  The function should bail
    // before the timeout of 999999ms.
    const before = Date.now();
    const second = lockFile(fp, { timeout: 999999 });
    const elapsed = Date.now() - before;

    assert.equal(second.acquired, false);
    // Should have terminated via maxRetries, not the timeout
    assert.ok(elapsed < 999999, "should finish well before the timeout");

    first.release();
  });
});

describe("lockFile — release only removes own lock", () => {
  test("release does not delete lock if pid+nonce do not match", () => {
    const fp = tmpPath();
    cleanups.push(fp);

    // Acquire a lock
    const result = lockFile(fp);
    assert.equal(result.acquired, true);

    // Overwrite the lock file to simulate another holder
    const otherLock = {
      pid: process.pid, // same PID but different nonce
      nonce: "other-holder-nonce",
      timestamp: new Date().toISOString(),
      command: "other",
    };
    writeFileSync(`${fp}.lock`, JSON.stringify(otherLock, null, 2) + "\n");

    // Release from first holder — should NOT remove the lock
    result.release();
    assert.ok(existsSync(`${fp}.lock`), "lock should still exist — belongs to other holder");

    // Verify the other holder's data is intact
    const data = JSON.parse(readFileSync(`${fp}.lock`, "utf8"));
    assert.equal(data.nonce, "other-holder-nonce");

    // Clean up
    try { unlinkSync(`${fp}.lock`); } catch { /* ignore */ }
  });

  test("release removes lock when pid+nonce match", () => {
    const fp = tmpPath();
    cleanups.push(fp);

    const result = lockFile(fp);
    assert.equal(result.acquired, true);

    // Don't tamper — release should remove it
    result.release();
    assert.ok(!existsSync(`${fp}.lock`));
  });
});
