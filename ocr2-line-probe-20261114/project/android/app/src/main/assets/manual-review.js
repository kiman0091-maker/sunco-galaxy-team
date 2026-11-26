(()=>{
 if(window.suncoManualReview||typeof renderFiles!=='function'||typeof photoBatchDone!=='function')return;
 window.suncoManualReview=true;
 const entries=new Map(), ids=new WeakMap(),dialogs=new Set();let manual=new WeakMap(),serial=0,retrying=false,retryGeneration=0;
 const normalize=value=>String(value||'').replace(/\s/g,'').toUpperCase();
 const safeStates=new Set(['invalid_numbers','vehicle_not_found']);
 const okStates=new Set(['certified','already_pending','already_completed','already_other','protected']);
 const originalScan=scanPhoto,originalDone=photoBatchDone,originalRender=renderFiles;
 if(typeof resetPhotos==='function'){
  const originalReset=resetPhotos;
  resetPhotos=function(){retryGeneration++;retrying=false;for(const dialog of [...dialogs])dialog.dispose();manual=new WeakMap();for(const entry of entries.values())if(entry.url)URL.revokeObjectURL(entry.url);entries.clear();return originalReset();};
 }
 function valid(entry){return authenticated&&entry.epoch===accountEpoch&&entry.task===photoTaskVersion&&entry.account===activeAccount?.id&&entry.mode===mode;}
 function attach(file,result){
  let id=ids.get(file);if(!id){id=String(++serial);ids.set(file,id);}
  const old=entries.get(id);entries.set(id,{file,result,task:photoTaskVersion,mode,epoch:accountEpoch,account:activeAccount?.id,url:old?.url});
  result.manualReviewId=id;return result;
 }
 scanPhoto=async function(file){
  const task=photoTaskVersion,epoch=accountEpoch,account=activeAccount?.id;
  const edited=manual.get(file);manual.delete(file);
  let result;
  if(edited&&valid(edited.entry)){
   result={...edited.values,recognitionSource:'manual',text:'사용자가 원본을 보고 번호를 직접 수정함'};
   approvePhotoProcessing(result,'manual');
  }
  else try{result=await originalScan(file);}catch(error){result={contract:'',vin:'',customerName:'',error:error.message};}
  if(task!==photoTaskVersion||epoch!==accountEpoch||account!==activeAccount?.id||!authenticated)return {};
  return attach(file,result);
 };
 photoBatchDone=function(task,result){
  const entry=entries.get(result.manualReviewId);if(entry)entry.result=result;
  return originalDone(task,result);
 };
 function element(tag,text){const node=document.createElement(tag);if(text)node.textContent=text;return node;}
 function button(text,fn){const b=element('button',text);b.type='button';b.className='account-secondary';b.onclick=fn;return b;}
 function reviewable(entry){return !okStates.has(entry.result.certification?.state);}
 async function reprocess(entry,edited){
  if(retrying||photoBatch?.state==='processing'||!valid(entry))return;
  if(!safeStates.has(entry.result.certification?.state)){toast('사이트 처리 결과를 먼저 확인해주세요. 자동 재전송하지 않습니다.');return;}
  const savedFiles=files,savedBatch=photoBatch,task=photoTaskVersion;
  retrying=true;const generation=++retryGeneration;
  try{
   if(edited)manual.set(entry.file,{entry,values:edited});
   files=[{file:entry.file,url:entry.url||URL.createObjectURL(entry.file)}];
   await document.querySelector('#run').onclick();
  }catch(error){toast(error.message||'처리하지 못했습니다.');}
  finally{manual.delete(entry.file);if(generation===retryGeneration)retrying=false;
   if(task===photoTaskVersion){files=savedFiles;photoBatch=savedBatch;
    if(photoBatch){const results=[...entries.values()].filter(valid).map(e=>e.result);const count=state=>results.filter(r=>r.certification?.state===state).length;
     photoBatch.certified=count('certified');photoBatch.alreadyPending=count('already_pending');photoBatch.alreadyCompleted=count('already_completed');
     photoBatch.needsReview=results.filter(r=>!okStates.has(r.certification?.state)).length;
     photoBatch.reviewItems=results.filter(r=>!okStates.has(r.certification?.state));
    }
    renderFiles();}
  }
 }
 function openEditor(entry){
  if(!valid(entry))return;
  const dialog=element('dialog');dialog.style.cssText='width:min(92vw,460px);max-height:90vh;overflow:auto;border:1px solid #ccd5c6;border-radius:16px;padding:20px;color:#183d31';
  dialogs.add(dialog);dialog.dataset.manualAccount=entry.account;
  dialog.dispose=()=>{dialogs.delete(dialog);for(const input of dialog.querySelectorAll('input'))input.value='';for(const image of dialog.querySelectorAll('img'))image.removeAttribute('src');delete entry.draft;if(dialog.open)dialog.close();dialog.remove();};
  const title=element('h3','인식하지 못한 번호 수정');dialog.append(title);
  if(!entry.url)entry.url=URL.createObjectURL(entry.file);
  const photo=element('div');photo.style.cssText='max-height:40vh;overflow:auto';
  const image=element('img');image.src=entry.url;image.alt='선택한 출고서류 원본';image.style.cssText='width:100%;max-width:none;height:auto';photo.append(image);
  let zoom=1;dialog.append(photo,button('원본 확대 · 축소',()=>{if(!valid(entry))return;zoom=zoom===1?2:zoom===2?4:1;image.style.width=(zoom*100)+'%';}));
  const inputs={};
  for(const [key,label] of [['contract','계약번호'],['vin','차대번호 17자리']]){
   const wrap=element('label',label),input=element('input');input.className='account-input';input.type='text';input.autocomplete='off';input.autocapitalize='characters';input.spellcheck=false;input.value=entry.draft?.[key]||entry.result[key]||'';
   input.setAttribute('aria-label',label);wrap.append(input);dialog.append(wrap);inputs[key]=input;
  }
  for(const value of new Set([...(entry.result.contractCandidates||[]),...(entry.result.contractReferenceCandidates||[])])){
   if(typeof value==='string'&&value)dialog.append(button(value,()=>{if(valid(entry))inputs.contract.value=value;}));
  }
  dialog.append(element('p','계약자명: '+(entry.result.customerName||'인식하지 못함')));
  const status=element('p');status.setAttribute('role','status');dialog.append(status);
  const submit=button('수정한 번호로 인증하기',()=>{
   if(!valid(entry)){dialog.dispose();return;}
   const edited={contract:normalize(inputs.contract.value),vin:normalize(inputs.vin.value),customerName:entry.result.customerName||''};
   if(!SuncoNumberPolicy.complete(edited)){status.textContent='계약번호 형식과 차대번호 17자리를 확인해주세요.';return;}
   dialog.close();reprocess(entry,edited);
  });
  const safe=safeStates.has(entry.result.certification?.state);
  submit.disabled=!safe;
  if(!safe)status.textContent='사이트에서 처리됐을 수 있는 건입니다. 상태 확인 후 처리해주세요. 번호를 바꿔 재전송하지 않습니다.';
  const save=button('수정 저장',()=>{
   if(!valid(entry)){dialog.dispose();return;}
   const draft={contract:normalize(inputs.contract.value),vin:normalize(inputs.vin.value)};
   if(!SuncoNumberPolicy.complete(draft)){status.textContent='계약번호 형식과 차대번호 17자리를 확인해주세요.';return;}
   entry.draft=draft;status.textContent='수정값을 저장했습니다.';
  });
  const rescan=button('사진 다시 인식하기',async()=>{
   if(retrying||!valid(entry)||typeof window.suncoReadLocalNumbers!=='function')return;
   const previous={contract:inputs.contract.value,vin:inputs.vin.value};
   retrying=true;const generation=++retryGeneration;rescan.disabled=true;
   try{
    const reading=await window.suncoReadLocalNumbers(entry.file);
    if(!valid(entry)||!dialog.open)return;
    for(const key of ['contract','vin']){
     if(!entry.draft?.[key]&&inputs[key].value===previous[key]&&!previous[key]&&reading[key])inputs[key].value=reading[key];
    }
    status.textContent='사진 한 장을 다시 읽었습니다. 원본과 번호를 확인해주세요.';
   }catch(error){if(valid(entry)&&dialog.open)status.textContent=error.message;}
   finally{if(generation===retryGeneration)retrying=false;rescan.disabled=false;}
  });
  dialog.append(save,submit,rescan,button('닫기',()=>dialog.close()));
  dialog.addEventListener('close',()=>{dialogs.delete(dialog);for(const input of dialog.querySelectorAll('input'))input.value='';for(const image of dialog.querySelectorAll('img'))image.removeAttribute('src');dialog.remove();});document.body.append(dialog);dialog.showModal();
 }
 renderFiles=function(){
  originalRender();
  if(photoBatch?.state==='processing')return;
  const box=document.querySelector('#files');if(!box)return;
  const failures=[...entries.values()].filter(entry=>valid(entry)&&reviewable(entry));
  if(!failures.length)return;
  const panel=element('section');panel.className='manual-review-list';panel.append(element('h3','확인 필요한 사진 '+failures.length+'장'));
  for(const entry of failures){
   const card=element('div');card.className='ocr-result';card.append(element('strong',entry.file.name));
   const values=entry.result.reviewValues||entry.result;
   card.append(element('p','계약번호: '+(entry.result.contract||values.contract||'인식하지 못함')),element('p','차대번호: '+(entry.result.vin||values.vin||'인식하지 못함')));
   card.append(element('p',entry.result.certification?.message||entry.result.error||'번호 확인이 필요합니다.'));
   card.append(button('번호 수정 · 원본 보기',()=>openEditor(entry)));
   if(!safeStates.has(entry.result.certification?.state)&&SuncoNumberPolicy.complete(entry.result)){
    card.append(button('사이트 처리 상태 확인',async()=>{
     if(retrying||photoBatch?.state==='processing'||!valid(entry))return;
     retrying=true;try{const status=await api('/api/certification/lookup',{contract:entry.result.contract,vin:entry.result.vin});
      if(!valid(entry))return;
      if(okStates.has(status.state))entry.result.certification=status;
      else toast(status.message||'처리 상태를 확정하지 못했습니다. 재전송하지 않았습니다.');
     }catch(error){toast(error.message||'조회하지 못했습니다.');}finally{retrying=false;renderFiles();}
    }));
   }
   panel.append(card);
  }
  box.append(panel);
 };
})();
