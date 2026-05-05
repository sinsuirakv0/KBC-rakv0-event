import { describe, expect, it } from "vitest";
import { parseSale } from "../../parsers/sale.js";

describe("parseSale", () => {
  it("parses stage ids and time blocks", () => {
    const row = [
      "20240101", "0000", "20240131", "2359", "120000", "999999",
      "0", "1",
      "0", "0", "127", "0",
      "2", "1001", "1002",
    ].join("\t");
    const parsed = parseSale(`[start]\n${row}\n[end]`);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].stageIds).toEqual([1001, 1002]);
    expect(parsed[0].timeBlocks).toHaveLength(1);
  });
});
