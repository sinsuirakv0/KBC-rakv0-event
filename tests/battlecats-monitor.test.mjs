import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  compareVersions,
  dispatchWorkflow,
  evaluateDispatch,
  extractCurrentVersion,
  getMonitorTiming,
  getRepositoryJson,
  parseGooglePlayHtml,
  verifyBearerAuthorization,
} from "../lib/battlecats-monitor.js";

const matchingFixture = await readFile(new URL("./fixtures/google-play-matching.html", import.meta.url), "utf8");
const mismatchFixture = await readFile(new URL("./fixtures/google-play-mismatch.html", import.meta.url), "utf8");

test("新機能とstructured metadataが一致した場合だけ候補を返す", () => {
  assert.deepEqual(parseGooglePlayHtml(matchingFixture), {
    releaseNotesVersion: "15.5.1",
    structuredVersion: "15.5.1",
    matched: true,
    candidateVersion: "15.5.1",
  });
});

test("2つのGoogle Play signalが不一致なら候補を返さない", () => {
  assert.deepEqual(parseGooglePlayHtml(mismatchFixture), {
    releaseNotesVersion: "15.5.2",
    structuredVersion: "15.5.1",
    matched: false,
    candidateVersion: null,
  });
});

test("レビュー中のversion文字列をstructured metadataとして誤認しない", () => {
  const html = '<h2>新機能</h2><div itemprop="description">[15.5.1]<br>修正</div><p>15.5.1</p>';
  assert.equal(parseGooglePlayHtml(html).matched, false);
});

test("versionを数値segmentごとに比較する", () => {
  assert.equal(compareVersions("15.10.0", "15.9.9"), 1);
  assert.equal(compareVersions("15.5.1", "15.5.1"), 0);
  assert.equal(compareVersions("14.9.9", "15.0.0"), -1);
  assert.throws(() => compareVersions("15.5", "15.5.1"));
});

test("jp/version.jsonのpackageとversionを検証する", () => {
  assert.equal(extractCurrentVersion({ packageName: "jp.co.ponos.battlecats", versionName: "15.5.1" }), "15.5.1");
  assert.throws(() => extractCurrentVersion({ packageName: "other.app", versionName: "15.5.1" }));
});

test("監視時間を安全範囲に固定する", () => {
  assert.deepEqual(getMonitorTiming({
    BATTLECATS_MONITOR_DURATION_MS: "999999",
    BATTLECATS_MONITOR_INTERVAL_MS: "1",
    BATTLECATS_HTTP_TIMEOUT_MS: "50000",
    BATTLECATS_MONITOR_JITTER_MS: "5000",
  }), { durationMs: 90_000, intervalMs: 1_000, timeoutMs: 15_000, jitterMs: 1_000 });
});

test("Bearer secretは32文字以上かつ完全一致だけ許可する", () => {
  const secret = "a-very-long-monitor-secret-value-123456789";
  assert.equal(verifyBearerAuthorization(`Bearer ${secret}`, secret), true);
  assert.equal(verifyBearerAuthorization("Bearer wrong", secret), false);
  assert.equal(verifyBearerAuthorization(`Bearer ${secret}`, "short"), false);
});

test("currentより増加したversionでactive runがない場合だけdispatchする", () => {
  assert.deepEqual(evaluateDispatch({ candidateVersion: "15.5.2", currentVersion: "15.5.1", runs: [] }), {
    shouldDispatch: true,
    reason: "new-version",
  });
  assert.equal(evaluateDispatch({ candidateVersion: "15.5.1", currentVersion: "15.5.1", runs: [] }).shouldDispatch, false);
  assert.deepEqual(evaluateDispatch({
    candidateVersion: "15.5.2",
    currentVersion: "15.5.1",
    runs: [{ status: "in_progress", display_title: "Publish Battle Cats 15.5.2" }],
  }), { shouldDispatch: false, reason: "target-already-running" });
  assert.deepEqual(evaluateDispatch({
    candidateVersion: "15.5.2",
    currentVersion: "15.5.1",
    runs: [{ status: "queued", display_title: "Publish Battle Cats JP" }],
  }), { shouldDispatch: false, reason: "another-publish-run-active" });
});

test("GitHub Contents APIのbase64 JSONを読む", async () => {
  const payload = { versionName: "15.5.1" };
  const result = await getRepositoryJson({
    owner: "owner",
    repo: "assets",
    path: "jp/version.json",
    token: "token",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ encoding: "base64", content: Buffer.from(JSON.stringify(payload)).toString("base64") }),
    }),
  });
  assert.deepEqual(result, payload);
});

test("publisher dispatchへexpected_versionだけを渡す", async () => {
  let request;
  await dispatchWorkflow({
    owner: "owner",
    repo: "publisher",
    workflow: "download-battlecats.yml",
    expectedVersion: "15.5.2",
    token: "token",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { status: 204 };
    },
  });
  assert.deepEqual(JSON.parse(request.options.body), { ref: "main", inputs: { expected_version: "15.5.2" } });
  assert.equal(request.options.headers.Authorization, "Bearer token");
});
