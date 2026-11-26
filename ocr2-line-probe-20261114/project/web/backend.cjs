const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createWorker}=require('tesseract.js'),sharp=require('sharp');
const BASE='https://www.tbtinting.com',sessions=new Map();
const dispatchBusiness=require('./business-dispatch.cjs').createBusinessDispatcher({guard:require('./postgres-runtime.cjs').createFromEnv(process.env)});
const errorRecords=require('./error-records.cjs').createErrorStore(path.join(__dirname,'.data'));
const errorBudgets=new Map();
const builderRotation=require('./builder-rotation.cjs').createRotationStore(path.join(__dirname,'.data')); 
const publicOrigin=process.env.RENDER_EXTERNAL_URL?new URL(process.env.RENDER_EXTERNAL_URL).origin:null;
function secureRequest(req){return !!req.socket.encrypted||!!(publicOrigin?.startsWith('https:')&&req.headers['x-forwarded-proto']==='https')}
function privateAccess(req){
 if(!process.env.TEST_PASSWORD)return true;
 const auth=req.headers.authorization||'';if(!auth.startsWith('Basic '))return false;
 const supplied=Buffer.from(auth.slice(6),'base64').toString('utf8');
 const expected='tester:'+process.env.TEST_PASSWORD;
 return crypto.timingSafeEqual(crypto.createHash('sha256').update(supplied).digest(),crypto.createHash('sha256').update(expected).digest());
}
const previous=new Set(['A5325AX089652','A5326AX054857','A5326AX053987']);
const previousVins=new Set(['KMHB5516BVW155605','KMHB3511FVW110031','KMHB3516BVW154935']);
const routes={'/':'index.html','/index.html':'index.html','/style.css':'style.css','/app.js':'app.js','/photo-pipeline.js':'photo-pipeline.js','/capture-originals.js':'capture-originals.js','/live.js':'live.js','/completion.js':'completion.js','/shortcuts.js':'shortcuts.js','/notices.js':'notices.js','/diagnostics.js':'diagnostics.js'};
function sessionFor(req){const token=(req.headers.cookie||'').match(/coupon_session=([a-f0-9]{64})/)?.[1];const s=sessions.get(token);if(!s||Date.now()-s.time>1800000){sessions.delete(token);return null}return s}
function pageSummary(html,url){
 const clean=s=>s.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
 const links=[];
 for(const m of html.matchAll(/<a\b[^>]*href\s*=\s*['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi)){
  try{const u=resolveSiteUrl(m[1],url);if(/logout|log_out|delete|insert|update|save|remove/i.test(u.pathname+u.search))continue;links.push({label:clean(m[2]).slice(0,100),path:u.pathname+u.search})}catch{}
 }
 return {title:clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||''),links:[...new Map(links.map(x=>[x.path,x])).values()]};
}
function send(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value))}
function body(req,max=28000){return new Promise((resolve,reject)=>{let size=0,chunks=[],tooLarge=false;req.on('data',c=>{if(tooLarge)return;size+=c.length;if(size>max){tooLarge=true;chunks=[];reject(new Error('파일 용량이 너무 큽니다. 사진 한 장은 20MB 이하로 선택해주세요.'));return}chunks.push(c)});req.on('end',()=>{if(!tooLarge)resolve(Buffer.concat(chunks))});req.on('error',reject)})}
function resolveSiteUrl(url,base=BASE){
 const address=new URL(url,base);
 // The legacy site can redirect from /new_user/ to another directory or
 // emit its own HTTP URL. Keep the same destination and always use HTTPS.
 if(address.hostname===new URL(BASE).hostname&&address.protocol==='http:'&&!address.port)address.protocol='https:';
 if(address.origin!==BASE||address.username||address.password)throw new Error('다른 사이트로의 로그인 이동은 허용하지 않습니다.');
 return address;
}
function inlineRedirect(html){
 // A menu's onclick handler is not an automatic page redirect.
 const markup=html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'');
 if(/<(?:a|form|input|iframe|frameset)\b/i.test(markup))return null;
 for(const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)){
  if(/\bfunction\b|=>|\.(?:click|on|ready)\s*\(/.test(script[1]))continue;
  const found=script[1].match(/(?:location(?:\.href)?|(?:window|top|parent)\.location(?:\.href)?)\s*=\s*['"]([^'"]+)['"]|location\.(?:replace|assign)\(\s*['"]([^'"]+)['"]\s*\)/i);
  if(found)return found[1]||found[2];
 }
 return null;
}
function isAuthenticatedPage(html){
 return /logout|log_out|로그아웃/i.test(html)
  &&!/<input[^>]+name\s*=\s*['"]?pass[\s'">]/i.test(html)
  &&!inlineRedirect(html);
}
function decodeSiteHtml(bytes,contentType=''){
 const declared=contentType.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]
  ||Buffer.from(bytes).subarray(0,4096).toString('ascii').match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]||'utf-8';
 const encoding=/^(?:euc-?kr|ks_c_5601-1987|cp949|windows-949)$/i.test(declared)?'euc-kr':declared;
 return new TextDecoder(encoding).decode(bytes);
}
async function siteRequest(jar,url,options={}){for(let step=0;step<7;step++){
 const address=resolveSiteUrl(url);
 const response=await fetch(address,{...options,headers:{...options.headers,Cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; ')},redirect:'manual',signal:AbortSignal.timeout(25000)});
 for(const c of response.headers.getSetCookie()){const part=c.split(';')[0],n=part.indexOf('=');if(n>0)jar.set(part.slice(0,n),part.slice(n+1))}
 const html=decodeSiteHtml(await response.arrayBuffer(),response.headers.get('content-type')||'');if(response.status>=300&&response.status<400&&response.headers.get('location')){url=new URL(response.headers.get('location'),address).href;options={};continue}
 const redirect=inlineRedirect(html);
 if(redirect&&!options.captureResponse){url=resolveSiteUrl(redirect,address).href;options={};continue}
 if(!response.ok)throw new Error('사이트 응답을 확인하지 못했습니다.');return {html,url:address.href};
}throw new Error('사이트 이동이 반복되어 로그인을 확인하지 못했습니다.')}
function parseWorkCounts(html){
 const text=html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<!--[\s\S]*?-->/g,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/\s+/g,' ');
 const get=label=>{const matches=[...text.matchAll(new RegExp(label+'\\s*(?:건수\\s*)?[:：\\(（]?\\s*([0-9][0-9,]*)\\s*(?:건|\\)|）)','g'))].map(m=>Number(m[1].replace(/,/g,'')));const unique=[...new Set(matches)];return unique.length===1&&Number.isSafeInteger(unique[0])?unique[0]:null};
 const inProgress=get('시공\\s*중'),completed=get('시공\\s*완료');
 return {inProgress,completed,verified:inProgress!==null&&completed!==null,checkedAt:new Date().toISOString()};
}
let queue=Promise.resolve();
function parseText(text,confidence){
 const upper=text.toUpperCase();
 const contracts=[...new Set([...upper.matchAll(/(?<![A-Z0-9])([A-Z])[ \t]*(\d{4})[ .\t]*([A-Z][A-Z0-9])[ .\t]*(\d{6})(?![A-Z0-9])/g)].map(m=>m[1]+m[2]+m[3]+m[4]))];
 // Join only the printed VIN's 11-character prefix and 6-digit serial,
 // without collapsing adjacent sales codes or temporary registration numbers.
 const vins=[...new Set([...upper.matchAll(/(?<![A-Z0-9])([A-HJ-NPR-Z0-9]{11})[ \t]*(\d{6})(?![A-Z0-9])/g)].map(m=>m[1]+m[2]).filter(v=>/[A-HJ-NPR-Z]/.test(v.slice(0,3))))];
 return {text,confidence,contracts,vins,contract:contracts.length===1?contracts[0]:'',vin:vins.length===1?vins[0]:'',previouslyProcessed:contracts.some(x=>previous.has(x))||vins.some(x=>previousVins.has(x)),requiresReview:true};
}
async function recognizeFull(buffer){
 const execute=async()=>{
  // EXIF orientation describes the camera, not necessarily the text direction.
  const source=await sharp(buffer,{limitInputPixels:40e6}).rotate().png().toBuffer();
  const overview=await sharp(buffer,{limitInputPixels:40e6}).rotate().jpeg({quality:80}).toBuffer();
  const workerOptions={langPath:path.join(__dirname,'ocr-data'),cachePath:path.join(__dirname,'ocr-data'),gzip:false};
  let worker=await createWorker(['kor','eng'],1,workerOptions);
  const attempts=[];let selectedAngle=0,bestScore=-1;
  const read=async(image,label)=>{const r=await worker.recognize(image);const parsed=parseText(r.data.text,r.data.confidence);attempts.push({label,...parsed});return parsed};
  try{
   for(const angle of [0,270,90,180]){
    const image=await sharp(overview).rotate(angle).resize({width:2400,withoutEnlargement:true}).grayscale().normalize().png().toBuffer();
    const result=await read(image,`방향 보정 ${angle}도`);
    const score=(result.contract?1:0)+(result.vin?1:0);
    if(score>bestScore){selectedAngle=angle;bestScore=score}
    if(result.contract&&result.vin)break;
    // A complete VIN gives a useful text direction for a focused second pass.
    if(result.vin)break;
   }
   let combined=parseText(attempts.map(x=>x.text).join('\n'),Math.max(...attempts.map(x=>x.confidence)));
   if(!combined.contract&&bestScore>0){
    await worker.terminate();worker=await createWorker('eng',1,workerOptions);await worker.setParameters({tessedit_pageseg_mode:'6'});
    const upright=await sharp(source).rotate(selectedAngle).png().toBuffer();const m=await sharp(upright).metadata();
    // Retry the upper number area at several small tilts; never substitute digits.
    const region=await sharp(upright).extract({left:Math.round(m.width*.10),top:Math.round(m.height*.13),width:Math.round(m.width*.45),height:Math.round(m.height*.22)}).png().toBuffer();
    for(const tilt of [0,-6,6,-12,12]){
     const image=await sharp(region).rotate(tilt,{background:'white'}).resize({width:1800}).grayscale().normalize().sharpen().png().toBuffer();
     const r=await read(image,`번호 영역 기울기 ${tilt}도`);
     if(r.contract)break;
    }
    combined=parseText(attempts.map(x=>x.text).join('\n'),Math.max(...attempts.map(x=>x.confidence)));
   }
   return {...combined,rotation:selectedAngle,attemptCount:attempts.length};
  }finally{await worker.terminate()}
 };
 return execute();
}
async function recognize(buffer){
 const queuedAt=Date.now();
 const execute=async()=>{const started=Date.now();const result=process.env.OCR_ENGINE==='local'
  ?await require('./ocr-local-client.cjs').recognizeLocal(buffer,{parseText})
  :await require('./ocr-labels.cjs').recognizeLabels(buffer,{modelPath:path.join(__dirname,'ocr-data'),parseText});
  return {...result,timing:{queueMs:started-queuedAt,processingMs:Date.now()-started}}};
 const schedule=()=>{const result=queue.then(execute,execute);queue=result.catch(()=>{});return result;};
 if(process.env.OCR_ENGINE!=='local')return schedule();
 return localOcrCache.run(buffer,schedule);
}
let recognitionBusy=false;
const localOcrCache=require('./ocr-cache.cjs').createRecognitionCache();
const completionTest=require('./completion-test.cjs').createCompletionTest({directory:path.join(__dirname,'.data'),request:siteRequest,isAuthenticated:isAuthenticatedPage,rotation:builderRotation,visiblePerform:process.env.RENDER?undefined:async args=>{delete require.cache[require.resolve('./visible-completion.cjs')];return require('./visible-completion.cjs').perform(args)}});
const certification=require('./certification.cjs').createCertification({directory:path.join(__dirname,'.data'),request:siteRequest,isAuthenticated:isAuthenticatedPage});
const server=http.createServer(async(req,res)=>{try{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/healthz'&&req.method==='GET')return send(res,200,{ok:true});
 if(!privateAccess(req)){if(pathname.startsWith('/api/'))return send(res,401,{error:'앱 접속 인증이 만료됐습니다. 앱을 새로고침해 접속 인증 후 다시 시도해주세요.'});res.writeHead(401,{'WWW-Authenticate':'Basic realm="Coupon private test", charset="UTF-8"','Cache-Control':'no-store'});return res.end('Private test access required')}
 if(pathname.startsWith('/api/')){
  if(req.method==='POST'&&!(publicOrigin?[publicOrigin]:['http://'+req.headers.host,'https://'+req.headers.host]).includes(req.headers.origin))return send(res,403,{error:'앱 화면에서 다시 시도해주세요.'});
  if(pathname==='/api/error-record'&&req.method==='POST'){
   const now=Date.now(),key=req.socket.remoteAddress;let budget=errorBudgets.get(key);
   if(!budget||now-budget.at>=60000){budget={at:now,count:0};errorBudgets.set(key,budget)}
   if(++budget.count>30)return send(res,429,{error:'잠시 후 다시 시도해주세요.'});
   let data;try{data=JSON.parse((await body(req,1024)).toString('utf8'))}catch{return send(res,400,{error:'기록 형식을 확인해주세요.'})}
   const record=errorRecords.record(data);return send(res,record?201:503,{recorded:!!record,id:record?.id||null});
  }
  if(pathname==='/api/notices'&&req.method==='POST'){
   const session=sessionFor(req);if(!session)return send(res,401,{error:'앱에서 다시 로그인해주세요.'});
   const data=JSON.parse((await body(req,2048)).toString('utf8'));const pageNumber=data.page??1;if(!Number.isInteger(pageNumber)||pageNumber<1||pageNumber>100)return send(res,400,{error:'공지 페이지를 확인해주세요.'});
   const page=await siteRequest(session.jar,BASE+'/new_user/notice.jsp?id=gongi1&page='+pageNumber);
   if(!isAuthenticatedPage(page.html)||/(?:계좌번호|포인트)\s*null/.test(require('./notice-reader.cjs').plain(page.html)))return send(res,401,{error:'공지 조회에 사용할 사이트 로그인 상태를 확인하지 못했습니다. 앱에서 다시 로그인해주세요.'});
   const list=require('./notice-reader.cjs').parseList(page.html,pageNumber);session.noticeIds??=new Set();session.noticePages??=new Map();for(const item of list.items){session.noticeIds.add(item.id);session.noticePages.set(item.id,pageNumber)}session.time=Date.now();return send(res,200,{...list,checkedAt:new Date().toISOString()});
  }
  if(pathname==='/api/notice-content'&&req.method==='POST'){
   const session=sessionFor(req);if(!session)return send(res,401,{error:'앱에서 다시 로그인해주세요.'});
   const data=JSON.parse((await body(req,2048)).toString('utf8'));if(typeof data.id!=='string'||!session.noticeIds?.has(data.id))return send(res,400,{error:'앱의 공지 목록에서 제목을 선택해주세요.'});
   const noticePageNumber=session.noticePages?.get(data.id)||1;const currentList=await siteRequest(session.jar,BASE+'/new_user/notice.jsp?id=gongi1&page='+noticePageNumber);
   if(!isAuthenticatedPage(currentList.html)||/(?:계좌번호|포인트)\s*null/.test(require('./notice-reader.cjs').plain(currentList.html)))return send(res,401,{error:'앱에서 다시 로그인한 뒤 공지를 열어주세요.'});
   if(!require('./notice-reader.cjs').parseList(currentList.html,noticePageNumber).items.some(item=>item.id===data.id))return send(res,409,{error:'공지 목록이 변경됐습니다. 목록에서 다시 선택해주세요.'});
   // Same request as the site's explicit title click. Never prefetch articles or retry this request.
   const page=await siteRequest(session.jar,BASE+'/new_user/process_notice.jsp?num='+data.id);let payload;try{payload=JSON.parse(page.html)}catch{return send(res,422,{error:'공지 내용을 확인하지 못했습니다. 다시 로그인 상태를 확인해주세요.'})}
   const content=require('./notice-reader.cjs').parseContent(payload);session.noticeImages??=new Map();const images=[];
   for(const url of content.images){if(session.noticeImages.size>=40)session.noticeImages.delete(session.noticeImages.keys().next().value);const key=crypto.randomUUID();session.noticeImages.set(key,url);images.push('/api/notice-image?key='+key)}
   let readStatus='unverified';try{const number=session.noticePages?.get(data.id)||1;const after=await siteRequest(session.jar,BASE+'/new_user/notice.jsp?id=gongi1&page='+number);if(isAuthenticatedPage(after.html)&&!/(?:계좌번호|포인트)\s*null/.test(require('./notice-reader.cjs').plain(after.html))){const item=require('./notice-reader.cjs').parseList(after.html,number).items.find(item=>item.id===data.id);if(item)readStatus=item.unread?'still_unread':'confirmed'}}catch{}
   session.time=Date.now();return send(res,200,{id:data.id,text:content.text,images,readStatus});
  }
  if(pathname==='/api/notice-image'&&req.method==='GET'){
   const session=sessionFor(req);const key=new URL(req.url,'http://localhost').searchParams.get('key');const address=session?.noticeImages?.get(key);if(!address)return send(res,404,{error:'공지 이미지를 다시 열어주세요.'});
   const response=await fetch(resolveSiteUrl(address),{headers:{Cookie:[...session.jar].map(([k,v])=>k+'='+v).join('; ')},redirect:'error',signal:AbortSignal.timeout(15000)});
   const type=(response.headers.get('content-type')||'').split(';')[0].toLowerCase();if(!response.ok||!['image/png','image/jpeg','image/gif','image/webp'].includes(type)||Number(response.headers.get('content-length')||0)>8000000)return send(res,422,{error:'공지 이미지를 확인하지 못했습니다.'});
   const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>8000000)throw Error('공지 이미지가 너무 큽니다.');chunks.push(chunk)}res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(Buffer.concat(chunks));
  }
  if(pathname==='/api/site-overview'&&req.method==='POST'){
   const session=sessionFor(req);if(!session)return send(res,401,{error:'사이트에 다시 로그인해주세요.'});
   const page=await siteRequest(session.jar,BASE+'/new_user/main_kia.jsp');
   let html=page.html;const pages=[pageSummary(html,page.url)];
   for(const m of page.html.matchAll(/<(?:frame|iframe)\b[^>]*\bsrc\s*=\s*['"]([^'"]+)['"]/gi)){
    if(pages.length>=6)break;
    try{const address=resolveSiteUrl(m[1],page.url);if(/logout|log_out|delete|insert|update|save|remove/i.test(address.pathname+address.search))continue;const child=await siteRequest(session.jar,address.href);html+='\n'+child.html;pages.push(pageSummary(child.html,child.url))}catch{}
   }
   if(!isAuthenticatedPage(html))return send(res,401,{error:'현재 사이트 로그인 유지 상태를 확인하지 못했습니다. 다시 로그인해주세요.'});
   const notice=require('./site-notice.cjs').noticeState(html);session.notice=notice;let workCounts;
   try{let formChecked=false;workCounts=await require('./site-counts.cjs').readWorkCounts(async url=>{const response=await siteRequest(session.jar,url);if(!formChecked&&new URL(url).pathname==='/new_user/build_sign.jsp'){formChecked=true;console.info(JSON.stringify({type:'cert_form_schema',at:new Date().toISOString(),...require('./certification.cjs').authShape(response.html)}));try{require('./certification.cjs').authFields(response.html);console.info(JSON.stringify({type:'cert_form_check',at:new Date().toISOString(),code:'CERT_FORM_VALID'}));}catch(error){const code=['CERT_FORM_MISSING','CERT_MODE_MISSING','CERT_MODE_DUPLICATE','CERT_MODE_UNSAFE','CERT_MODE_HAS_FINISHED','CERT_MODE_DELETE_ACTION','CERT_MODE_HAS_DEL_FRAGMENT','CERT_MODE_HAS_EXPIRE','CERT_MODE_HAS_CANCEL','CERT_MODE_UNKNOWN'].includes(error.code)?error.code:'CERTIFICATION_FAILED';errorRecords.record({stage:'certification',code,status:400});}}return response;});}
   catch(error){errorRecords.record({stage:'site-overview',code:'COUNT_UNVERIFIED'});workCounts={inProgress:null,completed:null,verified:false,checkedAt:new Date().toISOString(),error:error.message};}
   session.time=Date.now();const settlement=require('./settlement.cjs').parseSettlement(page.html);return send(res,200,{authenticated:true,notice,pages,workCounts,settlement,duplicateLookupImplemented:true,registrationEnabled:true});
  }
  if(['/api/certification/lookup','/api/certification/execute'].includes(pathname)&&req.method==='POST'){
   const session=sessionFor(req);if(!session)return send(res,401,{error:'사이트에 다시 로그인해주세요.'});
   const data=JSON.parse((await body(req,2048)).toString('utf8'));
   if(typeof data.contract!=='string'||typeof data.vin!=='string'||!/^(?:[A-Z][0-9]{4}|[A-Z]{2}[0-9]{3})[A-Z][A-Z0-9][0-9]{6}$/.test(data.contract)||!/^[A-HJ-NPR-Z0-9]{11}[0-9]{6}$/.test(data.vin))return send(res,400,{error:'계약번호와 차대번호를 확인해주세요.'});
   let result;
   try{result=pathname.endsWith('/lookup')?await certification.lookup(session,data):await dispatchBusiness(session.id,pathname,data,req.headers['idempotency-key'],()=>certification.execute(session,data));}
   catch(error){if([400,401,409,503].includes(error.status))return send(res,error.status,{error:error.message,errorCode:'REQUEST_REVIEW_REQUIRED',requestState:error.requestState||'unknown'});const code=['CERT_FORM_MODE_UNVERIFIED','CERT_FORM_MISSING','CERT_MODE_MISSING','CERT_MODE_DUPLICATE','CERT_MODE_UNSAFE','CERT_MODE_HAS_FINISHED','CERT_MODE_DELETE_ACTION','CERT_MODE_HAS_DEL_FRAGMENT','CERT_MODE_HAS_EXPIRE','CERT_MODE_HAS_CANCEL','CERT_MODE_UNKNOWN'].includes(error.code)?error.code:'CERTIFICATION_FAILED';const entry=errorRecords.record({stage:'certification',code,status:400});return send(res,400,{error:error.message||'사이트 인증 결과를 확인하지 못했습니다. 재전송하지 말고 확인해주세요.',errorCode:code,errorId:entry?.id||null});}
   const states=['certified','already_pending','already_completed','already_other','not_found','needs_review','notice_required','identity_conflict','protected','invalid_numbers','vehicle_not_found'];console.info(JSON.stringify({type:'certification_result',at:new Date().toISOString(),state:states.includes(result.state)?result.state:'unknown'}));
   session.time=Date.now();return send(res,200,result);
  }
  if(pathname==='/api/vehicle-status'&&req.method==='POST'){
   const session=sessionFor(req);if(!session)return send(res,401,{error:'앱에서 사이트에 로그인해주세요.'});
   const data=JSON.parse((await body(req)).toString('utf8'));
   if(!/^[A-Z0-9]{13}$/.test(data.contract||'')||!/^[A-HJ-NPR-Z0-9]{17}$/.test(data.vin||''))return send(res,400,{error:'계약번호와 차대번호를 확인해주세요.'});
   const query=new URLSearchParams({ord_stat_cd:'',start_dt:'2000-01-01',end_dt:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date()),srh_word:data.contract});
   const page=await siteRequest(session.jar,BASE+'/new_user/build_list.jsp?'+query);
   if(!isAuthenticatedPage(page.html))return send(res,401,{error:'사이트에 다시 로그인해주세요.'});
   const status=require('./vehicle-status.cjs').completedRecord(page.html,data.contract,data.vin);session.time=Date.now();return send(res,200,status);
  }
  if(pathname==='/api/film-stock'&&req.method==='POST'){
   const session=sessionFor(req);if(!session)return send(res,401,{error:'앱에서 사이트에 다시 로그인해주세요.'});
   const page=await siteRequest(session.jar,BASE+'/new_user/build_sign.jsp');if(!isAuthenticatedPage(page.html))return send(res,401,{error:'사이트 로그인 상태를 확인하지 못했습니다.'});
   const inventory=require('./completion-rules.cjs').parseInventory(page.html);
   if(!inventory.films.length)return send(res,422,{error:'사이트의 필름 재고를 확인하지 못했습니다.'});
   const films=inventory.films.filter(f=>f.name.startsWith('롤필름 ')&&Number.isFinite(f.remainingMeters)&&f.remainingMeters>=2.5).sort((a,b)=>a.remainingMeters-b.remainingMeters);
   session.time=Date.now();return send(res,200,{films,checkedAt:new Date().toISOString()});
  }
  if(pathname==='/api/completion-plan'&&req.method==='POST'){
   const session=sessionFor(req);if(!session)return send(res,401,{error:'앱에서 사이트에 로그인해주세요.'});
   const data=JSON.parse((await body(req)).toString('utf8'));
   if(typeof data.contract!=='string'||!/^[A-Z0-9]{13}$/.test(data.contract)||typeof data.vin!=='string'||!/^[A-HJ-NPR-Z0-9]{17}$/.test(data.vin))return send(res,400,{error:'인식한 계약번호와 차대번호를 확인해주세요.'});
   const page=await siteRequest(session.jar,BASE+'/new_user/build_sign.jsp');if(!isAuthenticatedPage(page.html))return send(res,401,{error:'사이트 로그인 상태를 확인하지 못했습니다.'});
   const rules=require('./completion-rules.cjs');const inventory=rules.parseInventory(page.html);
   if(!inventory.films.length)return send(res,422,{error:'사이트에서 실제 필름 재고를 읽지 못했습니다. 임의로 선택하지 않습니다.'});
   session.time=Date.now();return send(res,200,{plan:rules.planCompletion({...inventory,requiredMeters:data.requiredMeters,selectionMode:data.selectionMode==='count'?'count':undefined,rotationState:builderRotation.get(session.id)}),rules:data.selectionMode==='count'?rules.COUNT_COMPLETION_RULES:rules.RULES,submissionEnabled:false,duplicateVerified:false,checkedAt:new Date().toISOString()});
  }
  if(['/api/completion-test/prepare','/api/completion-test/execute','/api/completion-test/status'].includes(pathname)&&req.method==='POST'){
   const session=sessionFor(req);if(!session)return send(res,401,{error:'앱에서 다시 로그인해주세요.'});
   const data=JSON.parse((await body(req,2048)).toString('utf8'));let result;
   if(pathname.endsWith('/prepare'))result=await completionTest.prepare(session,data.scope,{requestedCount:data.requestedCount,reserveMeters:data.reserveMeters});
   else if(pathname.endsWith('/execute'))result=await dispatchBusiness(session.id,pathname,data,req.headers['idempotency-key'],()=>completionTest.execute(session,data.id,data.approved),completionTest.status(session));
   else result=completionTest.status(session);
   session.time=Date.now();return send(res,200,{job:result,testLimit:1});
  }
  if(pathname==='/api/login'&&req.method==='POST'){
   if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)&&!secureRequest(req))return send(res,403,{error:'실제 로그인에는 HTTPS 연결이 필요합니다. 현재 PC에서는 localhost로 접속해주세요.'});
   const data=JSON.parse((await body(req)).toString('utf8'));if(typeof data.id!=='string'||typeof data.password!=='string'||!data.id.trim()||!data.password||data.id.length>100||data.password.length>200)return send(res,400,{error:'아이디와 비밀번호를 확인해주세요.'});
   const jar=new Map();await siteRequest(jar,BASE+'/new_user/login_main_kia.jsp');
   const result=await siteRequest(jar,BASE+'/new_user/kia_login_main_Chk.jsp',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Referer:BASE+'/new_user/login_main_kia.jsp'},body:new URLSearchParams({login_type:'k',mid:data.id.trim(),pass:data.password}).toString()});data.password='';
   let authenticatedHtml=result.html;
   const frameUrls=[...result.html.matchAll(/<(?:frame|iframe)\b[^>]*\bsrc\s*=\s*['"]([^'"]+)['"]/gi)].map(m=>m[1]);
   for(const frame of frameUrls.slice(0,5)){
    try{const child=await siteRequest(jar,resolveSiteUrl(frame,result.url).href);authenticatedHtml+='\n'+child.html}catch{/* A third-party banner is not part of authentication. */}
   }
   // Verify the landing page with the same cookie jar; a login response alone
   // can be an intermediate page instead of the authenticated main document.
   const landing=await siteRequest(jar,BASE+'/new_user/main_kia.jsp');
   authenticatedHtml=landing.html;
   if(!isAuthenticatedPage(authenticatedHtml)||/(?:계좌번호|포인트)\s*null/.test(require('./notice-reader.cjs').plain(authenticatedHtml))){
    return send(res,401,{error:'사이트 로그인 성공을 확인하지 못했습니다. 계정 정보 또는 추가 안내를 확인해주세요.'});
   }
   const token=crypto.randomBytes(32).toString('hex');sessions.set(token,{jar,id:data.id.trim(),time:Date.now(),url:result.url,notice:require('./site-notice.cjs').noticeState(authenticatedHtml)});res.setHeader('Set-Cookie',`coupon_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800${secureRequest(req)?'; Secure':''}`);return send(res,200,{authenticated:true,id:data.id.trim(),notice:require('./site-notice.cjs').noticeState(authenticatedHtml)});
  }
  if(pathname==='/api/logout'&&req.method==='POST'){const token=(req.headers.cookie||'').match(/coupon_session=([a-f0-9]{64})/)?.[1];sessions.delete(token);res.setHeader('Set-Cookie','coupon_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return send(res,200,{authenticated:false})}
  if(pathname==='/api/recognize'&&req.method==='POST'){
   if(recognitionBusy)return send(res,429,{error:'서버에서 다른 사진을 인식하고 있습니다. 잠시 후 다시 시도해주세요.'});
   const diag=require('./runtime-diagnostics.cjs'),job=diag.begin();let phase='receive';diag.event('start',job.traceId);
   recognitionBusy=true;try{
   const receivedAt=Date.now(),bytes=await body(req,20*1024*1024),receiveMs=Date.now()-receivedAt;phase='prepare';
   const prepared=await require('./photo-input.cjs').preparePhoto(bytes);
   diag.event('prepared',job.traceId,{imageBytes:bytes.length,width:prepared.info.width,height:prepared.info.height,orientation:prepared.info.exifOrientation});phase='ocr';
   const result=await recognize(prepared.bytes);diag.event('finished',job.traceId,{durationMs:Date.now()-job.started});
   return send(res,200,{...result,input:{...prepared.info,receiveMs},pipelineTiming:{receiveMs,prepareMs:prepared.info.prepareMs,serverMs:Date.now()-receivedAt}});
   }catch(error){const code=phase==='prepare'?'PHOTO_PREPARE_FAILED':diag.code(error),context={...diag.memory(),traceId:job.traceId,durationMs:Date.now()-job.started};const entry=errorRecords.record({stage:'recognize',code,status:500},context);diag.event('failed',job.traceId,context);return send(res,500,{error:'사진 처리 중 오류가 났습니다. 오류 기록을 저장했습니다.',errorCode:code,errorId:entry?.id||null});
   }finally{recognitionBusy=false;}
  }
  return send(res,404,{error:'연결되지 않은 기능입니다.'});
 }
 const file=routes[pathname];if(!file){res.writeHead(404);return res.end('Not found')}const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});fs.createReadStream(path.join(__dirname,file)).pipe(res);
}catch(error){const stage=({'/api/login':'login','/api/logout':'logout','/api/recognize':'recognize','/api/site-overview':'site-overview','/api/completion-plan':'completion-plan'})[new URL(req.url,'http://localhost').pathname];if(stage)errorRecords.record({stage,code:error.name==='TimeoutError'?'TIMEOUT':'UNEXPECTED'});send(res,[400,401,409,503].includes(error.status)?error.status:400,{error:error.name==='TimeoutError'?'사이트 응답 시간이 초과됐습니다.':error.message||'처리하지 못했습니다.'})}});
setInterval(()=>{for(const [key,budget] of errorBudgets)if(Date.now()-budget.at>=60000)errorBudgets.delete(key);for(const [token,session] of sessions)if(Date.now()-session.time>1800000)sessions.delete(token)},60000).unref();
module.exports={server,parseText,recognize,resolveSiteUrl,inlineRedirect,isAuthenticatedPage,decodeSiteHtml,parseWorkCounts};

