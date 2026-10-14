import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { after, afterEach, test } from 'node:test';
import { createDatabase } from '../../dist/services/database.js';
import { createResearchHistoryService } from '../../dist/services/research-history.js';
import { createStockOverviewService } from '../../dist/services/stock-overview.js';
const url = new URL(process.env.DATABASE_URL);
assert.match(process.env.SRL_TEST_DATABASE ?? '', /^srl_test_[a-f0-9]{24}$/); assert.equal(url.pathname, `/${process.env.SRL_TEST_DATABASE}`); assert.equal(url.hostname,'127.0.0.1');
const database = createDatabase({DATABASE_URL:url.href}), db = database.client;
const now = () => new Date('2026-06-01T12:00:00Z'), service = createResearchHistoryService(db, now);
after(() => database.close());
afterEach(async () => { await db.$executeRaw`TRUNCATE TABLE "EntryScenario", "CompanyFact", "SecFiling", "PriceBar", "ResearchSource", "ResearchNote", "ResearchRun", "WatchlistEntry", "WatchlistDetails", "ProviderSyncState", "ProviderSyncJob", "ProviderRequestUsage", "Instrument", "Issuer"`; });
const stock = (symbol='TEST') => db.instrument.create({data:{symbol,exchange:'NASDAQ',name:`Fixture ${symbol}`,currency:'USD',exchangeTimezone:'America/New_York'}});
const query = extra => ({limit:50,offset:0,...extra});
const originalPrice = { close:'90',currency:'USD',tradingDate:'2026-03-30',provider:'TIINGO',adjustmentMode:'RAW',retrievedAt:'2026-03-31T12:00:00Z' };
async function report(instrument, version=1, seriesId=randomUUID()) {
  const run = await db.researchRun.create({data:{instrumentId:instrument.id,seriesId,version,status:'RUNNING',idempotencyKey:randomUUID(),inputSnapshot:{price:originalPrice,assumptions:{growth:'10'}},inputHash:'a'.repeat(64),dataCutoff:new Date('2026-04-01'),model:'test-only',promptVersion:'1',outputSchemaVersion:'1',createdAt:new Date(`2026-04-0${version}T11:00:00Z`)}});
  await db.researchSource.create({data:{researchRunId:run.id,citationKey:'SEC1',url:'https://www.sec.gov/Archives/test-only',title:'Official fixture',retrievedAt:new Date('2026-04-01'),evidenceSnapshot:{}}});
  return db.researchRun.update({where:{id:run.id},data:{status:'SUCCEEDED',completedAt:new Date(`2026-04-0${version}T12:00:00Z`),output:{summary:`Original thesis ${version}`,thesis:`Original thesis ${version}`,overviewProjection:{bearishRisks:[{text:`Risk ${version}`}],catalysts:[{text:`Catalyst ${version}`}],bullishDrivers:[]}}}});
}
async function scenario(instrument, extra={}) { return db.entryScenario.create({data:{instrumentId:instrument.id,seriesId:randomUUID(),version:1,method:'BEAR_BASE_BULL',methodVersion:'valuation-v1',inputSnapshot:{price:originalPrice},assumptions:{growth:'10'},resultSnapshot:{fairValueRange:{lower:'100',upper:'120'},cases:[{name:'base',currentPriceMarginOfSafetyPercent:'10',plannedEntryMarginOfSafetyPercent:{atLower:'40',atUpper:'20'}}]},currency:'USD',lowerPrice:'60',upperPrice:'80',dataCutoff:new Date('2026-04-01'),createdAt:new Date('2026-04-03'),...extra}}); }
test('empty history remains empty; five latest mixed records, cross-stock/type/keyword/date filters and pages are correct', async () => {
  assert.deepEqual((await service.list(query({trackedOnly:true}))).records,[]); assert.equal(await db.instrument.count(),0);
  const s = await stock(), peer = await stock('PEER'); await db.watchlistEntry.create({data:{instrumentId:s.id}});
  await report(s); await scenario(s); await report(peer);
  for (let i=1;i<=6;i++) await db.researchNote.create({data:{instrumentId:s.id,seriesId:randomUUID(),version:1,content:`Manual thesis catalyst ${i}`,createdAt:new Date(`2026-05-0${i}`)}});
  const preview = (await createStockOverviewService(db,now).getOverview('TEST','MAX')).history;
  assert.equal(preview.length,5); assert.equal(preview[0].summary,'Manual thesis catalyst 6');
  assert.equal((await service.list(query({trackedOnly:true}))).records.length,8);
  assert.equal((await service.list(query({symbol:'PEER',exchange:'NASDAQ'}))).records.length,1);
  assert.equal((await service.list(query({trackedOnly:true,kind:'SCENARIO'}))).records[0].fairValue.lower,'100');
  assert.equal((await service.list(query({trackedOnly:true,search:'catalyst 5'}))).records.length,1);
  assert.equal((await service.list(query({trackedOnly:true,search:'PEER'}))).records.length,0);
  assert.equal((await service.list(query({symbol:'TEST',from:'2026-05-02',to:'2026-05-03'}))).records.length,2);
  const first = await service.list(query({symbol:'TEST',limit:3})), next = await service.list(query({symbol:'TEST',limit:3,offset:first.nextOffset}));
  assert.equal(new Set([...first.records,...next.records].map(r=>r.id)).size,6);
  assert.equal(first.records[0].markerOrdinal,8); assert.equal((await service.list(query({symbol:'TEST',search:'catalyst 6'}))).records[0].markerOrdinal,8);
  await db.watchlistEntry.create({data:{instrumentId:peer.id}}); assert.equal((await service.list(query({trackedOnly:true,search:'PEER'}))).records.length,1);
});
test('saved report/scenario details use original snapshots, preserve comparisons, safe sources and reject mutation', async () => {
  const s = await stock(), series=randomUUID(), a=await report(s,1,series), b=await report(s,2,series);
  const saved = await scenario(s,{researchRunId:a.id,createdAt:new Date('2026-04-01T11:30:00Z')});
  const d = await service.detail('REPORT',a.id); assert.equal(d.price.value,'90'); assert.equal(d.record.fairValue.lower,'100'); assert.equal(d.entryZone.lower,'60'); assert.equal(d.marginOfSafety,'10'); assert.deepEqual(d.risks,['Risk 1']); assert.equal(d.sources[0].url,'https://www.sec.gov/Archives/test-only');
  assert.deepEqual((await service.detail('REPORT',b.id)).versions.map(v=>v.version),[2,1]);
  await scenario(s,{researchRunId:a.id,createdAt:new Date('2026-05-01'),lowerPrice:'1'});
  assert.equal((await service.detail('REPORT',a.id)).entryZone.lower,'60');
  await assert.rejects(db.researchRun.update({where:{id:a.id},data:{output:{summary:'Changed'}}}));
  await assert.rejects(db.entryScenario.update({where:{id:saved.id},data:{lowerPrice:'2'}}));
  assert.equal((await service.detail('SCENARIO',saved.id)).price.value,'90');
  const childCode = `import {createDatabase} from './dist/services/database.js'; import {createResearchHistoryService} from './dist/services/research-history.js'; const db=createDatabase({DATABASE_URL:process.env.DATABASE_URL}); try {const d=await createResearchHistoryService(db.client).detail('REPORT','${a.id}'); console.log(JSON.stringify({price:d.price.value,thesis:d.thesis}));} finally {await db.close();}`;
  for(let i=0;i<2;i++){const child=spawnSync(process.execPath,['--input-type=module','-e',childCode],{env:process.env,encoding:'utf8'});assert.equal(child.status,0);assert.deepEqual(JSON.parse(child.stdout),{price:'90',thesis:'Original thesis 1'});}
});
test('manual notes append immutable revisions, capture prices once, detect conflicts and retain report association', async () => {
  const s=await stock(), run=await report(s); const input={exchange:'NASDAQ',title:'First thesis',content:'Original note',risks:['Risk'],catalysts:['Catalyst'],researchRunId:run.id};
  const bar=await db.priceBar.create({data:{instrumentId:s.id,provider:'TIINGO',interval:'DAY',adjustmentMode:'RAW',timestamp:new Date('2026-05-28'),tradingDate:new Date('2026-05-28'),currency:'USD',exchangeTimezone:s.exchangeTimezone,open:'90',high:'90',low:'90',close:'90',volume:'1',retrievedAt:new Date('2026-05-29'),sourceHash:'a'.repeat(64),splitFactor:'1'}});
  const first=await service.saveNote('TEST',input); const d=await service.detail('NOTE',first.id); assert.equal(d.price.value,'90'); assert.equal(d.thesis,'Original note');
  await db.priceBar.update({where:{id:bar.id},data:{close:'95',high:'95',revision:2}});assert.equal((await service.detail('NOTE',first.id)).price.value,'90');
  const edits=await Promise.allSettled([service.saveNote('TEST',{...input,title:'Revised thesis',content:'New thesis',seriesId:d.record.seriesId,expectedVersion:1}),service.saveNote('TEST',{...input,seriesId:d.record.seriesId,expectedVersion:1})]);
  assert.equal(edits.filter(r=>r.status==='fulfilled').length,1);assert.equal(edits.find(r=>r.status==='rejected').reason.status,409);
  assert.equal((await service.detail('NOTE',edits.find(r=>r.status==='fulfilled').value.id)).price.value,'95');
  assert.equal((await service.detail('NOTE',first.id)).thesis,'Original note');
  assert.equal((await service.detail('REPORT',run.id)).notes.length,2);assert.ok((await service.detail('REPORT',run.id)).notes.every(n=>n.addedAfterReport));
  await assert.rejects(db.researchNote.update({where:{id:first.id},data:{content:'Overwrite'}}));
  const legacy=await db.researchNote.create({data:{instrumentId:s.id,seriesId:randomUUID(),version:1,content:'Legacy plain thesis',createdAt:now()}});assert.equal((await service.detail('NOTE',legacy.id)).price,null);
});
