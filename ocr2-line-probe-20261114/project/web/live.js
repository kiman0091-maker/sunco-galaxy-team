function userErrorMessage(error){const message=typeof error?.message==='string'?error.message:'';if(/fetch|network|load failed|eacces|econn|enotfound/i.test(message))return '사이트에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.';if(/timeout|timed out|abort/i.test(message))return '응답이 늦어지고 있습니다. 잠시 후 다시 시도해주세요.';return /[가-힣]/.test(message)?message:'처리 중 문제가 발생했습니다. 다시 시도해주세요.'}
// The device vault never stores a plaintext password or its unlocking passphrase.
const VAULT_KEY='coupon.credentials.v1';let authenticated=false;
let browserLoginCredentials=null;
// Scope every asynchronous response to the account transition that started it.
let accountEpoch=0,overviewFlight=null,accountChangeFlight=Promise.resolve();
function staleAccountResponse(){const error=Error('계정이 변경되어 이전 응답을 사용하지 않습니다.');error.accountStale=true;return error;}
function beginAccountChange(){
 accountEpoch++;for(const controller of requestControllers)controller.abort();authenticated=false;browserLoginCredentials=null;sessionRecovery=null;overviewFlight=null;
 window.dispatchEvent(new CustomEvent('coupon:account-changing',{detail:{epoch:accountEpoch}}));
 activeAccount=null;history=[];resetPhotos();refreshAccount();resetSettlement();vaultButtons();
 document.body.classList.add('login-locked');
 window.dispatchEvent(new CustomEvent('coupon:site-refresh',{detail:{state:'unavailable'}}));
 window.dispatchEvent(new CustomEvent('coupon:notice',{detail:{reset:true}}));
 return accountEpoch;
}
function accountChange(action){const recovery=sessionRecovery;const epoch=beginAccountChange();const job=Promise.all([accountChangeFlight.catch(()=>{}),Promise.resolve(recovery).catch(()=>{})]).then(()=>{if(epoch!==accountEpoch)throw staleAccountResponse();return action(epoch);});accountChangeFlight=job;return job;}
const encode64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
const decode64=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
async function vaultKey(pin,salt){const source=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:310000},source,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
async function saveVault(pin,credentials){const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));const key=await vaultKey(pin,salt);const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(credentials)));localStorage.setItem(VAULT_KEY,JSON.stringify({version:1,salt:encode64(salt),iv:encode64(iv),data:encode64(data)}))}
async function openVault(pin){const stored=JSON.parse(localStorage.getItem(VAULT_KEY));if(stored?.version!==1)throw new Error('저장 정보를 읽을 수 없습니다.');const key=await vaultKey(pin,decode64(stored.salt));const data=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode64(stored.iv)},key,decode64(stored.data));return JSON.parse(new TextDecoder().decode(data))}
let sessionRecovery=null,sessionVersion=0;
const requestControllers=new Set(),readFlights=new Map(),writeFlights=new Map();
// Explicit read contracts only. Every other business route is non-replayable.
const readOnlyRoutes=new Set(['/api/site-overview','/api/certification/lookup','/api/vehicle-status','/api/film-stock','/api/completion-plan','/api/completion-test/status','/api/notices']);
// These explicit actions do not submit certification/completion. They may be
// reopened by the user, but a failed response is never replayed automatically.
const explicitAuxiliaryRoutes=new Set(['/api/notice-content','/api/error-record','/api/completion-test/prepare']);
const WRITE_RECEIPTS='sunco.request-receipts.v1',MAX_WRITE_RECEIPTS=256,REQUEST_TIMEOUT_MS=30000;
function requestError(message,flags={}){return Object.assign(Error(message),flags);}
function canonicalRequest(value){if(Array.isArray(value))return value.map(canonicalRequest);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalRequest(value[key])]));return value;}
async function writeReceiptKey(url,data,account){const bytes=new TextEncoder().encode(JSON.stringify([account,url,canonicalRequest(data)]));const digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');}
function writeReceipts(){try{const stored=JSON.parse(sessionStorage.getItem(WRITE_RECEIPTS)||'{}');if(!stored||Array.isArray(stored)||typeof stored!=='object')throw Error();return stored;}catch{throw requestError('중복 요청 보호 기록을 확인하지 못했습니다. 업무를 전송하지 않습니다.',{requestBlocked:true});}}
function recordWrite(key,state){const receipts=writeReceipts();if(!Object.hasOwn(receipts,key)&&Object.keys(receipts).length>=MAX_WRITE_RECEIPTS)throw requestError('처리 확인이 필요한 요청이 많습니다. 업무 전송을 중단합니다.',{requestBlocked:true});receipts[key]={state};try{sessionStorage.setItem(WRITE_RECEIPTS,JSON.stringify(receipts));}catch{throw requestError('중복 요청 보호 기록을 저장하지 못했습니다. 업무를 전송하지 않습니다.',{requestBlocked:true});}}
async function requestOnce(url,data,epoch,write=false,receiptKey=null){
 const controller=new AbortController();requestControllers.add(controller);const timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
 try{
  const response=await fetch(url,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,headers:{'Content-Type':'application/json',...(receiptKey?{'Idempotency-Key':receiptKey}:{})},body:JSON.stringify(data)});
  if(epoch!==accountEpoch)throw staleAccountResponse();
  let result;try{result=await response.json()}catch{throw requestError(write?'처리 결과를 확인하지 못했습니다. 자동 재전송하지 않습니다.':'앱 서버 응답을 읽지 못했습니다.',{requestUnknown:write});}
  if(epoch!==accountEpoch)throw staleAccountResponse();return {response,result};
 }catch(error){if(epoch!==accountEpoch)throw staleAccountResponse();if(write)throw requestError('처리 결과를 확인하지 못했습니다. 상태를 확인해주세요. 자동 재전송하지 않습니다.',{requestUnknown:true});throw error;}
 finally{clearTimeout(timer);requestControllers.delete(controller);}
}
async function api(url,data,recovered=false){
 const epoch=accountEpoch,version=sessionVersion;
 if(typeof url!=='string'||!/^\/api\/[a-z0-9/_-]+$/i.test(url))throw requestError('허용되지 않은 요청 경로입니다.',{requestBlocked:true});
 const authRoute=url==='/api/login'||url==='/api/logout',read=readOnlyRoutes.has(url),auxiliary=explicitAuxiliaryRoutes.has(url),write=!authRoute&&!read&&!auxiliary;
 const body=JSON.parse(JSON.stringify(data??{}));
 if(write){
  const account=activeAccount?.id;if(!authenticated||!account)throw requestError('로그인 상태를 확인해주세요. 업무를 전송하지 않습니다.',{requestBlocked:true});
  const key=await writeReceiptKey(url,body,account);if(epoch!==accountEpoch)throw staleAccountResponse();
  if(writeFlights.has(key))throw requestError('같은 요청을 처리 중입니다. 다시 전송하지 않습니다.',{requestDuplicate:true});
  if(Object.hasOwn(writeReceipts(),key))throw requestError('이미 요청했거나 결과 확인이 필요한 건입니다. 다시 전송하지 않습니다.',{requestDuplicate:true});
  recordWrite(key,'pending');
  const job=requestOnce(url,body,epoch,true,key);writeFlights.set(key,job);
  try{const {response,result}=await job;
   if(!response.ok){recordWrite(key,'unknown');throw requestError('업무 처리 결과를 확인해야 합니다. 자동 재전송하지 않습니다.',{status:response.status,requestUnknown:true});}
   recordWrite(key,'answered');return result;
  }catch(error){recordWrite(key,'unknown');throw error;}
  finally{if(writeFlights.get(key)===job)writeFlights.delete(key);}
 }
 const key=JSON.stringify([epoch,url,canonicalRequest(body)]);
 if(read&&!recovered&&readFlights.has(key))return readFlights.get(key);
 const job=(async()=>{
  const {response,result}=await requestOnce(url,body,epoch,auxiliary);
  if(read&&response.status===401&&!recovered&&browserLoginCredentials&&!/앱 접속 인증/.test(result.error||'')){
   if(sessionVersion===version){
    if(!sessionRecovery){const credentials={...browserLoginCredentials};const recovery=api('/api/login',credentials,true).then(login=>{if(epoch!==accountEpoch)throw staleAccountResponse();if(!login.authenticated||login.id!==credentials.id||activeAccount?.id!==credentials.id)throw requestError('사이트 로그인 계정을 확인하지 못했습니다.');authenticated=true;sessionVersion++;}).catch(error=>{if(epoch===accountEpoch)beginAccountChange();throw error;}).finally(()=>{if(sessionRecovery===recovery)sessionRecovery=null;});sessionRecovery=recovery;}
    await sessionRecovery;
   }
   if(epoch!==accountEpoch)throw staleAccountResponse();return api(url,body,true);
  }
  if(!response.ok)throw requestError(result.error||'요청을 처리하지 못했습니다.',{status:response.status});return result;
 })();
 if(read&&!recovered)readFlights.set(key,job);
 try{return await job;}finally{if(readFlights.get(key)===job)readFlights.delete(key);}
}

$('.sample').textContent='연동 준비';$('.privacy').textContent='사진은 현재 앱 서버에서 읽고 외부 인식 서비스에 전송하지 않습니다.';

$('#account-dialog h2').textContent='내 사이트 계정으로 로그인';$('#account-dialog form>p').innerHTML='티비썬팅 사이트에서 사용하는 계정입니다.<br>로그인 정보는 해당 사이트의 로그인에만 사용합니다.';
const vaultFields=document.createElement('div');vaultFields.innerHTML=`<label class="remember"><input id="remember-account" type="checkbox" checked> 이 기기에 로그인 정보 암호화 저장</label><label for="vault-pin" class="account-label">앱 잠금번호 <small>6자리 이상 · 저장 정보 잠금 해제용</small></label><input id="vault-pin" class="account-input" type="password" minlength="6" maxlength="100" autocomplete="off" placeholder="사이트 비밀번호와 다르게 설정"><p id="login-error" role="status" class="login-error"></p><button id="vault-unlock" class="account-secondary" type="button">저장한 계정 불러오기</button><button id="vault-forget" class="account-secondary" type="button">이 기기의 저장 정보 삭제</button>`;$('.account-disclaimer').before(vaultFields);
$('.account-disclaimer').textContent='앱 잠금번호로 암호화해서 저장합니다. 잠금번호를 잊으면 사이트 계정을 다시 입력해야 합니다. 공용 기기에서는 저장을 해제하세요.';$('#account-form .primary').innerHTML='저장하고 사이트 로그인 <span>→</span>';
function vaultButtons(){let stored=false;try{stored=!!localStorage.getItem(VAULT_KEY)}catch{}$('#vault-unlock').hidden=!stored;$('#vault-forget').hidden=!stored;$('#account-open').textContent=authenticated?'계정 변경':stored?'저장 계정 열기':'계정 입력'}
$('#remember-account').onchange=()=>{$('#vault-pin').required=$('#remember-account').checked;$('#account-form .primary').innerHTML=$('#remember-account').checked?'저장하고 사이트 로그인 <span>→</span>':'저장 없이 사이트 로그인 <span>→</span>'};$('#vault-pin').required=true;
async function loginSite(id,password,name){return accountChange(async epoch=>{const result=await api('/api/login',{id,password});if(epoch!==accountEpoch)throw staleAccountResponse();if(!result.authenticated||result.id!==id)throw Error('로그인 계정을 확인하지 못했습니다.');authenticated=!!result.authenticated;browserLoginCredentials=authenticated?{id,password}:null;activeAccount={id:result.id,name:name||result.id};if(!accountHistories.has(result.id))accountHistories.set(result.id,[]);history=accountHistories.get(result.id);resetPhotos();refreshAccount();$('#account-status').textContent=`${result.id} · 사이트 로그인 확인`;vaultButtons();accountDialog.close();window.dispatchEvent(new CustomEvent('coupon:stock-login'));window.dispatchEvent(new CustomEvent('coupon:notice',{detail:{reset:true}}));window.dispatchEvent(new CustomEvent('coupon:notice',{detail:result.notice}));toast('사이트 로그인을 확인했습니다.');});}
$('#account-form').onsubmit=async e=>{e.preventDefault();const button=$('#account-form .primary');button.disabled=true;$('#login-error').textContent='';let saved=false;try{const id=$('#site-id').value.trim(),password=$('#site-password').value,name=$('#store-name').value.trim(),pin=$('#vault-pin').value;if(!id||!password)throw new Error('아이디와 비밀번호를 입력해주세요.');if($('#remember-account').checked){if(pin.length<6)throw new Error('앱 잠금번호를 6자리 이상 입력해주세요.');await saveVault(pin,{id,password,name});saved=true;vaultButtons();$('#login-error').textContent='암호화 저장했습니다. 사이트 로그인 확인 중…'}await loginSite(id,password,name)}catch(error){$('#login-error').textContent=(saved?'이 기기에 암호화 저장됨. ':'')+userErrorMessage(error)}finally{button.disabled=false}};
$('#vault-unlock').onclick=async()=>{const pin=$('#vault-pin').value;if(pin.length<6){$('#login-error').textContent='앱 잠금번호를 6자리 이상 입력해주세요.';$('#vault-pin').focus();return}$('#vault-unlock').disabled=true;let credentials;try{try{credentials=await openVault(pin)}catch{throw new Error('앱 잠금번호가 맞지 않거나 저장 정보가 손상됐습니다.')}$('#login-error').textContent='저장 계정을 불러왔습니다. 사이트 로그인 확인 중…';await loginSite(credentials.id,credentials.password,credentials.name)}catch(error){$('#login-error').textContent=userErrorMessage(error)}finally{credentials=null;$('#vault-unlock').disabled=false}};
$('#vault-forget').onclick=()=>{localStorage.removeItem(VAULT_KEY);$('#site-password').value='';$('#vault-pin').value='';vaultButtons();$('#login-error').textContent='이 기기의 저장 정보를 삭제했습니다.'};
$('#account-dialog').addEventListener('close',()=>{$('#vault-pin').value='';$('#login-error').textContent='';$('#remember-account').checked=true;$('#vault-pin').required=true;$('#account-form .primary').innerHTML='저장하고 사이트 로그인 <span>→</span>'});
const showAccount=$('#account-open').onclick;$('#account-open').onclick=()=>{showAccount();vaultButtons()};
$('#account-logout').onclick=async()=>{try{await accountChange(async epoch=>{await api('/api/logout',{});if(epoch!==accountEpoch)throw staleAccountResponse();accountDialog.close();toast('로그아웃했습니다. 기기에 저장한 정보는 유지됩니다.');});}catch(error){if(!error.accountStale)$('#login-error').textContent=userErrorMessage(error)}};
$('#run').onclick=async()=>{if(!files.length)return;if(mode==='complete'){toast('시공 완료는 필수 항목과 처리 규칙을 정한 뒤 연결합니다.');return}const task=photoTaskVersion;const selectedPhotos=files.slice();startPhotoBatch(task,selectedPhotos.length);const button=$('#run');button.disabled=true;button.textContent='서류를 스캔하고 있습니다…';const results=[];try{for(const item of selectedPhotos){const result=await scanPhoto(item.file);if(task!==photoTaskVersion)return;await certifyRecognizedPhoto(result,task);if(task!==photoTaskVersion)return;photoBatchDone(task,result);results.push({name:item.file.name,...result});if(['needs_review','notice_required','identity_conflict'].includes(result.certification?.state))break}$('#review-title').textContent='스캔·시공 인증 결과';$('#review form>p').textContent='사이트 중복 확인과 인증 결과입니다. 건수 증가까지 확인된 건만 인증 완료로 표시합니다.';$('#review-files').replaceChildren();for(const result of results){const card=document.createElement('div');card.className='ocr-result';const title=document.createElement('strong');title.textContent=result.name;card.append(title);appendOcrEditors(card,result);appendCertificationResult(card,result);if(result.previouslyProcessed){const p=document.createElement('p');p.className='login-error';p.textContent='이미 처리한 계약번호입니다. 재인증하지 않습니다.';card.append(p)}const details=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');summary.textContent='인식한 원문 보기';pre.textContent=result.text;details.append(summary,pre);card.append(details);$('#review-files').append(card)}$('#review-note').textContent=certificationSummary(results)+' 확인 필요 건은 재전송하지 말고 사이트에서 먼저 확인해주세요.';$('#review .primary').textContent='확인';$('#review .primary').value='ocr-close';/* 인증 결과는 사진 선택 창의 처리 현황에 표시합니다. */}catch(error){if(task===photoTaskVersion){endPhotoBatch(task,userErrorMessage(error));toast(userErrorMessage(error))}}finally{if(photoBatch?.state==='processing')endPhotoBatch(task);renderFiles()}};
vaultButtons();
// Read the authenticated landing page without submitting any service form.
const sitePanel=document.createElement('section');
sitePanel.className='settlement-panel';
sitePanel.innerHTML='<p id="site-status" class="help" role="status">로그인 후 사이트 정보를 불러옵니다.</p><div class="settlement-stack"><a class="settlement-card settlement-schedule-link" aria-label="시공 정산 일정 안내 보기" target="_blank" rel="noopener noreferrer"><h3>시공 정산 일정</h3><strong id="settlement-schedule">—</strong></a><article class="settlement-card current"><h3>현재 시공중</h3><strong id="count-progress">—</strong></article><article class="settlement-card period"><h3 id="settlement-count-title">시공건수</h3><strong id="settlement-count">—</strong></article><article class="settlement-card"><h3 id="settlement-amount-title">정산 예정금액</h3><strong id="settlement-amount">—</strong></article></div><p id="count-status" class="help" role="status">정산 건수와 금액은 사이트 메인 화면의 해당 차수 기준입니다.</p>';
$('.account-panel').after(sitePanel);
function resetSettlement(message='—'){const link=document.querySelector('.settlement-schedule-link');link?.removeAttribute('href');link?.removeAttribute('title');
 for(const selector of ['#count-progress','#settlement-schedule','#settlement-count','#settlement-amount'])$(selector).textContent=message;
 setOverviewText('#settlement-count-title','시공건수');setOverviewText('#settlement-amount-title','정산 예정금액');
}
function setOverviewText(selector,value){const node=$(selector);if(node.textContent!==value)node.textContent=value;}
function checkSiteConnection(){
 if(!authenticated)return Promise.resolve(false);
 if(overviewFlight?.epoch===accountEpoch)return overviewFlight.promise;
 const epoch=accountEpoch;const flight={epoch,promise:null};overviewFlight=flight;
 flight.promise=Promise.resolve().then(async()=>{
 if(epoch!==accountEpoch)return false;
 window.dispatchEvent(new CustomEvent('coupon:site-refresh',{detail:{state:'loading'}}));
 $('#site-status').textContent='사이트에서 최신 정보 조회 중…';
 try{
  const result=await api('/api/site-overview',{});if(epoch!==accountEpoch)return false;if(!result.authenticated)throw Error('사이트 로그인 상태를 확인해주세요.');const scheduleNotice=result.pages?.flatMap(page=>page.links||[]).find(link=>/정산\s*일정\s*안내/.test(link.label)&&/^\/new_user\/notice\.jsp\?/.test(link.path));const scheduleLink=document.querySelector('.settlement-schedule-link');if(scheduleNotice){scheduleLink.href='https://www.tbtinting.com'+scheduleNotice.path;scheduleLink.title=scheduleNotice.label;}else if(result.pages?.length){scheduleLink.removeAttribute('href');scheduleLink.removeAttribute('title');}const counts=result.workCounts,settlement=result.settlement;authenticated=!!result.authenticated;
  if(result.authenticated&&!activeAccount){authenticated=true;$('#account-name').textContent='로그인된 시공점';$('#account-status').textContent='사이트 로그인 유지 확인';$('#account-logout').hidden=false;vaultButtons();}
  const hasProgress=Number.isSafeInteger(counts?.inProgress);
  const hasSettlement=['schedule','count','amount'].every(field=>!!settlement?.[field]?.value&&settlement[field].value!=='—');
  if(hasProgress)setOverviewText('#count-progress',counts.inProgress.toLocaleString('ko-KR')+'건');
  if(settlement?.schedule?.value&&settlement.schedule.value!=='—')setOverviewText('#settlement-schedule',settlement.schedule.value);
  for(const [field,label] of [['count','시공건수'],['amount','정산 예정금액']]){
   const row=settlement?.[field];
   if(!row?.value||row.value==='—')continue;
   setOverviewText('#settlement-'+field+'-title',row.title||label);
   setOverviewText('#settlement-'+field,row.value);
  }
  setOverviewText('#site-status','✓ 사이트 로그인 확인됨');
  setOverviewText('#count-status',settlement?.verified&&hasProgress&&hasSettlement?'':'일부 정보의 최신 확인이 필요합니다.');
  window.dispatchEvent(new CustomEvent('coupon:notice',{detail:result.notice}));
  window.dispatchEvent(new CustomEvent('coupon:site-refresh',{detail:{state:'ready',pages:result.pages}}));
 return true;
 }catch(error){if(epoch!==accountEpoch||error.accountStale)return false;window.dispatchEvent(new CustomEvent('coupon:site-refresh',{detail:{state:'unavailable'}}));$('#site-status').textContent=userErrorMessage(error);$('#count-status').textContent='최신 정보 확인 필요 · 마지막 조회값입니다.';return false;}
 }).finally(()=>{if(overviewFlight===flight)overviewFlight=null});
 return flight.promise;
}

const realLoginSite=loginSite;
loginSite=async(...args)=>{await realLoginSite(...args);await checkSiteConnection()};
const logoutSite=$('#account-logout').onclick;
$('#account-logout').onclick=async()=>{await logoutSite();if(!authenticated){window.dispatchEvent(new CustomEvent('coupon:site-refresh',{detail:{state:'unavailable'}}));$('#site-status').textContent='사이트 로그인 전입니다.';resetSettlement();$('#count-status').textContent='로그인 후 사이트 정보를 확인합니다.';}};
// The OCR view cannot create sample completion records, including on Escape.
$('#review .primary').value='ocr-close';
$('#review').addEventListener('close',()=>{$('#review').returnValue=''});
const siteApprove=$('#review .primary');siteApprove.type='button';
siteApprove.onclick=()=>{
 window.open('https://www.tbtinting.com/new_user/main_kia.jsp','_blank','noopener,noreferrer');
 $('#review').close('site-open');
};
const siteReject=document.createElement('button');siteReject.type='button';siteReject.className='account-secondary';siteReject.id='site-reject';siteReject.textContent='거부 · 돌아가기';
siteReject.onclick=()=>$('#review').close('reject');siteApprove.after(siteReject);
$('.history .empty')?.replaceChildren(document.createTextNode('검증된 실제 작업 내역이 없습니다.'));

// Saved-account entry needs only the vault passphrase. Credentials stay in memory.
const credentialFields=document.createElement('div');credentialFields.id='credential-fields';
const firstCredential=$('label[for="store-name"]');firstCredential.before(credentialFields);
for(const selector of ['label[for="store-name"]','#store-name','label[for="site-id"]','#site-id','label[for="site-password"]','.password-field'])credentialFields.append($(selector));
const switchAccount=document.createElement('button');switchAccount.id='switch-account';switchAccount.type='button';switchAccount.className='account-secondary';switchAccount.textContent='다른 계정으로 변경';
const returnToSaved=document.createElement('button');returnToSaved.id='return-saved';returnToSaved.type='button';returnToSaved.className='account-secondary';returnToSaved.textContent='저장된 계정으로 돌아가기';
$('#account-form .primary').after(switchAccount,returnToSaved);
let unlockView=false;
function hasSavedAccount(){try{return !!localStorage.getItem(VAULT_KEY)}catch{return false}}
function accountView(unlock){
 unlockView=unlock&&hasSavedAccount();
 credentialFields.hidden=unlockView;$('.remember').hidden=unlockView;
 $('#site-id').required=!unlockView;$('#site-password').required=!unlockView;
 $('#vault-pin').required=unlockView||$('#remember-account').checked;
 $('#vault-pin').value='';$('#site-password').value='';$('#login-error').textContent='';
 $('#vault-pin').placeholder=unlockView?'앱 잠금번호 입력':'사이트 비밀번호와 다르게 설정';
 $('#account-dialog h2').textContent=unlockView?'잠금번호로 로그인':'내 사이트 계정으로 로그인';
 $('#account-dialog form>p').textContent=unlockView?'이 기기에 저장된 계정을 불러와 사이트에 로그인합니다.':'티비썬팅 사이트에서 사용하는 계정을 입력해주세요.';
 $('#account-form .primary').textContent=unlockView?'잠금 해제하고 로그인':$('#remember-account').checked?'저장하고 사이트 로그인':'저장 없이 사이트 로그인';
 $('#vault-unlock').hidden=true;switchAccount.hidden=!unlockView;returnToSaved.hidden=unlockView||!hasSavedAccount();
 if(accountDialog.open)(unlockView?$('#vault-pin'):$('#site-id')).focus();
}
const submitAccount=$('#account-form').onsubmit;
$('#account-form').onsubmit=async e=>{
 if(!unlockView)return submitAccount(e);
 e.preventDefault();const button=$('#account-form .primary');if(button.disabled)return;button.disabled=true;
 try{await $('#vault-unlock').onclick()}finally{button.disabled=false}
};
$('#account-open').onclick=()=>{showAccount();vaultButtons();accountView(hasSavedAccount())};
switchAccount.onclick=()=>accountView(false);returnToSaved.onclick=()=>accountView(true);
const forgetSaved=$('#vault-forget').onclick;
$('#vault-forget').onclick=()=>{forgetSaved();accountView(false);$('#login-error').textContent='저장 정보를 삭제했습니다. 계정을 다시 입력해주세요.'};





// Each app opening requires unlocking the saved account before loading store data.
const settingsButton=document.createElement('button');settingsButton.type='button';settingsButton.className='account-settings';settingsButton.textContent='설정';settingsButton.setAttribute('aria-label','계정 설정');document.querySelector('header').append(settingsButton);
settingsButton.onclick=()=>$('#account-open').click();
function showLoginGate(){document.body.classList.add('login-locked');settingsButton.hidden=true;$('#account-close').hidden=true;$('#account-open').click();}
const gatedLogin=loginSite;
loginSite=async(...args)=>{await gatedLogin(...args);if(authenticated){document.body.classList.remove('login-locked');settingsButton.hidden=false;$('#account-close').hidden=false;$('#site-password').value='';$('#vault-pin').value='';}};
accountDialog.addEventListener('cancel',event=>{if(!authenticated)event.preventDefault();});
const gateLogout=$('#account-logout').onclick;
$('#account-logout').onclick=async()=>{await gateLogout();if(!authenticated)showLoginGate();};
showLoginGate();








