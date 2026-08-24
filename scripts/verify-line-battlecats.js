import { normalizeLineBotUpdateUrl } from "../lib/battlecats-monitor.js";

const endpoint = normalizeLineBotUpdateUrl(process.env.LINE_BOT_UPDATE_URL);
if (!endpoint) throw new Error("LINE bot update endpoint is not configured");

const healthUrl = new URL(endpoint);
healthUrl.pathname = "/health";
healthUrl.search = "";
healthUrl.hash = "";

const healthResponse = await fetch(healthUrl, {
  headers: { Accept: "application/json" },
  signal: AbortSignal.timeout(10_000),
});
if (!healthResponse.ok) {
  throw new Error(`LINE bot health check failed with HTTP ${healthResponse.status}`);
}

// secretを付けないprobeが401なら、新しいrouteがfail closedで公開済みと確認できる。
const routeResponse = await fetch(endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
  signal: AbortSignal.timeout(10_000),
});
if (routeResponse.status !== 401) {
  throw new Error(`LINE bot update route probe returned HTTP ${routeResponse.status}`);
}

console.log("LINE Battle Cats update endpoint is ready");
