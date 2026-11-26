const crypto=require('node:crypto');
const {verifyProof,checkpointMatches}=require('./checkpoint-client.cjs');
function createAuthorityClient({url,secret,identity,epoch,checkpointPublicKey,allowLocalMock=false,workerId=crypto.randomUUID(),pid=process.pid,admin=false}){
 if(!checkpointPublicKey||!allowLocalMock)throw Error('Local mock requires explicit test enablement; operating provider unavailable');let checkpointSeen;
 const u=new URL(url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('Authority endpoint required');let workerToken,registration;
 if(u.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw Error('Non-loopback recovery authority requires HTTPS');
 async function call(op,data={}){const checkpointNonce=crypto.randomBytes(24).toString('hex');const r=await fetch(u,{method:'POST',headers:{Connection:'close',Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({op,identity,epoch,workerId,workerToken,checkpointNonce,...data}),signal:AbortSignal.timeout(5000)});const value=await r.json();if(!r.ok)throw Error(value.error||'Authority held');const p=verifyProof(value.checkpoint,{publicKey:checkpointPublicKey,identity,nonce:checkpointNonce,allowLocalMock});if(checkpointSeen&&(p.number<checkpointSeen.number||p.generation<checkpointSeen.generation||p.number===checkpointSeen.number&&p.hash!==checkpointSeen.hash))throw Error('Authority checkpoint regressed');if(value.version===2){const {checkpoint,...view}=value;if(!checkpointMatches(p,view))throw Error('Authority state does not match signed checkpoint')}checkpointSeen=p;return value;}
 const connect=()=>registration||(registration=call('register',{pid}).then(r=>{workerToken=r.workerToken;return r}));
 return {workerId,identity,epoch,call,connect,async snapshot(){if(!admin)await connect();return call('snapshot')},reserve:(receipt,revision)=>call('reserve',{receipt,revision}),dispatch:(business,owner)=>call('dispatch',{business,owner}),result:(business,owner,state)=>call('result',{business,owner,state}),hold:reason=>call('hold',{reason})};
}
module.exports={createAuthorityClient};
