(()=>{
 if(window.suncoIntegrated||!window.SuncoAndroid||typeof scanPhoto!=='function')return;
 window.suncoIntegrated=true;
 const originalScan=scanPhoto;let pending=null,captureTask=null,generation=0;
 const owner=()=>({task:photoTaskVersion,epoch:accountEpoch,account:activeAccount?.id,generation});
 const current=o=>!!o&&authenticated&&o.task===photoTaskVersion&&o.epoch===accountEpoch&&o.account===activeAccount?.id&&o.generation===generation;
 const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');
 function cancelNative(){generation++;captureTask=null;const job=pending;pending=null;if(job){clearTimeout(job.timer);job.reader?.abort();job.reject(Error('사진 또는 계정이 변경되어 이전 인식을 취소했습니다.'));}try{SuncoAndroid.cancelPending?.();}catch{}}
 window.addEventListener('coupon:account-changing',cancelNative);
 window.addEventListener('pagehide',cancelNative);
 window.suncoCapturePhotos={
  add(base64,name,id){if(!current(captureTask)||captureTask.id!==id)return;const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));const file=new File([bytes],name,{type:'image/jpeg'});document.querySelector('#photos').onchange({target:{files:[file],value:''}});captureTask.task=photoTaskVersion;},
  done(id){if(captureTask?.id===id)captureTask=null;},
  error(id){if(captureTask?.id!==id)return;captureTask=null;toast('촬영 사진을 가져오지 못했습니다. 사진 가져오기를 이용해주세요.');}
 };
 window.suncoNativeResult=(id,value)=>{if(!pending||pending.id!==id)return;clearTimeout(pending.timer);const job=pending;pending=null;if(!current(job.owner))return job.reject(Error('이전 사진 또는 계정의 응답입니다.'));job.resolve(value);};
 function localRead(file,nameOnly=false){return new Promise((resolve,reject)=>{
  if(pending)return reject(Error('다른 사진을 처리 중입니다.'));
  if(!authenticated||SuncoAndroid.getProtocolVersion?.()!==2)return reject(Error('안전한 휴대폰 연결 버전을 확인하지 못했습니다.'));
  const id=token(),reader=new FileReader(),job={id,resolve,reject,reader,owner:owner()};pending=job;
  function fail(error){if(pending!==job)return;clearTimeout(job.timer);pending=null;reject(error);}
  job.timer=setTimeout(()=>{if(pending===job){fail(Error('휴대폰 인식 시간이 초과됐습니다.'));try{SuncoAndroid.cancelPending?.();}catch{}}},90000);
  reader.onerror=()=>fail(Error('사진 파일을 읽지 못했습니다.'));
  reader.onload=()=>{if(pending!==job)return;if(!current(job.owner))return fail(Error('이전 사진 또는 계정입니다.'));try{if(nameOnly)SuncoAndroid.recognizeName(id,String(reader.result).split(',')[1]);else SuncoAndroid.recognize(id,String(reader.result).split(',')[1]);}catch(error){fail(error)}};
  try{reader.readAsDataURL(file);}catch(error){fail(error)}
 })}
 window.suncoReadLocalNumbers=file=>localRead(file);
 window.suncoReadCustomerName=async file=>{const result=await localRead(file,true);return result.customerName||'';};
 scanPhoto=async function(file){
  const task=photoTaskVersion,scanOwner=owner();photoStatus().textContent='휴대폰에서 번호를 읽고 있습니다…';
  let local;try{local=await localRead(file)}catch(error){local={contract:'',vin:'',customerName:''};}
  if(task!==photoTaskVersion||!current(scanOwner))return {};
  if(local.cancelled)throw Error('번호 인식을 중단했습니다. 사이트에 인증하지 않았습니다.');
  if(SuncoNumberPolicy.complete(local)){photoStatus().textContent='번호 분석을 마쳤습니다.';const verified=local.numbersVerified===true&&local.vinVerified===true&&local.requiresReview!==true&&local.contractReviewRequired!==true;
   const result={...local,customerName:'',text:'휴대폰 번호 인식 완료',recognitionSource:'phone',requiresReview:!verified};
   if(verified)approvePhotoProcessing(result,'automatic');
   return result;}
  photoStatus().textContent='불명확한 번호를 서버에서 재검사하고 있습니다…';
  let result;try{result=SuncoNumberPolicy.merge(local,await originalScan(file));}catch(error){result={contract:'',vin:'',customerName:local.customerName||'',error:'서버 재검사에 실패했습니다. 자동 인증하지 않았습니다.'};}
  if(task!==photoTaskVersion||!current(scanOwner))return {};
  photoStatus().textContent=SuncoNumberPolicy.complete(result)?'서버 재검사를 마쳤습니다.':'번호 확인이 필요합니다. 자동 인증하지 않습니다.';
  // Reference evidence stays separate from the number policy's decision.
  const reference={};for(const key of ['contractCandidates','contractReferenceCandidates','contractReferenceDiagnostics','vinCandidates','contractCrop','vinCrop','nameCrop','combinationEvidence','diagnostic'])if(local[key]!==undefined)reference[key]=local[key];
  return {...result,...reference,requiresReview:true,reviewValues:{contract:local.contract||result.contract||'',vin:local.vin||result.vin||''},text:'휴대폰 인식 후 RapidOCR 서버 재검사',recognitionSource:'phone-and-server'};
 };
 // Delegation also covers camera buttons recreated in the results panel.
 document.addEventListener('click',event=>{
  const button=event.target.closest?.('button');
  if(!button||!button.closest('#photo-upload-dialog')||!['촬영하기','연속 촬영하기'].includes(button.textContent.trim()))return;
  event.preventDefault();event.stopImmediatePropagation();
  if(button.disabled||photoBatch?.state==='processing')return;
  if(!authenticated||SuncoAndroid.getProtocolVersion?.()!==2)return toast('휴대폰 연결 버전을 확인해주세요.');
  if(captureTask)return;
  captureTask={...owner(),id:token()};SuncoAndroid.capture(captureTask.id);
 },true);
 document.querySelectorAll('.privacy').forEach(p=>p.textContent='번호는 휴대폰에서 우선 인식하고, 불명확할 때만 앱 서버에서 재검사합니다.');

// Keep server-owned authentication, completion, and result handlers unchanged.
})();
