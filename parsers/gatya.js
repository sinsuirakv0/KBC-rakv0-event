export function parseGatya(tsv) {
  const lines   = tsv.trim().split("\n");
  const results = [];

  for (const line of lines) {
    // [start] / [end] をスキップ
    const trimmed = line.trim();
    if (!trimmed || trimmed === "[start]" || trimmed === "[end]") continue;

    const cells = trimmed.split("\t");
    if (cells.length < 10) continue;

    const header = {
      startDate:  cells[0],
      startTime:  cells[1],
      endDate:    cells[2],
      endTime:    cells[3],
      minVersion: cells[4],
      maxVersion: cells[5],
      gachaType:  Number(cells[8]),
      gachaCount: Number(cells[9]),
    };

    const gachas = [];
    let offset   = 10;

    for (let i = 0; i < header.gachaCount; i++) {
      // スロット間の空白フィールドをスキップ
      while (offset < cells.length && cells[offset] === "") offset++;

      const slice   = cells.slice(offset, offset + 15);
      const gachaId = Number(slice[0]);

      if (gachaId !== -1) {
        gachas.push({
          id:    gachaId,
          price: Number(slice[1]),
          flags: Number(slice[3]),
          rates: {
            normal:     Number(slice[4]),
            rare:       Number(slice[6]),
            superRare:  Number(slice[8]),
            uberRare:   Number(slice[10]),
            legendRare: Number(slice[12]),
          },
          guaranteed: Number(slice[11]) === 1,
          message:    slice[14] ?? "",
        });
      }

      offset += 15;
    }

    results.push({ header, gachas, raw: trimmed });
  }

  return results;
}
