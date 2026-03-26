function decodeWeekdays(bitmask) {
  if (bitmask === 0) return [];
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return days.filter((_, i) => (bitmask >> i) & 1);
}

export function parseSale(tsv) {
  const lines = tsv
    .trim()
    .split("\n")
    .filter(line => line.trim() && line !== "[start]" && line !== "[end]");

  return lines.map(line => {
    const trimmed = line.trim();
    const parts   = trimmed.split("\t").filter(x => x !== "");

    const header = {
      startDate:  parts[0],
      startTime:  parts[1],
      endDate:    parts[2],
      endTime:    parts[3],
      minVersion: parts[4],
      maxVersion: parts[5],
    };

    let index = 6;
    index++; // 未使用フィールドをスキップ

    const timeBlockCount = parseInt(parts[index++], 10);
    const timeBlocks     = [];

    for (let i = 0; i < timeBlockCount; i++) {
      const block = { dateRanges: [], monthDays: [], weekdays: [], timeRanges: [] };

      const yearCount = parseInt(parts[index++], 10);
      for (let j = 0; j < yearCount; j++) {
        block.dateRanges.push({
          start: `${parts[index++]} ${parts[index++]}`,
          end:   `${parts[index++]} ${parts[index++]}`,
        });
      }

      const monthCount = parseInt(parts[index++], 10);
      for (let j = 0; j < monthCount; j++) {
        block.monthDays.push(parseInt(parts[index++], 10));
      }

      block.weekdays = decodeWeekdays(parseInt(parts[index++], 10));

      const timeRangeCount = parseInt(parts[index++], 10);
      for (let j = 0; j < timeRangeCount; j++) {
        block.timeRanges.push([parts[index++], parts[index++]]);
      }

      timeBlocks.push(block);
    }

    const stageCount = parseInt(parts[index++], 10);
    const stageIds   = parts.slice(index, index + stageCount).map(Number);

    return { header, timeBlocks, stageIds, raw: trimmed };
  });
}
