import { APP_CONSTANTS } from "./config/constants.js";
import { fetchHistoryGroups } from "./features/history/historyService.js";
import { matchesSearch } from "./utils/search.js";

function normalizePayload(json) {
  if (Array.isArray(json)) return json;
  return json?.data ?? [];
}

function eventLabel(type, entry) {
  const h = entry?.header ?? {};
  return `[${type}] ${h.startDate || "?"} ${h.startTime || ""} - ${h.endDate || "?"} ${h.endTime || ""}`;
}

function renderList(targetId, type, items) {
  const target = document.getElementById(targetId);
  if (!target) return;
  if (!items.length) {
    target.innerHTML = `<div class="empty">No ${type} data</div>`;
    return;
  }
  target.innerHTML = items
    .slice(0, 200)
    .map((entry) => `<div class="event-card"><div class="card-body"><div class="card-name">${eventLabel(type, entry)}</div></div></div>`)
    .join("");
}

function formatUnix(unix) {
  const d = new Date(unix * 1000);
  return d.toLocaleString("ja-JP");
}

function renderHistory(targetId, groups) {
  const target = document.getElementById(targetId);
  if (!target) return;
  if (!groups.length) {
    target.innerHTML = `<div class="empty">No history data</div>`;
    return;
  }
  target.innerHTML = groups
    .slice(0, 100)
    .map((g) => {
      const types = g.files.map((f) => f.type).join(", ");
      return `<div class="event-card"><div class="card-body"><div class="card-name">[history] ${formatUnix(g.unix)}</div><div class="card-period">${types}</div></div></div>`;
    })
    .join("");
}

function setupTabs() {
  const tabs = document.querySelectorAll(".shell-tab");
  const panes = document.querySelectorAll(".shell-pane");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const key = tab.dataset.tab;
      tabs.forEach((t) => t.classList.toggle("active", t === tab));
      panes.forEach((p) => p.classList.toggle("active", p.id === `shell-${key}`));
    });
  });
}

export async function bootShellApp() {
  setupTabs();
  const status = document.getElementById("shell-status");
  const searchInput = document.getElementById("shell-search");
  try {
    status.textContent = "Loading JSON data...";
    const [g, s, i, hist] = await Promise.all([
      fetch(`${APP_CONSTANTS.DATA_BASE}/gatya.json`).then((r) => r.json()),
      fetch(`${APP_CONSTANTS.DATA_BASE}/sale.json`).then((r) => r.json()),
      fetch(`${APP_CONSTANTS.DATA_BASE}/item.json`).then((r) => r.json()),
      fetchHistoryGroups(),
    ]);
    const gatya = normalizePayload(g);
    const sale = normalizePayload(s);
    const item = normalizePayload(i);
    const history = hist.groups;

    const draw = (query = "") => {
      const pick = (type, arr) =>
        arr.filter((entry) => {
          if (!query) return true;
          const h = entry?.header ?? {};
          const label = `${h.startDate || ""} ${h.endDate || ""}`;
          return matchesSearch(type, label, query);
        });
      renderList("shell-gatya-list", "gatya", pick("gatya", gatya));
      renderList("shell-sale-list", "sale", pick("sale", sale));
      renderList("shell-item-list", "item", pick("item", item));
      renderHistory("shell-history-list", history);
    };
    draw("");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        draw(searchInput.value.trim());
      });
    }
    status.textContent = `Loaded: gatya=${gatya.length}, sale=${sale.length}, item=${item.length}, history=${history.length}`;
  } catch (e) {
    status.textContent = `Load failed: ${e.message}`;
  }
}
