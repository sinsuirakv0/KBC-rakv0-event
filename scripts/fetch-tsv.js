import crypto from "crypto";
import { getGitHubFile } from "../lib/github.js";

const BASE_URL = "https://nyanko-events.ponosgames.com/battlecats_production";

/**
 * TSVを取得し、前回のMD5ハッシュと比較して変更があるか返す
 * @param {string} name - "gatya" | "sale" | "item"
 * @param {string} jwt
 * @returns {{ changed: boolean, text: string|null, hash: string|null, error: string|null }}
 */
export async function fetchAndCheck(name, jwt) {
  try {
    console.log(`[${name}] TSV取得中...`);
    const res = await fetch(`${BASE_URL}/${name}.tsv?jwt=${jwt}`);

    if (!res.ok) {
      throw new Error(`TSV取得失敗: HTTP ${res.status}`);
    }

    const text = await res.text();
    const hash = crypto.createHash("md5").update(text).digest("hex");

    // 前回のハッシュと比較
    const prevFile = await getGitHubFile(`hashes/${name}.md5`);
    const prevHash = prevFile?.content?.trim();
    const changed  = hash !== prevHash;

    console.log(`[${name}] 変更${changed ? "あり" : "なし"}`);
    return { changed, text, hash, error: null };

  } catch (err) {
    console.error(`[${name}] fetchAndCheck エラー:`, err.message);
    return { changed: false, text: null, hash: null, error: err.message };
  }
}
