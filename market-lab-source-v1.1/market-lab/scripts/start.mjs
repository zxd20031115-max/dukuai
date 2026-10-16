import {spawn,spawnSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CATALOG} from '../lib/catalog.mjs';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
if(Number(process.versions.node.split('.')[0])<24){console.error('Node.js 24 or newer is required. https://nodejs.org/');process.exit(1);}
const port=Number(process.env.PORT||4311);if(!Number.isInteger(port)||port<1024||port>65535){console.error('PORT must be between 1024 and 65535');process.exit(1);}
const url=`http://127.0.0.1:${port}`;
function openBrowser(){if(process.env.NO_BROWSER)return;if(process.platform==='win32')spawn('cmd.exe',['/c','start','',url],{stdio:'ignore',windowsHide:true});else spawn(process.platform==='darwin'?'open':'xdg-open',[url],{stdio:'ignore'}).on('error',()=>console.log('Open '+url+' in your browser.'));}
try{const r=await fetch(url+'/api/health',{signal:AbortSignal.timeout(1200)});const data=await r.json();if(data.app==='market-lab'){console.log('Market Lab is already running: '+url);openBrowser();process.exit(0);}}catch{}
const manifest=path.join(root,'data/history/manifest.json');
const missingHistory=CATALOG.some(a=>a.ticker&&!existsSync(path.join(root,'data/history',a.id+'.json')));
if(!existsSync(manifest)||!JSON.parse(readFileSync(manifest,'utf8')).assets?.length||missingHistory){console.log('Downloading missing historical daily bars (2006-2025)...');const r=spawnSync(process.execPath,[path.join(root,'scripts/download-history.mjs')],{stdio:'inherit',cwd:root});if(r.status!==0)console.log('Historical data is unavailable. Synthetic mode remains available. Retry later: node scripts/download-history.mjs');}
const child=spawn(process.execPath,[path.join(root,'server.mjs')],{cwd:root,stdio:['inherit','pipe','inherit']});
child.stdout.on('data',chunk=>{process.stdout.write(chunk);if(String(chunk).includes('ready:'))openBrowser();});child.on('error',e=>console.error(e.message));child.on('exit',code=>process.exit(code||0));process.on('SIGINT',()=>child.kill());
