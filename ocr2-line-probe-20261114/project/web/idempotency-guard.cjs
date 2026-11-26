// Development candidate: all instances must use the same durable atomic store.
// No lease expiry or automatic ownership takeover after an uncertain result.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v;}
function createGuard(directory,storeId){
 if(typeof directory!=='string'||!path.isAbsolute(directory)||typeof storeId!=='string'||!storeId)throw Error('Shared store configuration required');
 const root=fs.realpathSync(directory);if(fs.readFileSync(path.join(root,'STORE_ID'),'utf8').trim()!==storeId)throw Error('Shared store identity mismatch');
 function save(file,record){const fd=fs.openSync(file,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(record));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
 function claim(file,record){let fd;try{fd=fs.openSync(file,'wx',0o600);}catch(e){if(e.code==='EEXIST')return false;throw e;}try{fs.writeFileSync(fd,JSON.stringify(record));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}return true;}
 async function run(scope,key,payload,action,{accountScope=scope}={}){
  if(fs.realpathSync(directory)!==root||fs.readFileSync(path.join(root,'STORE_ID'),'utf8').trim()!==storeId)throw Error('Shared store identity changed; do not execute');
  if(typeof scope!=='string'||!scope||typeof accountScope!=='string'||!accountScope||typeof key!=='string'||!/^[a-f0-9]{64}$/i.test(key))throw Error('Authenticated scope and valid identity required');
  const payloadHash=hash(JSON.stringify(canonical(payload))),id=hash(JSON.stringify([scope,key])),file=path.join(root,'request-'+id+'.json'),lease=path.join(root,'account-'+hash(accountScope)+'.json');
  const record={version:1,payloadHash,state:'pending'};
  let owned;try{owned=claim(file,record);}catch{throw Error('Request ownership cannot be persisted; do not execute');}
  if(!owned){let prior;try{prior=JSON.parse(fs.readFileSync(file,'utf8'));}catch{return {state:'review_required',reason:'unreadable_receipt',executed:false};}
   if(prior.version!==1||!/^[a-f0-9]{64}$/.test(prior.payloadHash||'')||!['pending','answered','unknown','blocked_before_execution'].includes(prior.state))return {state:'review_required',reason:'invalid_receipt',executed:false};
   if(prior.payloadHash!==payloadHash)throw Error('Business identity payload conflict');return {state:'review_required',reason:prior.state,executed:false};
  }
  let accountOwned;try{accountOwned=claim(lease,{version:1,request:id,state:'pending'});}catch{try{save(file,{...record,state:'blocked_before_execution'});}catch{}throw Error('Account ownership cannot be persisted; do not execute');}
  if(!accountOwned){try{save(file,{...record,state:'blocked_before_execution'});}catch{}return {state:'review_required',reason:'account_busy_or_unknown',executed:false};}
  try{
   const result=await action();const uncertain=['needs_review','uncertain','succeeded_unreconciled'].includes(result?.state);
   save(file,{...record,state:uncertain?'unknown':'answered'});
   if(uncertain)save(lease,{version:1,request:id,state:'unknown'});
   else fs.unlinkSync(lease); // Only this invocation's newly claimed test-store lease.
   return {state:uncertain?'review_required':'answered',executed:true,result};
  }catch(error){try{save(file,{...record,state:'unknown'});save(lease,{version:1,request:id,state:'unknown'});}catch{}throw Error('Business result unknown; do not replay');}
 }
 return {run};
}
module.exports={createGuard};
