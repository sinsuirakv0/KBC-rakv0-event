import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { getGitHubFile } from "../lib/github.js";

const BASE_URL = "https://nyanko-events.ponosgames.com/battlecats_production";

function hashText(text) {
  return crypto.createHash("md5").update(text).digest("hex");
}

export async function fetchTsv(name, jwt) {
  console.log(`[${name}] fetching TSV...`);
  const res = await fetch(`${BASE_URL}/${name}.tsv?jwt=${jwt}`);
  if (!res.ok) {
    throw new Error(`TSV fetch failed: HTTP ${res.status}`);
  }

  const text = await res.text();
  return { text, hash: hashText(text) };
}

async function readRemoteHash(name) {
  const prevFile = await getGitHubFile(`hashes/${name}.md5`);
  if (!prevFile) {
    throw new Error(`previous hash file not found: hashes/${name}.md5`);
  }
  return prevFile.content.trim();
}

export async function readPreviousHash(name, { preferRemote = false } = {}) {
  if (preferRemote) {
    return await readRemoteHash(name);
  }

  const localPath = path.join(process.cwd(), "hashes", `${name}.md5`);

  try {
    const content = await fs.readFile(localPath, "utf8");
    const hash = content.trim();
    if (hash) return hash;
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.warn(`[${name}] local hash ignored: ${err.message}`);
    }
  }

  return await readRemoteHash(name);
}

export async function fetchAndCheck(name, jwt, previousHash = null) {
  try {
    const { text, hash } = await fetchTsv(name, jwt);
    const prevHash = previousHash ?? await readPreviousHash(name);
    const changed = hash !== prevHash;

    console.log(`[${name}] hash current=${hash} previous=${prevHash}`);
    console.log(`[${name}] ${changed ? "changed" : "unchanged"}`);
    return { changed, text, hash, previousHash: prevHash, error: null };
  } catch (err) {
    console.error(`[${name}] fetchAndCheck error:`, err.message);
    return { changed: false, text: null, hash: null, previousHash: previousHash, error: err.message };
  }
}
