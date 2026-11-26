// Trusted local reference controller; admin DB/authority credentials stay outside app.
// A real deployment must enumerate every instance, revoke access and use external proof.
const crypto=require('node:crypto');
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
function createRecoveryManager({adminPool,authority,appRole,workers}){
 if(!/^[a-z][a-z0-9_]+$/.test(appRole))throw Error('Pinned application role required');
 const snapshot=()=>authority.call('snapshot');
 async function audit(){
  const s=await snapshot(),p=(await adminPool.query('SELECT * FROM sunco_guard.requests ORDER BY business')).rows,v=(await adminPool.query('SELECT * FROM sunco_guard.resources ORDER BY resource')).rows,a=(await adminPool.query('SELECT * FROM sunco_guard.aliases ORDER BY alias')).rows,control=(await adminPool.query('SELECT * FROM sunco_guard.control WHERE singleton=1')).rows[0];
  const missing=[],conflicts=[],extra=p.filter(x=>!s.receipts.some(r=>r.business===x.business)).map(x=>x.business);
  if(!control||control.storage_id!==s.storeId||control.store_uuid!==s.storeUuid)conflicts.push('STORE_IDENTITY_MISMATCH');
  for(const r of s.receipts){const row=p.find(x=>x.business===r.business),resource=v.find(x=>x.resource===r.resource),alias=r.alias&&a.find(x=>x.alias===r.alias);
   if(!row)missing.push({kind:'request',key:r.business});else if(['account','payload','owner'].some(k=>row[k]!==r[k]))conflicts.push(r.business);
   if(!resource)missing.push({kind:'resource',key:r.resource});else if(resource.business!==r.business)conflicts.push(r.resource);
   if(r.alias){if(!alias)missing.push({kind:'alias',key:r.alias});else if(alias.business!==r.business||alias.payload!==r.payload)conflicts.push(r.alias)}
  }
  const value={head:s.head,epoch:s.epoch,revision:s.revision,journalReceipts:s.receipts.length,dbReceipts:p.length,missing,conflicts,extra,clean:!missing.length&&!conflicts.length&&!extra.length};return {...value,hash:hash(value)};
 }
 async function stopAll(){
  // Stop every instance owned by this controller, including registration failures.
  for(const w of workers())if(w.child.exitCode===null&&!w.child.killed){const ended=new Promise(r=>w.child.once('exit',r));w.child.kill();await ended;}
  const s=await snapshot();for(const registered of s.workers){const w=workers().find(w=>w.id===registered.id&&w.child.pid===registered.pid);
   if(!w){try{process.kill(registered.pid,0);throw Error('Unknown live registered worker; restore prohibited')}catch(e){if(e.code!=='ESRCH')throw e}}
   else if(w.child.exitCode===null&&!w.child.killed){const ended=new Promise(r=>w.child.once('exit',r));w.child.kill();await ended;}
   await authority.call('stopped',{id:registered.id});
  }
 }
 async function prepareRestore(){
  await authority.call('hold',{reason:'ADMIN_RESTORE_REQUESTED'});
  await adminPool.query(`ALTER ROLE ${appRole} NOLOGIN`);
  await adminPool.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename=$1 AND pid<>pg_backend_pid()',[appRole]);
  await adminPool.query('UPDATE sunco_guard.control SET enabled=false WHERE singleton=1');
  await stopAll();const before=await audit();const permit=await authority.call('seal');return {before,permit};
 }
 async function restore(permit,performRestore){
  const role=(await adminPool.query('SELECT rolcanlogin FROM pg_roles WHERE rolname=$1',[appRole])).rows[0];if(role?.rolcanlogin!==false)throw Error('Application DB login must be revoked before restore');
  await authority.call('restore-start',permit);
  try{await performRestore();await adminPool.query('UPDATE sunco_guard.control SET enabled=false WHERE singleton=1');}finally{await authority.call('restore-finish')}
  return audit();
 }
 async function reconcile(approval){
  const s=await snapshot();if(approval!=='FAKE_ADMIN_RECONCILED'||s.phase!=='HOLD')throw Error('Explicit administrator review required');
  if(s.workers.some(w=>w.status!=='stopped'))throw Error('All workers must stop before reconciliation');
  const initial=await audit();if(initial.conflicts.length||initial.extra.length)throw Error('Conflicting or unexpected receipts require manual investigation');
  const c=await adminPool.connect();try{await c.query('BEGIN');
   for(const r of s.receipts){const state=r.state==='answered'?'answered':'unknown';
    await c.query('INSERT INTO sunco_guard.requests(business,account,payload,owner,epoch,state,created_ms) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(business) DO UPDATE SET state=EXCLUDED.state,epoch=EXCLUDED.epoch',[r.business,r.account,r.payload,r.owner,s.epoch,state,r.created_ms]);
    await c.query('INSERT INTO sunco_guard.resources VALUES($1,$2) ON CONFLICT DO NOTHING',[r.resource,r.business]);
    if(r.alias)await c.query('INSERT INTO sunco_guard.aliases VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[r.alias,r.business,r.payload]);
    if(state==='unknown')await c.query('INSERT INTO sunco_guard.accounts VALUES($1,$2) ON CONFLICT DO NOTHING',[r.account,r.owner]);else await c.query('DELETE FROM sunco_guard.accounts WHERE account=$1 AND owner=$2',[r.account,r.owner]);
   }
   await c.query('UPDATE sunco_guard.control SET epoch=$1,enabled=false WHERE singleton=1',[s.epoch]);await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
  const after=await audit();if(!after.clean)throw Error('Reconciliation incomplete');return after;
 }
 async function resume(approval){
  const s=await snapshot();if(approval!=='FAKE_ADMIN_RECONCILED'||s.phase!=='HOLD')throw Error('Explicit administrator review required');const proof=await audit();if(!proof.clean)throw Error('Missing or conflicting receipts block resume');
  const control=(await adminPool.query('SELECT epoch FROM sunco_guard.control WHERE singleton=1')).rows[0];if(control?.epoch!==s.epoch)throw Error('Database generation mismatch');
  await authority.call('resume',{approval,revision:s.revision,audit:proof});
  await adminPool.query('UPDATE sunco_guard.control SET enabled=true WHERE singleton=1');await adminPool.query(`ALTER ROLE ${appRole} LOGIN`);return snapshot();
 }
 return {audit,prepareRestore,restore,reconcile,resume,stopAll};
}
module.exports={createRecoveryManager};
