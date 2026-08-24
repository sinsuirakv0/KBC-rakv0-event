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
  normalizeLineBotUpdateUrl,
  notifyLineUpdate,
  parseGooglePlayHtml,
  verifyBearerAuthorization,
} from "../lib/battlecats-monitor.js";
import { checkDedupeAndDispatch } from "../scripts/monitor-battlecats.js";

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

test("workflowは既存LINE_BOT_EVENT_UPDATE secretsを通知環境変数へ渡す", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/monitor-battlecats-google-play.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /LINE_BOT_UPDATE_URL: \$\{\{ secrets\.LINE_BOT_EVENT_UPDATE_URL \}\}/);
  assert.match(workflow, /LINE_BOT_UPDATE_SECRET: \$\{\{ secrets\.LINE_BOT_EVENT_UPDATE_SECRET \}\}/);
  assert.match(workflow, /BATTLECATS_FOLLOWUP_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /permissions:[\s\S]*actions: write/);
  const followupWorkflow = await readFile(
    new URL("../.github/workflows/monitor-battlecats-site.yml", import.meta.url),
    "utf8",
  );
  assert.match(followupWorkflow, /timeout-minutes: 90/);
  assert.match(followupWorkflow, /cancel-in-progress: true/);
  assert.match(followupWorkflow, /LINE_BOT_UPDATE_URL: \$\{\{ secrets\.LINE_BOT_EVENT_UPDATE_URL \}\}/);
  assert.match(followupWorkflow, /LINE_BOT_UPDATE_SECRET: \$\{\{ secrets\.LINE_BOT_EVENT_UPDATE_SECRET \}\}/);
});

test("LINE通知URLのpathnameは既存値に関係なくbattlecats-updateへ置換する", () => {
  assert.equal(
    normalizeLineBotUpdateUrl("https://bot.example.test/event-update?source=monitor"),
    "https://bot.example.test/battlecats-update?source=monitor",
  );
  assert.equal(normalizeLineBotUpdateUrl("https://bot.example.test/"), "https://bot.example.test/battlecats-update");
});

test("LINE detected通知のpayloadとheaderを固定契約で送る", async () => {
  let request;
  const sent = await notifyLineUpdate({
    url: "https://bot.example.test/event-update",
    secret: "line-secret",
    versionName: "15.5.2",
    detectedAt: "2026-08-24T04:00:00.000Z",
    eventId: "battlecats-jp-google-play-15.5.2",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200 };
    },
  });
  assert.equal(sent, true);
  assert.equal(request.url, "https://bot.example.test/battlecats-update");
  assert.equal(request.options.headers["x-event-update-secret"], "line-secret");
  assert.deepEqual(JSON.parse(request.options.body), {
    phase: "detected",
    versionName: "15.5.2",
    region: "JP",
    detectedAt: "2026-08-24T04:00:00.000Z",
    eventId: "battlecats-jp-google-play-15.5.2",
  });
});

test("LINE site通知はdetectedと同じ識別情報に比較URLだけを加える", async () => {
  let payload;
  const sent = await notifyLineUpdate({
    url: "https://bot.example.test/event-update",
    secret: "line-secret",
    phase: "site",
    versionName: "15.5.2",
    detectedAt: "2026-08-24T04:00:00.000Z",
    eventId: "battlecats-jp-google-play-15.5.2",
    siteUrl: "https://site.example.test/pages/asset-explorer/?dataset=Local&version=15502&compare=15501&view=diff&layout=list",
    fetchImpl: async (_url, options) => {
      payload = JSON.parse(options.body);
      return { ok: true, status: 200 };
    },
  });
  assert.equal(sent, true);
  assert.deepEqual(payload, {
    phase: "site",
    versionName: "15.5.2",
    region: "JP",
    detectedAt: "2026-08-24T04:00:00.000Z",
    eventId: "battlecats-jp-google-play-15.5.2",
    siteUrl: "https://site.example.test/pages/asset-explorer/?dataset=Local&version=15502&compare=15501&view=diff&layout=list",
  });
});

test("dedupe判定後はLINE detected通知をpublisher dispatchより先に行う", async () => {
  const events = [];
  const dispatched = await checkDedupeAndDispatch({
    owner: "owner",
    publishRepo: "publisher",
    publishWorkflow: "download-battlecats.yml",
    token: "token",
    lineBotUpdateUrl: "https://bot.example.test",
    lineBotUpdateSecret: "line-secret",
    followupToken: "",
  }, "15.5.2", {
    readPublishedVersion: async () => "15.5.1",
    listWorkflowRuns: async () => [],
    notifyLineUpdate: async payload => events.push({ kind: "notify", payload }),
    dispatchWorkflow: async () => events.push({ kind: "dispatch" }),
  });
  assert.equal(dispatched, true);
  assert.equal(events[0].kind, "notify");
  assert.equal(events[1].kind, "dispatch");
  assert.deepEqual(events[0].payload, {
    url: "https://bot.example.test",
    secret: "line-secret",
    phase: "detected",
    versionName: "15.5.2",
    detectedAt: events[0].payload.detectedAt,
    eventId: "battlecats-jp-google-play-15.5.2",
  });
});

test("LINE通知がfalseでもpublisher dispatchを止めず、follow-up dispatchは短くretryする", async () => {
  const events = [];
  let followupAttempts = 0;
  let followupOptions;
  let detectedPayload;
  const dispatched = await checkDedupeAndDispatch({
    owner: "owner",
    ownerRepo: "event",
    publishRepo: "publisher",
    publishWorkflow: "download-battlecats.yml",
    siteWorkflow: "monitor-battlecats-site.yml",
    token: "token",
    lineBotUpdateUrl: "https://bot.example.test",
    lineBotUpdateSecret: "line-secret",
    followupToken: "followup-token",
  }, "15.5.2", {
    readPublishedVersion: async () => "15.5.1",
    listWorkflowRuns: async () => [],
    notifyLineUpdate: async payload => { detectedPayload = payload; events.push("notify-failed"); return false; },
    dispatchWorkflow: async () => events.push("publisher"),
    dispatchFollowup: async options => {
      followupOptions = options;
      followupAttempts++;
      if (followupAttempts === 1) throw new Error("temporary");
      events.push("followup");
    },
    sleep: async () => {},
  });
  assert.equal(dispatched, true);
  assert.deepEqual(events, ["notify-failed", "publisher", "followup"]);
  assert.equal(followupAttempts, 2);
  assert.equal(followupOptions.inputs.expected_version, "15.5.2");
  assert.equal(followupOptions.inputs.detected_at, detectedPayload.detectedAt);
  assert.equal(followupOptions.inputs.event_id, detectedPayload.eventId);
});

test("LINE通知実装の予期しない例外でもpublisher dispatchを止めない", async () => {
  let dispatchCount = 0;
  const dispatched = await checkDedupeAndDispatch({
    owner: "owner",
    publishRepo: "publisher",
    publishWorkflow: "download-battlecats.yml",
    token: "token",
    followupToken: "",
  }, "15.5.2", {
    readPublishedVersion: async () => "15.5.1",
    listWorkflowRuns: async () => [],
    notifyLineUpdate: async () => { throw new Error("temporary"); },
    dispatchWorkflow: async () => { dispatchCount++; },
  });
  assert.equal(dispatched, true);
  assert.equal(dispatchCount, 1);
});

test("同じcandidateのpublisher active runがあれば通知もdispatchもしない", async () => {
  let notifyCount = 0;
  let dispatchCount = 0;
  const dispatched = await checkDedupeAndDispatch({
    owner: "owner",
    publishRepo: "publisher",
    publishWorkflow: "download-battlecats.yml",
    token: "token",
    followupToken: "",
  }, "15.5.2", {
    readPublishedVersion: async () => "15.5.1",
    listWorkflowRuns: async () => [{ status: "in_progress", display_title: "15.5.2" }],
    notifyLineUpdate: async () => { notifyCount++; },
    dispatchWorkflow: async () => { dispatchCount++; },
  });
  assert.equal(dispatched, false);
  assert.equal(notifyCount, 0);
  assert.equal(dispatchCount, 0);
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
