import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { AppProviders } from '../app/providers';
import { ResearchHistoryDrawer } from './ResearchHistoryDrawer';
import type { ResearchRecord } from '../api/stocks';
import type { ResearchDetail } from '../api/research-history';
let calls:{path:string;body?:unknown}[],empty:boolean;
const rec=(id:string,version=1,symbol='TEST'):ResearchRecord=>({id,kind:'NOTE',type:'Manual Thesis / Note',symbol,exchange:'NASDAQ',seriesId:'series-only',version,completedAt:`2026-04-0${version}T12:00:00Z`,dataCutoff:'2026-04-01T00:00:00Z',fairValue:null,summary:`Saved thesis ${version}`});
const detail=(r:ResearchRecord):ResearchDetail=>({record:r,price:{value:r.version===1?'90':'95',currency:'USD',tradingDate:'2026-03-30',provider:'TIINGO',adjustmentMode:'RAW'},assumptions:{growth:r.version===1?'10':'12'},entryZone:{lower:'60',upper:'80',currency:'USD'},marginOfSafety:'10',plannedMarginOfSafety:{atLower:'40',atUpper:'20'},analysis:`Original thesis ${r.version}`,thesis:`Original thesis ${r.version}`,risks:[`Saved risk ${r.version}`],catalysts:[`Saved catalyst ${r.version}`],bullishDrivers:[],sources:[{title:'Official saved source',url:'https://www.sec.gov/Archives/test-only',citationKey:'SEC1',publishedAt:null}],notes:[],versions:[{id:'note-2',version:2,createdAt:'2026-04-02'},{id:'note-1',version:1,createdAt:'2026-04-01'}],snapshot:{inputs:{price:'90'},outputs:{summary:'Preserved'},formulaVersion:null}});
beforeEach(()=>{calls=[];empty=false;vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const path=String(input);calls.push({path,...(init?.body?{body:JSON.parse(String(init.body))}:{})});const u=new URL(path,'http://localhost');let data:unknown;
  if(u.pathname==='/api/research/history')data={records:empty?[]:u.searchParams.get('trackedOnly')==='true'?[rec('peer-1',1,'PEER')]:[rec('note-2',2),rec('note-1')],nextOffset:null};
  else if(u.pathname.startsWith('/api/research/records/')){const id=u.pathname.split('/').at(-1)!;data=detail(rec(id,id==='note-2'?2:1,id==='peer-1'?'PEER':'TEST'));}
  else if(u.pathname.endsWith('/notes'))data={id:'note-3',kind:'NOTE',version:3};
  else throw Error('Unexpected history fixture request');
  return {ok:true,status:200,json:async()=>({data})};}));});
function mount(){function Harness(){const [selected,setSelected]=useState<ResearchRecord|null>(null);return <ResearchHistoryDrawer open onClose={()=>{}} symbol="TEST" exchange="NASDAQ" selected={selected} onSelect={setSelected}/>;}return render(<AppProviders><Harness/></AppProviders>);}
it('has an honest empty state and no automatic writes or examples',async()=>{empty=true;mount();await screen.findByText('No research runs yet');expect(calls.every(c=>!c.body)).toBe(true);expect(screen.queryByText('PLTR')).not.toBeInTheDocument();});
it('filters across tracked stocks and dates without changing stock workspace',async()=>{const user=userEvent.setup();mount();await screen.findByRole('button',{name:/TEST · 2026-04-02/});await user.click(screen.getByRole('switch',{name:'All Research across tracked stocks'}));await user.click(await screen.findByRole('button',{name:/PEER · 2026-04-01/}));await screen.findByText('Original thesis 1');expect(screen.getByText('TEST / RESEARCH')).toBeInTheDocument();
  await user.type(screen.getByPlaceholderText('Search ticker or keyword…'),'catalyst{Enter}');fireEvent.change(screen.getByLabelText('Research from date'),{target:{value:'2026-04-01'}});fireEvent.change(screen.getByLabelText('Research to date'),{target:{value:'2026-04-02'}});
  await waitFor(()=>expect(calls.some(c=>c.path.includes('trackedOnly=true')&&c.path.includes('search=catalyst')&&c.path.includes('from=2026-04-01')&&c.path.includes('to=2026-04-02'))).toBe(true));
});
it('shows saved inputs, source links and clear previous/current comparisons',async()=>{const user=userEvent.setup();mount();await user.click(await screen.findByRole('button',{name:/TEST · 2026-04-02/}));await screen.findByText('Original thesis 2');expect(screen.getByRole('link',{name:'Official saved source'})).toHaveAttribute('href','https://www.sec.gov/Archives/test-only');expect(screen.getByText(/95 USD · 2026-03-30/)).toBeInTheDocument();
  await user.click(screen.getByRole('combobox',{name:'Previous research version'}));await user.click(screen.getByText('v1 · 2026-04-01'));const table=await screen.findByRole('table');expect(within(table).getByRole('columnheader',{name:'Previous · v1'})).toBeInTheDocument();expect(within(table).getByRole('columnheader',{name:'Current · v2'})).toBeInTheDocument();expect(within(table).getByText('Original thesis 1')).toBeInTheDocument();expect(calls.every(c=>!c.body)).toBe(true);
});
it('saves manual revisions explicitly with a version check instead of overwriting',async()=>{const user=userEvent.setup();mount();await user.click(await screen.findByRole('button',{name:/TEST · 2026-04-02/}));await screen.findByText('Original thesis 2');await user.click(screen.getByRole('button',{name:'Create Note Revision'}));fireEvent.change(screen.getByRole('textbox',{name:'Research note content'}),{target:{value:'Revised personal thesis'}});await user.click(screen.getByRole('button',{name:'Save New Version'}));await waitFor(()=>expect(calls.filter(c=>c.body)).toHaveLength(1));expect(calls.find(c=>c.body)?.body).toMatchObject({content:'Revised personal thesis',seriesId:'series-only',expectedVersion:2});
});
