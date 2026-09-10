import test from "node:test";
import assert from "node:assert/strict";
import { createSkdNotifier } from "../lib/skd-notifications.js";
import { checkAndNotify } from "../scripts/run.js";

function fixture() {
  let state = { version: 1, lastHashes: {} };
  let queue = Promise.resolve();
  let id = 0;
  const events = [];
  const repository = {
    async read() { return structuredClone(state); },
    update(change) { const task = queue.then(() => { state = change(structuredClone(state)); return structuredClone(state); }); queue = task.catch(() => {}); return task; },
  };
  const create = (send = async event => events.push(event)) => createSkdNotifier({ enabled: true, repository, send,
    revision: async () => "a".repeat(40), createId: () => `skd:${++id}`, now: () => "2026-09-10T00:00:00Z" });
  return { create, repository, events };
}

test("overlapping runs share a durable ID and completed hashes suppress duplicates", async () => {
  const f = fixture(); const first = f.create(); const second = f.create();
  const change = { name: "sale", hash: "b".repeat(32) };
  await Promise.all([first.detect(change), second.detect(change)]);
  assert.equal(new Set(f.events.map(event => event.eventId)).size, 1);
  await first.saved({ ...change, rawFilename: "raw/sale_123.tsv" });
  await second.finish();
  assert.equal(f.events.at(-1).phase, "ready");
  assert.equal(await f.create().detect(change), false);
  const next = { ...change, hash: "c".repeat(32) };
  await first.detect(next); await first.saved({ ...next, rawFilename: "raw/sale_124.tsv" }); await first.finish();
  await first.detect(change);
  assert.equal(f.events.at(-1).eventId, "skd:3");
});

test("failed ready delivery survives restart with the same source snapshot", async () => {
  const f = fixture(); const first = f.create(async event => { if (event.phase === "ready") throw new Error("offline"); });
  await first.detect({ name: "gatya", hash: "b".repeat(32) });
  await first.saved({ name: "gatya", hash: "b".repeat(32), rawFilename: "raw/gatya_123.tsv" });
  await assert.rejects(first.finish(), /offline/);
  assert.ok((await f.repository.read()).pending);
  await f.create().finish();
  assert.equal(f.events[0].eventId, "skd:1");
  assert.equal((await f.repository.read()).pending, undefined);
});

test("remote hash confirmation happens before every detection and fails closed", async () => {
  const hashes = {};
  const check = async name => ({ name, success: true, changed: true, hash: "same" });
  const result = await checkAndNotify(["sale"], check, hashes, async () => assert.fail("duplicate notification"), async () => "same");
  assert.equal(result[0].changed, false);
  await assert.rejects(checkAndNotify(["sale"], check, hashes, async () => assert.fail("unconfirmed notification"), async () => { throw new Error("offline"); }));
  assert.equal((await checkAndNotify(["sale"], check, hashes, async () => false, async () => "same", true))[0].changed, true);
});

test("ambiguous delivery remains recorded without blocking the next new update", async () => {
  const f = fixture();
  const notifier = f.create(async () => { throw Object.assign(new Error("held"), { status: 409 }); });
  const change = { name: "item", hash: "b".repeat(32), rawFilename: "raw/item_123.tsv" };
  await notifier.detect(change); await notifier.saved(change); await notifier.finish();
  const state = await f.repository.read();
  assert.ok(state.held["skd:1"]);
  assert.equal(state.pending, undefined);
  assert.equal(await f.create().detect(change), false);
  assert.equal(await f.create().detect({ ...change, hash: "c".repeat(32) }), true);
});
