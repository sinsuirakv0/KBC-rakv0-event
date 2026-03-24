import { updateGitHubFile, deleteGitHubFile } from "../lib/github.js";
import { getJSTTimestamp } from "../lib/timestamp.js";
import { parseGatya } from "../parsers/gatya.js";
import { parseSale }  from "../parsers/sale.js";
import { parseItem }  from "../parsers/item.js";

const parsers = { gatya: parseGatya, sale: parseSale, item: parseItem };

/**
 * 変更があったTSVをリポジトリに保存し、JSONに変換して保存する
 * @param {string}  name      - "gatya" | "sale" | "item"
 * @param {string}  tsvText   - 取得したTSVの内容
 * @param {string}  hash      - TSVのMD5ハッシュ
 * @param {boolean} force     - trueのとき既存JSONを削除してから再生成
 * @returns {{ success: boolean, error: string|null }}
 */
export async function updateFiles(name, tsvText, hash, force = false) {
  try {
    const parser = parsers[name];
    if (!parser) throw new Error(`parser not found: ${name}`);

    // 1. TSVをraw/に保存（ユニックス時間付きファイル名）
    const unixTime = Math.floor(Date.now() / 1000);
    console.log(`[${name}] TSVを raw/${name}_${unixTime}.tsv に保存中...`);
    await updateGitHubFile({
      path:    `raw/${name}_${unixTime}.tsv`,
      content: tsvText,
      message: `save ${name}.tsv (${unixTime})`,
    });

    // 2. --force のとき既存JSONを削除
    if (force) {
      console.log(`[${name}] data/${name}.json を削除中... (--force)`);
      await deleteGitHubFile({
        path:    `data/${name}.json`,
        message: `delete ${name}.json (forced)`,
      }).catch(() => {
        // ファイルが存在しない場合は無視
        console.log(`[${name}] data/${name}.json は存在しないためスキップ`);
      });
    }

    // 3. TSV→JSON変換して { updatedAt, data } 形式で保存
    console.log(`[${name}] JSON変換・保存中...`);
    const json = { updatedAt: getJSTTimestamp(), data: parser(tsvText) };
    await updateGitHubFile({
      path:    `data/${name}.json`,
      content: JSON.stringify(json, null, 2),
      message: `update ${name}.json${force ? " (forced)" : ""}`,
    });

    // 4. MD5ハッシュを保存
    console.log(`[${name}] hashes/${name}.md5 を保存中...`);
    await updateGitHubFile({
      path:    `hashes/${name}.md5`,
      content: hash,
      message: `update ${name}.md5${force ? " (forced)" : ""}`,
    });

    console.log(`[${name}] 完了`);
    return { success: true, error: null };

  } catch (err) {
    console.error(`[${name}] updateFiles エラー:`, err.message);
    return { success: false, error: err.message };
  }
}
