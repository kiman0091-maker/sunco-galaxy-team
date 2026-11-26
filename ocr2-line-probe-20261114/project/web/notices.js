const noticeDialog=document.createElement('dialog');noticeDialog.className='site-notice-dialog';
noticeDialog.setAttribute('aria-labelledby','site-notice-title');
noticeDialog.innerHTML='<div class="notice-symbol" aria-hidden="true">!</div><h2 id="site-notice-title">사이트 공지 확인이 필요합니다</h2><p>티비썬팅 사이트에 읽지 않은 공지가 있습니다.<br>아래에서 미열람 공지를 확인해주세요.</p><div class="notice-dialog-actions"><button type="button" id="notice-reader-open">공지 보기</button><button type="button" id="notice-warning-close">닫기</button></div><small>앱에 로그인한 계정으로 공지를 불러옵니다. 닫아도 읽음 처리되지 않습니다.</small>';
document.body.append(noticeDialog);let noticeDismissed=false;
const noticeReader=document.createElement('dialog');noticeReader.className='notice-reader';
noticeReader.setAttribute('aria-labelledby','notice-reader-title');
noticeReader.innerHTML='<div class="modal-top"><h2 id="notice-reader-title">사이트 공지사항</h2><button type="button" aria-label="공지 목록 닫기">닫기</button></div><p class="help">현재 앱에 로그인한 시공점 계정의 공지입니다. 제목을 누르면 해당 공지를 엽니다.</p><div class="notice-reader-body" role="status"></div><div class="notice-pagination"></div>';
document.body.append(noticeReader);let readerEpoch=0,readerBusy=false;
noticeReader.querySelector('button').onclick=()=>noticeReader.close();
noticeReader.addEventListener('close',()=>{readerEpoch++;readerBusy=false});
function readerError(error){const box=noticeReader.querySelector('.notice-reader-body');box.textContent=userErrorMessage(error)}
async function loadNoticePage(page=1){
 const epoch=++readerEpoch;readerBusy=true;const box=noticeReader.querySelector('.notice-reader-body'),pagination=noticeReader.querySelector('.notice-pagination');box.textContent='공지 목록 불러오는 중…';pagination.replaceChildren();
 try{const data=await api('/api/notices',{page});if(epoch!==readerEpoch)return;box.replaceChildren();
 if(!data.items.length)box.textContent='표시할 공지가 없습니다.';
 for(const item of data.items){const button=document.createElement('button');button.type='button';button.className='notice-item';button.textContent=(item.unread?'미열람 · ':'')+item.title;if(item.unread)button.classList.add('unread');button.onclick=()=>openNotice(item,page);box.append(button)}
 for(const number of data.pages){const button=document.createElement('button');button.type='button';button.textContent=String(number);button.disabled=number===page;button.onclick=()=>loadNoticePage(number);pagination.append(button)}
 }catch(error){if(epoch===readerEpoch)readerError(error)}finally{if(epoch===readerEpoch)readerBusy=false}
}
async function openNotice(item,page){
 if(readerBusy)return;readerBusy=true;const epoch=++readerEpoch;const box=noticeReader.querySelector('.notice-reader-body');box.textContent='공지 내용 불러오는 중…';noticeReader.querySelector('.notice-pagination').replaceChildren();
 try{const data=await api('/api/notice-content',{id:item.id});if(epoch!==readerEpoch)return;box.replaceChildren();const title=document.createElement('h3');title.textContent=item.title;const text=document.createElement('div');text.className='notice-content-text';text.textContent=data.text;box.append(title,text);
 for(const url of data.images){const image=document.createElement('img');image.src=url;image.alt='사이트 공지 이미지';image.onerror=()=>{image.alt='공지 이미지를 불러오지 못했습니다.'};box.append(image)}
 const status=document.createElement('p');status.className='help';status.textContent=data.readStatus==='confirmed'?'사이트에서 해당 공지의 미열람 표시가 해제된 것을 확인했습니다.':data.readStatus==='still_unread'?'사이트에는 아직 미열람으로 표시됩니다.':'사이트의 읽음 처리 여부는 확인하지 못했습니다.';
 const back=document.createElement('button');back.type='button';back.className='account-secondary';back.textContent='공지 목록으로';back.onclick=()=>loadNoticePage(page);box.append(status,back);
 }catch(error){if(epoch===readerEpoch){readerError(error);const back=document.createElement('button');back.type='button';back.textContent='목록으로 돌아가기';back.onclick=()=>loadNoticePage(page);box.append(back)}}finally{if(epoch===readerEpoch)readerBusy=false}
}
noticeDialog.querySelector('#notice-reader-open').onclick=()=>{noticeDialog.close();noticeReader.showModal();loadNoticePage()};
noticeDialog.querySelector('#notice-warning-close').onclick=()=>noticeDialog.close();
noticeDialog.addEventListener('close',()=>{noticeDismissed=true});
window.addEventListener('coupon:notice',event=>{
 if(event.detail?.reset){readerEpoch++;readerBusy=false;if(noticeReader.open)noticeReader.close();noticeReader.querySelector('.notice-reader-body').replaceChildren();noticeDismissed=false;if(noticeDialog.open)noticeDialog.close();noticeDismissed=false;return}
 if(!event.detail?.unread){noticeDismissed=false;if(noticeDialog.open)noticeDialog.close();noticeDismissed=false;return}
 if(!noticeDismissed&&!noticeDialog.open)noticeDialog.showModal();
});


// Important notice titles rotate locally; no network polling or article prefetch.
const importantCard=document.createElement('section');importantCard.className='important-notices';importantCard.hidden=true;importantCard.setAttribute('aria-label','중요 공지');
importantCard.innerHTML='<div class="important-heading"><strong>중요 공지</strong><button type="button" class="important-more">더 보기</button></div><button type="button" class="important-title"></button><div class="important-dots" aria-label="공지 선택"></div>';
let importantItems=[],importantIndex=0,importantTimer=null,importantBusy=false,importantEpoch=0;
function stopImportant(){clearInterval(importantTimer);importantTimer=null;}
function renderImportant(){
 const item=importantItems[importantIndex];if(!item)return;
 importantCard.querySelector('.important-title').textContent=item.title;importantCard.querySelector('.important-title').title=item.title;
 importantCard.querySelectorAll('.important-dots button').forEach((button,index)=>{button.setAttribute('aria-current',String(index===importantIndex));});
}
function startImportant(){stopImportant();if(importantItems.length>1&&!document.hidden&&!matchMedia('(prefers-reduced-motion: reduce)').matches)importantTimer=setInterval(()=>{if(noticeReader.open)return;importantIndex=(importantIndex+1)%importantItems.length;renderImportant();},5000);}
function placeImportant(){const links=document.querySelector('.support-links');if(!links)return;let cell=links.querySelector('.official-notice-cell');if(!cell){const official=links.querySelector('a:not(.call-center-link)');if(!official)return;cell=document.createElement('div');cell.className='official-notice-cell';official.before(cell);cell.append(official);}cell.append(importantCard);importantCard.hidden=false;if(!importantItems.length)importantCard.querySelector('.important-title').textContent='로그인 후 공지를 확인할 수 있어요';}
async function loadImportant(pages){
 if(pages){importantEpoch++;importantBusy=false;}
 if(importantBusy||typeof authenticated==='undefined'||!authenticated)return;importantBusy=true;const epoch=importantEpoch;placeImportant();
 try{const mainLinks=pages?.flatMap(page=>page.links||[]).filter(link=>/중요/.test(link.label)&&/^\/new_user\/notice\.jsp\?/.test(link.path));const data=mainLinks?.length?{items:mainLinks.map(link=>({title:link.label,path:link.path}))}:await api('/api/notices',{page:1});if(epoch!==importantEpoch)return;importantItems=data.items.filter(item=>/중요/.test(item.title));importantIndex=0;importantCard.hidden=false;if(!importantItems.length)importantCard.querySelector('.important-title').textContent='등록된 중요 공지가 없습니다';const dots=importantCard.querySelector('.important-dots');dots.replaceChildren();
 importantItems.forEach((item,index)=>{const button=document.createElement('button');button.type='button';button.setAttribute('aria-label',(index+1)+'번째 공지');button.onclick=()=>{importantIndex=index;renderImportant();startImportant();};dots.append(button);});dots.hidden=importantItems.length<2;renderImportant();startImportant();
 }catch(error){importantCard.dataset.loadError=userErrorMessage(error);importantCard.hidden=false;importantCard.querySelector('.important-title').textContent='로그인 후 공지를 확인할 수 있어요';stopImportant();}finally{if(epoch===importantEpoch)importantBusy=false;}
}
importantCard.querySelector('.important-title').onclick=()=>{if(!importantItems.length)return;const item=importantItems[importantIndex];noticeReader.showModal();if(item.id)openNotice(item,1);else loadNoticePage();};
importantCard.querySelector('.important-more').onclick=()=>{noticeReader.showModal();loadNoticePage();};
let importantTouch=null;
importantCard.addEventListener('touchstart',event=>{importantTouch=event.touches[0]?{x:event.touches[0].clientX,y:event.touches[0].clientY}:null;stopImportant();},{passive:true});
importantCard.addEventListener('touchend',event=>{const end=event.changedTouches[0];if(importantTouch&&end&&importantItems.length>1){const dx=end.clientX-importantTouch.x,dy=end.clientY-importantTouch.y;if(Math.abs(dx)>40&&Math.abs(dx)>Math.abs(dy)){importantIndex=(importantIndex+(dx<0?1:-1)+importantItems.length)%importantItems.length;renderImportant();}}importantTouch=null;startImportant();},{passive:true});
importantCard.addEventListener('mouseenter',stopImportant);importantCard.addEventListener('mouseleave',startImportant);importantCard.addEventListener('focusin',stopImportant);importantCard.addEventListener('focusout',startImportant);
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopImportant();else startImportant();});
window.addEventListener('coupon:site-refresh',event=>{if(event.detail?.state==='ready')loadImportant(event.detail.pages);if(event.detail?.state==='unavailable'){importantEpoch++;importantCard.hidden=false;importantCard.querySelector('.important-title').textContent='로그인 후 공지를 확인할 수 있어요';stopImportant();}});
window.addEventListener('coupon:notice',event=>{if(event.detail?.reset){importantEpoch++;importantItems=[];importantCard.hidden=false;importantCard.querySelector('.important-title').textContent='로그인 후 공지를 확인할 수 있어요';stopImportant();}else loadImportant();});
setTimeout(()=>{placeImportant();loadImportant();},0);
