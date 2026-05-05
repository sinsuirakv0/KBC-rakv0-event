export function parseSheetEntries(sheet, parserApi, rowsToTsv) {
  const text = rowsToTsv(sheet.rows);
  if (sheet.type === "gatya") return parserApi.parseGatyaBrowser(text);
  if (sheet.type === "sale") return parserApi.parseSaleBrowser(text);
  return parserApi.parseItemBrowser(text);
}

export function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
