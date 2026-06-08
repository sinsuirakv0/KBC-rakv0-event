/**
 * メインエントリポイント
 *
 * 通常実行:
 *   node scripts/run.js
 *
 * 強制更新（既存JSONを削除して再生成）:
 *   node scripts/run.js --force
 *   node scripts/run.js --force gatya        # 特定ファイルのみ
 *   node scripts/run.js --force gatya sale   # 複数指定も可
 */

import { getJWT }        from "../lib/jwt.js";
import { notifyDiscord, notifyEventBot } from "../lib/discord.js";
import { fetchAndCheck } from "./fetch-tsv.js";
import { updateFiles }   from "./update-files.js";

const ALL_TYPES = ["gatya", "sale", "item"];

// 引数を解析
const args    = process.argv.slice(2);
const force   = args.includes("--force");
const targets = args.filter(a => a !== "--force");

// --force に続けてファイル名が指定されていればそれだけ、なければ全部
const types = (force && targets.length > 0)
  ? targets.filter(t => ALL_TYPES.includes(t))
  : ALL_TYPES;

async function processType(name, jwt) {
  console.log(`\n--- ${name} ---`);

  const fetchResult = await fetchAndCheck(name, jwt);
  if (fetchResult.error) {
    console.error(`[${name}] スキップ（取得エラー）`);
    await notifyDiscord({ type: name, status: 'failed', force, error: fetchResult.error });
    return { name, success: false, skipped: true, error: fetchResult.error };
  }

  if (!fetchResult.changed && !force) {
    console.log(`[${name}] 変更なし、スキップ`);
    return { name, success: true, changed: false };
  }

  await notifyDiscord({ type: name, status: 'detected', force, hash: fetchResult.hash });
  const result = await updateFiles(name, fetchResult.text, fetchResult.hash, force);
  if (result.success) {
    await notifyDiscord({ type: name, status: 'updated', force, hash: fetchResult.hash });
  } else {
    await notifyDiscord({ type: name, status: 'failed', force, hash: fetchResult.hash, error: result.error });
  }
  return { name, ...result, changed: true };
}

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`=== 実行開始: ${startedAt}${force ? " [--force]" : ""} ===`);
  if (force) console.log(`対象: ${types.join(", ")}`);

  try {
    console.log("JWT取得中...");
    const jwt = await getJWT();
    console.log("JWT取得成功");

    console.log(`並列処理開始: ${types.join(", ")}`);
    const results = await Promise.all(types.map(name => processType(name, jwt)));
    const failed = results.filter(r => !r.success && !r.skipped);
    if (failed.length > 0) {
      throw new Error(`更新失敗: ${failed.map(r => `${r.name}=${r.error}`).join(', ')}`);
    }

    const updated = results.filter(r => r.success && r.changed);
    if (updated.length > 0) {
      const rawUnixValues = updated.map(r => r.rawUnix).filter(Number.isFinite);
      const historyUnix = rawUnixValues.length ? Math.max(...rawUnixValues) : null;
      await notifyEventBot({
        types: updated.map(r => r.name),
        detectedAt: startedAt,
        historyUnix,
        force,
      });
    }

  } catch (err) {
    console.error("致命的なエラー:", err.message);
    process.exit(1);
  }

  console.log("\n=== 処理完了 ===");
}

main();
