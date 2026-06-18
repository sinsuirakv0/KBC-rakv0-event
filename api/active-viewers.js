const ACTIVE_TTL_MS = 45_000;
const HOUR_MS = 60 * 60 * 1000;
const STATS_HOURS = 24;
const sessions = globalThis.__KBC_ACTIVE_VIEWERS__ ?? new Map();
const stats = globalThis.__KBC_ACCESS_STATS__ ?? {
  totalIds: new Set(),
  hourlyIds: new Map(),
};
globalThis.__KBC_ACTIVE_VIEWERS__ = sessions;
globalThis.__KBC_ACCESS_STATS__ = stats;

function cleanup(now = Date.now()) {
  for (const [id, session] of sessions) {
    if (!session?.lastSeen || now - session.lastSeen > ACTIVE_TTL_MS) {
      sessions.delete(id);
    }
  }
  cleanupStats(now);
}

function getHourStart(now = Date.now()) {
  return Math.floor(now / HOUR_MS) * HOUR_MS;
}

function cleanupStats(now = Date.now()) {
  const oldestHour = getHourStart(now) - (STATS_HOURS - 1) * HOUR_MS;
  for (const hourStart of stats.hourlyIds.keys()) {
    if (Number(hourStart) < oldestHour) {
      stats.hourlyIds.delete(hourStart);
    }
  }
}

function recordAccess(id, now = Date.now()) {
  stats.totalIds.add(id);
  const hourStart = getHourStart(now);
  if (!stats.hourlyIds.has(hourStart)) {
    stats.hourlyIds.set(hourStart, new Set());
  }
  stats.hourlyIds.get(hourStart).add(id);
}

function buildHourlyStats(now = Date.now()) {
  const currentHour = getHourStart(now);
  const hours = [];
  const visitors = new Set();
  for (let i = STATS_HOURS - 1; i >= 0; i -= 1) {
    const hourStart = currentHour - i * HOUR_MS;
    const ids = stats.hourlyIds.get(hourStart) || new Set();
    for (const id of ids) visitors.add(id);
    const date = new Date(hourStart);
    hours.push({
      hourStart: date.toISOString(),
      label: date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false }),
      count: ids.size,
    });
  }
  return { hours, visitors24h: visitors.size };
}

function buildPayload(now = Date.now()) {
  cleanup(now);
  const hourly = buildHourlyStats(now);
  return {
    ok: true,
    count: sessions.size,
    activeCount: sessions.size,
    visitors24h: hourly.visitors24h,
    totalVisitors: stats.totalIds.size,
    hourly24h: hourly.hours,
    ttlMs: ACTIVE_TTL_MS,
    updatedAt: new Date(now).toISOString(),
  };
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function normalizeId(value) {
  const id = String(value || '').trim();
  return /^[A-Za-z0-9_-]{16,80}$/.test(id) ? id : '';
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const now = Date.now();
  cleanup(now);

  if (req.method === 'GET') {
    sendJson(res, 200, buildPayload(now));
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }

  const body = await readBody(req);
  const id = normalizeId(body.id);
  if (!id) {
    sendJson(res, 400, { ok: false, error: 'invalid session id' });
    return;
  }

  if (body.leave === true) {
    sessions.delete(id);
  } else {
    recordAccess(id, now);
    sessions.set(id, {
      lastSeen: now,
      path: String(body.path || '').slice(0, 160),
    });
  }

  sendJson(res, 200, buildPayload(now));
}
