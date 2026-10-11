import assert from "node:assert/strict";
import test from "node:test";
import { acquireAdvisoryLock, runWorkerCycles, safeErrorMessage, shouldAdvanceNewestCheckpoint, summarizeSnapshotObservations } from "./worker-runtime.ts";

test("one-shot execution completes exactly one bounded cycle without waiting", async () => {
  let calls = 0;
  let waits = 0;
  const events = [];
  const result = await runWorkerCycles({ once: true, cycle: async () => { calls++; return { processed: 2 }; }, wait: async () => { waits++; }, intervalMs: 1, shouldStop: () => false, log: (name, data) => events.push([name, data]) });
  assert.deepEqual(result, { cycles: 1, failures: 0 });
  assert.equal(calls, 1);
  assert.equal(waits, 0);
  assert.equal(events[0][0], "cycle_complete");
  assert.equal(events[0][1].processed, 2);
});

test("one-shot failures propagate to the process entry point", async () => {
  const failure = Object.assign(new Error("temporary RPC failure"), { code: "ETIMEDOUT" });
  await assert.rejects(runWorkerCycles({ once: true, cycle: async () => { throw failure; }, wait: async () => {}, intervalMs: 1, shouldStop: () => false, log: () => {} }), /temporary RPC failure/);
});

test("continuous execution retries the same cycle after a transient failure", async () => {
  let calls = 0;
  let stopping = false;
  const events = [];
  const result = await runWorkerCycles({ once: false, cycle: async () => { calls++; if (calls === 1) throw new Error("transient"); stopping = true; return { cursor: "persisted" }; }, wait: async () => {}, intervalMs: 1, shouldStop: () => stopping, log: (name, data) => events.push([name, data]) });
  assert.equal(calls, 2);
  assert.deepEqual(result, { cycles: 1, failures: 0 });
  assert.deepEqual(events.map(([name]) => name), ["cycle_error", "cycle_complete"]);
  assert.equal(events[1][1].cursor, "persisted");
});

test("advisory lock contention is reported without processing", async () => {
  let processing = false;
  const client = { query: async (_sql, values) => { assert.deepEqual(values, ["mira-test-lock"]); return { rows: [{ locked: false }] }; } };
  assert.equal(await acquireAdvisoryLock(client, "mira-test-lock"), false);
  assert.equal(processing, false);
  assert.equal(await acquireAdvisoryLock({ query: async () => ({ rows: [{ locked: true }] }) }, "mira-test-lock"), true);
});

test("bounded head scans keep the prior durable checkpoint until reaching it", () => {
  assert.equal(shouldAdvanceNewestCheckpoint(true, false, false), false);
  assert.equal(shouldAdvanceNewestCheckpoint(true, true, false), true);
  assert.equal(shouldAdvanceNewestCheckpoint(true, false, true), true);
  assert.equal(shouldAdvanceNewestCheckpoint(false, false, false), true);
});

test("partial and unavailable snapshot results stay explicit", () => {
  assert.deepEqual(summarizeSnapshotObservations([{ dataStatus: "partial" }, { dataStatus: "unavailable" }]), { partial: 1, unavailable: 1 });
});

test("worker error messages redact database URLs, API credentials, and bearer tokens", () => {
  const error = new Error("failed postgres://user:secret@db.example.invalid/MIRA?sslmode=require; key=pk_live_Abcdefgh12345678; Authorization: Bearer abc.def.token");
  const safe = safeErrorMessage(error);
  assert.doesNotMatch(safe, /secret|Abcdefgh|abc\.def\.token/);
  assert.match(safe, /\[redacted database URL\]/);
  assert.match(safe, /\[redacted credential\]/);
  assert.match(safe, /Bearer \[redacted\]/);
});

test("cursor retry and duplicate insert contract remain idempotent", async () => {
  const persisted = new Map();
  let cursor = "sig-100";
  const processPage = async () => {
    const next = ["sig-99", "sig-98"];
    let inserted = 0;
    for (const signature of next) { if (!persisted.has(signature)) inserted++; persisted.set(signature, true); }
    return { nextCursor: "sig-98", inserted };
  };
  const first = await processPage();
  cursor = first.nextCursor;
  const retry = await processPage();
  assert.equal(cursor, "sig-98");
  assert.equal(retry.nextCursor, cursor);
  assert.equal(persisted.size, 2);
  assert.equal(retry.inserted, 0, "the worker's ON CONFLICT DO NOTHING persistence is safe to retry");
});
