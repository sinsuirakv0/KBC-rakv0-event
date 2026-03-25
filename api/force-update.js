const GITHUB_OWNER  = "sinsuirakv0";
const GITHUB_REPO   = "KBC-rakv0-event";
const WORKFLOW_FILE = "check-events.yml";
const GITHUB_BRANCH = "main";
const GITHUB_TOKEN  = process.env.GH_TOKEN_EVENT;

const VALID_TYPES = ["gatya", "sale", "item"];

export default async function handler(req, res) {
  // ?force=12 でのみ有効
  if (req.query.force !== "12") {
    return res.status(403).json({ error: "Forbidden" });
  }

  // ?types=gatya,sale のように対象ファイルを絞れる（省略時は全部）
  const typesParam = req.query.types ?? "";
  const targets    = typesParam
    ? typesParam.split(",").map(t => t.trim()).filter(t => VALID_TYPES.includes(t))
    : [];

  // workflow_dispatch の inputs.force に渡す文字列
  // 全部の場合は空文字（run.js 側で全部と解釈される）
  const forceInput = targets.length > 0 ? targets.join(" ") : "";

  try {
    const res2 = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      {
        method:  "POST",
        headers: {
          Authorization:  `token ${GITHUB_TOKEN}`,
          "Content-Type": "application/json",
          Accept:         "application/vnd.github+json",
        },
        body: JSON.stringify({
          ref:    GITHUB_BRANCH,
          inputs: { force: forceInput },
        }),
      }
    );

    if (!res2.ok) {
      const error = await res2.text();
      throw new Error(`GitHub API error: ${error}`);
    }

    // GitHub API は成功時 204 No Content を返す
    return res.status(200).json({
      status:  "dispatched",
      targets: targets.length > 0 ? targets : VALID_TYPES,
    });

  } catch (err) {
    console.error("force-update error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
