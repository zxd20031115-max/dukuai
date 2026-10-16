import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fresh,upgradeState,quote,submit,cancel,close,advance,summary,pnl,deposit,protection,liquidation} from '../lib/engine.mjs';
import {CATALOG,ASSETS,maintenanceFor} from '../lib/catalog.mjs';
const book={AAPL:{rows:[['2020-01-02',100,101,99,100,1000],['2020-01-03',110,112,109,111,1000],['2020-01-06',105,108,104,106,1000]]}};
const order=(overrides={})=>({asset:'AAPL',side:'long',type:'market',leverage:1,margin:10000,...overrides});
test('Historical chart never includes future bars',()=>{const s=fresh(book,'history','2020-01-02');assert.equal(quote(s,'AAPL',book).bars.length,1);assert.equal(quote(s,'AAPL',book).price,100);});
test('Not-yet-listed assets retain accurate coverage while hiding future prices',()=>{const b={...book,ETH:{rows:[['2022-01-03',200,210,190,205,1]]}};const s=fresh(b,'history','2020-01-02');const q=quote(s,'ETH',b);assert.equal(q.available,false);assert.equal(q.price,null);assert.deepEqual(q.bars,[]);assert.equal(q.coverage.from,'2022-01-03');});
test('Historical market order freezes margin and fills on next open, including slippage',()=>{const s=fresh(book,'history','2020-01-02');submit(s,order(),book);assert.equal(s.positions.length,0);assert.equal(s.cash,989997);assert.equal(summary(s,book).equity,1000000);advance(s,book);assert.equal(s.positions.length,1);assert.equal(s.positions[0].entry,110*1.00015);assert.equal(s.orders[0].status,'filled');});
test('Cancel releases reserved margin and opening fee exactly once',()=>{const s=fresh(book,'history','2020-01-02');const o=submit(s,order(),book);cancel(s,o.id);assert.equal(s.cash,1000000);assert.throws(()=>cancel(s,o.id));});
test('Reject unavailable symbols, invalid numeric values and wrong direction protections',()=>{const s=fresh(book,'history','2020-01-02');for(const override of [{margin:'NaN'},{margin:-1},{leverage:100},{leverage:1.5},{side:'hack'},{type:'bad'},{tp:90},{sl:110},{asset:'ETH'}])assert.throws(()=>submit(s,order(override),book));assert.equal(s.cash,1000000);});
test('Cannot overspend available funds, including commission',()=>{const s=fresh(book,'history','2020-01-02');assert.throws(()=>submit(s,order({margin:1000000}),book));assert.equal(s.cash,1000000);});
test('Buy limit receives opening gap price improvement and never exceeds its limit',()=>{const s=fresh(book,'history','2020-01-02');submit(s,order({type:'limit',price:115}),book);advance(s,book);assert.ok(s.positions[0].entry<115);assert.ok(s.positions[0].entry>=110);});
test('Unreached limit remains pending across days',()=>{const s=fresh(book,'history','2020-01-02');submit(s,order({type:'limit',price:90}),book);advance(s,book);assert.equal(s.orders[0].status,'pending');assert.equal(s.positions.length,0);});
test('Stop entry accounts for adverse opening gap',()=>{const s=fresh(book,'history','2020-01-02');submit(s,order({type:'stop',price:105}),book);advance(s,book);assert.equal(s.positions[0].entry,110*1.00015);});
test('Manual historical close waits for next available open',()=>{const s=fresh(book,'history','2020-01-02');submit(s,order(),book);advance(s,book);const p=s.positions[0];close(s,p.id,book);assert.equal(s.positions.length,1);assert.equal(s.positions[0].closing,true);advance(s,book);assert.equal(s.positions.length,0);assert.equal(s.trades[0].price,105*.99985);assert.equal(s.trades[0].reason,'手动平仓');assert.equal(s.cash,1000000+s.trades[0].pnl);});
test('Long and short P&L are symmetric before fees',()=>{const p={entry:100,qty:10,fx:7.2,side:'long'};assert.equal(pnl(p,110),720);assert.equal(pnl({...p,side:'short'},110),-720);});
test('Isolated liquidation caps collateral loss and preserves unrelated cash',()=>{const s=fresh({},'synthetic');submit(s,{asset:'EURUSD',side:'long',type:'market',margin:10000,leverage:100},{});const remaining=s.cash;advance(s,{},[], -.1);assert.equal(s.positions.length,0);assert.ok(s.cash>=remaining);assert.equal(s.trades[0].reason,'保证金强平');assert.ok(s.trades[0].pnl>=-10300);});
test('Intrabar stop loss executes when crossed',()=>{const b={AAPL:{rows:[['2020-01-02',100,101,99,100,1],['2020-01-03',100,103,95,101,1]]}};const s=fresh(b,'history','2020-01-02');submit(s,order({sl:97}),b);advance(s,b);assert.equal(s.positions.length,0);assert.equal(s.trades[0].reason,'止损平仓');assert.equal(s.trades[0].price,97*.99985);});
test('Stop loss wins when stop and take profit share one candle',()=>{const b={AAPL:{rows:[['2020-01-02',100,101,99,100,1],['2020-01-03',100,110,90,101,1]]}};const s=fresh(b,'history','2020-01-02');submit(s,order({sl:95,tp:105}),b);advance(s,b);assert.equal(s.trades[0].reason,'止损平仓');});
test('Synthetic mutual funds wait for valuation and reject leverage or shorts',()=>{const s=fresh({},'synthetic');assert.throws(()=>submit(s,{...order(),asset:'FUND300',leverage:2},{}));assert.throws(()=>submit(s,{...order(),asset:'FUND300',side:'short'},{}));submit(s,{...order(),asset:'FUND300'},{});for(let i=0;i<19;i++)advance(s,{},[]);assert.equal(s.positions.length,0);advance(s,{},[]);assert.equal(s.positions.length,1);close(s,s.positions[0].id,{});assert.equal(s.positions.length,1);for(let i=0;i<20;i++)advance(s,{},[]);assert.equal(s.positions.length,0);});
test('Deposits do not count as investment profit',()=>{const s=fresh({},'synthetic');deposit(s,50000);assert.equal(summary(s,{}).equity,1050000);assert.equal(summary(s,{}).netPnl,0);assert.equal(summary(s,{}).returnPct,0);});
test('Protection validation uses current price; clearing removes stops',()=>{const s=fresh({},'synthetic');submit(s,order(),{});const p=s.positions[0],q=quote(s,'AAPL',{});assert.throws(()=>protection(s,p.id,{sl:q.price*2},{}));protection(s,p.id,{sl:q.price*.9,tp:q.price*1.1},{});assert.ok(p.sl);protection(s,p.id,{sl:'',tp:''},{});assert.equal(p.sl,null);assert.equal(p.tp,null);});
test('Replay end pauses instead of inventing future prices',()=>{const s=fresh(book,'history','2020-01-06');s.playing=true;assert.equal(advance(s,book),false);assert.equal(s.playing,false);assert.equal(s.date,'2020-01-06');});
test('Missing trading days do not fill stale orders',()=>{const b={...book,SPY:{rows:[['2020-01-02',1,1,1,1,1],['2020-01-04',1,1,1,1,1]]}};const s=fresh(b,'history','2020-01-03');submit(s,order(),b);advance(s,b);assert.equal(s.date,'2020-01-04');assert.equal(s.positions.length,0);assert.equal(quote(s,'AAPL',b).available,false);advance(s,b);assert.equal(s.positions.length,1);});
test('Equity is cash + reserved + collateral + unrealized P&L',()=>{const s=fresh({},'synthetic');submit(s,order({leverage:3}),{});submit(s,order({type:'limit',price:1}),{});const n=summary(s,{});assert.equal(n.equity,Math.round((n.cash+n.reserved+n.margin+n.unrealized)*100)/100);assert.ok(liquidation(s.positions[0])<s.positions[0].entry);});
test('Expanded catalog has unique symbols, 18 FX pairs and category-specific limits',()=>{
 assert.equal(CATALOG.length,53);assert.equal(new Set(CATALOG.map(a=>a.id)).size,53);
 assert.equal(CATALOG.filter(a=>a.group==='外汇').length,18);
 assert.equal(ASSETS.EURGBP.maxLeverage,500);assert.equal(ASSETS.AAPL.maxLeverage,20);
 assert.equal(ASSETS.BTC.maxLeverage,100);assert.equal(ASSETS.SPY.maxLeverage,10);
 assert.equal(ASSETS.GLD.maxLeverage,50);assert.equal(ASSETS.FUND300.maxLeverage,1);
 for(const a of CATALOG)assert.ok(Number.isFinite(a.fx)&&a.fx>0);
});
test('500x long and short survive a flat bar, and freeze the correct opening fee',()=>{
 const b={EURGBP:{rows:[['2020-01-02',1,1,1,1,0],['2020-01-03',1,1,1,1,0]]}};
 for(const side of ['long','short']){
  const s=fresh(b,'history','2020-01-02');const o=submit(s,order({asset:'EURGBP',side,leverage:500}),b);
  assert.equal(o.reserve,11500);assert.equal(s.cash,988500);assert.equal(o.maintenanceRate,.0005);
  advance(s,b);assert.equal(s.positions.length,1);const p=s.positions[0];
  assert.equal(p.fx,9.1);assert.ok(Math.abs(p.qty*p.entry*p.fx-5000000)<1e-6);
  assert.ok(side==='long'?liquidation(p)<p.entry:liquidation(p)>p.entry);
 }
});
test('500x positions liquidate in the adverse direction without consuming other cash',()=>{
 for(const side of ['long','short']){
  const b={EURGBP:{rows:[['2020-01-02',1,1,1,1,0],['2020-01-03',1,1,1,1,0],['2020-01-06',1,side==='short'?1.01:1,side==='long'?.99:1,1,0]]}};
  const s=fresh(b,'history','2020-01-02');submit(s,order({asset:'EURGBP',side,leverage:500}),b);const remaining=s.cash;
  advance(s,b);advance(s,b);assert.equal(s.positions.length,0);assert.equal(s.trades[0].reason,'保证金强平');assert.ok(s.cash>=remaining);
 }
});
test('Leverage limits reject 501x, fractional values, and cross-category excess',()=>{
 const s=fresh({},'synthetic');for(const [asset,leverage] of [['EURGBP',501],['EURUSD',500.5],['AAPL',21],['BTC',101],['SPY',11],['FUND300',2]])assert.throws(()=>submit(s,order({asset,leverage}),{}));assert.equal(s.cash,1000000);
 assert.equal(maintenanceFor(500),.0005);assert.equal(maintenanceFor(100),.0025);assert.equal(maintenanceFor(20),.005);
});
test('v1 migration adds instruments, preserves account data and old liquidation rates, and is idempotent',()=>{
 const s=fresh({},'synthetic');submit(s,order({asset:'EURUSD',leverage:100}),{});submit(s,order({asset:'EURUSD',type:'limit',price:.1,leverage:100}),{});
 delete s.synthetic.EURGBP;delete s.prices.EURGBP;s.version=1;
 delete s.positions[0].maintenanceRate;delete s.orders[0].maintenanceRate;
 const before=structuredClone(s),oldLiq=liquidation(s.positions[0]);upgradeState(s);
 for(const key of ['cash','deposits','initial','seed','ticks','date','watchlist','trades','ledger','equityHistory'])assert.deepEqual(s[key],before[key]);
 assert.deepEqual(s.synthetic.AAPL,before.synthetic.AAPL);assert.equal(liquidation(s.positions[0]),oldLiq);
 assert.equal(s.positions[0].maintenanceRate,.005);assert.equal(s.orders[0].maintenanceRate,.005);
 assert.equal(quote(s,'EURGBP',{}).available,true);assert.equal(s.version,2);
 const serialized=JSON.stringify(s);upgradeState(s);assert.equal(JSON.stringify(s),serialized);
 advance(s,{},[]);assert.ok(quote(s,'EURGBP',{}).price>0);
});
test('An existing 100x pending order keeps its original maintenance rule when filled',()=>{
 const b={EURUSD:{rows:[['2020-01-02',1,1,1,1,0],['2020-01-03',1,1,1,1,0]]}};
 const s=fresh(b,'history','2020-01-02');const o=submit(s,order({asset:'EURUSD',leverage:100}),b);delete o.maintenanceRate;s.version=1;upgradeState(s);advance(s,b);assert.equal(s.positions[0].maintenanceRate,.005);
});
