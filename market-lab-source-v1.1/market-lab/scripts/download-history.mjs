import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {CATALOG} from '../lib/catalog.mjs';
const dir=path.resolve(fileURLToPath(new URL('../data/history/',import.meta.url)));
await mkdir(dir,{recursive:true});
const manifest={provider:'Yahoo Finance',requestedFrom:'2006-01-01',requestedTo:'2025-12-31',downloadedAt:new Date().toISOString(),adjustment:'OHLC multiplied by adjclose/close (dividend and split adjusted); no extra dividend credit',assets:[],errors:[]};
for(const a of CATALOG.filter(x=>x.ticker)){
 const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(a.ticker)}?period1=1136073600&period2=1767225600&interval=1d`;
 try{
  let data;
  try { data=JSON.parse(await readFile(path.join(dir,a.id+'.json'),'utf8')); } catch {}
  if(!data || process.argv.includes('--refresh')){
   let response;
   for(let retry=0;retry<3;retry++){
    response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(30000)});
    if(response.ok) break;
    if(retry<2) await new Promise(r=>setTimeout(r,1500*(retry+1)));
   }
   if(!response.ok) throw new Error(`HTTP ${response.status}`);
   const json=await response.json(); const r=json.chart?.result?.[0];
   if(!r?.timestamp) throw new Error('no daily bars');
   const q=r.indicators.quote[0],adj=r.indicators.adjclose?.[0]?.adjclose;
   const rows=r.timestamp.map((t,i)=>{
    const factor=adj?.[i]&&q.close[i]?adj[i]/q.close[i]:1;
    const values=[q.open[i],q.high[i],q.low[i],q.close[i]];
    if(values.some(x=>!Number.isFinite(x)||x<=0))return null;
    return [new Date(t*1000).toISOString().slice(0,10),...values.map(v=>+(v*factor).toFixed(6)),q.volume[i]||0];
   }).filter(Boolean).filter(row=>row[0]>='2006-01-01'&&row[0]<='2025-12-31');
   if(rows.length<30)throw new Error('insufficient history');
   const unique=[...new Map(rows.map(x=>[x[0],x])).values()].sort((a,b)=>a[0].localeCompare(b[0]));
   data={id:a.id,ticker:a.ticker,source:url,provider:'Yahoo Finance',downloadedAt:manifest.downloadedAt,adjustment:manifest.adjustment,rows:unique};
   await writeFile(path.join(dir,a.id+'.json'),JSON.stringify(data));
  }
  // Reject inconsistent OHLC instead of manufacturing high/low values that could
  // wrongly trigger an order. Keep an audit list of omitted source dates.
  const rejected=data.rows.filter(r=>r[2]+0.00001<Math.max(r[1],r[4])||r[3]-0.00001>Math.min(r[1],r[4]));
  if(rejected.length){
   const excluded=new Set(rejected.map(r=>r[0]));
   data.rows=data.rows.filter(r=>!excluded.has(r[0]));
   data.excludedRows=[...(data.excludedRows||[]),...rejected.map(r=>({date:r[0],reason:'OHLC_INCONSISTENT'}))];
   await writeFile(path.join(dir,a.id+'.json'),JSON.stringify(data));
  }
  manifest.assets.push({id:a.id,name:a.name,from:data.rows[0][0],to:data.rows.at(-1)[0],count:data.rows.length,excludedCount:data.excludedRows?.length||0,source:data.source});
  console.log(`${a.id}: ${data.rows.length} days (${data.rows[0][0]} -> ${data.rows.at(-1)[0]})`);
 }catch(e){ manifest.errors.push({id:a.id,error:e.message});console.error(`${a.id}: ${e.message}`); }
}
await writeFile(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(`History ready: ${manifest.assets.length} assets; ${manifest.errors.length} unavailable.`);
if(!manifest.assets.length)process.exitCode=1;
