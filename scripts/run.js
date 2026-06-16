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
import { fetchAndCheck } from "./fetch-tsv.js";
import { updateFiles } from "./update-files.js";

const ALL_TYPES = ["gatya", "sale", "item"];
const NORMAL_ROUNDS = 3;
const EXTRA_ROUNDS_AFTER_CHANGE = 1;

const args = process.argv.slice(2);
const force = args.includes("--force");
const cliTargets = args.filter(a => a !== "--force");
const envTargets = (process.env.FORCE_TARGETS || "")
  .split(/\s+/)
  .map(t => t.trim())
  .filter(Boolean);
const targets = [...cliTargets, ...envTargets];

const types = (force && targets.length > 0)
  ? targets.filter(t => ALL_TYPES.includes(t))
  : ALL_TYPES;

async function processType(name, jwt) {
  console.log(`\n--- ${name} ---`);

  const fetchResult = await fetchAndCheck(name, jwt);
  if (fetchResult.error) {
    console.error(`[${name}] skipped after fetch error: ${fetchResult.error}`);
    await notifyDiscord({ type: name, status: "failed", force, error: fetchResult.error });
    return { name, success: false, skipped: true, error: fetchResult.error };
  }

  if (!fetchResult.changed && !force) {
    console.log(`[${name}] unchanged; skipping update`);
    return { name, success: true, changed: false };
  }

  await notifyDiscord({ type: name, status: "detected", force, hash: fetchResult.hash });
  const result = await updateFiles(name, fetchResult.text, fetchResult.hash, force);
  if (result.success) {
    await notifyDiscord({ type: name, status: "updated", force, hash: fetchResult.hash });
  } else {
    await notifyDiscord({ type: name, status: "failed", force, hash: fetchResult.hash, error: result.error });
  }

  return { name, ...result, changed: true };
}

async function runRound(round, jwt, totalRounds) {
  console.log(`\n=== Round ${round}/${totalRounds}: ${types.join(", ")} ===`);

  const results = await Promise.all(types.map(name => processType(name, jwt)));
  const failed = results.filter(r => !r.success && !r.skipped);
  if (failed.length > 0) {
    throw new Error(`update failed: ${failed.map(r => `${r.name}=${r.error}`).join(", ")}`);
  }

  const updated = results.filter(r => r.success && r.changed);
  if (updated.length > 0) {
    console.log(`Round ${round}: changed ${updated.map(r => r.name).join(", ")}`);
  } else {
    console.log(`Round ${round}: no changes`);
  }

  return { results, updated };
}

async function main() {
  const startedAt = new Date().toISOString();
  const baseRounds = force ? 1 : NORMAL_ROUNDS;
  const allUpdated = [];

  console.log(`=== Event check started ${startedAt}${force ? " [--force]" : ""} ===`);
  if (force) console.log(`Targets: ${types.join(", ")}`);

  try {
    console.log("Preparing JWT...");
    const jwtResult = await getJWTWithCache();
    const jwtSource = jwtResult.cacheHit ? "cache" : "fresh";
    console.log(`JWT ready (${jwtSource}${jwtResult.createdAt ? `, createdAt=${jwtResult.createdAt}` : ""})`);

    for (let round = 1; round <= baseRounds; round++) {
      const { updated } = await runRound(round, jwtResult.jwt, baseRounds);
      allUpdated.push(...updated);
    }

    if (!force && allUpdated.length > 0) {
      console.log(`\nChange detected during the first ${NORMAL_ROUNDS} rounds; running one extra round.`);
      const extraRound = NORMAL_ROUNDS + 1;
      const { updated } = await runRound(extraRound, jwtResult.jwt, NORMAL_ROUNDS + EXTRA_ROUNDS_AFTER_CHANGE);
      allUpdated.push(...updated);
    }

    if (allUpdated.length > 0) {
      const rawUnixValues = allUpdated.map(r => r.rawUnix).filter(Number.isFinite);
      const historyUnix = rawUnixValues.length ? Math.max(...rawUnixValues) : null;
      const updatedTypes = [...new Set(allUpdated.map(r => r.name))];
      await notifyEventBot({
        types: updatedTypes,
        detectedAt: startedAt,
        historyUnix,
        force,
      });
    }
  } catch (err) {
    console.error("Fatal error:", err.message);
    process.exit(1);
  }

  console.log("\n=== Event check complete ===");
}

main();
