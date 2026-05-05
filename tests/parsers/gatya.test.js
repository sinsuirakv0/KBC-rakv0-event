import { describe, expect, it } from "vitest";
import { parseGatya } from "../../parsers/gatya.js";

describe("parseGatya", () => {
  it("parses one valid row", () => {
    const row = [
      "20240101", "0000", "20240131", "2359", "120000", "999999", "0", "0", "1", "1",
      "1001", "150", "0", "2", "7000", "0", "2500", "0", "500", "0", "0", "0", "0", "1", "msg",
      "0", "300",
    ].join("\t");
    const parsed = parseGatya(`[start]\n${row}\n[end]`);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].header.gachaType).toBe(1);
    expect(parsed[0].gachas[0].id).toBe(1001);
    expect(parsed[0].gachas[0].rates.featured).toBe(300);
  });
});
