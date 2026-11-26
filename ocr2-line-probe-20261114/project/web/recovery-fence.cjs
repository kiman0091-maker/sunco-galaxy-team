const fs=require('node:fs'),path=require('node:path');
// Read-only authority OUTSIDE the restored DB. This file is a local/test provider.
// Production requires an independently durable, access-controlled shared authority.
// Silent rollback of both DB and authority cannot be detected by this provider.
function createFileFence(file){
 if(typeof file!=='string'||!path.isAbsolute(file))throw Error('Independent recovery authority required');
 return async()=>JSON.parse(await fs.promises.readFile(file,'utf8'));
}
function validateFence(value,{storageId,epoch},now=Date.now()){
 if(!value||value.version!==1||value.enabled!==true||value.storageId!==storageId||value.epoch!==epoch||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=now)throw Error('Recovery hold or expired authority');
 return true;
}
module.exports={createFileFence,validateFence};
