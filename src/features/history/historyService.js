import { fetchJson } from "../../services/apiClient.js";
import { APP_CONSTANTS } from "../../config/constants.js";

export async function fetchHistoryGroups() {
  const files = await fetchJson(APP_CONSTANTS.GITHUB_RAW_API);
  const parsed = [];
  for (const f of files) {
    const m = f.name.match(/^(gatya|sale|item)_(\d+)\.tsv$/);
    if (!m) continue;
    parsed.push({ name: f.name, type: m[1], unix: Number(m[2]) });
  }
  const byType = { gatya: [], sale: [], item: [] };
  for (const f of parsed) byType[f.type].push(f);
  for (const t of ["gatya", "sale", "item"]) byType[t].sort((a, b) => a.unix - b.unix);
  parsed.sort((a, b) => b.unix - a.unix);
  const groups = [];
  let group = null;
  for (const f of parsed) {
    if (!group || group.unix - f.unix > APP_CONSTANTS.HISTORY_GROUP_SEC) {
      group = { unix: f.unix, files: [] };
      groups.push(group);
    }
    group.files.push(f);
  }
  return { byType, groups };
}
