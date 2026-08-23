import assert from "node:assert/strict";
import test from "node:test";
import handler from "../api/trigger-battlecats-monitor.js";

const SECRET = "monitor-trigger-secret-with-more-than-32-characters";

function responseHarness() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function withEnvironment(values, callback) {
  const original = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("POST以外を拒否する", async () => {
  const res = responseHarness();
  await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "POST");
});

test("Bearer secret不一致を拒否する", async () => {
  await withEnvironment({ BATTLECATS_MONITOR_TRIGGER_SECRET: SECRET, GH_TOKEN_EVENT: "github-token" }, async () => {
    const res = responseHarness();
    await handler({ method: "POST", headers: { authorization: "Bearer wrong" } }, res);
    assert.equal(res.statusCode, 401);
  });
});

test("認証後はpublic monitor workflowだけをdispatchする", async () => {
  await withEnvironment({ BATTLECATS_MONITOR_TRIGGER_SECRET: SECRET, GH_TOKEN_EVENT: "github-token" }, async () => {
    const originalFetch = globalThis.fetch;
    const requests = [];
    globalThis.fetch = async (url, options) => {
      const request = { url: String(url), options };
      requests.push(request);
      if (request.url.includes("/runs?")) {
        return { ok: true, status: 200, json: async () => ({ workflow_runs: [] }) };
      }
      return { status: 204 };
    };
    try {
      const res = responseHarness();
      await handler({ method: "POST", headers: { authorization: `Bearer ${SECRET}` } }, res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, { status: "dispatched" });
      assert.equal(requests.length, 2);
      assert.match(requests[0].url, /KBC-rakv0-event\/actions\/workflows\/monitor-battlecats-google-play\.yml\/runs\?/);
      assert.match(requests[1].url, /KBC-rakv0-event\/actions\/workflows\/monitor-battlecats-google-play\.yml\/dispatches$/);
      assert.deepEqual(JSON.parse(requests[1].options.body), { ref: "main", inputs: {} });
      assert.equal(requests[0].options.headers.Authorization, "Bearer github-token");
      assert.equal(requests[1].options.headers.Authorization, "Bearer github-token");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("Rapid Monitor runがactiveならHTTP 200 already-activeでdispatchしない", async () => {
  await withEnvironment({ BATTLECATS_MONITOR_TRIGGER_SECRET: SECRET, GH_TOKEN_EVENT: "github-token" }, async () => {
    const originalFetch = globalThis.fetch;
    const requests = [];
    globalThis.fetch = async (url, options) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ workflow_runs: [{ status: "in_progress" }] }),
      };
    };
    try {
      const res = responseHarness();
      await handler({ method: "POST", headers: { authorization: `Bearer ${SECRET}` } }, res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, { status: "already-active" });
      assert.equal(requests.length, 1);
      assert.match(requests[0].url, /monitor-battlecats-google-play\.yml\/runs\?/);
      assert.doesNotMatch(requests[0].url, /dispatches/);
      assert.equal(requests[0].options.headers.Authorization, "Bearer github-token");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("active run照会失敗はdispatchせず秘密やpathを応答・ログへ出さない", async () => {
  await withEnvironment({ BATTLECATS_MONITOR_TRIGGER_SECRET: SECRET, GH_TOKEN_EVENT: "github-token" }, async () => {
    const originalFetch = globalThis.fetch;
    const originalConsoleError = console.error;
    const requests = [];
    const logs = [];
    globalThis.fetch = async (url) => {
      requests.push(String(url));
      return { status: 500 };
    };
    console.error = (message) => logs.push(String(message));
    try {
      const res = responseHarness();
      await handler({ method: "POST", headers: { authorization: `Bearer ${SECRET}` } }, res);
      assert.equal(res.statusCode, 502);
      assert.deepEqual(res.body, { error: "GitHub dispatch failed" });
      assert.equal(requests.length, 1);
      assert.match(requests[0], /monitor-battlecats-google-play\.yml\/runs\?/);
      assert.doesNotMatch(requests[0], /dispatches/);
      assert.doesNotMatch(`${JSON.stringify(res.body)} ${logs.join(" ")}`, /github-token|KBC-rakv0-event|monitor-battlecats-google-play\.yml/i);
    } finally {
      globalThis.fetch = originalFetch;
      console.error = originalConsoleError;
    }
  });
});
