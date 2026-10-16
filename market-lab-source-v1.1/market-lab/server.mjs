import http from 'node:http';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {CATALOG} from './lib/catalog.mjs';
import {fresh,upgradeState,calendar,quote,submit,cancel,close,protection,advance,deposit,publicState} from './lib/engine.mjs';
const ROOT=path.dirname(fileURLToPath(import.meta.url)),PORT=Number(process.env.PORT||4311);
const DATA=process.env.MARKET_LAB_DATA||path.join(ROOT,'data');mkdirSync(DATA,{recursive:true});
const book={};for(const a of CATALOG){const f=path.join(ROOT,'data/history',a.id+'.json');if(existsSync(f))book[a.id]=JSON.parse(readFileSync(f,'utf8'));}
const dates=calendar(book),preview=fresh(book);
const db=new DatabaseSync(path.join(DATA,'accounts.sqlite'));db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password TEXT NOT NULL, demo INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS session_user ON sessions(user_id);`);
const migrationUsers=db.prepare('SELECT id,state FROM users').all().filter(u=>JSON.parse(u.state).version<2);
if(migrationUsers.length){
 const backup=path.join(DATA,`accounts-before-v2-${Date.now()}.sqlite`);
 db.exec(`VACUUM INTO '${backup.replaceAll("'","''")}'`);
 db.exec('BEGIN IMMEDIATE');
 try{for(const u of migrationUsers)db.prepare('UPDATE users SET state=? WHERE id=?').run(JSON.stringify(upgradeState(JSON.parse(u.state))),u.id);db.exec('COMMIT');}
 catch(e){db.exec('ROLLBACK');throw e;}
}
const hash=x=>createHash('sha256').update(x).digest('hex');
const safeUser=u=>({username:u.username,demo:!!u.demo});
const origins=new Set([`http://127.0.0.1:${PORT}`,`http://localhost:${PORT}`,`http://[::1]:${PORT}`]);
const attempts=new Map();
function session(req){const token=/(?:^|;\s*)ml_session=([^;]+)/.exec(req.headers.cookie||'')?.[1];if(!token)return null;return db.prepare('SELECT u.* FROM users u JOIN sessions s ON u.id=s.user_id WHERE s.token=? AND s.expires>?').get(hash(token),Date.now());}
function cookie(res,id){const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token),id,Date.now()+7*86400000);res.setHeader('Set-Cookie',`ml_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`);}
function send(res,code,data){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
async function body(req){let size=0,parts=[];for await(const c of req){size+=c.length;if(size>65536)throw Error('请求内容过大');parts.push(c);}try{const p=JSON.parse(Buffer.concat(parts).toString()||'{}');if(!p||Array.isArray(p)||typeof p!=='object')throw Error();return p;}catch{throw Error('请求格式错误');}}
function store(id,s){db.prepare('UPDATE users SET state=? WHERE id=?').run(JSON.stringify(s),id);}
function authRate(req){const key=req.socket.remoteAddress;const now=Date.now();let v=attempts.get(key);if(!v||v.until<now)v={n:0,until:now+60000};v.n++;attempts.set(key,v);if(v.n>25)throw Error('操作过于频繁，请一分钟后重试');}
const server=http.createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
 try{
  if(!origins.has(`http://${req.headers.host}`))return send(res,403,{error:'仅允许本机访问'});
  const url=new URL(req.url,`http://127.0.0.1:${PORT}`),route=url.pathname;
  if(!route.startsWith('/api/')){
   const files={'/':'index.html','/app.js':'app.js','/styles.css':'styles.css','/favicon.svg':'favicon.svg'};
   if(req.method!=='GET'||!files[route])return send(res,404,{error:'页面不存在'});
   const types={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',svg:'image/svg+xml'};
   res.setHeader('Content-Type',types[files[route].split('.').at(-1)]);res.end(readFileSync(path.join(ROOT,'public',files[route])));return;
  }
  if(!['GET','POST'].includes(req.method))return send(res,405,{error:'方法不允许'});
  if(req.method==='POST'&&(req.headers['x-market-lab']!=='1'||(req.headers.origin&&!origins.has(req.headers.origin))))return send(res,403,{error:'请求来源无效'});
  const b=req.method==='POST'?await body(req):{};
  if(route==='/api/health')return send(res,200,{ok:true,app:'market-lab',historyAssets:Object.keys(book).length});
  if(req.method==='POST'&&['/api/login','/api/register','/api/demo'].includes(route)){
   authRate(req);let u;
   if(route==='/api/demo'){
    const name='体验者_'+randomBytes(4).toString('hex');const result=db.prepare('INSERT INTO users(username,salt,password,demo,state) VALUES(?,?,?,?,?)').run(name,'','',1,JSON.stringify(fresh(book)));u=db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid);
   }else{
    const username=String(b.username||'').trim(),password=String(b.password||'');
    if(!/^[\p{L}\p{N}_-]{2,24}$/u.test(username)||password.length<8||password.length>128)throw Error('用户名为 2–24 位文字、数字或下划线；密码为 8–128 位');
    u=db.prepare('SELECT * FROM users WHERE username=?').get(username);
    if(route==='/api/register'){
     if(u)throw Error('用户名已存在');const salt=randomBytes(16).toString('hex'),passwordHash=scryptSync(password,salt,64).toString('hex');
     const result=db.prepare('INSERT INTO users(username,salt,password,state) VALUES(?,?,?,?)').run(username,salt,passwordHash,JSON.stringify(fresh(book)));u=db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid);
    }else{
     const calculated=scryptSync(password,u?.salt||'invalid-user-padding',64),expected=u?.password?Buffer.from(u.password,'hex'):Buffer.alloc(64);
     if(!timingSafeEqual(calculated,expected)||!u||u.demo)return send(res,401,{error:'用户名或密码错误'});
    }
   }
   cookie(res,u.id);return send(res,200,{user:safeUser(u)});
  }
  const u=session(req);
  if(route==='/api/state'&&req.method==='GET')return send(res,200,{user:u?safeUser(u):null,...publicState(u?JSON.parse(u.state):preview,book),history:{count:Object.keys(book).length,from:dates[0],to:dates.at(-1)}});
  if(!u)return send(res,401,{error:'请先登录本地账户'});
  const s=JSON.parse(u.state);
  if(req.method==='GET'){
   if(route==='/api/chart'){const q=quote(s,url.searchParams.get('asset'),book);if(!q)return send(res,404,{error:'品种不存在'});return send(res,200,q);}
   if(route==='/api/sources')return send(res,200,{assets:Object.values(book).map(x=>({id:x.id,source:x.source,provider:x.provider,from:x.rows[0][0],to:x.rows.at(-1)[0],count:x.rows.length,excludedCount:x.excludedRows?.length||0,adjustment:x.adjustment,downloadedAt:x.downloadedAt}))});
   if(route==='/api/export'){res.setHeader('Content-Disposition','attachment; filename="market-lab-journal.json"');return send(res,200,{exportedAt:new Date().toISOString(),user:safeUser(u),state:s});}
   if(route==='/api/trades.csv'){
    const escape=x=>'"'+String(x??'').replaceAll('"','""')+'"';const keys=['date','asset','action','side','leverage','qty','price','fee','pnl','reason'];res.setHeader('Content-Disposition','attachment; filename="market-lab-trades.csv"');res.setHeader('Content-Type','text/csv; charset=utf-8');res.end('\uFEFF'+[keys.join(','),...s.trades.map(t=>keys.map(k=>escape(t[k])).join(','))].join('\r\n'));return;
   }
   return send(res,404,{error:'接口不存在'});
  }
  let result;
  if(route==='/api/logout'){const token=/(?:^|;\s*)ml_session=([^;]+)/.exec(req.headers.cookie||'')?.[1];if(token)db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token));res.setHeader('Set-Cookie','ml_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return send(res,200,{ok:true});}
  else if(route==='/api/order')result=submit(s,b,book);
  else if(route==='/api/cancel')cancel(s,b.id);
  else if(route==='/api/close')close(s,b.id,book);
  else if(route==='/api/protection')protection(s,b.id,b,book);
  else if(route==='/api/deposit')deposit(s,b.amount);
  else if(route==='/api/watch'){if(!CATALOG.some(a=>a.id===b.asset))throw Error('品种不存在');s.watchlist=s.watchlist.includes(b.asset)?s.watchlist.filter(x=>x!==b.asset):[...s.watchlist,b.asset];}
  else if(route==='/api/play'){s.playing=!!b.playing;if(b.speed!==undefined){if(![1,2,5,10].includes(b.speed))throw Error('无效回放速度');s.speed=b.speed;}}
  else if(route==='/api/step'){const count=Number(b.count||1);if(!Number.isInteger(count)||count<1||count>30)throw Error('推进步数必须为 1–30');for(let i=0;i<count;i++)if(!advance(s,book,dates))break;}
  else if(route==='/api/shock'){if(s.mode!=='synthetic')throw Error('压力测试仅在合成模拟中可用');if(![-0.1,-0.05,0.05,0.1].includes(b.shock))throw Error('无效波动幅度');advance(s,book,dates,b.shock);}
  else if(route==='/api/reset'){
   if(b.confirm!=='RESET')throw Error('请确认重置');if(!['history','synthetic'].includes(b.mode))throw Error('无效模式');if(b.mode==='history'&&!dates.length)throw Error('没有历史数据，请先运行数据下载脚本');
   const initial=Number(b.initial);if(!Number.isFinite(initial)||initial<1000||initial>100000000)throw Error('初始资金需在 1,000–100,000,000 之间');
   if(b.mode==='history'&&(!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||b.date<dates[0]||b.date>dates.at(-1)))throw Error('回放日期超出数据范围');
   store(u.id,fresh(book,b.mode,b.date,initial));return send(res,200,{ok:true});
  }else return send(res,404,{error:'接口不存在'});
  store(u.id,s);send(res,200,{ok:true,result});
 }catch(e){send(res,400,{error:e.message||'操作失败'});}
});
let beat=0;
const timer=setInterval(()=>{
 try{
  beat++;if(beat%100===0){db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());db.exec('DELETE FROM users WHERE demo=1 AND id NOT IN (SELECT user_id FROM sessions)');}
  const users=db.prepare('SELECT DISTINCT u.id,u.state FROM users u JOIN sessions s ON u.id=s.user_id WHERE s.expires>?').all(Date.now());
  for(const u of users){const s=JSON.parse(u.state);if(s.playing){for(let i=0;i<s.speed;i++)if(!advance(s,book,dates))break;store(u.id,s);}}
 }catch(e){console.error('Replay update failed:',e.message);}
},3000);
server.listen(PORT,'127.0.0.1',()=>console.log(`MARKET LAB ready: http://127.0.0.1:${PORT} | ${Object.keys(book).length} historical assets | local accounts`));
function stop(){clearInterval(timer);server.close(()=>{db.close();process.exit(0);});}process.on('SIGINT',stop);process.on('SIGTERM',stop);
