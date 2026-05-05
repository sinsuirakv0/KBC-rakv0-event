import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = [];

vi.mock("../../lib/github.js", () => ({
  updateGitHubFile: vi.fn(async (payload) => {
    calls.push({ type: "update", payload });
  }),
  deleteGitHubFile: vi.fn(async (payload) => {
    calls.push({ type: "delete", payload });
  }),
}));

describe("updateFiles", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("writes raw/data/hash in contract shape", async () => {
    const { updateFiles } = await import("../../scripts/update-files.js");
    const tsv = "[start]\n20240101\t0000\t20240131\t2359\t120000\t999999\t0\t1\t0\t0\t127\t0\t1\t1001\n[end]";
    const res = await updateFiles("sale", tsv, "abc123", false);
    expect(res.success).toBe(true);
    const updatePaths = calls.filter((c) => c.type === "update").map((c) => c.payload.path);
    expect(updatePaths.some((p) => p.startsWith("raw/sale_"))).toBe(true);
    expect(updatePaths).toContain("data/sale.json");
    expect(updatePaths).toContain("hashes/sale.md5");
    const dataWrite = calls.find((c) => c.type === "update" && c.payload.path === "data/sale.json");
    const parsedJson = JSON.parse(dataWrite.payload.content);
    expect(Array.isArray(parsedJson.data)).toBe(true);
    expect(typeof parsedJson.updatedAt).toBe("string");
  });
});
