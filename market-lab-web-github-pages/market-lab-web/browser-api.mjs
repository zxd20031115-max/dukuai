import {BrowserSimulator} from './simulator.mjs';
import {openRepository} from './storage.mjs';
let initialized;
async function initialize(){
 const response=await fetch(new URL('./data/history.json',import.meta.url));
 if(!response.ok)throw Error('历史数据下载失败：HTTP '+response.status);
 const book=await response.json();
 if(Object.keys(book).length!==50)throw Error('历史数据不完整，请重新上传 data/history.json');
 const simulator=new BrowserSimulator(book,await openRepository());
 await simulator.initialize();return simulator;
}
export async function browserApi(route,body){
 initialized??=initialize();const simulator=await initialized;
 const run=()=>simulator.request(route,body);
 return navigator.locks? navigator.locks.request('market-lab-web-account',run):run();
}
