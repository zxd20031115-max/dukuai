import {BrowserSimulator} from './simulator.mjs';
import {openRepository} from './storage.mjs';
import {loadHistory} from './history-loader.mjs';
let initialized;
async function initialize(){
 const book=await loadHistory({onProgress:p=>{
  const box=globalThis.document?.querySelector('#boot-status p');if(!box)return;
  if(p.phase==='manifest')box.textContent='正在连接历史数据服务…';
  if(p.phase==='cache')box.textContent='正在读取已缓存的历史行情…';
  if(p.phase==='decode')box.textContent='下载完成，正在解压历史行情…';
  if(p.phase==='download')box.textContent=`正在下载压缩历史数据：${(p.received/1048576).toFixed(2)} / ${p.total?(p.total/1048576).toFixed(2):'…'} MB${p.attempt>1?'（第 '+p.attempt+' 次尝试）':''}`;
  if(p.phase==='retry')box.textContent=`${p.error}，正在重试…`;
 }});
 const simulator=new BrowserSimulator(book,await openRepository());
 await simulator.initialize();return simulator;
}
export async function browserApi(route,body){
 initialized??=initialize().catch(e=>{initialized=undefined;throw e;});const simulator=await initialized;
 const run=()=>simulator.request(route,body);
 return navigator.locks? navigator.locks.request('market-lab-web-account',run):run();
}
