// Protocol reference only. LOCAL_MOCK does not establish production immutability.
const crypto=require('node:crypto');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const encoded=v=>JSON.stringify(canonical(v)),digest=v=>crypto.createHash('sha256').update(encoded(v)).digest('hex');
function proofBody(p){return {mode:p.mode,identity:p.identity,number:p.number,hash:p.hash,generation:p.generation,stateDigest:p.stateDigest,nonce:p.nonce};}
function verifyProof(p,{publicKey,identity,nonce,allowLocalMock}){
 if(!allowLocalMock||p?.mode!=='LOCAL_MOCK')throw Error('Verified external checkpoint provider not implemented');
 if(digest(p.identity)!==digest(identity)||p.nonce!==nonce||!Number.isSafeInteger(p.number)||p.number<0||!Number.isSafeInteger(p.generation)||p.generation<1||!['hash','stateDigest'].every(k=>/^[a-f0-9]{64}$/.test(p[k]||''))||typeof p.signature!=='string'||!crypto.verify(null,Buffer.from(encoded(proofBody(p))),publicKey,Buffer.from(p.signature,'base64')))throw Error('Checkpoint identity, freshness or signature invalid');
 return p;
}
function createCheckpointClient({url,readSecret,writeSecret,publicKey,identity,allowLocalMock=false}){
 const u=new URL(url);if(u.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw Error('Remote checkpoint requires HTTPS');if(!['http:','https:'].includes(u.protocol)||u.username||u.password||!allowLocalMock)throw Error('Only explicitly enabled local mock is implemented');
 let seen;
 async function call(op,data={},challenge){const nonce=challenge||crypto.randomBytes(24).toString('hex');const r=await fetch(u,{method:'POST',headers:{Connection:'close',Authorization:'Bearer '+(op==='read'?readSecret:writeSecret),'Content-Type':'application/json'},body:JSON.stringify({op,identity,nonce,...data}),signal:AbortSignal.timeout(5000)});const p=await r.json();if(!r.ok)throw Error(p.error||'Checkpoint unavailable');verifyProof(p,{publicKey,identity,nonce,allowLocalMock});if(seen&&(p.number<seen.number||p.generation<seen.generation||p.number===seen.number&&(p.hash!==seen.hash||p.stateDigest!==seen.stateDigest)))throw Error('Checkpoint moved backwards or forked');seen=p;return p;}
 return {read:()=>call('read'),readFor:nonce=>call('read',{},nonce),advance:(expected,next)=>call('advance',{expected,next})};
}
function checkpointMatches(p,s){return p.number===s.revision&&p.hash===s.head&&p.generation===Number(s.epoch.slice(1))&&p.stateDigest===digest(s);}
module.exports={canonical,encoded,digest,proofBody,verifyProof,createCheckpointClient,checkpointMatches};
