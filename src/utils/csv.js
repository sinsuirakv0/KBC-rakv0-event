export function parseCSV(text) {
  const map = new Map();
  for (const line of String(text || "").split("\n")) {
    const idx = line.indexOf(",");
    if (idx === -1) continue;
    const id = parseInt(line.slice(0, idx).trim(), 10);
    const name = line.slice(idx + 1).trim();
    if (!Number.isNaN(id) && name) map.set(id, name);
  }
  return map;
}

export function parseItemNameCsv(text) {
  const nameMap = new Map();
  const detailMap = new Map();
  for (const line of String(text || "").split("\n")) {
    const cols = line.split(",");
    if (cols.length < 2) continue;
    const id = parseInt(cols[0].trim(), 10);
    if (Number.isNaN(id)) continue;
    const name = cols[1].trim();
    const detail = cols.slice(2).join(",").trim();
    if (name) nameMap.set(id, name);
    if (detail) detailMap.set(id, detail);
  }
  return { nameMap, detailMap };
}

export function parseItemPackCsv(text) {
  const map = new Map();
  for (const line of String(text || "").split("\n")) {
    const idx = line.indexOf(",");
    if (idx === -1) continue;
    const id = parseInt(line.slice(0, idx).trim(), 10);
    const url = line.slice(idx + 1).trim();
    if (!Number.isNaN(id) && url) map.set(id, url);
  }
  return map;
}
