import { describe, expect, it } from "vitest";
import { parseItem } from "../../parsers/item.js";

describe("parseItem", () => {
  it("parses gift payload fields", () => {
    const row = [
      "20240101", "0000", "20240131", "2359", "120000", "999999",
      "0", "1",
      "0", "0", "127", "0",
      "999", "301", "10", "GiftTitle", "GiftMessage", "0", "0", "1",
    ].join("\t");
    const parsed = parseItem(`[start]\n${row}\n[end]`);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].gift.giftType).toBe(301);
    expect(parsed[0].gift.giftAmount).toBe(10);
    expect(parsed[0].gift.repeatFlag).toBe(1);
  });
});
