// R8 LOCAL_MOCK reference. Journal and checkpoint use separate local recovery boundaries.
// Real external immutability is not connected; operating deployment remains disabled.
const fs=require('node:fs'),http=require('node:http'),crypto=require('node:crypto');
const {digest,checkpointMatches}=require('./checkpoint-client.cjs');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const alive=pid=>{try{process.kill(pid,0);return true}catch(e){return e.code!=='ESRCH'}};
async function createAuthority({journalFile,identity,workerSecret,adminSecret,checkpoint,allowLocalMock=false,initialize=false}){
 if(!checkpoint||!allowLocalMock)throw Error('Explicit local checkpoint prototype required; production disabled');
 if(!identity?.authorityId||!identity?.storeId||!identity?.storeUuid||!workerSecret||!adminSecret||workerSecret===adminSecret)throw Error('Independent authority configuration required');
 const mac=v=>crypto.createHmac('sha256',adminSecret).update(v).digest('hex');
 let state={identity,phase:'HOLD',epoch:1,revision:0,head:'0'.repeat(64),workers:{},receipts:{},reason:'INITIAL_REVIEW_REQUIRED'},bad=false,fault=false;
 function fold(s,e){
  const d=e.data;
  if(e.type==='init'){if(JSON.stringify(d)!==JSON.stringify(identity))throw Error('Authority identity mismatch');}
  else if(e.type==='hold'){s.phase='HOLD';s.reason=d.reason;s.epoch=d.epoch;for(const w of Object.values(s.workers))if(w.status==='active')w.status='revoked';}
  else if(e.type==='register')s.workers[d.id]=d;
  else if(e.type==='stopped')s.workers[d.id].status='stopped';
  else if(e.type==='reserve')s.receipts[d.business]={...d,state:'pending'};
  else if(e.type==='dispatch')s.receipts[d.business].dispatched=true;
  else if(e.type==='result')s.receipts[d.business].state=d.state;
  else if(e.type==='seal'){s.seal=d.seal;s.sealedRevision=e.seq;}
  else if(e.type==='restore-start'){s.phase='RESTORING';s.seal=null;}
  else if(e.type==='restore-finish'){s.phase='HOLD';s.reason='RESTORE_RECONCILIATION_REQUIRED';}
  else if(e.type==='resume'){s.phase='ACTIVE';s.reason=null;s.seal=null;}
  else throw Error('Unknown authority journal event');
  s.revision=e.seq;s.head=e.hash;
 }
 function parse(){const text=fs.readFileSync(journalFile,'utf8');if(!text.endsWith('\n'))throw Error('Incomplete authority journal');const fresh={identity,phase:'HOLD',epoch:1,revision:0,head:'0'.repeat(64),workers:{},receipts:{},reason:'INITIAL_REVIEW_REQUIRED'};for(const line of text.trimEnd().split('\n')){const e=JSON.parse(line),unsigned={seq:e.seq,type:e.type,data:e.data,previous:e.previous};if(e.seq!==fresh.revision+1||e.previous!==fresh.head||e.hash!==mac(JSON.stringify(unsigned)))throw Error('Authority journal integrity failure');fold(fresh,e)}return fresh;}
 async function append(type,data){
  if(bad)throw Error('Authority storage held');
  try{await verifyAnchor();if(state.revision&&parse().head!==state.head)throw Error('Authority rollback detected');if(fault){fault=false;throw Error('INJECTED_AUTHORITY_WRITE_FAILURE')}
   const unsigned={seq:state.revision+1,type,data,previous:state.head},e={...unsigned,hash:mac(JSON.stringify(unsigned))};const bytes=Buffer.from(JSON.stringify(e)+'\n');const fd=fs.openSync(journalFile,'a');try{let offset=0;while(offset<bytes.length)offset+=fs.writeSync(fd,bytes,offset,bytes.length-offset);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}const preview=JSON.parse(JSON.stringify(state));fold(preview,e);const previous=view(state);await checkpoint.advance({number:state.revision,hash:state.head,generation:state.epoch,stateDigest:digest(previous)},{number:preview.revision,hash:preview.head,generation:preview.epoch,stateDigest:digest(view(preview))});fold(state,e);
  }catch(e){bad=true;throw e;}
 }
 if(!fs.existsSync(journalFile)){if(!initialize)throw Error('Authority journal missing; no automatic reset');await append('init',identity)}else{state=parse();await verifyAnchor();await append('hold',{reason:'AUTHORITY_RESTART_REQUIRES_REVIEW',epoch:state.epoch+1})}
 const worker=(d,active=true)=>{const w=state.workers[d.workerId];if(!w||w.tokenHash!==hash(String(d.workerToken||'')))throw Error('Worker authentication failed');if(active&&(state.phase!=='ACTIVE'||w.status!=='active'||w.epoch!==state.epoch||d.epoch!==`E${state.epoch}`))throw Error('Worker generation held');return w;};
 function view(s=state){return {version:2,...identity,phase:s.phase,epoch:`E${s.epoch}`,revision:s.revision,head:s.head,reason:s.reason,receipts:Object.values(s.receipts),workers:Object.values(s.workers).map(({tokenHash,...w})=>w)}}
 async function verifyAnchor(){try{const p=await checkpoint.read();if(!checkpointMatches(p,view()))throw Error('CHECKPOINT_JOURNAL_ROLLBACK_OR_MISMATCH');return p}catch(e){bad=true;throw e}}
 let serial=Promise.resolve();const server=http.createServer((req,res)=>{const handle=async()=>{let raw='';try{
  for await(const b of req){raw+=b;if(raw.length>1024*1024)throw Error('Authority request too large')}
  const d=JSON.parse(raw||'{}'),admin=req.headers.authorization==='Bearer '+adminSecret,app=req.headers.authorization==='Bearer '+workerSecret;
  if(!admin&&!app){res.statusCode=403;throw Error('Authority authentication required')}
  if(bad)throw Error('Authority storage held');if(parse().head!==state.head){bad=true;throw Error('Authority rollback detected')}
  await verifyAnchor();
  if(!/^[a-f0-9]{48}$/.test(d.checkpointNonce||''))throw Error('Fresh checkpoint challenge required');
  if(JSON.stringify(d.identity)!==JSON.stringify(identity))throw Error('Authority/store identity mismatch');
  let result;
  if(d.op==='snapshot'){if(!admin)worker(d);result=view()}
  else if(d.op==='register'){
   if(!app||state.phase!=='ACTIVE'||d.epoch!==`E${state.epoch}`||!Number.isSafeInteger(d.pid)||d.pid<=0||!alive(d.pid)||typeof d.workerId!=='string'||state.workers[d.workerId])throw Error('Worker registration held');
   const token=crypto.randomBytes(24).toString('hex');await append('register',{id:d.workerId,pid:d.pid,epoch:state.epoch,status:'active',tokenHash:hash(token)});result={workerToken:token,epoch:d.epoch};
  }else if(d.op==='reserve'){
   worker(d);const r=d.receipt;
   if(d.revision!==state.revision)throw Error('Authority snapshot changed; no dispatch');
   if(!r||!['business','account','payload','resource','owner'].every(k=>typeof r[k]==='string'&&r[k])||!/^[a-f0-9]{64}$/.test(r.business)||!Number.isSafeInteger(r.created_ms))throw Error('Invalid intent');
   const items=Object.values(state.receipts);
   if(items.some(x=>x.business===r.business||x.resource===r.resource||x.account===r.account&&x.state!=='answered'||r.alias&&x.alias===r.alias))throw Error('Prior business, vehicle, alias or uncertain account held');
   if(items.length>=1000)throw Error('Authority capacity requires review');
   await append('reserve',{...r,workerId:d.workerId,epoch:d.epoch});result={reserved:true};
  }else if(d.op==='dispatch'){
   worker(d);const r=state.receipts[d.business];if(!r||r.owner!==d.owner||r.workerId!==d.workerId||r.state!=='pending'||r.dispatched)throw Error('Dispatch ownership held');await append('dispatch',{business:d.business});result={allowed:true};
  }else if(d.op==='result'){
   worker(d,false);const r=state.receipts[d.business];if(!r||r.owner!==d.owner||r.workerId!==d.workerId||!['answered','unknown'].includes(d.state))throw Error('Result ownership held');
   // Unknown can never be changed into answered by a later callback.
   if(r.state!=='pending')throw Error('Result already recorded');await append('result',{business:d.business,state:d.state});result={recorded:true};
  }else if(d.op==='hold'){
   if(!admin)worker(d);if(state.phase!=='HOLD')await append('hold',{reason:String(d.reason||'RECOVERY_REQUIRED'),epoch:state.epoch+1});result=view();
  }else if(d.op==='stopped'){
   if(!admin)throw Error('Administrator required');const w=state.workers[d.id];if(!w||alive(w.pid))throw Error('Registered worker is still running');await append('stopped',{id:d.id});result={stopped:true};
  }else if(d.op==='seal'){
   if(!admin||state.phase!=='HOLD'||Object.values(state.workers).some(w=>w.status!=='stopped'||alive(w.pid)))throw Error('All registered workers must stop before restore');
   const seal=crypto.randomUUID();await append('seal',{seal});result={seal,epoch:`E${state.epoch}`,revision:state.revision};
  }else if(d.op==='resume'){
   if(!admin||state.phase!=='HOLD'||d.approval!=='FAKE_ADMIN_RECONCILED'||d.revision!==state.revision||!d.audit?.clean||d.audit.head!==state.head||Object.values(state.workers).some(w=>w.status!=='stopped'||alive(w.pid)))throw Error('Independent administrator reconciliation required');
   await append('resume',{auditHash:d.audit.hash});result=view();
  }else if(d.op==='restore-start'){
   if(!admin||state.phase!=='HOLD'||d.seal!==state.seal||d.revision!==state.revision||Object.values(state.workers).some(w=>w.status!=='stopped'||alive(w.pid)))throw Error('Restore permit invalid or worker running');await append('restore-start',{});result=view();
  }else if(d.op==='restore-finish'){
   if(!admin||state.phase!=='RESTORING')throw Error('Restore was not sealed');await append('restore-finish',{});result=view();
  }else if(d.op==='inject-write-failure'){
   if(!admin)throw Error('Administrator required');fault=true;result={injected:true};
  }else throw Error('Unsupported authority operation');
  res.setHeader('Content-Type','application/json');const proof=await checkpoint.readFor(d.checkpointNonce);if(!checkpointMatches(proof,view()))throw Error('Checkpoint reply mismatch');res.end(JSON.stringify({...result,checkpoint:proof}));
 }catch(e){if(res.statusCode===200)res.statusCode=409;res.end(JSON.stringify({error:String(e.message)}))}};const turn=serial.then(handle,handle);serial=turn.catch(()=>{});});
 return {server,view,healthy:()=>!bad};
}
function genesisView(identity){return {version:2,...identity,phase:'HOLD',epoch:'E1',revision:0,head:'0'.repeat(64),reason:'INITIAL_REVIEW_REQUIRED',receipts:[],workers:[]}}
module.exports={createAuthority,genesisView};
