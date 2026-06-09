import crypto from "crypto";
import { getGitHubFile } from "../lib/github.js";

const BASE_URL = "https://nyanko-events.ponosgames.com/battlecats_production";

/**
 * TSVを取得し、保存済みMD5と比較する。
 * 前回hashを取得できない場合は誤検知を避けるため更新扱いにせずエラーにする。
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
    const prevFile = await getGitHubFile(`hashes/${name}.md5`);
    if (!prevFile) {
      throw new Error(`previous hash file not found: hashes/${name}.md5`);
    }

    const prevHash = prevFile.content.trim();
    const changed = hash !== prevHash;
    console.log(`[${name}] hash current=${hash} previous=${prevHash}`);
    console.log(`[${name}] ${changed ? "変更あり" : "変更なし"}`);
    return { changed, text, hash, error: null };
  } catch (err) {
    console.error(`[${name}] fetchAndCheck エラー:`, err.message);
    return { changed: false, text: null, hash: null, error: err.message };
  }
}
