import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as http } from 'node:http';
import { test } from 'node:test';
import { createApp } from '../dist/app.js';
import { parseConfig } from '../dist/config/env.js';
import { createSettingsService, parseNoteCsv, preferenceSchema, defaultPreferences } from '../dist/services/settings.js';
test('CSV handles quoting, multiline text and rejects invalid headers, rows, lengths and malformed quotes', () => {
  assert.deepEqual(parseNoteCsv('symbol,exchange,title,content\r\nTEST,NASDAQ,"My, thesis","First line\nSecond ""quote"""\r\n'), [['TEST','NASDAQ','My, thesis','First line\nSecond "quote"']]);
  for (const csv of ['', 'symbol,exchange,title,content', 'ticker,exchange,title,content\nTEST,NASDAQ,t,c', 'symbol,exchange,title,content\nTEST,NASDAQ,"unclosed', 'symbol,exchange,title,content\nTEST,NASDAQ,"a"x,b', 'symbol,exchange,title,content\nTEST,NASDAQ,,note', 'symbol,exchange,title,content\nTEST,NASDAQ,t,n,extra', 'symbol,exchange,title,content\n' + 'TEST,NASDAQ,t,c\n'.repeat(101)]) assert.throws(() => parseNoteCsv(csv), e => e.status === 400);
});
test('preferences reject unknown secret fields and invalid budgets; status works with absent or failed database', async () => {
  assert.equal(preferenceSchema.safeParse(defaultPreferences).success,true);
  for (const extra of [{monthlyBudgetUsd:'-1'},{monthlyBudgetUsd:'1.001'},{lookbackYears:0},{apiKey:'synthetic-secret'}]) assert.equal(preferenceSchema.safeParse({...defaultPreferences,...extra}).success,false);
  const config=parseConfig({TIINGO_API_KEY:'synthetic-secret',OPENAI_API_KEY:'another-secret'});
  const status=await createSettingsService(config).overview();
  assert.equal(status.providers.length,3);assert.equal(status.availableProviders,0);assert.equal(status.database.status,'Unavailable');
  assert.equal(status.providers[0].status,'Unknown / Not Tested');assert.equal(status.providers[1].status,'Not Configured');
  assert.equal(JSON.stringify(status).includes('synthetic-secret'),false);assert.equal(JSON.stringify(status).includes('another-secret'),false);
  const placeholder=await createSettingsService(parseConfig({SEC_EDGAR_USER_AGENT:'Example me@example.org'})).overview();assert.equal(placeholder.providers[1].status,'Not Configured');
});
test('settings HTTP reads never write; validation, write protection and failure redaction work',async t=>{
  const config=parseConfig({}),calls=[],logs=[];let fail=false;
  const methods=['overview','preferences','savePreferences','jobs','coverage','syncWatchlist','retry','importCsv','exportResearch'];
  const settings=Object.fromEntries(methods.map(name=>[name,async (...args)=>{calls.push([name,...args]);if(fail)throw Error('synthetic-password');return name==='preferences'?defaultPreferences:{results:[]};}]));
  const server=createApp(config,{settings,logger:{info(){},error:v=>logs.push(v)}}).listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const send=(path,body,protect=true)=>new Promise((resolve,reject)=>{const data=body===undefined?undefined:JSON.stringify(body);const req=http({host:'127.0.0.1',port:server.address().port,path,method:data?'POST':'GET',headers:{Host:'127.0.0.1:7001',...(data?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}:{}),...(protect?{Origin:config.FRONTEND_ORIGIN,'X-Stock-Research-Lab':'1'}:{})}},res=>{let text='';res.on('data',d=>text+=d);res.on('end',()=>resolve({status:res.statusCode,text}));});req.on('error',reject);req.end(data);});
  for(const path of ['status','preferences','jobs','coverage','export-research'])assert.equal((await send(`/api/settings/${path}`)).status,200);
  assert.equal(calls.some(c=>['savePreferences','importCsv','syncWatchlist','retry'].includes(c[0])),false);
  assert.equal((await send('/api/settings/preferences',defaultPreferences,false)).status,403);
  assert.equal((await send('/api/settings/preferences',defaultPreferences)).status,200);
  assert.equal((await send('/api/settings/preferences',{...defaultPreferences,OPENAI_API_KEY:'no'})).status,400);
  assert.equal((await send('/api/settings/jobs?offset=-1')).status,400);
  assert.equal((await send('/api/settings/retry-sync',{jobId:'invalid'})).status,400);
  assert.equal((await send('/api/settings/import-csv',{csv:4})).status,400);
  assert.equal((await send('/api/settings/sync-watchlist',{})).status,202);
  fail=true;const failure=await send('/api/settings/preferences');assert.equal(failure.status,503);assert.equal(failure.text.includes('synthetic-password'),false);assert.equal(JSON.stringify(logs).includes('synthetic-password'),false);
});
