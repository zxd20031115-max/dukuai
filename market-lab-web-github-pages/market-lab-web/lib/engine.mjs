import {CATALOG,ASSETS,FEE,SLIPPAGE,MAINTENANCE,maintenanceFor} from './catalog.mjs';
const randomUUID=()=>globalThis.crypto.randomUUID();
export const money=x=>Math.round((x+Number.EPSILON)*100)/100;
const finite=(x,min,max,label)=>{x=Number(x);if(!Number.isFinite(x)||x<min||x>max)throw Error(`${label}必须在 ${min} 到 ${max} 之间`);return x;};
export function rng(s){s.seed=(Math.imul(1664525,s.seed)+1013904223)>>>0;return s.seed/4294967296;}
export function fresh(book={},mode=Object.keys(book).length?'history':'synthetic',date='2016-01-04',initial=1000000){
 const s={version:2,mode,date,cash:initial,deposits:initial,initial,seed:42,ticks:0,playing:false,speed:1,positions:[],orders:[],trades:[],ledger:[],watchlist:['AAPL','NVDA','SPY','EURUSD','BTC','GLD'],equityHistory:[],prices:{},synthetic:{}};
 for(const a of CATALOG){let p=a.seed,bars=[];for(let i=0;i<150;i++){const o=p;p*=1+(rng(s)-0.48)*(a.group==='外汇'?0.006:0.025);bars.push([`S${i+1}`,o,Math.max(o,p)*1.004,Math.min(o,p)*0.996,p,Math.floor(rng(s)*1000000)]);}s.synthetic[a.id]=bars;s.prices[a.id]=p;}
 if(mode==='history'){const dates=calendar(book);s.date=dates.find(x=>x>=date)||dates.at(-1)||date;}
 record(s,'开户',initial,'初始虚拟资金');return s;
}
// Upgrade without resetting balances, trades, replay progress or legacy liquidation rules.
export function upgradeState(s){
 s.synthetic??={};s.prices??={};
 for(const a of CATALOG){if(s.synthetic[a.id]?.length)continue;
  const local={seed:[...a.id].reduce((h,c)=>(Math.imul(h,31)+c.charCodeAt(0))>>>0,42)};
  let p=a.seed;const bars=[];
  for(let i=0;i<150;i++){const o=p;p*=1+(rng(local)-0.48)*(a.group==='外汇'?0.006:0.025);bars.push([`S${i+1+(s.ticks||0)}`,o,Math.max(o,p)*1.004,Math.min(o,p)*0.996,p,Math.floor(rng(local)*1000000)]);}
  s.synthetic[a.id]=bars;s.prices[a.id]=p;
 }
 for(const p of s.positions)p.maintenanceRate??=MAINTENANCE;
 for(const o of s.orders)o.maintenanceRate??=MAINTENANCE;
 s.version=2;return s;
}
export function calendar(book){return [...new Set(Object.values(book).flatMap(a=>a.rows.map(r=>r[0])))].sort();}
// Binary search also ensures future bars never leave the server in chart responses.
export function indexAt(rows,date){let l=0,r=rows.length-1,result=-1;while(l<=r){const m=(l+r)>>1;if(rows[m][0]<=date){result=m;l=m+1;}else r=m-1;}return result;}
export function quote(s,id,book){const a=ASSETS[id];if(!a)return null;
 let bars,index;
 if(s.mode==='history'){bars=book[id]?.rows||[];index=indexAt(bars,s.date);}else{bars=s.synthetic[id];index=bars.length-1;}
 if(index<0)return {...a,price:null,available:false,change:0,bars:[],coverage:book[id]?{from:book[id].rows[0][0],to:book[id].rows.at(-1)[0],count:book[id].rows.length}:null,reason:!book[id]?'无历史数据':'尚未上市 / 暂无数据'};
 const b=bars[index],prev=bars[index-1]?.[4]||b[1];
 return {...a,price:b[4],change:(b[4]/prev-1)*100,bar:b,bars:bars.slice(Math.max(0,index-239),index+1),available:s.mode!=='history'||b[0]===s.date,reason:b[0]!==s.date&&s.mode==='history'?'非交易日':'',index,coverage:book[id]?{from:book[id].rows[0][0],to:book[id].rows.at(-1)[0],count:book[id].rows.length}:null};
}
export function pnl(p,price){return money((price-p.entry)*p.qty*p.fx*(p.side==='long'?1:-1));}
export function liquidation(p){const delta=(p.margin-(p.maintenanceRate??MAINTENANCE)*p.notional)/(p.qty*p.fx);return Math.max(0,p.entry+(p.side==='long'?-delta:delta));}
export function summary(s,book){let unrealized=0,margin=0,exposure=0;
 for(const p of s.positions){const q=quote(s,p.asset,book);unrealized+=pnl(p,q.price);margin+=p.margin;exposure+=p.qty*q.price*p.fx;}
 const reserved=s.orders.filter(o=>o.status==='pending').reduce((n,o)=>n+o.reserve,0);
 const equity=money(s.cash+reserved+margin+unrealized),fees=money(s.trades.reduce((v,t)=>v+t.fee,0));
 return {cash:money(s.cash),reserved:money(reserved),margin:money(margin),unrealized:money(unrealized),equity,exposure:money(exposure),netPnl:money(equity-s.deposits),returnPct:s.deposits?(equity/s.deposits-1)*100:0,fees,leverage:equity>0?exposure/equity:0};
}
function record(s,type,amount,note){s.ledger.unshift({id:randomUUID(),type,amount:money(amount),note,date:s.mode==='history'?s.date:`模拟第 ${s.ticks} 步`,time:new Date().toISOString()});}
function trade(s,p,action,price,fee,profit=0,reason=''){s.trades.unshift({id:randomUUID(),positionId:p.id,asset:p.asset,side:p.side,qty:p.qty,leverage:p.leverage,action,price,fee:money(fee),pnl:money(profit),date:s.mode==='history'?s.date:`S${s.ticks}`,time:new Date().toISOString(),reason});}
export function submit(s,body,book){
 const a=ASSETS[body.asset];if(!a)throw Error('请选择有效品种');const q=quote(s,a.id,book);if(!q.available)throw Error(q.reason||'该品种当前不可交易');
 if(!['long','short'].includes(body.side))throw Error('无效交易方向');
 if(!['market','limit','stop'].includes(body.type))throw Error('无效委托类型');
 if(a.group==='基金'&&(body.side!=='long'||body.type!=='market'))throw Error('普通模拟基金只支持 1 倍申购');
 const leverage=finite(body.leverage,1,a.maxLeverage,'杠杆');if(!Number.isInteger(leverage))throw Error('杠杆必须为整数');
 const margin=money(finite(body.margin,10,100000000,'保证金'));
 const trigger=body.type==='market'?q.price:finite(body.price,0.000001,1e9,'委托价');
 const sl=body.sl?finite(body.sl,0.000001,1e9,'止损价'):null,tp=body.tp?finite(body.tp,0.000001,1e9,'止盈价'):null;
 if(body.side==='long'&&((sl&&sl>=trigger)||(tp&&tp<=trigger))||body.side==='short'&&((sl&&sl<=trigger)||(tp&&tp>=trigger)))throw Error('止盈止损方向不正确，请以预计开仓价为基准');
 const notional=margin*leverage,fee=money(notional*FEE),reserve=money(margin+fee);
 if(reserve>s.cash)throw Error('可用资金不足（需包含开仓手续费）');
 if(s.orders.filter(o=>o.status==='pending').length>=100||s.positions.length>=100)throw Error('最多同时保留 100 笔委托或持仓');
 const o={id:randomUUID(),asset:a.id,side:body.side,type:body.type,leverage,margin,notional,maintenanceRate:maintenanceFor(leverage),trigger,sl,tp,reserve,status:'pending',created:s.date,createdTick:s.ticks};
 s.cash=money(s.cash-reserve);s.orders.unshift(o);
 if(s.mode==='synthetic'&&o.type==='market'&&a.group!=='基金')fill(s,o,q.price);
 return o;
}
function fill(s,o,raw){
 const a=ASSETS[o.asset];let entry=raw*(1+(o.side==='long'?1:-1)*SLIPPAGE);
 if(o.type==='limit')entry=o.side==='long'?Math.min(entry,o.trigger):Math.max(entry,o.trigger);
 const qty=o.notional/(entry*a.fx),p={id:randomUUID(),asset:o.asset,side:o.side,qty,fx:a.fx,entry,margin:o.margin,notional:o.notional,leverage:o.leverage,sl:o.sl,tp:o.tp,opened:s.date,openedTick:s.ticks,fee:money(o.notional*FEE)};
 p.maintenanceRate=o.maintenanceRate??MAINTENANCE;
 s.positions.push(p);o.status='filled';o.filledPrice=entry;o.filled=s.date;o.positionId=p.id;
 record(s,'开仓手续费',-p.fee,a.name);trade(s,p,'开仓',entry,p.fee);
}
export function cancel(s,id){const o=s.orders.find(o=>o.id===id&&o.status==='pending');if(!o)throw Error('委托不存在或已成交');s.cash=money(s.cash+o.reserve);o.status='cancelled';}
export function close(s,id,book){const p=s.positions.find(p=>p.id===id);if(!p)throw Error('持仓不存在');
 const q=quote(s,p.asset,book);if(!q.available)throw Error(q.reason||'该品种当前不可交易');
 if(s.mode==='history'||ASSETS[p.asset].group==='基金'){p.closing=true;return;}
 exitPosition(s,p,q.price,'手动平仓');
}
export function exitPosition(s,p,raw,reason){
 const price=raw*(1+(p.side==='long'?-1:1)*SLIPPAGE),profit=pnl(p,price),exitFee=money(p.qty*price*p.fx*FEE);
 // Isolated margin: losses including closing fee cannot consume other positions' collateral.
 const returned=money(Math.max(0,p.margin+profit-exitFee));const actualPnl=money(returned-p.margin);
 s.cash=money(s.cash+returned);s.positions=s.positions.filter(x=>x.id!==p.id);
 trade(s,p,'平仓',price,exitFee,actualPnl-p.fee,reason);record(s,reason,actualPnl,ASSETS[p.asset].name);
}
export function protection(s,id,body,book){const p=s.positions.find(x=>x.id===id);if(!p)throw Error('持仓不存在');
 const price=quote(s,p.asset,book).price;const sl=body.sl?finite(body.sl,0.000001,1e9,'止损价'):null,tp=body.tp?finite(body.tp,0.000001,1e9,'止盈价'):null;
 if(p.side==='long'&&((sl&&sl>=price)||(tp&&tp<=price))||p.side==='short'&&((sl&&sl<=price)||(tp&&tp>=price)))throw Error('止盈止损必须位于当前价两侧');p.sl=sl;p.tp=tp;
}
function protections(s,p,b){const [,o,h,l]=b,long=p.side==='long',liq=liquidation(p);
 // Conservative daily-bar convention: liquidation before stop loss, then take profit.
 if((long&&l<=liq)||(!long&&h>=liq)){exitPosition(s,p,long?Math.min(o,liq):Math.max(o,liq),'保证金强平');return;}
 if(p.sl&&((long&&l<=p.sl)||(!long&&h>=p.sl))){exitPosition(s,p,long?Math.min(o,p.sl):Math.max(o,p.sl),'止损平仓');return;}
 if(p.tp&&((long&&h>=p.tp)||(!long&&l<=p.tp))){exitPosition(s,p,long?Math.max(o,p.tp):Math.min(o,p.tp),'止盈平仓');}
}
export function advance(s,book,dates=calendar(book),shock=0){
 if(s.mode==='history'){const next=dates.find(d=>d>s.date);if(!next){s.playing=false;return false;}s.date=next;}
 s.ticks++;
 if(s.mode==='synthetic')for(const a of CATALOG){
  if(a.group==='基金'&&s.ticks%20!==0)continue;
  const bars=s.synthetic[a.id],o=bars.at(-1)[4],vol=a.group==='外汇'?0.003:a.group==='基金'?0.005:0.018;
  const c=Math.max(0.00001,o*(1+(rng(s)-0.48)*vol+shock));
  const wick=shock?0:rng(s)*vol/3;
  bars.push([`S${150+s.ticks}`,o,Math.max(o,c)*(1+wick),Math.min(o,c)*(1-wick),c,Math.floor(50000+rng(s)*900000)]);if(bars.length>300)bars.shift();s.prices[a.id]=c;
 }
 // Manual exits execute at the next available bar's open (fund NAV uses close).
 for(const p of [...s.positions]){const q=quote(s,p.asset,book);if(!q.available)continue;if(ASSETS[p.asset].group==='基金'&&s.ticks%20!==0)continue;if(p.closing)exitPosition(s,p,s.mode==='history'?q.bar[1]:q.price,'手动平仓');}
 for(const o of s.orders.filter(o=>o.status==='pending')){const q=quote(s,o.asset,book);if(!q.available)continue;if(ASSETS[o.asset].group==='基金'&&s.ticks%20!==0)continue;
  const [,open,high,low]=q.bar;let price=null;
  if(o.type==='market')price=s.mode==='history'?open:q.price;
  if(o.type==='limit'&&((o.side==='long'&&low<=o.trigger)||(o.side==='short'&&high>=o.trigger)))price=o.side==='long'?Math.min(open,o.trigger):Math.max(open,o.trigger);
  if(o.type==='stop'&&((o.side==='long'&&high>=o.trigger)||(o.side==='short'&&low<=o.trigger)))price=o.side==='long'?Math.max(open,o.trigger):Math.min(open,o.trigger);
  if(price!==null)fill(s,o,price);
 }
 for(const p of [...s.positions]){const q=quote(s,p.asset,book);if(q.available)protections(s,p,q.bar);}
 const snap=summary(s,book);s.equityHistory.push({date:s.mode==='history'?s.date:`S${s.ticks}`,equity:snap.equity,deposits:s.deposits});if(s.equityHistory.length>2000)s.equityHistory.shift();
 return true;
}
export function deposit(s,value){const amount=money(finite(value,100,10000000,'充值金额'));s.cash=money(s.cash+amount);s.deposits=money(s.deposits+amount);record(s,'虚拟充值',amount,'训练资金');}
export function publicState(s,book){return {rules:{fee:FEE,slippage:SLIPPAGE,maintenanceBase:MAINTENANCE,maintenanceMarginCap:0.25},mode:s.mode,date:s.date,ticks:s.ticks,playing:s.playing,speed:s.speed,watchlist:s.watchlist,summary:summary(s,book),positions:s.positions.map(p=>({...p,current:quote(s,p.asset,book).price,pnl:pnl(p,quote(s,p.asset,book).price),liquidation:liquidation(p)})),orders:s.orders.slice(0,500),trades:s.trades.slice(0,500),ledger:s.ledger.slice(0,100),equityHistory:s.equityHistory,markets:CATALOG.map(a=>{const q=quote(s,a.id,book);const {bars,...rest}=q;return {...rest,spark:bars.slice(-24).map(b=>b[4])};})};}
