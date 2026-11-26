const completionRulesPanel=document.createElement('section');completionRulesPanel.className='completion-rules';completionRulesPanel.hidden=true;
completionRulesPanel.innerHTML='<h2>시공 완료 선택 기준</h2><ul><li>잔여량 2.5m 미만 제외</li><li>차종별 필요 길이를 초과하는 재고 중 가장 적은 필름 선택</li><li>틴팅프로를 위에서부터 한 명씩 순환 배정 · 해당 사람의 1번만 체크</li><li>먼지털이개 지급</li><li>재고가 없으면 인증된 건은 시공중으로 유지 · 순환 순서도 유지</li></ul><p class="help">현재는 실제 재고로 선택안을 확인하는 단계입니다. 자동 완료 전송은 아직 연결 전입니다.</p>';
$('.modes').after(completionRulesPanel);
document.querySelectorAll('.mode').forEach(button=>button.addEventListener('click',()=>{completionRulesPanel.hidden=button.dataset.mode!=='complete';if(button.dataset.mode==='complete'){$('#mode-help').textContent='사진의 번호를 읽은 뒤 차종별 필요 길이와 실제 재고를 확인합니다.';$('#run').disabled=!files.length;}}));
const recognizeForAuth=$('#run').onclick;
$('#run').onclick=async()=>{
 if(mode!=='complete')return recognizeForAuth();
 if(!files.length)return;
 const task=photoTaskVersion;const selectedPhotos=files.slice();startPhotoBatch(task,selectedPhotos.length);
 const run=$('#run');run.disabled=true;run.textContent='서류를 스캔하고 있습니다…';
 try{
  const results=[];
  for(const item of selectedPhotos){const result=await scanPhoto(item.file);if(task!==photoTaskVersion)return;await certifyRecognizedPhoto(result,task);if(task!==photoTaskVersion)return;photoBatchDone(task,result);results.push({name:item.file.name,...result});if(['needs_review','notice_required','identity_conflict'].includes(result.certification?.state))break;}
  $('#review-title').textContent='시공 완료 준비';$('#review form>p').textContent='인식한 번호와 차종별 필요 길이를 확인하세요. 실제 사이트 재고로 필름 선택안을 조회하며, 이 화면은 시공 완료를 제출하지 않습니다.';
  $('#review-files').replaceChildren();
  for(const result of results){
   if(result.contract&&result.vin&&['certified','already_pending'].includes(result.certification?.state)){const status=await api('/api/vehicle-status',{contract:result.contract,vin:result.vin});if(task!==photoTaskVersion)return;if(status.state==='already_completed')result.certification={state:'already_completed',message:'이미 시공완료된 차량입니다. 추가 처리하지 않습니다.'};}

   const card=document.createElement('div');card.className='ocr-result';const title=document.createElement('strong');title.textContent=result.name;card.append(title);
   if(result.certification?.state==='vehicle_not_found'){const notice=document.createElement('p');notice.textContent='일치하는 차량정보가 없습니다. 계약자명: '+(result.customerName||'계약자명 확인 불가');card.replaceChildren(notice);$('#review-files').append(card);continue;}
   appendCertificationResult(card,result);
   if(!['certified','already_pending'].includes(result.certification?.state)){appendOcrEditors(card,result);$('#review-files').append(card);continue;}
   appendOcrEditors(card,result,()=>{const ready=!!result.contract&&/^[A-HJ-NPR-Z0-9]{11}[0-9]{6}$/.test(result.vin);card.querySelectorAll('[data-needs-identifiers]').forEach(button=>button.disabled=!ready)});
   const statusButton=document.createElement('button');statusButton.type='button';statusButton.className='account-secondary';statusButton.textContent='사이트 완료 여부 확인';statusButton.disabled=!result.contract||!result.vin;
   statusButton.onclick=async()=>{statusButton.disabled=true;try{const status=await api('/api/vehicle-status',{contract:result.contract,vin:result.vin});if(status.state==='already_completed')showAlreadyCompletedNotice({customerName:result.customerName});else toast('시공완료 여부를 확인하지 못했습니다.');}catch(error){toast(userErrorMessage(error))}finally{statusButton.disabled=false}};statusButton.dataset.needsIdentifiers='';card.append(statusButton);
   const lengthLabel=document.createElement('label');lengthLabel.className='account-label';lengthLabel.textContent='이 차량의 필요 길이(m)';const input=document.createElement('input');input.className='account-input';input.type='number';input.min='0.001';input.step='0.001';input.placeholder='차종별 길이를 입력하세요';input.setAttribute('aria-label',result.name+' 필요 길이(m)');lengthLabel.append(input);card.append(lengthLabel);
   const output=document.createElement('p');output.setAttribute('role','status');const check=document.createElement('button');check.className='account-secondary';check.type='button';check.textContent='실제 필름 재고로 선택안 확인';check.disabled=!result.contract||!result.vin;
   check.onclick=async()=>{check.disabled=true;try{const requiredMeters=input.valueAsNumber;if(!Number.isFinite(requiredMeters)||requiredMeters<=0)throw Error('차종별 필요 길이를 입력해주세요.');output.textContent='실제 재고 확인 중…';const response=await api('/api/completion-plan',{contract:result.contract,vin:result.vin,requiredMeters});const plan=response.plan;if(plan.state==='ready_to_review'){output.textContent=`틴팅프로 1: ${plan.builder.name} (${plan.builder.position}/${plan.builder.total}번째 · 완료 확인 후 다음 사람) / ${plan.film.name} / 잔여량 ${plan.film.remainingMeters}m / 필요 ${plan.requiredMeters}m / 먼지털이개 지급. 실제 등록은 아직 실행하지 않았습니다.`;}else{output.textContent=plan.message;}}catch(error){output.textContent=userErrorMessage(error)}finally{check.disabled=false}};
   check.dataset.needsIdentifiers='';card.append(check,output);$('#review-files').append(card);
  }
  $('#review-note').textContent=certificationSummary(results)+' 이미 완료된 건은 추가 처리하지 않습니다.';
  $('#review .primary').hidden=true;$('#site-reject').textContent='닫기';/* 처리 결과는 기존 사진 선택 창에 표시합니다. */;
 }catch(error){if(task===photoTaskVersion){endPhotoBatch(task,userErrorMessage(error));toast(userErrorMessage(error))}}finally{if(photoBatch?.state==='processing')endPhotoBatch(task);renderFiles();}
};
$('#review').addEventListener('close',()=>{$('#review .primary').hidden=false;$('#site-reject').textContent='거부 · 돌아가기'});

// Refresh after a completed job; login refresh is handled by the account flow.
function attachOverviewRefresh({windowTarget,documentTarget,refresh,isAuthenticated,delay=setTimeout,cancel=clearTimeout}){
 let timer=null,running=null,again=false;
 async function run(){
  if(documentTarget.visibilityState==='hidden'||!isAuthenticated())return;
  if(running){again=true;return running;}
  running=Promise.resolve().then(refresh);
  try{await running;}finally{running=null;if(again){again=false;schedule();}}
 }
 function schedule(){if(timer!==null)cancel(timer);timer=delay(()=>{timer=null;return run().catch(()=>{});},250);}
 windowTarget.addEventListener('coupon:work-completed',schedule);
 windowTarget.addEventListener('coupon:registration-completed',schedule);
 return {run,schedule,dispose(){if(timer!==null)cancel(timer);windowTarget.removeEventListener('coupon:work-completed',schedule);windowTarget.removeEventListener('coupon:registration-completed',schedule);}};
}
if(typeof window!=='undefined')attachOverviewRefresh({windowTarget:window,documentTarget:document,refresh:()=>checkSiteConnection(),isAuthenticated:()=>authenticated});
if(typeof module!=='undefined')module.exports={attachOverviewRefresh};

// Keep the primary phone screen focused on account, totals, mode and photo input.
const compactHistory=document.createElement('details');compactHistory.className='history-fold';
compactHistory.hidden=true;
const modeTitle=document.querySelector('.modes')?.previousElementSibling;
if(modeTitle?.classList.contains('section-title')){modeTitle.classList.add('mode-selection-title');modeTitle.querySelector('span')?.remove();}
const compactHistoryTitle=document.createElement('summary');compactHistoryTitle.textContent='작업 내역 보기';
const fullHistory=$('.history');fullHistory.before(compactHistory);compactHistory.append(compactHistoryTitle,fullHistory);
const compactRules=document.createElement('details'),compactRulesTitle=document.createElement('summary');compactRulesTitle.textContent='완료 선택 기준 보기';compactRules.append(compactRulesTitle);
completionRulesPanel.querySelector('h2')?.remove();while(completionRulesPanel.firstChild)compactRules.append(completionRulesPanel.firstChild);completionRulesPanel.append(compactRules);
// Keep the capture guidance directly beneath the photo picker button.
const photoCaptureHint=document.createElement('span');
photoCaptureHint.className='capture-hint';
photoCaptureHint.textContent='차대번호와 계약번호가 잘 보이게 촬영해주세요.';
document.querySelector('.upload b').after(photoCaptureHint);
// Keep gallery and rear-camera capture as separate controls.
const oldUploadLabel=document.querySelector('.upload');
const photoUploadArea=document.createElement('div');photoUploadArea.className='upload';
while(oldUploadLabel.firstChild)photoUploadArea.append(oldUploadLabel.firstChild);
oldUploadLabel.replaceWith(photoUploadArea);
photoUploadArea.querySelector('strong').textContent='썬팅쿠폰·출고봉투 사진을 올리거나 촬영해주세요';
const photoActions=document.createElement('div');photoActions.className='photo-actions';
const galleryButton=document.createElement('button');galleryButton.type='button';galleryButton.textContent='사진 가져오기';galleryButton.onclick=()=>document.querySelector('#photos').click();
const cameraButton=document.createElement('button');cameraButton.type='button';cameraButton.textContent='촬영하기';
const cameraInput=document.createElement('input');cameraInput.type='file';cameraInput.id='camera-photo';cameraInput.accept='image/jpeg,image/png,image/webp';cameraInput.setAttribute('capture','environment');cameraInput.hidden=true;
cameraInput.onchange=event=>document.querySelector('#photos').onchange(event);
cameraButton.onclick=()=>cameraInput.click();
photoActions.append(galleryButton,cameraButton);
photoUploadArea.querySelector('b').replaceWith(photoActions);
photoUploadArea.after(cameraInput);


// Called only after a site response confirms that this vehicle was completed earlier.
function showAlreadyCompletedNotice({customerName}={}){
 const name=typeof customerName==='string'?customerName.trim():'';
 const dialog=document.querySelector('#review');
 document.querySelector('#review-title').textContent='이미 시공완료';
 document.querySelector('#review form>p').textContent='이미 시공완료 처리된 차량입니다.';
 const body=document.querySelector('#review-files');body.replaceChildren();
 const customer=document.createElement('p');customer.textContent=name?'계약자명: '+name:'계약자명을 읽지 못했습니다.';body.append(customer);
 document.querySelector('#review-note').textContent='';
 document.querySelector('#review .primary').hidden=true;
 document.querySelector('#site-reject').textContent='확인';
 if(!dialog.open)dialog.showModal();
}
window.addEventListener('coupon:already-completed',event=>showAlreadyCompletedNotice(event.detail));
// Each task starts fresh; files are retained only while its dialog stays open.
const photoWorkflow=document.querySelector('#photos').closest('section');
const photoDialog=document.createElement('dialog');photoDialog.id='photo-upload-dialog';photoDialog.className='photo-upload-dialog';
photoDialog.setAttribute('aria-labelledby','photo-task-title');
photoDialog.innerHTML='<div class="photo-dialog-heading"><h2 id="photo-task-title">시공 인증만</h2><button type="button" aria-label="사진 선택 창 닫기">×</button></div><p class="photo-dialog-subtitle">계약번호·차대번호를 확인할 사진을 선택해주세요.</p>';
const photoWarning=document.createElement('p');photoWarning.className='photo-registration-warning';photoWarning.innerHTML='<strong class="registration-warning-title"><span aria-hidden="true">⚠</span> 시공권 선등록 주의</strong><span class="registration-warning-message">시공권 선등록 경고 누적은 <b>승인 해지 대상</b>임을 알려드립니다.</span>';
photoWorkflow.hidden=false;const photoPrivacy=document.querySelector('.privacy');photoPrivacy.hidden=false;
photoDialog.append(photoWorkflow,photoWarning,document.querySelector('#run'),photoPrivacy);document.body.append(photoDialog);
function certificationInFlight(){return photoBatch?.state==='processing'&&photoBatch.phase==='사이트 중복 확인·인증 중';}
photoDialog.querySelector('.photo-dialog-heading button').onclick=()=>{if(certificationInFlight()){toast('사이트 처리 결과를 확인 중입니다. 확인이 끝난 뒤 닫아주세요.');return;}photoDialog.close();};
photoDialog.addEventListener('cancel',event=>{if(certificationInFlight()){event.preventDefault();toast('사이트 처리 결과를 확인한 뒤 닫아주세요.');}});
photoDialog.addEventListener('close',()=>{resetPhotos();document.querySelectorAll('.mode').forEach(button=>{button.classList.remove('active');button.setAttribute('aria-pressed','false')})});
document.querySelectorAll('.mode').forEach(button=>{button.classList.remove('active');button.setAttribute('aria-pressed','false');button.addEventListener('click',()=>{resetPhotos();document.querySelector('#photo-task-title').textContent=button.dataset.mode==='auth'?'시공 인증만':'시공 완료까지';if(!photoDialog.open)photoDialog.showModal();})});



// Use the phone's native photo capture so its orientation metadata is preserved.
(()=>{
 const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';input.setAttribute('capture','environment');input.hidden=true;document.body.append(input);
 const dialog=document.createElement('dialog');dialog.className='continuous-camera';dialog.setAttribute('aria-label','촬영 사진 확인');
 dialog.innerHTML='<div class="camera-heading"><strong>촬영 사진 확인</strong><button type="button" data-camera="close" aria-label="촬영 취소">×</button></div><p class="camera-status" role="status">휴대폰 기본 카메라로 촬영합니다.</p><div class="camera-thumbnails" aria-label="촬영한 사진"></div><div class="camera-controls"><button type="button" data-camera="shutter">추가 촬영</button><button type="button" data-camera="done" disabled>완료 · 스캔</button></div>';
 document.body.append(dialog);const status=dialog.querySelector('.camera-status'),thumbnails=dialog.querySelector('.camera-thumbnails'),shutter=dialog.querySelector('[data-camera="shutter"]'),done=dialog.querySelector('[data-camera="done"]');
 let pending=[],taking=false,generation=0;
 function draw(){thumbnails.replaceChildren();pending.forEach((photo,index)=>{const item=document.createElement('div'),img=document.createElement('img'),save=document.createElement('a'),remove=document.createElement('button');img.src=photo.url;img.alt=(index+1)+'번째 촬영 사진';save.href=photo.url;save.download=photo.file.name;save.textContent='원본 저장';save.style.cssText='display:block;color:white;padding:6px 0;text-align:center';remove.type='button';remove.textContent='삭제';remove.disabled=taking;remove.onclick=()=>{URL.revokeObjectURL(photo.url);pending.splice(index,1);draw();};item.append(img,save,remove);thumbnails.append(item);});shutter.disabled=taking;done.disabled=taking||!pending.length;done.textContent=pending.length?'완료 · '+pending.length+'장 스캔':'완료 · 스캔';}
 function close(){generation++;pending.forEach(photo=>URL.revokeObjectURL(photo.url));pending=[];taking=false;if(dialog.open)dialog.close();}
 window.openCouponCamera=()=>{if(photoBatch?.state==='processing')return;if(!dialog.open){pending=[];taking=false;dialog.showModal();draw();}if(!taking)input.click();};
 cameraButton.onclick=window.openCouponCamera;cameraInput.addEventListener('click',event=>{event.preventDefault();window.openCouponCamera();});shutter.onclick=()=>{if(!taking)input.click();};
 input.onchange=async()=>{const file=input.files?.[0],token=generation;input.value='';if(!file)return;taking=true;const photo={file,url:URL.createObjectURL(file)};pending.push(photo);draw();try{if(!window.couponSaveCapture)throw Error('archive unavailable');await window.couponSaveCapture(file);if(token===generation)status.textContent=pending.length+'장 촬영했습니다. 기본 카메라 원본을 이 기기에 보관했습니다.';}catch{if(token===generation)status.textContent='원본 자동 보관에 실패했습니다. 원본 저장을 눌러주세요.';}finally{if(token===generation){taking=false;draw();}}};
 done.onclick=()=>{if(taking||!pending.length)return;const selected=pending.map(photo=>photo.file);close();document.querySelector('#photos').onchange({target:{files:selected,value:''}});const run=document.querySelector('#run');if(!run.disabled)run.click();};
 dialog.querySelector('[data-camera="close"]').onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('close',()=>{if(pending.length)close();});window.addEventListener('pagehide',close);
})();
