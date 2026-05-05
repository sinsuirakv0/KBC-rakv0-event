export function parseTsvContent(text) {
  const lines = [];
  for (const line of String(text || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const firstCell = trimmed.split("\t")[0].trim();
    if (firstCell.startsWith("//")) continue;
    if (firstCell) lines.push(firstCell);
  }
  return lines.join("\n");
}
