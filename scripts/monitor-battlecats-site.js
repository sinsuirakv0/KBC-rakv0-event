import {
  BATTLECATS_PACKAGE,
  buildUpdateEventId,
  compareVersions,
  extractCurrentVersion,
  getRepositoryJson,
  isValidVersion,
  notifyLineUpdate,
} from "../lib/battlecats-monitor.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const CATALOG_PATH = "jp/explorer/catalog.json";
const VERSION_PATH = "jp/version.json";
const DEFAULT_SITE_URL = "https://kbc-rakv0.vercel.app/pages/asset-explorer/";
const DEFAULT_WAIT_DURATION_MS = 80 * 60_000;
const DEFAULT_WAIT_INTERVAL_MS = 10_000;
const LOCAL_MANIFEST_PREFIX = "jp/explorer/manifests/Local/";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function numberFromEnv(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

function localSnapshots(catalog) {
  if (Array.isArray(catalog?.datasets?.Local?.snapshots)) return catalog.datasets.Local.snapshots;
  if (Array.isArray(catalog?.snapshots)) return catalog.snapshots.filter(snapshot => snapshot?.dataset === "Local");
  return [];
}

function isSafeSnapshotId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
}

function manifestPathFor(snapshot) {
  if (!isSafeSnapshotId(snapshot?.id)) return null;
  const expected = `${LOCAL_MANIFEST_PREFIX}${snapshot.id}.json`;
  return snapshot.manifestPath === expected ? expected : null;
}

function isManifestReady(manifest, snapshot) {
  if (!(
    manifest
      && manifest.schemaVersion === 1
      && manifest.dataset === "Local"
      && manifest.snapshot === snapshot.id
      && manifest.files
      && typeof manifest.files === "object"
      && !Array.isArray(manifest.files)
  )) return false;

  const entries = Object.entries(manifest.files);
  const totalSize = entries.reduce((total, [, metadata]) => total + Number(metadata?.size), 0);
  return Number.isSafeInteger(Number(snapshot.fileCount))
    && Number(snapshot.fileCount) === entries.length
    && Number.isSafeInteger(Number(snapshot.totalSize))
    && Number(snapshot.totalSize) === totalSize
    && Number(manifest.fileCount) === entries.length
    && Number(manifest.totalSize) === totalSize;
}

export function selectComparisonSnapshots(catalog, expectedVersion) {
  if (!isValidVersion(expectedVersion)) return null;
  const snapshots = localSnapshots(catalog);
  const validSnapshots = snapshots.filter(snapshot => snapshot?.dataset === "Local"
    && isValidVersion(snapshot.versionName)
    && Number.isSafeInteger(Number(snapshot.versionCode))
    && Number(snapshot.versionCode) >= 0
    && typeof snapshot.available === "boolean"
    && manifestPathFor(snapshot));
  const current = validSnapshots
    .filter(snapshot => snapshot.versionName === expectedVersion)
    .sort((left, right) => Number(right.versionCode) - Number(left.versionCode))[0];
  if (!current || !manifestPathFor(current)) return null;

  const previous = validSnapshots
    .filter(snapshot => compareVersions(snapshot.versionName, expectedVersion) < 0
      && Number(snapshot.versionCode) < Number(current.versionCode))
    .sort((left, right) => {
      const versionCodeOrder = Number(right.versionCode) - Number(left.versionCode);
      if (versionCodeOrder !== 0) return versionCodeOrder;
      return compareVersions(right.versionName, left.versionName);
    })[0];
  if (!previous) return null;
  return { current, previous };
}

export function buildAssetExplorerUrl(baseUrl, currentSnapshot, previousSnapshot) {
  const url = new URL(baseUrl || DEFAULT_SITE_URL);
  url.searchParams.set("dataset", "Local");
  url.searchParams.set("version", currentSnapshot.id);
  url.searchParams.set("compare", previousSnapshot.id);
  url.searchParams.set("view", "diff");
  url.searchParams.set("layout", "list");
  return url.toString();
}

export async function findReadyComparison({
  owner,
  assetsRepo,
  token,
  expectedVersion,
  getJson = getRepositoryJson,
}) {
  const versionPayload = await getJson({ owner, repo: assetsRepo, path: VERSION_PATH, token });
  const publishedVersion = extractCurrentVersion(versionPayload);
  if (publishedVersion !== expectedVersion) return null;

  const catalog = await getJson({ owner, repo: assetsRepo, path: CATALOG_PATH, token });
  const selected = selectComparisonSnapshots(catalog, expectedVersion);
  if (!selected) return null;

  const [currentManifest, previousManifest] = await Promise.all([
    getJson({ owner, repo: assetsRepo, path: manifestPathFor(selected.current), token }),
    getJson({ owner, repo: assetsRepo, path: manifestPathFor(selected.previous), token }),
  ]);
  if (!isManifestReady(currentManifest, selected.current)
    || !isManifestReady(previousManifest, selected.previous)) return null;

  return {
    ...selected,
    currentManifest,
    previousManifest,
    siteUrl: buildAssetExplorerUrl(
      process.env.BATTLECATS_ASSET_EXPLORER_URL,
      selected.current,
      selected.previous,
    ),
  };
}

export async function waitForReadyComparison({
  owner,
  assetsRepo,
  token,
  expectedVersion,
  durationMs = DEFAULT_WAIT_DURATION_MS,
  intervalMs = DEFAULT_WAIT_INTERVAL_MS,
  findReady = findReadyComparison,
  sleepImpl = sleep,
}) {
  const deadline = Date.now() + durationMs;
  let attempt = 0;
  do {
    attempt++;
    try {
      const result = await findReady({ owner, assetsRepo, token, expectedVersion });
      if (result) {
        console.log(`Site data ready: expected_version=${expectedVersion} attempt=${attempt}`);
        return result;
      }
      console.log(`Site data not ready: expected_version=${expectedVersion} attempt=${attempt}`);
    } catch {
      console.warn(`Site data check failed: attempt=${attempt}`);
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await sleepImpl(Math.min(intervalMs, remainingMs));
  } while (Date.now() < deadline);

  throw new Error(`Site data was not ready within ${durationMs}ms`);
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export async function runSiteMonitor() {
  const expectedVersion = requiredEnv("BATTLECATS_SITE_EXPECTED_VERSION");
  const detectedAt = requiredEnv("BATTLECATS_SITE_DETECTED_AT");
  const eventId = requiredEnv("BATTLECATS_SITE_EVENT_ID");
  if (eventId !== buildUpdateEventId(expectedVersion)) throw new Error("BATTLECATS_SITE_EVENT_ID is invalid");

  const config = {
    owner: process.env.BATTLECATS_GITHUB_OWNER?.trim() || "sinsuirakv0",
    assetsRepo: process.env.BATTLECATS_ASSETS_REPO?.trim() || "KBC-rakv0-assets",
    token: requiredEnv("BATTLECATS_PRIVATE_TOKEN"),
  };
  const ready = await waitForReadyComparison({
    ...config,
    expectedVersion,
    durationMs: numberFromEnv(process.env.BATTLECATS_SITE_WAIT_DURATION_MS, DEFAULT_WAIT_DURATION_MS, 30_000, 90 * 60_000),
    intervalMs: numberFromEnv(process.env.BATTLECATS_SITE_WAIT_INTERVAL_MS, DEFAULT_WAIT_INTERVAL_MS, 2_000, 60_000),
  });
  const sent = await notifyLineUpdate({
    url: process.env.LINE_BOT_UPDATE_URL,
    secret: process.env.LINE_BOT_UPDATE_SECRET,
    phase: "site",
    versionName: expectedVersion,
    detectedAt,
    eventId,
    siteUrl: ready.siteUrl,
  });
  if (!sent) throw new Error("LINE bot site notification was not accepted");
  console.log(`Site notification sent: version=${expectedVersion}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runSiteMonitor().catch(error => {
    console.error(`Site follow-up failed: ${error.message}`);
    process.exitCode = 1;
  });
}
