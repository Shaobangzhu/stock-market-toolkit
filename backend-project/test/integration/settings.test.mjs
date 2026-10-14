import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { test, after, afterEach } from 'node:test';
import { createDatabase } from '../../dist/services/database.js';
import { parseConfig } from '../../dist/config/env.js';
import { createSettingsService, defaultPreferences } from '../../dist/services/settings.js';
const url=new URL(process.env.DATABASE_URL);assert.match(process.env.SRL_TEST_DATABASE??'',/^srl_test_[a-f0-9]{24}$/);assert.equal(url.pathname,`/${process.env.SRL_TEST_DATABASE}`);assert.equal(url.hostname,'127.0.0.1');
const database=createDatabase({DATABASE_URL:url.href}),db=database.client;
const now=()=>new Date('2026-06-01T12:00:00Z'),config=parseConfig({TIINGO_API_KEY:'test-only-secret',OPENAI_API_KEY:'test-only-openai',SEC_EDGAR_USER_AGENT:'Test sec@srl-fixture.org'});
const service=createSettingsService(config,db,undefined,undefined,now);
after(()=>database.close());afterEach(async()=>{await db.$executeRaw`TRUNCATE TABLE "EntryScenario", "CompanyFact", "SecFiling", "PriceBar", "ResearchSource", "ResearchNote", "ResearchRun", "WatchlistEntry", "WatchlistDetails", "ProviderSyncState", "ProviderSyncJob", "ProviderRequestUsage", "Instrument", "Issuer", "AppPreference"`;});
const stock=()=>db.instrument.create({data:{symbol:'TEST',exchange:'NASDAQ',name:'Fixture',currency:'USD',exchangeTimezone:'America/New_York'}});
test('settings reads keep fresh database empty; defaults, counts and provider availability are honest',async()=>{
  const status=await service.overview();assert.equal(status.database.status,'Connected');assert.equal(status.database.instruments,0);assert.equal(status.pendingJobs,0);assert.equal(status.availableProviders,0);assert.ok(status.providers.every(p=>p.status==='Unknown / Not Tested'));assert.equal(status.database.earliestPriceDate,null);
  assert.deepEqual(await service.preferences(),defaultPreferences);assert.equal((await service.coverage(0)).instruments.length,0);assert.equal((await service.jobs(0)).jobs.length,0);assert.equal((await service.exportResearch()).notes.length,0);assert.equal(await db.appPreference.count(),0);assert.equal(await db.instrument.count(),0);
  assert.deepEqual(await service.syncWatchlist(),{results:[]});assert.equal(await db.providerSyncJob.count(),0);
  assert.equal(JSON.stringify(status).includes('test-only-secret'),false);
});
test('preferences persist across separate backend processes and validate exact budget strings',async()=>{
  const value={...defaultPreferences,lookbackYears:3,monthlyBudgetUsd:'25.10'};assert.deepEqual(await service.savePreferences(value),value);assert.equal(await db.appPreference.count(),1);
  const child=spawnSync(process.execPath,['--input-type=module','-e',`import {createDatabase} from './dist/services/database.js';import {createSettingsService} from './dist/services/settings.js';import {parseConfig} from './dist/config/env.js';const d=createDatabase({DATABASE_URL:process.env.DATABASE_URL});try{console.log(JSON.stringify(await createSettingsService(parseConfig({}),d.client).preferences()));}finally{await d.close();}`],{env:process.env,encoding:'utf8'});assert.equal(child.status,0);assert.deepEqual(JSON.parse(child.stdout),value);
});
test('CSV validates all instruments atomically, appends immutable notes, and exports original metadata',async()=>{
  const s=await stock();await assert.rejects(service.importCsv('symbol,exchange,title,content\nTEST,NASDAQ,t,n\nUNKNOWN,NASDAQ,t,n'),e=>e.status===400);assert.equal(await db.researchNote.count(),0);
  const result=await service.importCsv('symbol,exchange,title,content\nTEST,NASDAQ,"Thesis, title","Personal note"');assert.equal(result.imported,1);
  const note=await db.researchNote.findUnique({where:{id:result.ids[0]}});assert.equal(note.instrumentId,s.id);assert.equal(JSON.parse(note.content).inputSnapshot.price,null);assert.equal(await db.priceBar.count(),0);
  await assert.rejects(db.researchNote.update({where:{id:note.id},data:{content:'overwrite'}}));
  const exported=await service.exportResearch();assert.equal(exported.schemaVersion,'research-export-v1');assert.equal(exported.notes[0].content,note.content);assert.equal(exported.instruments[0].symbol,'TEST');
});
test('provider statuses reflect success, later rate limits and recovery; retries preserve original jobs',async()=>{
  const s=await stock();await db.watchlistEntry.create({data:{instrumentId:s.id}});
  const state=await db.providerSyncState.create({data:{instrumentId:s.id,provider:'TIINGO',dataset:'PRICES',scopeKey:'DAY:RAW',lastSuccessAt:new Date('2026-06-01T10:00:00Z')}});
  assert.equal((await service.overview()).providers[0].status,'Online');
  const job=await db.providerSyncJob.create({data:{instrumentId:s.id,provider:'TIINGO',dataset:'PRICES',status:'FAILED',idempotencyKey:randomUUID(),requestSnapshot:{fullHistory:true,symbol:'TEST'},createdAt:new Date('2026-06-01T09:00:00Z'),startedAt:new Date('2026-06-01T10:00:00Z'),finishedAt:new Date('2026-06-01T11:00:00Z'),errorCode:'PROVIDER_RATE_LIMITED',retryAfter:new Date('2026-06-01T13:00:00Z')}});
  assert.equal((await service.overview()).providers[0].status,'Rate Limited');await assert.rejects(service.retry(job.id),e=>e.status===429);
  await db.providerSyncJob.update({where:{id:job.id},data:{retryAfter:null}});
  const calls=[];const market={requestSync:async(...args)=>{calls.push(args);return{id:'new-job'};}};
  const working=createSettingsService(config,db,market,undefined,now);assert.equal((await working.retry(job.id)).id,'new-job');assert.equal(calls[0][1].fullHistory,true);assert.equal((await db.providerSyncJob.findUnique({where:{id:job.id}})).status,'FAILED');
  assert.equal((await working.syncWatchlist()).results[0].job.id,'new-job');assert.equal(calls.at(-1)[1].fullHistory,true);
  const failing=createSettingsService(config,db,{requestSync:async()=>{throw Error('secret');}},undefined,now);assert.equal((await failing.syncWatchlist()).results[0].errorCode,'DATABASE_UNAVAILABLE');
  await db.providerSyncJob.update({where:{id:job.id},data:{errorCode:'PROVIDER_UNAVAILABLE'}});assert.equal((await service.overview()).providers[0].status,'Error');
  await db.providerSyncJob.update({where:{id:job.id},data:{errorCode:'PROVIDER_RATE_LIMITED'}});
  await db.providerSyncState.update({where:{id:state.id},data:{lastSuccessAt:now()}});assert.equal((await service.overview()).providers[0].status,'Online');
  assert.equal((await service.jobs(0)).jobs[0].errorCode,'PROVIDER_RATE_LIMITED');
});
test('coverage and database price bounds preserve real series basis and dates; incremental batch uses cached history',async()=>{
  const s=await stock();await db.watchlistEntry.create({data:{instrumentId:s.id}});
  await db.priceBar.create({data:{instrumentId:s.id,provider:'TIINGO',interval:'DAY',adjustmentMode:'RAW',timestamp:new Date('2026-05-29'),tradingDate:new Date('2026-05-29'),currency:'USD',exchangeTimezone:s.exchangeTimezone,open:'12.12345678',high:'13',low:'12',close:'12.12345678',volume:'1000000000000',retrievedAt:now(),sourceHash:'a'.repeat(64)}});
  const status=await service.overview();assert.equal(status.database.priceRecords,1);assert.equal(status.database.earliestPriceDate,'2026-05-29');
  const series=(await service.coverage(0)).instruments[0].series[0];assert.equal(series._count,1);assert.equal(series.adjustmentMode,'RAW');assert.equal(series.currency,'USD');assert.equal(series.exchangeTimezone,s.exchangeTimezone);
  const calls=[];await createSettingsService(config,db,{requestSync:async(...args)=>{calls.push(args);return{id:'incremental'};}},undefined,now).syncWatchlist();assert.equal(calls[0][1].fullHistory,undefined);
});
