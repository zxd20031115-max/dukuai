import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
test('Local HTTP flow: register, authentication, isolation, trading, persistence and CSRF',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'market-lab-test-'));const port=14311;
 const child=spawn(process.execPath,['server.mjs'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,PORT:String(port),MARKET_LAB_DATA:dir},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{child.kill();await new Promise(r=>child.once('exit',r));await rm(dir,{recursive:true,force:true});});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('server startup timeout')),15000);child.stdout.on('data',s=>{if(String(s).includes('ready:')){clearTimeout(timer);resolve();}});child.once('error',reject);child.once('exit',c=>{if(c)reject(Error('server failed '+c));});});
 const base=`http://127.0.0.1:${port}/api/`;
 async function req(route,data,cookie='',headers={}){const r=await fetch(base+route,{method:data?'POST':'GET',headers:{'Content-Type':'application/json','X-Market-Lab':'1',...(cookie?{Cookie:cookie}:{}),...headers},...(data?{body:JSON.stringify(data)}:{})});return {r,j:await r.json()};}
 assert.equal((await req('state')).j.user,null);assert.equal((await req('order',{})).r.status,401);
 const registered=await req('register',{username:'tester01',password:'testing-pass-123'});assert.equal(registered.r.status,200);const cookie=registered.r.headers.get('set-cookie').split(';')[0];assert.match(registered.r.headers.get('set-cookie'),/HttpOnly/);assert.match(registered.r.headers.get('set-cookie'),/SameSite=Strict/);
 assert.equal((await req('login',{username:'tester01',password:'wrong-password'})).r.status,401);
 assert.equal((await req('deposit',{amount:1000},cookie,{Origin:'https://attacker.example'})).r.status,403);
 assert.equal((await req('deposit',{amount:1000},cookie,{'X-Market-Lab':'0'})).r.status,403);
 assert.equal((await req('reset',{confirm:'RESET',mode:'synthetic',date:'2016-01-04',initial:1000000},cookie)).r.status,200);
 const opened=await req('order',{asset:'AAPL',side:'long',type:'market',margin:10000,leverage:3},cookie);assert.equal(opened.r.status,200);
 const state=(await req('state',null,cookie)).j;assert.equal(state.positions.length,1);assert.equal(state.summary.cash,989991);
 const other=await req('register',{username:'tester02',password:'testing-pass-456'});const otherCookie=other.r.headers.get('set-cookie').split(';')[0];assert.equal((await req('state',null,otherCookie)).j.positions.length,0);assert.equal((await req('close',{id:state.positions[0].id},otherCookie)).r.status,400);
 await req('logout',{},cookie);assert.equal((await req('state',null,cookie)).j.user,null);
 const login=await req('login',{username:'tester01',password:'testing-pass-123'});const newCookie=login.r.headers.get('set-cookie').split(';')[0];assert.equal((await req('state',null,newCookie)).j.positions.length,1);
 assert.equal((await req('close',{id:state.positions[0].id},newCookie)).r.status,200);assert.equal((await req('state',null,newCookie)).j.positions.length,0);
 const html=await fetch(`http://127.0.0.1:${port}/`);assert.equal(html.status,200);assert.match(html.headers.get('content-security-policy'),/frame-ancestors 'none'/);
});
