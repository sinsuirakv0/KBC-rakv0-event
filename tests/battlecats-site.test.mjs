import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAssetExplorerUrl,
  findReadyComparison,
  selectComparisonSnapshots,
} from "../scripts/monitor-battlecats-site.js";

function snapshot(id, versionName, versionCode) {
  return {
    dataset: "Local",
    id,
    label: versionName,
    versionName,
    versionCode,
    compactVersion: String(versionCode),
    manifestPath: `jp/explorer/manifests/Local/${id}.json`,
    rawRoot: `jp/Local/${versionCode}`,
    available: true,
    fileCount: 1,
    totalSize: 10,
  };
}

const catalog = {
  schemaVersion: 1,
  datasets: {
    Local: {
      // catalog順とversionCode順を意図的に変える。
      snapshots: [
        snapshot("15400", "15.4.0", 15400),
        snapshot("15300", "15.3.0", 15300),
        snapshot("15501", "15.5.1", 15501),
      ],
    },
  },
};

test("直前Local snapshotはcatalog順ではなくversionCode順で選ぶ", () => {
  const selected = selectComparisonSnapshots(catalog, "15.5.1");
  assert.equal(selected.current.id, "15501");
  assert.equal(selected.previous.id, "15400");
});

test("siteUrlは新旧snapshotとdiff viewを含む", () => {
  const selected = selectComparisonSnapshots(catalog, "15.5.1");
  const url = new URL(buildAssetExplorerUrl("https://kbc.example.test/pages/asset-explorer/", selected.current, selected.previous));
  assert.equal(url.searchParams.get("dataset"), "Local");
  assert.equal(url.searchParams.get("version"), "15501");
  assert.equal(url.searchParams.get("compare"), "15400");
  assert.equal(url.searchParams.get("view"), "diff");
  assert.equal(url.searchParams.get("layout"), "list");
});

test("version.json、catalog、前後manifestが揃うまでreadyにしない", async () => {
  const selected = selectComparisonSnapshots(catalog, "15.5.1");
  const manifests = {
    [selected.current.manifestPath]: { schemaVersion: 1, dataset: "Local", snapshot: "15501", fileCount: 1, totalSize: 10, files: { "a.bin": { size: 10 } } },
    [selected.previous.manifestPath]: { schemaVersion: 1, dataset: "Local", snapshot: "15400", fileCount: 1, totalSize: 10, files: { "b.bin": { size: 10 } } },
  };
  const payloads = {
    "jp/version.json": { packageName: "jp.co.ponos.battlecats", versionName: "15.5.1" },
    "jp/explorer/catalog.json": catalog,
    ...manifests,
  };
  const result = await findReadyComparison({
    owner: "owner",
    assetsRepo: "assets",
    token: "token",
    expectedVersion: "15.5.1",
    getJson: async ({ path }) => payloads[path],
  });
  assert.equal(result.current.id, "15501");
  assert.equal(result.previous.id, "15400");
});

test("manifestのsnapshot identityまたはcatalog totalsが不一致ならreadyにしない", async () => {
  const selected = selectComparisonSnapshots(catalog, "15.5.1");
  const payloads = {
    "jp/version.json": { packageName: "jp.co.ponos.battlecats", versionName: "15.5.1" },
    "jp/explorer/catalog.json": catalog,
    [selected.current.manifestPath]: { schemaVersion: 1, dataset: "Local", snapshot: "wrong", fileCount: 1, totalSize: 10, files: { "a.bin": { size: 10 } } },
    [selected.previous.manifestPath]: { schemaVersion: 1, dataset: "Local", snapshot: "15400", fileCount: 99, totalSize: 999, files: { "b.bin": { size: 10 } } },
  };
  const result = await findReadyComparison({
    owner: "owner",
    assetsRepo: "assets",
    token: "token",
    expectedVersion: "15.5.1",
    getJson: async ({ path }) => payloads[path],
  });
  assert.equal(result, null);
});

console.log("Battle Cats site follow-up tests passed.");
