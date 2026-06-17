const ACTIVE_TTL_MS = 45_000;
const sessions = globalThis.__KBC_ACTIVE_VIEWERS__ ?? new Map();
globalThis.__KBC_ACTIVE_VIEWERS__ = sessions;

function cleanup(now = Date.now()) {
  for (const [id, session] of sessions) {
    if (!session?.lastSeen || now - session.lastSeen > ACTIVE_TTL_MS) {
      sessions.delete(id);
    }
  }
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
    sendJson(res, 200, {
      ok: true,
      count: sessions.size,
      ttlMs: ACTIVE_TTL_MS,
      updatedAt: new Date(now).toISOString(),
    });
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
    sessions.set(id, {
      lastSeen: now,
      path: String(body.path || '').slice(0, 160),
    });
  }

  cleanup(now);
  sendJson(res, 200, {
    ok: true,
    count: sessions.size,
    ttlMs: ACTIVE_TTL_MS,
    updatedAt: new Date(now).toISOString(),
  });
}
