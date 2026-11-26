// Shared by gallery and camera. Preserve original bytes and EXIF during upload.
async function scanPhoto(file){
 const task=photoTaskVersion;if(photoBatch?.task===task){photoBatch.phase='번호 분석 중';renderFiles();}const started=performance.now();const status=photoStatus();
 status.textContent='사진을 서버로 보내고 있습니다…';
 try{return await new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest();xhr.open('POST','/api/recognize');xhr.timeout=120000;
  xhr.setRequestHeader('Content-Type',file.type||'application/octet-stream');
  xhr.upload.onprogress=e=>{if(task!==photoTaskVersion)return;status.textContent='사진을 서버로 보내고 있습니다…'};
  xhr.upload.onload=()=>{if(task!==photoTaskVersion)return;status.textContent='사진 전송을 마쳤습니다. 서버에서 글자를 읽고 있습니다…'};
  const fail=(message,code)=>{window.couponRecordError?.('recognize',code,xhr.status||null);reject(Error(message))};
  xhr.onerror=()=>fail('사진 전송 연결이 끊겼습니다. 인터넷 연결을 확인하고 다시 시도해주세요.','NETWORK_FAILED');
  xhr.ontimeout=()=>fail('사진 전송 또는 서버 인식이 120초를 넘었습니다. 다시 시도해주세요.','TIMEOUT');
  xhr.onabort=()=>fail('사진 전송이 취소됐습니다. 다시 시도해주세요.','NETWORK_FAILED');
  xhr.onload=()=>{if(task!==photoTaskVersion){resolve({});return;}let result;try{result=JSON.parse(xhr.responseText)}catch{return fail('서버에서 사진 인식 결과를 받지 못했습니다. 다시 시도해주세요.','OCR_INVALID_RESPONSE')}
   if(xhr.status<200||xhr.status>=300)return fail((result.error||'사진 인식 요청에 실패했습니다.')+(result.errorId?' 오류번호: '+result.errorId:''),result.errorCode||'REQUEST_FAILED');
   result.clientTiming={totalMs:Math.round(performance.now()-started),originalBytes:file.size};
   const missing=['contract','vin','customerName'].some(k=>!result[k]);
   status.textContent=missing?'읽지 못한 항목이 있습니다. 결과 화면에서 직접 수정할 수 있습니다.':'사진 분석을 마쳤습니다.';
   resolve(result);
  };xhr.send(file);
 })}catch(error){if(task===photoTaskVersion)status.textContent=error.message;throw error}
}
function photoStatus(){let p=document.querySelector('#photo-status');if(!p){p=document.createElement('p');p.id='photo-status';p.setAttribute('role','status');document.querySelector('#files').after(p)}return p}
function appendOcrEditors(card,result,onChange=()=>{}){
 for(const [key,label] of [['contract','계약번호'],['vin','차대번호'],['customerName','계약자명']]){
  const wrap=document.createElement('label');wrap.className='account-label';wrap.textContent=label;
  const input=document.createElement('input');input.className='account-input';input.type='text';input.value=result[key]||'';input.setAttribute('aria-label',label);input.autocomplete='off';input.spellcheck=false;
  if(key!=='customerName')input.autocapitalize='characters';
  const hint=document.createElement('small');hint.setAttribute('role','status');
  const validate=()=>{const value=key==='customerName'?input.value.trim():input.value.replace(/\s/g,'').toUpperCase();result[key]=value;
   const valid=key==='vin'?/^[A-HJ-NPR-Z0-9]{11}[0-9]{6}$/.test(value):key==='contract'?/^(?:[A-Z][0-9]{4}|[A-Z]{2}[0-9]{3})[A-Z][A-Z0-9][0-9]{6}$/.test(value):!!value;
   hint.textContent=!value?'인식하지 못했습니다. 원본을 보고 입력해주세요.':!valid?(key==='vin'?'차대번호 17자리와 영문·숫자를 확인해주세요.':'계약번호 영문·숫자 전체를 확인해주세요.'):'원본과 대조해주세요.';
   input.setAttribute('aria-invalid',String(!valid));onChange();};
  input.oninput=validate;wrap.append(input,hint);card.append(wrap);validate();
 }
 if(result.error){const p=document.createElement('p');p.textContent=result.error;card.append(p)}
}

const photoProcessingApprovals=new WeakMap();
function approvePhotoProcessing(result,source){
 photoProcessingApprovals.set(result,{source,task:photoTaskVersion,epoch:accountEpoch,
  account:activeAccount?.id,mode,contract:result.contract,vin:result.vin});
}
async function certifyRecognizedPhoto(result,task){
 if(task!==photoTaskVersion)return;
 if(!/^(?:[A-Z][0-9]{4}|[A-Z]{2}[0-9]{3})[A-Z][A-Z0-9][0-9]{6}$/.test(result.contract||'')||!/^[A-HJ-NPR-Z0-9]{11}[0-9]{6}$/.test(result.vin||'')){
  window.couponRecordError?.('recognize','OCR_NUMBERS_MISSING');
  result.certification={state:'invalid_numbers',message:'번호 인식이 불확실하여 사이트에 인증하지 않았습니다.'};return;
 }
 const approval=photoProcessingApprovals.get(result);
 if(result.requiresReview===true||!approval||!authenticated||approval.task!==task||
    approval.epoch!==accountEpoch||approval.account!==activeAccount?.id||approval.mode!==mode||
    approval.contract!==result.contract||approval.vin!==result.vin){
  result.certification={state:'invalid_numbers',message:'번호 검토가 필요하여 사이트에 인증하지 않았습니다.'};return;
 }
 photoProcessingApprovals.delete(result);
 if(photoBatch?.task===task){photoBatch.phase='사이트 중복 확인·인증 중';renderFiles();}
 const knownRegistered=['R3126GN000019','R3125FX000305','A5325AX039809','R3126NX000013','EE126GL000059','EE126W2000077','R3126DN000044','R3126DN000040','EE126MQ000208','A3726GN000126'];
 // User explicitly identified these ten documents as already authenticated: read only.
 result.certification=await api(knownRegistered.includes(result.contract)?'/api/certification/lookup':'/api/certification/execute',{contract:result.contract,vin:result.vin});
 if(knownRegistered.includes(result.contract)&&result.certification.state==='not_found')result.certification={state:'needs_review',message:'사용자가 이미 인증한 서류입니다. 조회에서 찾지 못해도 재인증하지 않습니다.'};
 if(!result.certification.message)result.certification.message=result.certification.state==='already_completed'?'이미 시공완료된 차량입니다. 재인증하지 않았습니다.':result.certification.state==='already_pending'?'이미 시공중으로 등록된 차량입니다. 재인증하지 않았습니다.':'사이트 상태를 확인해주세요. 재인증하지 않았습니다.';
 if(task!==photoTaskVersion)return;
 if(result.certification.state==='notice_required')window.dispatchEvent(new CustomEvent('coupon:notice',{detail:{unread:true}}));
 const after=result.certification.after;if(Number.isSafeInteger(after?.inProgress))document.querySelector('#count-progress').textContent=after.inProgress.toLocaleString('ko-KR')+'건';
}
function appendCertificationResult(card,result){
 const cert=result.certification;if(!cert)return;
 const titles={vehicle_not_found:'일치하는 차량정보가 없습니다.',certified:'시공 인증 완료',already_pending:'기존 시공중 · 재인증 생략',already_completed:'이미 시공완료 · 재인증 생략',already_other:'기존 등록 건 · 재인증 생략',protected:'재인증 금지 서류',invalid_numbers:'번호 확인 필요',identity_conflict:'기존 번호와 충돌 · 확인 필요',notice_required:'필수 공지 확인 필요',needs_review:'사이트 처리 결과 확인 필요'};
 const title=document.createElement('strong');title.textContent=titles[cert.state]||'사이트 확인 필요';const message=document.createElement('p');message.textContent=cert.message;card.append(title,message);
 if(cert.vehicle){const p=document.createElement('p');p.textContent=`차종: ${cert.vehicle.car} · 시공가: ${cert.vehicle.amount.toLocaleString('ko-KR')}원`;card.append(p);}
 if(cert.before&&cert.after){const p=document.createElement('p');p.textContent=`시공중 ${cert.before.inProgress}건 → ${cert.after.inProgress}건`;card.append(p);}
}

function certificationSummary(results){
 const count=state=>results.filter(r=>r.certification?.state===state).length;
 if(results.length&&count('already_completed')===results.length)return `${results.length}건 모두 이미 시공완료된 건입니다. 신규 인증은 하지 않았습니다.`;
 const known=['certified','already_pending','already_completed'];const review=results.filter(r=>!known.includes(r.certification?.state)).length;
 return `신규 인증 ${count('certified')}건 · 이미 시공중 ${count('already_pending')}건 · 이미 시공완료 ${count('already_completed')}건`+(review?` · 확인 필요 ${review}건`:'');
}
