import { updateGitHubFile, deleteGitHubFile } from "../lib/github.js";
import { getJSTTimestamp } from "../lib/timestamp.js";
import { Script, createContext } from 'vm';
import { createRequire } from 'module';

let _parserCache = null;
async function fetchFileFromGithub(owner, repo, filePath, token) {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
  const res = await fetch(apiUrl, {
    headers: {
      Authorization: token ? `token ${token}` : undefined,
      Accept: 'application/vnd.github.v3+json'
    }
  });
  if (!res.ok) throw new Error(`GitHub file fetch failed: ${res.status}`);
  const json = await res.json();
  const content = Buffer.from(json.content, 'base64').toString('utf8');
  return content;
}

function evalCjs(code, filename) {
  const module = { exports: {} };
  const requireFn = createRequire(import.meta.url);
  const context = { module, exports: module.exports, require: requireFn, console, Buffer, process, setTimeout, clearTimeout };
  const vmCtx = createContext(context);
  const script = new Script(code, { filename });
  script.runInContext(vmCtx);
  return module.exports;
}

async function loadParsers() {
  if (_parserCache) return _parserCache;

  const bases = [
    '../parsers',
    '../KBC-rakv0-event-app/src/parsers'
  ];

  // Try local imports first (public repo or local event-app)
  for (const base of bases) {
    try {
      const modG = await import(`${base}/gatya.js`);
      const modS = await import(`${base}/sale.js`);
      const modI = await import(`${base}/item.js`);
      const parseGatya = modG.parseGatya || modG.default || modG.parseGatya;
      const parseSale   = modS.parseSale   || modS.default || modS.parseSale;
      const parseItem   = modI.parseItem   || modI.default || modI.parseItem;
      if (parseGatya && parseSale && parseItem) {
        _parserCache = { gatya: parseGatya, sale: parseSale, item: parseItem };
        console.log(`loadParsers: loaded parsers from ${base}`);
        return _parserCache;
      }
    } catch (e) {
      // try next base
    }
  }

  // Fallback: fetch from a private repo via GitHub API
  const owner = process.env.PRIVATE_REPO_OWNER;
  const repo  = process.env.PRIVATE_REPO_NAME;
  const token = process.env.GITHUB_PRIVATE_TOKEN || process.env.GH_TOKEN_EVENT;
  if (!owner || !repo || !token) {
    throw new Error('parsers not found locally and PRIVATE_REPO_OWNER/PRIVATE_REPO_NAME/GITHUB_PRIVATE_TOKEN not set');
  }

  try {
    console.log(`loadParsers: fetching parsers from private repo ${owner}/${repo}`);
    const gcode = await fetchFileFromGithub(owner, repo, 'src/parsers/gatya.js', token);
    const scode = await fetchFileFromGithub(owner, repo, 'src/parsers/sale.js', token);
    const icode = await fetchFileFromGithub(owner, repo, 'src/parsers/item.js', token);

    // Convert ESM 'export function NAME' => function NAME; then export via module.exports
    const gCjs = gcode.replace(/export\s+function\s+([A-Za-z0-9_$]+)\s*\(/g, 'function $1(') + '\nmodule.exports = { parseGatya };';
    const sCjs = scode.replace(/export\s+function\s+([A-Za-z0-9_$]+)\s*\(/g, 'function $1(') + '\nmodule.exports = { parseSale };';
    const iCjs = icode.replace(/export\s+function\s+([A-Za-z0-9_$]+)\s*\(/g, 'function $1(') + '\nmodule.exports = { parseItem };';

    const gmod = evalCjs(gCjs, 'priv_gatya.js');
    const smod = evalCjs(sCjs, 'priv_sale.js');
    const imod = evalCjs(iCjs, 'priv_item.js');

    if (gmod.parseGatya && smod.parseSale && imod.parseItem) {
      _parserCache = { gatya: gmod.parseGatya, sale: smod.parseSale, item: imod.parseItem };
      console.log('loadParsers: loaded parsers from private repo');
      return _parserCache;
    }
  } catch (e) {
    throw new Error('failed to load parsers from private repo: ' + e.message);
  }

  throw new Error('parsers not found (local or private)');
}

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
    const parsers = await loadParsers();
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
