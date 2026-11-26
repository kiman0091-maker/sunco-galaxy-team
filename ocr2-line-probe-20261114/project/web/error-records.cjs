const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {VERSION,safeContext,codes:ocrCodes}=require('./runtime-diagnostics.cjs');
const stages=new Set(['login','logout','recognize','site-overview','completion-plan','browser','certification']);
const codes=new Set(['REQUEST_FAILED','NETWORK_FAILED','TIMEOUT','COUNT_UNVERIFIED','UNEXPECTED',...ocrCodes,'OCR_INVALID_RESPONSE','CERT_FORM_MISSING','CERT_FORM_MODE_UNVERIFIED','CERT_MODE_MISSING','CERT_MODE_DUPLICATE','CERT_MODE_UNSAFE','CERT_MODE_HAS_FINISHED','CERT_MODE_DELETE_ACTION','CERT_MODE_HAS_DEL_FRAGMENT','CERT_MODE_HAS_EXPIRE','CERT_MODE_HAS_CANCEL','CERT_MODE_UNKNOWN','CERTIFICATION_FAILED','OCR_NUMBERS_MISSING']);
function createErrorStore(directory){
 const file=path.join(directory,'errors.json');
 function record(input,serverContext){
  // Never persist free text, URLs, bodies, identifiers, stacks, or credentials.
  const entry={id:crypto.randomUUID(),at:new Date().toISOString(),version:VERSION,
   stage:stages.has(input?.stage)?input.stage:'browser',
   code:codes.has(input?.code)?input.code:'UNEXPECTED',
   status:Number.isInteger(input?.status)&&input.status>=400&&input.status<=599?input.status:null};
  if(serverContext)entry.context=safeContext(serverContext);
  try{
   fs.mkdirSync(directory,{recursive:true,mode:0o700});
   let entries=[];try{entries=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(entries))entries=[]}catch{}
   const cutoff=Date.now()-30*86400000;
   entries=entries.filter(e=>Date.parse(e.at)>=cutoff).slice(-499);
   entries.push(entry);const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(entries),{mode:0o600});fs.renameSync(temp,file);
   console.info(JSON.stringify({type:'coupon_error',...entry}));
   return entry;
  }catch{return null}
 }
 return {record};
}
module.exports={createErrorStore,VERSION};
