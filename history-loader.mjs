// Streamed downloads use an inactivity timeout rather than waiting indefinitely.
export async function downloadBytes(url,{fetcher=fetch,onProgress=()=>{},timeoutMs=20000,attempts=3,total=0}={}){
 let lastError;
 for(let attempt=1;attempt<=attempts;attempt++){
  const controller=new AbortController();let timer;
  const arm=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(),timeoutMs);};
  try{
   onProgress({phase:'download',attempt,received:0,total});arm();
   const r=await fetcher(url,{signal:controller.signal});if(!r.ok)throw Error('HTTP '+r.status);
   const size=Number(r.headers.get('Content-Length'))||total,chunks=[];let received=0;
   if(r.body?.getReader){const reader=r.body.getReader();while(true){arm();const part=await reader.read();if(part.done)break;chunks.push(part.value);received+=part.value.length;onProgress({phase:'download',attempt,received,total:size});}}
   else{const bytes=new Uint8Array(await r.arrayBuffer());chunks.push(bytes);received=bytes.length;}
   const bytes=new Uint8Array(received);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return bytes;
  }catch(e){lastError=e;onProgress({phase:'retry',attempt,error:e.name==='AbortError'?'连接超时':e.message});}
  finally{clearTimeout(timer);}
 }
 throw Error(`历史数据下载未完成（已尝试 ${attempts} 次）：${lastError?.name==='AbortError'?'连接超时':lastError?.message}。可点击重新下载，或使用本地离线版。`);
}
async function decode(bytes,gzip){const text=gzip?await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text():new TextDecoder().decode(bytes);const book=JSON.parse(text);if(Object.keys(book).length!==50)throw Error('历史数据不完整');return book;}
export async function loadHistory({base=new URL('./',import.meta.url),fetcher=fetch,cacheStorage=globalThis.caches,onProgress=()=>{},timeoutMs=20000}={}){
 const manifestBytes=await downloadBytes(new URL('data/history-manifest.json',base),{fetcher,timeoutMs,attempts:2,onProgress:()=>onProgress({phase:'manifest'})});
 const manifest=JSON.parse(new TextDecoder().decode(manifestBytes));
 const gzip=typeof DecompressionStream==='function';
 const url=new URL(gzip?manifest.gzipFile:manifest.rawFile,base);url.searchParams.set('v',manifest.version);
 let cache;try{cache=await cacheStorage?.open('market-lab-history-v1');}catch{}
 if(cache){try{const cached=await cache.match(url.href);if(cached){onProgress({phase:'cache'});return await decode(new Uint8Array(await cached.arrayBuffer()),gzip);}}catch{try{await cache.delete(url.href);}catch{}}}
 const bytes=await downloadBytes(url,{fetcher,timeoutMs,total:gzip?manifest.gzipBytes:manifest.rawBytes,onProgress});
 onProgress({phase:'decode'});const book=await decode(bytes,gzip);
 try{await cache?.put(url.href,new Response(bytes));}catch{/* Cache quota must not block trading. */}
 onProgress({phase:'ready'});return book;
}
