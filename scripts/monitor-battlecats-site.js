import {
  BATTLECATS_PACKAGE,
  buildUpdateEventId,
  compareVersions,
  extractCurrentVersion,
  getRepositoryJson,
  getRepositoryRevision,
  isValidVersion,
  notifyLineUpdate,
} from "../lib/battlecats-monitor.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const CATALOG_PATH = "metadata/jp/catalog.json";
const VERSION_PATH = "metadata/jp/current.json";
const DEFAULT_SITE_URL = "https://kbc-rakv0.pages.dev/pages/asset-explorer/";
const DEFAULT_WAIT_DURATION_MS = 80 * 60_000;
const DEFAULT_WAIT_INTERVAL_MS = 10_000;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function numberFromEnv(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.trunc(parsed))) : fallback;
}
function manifestPathFor(snapshot) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(snapshot?.datasetId)) return null;
  const version=snapshot.storageVersion===2?String(snapshot.versionCode):snapshot.datasetId;
  if(snapshot.storageVersion===2&&(!Number.isSafeInteger(snapshot.versionCode)||snapshot.versionCode<=0))return null;
  const expected = `metadata/jp/versions/${version}.inventory.json`;
  return snapshot.inventoryPath === expected ? expected : null;
}
function isManifestReady(manifest, snapshot) {
  if (manifest?.schemaVersion !== 1 || manifest.datasetId !== snapshot.datasetId || manifest.sourceRegion !== "jp"
    || manifest.versionCode !== snapshot.versionCode || manifest.versionName !== snapshot.versionName || !Array.isArray(manifest.files)) return false;
  return manifest.files.length === snapshot.fileCount
    && manifest.files.every(file => Number.isSafeInteger(file.size) && file.size >= 0 && /^[a-f0-9]{64}$/.test(file.sha256))
    && manifest.files.reduce((sum,file)=>sum+file.size,0) === snapshot.totalSize;
}
export function selectComparisonSnapshots(catalog, expectedVersion) {
  if (!isValidVersion(expectedVersion) || catalog?.schemaVersion !== 1 || catalog.sourceRegion !== "jp" || !Array.isArray(catalog.snapshots)) return null;
  const snapshots = catalog.snapshots.filter(snapshot => isValidVersion(snapshot.versionName)
    && Number.isSafeInteger(snapshot.versionCode) && snapshot.versionCode > 0 && manifestPathFor(snapshot))
    .map(snapshot => ({...snapshot, id:snapshot.datasetId, dataset:"Local"}));
  const current = snapshots.filter(snapshot => snapshot.versionName === expectedVersion).sort((a,b)=>b.versionCode-a.versionCode)[0];
  if (!current) return null;
  const previous = snapshots.filter(snapshot => compareVersions(snapshot.versionName,expectedVersion)<0 && snapshot.versionCode<current.versionCode).sort((a,b)=>b.versionCode-a.versionCode)[0];
  return {current,previous:previous || null};
}
export function buildAssetExplorerUrl(baseUrl, currentSnapshot, previousSnapshot) {
  const url = new URL(baseUrl || DEFAULT_SITE_URL);
  url.searchParams.set("dataset","Local");
  url.searchParams.set("version",currentSnapshot.id);
  if(previousSnapshot) url.searchParams.set("compare",previousSnapshot.id);
  url.searchParams.set("view",previousSnapshot ? "diff" : "list");
  url.searchParams.set("layout","list");
  if(currentSnapshot.revision) url.searchParams.set("revision",currentSnapshot.revision);
  return url.toString();
}
async function checkPublicSite(revision,selected) {
  const url = new URL("/api/asset-explorer",process.env.BATTLECATS_ASSET_EXPLORER_URL || DEFAULT_SITE_URL);
  url.search = new URLSearchParams({op:"catalog",revision});
  const response = await fetch(url,{signal:AbortSignal.timeout(10000)});
  if(!response.ok) return false;
  const catalog=await response.json();
  const snapshots=[selected.current,selected.previous].filter(Boolean);
  if(catalog.revision!==revision || !snapshots.every(item=>catalog.snapshots?.some(snapshot=>snapshot.dataset==="Local" && snapshot.id===item.id))) return false;
  for(const item of snapshots) {
    url.search=new URLSearchParams({op:"manifest",dataset:"Local",version:item.id,revision});
    const ready=await fetch(url,{signal:AbortSignal.timeout(10000)});
    if(!ready.ok) return false;
  }
  return true;
}
export async function findReadyComparison({owner,assetsRepo,token,assetsRef="main",expectedVersion,getJson=getRepositoryJson,getRevision=getRepositoryRevision,checkSite=checkPublicSite}) {
  const revision=await getRevision({owner,repo:assetsRepo,token,ref:assetsRef});
  const read=path=>getJson({owner,repo:assetsRepo,path,token,ref:revision});
  const current=await read(VERSION_PATH);
  if(extractCurrentVersion(current)!==expectedVersion) return null;
  const catalog=await read(CATALOG_PATH);
  if(!Array.isArray(catalog?.snapshots)) return null;
  const selected=selectComparisonSnapshots({...catalog,snapshots:catalog.snapshots.filter(entry=>entry.versionName!==expectedVersion || entry.buildId===current.buildId)},expectedVersion);
  if(!selected || selected.current.datasetId!==current.datasetId) return null;
  const [currentManifest,previousManifest]=await Promise.all([read(manifestPathFor(selected.current)),selected.previous ? read(manifestPathFor(selected.previous)) : null]);
  if(!isManifestReady(currentManifest,selected.current) || (selected.previous && !isManifestReady(previousManifest,selected.previous)) || !await checkSite(revision,selected)) return null;
  selected.current.revision=revision; if(selected.previous) selected.previous.revision=revision;
  return {...selected,currentManifest,previousManifest,siteUrl:buildAssetExplorerUrl(process.env.BATTLECATS_ASSET_EXPLORER_URL,selected.current,selected.previous)};
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
