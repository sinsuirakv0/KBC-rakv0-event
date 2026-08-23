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

test("workflowはApp、専用PAT、GH_TOKEN_EVENTの順だけでprivate認証を選ぶ", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/monitor-battlecats-google-play.yml", import.meta.url),
    "utf8",
  );
  const selectionStart = workflow.indexOf("- name: Select private authentication");
  const appTokenStart = workflow.indexOf("- name: Create repository-scoped GitHub App token");
  const selection = workflow.slice(selectionStart, appTokenStart);
  const app = selection.indexOf('if [[ -n "$MONITOR_APP_ID" || -n "$MONITOR_APP_PRIVATE_KEY" ]]');
  const dedicatedPat = selection.indexOf('elif [[ -n "$FALLBACK_TOKEN" ]]');
  const emergency = selection.indexOf('elif [[ -n "$EMERGENCY_TOKEN" ]]');
  const failure = selection.indexOf("Private GitHub authentication is not configured.");

  assert.ok(selectionStart >= 0 && appTokenStart > selectionStart);
  assert.match(selection, /EMERGENCY_TOKEN: \$\{\{ secrets\.GH_TOKEN_EVENT \}\}/);
  assert.ok(app >= 0 && app < dedicatedPat && dedicatedPat < emergency && emergency < failure);
  assert.ok(workflow.includes(
    "BATTLECATS_PRIVATE_TOKEN: ${{ steps.app-token.outputs.token || secrets.BATTLECATS_PRIVATE_DISPATCH_TOKEN || secrets.GH_TOKEN_EVENT }}",
  ));
  assert.doesNotMatch(selection, /(?:echo|printf).*\$(?:FALLBACK_TOKEN|EMERGENCY_TOKEN)/);
});

test("workflowのRapid Monitorは60秒間を5秒間隔で監視する", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/monitor-battlecats-google-play.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /BATTLECATS_MONITOR_DURATION_MS: '60000'/);
  assert.match(workflow, /BATTLECATS_MONITOR_INTERVAL_MS: '5000'/);
  assert.doesNotMatch(workflow, /BATTLECATS_MONITOR_DURATION_MS: '85000'/);
  assert.doesNotMatch(workflow, /BATTLECATS_MONITOR_INTERVAL_MS: '2000'/);
});

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
  assert.deepEqual(getMonitorTiming({}), {
    durationMs: 60_000,
    intervalMs: 5_000,
    timeoutMs: 8_000,
    jitterMs: 250,
  });
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
