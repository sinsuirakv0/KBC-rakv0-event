import { randomUUID } from "node:crypto";
import { getGitHubFile } from "./github.js";

const API = "https://api.github.com/repos/sinsuirakv0/KBC-rakv0-event";
const STATE_PATH = "state/skd-notifications.json";
const TYPES = ["gatya", "sale", "item"];
const headers = () => ({ Authorization: `Bearer ${process.env.GH_TOKEN_EVENT}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" });

async function currentRevision() {
  const response = await fetch(`${API}/git/ref/heads/main`, { headers: headers(), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Schedule revision unavailable: HTTP ${response.status}`);
  return (await response.json()).object.sha;
}

function parseState(content) {
  const value = content ? JSON.parse(content) : { version: 1, lastHashes: {} };
  if (value.version !== 1 || !value.lastHashes || typeof value.lastHashes !== "object"
    || value.pending && (!value.pending.eventId || !value.pending.beforeRef || !value.pending.hashes || !value.pending.files)) {
    throw new Error("Invalid schedule notification state");
  }
  return value;
}

function createRepository() {
  let queue = Promise.resolve();
  return {
    async read() { return parseState((await getGitHubFile(STATE_PATH))?.content); },
    update(change) {
      const task = queue.then(async () => {
        for (let attempt = 0; attempt < 4; attempt++) {
          const file = await getGitHubFile(STATE_PATH);
          const state = parseState(file?.content);
          const next = change(state);
          const content = JSON.stringify(next);
          if (content === file?.content) return next;
          const response = await fetch(`${API}/contents/${STATE_PATH}`, {
            method: "PUT", headers: headers(), signal: AbortSignal.timeout(15000),
            body: JSON.stringify({ message: "Update skd notification outbox", branch: "main", content: Buffer.from(content).toString("base64"), ...(file ? { sha: file.sha } : {}) }),
          });
          if (response.ok) return next;
          if (![409, 422].includes(response.status)) throw new Error(`Schedule state save failed: HTTP ${response.status}`);
        }
        throw new Error("Schedule state conflict");
      });
      queue = task.catch(() => {});
      return task;
    },
  };
}

export async function sendSkdEvent(payload) {
  if (!process.env.BOT_EVENT_UPDATE_URL) return;
  if (!process.env.BOT_EVENT_UPDATE_SECRET) throw new Error("BOT_EVENT_UPDATE_SECRET is required");
  const url = new URL(process.env.BOT_EVENT_UPDATE_URL);
  if (url.pathname === "/") url.pathname = "/event-update";
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        method: "POST", signal: AbortSignal.timeout(payload.phase === "ready" ? 120000 : 30000),
        headers: { "Content-Type": "application/json", "x-event-update-secret": process.env.BOT_EVENT_UPDATE_SECRET },
        body: JSON.stringify(payload),
      });
      await response.arrayBuffer();
    } catch { /* 同じ通知IDで再試行する。 */ }
    if (response?.ok) return;
    if (response && response.status < 500 && response.status !== 429) {
      const error = new Error(`Schedule event rejected: HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  throw new Error("Schedule event delivery unavailable");
}

export function createSkdNotifier({
  repository = createRepository(), send = sendSkdEvent, revision = currentRevision,
  now = () => new Date().toISOString(), createId = () => `skd:${randomUUID()}`,
  enabled = Boolean(process.env.BOT_EVENT_UPDATE_URL),
} = {}) {
  const payload = pending => ({ version: 1, eventId: pending.eventId, category: "skd", detectedAt: pending.detectedAt,
    types: TYPES.filter(type => type in pending.hashes) });
  return {
    async pending() { return enabled ? (await repository.read()).pending : undefined; },
    async detect(change) {
      if (!enabled) return true;
      const beforeRef = await revision();
      const state = await repository.update(state => {
        if (state.lastHashes[change.name] === change.hash && !(change.name in (state.pending?.hashes ?? {}))) return state;
        state.pending ??= { eventId: createId(), detectedAt: now(), beforeRef, hashes: {}, files: {} };
        if (state.pending.afterRef && state.pending.hashes[change.name] !== change.hash) throw new Error("Previous schedule batch still pending");
        if (state.pending.hashes[change.name] !== change.hash) delete state.pending.files[change.name];
        state.pending.hashes[change.name] = change.hash;
        return state;
      });
      if (!state.pending || state.pending.hashes[change.name] !== change.hash) return false;
      try { await send({ ...payload(state.pending), phase: "types" }); }
      catch (error) { if (error.status !== 409) throw error; }
      return true;
    },
    async saved(change) {
      if (!enabled) return;
      await repository.update(state => {
        if (state.pending?.hashes[change.name] === change.hash) state.pending.files[change.name] = { path: change.rawFilename, hash: change.hash };
        return state;
      });
    },
    async finish() {
      if (!enabled) return;
      const pending = (await repository.read()).pending;
      if (!pending || Object.keys(pending.hashes).some(type => pending.files[type]?.hash !== pending.hashes[type])) return;
      const afterRef = pending.afterRef || await revision();
      const state = await repository.update(state => {
        if (state.pending?.eventId === pending.eventId && JSON.stringify(state.pending.hashes) === JSON.stringify(pending.hashes)) state.pending.afterRef ??= afterRef;
        return state;
      });
      const ready = state.pending;
      if (!ready?.afterRef) return;
      let held = false;
      try { await send({ ...payload(ready), phase: "ready", source: { beforeRef: ready.beforeRef, afterRef: ready.afterRef, files: ready.files } }); }
      catch (error) {
        if (error.status !== 409) throw error;
        held = true;
        console.warn(`Schedule notification requires reconciliation: ${ready.eventId}`);
      }
      await repository.update(state => {
        if (state.pending?.eventId === ready.eventId && state.pending.afterRef === ready.afterRef) {
          if (held) { state.held ??= {}; state.held[ready.eventId] = ready; }
          Object.assign(state.lastHashes, ready.hashes);
          delete state.pending;
        }
        return state;
      });
    },
  };
}
