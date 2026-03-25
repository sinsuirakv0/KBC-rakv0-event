const GITHUB_OWNER  = "sinsuirakv0";
const GITHUB_REPO   = "KBC-rakv0-event";
const GITHUB_BRANCH = "main";
const GITHUB_TOKEN  = process.env.GH_TOKEN_EVENT;

const apiBase = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents`;

/**
 * GitHub からファイルを取得する
 * @returns {{ content: string, sha: string } | null}
 */
export async function getGitHubFile(path) {
  const res = await fetch(`${apiBase}/${path}`, {
    headers: { Authorization: `token ${GITHUB_TOKEN}` }
  });
  if (!res.ok) return null;

  const json    = await res.json();
  const content = Buffer.from(json.content, "base64").toString("utf-8");
  return { content, sha: json.sha };
}

/**
 * GitHub にファイルを作成または上書き保存する
 */
export async function updateGitHubFile({ path, content, message }) {
  const url = `${apiBase}/${path}`;

  // 既存ファイルの SHA を取得（なければ新規作成）
  let sha;
  const res = await fetch(url, {
    headers: { Authorization: `token ${GITHUB_TOKEN}` }
  });
  if (res.ok) {
    const json = await res.json();
    sha = json.sha;
  }

  const payload = {
    message,
    content: Buffer.from(content).toString("base64"),
    branch:  GITHUB_BRANCH,
    ...(sha ? { sha } : {})
  };

  const updateRes = await fetch(url, {
    method:  "PUT",
    headers: {
      Authorization:  `token ${GITHUB_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!updateRes.ok) {
    const error = await updateRes.text();
    throw new Error(`GitHub push failed [${path}]: ${error}`);
  }
}

/**
 * GitHub からファイルを削除する
 */
export async function deleteGitHubFile({ path, message }) {
  const file = await getGitHubFile(path);
  if (!file?.sha) throw new Error(`File not found: ${path}`);

  const res = await fetch(`${apiBase}/${path}`, {
    method:  "DELETE",
    headers: {
      Authorization:  `token ${GITHUB_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ message, sha: file.sha, branch: GITHUB_BRANCH })
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`GitHub delete failed [${path}]: ${error}`);
  }
}
