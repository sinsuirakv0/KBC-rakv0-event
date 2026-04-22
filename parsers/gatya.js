/**
 * ガチャTSVパーサー
 *
 * 1行の構造:
 *   [ヘッダー 10フィールド]
 *   [ガチャブロック×gachaCount (各15フィールド固定、ブロック間に空白あり)]
 *   [空白 / カウンターテキスト (可変)]
 *   [0 0ペア×gachaCount (各2フィールド: 不明, featuredRate)]
 *
 * 注意: ガチャタイプによってはペアが存在しない場合もある (featuredRate=0 扱い)
 */
export function parseGatya(tsv) {
  const lines   = tsv.trim().split("\n");
  const results = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "[start]" || trimmed === "[end]") continue;

    const cells = trimmed.split("\t");
    if (cells.length < 10) continue;

    const gachaCount = Number(cells[9]);

    const header = {
      startDate:  cells[0],
      startTime:  cells[1],
      endDate:    cells[2],
      endTime:    cells[3],
      minVersion: cells[4],
      maxVersion: cells[5],
      gachaType:  Number(cells[8]),
      gachaCount,
    };

    // ── ガチャブロック (15フィールド固定 × gachaCount) ──
    // ブロック先頭の空白セルはスキップ (ブロック間セパレータ対策)
    const blocks = [];
    let offset = 10;
    for (let i = 0; i < gachaCount; i++) {
      while (offset < cells.length && cells[offset] === "") offset++;
      blocks.push(cells.slice(offset, offset + 15));
      offset += 15;
    }

    // ── 0 0ペア到達まで空白・テキストをスキップ ──
    // (gachaTypeによっては保証カウンター用テキストが挟まる)
    while (
      offset < cells.length &&
      (cells[offset] === "" || isNaN(Number(cells[offset])))
    ) {
      offset++;
    }

    // ── 0 0ペア (2フィールド × gachaCount) ──
    // ペア[i][0] = 不明, ペア[i][1] = featuredRate
    const pairs = [];
    for (let i = 0; i < gachaCount; i++) {
      pairs.push({
        unknown:      Number(cells[offset]     ?? 0),
        featuredRate: Number(cells[offset + 1] ?? 0),
      });
      offset += 2;
    }

    // ── ブロック[i] と ペア[i] を対応付けてgachasを構築 ──
    const gachas = [];
    for (let i = 0; i < gachaCount; i++) {
      const slice   = blocks[i];
      const gachaId = Number(slice[0]);
      if (gachaId === -1) continue; // プレースホルダーはスキップ

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
          featured:   pairs[i]?.featuredRate ?? 0,
        },
        guaranteed: Number(slice[11]) === 1,
        message:    slice[14] ?? "",
      });
    }

    results.push({ header, gachas, raw: trimmed });
  }

  return results;
}
