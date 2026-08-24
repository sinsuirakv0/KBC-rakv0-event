import { createHash, timingSafeEqual } from "node:crypto";

export const BATTLECATS_PACKAGE = "jp.co.ponos.battlecats";
export const DEFAULT_MONITOR_DURATION_MS = 60_000;
export const DEFAULT_MONITOR_INTERVAL_MS = 5_000;
export const LINE_BOT_UPDATE_PATH = "/battlecats-update";
export const LINE_BOT_NOTIFICATION_ATTEMPTS = 2;
export const LINE_BOT_NOTIFICATION_TIMEOUT_MS = 2_000;

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const ACTIVE_RUN_STATUSES = new Set(["queued", "in_progress", "waiting", "requested", "pending"]);

function decodeHtmlEntities(value) {
  return value
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
}

function readPath(value, path) {
  return path.reduce((current, key) => current?.[key], value);
}

function parseInitDataScripts(html) {
  const scripts = html.match(/<script[^>]*>[\s\S]*?<\/script>/gi) ?? [];
  const parsed = [];

  for (const script of scripts) {
    if (!script.includes("AF_initDataCallback") || !script.includes(BATTLECATS_PACKAGE)) continue;
    const keyMatch = script.match(/key:\s*'([^']+)'/);
    const dataStart = script.indexOf("data:");
    const dataEnd = script.lastIndexOf(", sideChannel:");
    if (!keyMatch || dataStart < 0 || dataEnd <= dataStart) continue;

    try {
      parsed.push({ key: keyMatch[1], data: JSON.parse(script.slice(dataStart + 5, dataEnd)) });
    } catch {
      // Google Play側の別データ塊は無視し、既知のアプリ詳細構造だけを採用する。
    }
  }

  return parsed;
}

export function parseGooglePlayHtml(html) {
  if (typeof html !== "string" || html.length === 0) {
    throw new Error("Google Play HTML is empty");
  }

  const whatsNewMatch = html.match(
    /<h2[^>]*>\s*新機能\s*<\/h2>[\s\S]{0,10000}?<div[^>]*itemprop=["']description["'][^>]*>([\s\S]*?)<\/div>/i,
  );
  const whatsNewText = whatsNewMatch ? decodeHtmlEntities(whatsNewMatch[1]).trim() : "";
  const releaseNotesVersion = whatsNewText.match(/^\s*\[(\d+\.\d+\.\d+)\]/)?.[1] ?? null;

  let structuredVersion = null;
  for (const entry of parseInitDataScripts(html)) {
    const packageName = readPath(entry.data, [1, 2, 77, 0]);
    const versionName = readPath(entry.data, [1, 2, 140, 0, 0, 0]);
    if (packageName === BATTLECATS_PACKAGE && isValidVersion(versionName)) {
      structuredVersion = versionName;
      break;
    }
  }

  return {
    releaseNotesVersion,
    structuredVersion,
    matched: Boolean(releaseNotesVersion && releaseNotesVersion === structuredVersion),
    candidateVersion: releaseNotesVersion === structuredVersion ? releaseNotesVersion : null,
  };
}

export function isValidVersion(value) {
  return typeof value === "string" && VERSION_PATTERN.test(value);
}

export function compareVersions(left, right) {
  if (!isValidVersion(left) || !isValidVersion(right)) {
    throw new Error("Version must use x.y.z numeric format");
  }

  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}

export function extractCurrentVersion(payload) {
  const version = payload?.versionName ?? payload?.version ?? null;
  if (!isValidVersion(version)) throw new Error("jp/version.json has no valid versionName");
  if (payload?.packageName && payload.packageName !== BATTLECATS_PACKAGE) {
    throw new Error("jp/version.json packageName does not match Battle Cats JP");
  }
  return version;
}

function parseBoundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

export function getMonitorTiming(env = process.env) {
  return {
    durationMs: parseBoundedNumber(env.BATTLECATS_MONITOR_DURATION_MS, DEFAULT_MONITOR_DURATION_MS, 10_000, 90_000),
    intervalMs: parseBoundedNumber(env.BATTLECATS_MONITOR_INTERVAL_MS, DEFAULT_MONITOR_INTERVAL_MS, 1_000, 10_000),
    timeoutMs: parseBoundedNumber(env.BATTLECATS_HTTP_TIMEOUT_MS, 8_000, 2_000, 15_000),
    jitterMs: parseBoundedNumber(env.BATTLECATS_MONITOR_JITTER_MS, 250, 0, 1_000),
  };
}

export function verifyBearerAuthorization(authorization, expectedSecret) {
  if (typeof expectedSecret !== "string" || expectedSecret.length < 32) return false;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return false;
  const suppliedSecret = authorization.slice("Bearer ".length);
  const expectedDigest = createHash("sha256").update(expectedSecret, "utf8").digest();
  const suppliedDigest = createHash("sha256").update(suppliedSecret, "utf8").digest();
  return timingSafeEqual(expectedDigest, suppliedDigest);
}

export function normalizeLineBotUpdateUrl(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    const url = new URL(value.trim());
    url.pathname = LINE_BOT_UPDATE_PATH;
    return url.toString();
  } catch {
    return null;
  }
}

export function buildUpdateEventId(versionName) {
  if (!isValidVersion(versionName)) throw new Error("Update event version is invalid");
  // versionごとに固定し、同じ更新を複数runが検知しても同じeventIdを使う。
  return `battlecats-jp-google-play-${versionName}`;
}

export async function notifyLineUpdate({
  url,
  secret,
  versionName,
  detectedAt,
  eventId,
  phase = "detected",
  siteUrl,
  fetchImpl = fetch,
  attempts = LINE_BOT_NOTIFICATION_ATTEMPTS,
  timeoutMs = LINE_BOT_NOTIFICATION_TIMEOUT_MS,
  sleepImpl = (ms) => new Promise(resolve => setTimeout(resolve, ms)),
}) {
  const endpoint = normalizeLineBotUpdateUrl(url);
  if (!endpoint || typeof secret !== "string" || secret.length === 0) {
    console.warn("LINE bot update notification skipped: endpoint is not configured");
    return false;
  }
  if (!isValidVersion(versionName) || typeof detectedAt !== "string" || typeof eventId !== "string") {
    throw new Error("LINE bot update notification payload is invalid");
  }
  if (phase !== "detected" && phase !== "site") {
    throw new Error("LINE bot update notification phase is invalid");
  }
  if (phase === "site" && typeof siteUrl !== "string") {
    throw new Error("LINE bot site notification requires siteUrl");
  }

  const payload = phase === "detected"
    ? { phase, versionName, region: "JP", detectedAt, eventId }
    : { phase, versionName, region: "JP", detectedAt, eventId, siteUrl };
  const maxAttempts = Math.max(1, Math.min(3, Math.trunc(Number(attempts)) || 1));
  const requestTimeout = Math.max(500, Math.min(5_000, Math.trunc(Number(timeoutMs)) || LINE_BOT_NOTIFICATION_TIMEOUT_MS));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-event-update-secret": secret,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(requestTimeout),
      });
      if (response.ok) {
        console.log(`LINE bot update notification accepted: phase=${phase}`);
        return true;
      }
      console.warn(`LINE bot update notification attempt ${attempt} failed: HTTP ${response.status}`);
    } catch {
      console.warn(`LINE bot update notification attempt ${attempt} failed`);
    }
    if (attempt < maxAttempts) await sleepImpl(100);
  }

  console.warn(`LINE bot update notification failed after ${maxAttempts} attempts`);
  return false;
}

export function activeWorkflowRuns(runs) {
  return (Array.isArray(runs) ? runs : []).filter(run => ACTIVE_RUN_STATUSES.has(run?.status));
}

function runMentionsVersion(run, version) {
  const text = `${run?.name ?? ""} ${run?.display_title ?? ""}`;
  return new RegExp(`(^|[^0-9.])${version.replaceAll(".", "\\.")}([^0-9.]|$)`).test(text);
}

export function evaluateDispatch({ candidateVersion, currentVersion, runs = [] }) {
  if (!isValidVersion(candidateVersion) || !isValidVersion(currentVersion)) {
    return { shouldDispatch: false, reason: "invalid-version" };
  }
  if (compareVersions(candidateVersion, currentVersion) <= 0) {
    return { shouldDispatch: false, reason: "target-current-or-older" };
  }

  const activeRuns = activeWorkflowRuns(runs);
  if (activeRuns.some(run => runMentionsVersion(run, candidateVersion))) {
    return { shouldDispatch: false, reason: "target-already-running" };
  }
  if (activeRuns.length > 0) {
    return { shouldDispatch: false, reason: "another-publish-run-active" };
  }
  return { shouldDispatch: true, reason: "new-version" };
}

export function githubHeaders(token, extra = {}) {
  if (!token) throw new Error("Private GitHub token is not configured");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "KBC-BattleCats-Rapid-Monitor/1.0",
    ...extra,
  };
}

export async function getRepositoryJson({ owner, repo, path, token, fetchImpl = fetch }) {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
  const response = await fetchImpl(url, { headers: githubHeaders(token), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`GitHub contents request failed with HTTP ${response.status}`);
  const body = await response.json();
  if (body?.encoding !== "base64" || typeof body?.content !== "string") {
    throw new Error("GitHub contents response is invalid");
  }
  const text = Buffer.from(body.content.replace(/\s/g, ""), "base64").toString("utf8").replace(/^\uFEFF/, "");
  return JSON.parse(text);
}

export async function listWorkflowRuns({ owner, repo, workflow, token, fetchImpl = fetch }) {
  const url = new URL(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflow)}/runs`);
  url.searchParams.set("event", "workflow_dispatch");
  url.searchParams.set("per_page", "30");
  const response = await fetchImpl(url, { headers: githubHeaders(token), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`GitHub workflow runs request failed with HTTP ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body?.workflow_runs)) throw new Error("GitHub workflow runs response is invalid");
  return body.workflow_runs;
}

export async function dispatchGitHubWorkflow({ owner, repo, workflow, ref = "main", inputs = {}, token, fetchImpl = fetch }) {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: githubHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ ref, inputs }),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status !== 204) throw new Error(`GitHub workflow dispatch failed with HTTP ${response.status}`);
}

export async function dispatchWorkflow(options) {
  if (!isValidVersion(options.expectedVersion)) throw new Error("Expected version is invalid");
  return dispatchGitHubWorkflow({
    ...options,
    inputs: { expected_version: options.expectedVersion },
  });
}
