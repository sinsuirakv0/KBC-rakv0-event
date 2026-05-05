export function toKatakana(str) {
  return String(str).replace(/[\u3041-\u3096]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) + 0x60),
  );
}

export function normalizeForSearch(str) {
  return toKatakana(String(str).toLowerCase());
}

export function stripHtml(str) {
  return String(str).replace(/<[^>]*>/g, "");
}

export function parseSearchQuery(q) {
  const trimmed = String(q || "").trim();
  if (!trimmed) return { idPart: "", namePart: "" };
  const m = trimmed.match(/^(\d+)\s*([\s\S]*)$/);
  if (m) return { idPart: m[1], namePart: m[2].trim() };
  return { idPart: "", namePart: trimmed };
}

export function matchesSearch(id, name, query) {
  if (!query) return true;
  const { idPart, namePart } = parseSearchQuery(query);
  const idMatch = idPart ? String(id).includes(idPart) : true;
  const nameMatch = namePart
    ? normalizeForSearch(name).includes(normalizeForSearch(namePart))
    : true;
  return idMatch && nameMatch;
}

export function filterAndSortEvents(events, options) {
  const {
    now,
    scheduleOff,
    searchQuery,
    sortByDate,
    sortById,
    showCurrent,
    showPast,
    showAll,
  } = options;
  const baseEvents = scheduleOff ? events.filter((e) => e.start <= now) : events;
  let filtered;
  if (searchQuery) {
    filtered = baseEvents.filter((e) => {
      const id = e.detail?.id ?? "";
      const name = normalizeForSearch(stripHtml(e.name ?? ""));
      return matchesSearch(id, name, searchQuery);
    });
  } else {
    filtered = baseEvents.filter((e) => {
      const isPast = e.end <= now;
      const isCurrent = e.start <= now && e.end > now;
      const isFuture = e.start > now;
      const isSteady = e.detail?.steady ?? false;
      if (showPast) return true;
      if (isPast) return false;
      if (isSteady && isCurrent && !showAll) return false;
      if (isCurrent) return showCurrent;
      if (isFuture) return true;
      return false;
    });
  }
  if (sortByDate) filtered.sort((a, b) => a.start - b.start);
  else if (sortById) {
    filtered.sort((a, b) => (a.detail?.id ?? 0) - (b.detail?.id ?? 0));
  }
  return filtered;
}
