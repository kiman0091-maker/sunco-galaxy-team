let mode='auth', files=[], history=[];
let photoTaskVersion=0;
let photoBatch=null;let photoPickerCollapsed=false;
const $=s=>document.querySelector(s);
let activeAccount=null;
const accountHistories=new Map();
document.title='썬쿠 · 쿠폰 등록';

$('.brand').firstChild.textContent='썬쿠';
const accountPanel=document.createElement('section');
accountPanel.className='account-panel';
accountPanel.innerHTML=`<div class="section-title"><h2>내 시공점 계정</h2><span>사이트 로그인 정보</span></div><div class="account-card"><div class="account-avatar">♙</div><div><strong id="account-name">계정을 입력해주세요</strong><small id="account-status">각 시공점의 아이디로 사용해요</small></div><button id="account-open" type="button">계정 입력</button></div>`;
$('main').prepend(accountPanel);
const accountDialog=document.createElement('dialog');
accountDialog.id='account-dialog';
accountDialog.innerHTML=`<form id="account-form" autocomplete="off"><div class="modal-top"><span class="eyebrow">시공점 계정 입력</span><button id="account-close" type="button" aria-label="닫기">×</button></div><h2>내 계정으로 시작하세요</h2><p>티비썬팅 사이트에서 사용하는 계정입니다.<br>샘플 체험에는 가상의 정보를 입력하세요.</p><label class="account-label" for="store-name">시공점 이름 <small>선택</small></label><input id="store-name" class="account-input" maxlength="60" placeholder="예: 우리매장"><label class="account-label" for="site-id">사이트 아이디</label><input id="site-id" class="account-input" maxlength="100" required autocapitalize="none" spellcheck="false" placeholder="시공점 아이디"><label class="account-label" for="site-password">사이트 비밀번호</label><div class="password-field"><input id="site-password" class="account-input" type="password" maxlength="200" required placeholder="비밀번호"><button id="password-toggle" type="button" aria-pressed="false">보기</button></div><p class="account-disclaimer">실제 로그인 전의 입력 화면입니다. 비밀번호는 저장·전송하지 않고, 창을 닫으면 지웁니다.</p><button class="primary" type="submit">이 계정으로 샘플 체험 <span>→</span></button><button id="account-logout" class="account-logout" type="button" hidden>현재 계정 나가기</button></form>`;
document.body.append(accountDialog);
function resetPhotos(){photoTaskVersion++;photoBatch=null;photoPickerCollapsed=false;files.forEach(item=>URL.revokeObjectURL(item.url));files=[];$('#photos').value='';const camera=document.querySelector('#camera-photo');if(camera)camera.value='';document.querySelector('#review-files')?.replaceChildren();const status=document.querySelector('#photo-status');if(status)status.textContent='';renderFiles();}
function drawAccountHistory(){
  $('#history').replaceChildren();
  if(!history.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='이 계정의 검증된 실제 작업 내역이 없습니다.';$('#history').append(empty);}
  history.forEach(item=>{const row=document.createElement('div');row.className='history-row';const p=document.createElement('div');p.textContent=`${item.mode==='auth'?'시공 인증':'시공 완료'} · 사진 ${item.count}장`;const small=document.createElement('small');small.textContent=`${item.time} · 흐름 체험만 진행 / 사이트 미등록`;p.append(small);const badge=document.createElement('span');badge.className='badge';badge.textContent='샘플 확인';row.append(p,badge);$('#history').append(row)});
  $('#history-count').textContent=`${history.length}건`;
}
function refreshAccount(){
  $('#account-name').textContent=activeAccount?activeAccount.name:'계정을 입력해주세요';
  $('#account-status').textContent=activeAccount?`${activeAccount.id} · 샘플 선택 / 실제 로그인 미확인`:'각 시공점의 아이디로 사용해요';
  $('#account-open').textContent=activeAccount?'계정 변경':'계정 입력';
  $('#account-logout').hidden=!activeAccount;
  drawAccountHistory();
}
$('#account-open').onclick=()=>{$('#account-form').reset();$('#site-password').type='password';$('#password-toggle').textContent='보기';$('#password-toggle').setAttribute('aria-pressed','false');accountDialog.showModal()};
$('#account-close').onclick=()=>accountDialog.close();
accountDialog.addEventListener('close',()=>{$('#account-form').reset();$('#site-password').type='password';$('#password-toggle').textContent='보기';$('#password-toggle').setAttribute('aria-pressed','false')});
$('#password-toggle').onclick=()=>{const visible=$('#site-password').type==='password';$('#site-password').type=visible?'text':'password';$('#password-toggle').textContent=visible?'숨기기':'보기';$('#password-toggle').setAttribute('aria-pressed',String(visible))};
$('#account-form').onsubmit=e=>{e.preventDefault();const id=$('#site-id').value.trim();if(!id){$('#site-id').setCustomValidity('아이디를 입력해주세요.');$('#site-id').reportValidity();return}activeAccount={id,name:$('#store-name').value.trim()||id};if(!accountHistories.has(id))accountHistories.set(id,[]);history=accountHistories.get(id);resetPhotos();refreshAccount();accountDialog.close();toast('샘플 계정을 선택했어요. 실제 로그인은 연결 전입니다.')};
$('#site-id').oninput=()=>$('#site-id').setCustomValidity('');
$('#account-logout').onclick=()=>{activeAccount=null;history=[];resetPhotos();refreshAccount();accountDialog.close();toast('계정에서 나왔어요.')};
function startPhotoBatch(task,total){if(task!==photoTaskVersion)return;photoBatch={task,total,done:0,needsReview:0,vehicleNotFound:[],certified:0,skipped:0,alreadyPending:0,alreadyCompleted:0,otherExisting:0,state:'processing'};renderFiles();}
function photoBatchDone(task,result){if(task!==photoTaskVersion||photoBatch?.task!==task)return;photoBatch.done++;const cert=result.certification;if(['needs_review','notice_required','identity_conflict'].includes(cert?.state)){photoBatch.stopReason=cert.message||'사이트 처리 결과를 확인하지 못했습니다. 재전송하지 말고 확인해주세요.';const status=document.querySelector('#photo-status');if(status)status.textContent=photoBatch.stopReason;}if(cert?.state==='vehicle_not_found')photoBatch.vehicleNotFound.push(result.customerName||'계약자명 확인 불가');if(cert?.state==='certified')photoBatch.certified++;else if(['already_pending','already_completed','already_other','protected'].includes(cert?.state)){photoBatch.skipped++;if(cert.state==='already_pending')photoBatch.alreadyPending++;else if(cert.state==='already_completed')photoBatch.alreadyCompleted++;else photoBatch.otherExisting++;}else if(cert||['contract','vin'].some(key=>!result[key]))photoBatch.needsReview++;renderFiles();}
function endPhotoBatch(task,error=false){if(task!==photoTaskVersion||photoBatch?.task!==task)return;photoBatch.error=typeof error==='string'?error:(photoBatch.stopReason||'');photoBatch.state=error?'error':photoBatch.done<photoBatch.total?'stopped':'complete';renderFiles();}
function renderFiles(){
 const run=$('#run');run.remove();const box=$('#files');box.replaceChildren();const batch=photoBatch?.task===photoTaskVersion?photoBatch:null;const busy=batch?.state==='processing';
 const picker=document.querySelector('#photo-upload-section .upload');if(picker)picker.hidden=!!batch||(photoPickerCollapsed&&files.length>0);
 if(files.length){
  const panel=document.createElement('div');panel.className='photo-batch-summary';panel.setAttribute('role','status');panel.setAttribute('aria-live','polite');
  const title=document.createElement('strong'),detail=document.createElement('p');
  if(batch){
   const percent=Math.floor(batch.done/batch.total*100);
   title.textContent=busy?(batch.done<batch.total?`${batch.total}장 중 ${batch.done}장 완료 · ${batch.done+1}번째 ${batch.phase||'분석 중'}`:`${batch.total}장 처리 결과 · 결과 확인 중`):['error','stopped'].includes(batch.state)?`${batch.total}장 중 ${batch.done}장 완료 · 처리 중단`:`${batch.total}장 처리 결과`;
   const progress=document.createElement('progress');progress.max=batch.total;progress.value=batch.done;progress.setAttribute('aria-label','사진 분석 진행률');panel.append(title,progress);
   detail.textContent=`${percent}% · 신규 인증 ${batch.certified}건 · 이미 시공중 ${batch.alreadyPending}건 · 이미 시공완료 ${batch.alreadyCompleted}건`+(batch.otherExisting?` · 그 외 기존 등록 ${batch.otherExisting}건`:'')+(batch.needsReview?` · 확인 필요 ${batch.needsReview}건`:'');
  }else{title.textContent=`사진 ${files.length}장 선택됨`;detail.textContent='스캔을 시작하면 처리 과정을 보여드립니다.';panel.append(title);}
  panel.append(detail);
  if(batch?.error){const failure=document.createElement('p');failure.className='login-error';failure.setAttribute('role','alert');failure.textContent=batch.error;panel.append(failure);}
  for(const name of batch?.vehicleNotFound||[]){const notice=document.createElement('p');notice.textContent='일치하는 차량정보가 없습니다. 계약자명: '+name;panel.append(notice);}
  if(!busy&&batch){const actions=document.createElement('div');actions.className='photo-actions';for(const [label,id] of [['사진 가져오기','photos'],['촬영하기','camera-photo']]){const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=()=>document.getElementById(id)?.click();actions.append(button);}panel.append(actions);}
  panel.append(run);box.append(panel);
 }
 for(const id of ['photos','camera-photo']){const input=document.getElementById(id);if(input)input.disabled=!!busy;}
 if(!run.isConnected)box.append(run);run.hidden=!files.length||batch?.state==='complete';run.disabled=!files.length||!!busy;run.textContent=busy?'서류를 스캔하고 있습니다…':files.length?'스마트 스캔 시작':'사진을 먼저 올려주세요';
}
document.querySelectorAll('.mode').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;document.querySelectorAll('.mode').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b))});$('#upload-title').textContent=mode==='auth'?'출고 서류를 올려주세요':'완료 처리용 사진을 올려주세요';$('#mode-help').textContent=mode==='auth'?'차대번호와 계약번호가 잘 보이게 촬영해주세요.':'완료용 사진과 필수 항목은 추후 설명에 맞춰 연결합니다.';$('#step-name').innerHTML=mode==='auth'?'시공 인증<small>같은 계약번호는 중복 방지</small>':'기존 건 연결<small>인증된 작업과 사진 연결</small>';$('#step-result').textContent=mode==='auth'?'시공중 건수 증가 확인':'완료 결과 확인';renderFiles()});
function toast(text){$('#toast').textContent=text;$('#toast').style.display='block';clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>$('#toast').style.display='none',4000)}
$('#photos').onchange=e=>{const selected=Array.from(e.target.files);if(selected.length&&photoBatch&&photoBatch.state!=='processing'){resetPhotos();photoPickerCollapsed=true;}for(const file of selected){if(!['image/jpeg','image/png','image/webp'].includes(file.type)){toast('JPG, PNG, WEBP 사진을 선택해주세요.');continue}if(file.size>20*1024*1024){toast('사진 한 장은 20MB 이하로 선택해주세요.');continue}if(files.some(x=>x.file.name===file.name&&x.file.size===file.size&&x.file.lastModified===file.lastModified)){toast('이미 선택한 사진입니다.');continue}files.push({file,url:URL.createObjectURL(file)})}e.target.value='';renderFiles()};
$('#run').onclick=()=>{$('#review-title').textContent=mode==='auth'?'시공 인증 흐름 체험':'시공 완료 흐름 체험';$('#review-files').replaceChildren();files.forEach(item=>{const p=document.createElement('p');p.textContent='첨부 · '+item.file.name;$('#review-files').append(p)});$('#review-note').textContent=mode==='auth'?'실제 연동 시: 번호 인식 → 계약번호 중복 확인 → 시공 인증 → 차종·시공가 및 시공중 건수 확인':'실제 연동 시: 기존 인증 건 찾기 → 사진·필수 시공 정보 확인 → 선택한 건 완료 처리. 필수 항목은 임의로 선택하지 않습니다.';$('#review').showModal()};
$('#review').addEventListener('close',()=>{if($('#review').returnValue!=='confirm')return;history.unshift({mode,count:files.length,time:new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})});$('#history').replaceChildren();history.forEach(item=>{const row=document.createElement('div');row.className='history-row';const p=document.createElement('div');p.textContent=`${item.mode==='auth'?'시공 인증':'시공 완료'} · 사진 ${item.count}장`;const small=document.createElement('small');small.textContent=`${item.time} · 흐름 체험만 진행 / 사이트 미등록`;p.append(small);const badge=document.createElement('span');badge.className='badge';badge.textContent='샘플 확인';row.append(p,badge);$('#history').append(row)});$('#history-count').textContent=`${history.length}건`;toast('샘플 흐름을 확인했어요. 실제 등록은 하지 않았습니다.');});
const startSample=$('#run').onclick;
$('#run').onclick=()=>{if(!activeAccount){toast('먼저 사용할 시공점 계정을 입력해주세요.');$('#account-open').click();return}startSample()};
refreshAccount();








