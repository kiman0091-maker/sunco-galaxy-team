const crypto=require('node:crypto');
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function createBusinessDispatcher({guard}){

 return async function dispatch(account,route,data,clientKey,action,trustedJob){
  if(!guard)throw Object.assign(Error('공유 중복 방지 저장소를 확인하지 못했습니다. 업무를 실행하지 않습니다.'),{status:503});
  if(typeof account!=='string'||!account||account.length>100)throw Object.assign(Error('인증된 계정 범위가 필요합니다.'),{status:401});
  if(clientKey!=null&&!/^[a-f0-9]{64}$/i.test(clientKey))throw Object.assign(Error('요청 식별값을 확인해주세요.'),{status:400});
  let identity,payload;
  if(route==='/api/certification/execute'){
   if(typeof data.contract!=='string'||typeof data.vin!=='string')throw Object.assign(Error('번호를 확인해주세요.'),{status:400});
   identity=data.contract;payload={contract:data.contract,vin:data.vin};
  }else if(route==='/api/completion-test/execute'){
   if(data.approved!==true||typeof data.id!=='string'||!data.id||data.id.length>100)throw Object.assign(Error('승인된 작업 식별값이 필요합니다.'),{status:400});
   if(!trustedJob||trustedJob.id!==data.id||!/^[A-Z0-9]{13}$/.test(trustedJob.contract)||!/^[A-HJ-NPR-Z0-9]{17}$/.test(trustedJob.vin))throw Object.assign(Error('서버 보관 작업을 확인해야 합니다.'),{status:409});
   identity=trustedJob.contract;payload={contract:trustedJob.contract,vin:trustedJob.vin};
  }else throw Object.assign(Error('실행 경로를 확인해주세요.'),{status:400});
  // Trusted account + business identity own execution, not a caller-chosen key.
  // Different HTTP keys cannot create a second execution for the same business.
  let result;try{result=await guard.run(JSON.stringify([account,route]),digest(identity),payload,action,{accountScope:account,resourceKey:payload.vin,clientKey});}
  catch(error){throw Object.assign(Error('처리 상태를 확인해야 합니다. 자동으로 다시 실행하지 않습니다.'),{status:409});}
  if(!result.executed)throw Object.assign(Error('진행 중이거나 확인이 필요한 요청입니다. 다시 실행하지 않았습니다.'),{status:409,requestState:result.reason});
  return result.result;
 };
}
module.exports={createBusinessDispatcher};
