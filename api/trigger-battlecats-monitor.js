import {
  activeWorkflowRuns,
  dispatchGitHubWorkflow,
  listWorkflowRuns,
  verifyBearerAuthorization,
} from "../lib/battlecats-monitor.js";

const GITHUB_OWNER = "sinsuirakv0";
const GITHUB_REPO = "KBC-rakv0-event";
const WORKFLOW_FILE = "monitor-battlecats-google-play.yml";

function authorizationHeader(req) {
  const value = req.headers?.authorization;
  return Array.isArray(value) ? value[0] : value;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader?.("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const triggerSecret = process.env.BATTLECATS_MONITOR_TRIGGER_SECRET;
  if (typeof triggerSecret !== "string" || triggerSecret.length < 32) {
    console.error("battlecats monitor trigger is not securely configured");
    return res.status(500).json({ error: "Monitor trigger is unavailable" });
  }
  if (!verifyBearerAuthorization(authorizationHeader(req), triggerSecret)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const githubToken = process.env.GH_TOKEN_EVENT;
  if (!githubToken) {
    console.error("battlecats monitor GitHub dispatch token is not configured");
    return res.status(500).json({ error: "Monitor trigger is unavailable" });
  }

  try {
    const runs = await listWorkflowRuns({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      workflow: WORKFLOW_FILE,
      token: githubToken,
    });
    if (activeWorkflowRuns(runs).length > 0) {
      return res.status(200).json({ status: "already-active" });
    }
    await dispatchGitHubWorkflow({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      workflow: WORKFLOW_FILE,
      inputs: {},
      token: githubToken,
    });
    return res.status(200).json({ status: "dispatched" });
  } catch (error) {
    const statusMatch = error.message.match(/HTTP (\d+)/);
    console.error(`battlecats monitor dispatch failed${statusMatch ? ` (HTTP ${statusMatch[1]})` : ""}`);
    return res.status(502).json({ error: "GitHub dispatch failed" });
  }
}
