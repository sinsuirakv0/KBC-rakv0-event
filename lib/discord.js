const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const BOT_EVENT_UPDATE_URL = process.env.BOT_EVENT_UPDATE_URL;
const BOT_EVENT_UPDATE_SECRET = process.env.BOT_EVENT_UPDATE_SECRET;
const EVENT_SITE_URL = process.env.EVENT_SITE_URL || 'https://kbc-rakv0-event.vercel.app/';

function runUrl() {
  const server = process.env.GITHUB_SERVER_URL;
  const repo = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  if (!server || !repo || !runId) return null;
  return `${server}/${repo}/actions/runs/${runId}`;
}

export async function notifyDiscord({ type, status, force = false, hash = null, error = null }) {
  if (!DISCORD_WEBHOOK_URL) return;

  const titleByStatus = {
    detected: 'イベント更新を検知',
    updated:  'イベント更新を保存',
    failed:   'イベント更新に失敗',
  };
  const colorByStatus = {
    detected: 0xff9900,
    updated:  0x2ecc71,
    failed:   0xe74c3c,
  };
  const url = runUrl();
  const fields = [
    { name: 'type', value: type, inline: true },
    { name: 'mode', value: force ? 'force' : 'normal', inline: true },
  ];
  if (hash) fields.push({ name: 'md5', value: hash, inline: false });
  if (error) fields.push({ name: 'error', value: String(error).slice(0, 1000), inline: false });

  const payload = {
    embeds: [{
      title: titleByStatus[status] ?? 'イベント更新通知',
      description: url ? `[GitHub Actions run](${url})` : undefined,
      color: colorByStatus[status] ?? 0x5865f2,
      fields,
      timestamp: new Date().toISOString(),
    }],
  };

  try {
    const res = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.warn(`Discord webhook failed: HTTP ${res.status}`);
    }
  } catch (e) {
    console.warn('Discord webhook error:', e.message);
  }
}

function buildHistoryUrl(historyUnix) {
  if (!historyUnix) return null;
  const url = new URL(EVENT_SITE_URL);
  url.searchParams.set('tab', 'history');
  url.searchParams.set('tsv', String(historyUnix));
  url.searchParams.set('type', 'all');
  return url.toString();
}

export async function notifyEventBot({ types, detectedAt, historyUnix, force = false, phase = 'updated', hashes = null, source = 'github-actions' }) {
  if (!BOT_EVENT_UPDATE_URL) return;
  const cleanTypes = [...new Set((types ?? []).filter(Boolean))];
  if (cleanTypes.length === 0) return;

  const payload = {
    types: cleanTypes,
    detectedAt,
    historyUrl: buildHistoryUrl(historyUnix),
    runUrl: runUrl(),
    force,
    phase,
    hashes,
    source,
  };

  try {
    const res = await fetch(BOT_EVENT_UPDATE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(BOT_EVENT_UPDATE_SECRET ? { 'x-event-update-secret': BOT_EVENT_UPDATE_SECRET } : {}),
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.warn(`Event bot notification failed: HTTP ${res.status}`);
    }
  } catch (e) {
    console.warn('Event bot notification error:', e.message);
  }
}
