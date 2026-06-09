const GITHUB_OWNER = "sinsuirakv0";
const GITHUB_REPO = "KBC-rakv0-event";
const GITHUB_BRANCH = "main";
const GITHUB_TOKEN = process.env.GH_TOKEN_EVENT;

const apiBase = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents`;
const RETRY_DELAYS_MS = [500, 1500, 3500];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function githubHeaders(extra = {}) {
  return {
    ...(GITHUB_TOKEN ? { Authorization: `token ${GITHUB_TOKEN}` } : {}),
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...extra,
  };
}

/**
 * GitHubからファイルを取得する。
 * 404だけを「ファイルなし」として扱い、一時的なAPI障害は再試行後に例外にする。
 */
export async function getGitHubFile(path) {
  const url = `${apiBase}/${path}?ref=${encodeURIComponent(GITHUB_BRANCH)}`;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: githubHeaders() });
    } catch (error) {
      if (attempt < RETRY_DELAYS_MS.length) {
        console.warn(`GitHub fetch retry [${path}] attempt ${attempt + 1}: ${error.message}`);
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw new Error(`GitHub fetch failed [${path}]: ${error.message}`);
    }

    if (res.ok) {
      const json = await res.json();
      const content = Buffer.from(json.content, "base64").toString("utf-8");
      return { content, sha: json.sha };
    }
    if (res.status === 404) return null;

    const error = await res.text();
    if (attempt < RETRY_DELAYS_MS.length) {
      console.warn(`GitHub fetch retry [${path}] HTTP ${res.status} attempt ${attempt + 1}: ${error}`);
      await sleep(RETRY_DELAYS_MS[attempt]);
      continue;
    }
    throw new Error(`GitHub fetch failed [${path}] HTTP ${res.status}: ${error}`);
  }
}

/**
 * GitHubにファイルを作成または上書き保存する。
 */
export async function updateGitHubFile({ path, content, message }) {
  const url = `${apiBase}/${path}`;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const existing = await getGitHubFile(path);
    const payload = {
      message,
      content: Buffer.from(content).toString("base64"),
      branch: GITHUB_BRANCH,
      ...(existing?.sha ? { sha: existing.sha } : {}),
    };

    const updateRes = await fetch(url, {
      method: "PUT",
      headers: githubHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (updateRes.ok) return;

    const error = await updateRes.text();
    if ((updateRes.status === 409 || updateRes.status === 422) && attempt < RETRY_DELAYS_MS.length) {
      console.warn(`GitHub push retry [${path}] attempt ${attempt + 1}: ${error}`);
      await sleep(RETRY_DELAYS_MS[attempt]);
      continue;
    }
    throw new Error(`GitHub push failed [${path}]: ${error}`);
  }
}

/**
 * GitHub上のファイルを削除する。
 */
export async function deleteGitHubFile({ path, message }) {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const file = await getGitHubFile(path);
    if (!file?.sha) throw new Error(`File not found: ${path}`);

    const res = await fetch(`${apiBase}/${path}`, {
      method: "DELETE",
      headers: githubHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ message, sha: file.sha, branch: GITHUB_BRANCH }),
    });
    if (res.ok) return;

    const error = await res.text();
    if ((res.status === 409 || res.status === 422) && attempt < RETRY_DELAYS_MS.length) {
      console.warn(`GitHub delete retry [${path}] attempt ${attempt + 1}: ${error}`);
      await sleep(RETRY_DELAYS_MS[attempt]);
      continue;
    }
    throw new Error(`GitHub delete failed [${path}]: ${error}`);
  }
}
