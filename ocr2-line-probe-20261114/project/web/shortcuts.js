const shortcuts=document.createElement('div');shortcuts.className='service-shortcuts';
shortcuts.innerHTML='<button type="button" id="open-stock"><strong>시공 등록 가능한 잔여량 &amp; 필름주문</strong><small>사용 가능한 필름 보기</small></button><button type="button" id="open-completion"><strong>시공중인 차량을 시공완료하기</strong></button>';
document.querySelector('.settlement-stack').after(shortcuts);
const stockDialog=document.createElement('dialog');stockDialog.className='stock-dialog';
stockDialog.innerHTML='<div class="modal-top"><h2>사용 가능한 썬팅 필름</h2><button type="button" aria-label="재고 창 닫기">×</button></div><div class="stock-results" role="status"></div><a class="film-order-link" href="https://www.tbtinting.com/new_user/film_order.jsp" target="_self" rel="noopener noreferrer">필름주문하기 <span aria-hidden="true">↗</span></a>';
document.body.append(stockDialog);stockDialog.querySelector('button').onclick=()=>stockDialog.close();
// Match the important-notice link opening; the user operates the official order page.
stockDialog.querySelector('.film-order-link').onclick=event=>{
 event.preventDefault();
 window.open('https://www.tbtinting.com/new_user/film_order.jsp','_blank','noopener');
};
const stockSummary=document.querySelector('#open-stock small');let stockEpoch=0,stockFlight=null,stockFilms=null;
function resetStock(message){stockFilms=null;stockEpoch++;stockFlight=null;stockSummary.textContent=message;stockDialog.querySelector('.stock-results').textContent=message;updateBatchEstimate();}
function renderStock(output,data){output.replaceChildren();if(!data.films.length){output.textContent='잔여량 2.5m 이상인 롤필름이 없습니다.';return}
 for(const film of data.films){const row=document.createElement('p');row.className='stock-row';const name=document.createElement('strong'),quantity=document.createElement('span');name.textContent=film.name;quantity.textContent=film.remainingMeters+'m';row.append(name,quantity);output.append(row)}
 const note=document.createElement('small');note.textContent='2.5m 이상 남은 필름 · '+new Date(data.checkedAt).toLocaleTimeString('ko-KR');output.append(note);
}
function refreshStock(){if(stockFlight)return stockFlight;const epoch=stockEpoch;
 stockSummary.textContent='재고 불러오는 중…';stockDialog.querySelector('.stock-results').textContent='사이트 재고 확인 중…';
 const flight=(async()=>{try{const response=await fetch('/api/film-stock',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json','Cache-Control':'no-cache'},body:'{}'});const data=await response.json();if(!response.ok)throw Error(data.error||'재고를 확인하지 못했습니다.');if(epoch!==stockEpoch)return;
 stockFilms=data.films;updateBatchEstimate();const totalMeters=data.films.reduce((sum,film)=>sum+film.remainingMeters,0);stockSummary.textContent=data.films.length+'롤 보유 · '+totalMeters.toLocaleString('ko-KR',{maximumFractionDigits:3})+'m';renderStock(stockDialog.querySelector('.stock-results'),data);
 }catch(error){if(epoch!==stockEpoch)return;const message=userErrorMessage(error);stockFilms=null;updateBatchEstimate();stockSummary.textContent='재고 확인 필요';stockDialog.querySelector('.stock-results').textContent=message;}
 finally{if(epoch===stockEpoch)stockFlight=null}})();stockFlight=flight;return flight;
}
window.addEventListener('coupon:stock-login',()=>{resetStock('재고 불러오는 중…');refreshStock()});
window.addEventListener('coupon:site-refresh',event=>{if(event.detail.state==='ready')refreshStock();else if(!authenticated)resetStock(event.detail.state==='loading'?'사이트 연결 확인 중…':'로그인 후 재고를 자동으로 불러옵니다.')});
document.querySelector('#open-stock').onclick=()=>{if(!authenticated){toast('먼저 시공점 계정으로 로그인해주세요.');document.querySelector('#account-open').click();return}stockDialog.showModal();refreshStock()};
const completionBatchDialog=document.createElement('dialog');completionBatchDialog.className='completion-batch-dialog';completionBatchDialog.id='completion-batch-dialog';completionBatchDialog.setAttribute('aria-labelledby','completion-batch-title');
completionBatchDialog.innerHTML='<div class="photo-dialog-heading"><h2 id="completion-batch-title">시공중인 차량 완료하기</h2><button type="button" aria-label="완료 대수 선택 창 닫기">×</button></div><p class="batch-order">오래된 시공 인증 순서부터 진행합니다.</p><div class="batch-choices"><button type="button" data-batch="all" aria-pressed="false"><strong>잔여량 기준</strong><small class="batch-estimate">재고 조회 후 예상 대수 표시</small></button><button type="button" data-batch="count" aria-pressed="false"><strong>대수 지정</strong><small class="batch-estimate">재고 조회 후 예상 대수 표시</small></button></div><div id="batch-reserve-field" class="batch-selector-field" hidden><label for="batch-reserve">마지막 롤 몇 미터 남기고 사용</label><select id="batch-reserve" aria-label="마지막 롤에 남길 길이"><option value="">남길 길이 선택</option></select></div><div id="batch-count-field" class="batch-selector-field" hidden><label for="batch-count">완료할 대수</label><div class="batch-number"><select id="batch-count" aria-label="완료할 대수"><option value="">대수 선택</option></select></div></div><p id="batch-selection" role="status">완료할 범위를 선택해주세요.</p><p class="batch-note">예상 대수는 전체 재고를 2.3m/대로 계산한 참고값입니다. 선택한 남길 길이를 반영한 처리 대수와 실제 차종별 사용량은 다를 수 있습니다.</p><button type="button" class="primary" id="batch-continue" disabled>선택한 작업 시작</button><p id="batch-result" role="status"></p>';
document.body.append(completionBatchDialog);let batchMode=null;
completionBatchDialog.querySelector('.photo-dialog-heading button').onclick=()=>completionBatchDialog.close();
function updateBatchEstimate(){let message='재고 조회 후 예상 대수를 표시합니다.';if(stockFilms){const capacity=stockFilms.reduce((sum,film)=>sum+Math.floor((film.remainingMeters+1e-9)/2.3),0);const total=batchTotal();const count=total===null?capacity:Math.min(total,capacity);message='전체 재고로 약 '+count+'대 가능 · 2.3m/대 예상';}completionBatchDialog.querySelectorAll('.batch-estimate').forEach(node=>node.textContent=message);}
function batchTotal(){const text=document.querySelector('#count-progress').textContent.replace(/,/g,'');const match=text.match(/^(\d+)건$/);return match?Number(match[1]):null}
const reserveSelect=document.querySelector('#batch-reserve');for(let n=1;n<=10;n++){const option=document.createElement('option');option.value=String(n);option.textContent=n+'미터';reserveSelect.append(option);}
let batchCountOptionsFor=null;
function syncBatchCountOptions(){const input=document.querySelector('#batch-count'),total=batchTotal();const max=Number.isSafeInteger(total)&&total>=0&&total<=10000?total:0;if(batchCountOptionsFor===max)return;const previous=input.value;input.replaceChildren();const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent=max?'대수 선택':'시공중 대수 확인 필요';input.append(placeholder);for(let n=1;n<=max;n++){const option=document.createElement('option');option.value=String(n);option.textContent=n+'대';input.append(option);}input.value=Number(previous)>0&&Number(previous)<=max?previous:'';input.disabled=max===0;batchCountOptionsFor=max;}
function selectedBatchSettings(){const total=batchTotal();if(!Number.isSafeInteger(total)||total<=0)return null;if(batchMode==='all'){const reserveMeters=Number(reserveSelect.value);return Number.isInteger(reserveMeters)&&reserveMeters>=1&&reserveMeters<=10?{scope:'all',reserveMeters,requestedCount:null}:null;}if(batchMode==='count'){const requestedCount=Number(document.querySelector('#batch-count').value);return Number.isSafeInteger(requestedCount)&&requestedCount>=1&&requestedCount<=Math.min(total,10000)?{scope:'count',requestedCount,reserveMeters:null}:null;}return null;}
function updateBatchSelection(clearResult=true){updateBatchEstimate();syncBatchCountOptions();const total=batchTotal(),settings=selectedBatchSettings();document.querySelector('#batch-count-field').hidden=batchMode!=='count';document.querySelector('#batch-reserve-field').hidden=batchMode!=='all';document.querySelector('#batch-continue').disabled=completionTestRunning||!settings;
 document.querySelector('#batch-selection').textContent=total===0?'시공중 차량이 없습니다.':batchMode==='all'?(settings?'마지막 롤 '+settings.reserveMeters+'m 남기고 전부 사용하기':'남길 길이를 선택해주세요.'):batchMode==='count'?(settings?'요청 대수: '+settings.requestedCount+'대':'완료할 대수를 선택해주세요.'):'완료할 범위를 선택해주세요.';
 if(clearResult)document.querySelector('#batch-result').textContent='';
}
completionBatchDialog.querySelectorAll('[data-batch]').forEach(button=>button.onclick=()=>{if(completionTestRunning)return;batchMode=button.dataset.batch;completionBatchDialog.querySelectorAll('[data-batch]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));updateBatchSelection()});
document.querySelector('#batch-count').onchange=updateBatchSelection;reserveSelect.onchange=updateBatchSelection;
new MutationObserver(()=>{if(!completionTestRunning)updateBatchSelection(false);}).observe(document.querySelector('#count-progress'),{childList:true,characterData:true,subtree:true});
document.querySelector('#open-completion').onclick=()=>{batchMode=null;syncBatchCountOptions();document.querySelector('#batch-count').value='';reserveSelect.value='';completionBatchDialog.querySelectorAll('[data-batch]').forEach(button=>button.setAttribute('aria-pressed','false'));updateBatchSelection();completionBatchDialog.showModal()};


// A single start action prepares and submits at most one test vehicle.
let completionTestRunning=false,completionViewEpoch=0;
window.addEventListener('coupon:account-changing',()=>{
 completionViewEpoch++;completionTestRunning=false;batchMode=null;batchCountOptionsFor=null;
 if(completionBatchDialog.open)completionBatchDialog.close();if(stockDialog.open)stockDialog.close();
 document.querySelector('#batch-count').value='';reserveSelect.value='';document.querySelector('#batch-result').textContent='';
 completionBatchDialog.querySelectorAll('[data-batch]').forEach(b=>b.setAttribute('aria-pressed','false'));
 updateBatchSelection();
});
const testNotice=document.createElement('p');testNotice.className='batch-note';testNotice.textContent='현재는 선택 조건으로 1대만 시험 처리하고 멈춥니다. 선택한 전체 대수의 연속 처리는 아직 연결하지 않았습니다.';completionBatchDialog.append(testNotice);
document.querySelector('#batch-continue').onclick=async()=>{
 const button=document.querySelector('#batch-continue');if(button.disabled||completionTestRunning)return;const settings=selectedBatchSettings();if(!settings){updateBatchSelection();return;}
 if(!authenticated){toast('먼저 로그인해주세요.');return;}
 const epoch=completionViewEpoch;completionTestRunning=true;button.disabled=true;let submissionStarted=false;
 const choices=completionBatchDialog.querySelectorAll('[data-batch],#batch-count,#batch-reserve');choices.forEach(b=>b.disabled=true);
 document.querySelector('#batch-result').textContent='1대 준비 중…';
 try{
  const prepared=await api('/api/completion-test/prepare',settings);if(epoch!==completionViewEpoch)return;
  if(!prepared.job||prepared.job.state!=='prepared'||prepared.testLimit!==1)throw Error('1대 테스트 준비 결과를 확인하지 못했습니다.');
  if(prepared.job.scope!==settings.scope||prepared.job.reserveMeters!==settings.reserveMeters||prepared.job.requestedCount!==settings.requestedCount)throw Error('선택한 조건이 서버에 반영됐는지 확인하지 못했습니다. 완료 요청은 하지 않았습니다.');
  document.querySelector('#batch-result').textContent='1대 완료 요청 중… 계약번호: '+prepared.job.contract;
  submissionStarted=true;
  const response=await api('/api/completion-test/execute',{id:prepared.job.id,approved:true});if(epoch!==completionViewEpoch)return;
  if(!response.job)throw Error('사이트 처리 결과를 받지 못했습니다.');
  document.querySelector('#batch-result').textContent=response.job.message;
  if(response.job.state==='verified'){
   completionBatchDialog.close();
   window.scrollTo({top:0,behavior:'smooth'});
   toast(response.job.message);
  }
  if(response.job.state==='blocked_before_submission'){
   submissionStarted=false;
  }
  window.dispatchEvent(new CustomEvent('coupon:work-completed'));
  if(['verified','uncertain','succeeded_unreconciled'].includes(response.job.state))await checkSiteConnection();
 }catch(error){if(epoch===completionViewEpoch)document.querySelector('#batch-result').textContent=userErrorMessage(error)+(submissionStarted?' 결과가 불명확하므로 다시 제출하지 마세요.':'');}
 finally{if(epoch===completionViewEpoch){completionTestRunning=false;if(!submissionStarted){choices.forEach(b=>b.disabled=false);updateBatchSelection(false);}}}
};
completionBatchDialog.addEventListener('cancel',event=>{if(completionTestRunning)event.preventDefault();});
completionBatchDialog.querySelector('.photo-dialog-heading button').onclick=()=>{if(!completionTestRunning)completionBatchDialog.close();};
const openCompletionTest=document.querySelector('#open-completion').onclick;
document.querySelector('#open-completion').onclick=()=>{if(completionTestRunning)return;completionBatchDialog.querySelectorAll('[data-batch],#batch-count,#batch-reserve').forEach(b=>b.disabled=false);batchCountOptionsFor=null;openCompletionTest();};

// Submit the existing login directly to the site's HTTPS endpoint, never in a URL.
// Credentials exist only in memory after a successful PIN/account login.
document.addEventListener('click',event=>{
 const link=event.target.closest('a');
 if(!link?.matches('.support-links .official-site-link:not(.call-center-link)'))return;
 if(!browserLoginCredentials)return;
 event.preventDefault();
 const form=document.createElement('form');form.method='POST';form.action='https://www.tbtinting.com/new_user/kia_login_main_Chk.jsp';form.target='_self';form.hidden=true;form.autocomplete='off';
 for(const [name,value] of Object.entries({login_type:'k',mid:browserLoginCredentials.id,pass:browserLoginCredentials.password})){
  const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;form.append(input);
 }
 document.body.append(form);
 try{form.submit();}
 finally{for(const input of form.elements)input.value='';form.remove();}
});

