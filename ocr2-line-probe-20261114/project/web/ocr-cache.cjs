const {createHash}=require('node:crypto');
function createRecognitionCache({maxEntries=8,ttlMs=300000,now=Date.now}={}){
 const entries=new Map();
 return {async run(bytes,execute){
  const key=createHash('sha256').update(bytes).digest('hex'),existing=entries.get(key);
  if(existing&&(existing.pending||now()-existing.created<ttlMs)){const result=await existing.promise;return {...structuredClone(result),cacheHit:true};}
  entries.delete(key);for(const [k,v]of entries)if(!v.pending&&now()-v.created>=ttlMs)entries.delete(k);
  // Do not evict an in-flight request: simultaneous duplicates must share it.
  for(const [k,v]of entries){if(entries.size<maxEntries)break;if(!v.pending)entries.delete(k);}
  if(entries.size>=maxEntries)return {...await execute(),cacheHit:false};
  const entry={pending:true,created:now()};entry.promise=Promise.resolve().then(execute);entries.set(key,entry);
  try{const result=await entry.promise;entry.pending=false;entry.created=now();return {...structuredClone(result),cacheHit:false};}catch(e){entries.delete(key);throw e;}
 }};
}
module.exports={createRecognitionCache};
