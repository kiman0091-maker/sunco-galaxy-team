const ROOT='https://www.tbtinting.com';
const {batchSelection,requireReserve}=require('./completion-test.cjs');
const {parseInventory}=require('./completion-rules.cjs');
let hostedBrowserPromise=null,idleTimer=null,activeContexts=0;
const IDLE_MS=90000;
async function acquireHosted(chromium){
 if(idleTimer){clearTimeout(idleTimer);idleTimer=null;}
 activeContexts++;
 try{
  if(!hostedBrowserPromise){
   const pending=chromium.launch({headless:true});hostedBrowserPromise=pending;
   pending.then(browser=>browser.on('disconnected',()=>{if(hostedBrowserPromise===pending)hostedBrowserPromise=null;}),()=>{if(hostedBrowserPromise===pending)hostedBrowserPromise=null;});
  }
  return await hostedBrowserPromise;
 }catch(error){releaseHosted();throw error;}
}
function releaseHosted(){
 activeContexts=Math.max(0,activeContexts-1);
 if(activeContexts||!hostedBrowserPromise)return;
 idleTimer=setTimeout(async()=>{idleTimer=null;if(activeContexts)return;const pending=hostedBrowserPromise;hostedBrowserPromise=null;try{await(await pending)?.close();}catch{}},IDLE_MS);
 idleTimer.unref?.();
}
function dialogHandler(state){return async dialog=>{
 const message=dialog.message().replace(/\s+/g,'').replace(/[.?]$/,'');
 if(dialog.type()==='confirm'&&message==='시공완료처리하시겠습니까'&&!state.confirmed){state.confirmed=true;await dialog.accept();return;}
 if(dialog.type()==='alert'&&message==='시공완료가정상처리되었습니다'&&state.confirmed&&!state.succeeded){state.succeeded=true;await dialog.accept();return;}
 state.error='사이트 안내: '+dialog.message();await dialog.dismiss();
};}
async function perform({session,job,onSubmit}){
 batchSelection(job.scope,job);
 const hosted=!!process.env.RENDER;
 const started=performance.now();let last=started;const timings={};
 const mark=name=>{const now=performance.now();timings[name]=Math.round(now-last);last=now;};
 if(hosted)process.env.PLAYWRIGHT_BROWSERS_PATH='0';
 const {chromium}=require('playwright');
 const browser=hosted?await acquireHosted(chromium):await chromium.launch({channel:'msedge',headless:false});
 mark('browserStart');
 let context;
 try{context=await browser.newContext();}catch(error){if(hosted)releaseHosted();throw error;}
 const state={confirmed:false,succeeded:false,error:null};
 try{
 await context.addCookies([...session.jar].map(([name,value])=>({name,value,url:ROOT})));
 const page=await context.newPage();
 page.on('dialog',dialogHandler(state));
  mark('contextReady');
  await page.goto(ROOT+'/new_user/main_kia.jsp');
  mark('mainPage');
  for(let n=0;n<30;n++){
   const box=page.locator('[id^="bannerContent"]').filter({has:page.getByRole('button',{name:/닫기/})});
   const visible=await box.all();let closed=false;
   for(const item of visible){if(!await item.isVisible())continue;const checkbox=item.locator('input[type=checkbox]');if(await checkbox.count())await checkbox.first().check();await item.getByRole('button',{name:/닫기/}).click();closed=true;break;}
   if(!closed)break;if(n===29)throw Error('안내창을 모두 닫지 못했습니다.');
  }
  mark('notices');
  if(!/^[A-Z0-9]{13}$/.test(job.contract)||!/^[A-HJ-NPR-Z0-9]{17}$/.test(job.vin))throw Error('준비한 차량 번호를 확인하지 못했습니다.');
  const target=new URL('/new_user/build_sign.jsp',ROOT);
  target.search=new URLSearchParams({vinno:job.vin,termsno:job.contract,mode:'link'}).toString();
  await page.goto(target.href);
  await page.waitForFunction(()=>document.forms.BuildingForm?.confirm_?.value==='1',{},{timeout:20000});
  mark('vehicleOpenAndAuth');
  if(state.error)throw Error(state.error);
  await page.locator('input[id="check1_'+job.builder.id+'"]').check();
  const film=page.locator('input[name=building_value]').filter({visible:true});
  let chosen=null;for(const input of await film.all()){if(await input.inputValue()===job.film.name){chosen=input;break;}}
  if(!chosen)throw Error('준비한 필름을 화면에서 찾지 못했습니다.');
  const meters=await page.locator('form[name=BuildingForm] input[name=building_roll]').inputValue();
  if(!/^\d+(\.\d+)?$/.test(meters)||Number(meters)<=0)throw Error('차량별 사용량을 읽지 못했습니다.');
  const currentFilms=parseInventory(await page.content()).films,currentFilm=currentFilms.find(item=>item.name===job.film.name);
  if(!currentFilm)throw Error('현재 필름 잔여량을 읽지 못했습니다.');
  const otherRolls=currentFilms.filter(item=>item.name!==currentFilm.name&&item.remainingMeters>2.5);
  requireReserve(job,currentFilm.remainingMeters,Number(meters),otherRolls.length===0);
  await chosen.check();await page.locator('input[name=agreement_chkbox][value=Y]').check();
  mark('filmAndBuilder');
  await onSubmit();
  await page.locator('#report_success_btn, input[name=report_success_btn], input[type=image][src*="report_success"], [onclick*="chk_2"]').first().click();
  await page.waitForFunction(()=>!location.search.includes('vinno='),{},{timeout:25000});
  if(state.error)throw Error(state.error);
  if(!state.confirmed||!state.succeeded)throw Error('완료 확인과 정상처리 안내를 모두 확인하지 못했습니다.');
  mark('submitAndSuccess');
  return {html:'<script>alert("시공완료가 정상처리 되었습니다.");</script>'};
 }catch(error){throw error;}finally{
  if(hosted){try{await context.close();}finally{releaseHosted();}}
  mark('cleanup');
  console.log(JSON.stringify({type:'completion_browser_timing',totalMs:Math.round(performance.now()-started),confirmed:state.confirmed,succeeded:state.succeeded,stages:timings}));
 }
}
module.exports={perform,dialogHandler};
