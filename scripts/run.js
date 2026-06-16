/**
 * Event check entrypoint.
 *
 * Normal:
 *   node scripts/run.js
 *
 * Force update:
 *   node scripts/run.js --force
 *   node scripts/run.js --force gatya
 *   node scripts/run.js --force gatya sale
 */

import { getJWTWithCache } from "../lib/jwt.js";
import { notifyDiscord, notifyEventBot } from "../lib/discord.js";
import { fetchAndCheck, readPreviousHash } from "./fetch-tsv.js";
import { updateFiles } from "./update-files.js";

const ALL_TYPES = ["gatya", "sale", "item"];
const DEFAULT_CHECK_DURATION_MS = 85_000;
const DEFAULT_CHECK_INTERVAL_MS = 2_000;
const MIN_CHECK_INTERVAL_MS = 1_000;

const args = process.argv.slice(2);
const force = args.includes("--force");
const testDetect = args.includes("--test-detect") || process.env.EVENT_TEST_DETECT === "true";
const cliTargets = args.filter(a => !["--force", "--test-detect"].includes(a));
const envTargets = (process.env.FORCE_TARGETS || "")
  .split(/\s+/)
  .map(t => t.trim())
  .filter(Boolean);
const targets = [...cliTargets, ...envTargets];

const types = (force && targets.length > 0)
  ? targets.filter(t => ALL_TYPES.includes(t))
  : ALL_TYPES;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

async function loadHashes() {
  const entries = await Promise.all(types.map(async name => [name, await readPreviousHash(name, { preferRemote: true })]));
  return Object.fromEntries(entries);
}

async function checkType(name, jwt, hashes) {
  console.log(`\n--- ${name} ---`);

  const fetchResult = await fetchAndCheck(name, jwt, hashes[name]);
  if (fetchResult.error) {
    console.error(`[${name}] skipped after fetch error: ${fetchResult.error}`);
    await notifyDiscord({ type: name, status: "failed", force, error: fetchResult.error });
    return { name, success: false, skipped: true, changed: false, error: fetchResult.error };
  }

  if (!fetchResult.changed && !force) {
    console.log(`[${name}] unchanged; skipping update`);
    return { name, success: true, changed: false, ...fetchResult };
  }

  return { name, success: true, changed: true, ...fetchResult };
}

async function updateType(result, hashes) {
  if (!force) {
    try {
      const remoteHash = await readPreviousHash(result.name, { preferRemote: true });
      if (remoteHash === result.hash) {
        console.log(`[${result.name}] remote hash already updated; skipping duplicate update`);
        hashes[result.name] = result.hash;
        return { name: result.name, success: true, changed: false, duplicate: true, hash: result.hash };
      }
    } catch (err) {
      console.warn(`[${result.name}] remote hash recheck failed; continuing update: ${err.message}`);
    }
  }

  await notifyDiscord({ type: result.name, status: "detected", force, hash: result.hash });

  const updateResult = await updateFiles(result.name, result.text, result.hash, force);
  if (updateResult.success) {
    await notifyDiscord({ type: result.name, status: "updated", force, hash: result.hash });
  } else {
    await notifyDiscord({ type: result.name, status: "failed", force, hash: result.hash, error: updateResult.error });
  }

  return { name: result.name, ...updateResult, changed: true, hash: result.hash };
}

async function notifyUpdated(updated) {
  if (updated.length === 0) return;

  const rawUnixValues = updated.map(r => r.rawUnix).filter(Number.isFinite);
  const historyUnix = rawUnixValues.length ? Math.max(...rawUnixValues) : null;
  const updatedTypes = [...new Set(updated.map(r => r.name))];
  const hashes = Object.fromEntries(updated.map(r => [r.name, r.hash]).filter(([, hash]) => hash));
  await notifyEventBot({
    types: updatedTypes,
    detectedAt: new Date().toISOString(),
    historyUnix,
    force,
    phase: "updated",
    hashes,
  });
}

async function runDetectionTest(jwt, startedAt) {
  const testId = process.env.EVENT_TEST_ID || process.env.GITHUB_RUN_ID || String(Date.now());
  const hashes = await loadHashes();
  const checked = await Promise.all(types.map(name => checkType(name, jwt, hashes)));
  const ok = checked.filter(result => result.success);
  const failed = checked.filter(result => !result.success);
  if (failed.length > 0) {
    console.warn(`Detection test had fetch failures: ${failed.map(result => `${result.name}=${result.error}`).join(", ")}`);
  }
  if (ok.length === 0) {
    throw new Error("detection test has no successful TSV fetches");
  }

  const detectedAt = new Date().toISOString();
  const testHashes = Object.fromEntries(ok.map(result => [result.name, result.hash]).filter(([, hash]) => hash));
  await notifyEventBot({
    types: ok.map(result => result.name),
    detectedAt,
    force,
    phase: "detected",
    hashes: testHashes,
    source: "github-actions-test",
    test: true,
    testId,
    startedAt,
  });
  console.log(`Detection test notification sent: testId=${testId} types=${ok.map(result => result.name).join(",")}`);
}

async function runRound(round, jwt, hashes, notifyFast) {
  console.log(`\n=== Round ${round}: ${types.join(", ")} ===`);

  const checked = await Promise.all(types.map(name => checkType(name, jwt, hashes)));
  const failed = checked.filter(r => !r.success && !r.skipped);
  if (failed.length > 0) {
    throw new Error(`check failed: ${failed.map(r => `${r.name}=${r.error}`).join(", ")}`);
  }

  const changed = checked.filter(r => r.success && r.changed);
  if (changed.length === 0) {
    console.log(`Round ${round}: no changes`);
    return { results: checked, updated: [] };
  }

  console.log(`Round ${round}: changed ${changed.map(r => r.name).join(", ")}`);
  await notifyFast(changed);

  const updateResults = await Promise.all(changed.map(result => updateType(result, hashes)));
  const updateFailed = updateResults.filter(r => !r.success);
  if (updateFailed.length > 0) {
    throw new Error(`update failed: ${updateFailed.map(r => `${r.name}=${r.error}`).join(", ")}`);
  }

  const updated = updateResults.filter(r => r.changed);
  for (const result of updated) {
    hashes[result.name] = result.hash;
  }
  await notifyUpdated(updated);

  return { results: checked, updated };
}

async function main() {
  const startedAt = new Date().toISOString();
  const notifiedHashes = new Map();
  const checkDurationMs = numberFromEnv("EVENT_CHECK_DURATION_MS", DEFAULT_CHECK_DURATION_MS);
  const checkIntervalMs = Math.max(
    MIN_CHECK_INTERVAL_MS,
    numberFromEnv("EVENT_CHECK_INTERVAL_MS", DEFAULT_CHECK_INTERVAL_MS)
  );

  console.log(`=== Event check started ${startedAt}${force ? " [--force]" : ""} ===`);
  if (force) console.log(`Targets: ${types.join(", ")}`);

  async function notifyFast(changed) {
    const fresh = changed.filter(r => notifiedHashes.get(r.name) !== r.hash);
    if (fresh.length === 0) return;

    for (const result of fresh) notifiedHashes.set(result.name, result.hash);
    const detectedAt = new Date().toISOString();
    const hashes = Object.fromEntries(fresh.map(r => [r.name, r.hash]));

    await notifyEventBot({
      types: fresh.map(r => r.name),
      detectedAt,
      force,
      phase: "detected",
      hashes,
    });
  }

  try {
    console.log("Preparing JWT...");
    const jwtResult = await getJWTWithCache();
    const jwtSource = jwtResult.cacheHit ? "cache" : "fresh";
    console.log(`JWT ready (${jwtSource}${jwtResult.createdAt ? `, createdAt=${jwtResult.createdAt}` : ""})`);

    if (testDetect) {
      await runDetectionTest(jwtResult.jwt, startedAt);
      return;
    }

    const hashes = await loadHashes();

    if (force) {
      await runRound(1, jwtResult.jwt, hashes, notifyFast);
    } else {
      const deadline = Date.now() + checkDurationMs;
      let round = 0;
      console.log(`Looping checks for ${checkDurationMs}ms at ${checkIntervalMs}ms intervals`);

      do {
        const roundStartedAt = Date.now();
        round++;
        await runRound(round, jwtResult.jwt, hashes, notifyFast);

        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) break;

        const elapsedMs = Date.now() - roundStartedAt;
        const waitMs = Math.min(checkIntervalMs, remainingMs);
        console.log(`Round ${round} elapsed=${elapsedMs}ms; waiting ${waitMs}ms`);
        await sleep(waitMs);
      } while (Date.now() < deadline);
    }
  } catch (err) {
    console.error("Fatal error:", err.message);
    process.exit(1);
  }

  console.log("\n=== Event check complete ===");
}

main();
