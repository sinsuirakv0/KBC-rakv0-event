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
    let request;
    globalThis.fetch = async (url, options) => {
      request = { url, options };
      return { status: 204 };
    };
    try {
      const res = responseHarness();
      await handler({ method: "POST", headers: { authorization: `Bearer ${SECRET}` } }, res);
      assert.equal(res.statusCode, 200);
      assert.match(request.url, /KBC-rakv0-event\/actions\/workflows\/monitor-battlecats-google-play\.yml\/dispatches$/);
      assert.deepEqual(JSON.parse(request.options.body), { ref: "main", inputs: {} });
      assert.equal(request.options.headers.Authorization, "Bearer github-token");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("GitHub error本文をclient responseへ出さない", async () => {
  await withEnvironment({ BATTLECATS_MONITOR_TRIGGER_SECRET: SECRET, GH_TOKEN_EVENT: "github-token" }, async () => {
    const originalFetch = globalThis.fetch;
    const originalConsoleError = console.error;
    globalThis.fetch = async () => ({ status: 500 });
    console.error = () => {};
    try {
      const res = responseHarness();
      await handler({ method: "POST", headers: { authorization: `Bearer ${SECRET}` } }, res);
      assert.equal(res.statusCode, 502);
      assert.deepEqual(res.body, { error: "GitHub dispatch failed" });
      assert.doesNotMatch(JSON.stringify(res.body), /github-token|private/i);
    } finally {
      globalThis.fetch = originalFetch;
      console.error = originalConsoleError;
    }
  });
});
