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

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`=== 実行開始: ${startedAt}${force ? " [--force]" : ""} ===`);
  if (force) console.log(`対象: ${types.join(", ")}`);

  try {
    console.log("JWT取得中...");
    const jwt = await getJWT();
    console.log("JWT取得成功");

    for (const name of types) {
      console.log(`\n--- ${name} ---`);

      const fetchResult = await fetchAndCheck(name, jwt);
      if (fetchResult.error) {
        console.error(`[${name}] スキップ（取得エラー）`);
        continue;
      }

      if (!fetchResult.changed && !force) {
        console.log(`[${name}] 変更なし、スキップ`);
        continue;
      }

      await updateFiles(name, fetchResult.text, fetchResult.hash, force);
    }

  } catch (err) {
    console.error("致命的なエラー:", err.message);
    process.exit(1);
  }

  console.log("\n=== 処理完了 ===");
}

main();
