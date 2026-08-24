import {
  BATTLECATS_PACKAGE,
  buildUpdateEventId,
  compareVersions,
  dispatchWorkflow,
  dispatchGitHubWorkflow,
  evaluateDispatch,
  extractCurrentVersion,
  getMonitorTiming,
  getRepositoryJson,
  listWorkflowRuns,
  notifyLineUpdate,
  parseGooglePlayHtml,
} from "../lib/battlecats-monitor.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PLAY_URL = `https://play.google.com/store/apps/details?id=${BATTLECATS_PACKAGE}&hl=ja&gl=JP`;
const USER_AGENT = "KBC-BattleCats-Rapid-Monitor/1.0 (+https://github.com/sinsuirakv0/KBC-rakv0-event)";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

async function fetchPlaySignals(timeoutMs) {
  const response = await fetch(PLAY_URL, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.5",
      Accept: "text/html,application/xhtml+xml",
      "Cache-Control": "no-cache",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (response.status === 403 || response.status === 429) {
    const error = new Error(`Google Play rate-limit response HTTP ${response.status}`);
    error.stopImmediately = true;
    throw error;
  }
  if (!response.ok) throw new Error(`Google Play request failed with HTTP ${response.status}`);

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > 4_000_000) {
    throw new Error("Google Play response is unexpectedly large");
  }
  const html = await response.text();
  if (html.length > 4_000_000) throw new Error("Google Play response is unexpectedly large");
  return parseGooglePlayHtml(html);
}

async function readPublishedVersion(config) {
  const payload = await getRepositoryJson({
    owner: config.owner,
    repo: config.assetsRepo,
    path: "jp/version.json",
    token: config.token,
  });
  return extractCurrentVersion(payload);
}

export async function dispatchFollowupWithRetry(options, dispatch = dispatchGitHubWorkflow, sleepImpl = sleep) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await dispatch(options);
      return true;
    } catch {
      if (attempt < maxAttempts) await sleepImpl(250);
    }
  }
  return false;
}

export async function checkDedupeAndDispatch(config, candidateVersion, dependencies = {}) {
  // dispatch直前にprivate側の状態を再取得し、並行更新や既存runをfail closedで扱う。
  const readVersion = dependencies.readPublishedVersion ?? (() => readPublishedVersion(config));
  const listRuns = dependencies.listWorkflowRuns ?? listWorkflowRuns;
  const currentVersion = await readVersion();
  const runs = await listRuns({
    owner: config.owner,
    repo: config.publishRepo,
    workflow: config.publishWorkflow,
    token: config.token,
  });
  const decision = evaluateDispatch({ candidateVersion, currentVersion, runs });
  if (!decision.shouldDispatch) {
    console.log(`Publish dispatch skipped: reason=${decision.reason} target=${candidateVersion} current=${currentVersion}`);
    return false;
  }

  const detectedAt = new Date().toISOString();
  const eventId = buildUpdateEventId(candidateVersion);
  const notify = dependencies.notifyLineUpdate ?? notifyLineUpdate;
  // private側のdedupe確認を通過した瞬間に通知し、重いpublisher処理より先に届ける。
  try {
    await notify({
      url: config.lineBotUpdateUrl,
      secret: config.lineBotUpdateSecret,
      phase: "detected",
      versionName: candidateVersion,
      detectedAt,
      eventId,
    });
  } catch {
    // 通知障害でpublisherを止めない。秘密値やendpointはログに出さない。
    console.warn("LINE bot update notification failed unexpectedly");
  }

  const dispatch = dependencies.dispatchWorkflow ?? dispatchWorkflow;
  await dispatch({
    owner: config.owner,
    repo: config.publishRepo,
    workflow: config.publishWorkflow,
    expectedVersion: candidateVersion,
    token: config.token,
  });
  console.log(`Publish workflow dispatched: expected_version=${candidateVersion}`);

  if (config.followupToken) {
    const followupStarted = await dispatchFollowupWithRetry({
      owner: config.owner,
      repo: config.ownerRepo,
      workflow: config.siteWorkflow,
      ref: "main",
      inputs: {
        expected_version: candidateVersion,
        detected_at: detectedAt,
        event_id: eventId,
      },
      token: config.followupToken,
    }, dependencies.dispatchFollowup ?? dispatchGitHubWorkflow, dependencies.sleep ?? sleep);
    if (followupStarted) {
      console.log(`Site follow-up workflow dispatched: expected_version=${candidateVersion}`);
    } else {
      // publisher dispatch済みのため、follow-up起動障害でpublisherを失敗扱いにしない。
      console.warn("Site follow-up workflow dispatch failed");
    }
  } else {
    console.warn("Site follow-up workflow dispatch skipped: token is not configured");
  }
  return true;
}

export async function runMonitor() {
  const timing = getMonitorTiming();
  const config = {
    token: requiredEnv("BATTLECATS_PRIVATE_TOKEN"),
    owner: process.env.BATTLECATS_GITHUB_OWNER?.trim() || "sinsuirakv0",
    assetsRepo: process.env.BATTLECATS_ASSETS_REPO?.trim() || "KBC-rakv0-assets",
    publishRepo: process.env.BATTLECATS_PUBLISH_REPO?.trim() || "battlecats-apk",
    publishWorkflow: process.env.BATTLECATS_PUBLISH_WORKFLOW?.trim() || "download-battlecats.yml",
    ownerRepo: process.env.GITHUB_REPOSITORY?.split("/")[1]?.trim() || "KBC-rakv0-event",
    siteWorkflow: process.env.BATTLECATS_SITE_WORKFLOW?.trim() || "monitor-battlecats-site.yml",
    followupToken: process.env.BATTLECATS_FOLLOWUP_TOKEN?.trim() || "",
    lineBotUpdateUrl: process.env.LINE_BOT_UPDATE_URL?.trim() || "",
    lineBotUpdateSecret: process.env.LINE_BOT_UPDATE_SECRET?.trim() || "",
  };
  let currentVersion = await readPublishedVersion(config);
  const deadline = Date.now() + timing.durationMs;
  let round = 0;
  let consecutiveFailures = 0;

  console.log(`Rapid monitor started: current=${currentVersion} durationMs=${timing.durationMs} intervalMs=${timing.intervalMs}`);

  do {
    const roundStartedAt = Date.now();
    round++;
    try {
      const signals = await fetchPlaySignals(timing.timeoutMs);
      consecutiveFailures = 0;
      console.log(
        `Round ${round}: releaseNotes=${signals.releaseNotesVersion ?? "missing"} structured=${signals.structuredVersion ?? "missing"} matched=${signals.matched}`,
      );

      if (signals.matched && compareVersions(signals.candidateVersion, currentVersion) > 0) {
        const dispatched = await checkDedupeAndDispatch(config, signals.candidateVersion);
        if (dispatched) return;
        currentVersion = await readPublishedVersion(config);
        return;
      }
    } catch (error) {
      if (error?.stopImmediately) throw error;
      consecutiveFailures++;
      console.warn(`Round ${round}: transient check failure (${error.message})`);
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    const jitter = Math.floor(Math.random() * (timing.jitterMs + 1));
    const failureBackoff = consecutiveFailures > 0
      ? Math.min(10_000, timing.intervalMs * (2 ** Math.min(consecutiveFailures - 1, 3)))
      : timing.intervalMs;
    const elapsedMs = Date.now() - roundStartedAt;
    const waitMs = Math.min(remainingMs, Math.max(0, failureBackoff + jitter - elapsedMs));
    if (waitMs > 0) await sleep(waitMs);
  } while (Date.now() < deadline);

  console.log("Rapid monitor completed without a new matching version");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runMonitor().catch(error => {
    console.error(`Rapid monitor failed: ${error.message}`);
    process.exitCode = 1;
  });
}
