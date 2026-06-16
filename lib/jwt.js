import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const JWT_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const JWT_EXPIRY_SAFETY_MS = 5 * 60 * 1000;

async function getInquiryCode() {
  const res  = await fetch("https://nyanko-backups.ponosgames.com/?action=createAccount&referenceId=");
  const json = await res.json();
  return json.accountId;
}

function generateSignature(inquiryCode, dataString) {
  const randomData = crypto.randomBytes(32).toString("hex");
  const key        = inquiryCode + randomData;
  const hmac       = crypto.createHmac("sha256", key);
  hmac.update(dataString);
  return randomData + hmac.digest("hex");
}

async function getPassword(inquiryCode) {
  const data = {
    accountCode:      inquiryCode,
    accountCreatedAt: Math.floor(Date.now() / 1000).toString(),
    nonce:            crypto.randomBytes(16).toString("hex"),
  };
  const dataString = JSON.stringify(data);

  const res  = await fetch("https://nyanko-auth.ponosgames.com/v1/users", {
    method:  "POST",
    headers: {
      "content-type":               "application/json",
      "nyanko-signature":           generateSignature(inquiryCode, dataString),
      "nyanko-timestamp":           Math.floor(Date.now() / 1000).toString(),
      "nyanko-signature-version":   "1",
      "nyanko-signature-algorithm": "HMACSHA256",
      "user-agent":                 "Dalvik/2.1.0 (Linux; Android 9; SM-G955F Build/N2G48B)",
    },
    body: dataString,
  });

  const json = await res.json();
  return json.payload.password;
}

async function getToken(inquiryCode, password) {
  const data = {
    clientInfo: {
      client: { countryCode: "ja", version: "999999" },
      device: { model: "ONEPLUS A3010" },
      os:     { type: "android", version: "7.1.1" },
    },
    password,
    accountCode: inquiryCode,
    nonce:       crypto.randomBytes(16).toString("hex"),
  };
  const dataString = JSON.stringify(data);

  const res  = await fetch("https://nyanko-auth.ponosgames.com/v1/tokens", {
    method:  "POST",
    headers: {
      "content-type":               "application/json",
      "nyanko-signature":           generateSignature(inquiryCode, dataString),
      "nyanko-timestamp":           Math.floor(Date.now() / 1000).toString(),
      "nyanko-signature-version":   "1",
      "nyanko-signature-algorithm": "HMACSHA256",
      "user-agent":                 "Dalvik/2.1.0 (Linux; Android 9; SM-G955F Build/N2G48B)",
    },
    body: dataString,
  });

  const json = await res.json();
  return json.payload.token;
}

export async function getJWT() {
  const inquiry  = await getInquiryCode();
  const password = await getPassword(inquiry);
  return await getToken(inquiry, password);
}

function parseJwtExpiryMs(jwt) {
  try {
    const payload = jwt.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
    return Number.isFinite(json.exp) ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function readCachedJWT(cacheFile) {
  try {
    const raw = (await fs.readFile(cacheFile, "utf8")).replace(/^\uFEFF/, "");
    const cache = JSON.parse(raw);
    if (!cache.jwt || !cache.createdAt) return null;

    const createdAtMs = Date.parse(cache.createdAt);
    if (!Number.isFinite(createdAtMs)) return null;

    const now = Date.now();
    const ageMs = now - createdAtMs;
    if (ageMs < 0 || ageMs >= JWT_CACHE_TTL_MS) return null;

    const expiresAtMs = Date.parse(cache.expiresAt || "") || parseJwtExpiryMs(cache.jwt);
    if (expiresAtMs && expiresAtMs - now <= JWT_EXPIRY_SAFETY_MS) return null;

    return { jwt: cache.jwt, createdAt: cache.createdAt, expiresAt: cache.expiresAt || null };
  } catch (err) {
    if (err.code === "ENOENT") return null;
    console.warn(`JWT cache ignored: ${err.message}`);
    return null;
  }
}

async function writeCachedJWT(cacheFile, jwt) {
  const expiresAtMs = parseJwtExpiryMs(jwt);
  const cache = {
    jwt,
    createdAt: new Date().toISOString(),
    ...(expiresAtMs ? { expiresAt: new Date(expiresAtMs).toISOString() } : {}),
  };

  await fs.mkdir(path.dirname(cacheFile), { recursive: true });
  await fs.writeFile(cacheFile, JSON.stringify(cache, null, 2), "utf8");
  return cache;
}

export async function getJWTWithCache(cacheFile = process.env.PONOS_JWT_CACHE_FILE) {
  if (!cacheFile) {
    return { jwt: await getJWT(), cacheHit: false };
  }

  const cached = await readCachedJWT(cacheFile);
  if (cached) {
    return { jwt: cached.jwt, cacheHit: true, createdAt: cached.createdAt, expiresAt: cached.expiresAt };
  }

  const jwt = await getJWT();
  const saved = await writeCachedJWT(cacheFile, jwt);
  return { jwt, cacheHit: false, createdAt: saved.createdAt, expiresAt: saved.expiresAt || null };
}
