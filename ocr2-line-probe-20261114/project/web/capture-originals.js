// Keep the exact captured Blob on this device. Never upload archived originals.
(()=>{
 let opening;
 function database(){return opening??=new Promise((resolve,reject)=>{const request=indexedDB.open('coupon-capture-originals',1);request.onupgradeneeded=()=>request.result.createObjectStore('photos',{keyPath:'id'}).createIndex('ownerAt',['owner','at']);request.onsuccess=()=>resolve(request.result);request.onerror=()=>{opening=null;reject(request.error)};});}
 async function transaction(mode,action){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('photos',mode),request=action(tx.objectStore('photos'));tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('storage aborted'));});}
 async function owner(){if(typeof activeAccount==='undefined'||!activeAccount?.id)throw Error('account required');const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(activeAccount.id));return Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('');}
 async function recent(){const key=await owner(),db=await database();return new Promise((resolve,reject)=>{const rows=[],tx=db.transaction('photos'),request=tx.objectStore('photos').index('ownerAt').openCursor(IDBKeyRange.bound([key,0],[key,Number.MAX_SAFE_INTEGER]),'prev');request.onsuccess=()=>{const c=request.result;if(c&&rows.length<20){rows.push(c.value);c.continue();}};tx.oncomplete=()=>resolve(rows);tx.onerror=()=>reject(tx.error);});}
 window.couponSaveCapture=async file=>{const row={id:crypto.randomUUID(),at:Date.now(),owner:await owner(),name:file.name,type:file.type,blob:file};await transaction('readwrite',store=>store.put(row));return row.id;};
 const dialog=document.createElement('dialog');dialog.setAttribute('aria-label','촬영 원본 보관함');dialog.style.cssText='width:min(90vw,430px);max-height:80dvh;overflow:auto;border:0;border-radius:16px;padding:20px';
 const title=document.createElement('h2');title.textContent='촬영 원본';const help=document.createElement('p');help.textContent='이 휴대폰의 앱에 보관한 원본입니다. 갤러리에는 자동 저장되지 않습니다. 앱 데이터 삭제 시 없어지므로 필요한 사진은 따로 저장해주세요.';
 const list=document.createElement('div'),close=document.createElement('button');close.type='button';close.textContent='닫기';close.onclick=()=>dialog.close();dialog.append(title,help,list,close);document.body.append(dialog);
 let viewEpoch=0,viewUrls=[];
 function clearView(){viewEpoch++;for(const a of list.querySelectorAll('a'))a.removeAttribute('href');for(const url of viewUrls)URL.revokeObjectURL(url);viewUrls=[];list.replaceChildren();}
 dialog.addEventListener('close',clearView);
 window.addEventListener('coupon:account-changing',()=>{if(dialog.open)dialog.close();clearView();});
 const button=document.createElement('button');button.type='button';button.textContent='촬영 원본';button.style.cssText='margin:12px 0;padding:10px 14px';document.querySelector('.history-fold')?.after(button);if(!button.isConnected)document.querySelector('main').append(button);
 button.onclick=async()=>{clearView();const epoch=viewEpoch,account=activeAccount?.id;dialog.showModal();try{const rows=await recent();if(epoch!==viewEpoch||!authenticated||activeAccount?.id!==account||!dialog.open)return;if(!rows.length){list.textContent='이 계정으로 보관한 촬영 사진이 없습니다.';return;}
 for(const row of rows){const block=document.createElement('div');block.style.cssText='padding:12px 0;border-top:1px solid #ddd';const label=document.createElement('p');label.textContent=new Date(row.at).toLocaleString('ko-KR')+' · '+(row.blob.size/1048576).toFixed(1)+'MB';
 const url=URL.createObjectURL(row.blob);viewUrls.push(url);const save=document.createElement('a');save.href=url;save.download=row.name;save.textContent='원본 저장';save.style.marginRight='18px';save.onclick=event=>{if(epoch!==viewEpoch||activeAccount?.id!==account||!authenticated)event.preventDefault();};
 const share=document.createElement('button');share.type='button';share.textContent='보내기';share.onclick=async()=>{if(epoch!==viewEpoch||activeAccount?.id!==account||!authenticated)return;const file=new File([row.blob],row.name,{type:row.type});if(!navigator.canShare?.({files:[file]})){label.textContent='원본 저장 후 다운로드 폴더에서 첨부해주세요.';return;}try{await navigator.share({files:[file]});}catch(error){if(epoch===viewEpoch&&error.name!=='AbortError')label.textContent='전송하지 못했습니다. 원본 저장을 이용해주세요.';}};
 block.append(label,save,share);list.append(block);}
 }catch{if(epoch===viewEpoch)list.textContent='이 기기의 촬영 원본을 열지 못했습니다. 브라우저 저장 공간 설정을 확인해주세요.';}};
})();
