const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function chooseBuilder(builders,state={}){
 if(!Array.isArray(builders)||builders.length===0)return null;
 if(builders.some(b=>!b.id||!b.name)||new Set(builders.map(b=>b.id)).size!==builders.length)throw Error('틴팅프로 명단을 정확히 확인하지 못했습니다.');
 const lastIndex=builders.findIndex(b=>b.id===state.lastBuilderId);
 const index=lastIndex<0?0:(lastIndex+1)%builders.length;
 return {...builders[index],column:1,position:index+1,total:builders.length};
}
function createRotationStore(directory){
 const filename=path.join(directory,'builder-rotation.json');
 function read(){try{const data=JSON.parse(fs.readFileSync(filename,'utf8'));if(data.version!==1||!data.accounts)throw Error('Unsupported rotation format');return data}catch(error){if(error.code==='ENOENT')return {version:1,accounts:{}};throw Error('틴팅프로 순환 이력을 읽지 못했습니다. 자동으로 초기화하지 않습니다.')}}
 function save(data){fs.mkdirSync(directory,{recursive:true});const temporary=filename+'.tmp';fs.writeFileSync(temporary,JSON.stringify(data),{mode:0o600});fs.renameSync(temporary,filename)}
 const accountKey=accountId=>{if(typeof accountId!=='string'||!accountId)throw Error('시공점 계정이 필요합니다.');return hash(accountId)};
 return {
  get(accountId){const state=read().accounts[accountKey(accountId)];return state?{lastBuilderId:state.lastBuilderId,completedCount:state.completedCount}:{lastBuilderId:null,completedCount:0}},
  // Call only after the execution adapter verifies this exact job on the site.
  // There is intentionally no HTTP endpoint allowing a client to claim completion.
  commitVerifiedCompletion(accountId,{contract,vin,builderId,expectedLastBuilderId},proof){
   if(proof?.recordStatus!=='completed'||proof?.contract!==contract||proof?.vin!==vin||proof?.inProgressDelta!==-1||proof?.completedDelta!==1)throw Error('실제 완료 상태와 건수 변화를 확인해야 순환 순서를 넘길 수 있습니다.');
   if(!/^[A-Z0-9]{13}$/.test(contract)||!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)||!builderId)throw Error('완료 기록 식별 정보가 올바르지 않습니다.');
   const data=read(),key=accountKey(accountId),job=hash(contract+'\n'+vin);const state=data.accounts[key]||{lastBuilderId:null,completedCount:0,jobs:{}};
   if(state.jobs[job])return {advanced:false,...this.get(accountId)};
   if(state.lastBuilderId!==(expectedLastBuilderId??null))throw Error('다른 작업이 먼저 완료되어 다음 틴팅프로를 다시 확인해야 합니다.');
   state.lastBuilderId=builderId;state.completedCount++;state.jobs[job]={builderId,verifiedAt:new Date().toISOString()};data.accounts[key]=state;save(data);
   return {advanced:true,lastBuilderId:builderId,completedCount:state.completedCount};
  }
 };
}
module.exports={chooseBuilder,createRotationStore};
