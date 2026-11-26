const crypto=require('node:crypto');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const SQL={
 control:'SELECT storage_id,store_uuid,epoch,enabled FROM sunco_guard.control WHERE singleton=1 FOR SHARE',
 aliasInsert:'INSERT INTO sunco_guard.aliases(alias,business,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING alias',
 aliasRead:'SELECT business,payload FROM sunco_guard.aliases WHERE alias=$1',
 requestInsert:"INSERT INTO sunco_guard.requests(business,account,payload,owner,epoch,state,created_ms) VALUES($1,$2,$3,$4,$5,'pending',$6) ON CONFLICT DO NOTHING RETURNING owner",
 requestRead:'SELECT payload,state FROM sunco_guard.requests WHERE business=$1',
 accountInsert:'INSERT INTO sunco_guard.accounts(account,owner) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING owner',
 resourceInsert:'INSERT INTO sunco_guard.resources(resource,business) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING business',
 resourceRead:'SELECT business FROM sunco_guard.resources WHERE resource=$1',
 finish:"UPDATE sunco_guard.requests SET state=$1 WHERE business=$2 AND owner=$3 AND epoch=$4 AND state='pending' RETURNING owner",
 release:'DELETE FROM sunco_guard.accounts WHERE account=$1 AND owner=$2 RETURNING owner',
 unknown:"UPDATE sunco_guard.requests SET state='unknown' WHERE business=$1 AND owner=$2 AND epoch=$3 AND state='pending' RETURNING owner"
};
class Hold extends Error{constructor(reason){super(reason);this.hold=reason;}}
function createPostgresGuard({pool,storageId,storeUuid,epoch,authority}){
 if(!pool||typeof pool.connect!=='function'||!storageId||!storeUuid||!epoch||!authority)throw Error('PostgreSQL and independent recovery authority required');
 const fence=async()=>{const s=await authority.snapshot();if(s.version!==2||s.storeId!==storageId||s.storeUuid!==storeUuid||s.authorityId!==authority.identity.authorityId||s.phase!=='ACTIVE'||s.epoch!==epoch||!Array.isArray(s.receipts)||s.receipts.length>1000)throw Error('Recovery authority held');return s;};
 async function audit(c,s){
  if(!s.receipts.length)return;
  const rows=(await c.query('SELECT business,account,payload,owner FROM sunco_guard.requests WHERE business=ANY($1::text[])',[s.receipts.map(r=>r.business)])).rows;
  const resources=(await c.query('SELECT resource,business FROM sunco_guard.resources WHERE resource=ANY($1::text[])',[s.receipts.map(r=>r.resource)])).rows;
  const aliases=(await c.query('SELECT alias,business,payload FROM sunco_guard.aliases WHERE alias=ANY($1::text[])',[s.receipts.map(r=>r.alias).filter(Boolean)])).rows;
  for(const r of s.receipts){const p=rows.find(p=>p.business===r.business),v=resources.find(v=>v.resource===r.resource),a=r.alias&&aliases.find(a=>a.alias===r.alias);
   if(!p||['account','payload','owner'].some(k=>p[k]!==r[k])||!v||v.business!==r.business||r.alias&&(!a||a.business!==r.business||a.payload!==r.payload)){await authority.hold('RESTORED_RECEIPT_MISSING_OR_CONFLICT');throw new Hold('recovery_receipt_mismatch');}
  }
 }
 async function transaction(fn){
  const client=await pool.connect();let broken=false;
  try{
   await client.query('BEGIN');
   await client.query("SET LOCAL synchronous_commit = 'on'");
   await client.query("SET LOCAL lock_timeout = '3000ms'");
   await client.query("SET LOCAL statement_timeout = '5000ms'");
   // Serialize short claim/audit transactions, never the external operation itself.
   await client.query('SELECT pg_advisory_xact_lock(7265507)');
   const control=(await client.query(SQL.control)).rows[0];
   if(!control||control.storage_id!==storageId||control.store_uuid!==storeUuid||control.epoch!==epoch||control.enabled!==true)throw new Hold('recovery_hold');
   const value=await fn(client);await client.query('COMMIT');return value;
  }catch(e){try{await client.query('ROLLBACK');}catch{broken=true;}throw e;}
  finally{client.release(broken);}
 }
 async function run(scope,key,payload,action,{accountScope=scope,resourceKey,clientKey}={}){
  if(typeof scope!=='string'||!scope||typeof accountScope!=='string'||!accountScope||!/^[a-f0-9]{64}$/i.test(key)||typeof resourceKey!=='string'||!resourceKey)throw Error('Trusted business identity required');
  if(clientKey!=null&&!/^[a-f0-9]{64}$/i.test(clientKey))throw Error('Invalid request key');
  const business=hash(JSON.stringify([scope,key])),account=hash(accountScope),resource=hash(JSON.stringify([scope,resourceKey])),payloadHash=hash(JSON.stringify(canonical(payload))),owner=crypto.randomUUID();
  await fence();
  let claimed;
  try{claimed=await transaction(async c=>{
   const snapshot=await fence();await audit(c,snapshot);
   if(clientKey!=null){const alias=hash(JSON.stringify([scope,clientKey]));const a=await c.query(SQL.aliasInsert,[alias,business,payloadHash]);if(!a.rowCount){const prior=(await c.query(SQL.aliasRead,[alias])).rows[0];if(!prior||prior.business!==business||prior.payload!==payloadHash)throw new Hold('request_key_conflict');}}
   const r=await c.query(SQL.requestInsert,[business,account,payloadHash,owner,epoch,Date.now()]);
   if(!r.rowCount){const prior=(await c.query(SQL.requestRead,[business])).rows[0];return {owned:false,reason:!prior?'receipt_missing':prior.payload!==payloadHash?'payload_conflict':prior.state};}
   const a=await c.query(SQL.accountInsert,[account,owner]);if(!a.rowCount)throw new Hold('account_busy_or_unknown');
   const v=await c.query(SQL.resourceInsert,[resource,business]);if(!v.rowCount){const prior=(await c.query(SQL.resourceRead,[resource])).rows[0];if(!prior||prior.business!==business)throw new Hold('same_vehicle_requires_review');}
   await authority.reserve({business,account,payload:payloadHash,owner,resource,alias:clientKey?hash(JSON.stringify([scope,clientKey])):null,created_ms:Date.now()},snapshot.revision);
   return {owned:true};
  });}catch(e){if(e instanceof Hold)return {executed:false,state:'review_required',reason:e.hold};throw e;}
  if(!claimed.owned)return {executed:false,state:'review_required',reason:claimed.reason};
  try{
   await fence(); // No new dispatch once the independent recovery hold starts.
   await authority.dispatch(business,owner);
   const result=await action();
   const known=new Set(['certified','verified','vehicle_not_found','invalid_numbers','notice_required','protected','identity_conflict','already_pending','already_completed','blocked_before_submission']);
   const certain=known.has(result?.state);
   await fence();
   await transaction(async c=>{
    if((await c.query(SQL.finish,[certain?'answered':'unknown',business,owner,epoch])).rowCount!==1)throw Error('Ownership changed');
    if(certain&&(await c.query(SQL.release,[account,owner])).rowCount!==1)throw Error('Account ownership changed');
   });
   await authority.result(business,owner,certain?'answered':'unknown');
   return {executed:true,state:certain?'answered':'review_required',result};
  }catch(e){try{await authority.result(business,owner,'unknown');}catch{}try{await transaction(c=>c.query(SQL.unknown,[business,owner,epoch]));}catch{}throw Error('Outcome uncertain; automatic replay prohibited');}
 }
 return {run};
}
module.exports={createPostgresGuard,SQL};
