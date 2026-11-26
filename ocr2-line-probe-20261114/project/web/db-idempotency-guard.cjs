// R4 LOCAL TEST adapter. Same-host SQLite only; never share WAL over a network drive.
// No production schema migration, lease expiry, automatic takeover, or replay.
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
function open(file,id){
 if(!path.isAbsolute(file)||!id||!fs.existsSync(file))throw Error('Provisioned DB required');
 const db=new DatabaseSync(file);db.exec('PRAGMA busy_timeout=3000; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
 if(db.prepare('SELECT identity FROM metadata WHERE singleton=1').get()?.identity!==id){db.close();throw Error('DB identity mismatch');}
 return db;
}
function provision(file,id){
 if(!path.isAbsolute(file)||!id||fs.existsSync(file))throw Error('New explicit local DB only');
 const db=new DatabaseSync(file);
 try{db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
 CREATE TABLE metadata(singleton INTEGER PRIMARY KEY CHECK(singleton=1),identity TEXT NOT NULL);
 CREATE TABLE requests(business TEXT PRIMARY KEY,account TEXT NOT NULL,payload TEXT NOT NULL,owner TEXT NOT NULL UNIQUE,state TEXT NOT NULL CHECK(state IN ('pending','answered','unknown')),created INTEGER NOT NULL);
 CREATE TABLE accounts(account TEXT PRIMARY KEY,owner TEXT NOT NULL UNIQUE REFERENCES requests(owner));`);
 db.prepare('INSERT INTO metadata VALUES(1,?)').run(id);
 }finally{db.close();}
}
function createGuard(file,id){
 const root=fs.realpathSync(file);{const db=open(root,id);db.close();}
 function connection(){if(fs.realpathSync(file)!==root)throw Error('DB path changed');return open(root,id);}
 function tx(fn){const db=connection();try{db.exec('BEGIN IMMEDIATE');const value=fn(db);db.exec('COMMIT');return value;}catch(e){try{db.exec('ROLLBACK');}catch{}throw e;}finally{db.close();}}
 async function run(scope,key,payload,action,{accountScope=scope}={}){
  if(!scope||!accountScope||!/^[a-f0-9]{64}$/i.test(key))throw Error('Authenticated identity required');
  const business=hash(JSON.stringify([scope,key])),account=hash(accountScope),payloadHash=hash(JSON.stringify(canonical(payload))),owner=crypto.randomUUID();
  const claim=tx(db=>{
   const prior=db.prepare('SELECT payload,state FROM requests WHERE business=?').get(business);
   if(prior)return {owned:false,reason:prior.payload!==payloadHash?'payload_conflict':prior.state};
   if(db.prepare('SELECT owner FROM accounts WHERE account=?').get(account))return {owned:false,reason:'account_busy_or_unknown'};
   db.prepare("INSERT INTO requests VALUES(?,?,?,?, 'pending',?)").run(business,account,payloadHash,owner,Date.now());
   db.prepare('INSERT INTO accounts VALUES(?,?)').run(account,owner);
   return {owned:true};
  }); // COMMIT is durable before any virtual/external side effect.
  if(!claim.owned)return {executed:false,state:'review_required',reason:claim.reason};
  try{
   const result=await action();
   // Unknown/novel result states are conservative; only explicit service outcomes release account ownership.
   const known=new Set(['certified','verified','vehicle_not_found','invalid_numbers','notice_required','protected','identity_conflict','already_pending','already_completed','blocked_before_submission']);
   const certain=known.has(result?.state);
   tx(db=>{
    const changed=db.prepare('UPDATE requests SET state=? WHERE business=? AND owner=? AND state=\'pending\'').run(certain?'answered':'unknown',business,owner);
    if(changed.changes!==1)throw Error('Ownership lost');
    if(certain)db.prepare('DELETE FROM accounts WHERE account=? AND owner=?').run(account,owner);
   });
   return {executed:true,state:certain?'answered':'review_required',result};
  }catch(e){
   try{tx(db=>db.prepare("UPDATE requests SET state='unknown' WHERE business=? AND owner=?").run(business,owner));}catch{}
   throw Error('Outcome unknown; do not replay');
  }
 }
 return {run};
}
module.exports={createGuard,provision};
