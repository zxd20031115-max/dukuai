// IndexedDB transactions commit the entire simulated account atomically.
// Each operation reads the latest record, which also prevents lost multi-tab writes.
export async function openRepository(){
 const db=await new Promise((resolve,reject)=>{
  const r=indexedDB.open('market-lab-web-v1',1);
  r.onupgradeneeded=()=>r.result.createObjectStore('states');
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('无法打开浏览器存储：'+r.error?.message));
  r.onblocked=()=>reject(Error('存档被其他标签页占用，请关闭旧页面后重试'));
 });
 return {
  read:()=>new Promise((resolve,reject)=>{const tx=db.transaction('states','readonly'),r=tx.objectStore('states').get('main');let value;r.onsuccess=()=>value=r.result;tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error||Error('读取存档失败'));tx.onabort=()=>reject(tx.error||Error('读取存档中断'));}),
  mutate:fn=>new Promise((resolve,reject)=>{
   const tx=db.transaction('states','readwrite'),store=tx.objectStore('states'),r=store.get('main');let result,error;
   r.onsuccess=()=>{try{const updated=fn(r.result);store.put(updated.state,'main');result=updated.result;}catch(e){error=e;tx.abort();}};
   tx.oncomplete=()=>resolve(result);
   tx.onerror=()=>reject(error||tx.error||Error('保存失败，请检查浏览器存储空间'));
   tx.onabort=()=>reject(error||tx.error||Error('存档写入中断'));
  })
 };
}
