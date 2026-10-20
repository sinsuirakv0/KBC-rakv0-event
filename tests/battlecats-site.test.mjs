import assert from "node:assert/strict";
import test from "node:test";
import {buildAssetExplorerUrl,findReadyComparison,selectComparisonSnapshots} from "../scripts/monitor-battlecats-site.js";

function snapshot(datasetId,versionName,versionCode) {
  return {datasetId,buildId:`${datasetId}-build`,versionName,versionCode,inventoryPath:`metadata/jp/versions/${datasetId}.inventory.json`,fileCount:1,totalSize:10};
}
const entries=[snapshot("15400","15.4.0",15400),snapshot("15300","15.3.0",15300),snapshot("15501","15.5.1",15501)];
const catalog={schemaVersion:1,sourceRegion:"jp",snapshots:entries};
const revision="a".repeat(40);

test("comparison selects the previous saved version by versionCode",()=>{
  const selected=selectComparisonSnapshots(catalog,"15.5.1");
  assert.equal(selected.current.id,"15501");
  assert.equal(selected.previous.id,"15400");
  selected.current.revision=revision;
  const url=new URL(buildAssetExplorerUrl(undefined,selected.current,selected.previous));
  assert.equal(url.hostname,"kbc-rakv0.pages.dev");
  assert.equal(url.searchParams.get("revision"),revision);
  assert.equal(url.searchParams.get("compare"),"15400");
});

test("readiness requires matching inventories and a working public consumer",async()=>{
  const selected=selectComparisonSnapshots(catalog,"15.5.1");
  const payloads={
    "metadata/jp/current.json":{schemaVersion:1,status:"verified",sourceRegion:"jp",datasetId:"15501",buildId:"15501-build",versionName:"15.5.1"},
    "metadata/jp/catalog.json":catalog,
  };
  for(const entry of [selected.current,selected.previous]) payloads[entry.inventoryPath]={schemaVersion:1,sourceRegion:"jp",datasetId:entry.datasetId,versionName:entry.versionName,versionCode:entry.versionCode,files:[{relativePath:"DataLocal/file.csv",size:10,sha256:"a".repeat(64)}]};
  const options={owner:"owner",assetsRepo:"assets",token:"token",expectedVersion:"15.5.1",getRevision:async()=>revision,getJson:async({path,ref})=>{assert.equal(ref,revision);return payloads[path];},checkSite:async()=>true};
  assert.equal((await findReadyComparison(options)).current.id,"15501");
  assert.equal(await findReadyComparison({...options,checkSite:async()=>false}),null);
  payloads[selected.current.inventoryPath].versionCode++;
  assert.equal(await findReadyComparison(options),null);
});
