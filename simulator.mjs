import {CATALOG} from './lib/catalog.mjs';
import {fresh,calendar,quote,submit,cancel,close,protection,advance,deposit,publicState} from './lib/engine.mjs';
const user={username:'浏览器试玩账户',demo:false};
const speedValid=v=>[1,2,5,10].includes(v);
export class BrowserSimulator {
 constructor(book,repository,now=()=>Date.now()){this.book=book;this.repo=repository;this.dates=calendar(book);this.now=now;}
 async initialize(){await this.repo.mutate(s=>({state:s||fresh(this.book),result:null}));}
 async request(route,body){
  const url=new URL(route,'https://local.invalid/'),name=url.pathname.replace(/^\//,'');
  if(['state','chart','sources','export','trades.csv'].includes(name)){
   const s=await this.repo.read();if(!s)throw Error('浏览器存档尚未就绪');
   if(name==='state')return {user,...publicState(s,this.book),history:{count:Object.keys(this.book).length,from:this.dates[0],to:this.dates.at(-1)}};
   if(name==='chart'){const q=quote(s,url.searchParams.get('asset'),this.book);if(!q)throw Error('品种不存在');return q;}
   if(name==='sources')return {assets:Object.values(this.book).map(x=>({id:x.id,source:x.source,provider:x.provider,from:x.rows[0][0],to:x.rows.at(-1)[0],count:x.rows.length,excludedCount:x.excludedRows?.length||0,adjustment:x.adjustment,downloadedAt:x.downloadedAt}))};
   if(name==='export')return {format:'market-lab-browser-v1',exportedAt:new Date(this.now()).toISOString(),user,state:s};
   const keys=['date','asset','action','side','leverage','qty','price','fee','pnl','reason'],escape=x=>'"'+String(x??'').replaceAll('"','""')+'"';
   return '\uFEFF'+[keys.join(','),...s.trades.map(t=>keys.map(k=>escape(t[k])).join(','))].join('\r\n');
  }
  return this.repo.mutate(s=>{
   const b=body||{};let result;
   if(name==='order')result=submit(s,b,this.book);
   else if(name==='cancel')cancel(s,b.id);
   else if(name==='close')close(s,b.id,this.book);
   else if(name==='protection')protection(s,b.id,b,this.book);
   else if(name==='deposit')deposit(s,b.amount);
   else if(name==='watch'){if(!CATALOG.some(a=>a.id===b.asset))throw Error('品种不存在');s.watchlist=s.watchlist.includes(b.asset)?s.watchlist.filter(x=>x!==b.asset):[...s.watchlist,b.asset];}
   else if(name==='play'){if(b.speed!==undefined&&!speedValid(b.speed))throw Error('无效回放速度');s.playing=!!b.playing;if(b.speed!==undefined)s.speed=b.speed;s.lastBeat=this.now();}
   else if(name==='step'){const count=Number(b.count||1);if(!Number.isInteger(count)||count<1||count>30)throw Error('推进步数必须为 1–30');for(let i=0;i<count;i++)if(!advance(s,this.book,this.dates))break;s.lastBeat=this.now();}
   else if(name==='tick'){
    if(s.playing&&this.now()-(s.lastBeat||0)>=3000){for(let i=0;i<s.speed;i++)if(!advance(s,this.book,this.dates))break;s.lastBeat=this.now();}
   }
   else if(name==='shock'){if(s.mode!=='synthetic')throw Error('压力测试仅在合成模拟中可用');if(![-0.1,-0.05,0.05,0.1].includes(b.shock))throw Error('无效波动幅度');advance(s,this.book,this.dates,b.shock);}
   else if(name==='reset'){
    if(b.confirm!=='RESET')throw Error('请确认重置');if(!['history','synthetic'].includes(b.mode))throw Error('无效模式');
    const initial=Number(b.initial);if(!Number.isFinite(initial)||initial<1000||initial>100000000)throw Error('初始资金需在 1,000–100,000,000 之间');
    if(b.mode==='history'&&(!this.dates.length||!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||b.date<this.dates[0]||b.date>this.dates.at(-1)))throw Error('回放日期超出数据范围');
    s=fresh(this.book,b.mode,b.date,initial);
   }else throw Error('不支持的操作');
   return {state:s,result:{ok:true,result}};
  });
 }
}
