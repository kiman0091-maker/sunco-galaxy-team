const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {progressInfo,readWorkCounts}=require('./site-counts.cjs');
const {parseInventory,selectCountFilm}=require('./completion-rules.cjs');
const {chooseBuilder}=require('./builder-rotation.cjs');
const ROOT='https://www.tbtinting.com';
const clean=s=>s.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/\s+/g,' ').trim();
function attrs(s){const a={};for(const m of s.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))a[m[1]]=m[2]??m[3]??m[4];return a;}
function inputs(html){html=html.replace(/<!--[\s\S]*?-->/g,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');return [...html.matchAll(/<input\b[^>]*>/gi)].map(m=>attrs(m[0]));}
function form(html,name){html=html.replace(/<!--[\s\S]*?-->/g,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');const m=[...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].find(m=>attrs(m[1]).name===name);if(!m)throw Error('사이트 입력 양식이 변경됐습니다. 전송하지 않습니다.');return m[2];}
function decode(s){return s.replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&amp;/g,'&');}
let koreanBytes;
function encodeForm(data){
 if(!koreanBytes){koreanBytes=new Map();const d=new TextDecoder('euc-kr',{fatal:true});for(let a=129;a<=254;a++)for(let b=65;b<=254;b++){try{const c=d.decode(Uint8Array.of(a,b));if([...c].length===1&&!koreanBytes.has(c))koreanBytes.set(c,[a,b]);}catch{}}}
 const encode=s=>[...String(s)].map(c=>{if(c.codePointAt(0)<128)return encodeURIComponent(c).replace(/%20/g,'+');const bytes=koreanBytes.get(c);if(!bytes)throw Error('사이트에 보낼 한글을 변환하지 못했습니다.');return bytes.map(b=>'%'+b.toString(16).toUpperCase()).join('');}).join('');
 return Object.entries(data).map(([k,v])=>encode(k)+'='+encode(v)).join('&');
}
function consumption(html){
 // Read literal arguments only: never evaluate the site's JavaScript.
 const source=html.replace(/<!--[\s\S]*?-->/g,'');
 const notice=[...source.matchAll(/\balert\s*\(\s*(['"])([^'"\r\n]*)\1\s*\)/g)].map(m=>m[2].trim()).filter(Boolean);
 if(notice.length)throw Error('사이트 안내: '+notice.join(' / ')+' (완료 전송 전 중단)');
 if(/expire_[h_]*data_chk\s*\(|\balert\s*\(/.test(source))throw Error('사이트의 추가 안내를 확인해야 합니다. 완료 전송 전 중단했습니다.');
 const calls=[...source.matchAll(/\b(?:parent|top)\.(?:window\.)?insert_val\s*\(/g)];
 if(calls.length!==1)throw Error('차량 사용량 응답을 하나로 확인하지 못했습니다. 완료 전송은 하지 않았습니다.');
 let rest=source.slice(calls[0].index+calls[0][0].length);const args=[];
 for(let i=0;i<4;i++){
  rest=rest.trimStart();let value,used;
  if(rest[0]==='"'||rest[0]==="'"){
   const q=rest[0];value='';let j=1,closed=false;
   for(;j<rest.length;j++){
    const c=rest[j];if(c===q){closed=true;j++;break;}
    if(c==='\\'){
     const n=rest[++j];if(n===undefined)break;
     if(n==='u'||n==='x'){const count=n==='u'?4:2,hex=rest.slice(j+1,j+1+count);if(!new RegExp('^[0-9a-fA-F]{'+count+'}$').test(hex))throw Error('응답 문자 형식을 확인하지 못했습니다.');value+=String.fromCharCode(parseInt(hex,16));j+=count;}
     else if(n==='n'||n==='r'||n==='t')value+=' ';
     else if(n==='\\'||n==='"'||n==="'")value+=n;
     else throw Error('응답 문자 형식을 확인하지 못했습니다.');
    }else value+=c;
   }
   if(!closed)throw Error('응답 문자열이 끝나지 않았습니다.');used=j;
  }else{
   const number=rest.match(/^(?:\d+(?:\.\d+)?|\.\d+)(?=\s*[,\)])/);if(!number)throw Error('사용량이 숫자가 아닙니다. 추측하지 않고 멈춥니다.');value=number[0];used=number[0].length;
  }
  args.push(value);rest=rest.slice(used).trimStart();const delimiter=i===3?')':',';if(rest[0]!==delimiter)throw Error('차량 응답 항목이 일치하지 않습니다.');rest=rest.slice(1);
 }
 const price=args[1].trim(),length=args[3].trim();
 if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(price)||!/^\d+(?:\.\d+)?$/.test(length))throw Error('사용량과 시공가 숫자를 확인하지 못했습니다.');
 const meters=Number(length),amount=Number(price.replace(/,/g,''));if(!(meters>0&&meters<100&&amount>0)||!args[2].trim())throw Error('차량 사용량과 시공가가 올바르지 않습니다.');return {meters,amount,car:args[2]};
}
function pendingPage(html,period,page){
 const fields=Object.fromEntries(inputs(html).map(a=>[a.name,a.value||'']));
 if(fields.ord_stat_cd!=='1'||fields.start_dt!==period.start||fields.end_dt!==period.end||fields.srh_word)throw Error('대기 목록의 조회 기간을 확인하지 못했습니다.');
 if(Number(html.match(/var\s+currentPage\s*=\s*['"](\d+)/)?.[1])!==page)throw Error('대기 목록 페이지를 확인하지 못했습니다.');
 const jobs=[],pages=new Set([page]);
 for(const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)){
  const href=attrs(m[1]).href;if(!href)continue;let u;try{u=new URL(href.replace(/&amp;/g,'&'),ROOT+'/new_user/')}catch{continue}
  if(u.origin!==ROOT)continue;
  if(u.pathname==='/new_user/build_sign.jsp'&&clean(m[2])==='시공중'){
   const contract=u.searchParams.get('termsno'),vin=u.searchParams.get('vinno');
   if(!/^[A-Z0-9]{13}$/.test(contract)||!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin))throw Error('대기 차량 번호를 정확히 읽지 못했습니다.');
   jobs.push({contract,vin});
  }
  if(u.pathname==='/new_user/build_list.jsp'&&u.searchParams.get('ord_stat_cd')==='1'&&u.searchParams.get('start_dt')===period.start&&u.searchParams.get('end_dt')===period.end){const n=Number(u.searchParams.get('page'));if(n>0&&Number.isSafeInteger(n))pages.add(n);}
 }
 return {jobs,pages:[...pages]};
}
function resultState(html){
 const messages=[...html.matchAll(/\balert\(\s*(['"])([\s\S]*?)\1\s*\)/g)].map(m=>m[2].replace(/\s+/g,' ').trim());
 if(messages.length===1&&/^시공완료가 정상\s*처리\s*되었습니다\.?$/.test(messages[0]))return {state:'succeeded',message:messages[0]};
 return {state:'uncertain',message:'사이트 응답을 확정하지 못했습니다. 재제출하지 않고 상태를 확인합니다.'};
}
function batchSelection(scope,options){
 if(!['all','count'].includes(scope)||!options||typeof options!=='object'||Array.isArray(options))throw Error('작업 기준과 선택값을 다시 확인해주세요.');
 if(scope==='all'){
  if(!Number.isInteger(options.reserveMeters)||options.reserveMeters<1||options.reserveMeters>10||options.requestedCount!=null)throw Error('남길 길이를 1~10m에서 선택해주세요. 화면을 새로고침한 뒤 다시 선택해주세요.');
  return {reserveMeters:options.reserveMeters,requestedCount:null};
 }
 if(!Number.isSafeInteger(options.requestedCount)||options.requestedCount<1||options.requestedCount>10000||options.reserveMeters!=null)throw Error('완료할 대수를 다시 선택해주세요. 화면을 새로고침한 뒤 다시 선택해주세요.');
 return {requestedCount:options.requestedCount,reserveMeters:null};
}
function requireReserve(job,remainingMeters,usedMeters,isLastRoll=true){
 const selection=batchSelection(job.scope,job);
 if(!Number.isFinite(remainingMeters)||remainingMeters<0||!Number.isFinite(usedMeters)||usedMeters<=0)throw Error('필름 잔여량과 차량별 사용량을 확인하지 못했습니다.');
 if(remainingMeters<usedMeters)throw Error('필름이 부족합니다. 완료 전송은 하지 않았습니다.');
 if(job.scope==='all'&&isLastRoll&&remainingMeters-usedMeters+1e-9<selection.reserveMeters)throw Error('마지막 롤에 '+selection.reserveMeters+'m를 남겨야 하므로 완료 전송은 하지 않았습니다.');
}
function publicJob(job){return {id:job.id,state:job.state,contract:job.contract,vin:job.vin,scope:job.scope,requestedCount:job.requestedCount,reserveMeters:job.reserveMeters,limit:1,film:job.film,builder:job.builder,period:job.before?.period,message:job.message,before:job.before,after:job.after};}
function createCompletionTest({directory,request,isAuthenticated,rotation,visiblePerform}){
 // Both PC and hosted completion use the site's browser workflow.
 // Never fall back to constructing a direct completion POST.
 visiblePerform ||= args=>require('./visible-completion.cjs').perform(args);
 const locks=new Set(),measurements=new Map();
 function beginTiming(id,phase){measurements.set(id,{phase,start:performance.now(),requests:0,requestMs:0,routes:{}});}
 function endTiming(id){const t=measurements.get(id);if(!t)return;measurements.delete(id);console.log(JSON.stringify({type:'completion_timing',phase:t.phase,totalMs:Math.round(performance.now()-t.start),requests:t.requests,requestMs:Math.round(t.requestMs),routes:t.routes}));}

 const key=id=>crypto.createHash('sha256').update(id).digest('hex');
 const filename=id=>path.join(directory,'completion-test-'+key(id)+'.json');
 function read(id){try{return JSON.parse(fs.readFileSync(filename(id),'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw Error('이전 작업 이력을 읽지 못했습니다. 새로 제출하지 않습니다.');}}
 function save(id,job){fs.mkdirSync(directory,{recursive:true});const f=filename(id);fs.writeFileSync(f+'.tmp',JSON.stringify(job),{mode:0o600});fs.renameSync(f+'.tmp',f);}
 async function page(session,url,options){const start=performance.now();try{return await request(session.jar,url,options);}finally{const t=measurements.get(session.id);if(t){const ms=performance.now()-start;t.requests++;t.requestMs+=ms;const u=new URL(url),kind=u.pathname.endsWith('build_list.jsp')?'list':u.pathname.endsWith('build_sign.jsp')?'sign':u.pathname.endsWith('process_builder_ajax.jsp')?'builders':'other';const r=t.routes[kind]||={count:0,ms:0};r.count++;r.ms+=Math.round(ms);}}}

 const listUrl=(period,pageNumber)=>ROOT+'/new_user/build_list.jsp?'+new URLSearchParams({ord_stat_cd:'1',start_dt:period.start,end_dt:period.end,srh_word:'',page:String(pageNumber)});
 async function pending(session,period){const todo=[1],seen=new Set(),all=[];
  while(todo.length){const n=todo.shift();if(seen.has(n))continue;if(n>100||seen.size>=100)throw Error('대기 목록이 너무 많습니다.');const p=await page(session,listUrl(period,n));if(!isAuthenticated(p.html))throw Error('앱에서 다시 로그인해주세요.');const parsed=pendingPage(p.html,period,n);seen.add(n);all.push(...parsed.jobs);for(const x of parsed.pages)if(!seen.has(x))todo.push(x);}
  if(seen.size!==Math.max(...seen))throw Error('대기 목록 일부가 누락됐습니다.');return all;
 }
 async function prepare(session,scope,options){
  const selection=batchSelection(scope,options);
  if(locks.has(session.id))throw Error('작업을 처리 중입니다.');locks.add(session.id);
  beginTiming(session.id,'prepare');
  try{
   const old=read(session.id);if(old&&['submitting','uncertain','succeeded_unreconciled'].includes(old.state))throw Error('이전 작업 결과 확인이 먼저 필요합니다. 재제출하지 않습니다.');
   const before=await readWorkCounts(u=>page(session,u));if(before.inProgress===0||scope==='count'&&selection.requestedCount>before.inProgress)throw Error('현재 시공중 차량 수가 변경됐습니다. 완료할 범위를 다시 선택해주세요.');const jobs=await pending(session,before.period);
   if(jobs.length!==before.inProgress)throw Error('조회 중 대기 목록이 변경됐습니다. 다시 시작해주세요.');
   const excluded=new Set(['A5325AX089652','A5326AX054857','A5326AX053987','A5326AX040287','A5325AX074056','A5326AX041646','A5326AX042297','A5326AX050585','A5325AX086001','R3126M5000065','A5325AX033490']);
   const target=jobs.reverse().find(j=>!excluded.has(j.contract));if(!target)throw Error('테스트할 대기 차량이 없습니다.');
   const sign=await page(session,ROOT+'/new_user/build_sign.jsp');const inventory=parseInventory(sign.html);const film=selectCountFilm(inventory.films);if(film.state!=='selected')throw Error(film.message);
   // No authentication or completion POST during preparation.
   let builders=inventory.builders;
   if(!builders.length){const response=await page(session,ROOT+'/new_user/process_builder_ajax.jsp?mode=getBuilderList&delete_yn=N');let data;try{data=JSON.parse(response.html)}catch{throw Error('틴팅프로 목록을 읽지 못했습니다.');}if(String(data.result)!=='1')throw Error('틴팅프로 조회가 실패했습니다.');builders=(data.data||[]).map(b=>({id:b.builder_id,name:b.builder_name}));}
   if(builders.length!==1)throw Error('이 PC로 옮겨오지 않은 순환 이력을 먼저 확인해야 합니다. 여러 명일 때 임의로 첫 사람을 선택하지 않습니다.');
   const state=rotation.get(session.id),builder=chooseBuilder(builders,state);
   const job={id:crypto.randomUUID(),state:'prepared',scope,...selection,limit:1,...target,film:film.film,builder,expectedLastBuilderId:state.lastBuilderId,before,createdAt:Date.now(),message:'1대 테스트 준비 완료. 아직 사이트에 전송하지 않았습니다.'};
   save(session.id,job);return publicJob(job);
  }finally{endTiming(session.id);locks.delete(session.id);}
 }
 async function execute(session,id,approved){
  if(approved!==true)throw Error('실제 1대 완료 승인이 필요합니다.');
  if(locks.has(session.id))throw Error('이미 작업 중입니다.');locks.add(session.id);
  beginTiming(session.id,'execute');
  try{
   const job=read(session.id);if(!job||job.id!==id)throw Error('준비한 작업을 찾지 못했습니다.');
   if(job.state!=='prepared')return publicJob(job);
   batchSelection(job.scope,job);
   if(Date.now()-job.createdAt>300000)throw Error('준비한 작업이 오래됐습니다. 다시 준비해주세요.');
   // Preparation already selected the target. Do not crawl the whole list again.
   // The browser loads that target using the site's normal link/authentication flow.
   const linkedUrl=ROOT+'/new_user/build_sign.jsp?'+new URLSearchParams({vinno:job.vin,termsno:job.contract,mode:'link'});
   const sign=await page(session,linkedUrl);if(!isAuthenticated(sign.html))throw Error('다시 로그인해주세요.');
   const all=inputs(form(sign.html,'BuildingForm'));const base=Object.fromEntries(all.filter(i=>['mode','confirm_','building_roll','tmp_carname'].includes(i.name)).map(i=>[i.name,i.value||'']));
   const film=selectCountFilm(parseInventory(sign.html).films);if(film.state!=='selected'||film.film.name!==job.film.name)throw Error('사용할 필름이 변경됐습니다. 다시 준비해주세요.');
   const inventoryBlock=[...sign.html.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)].find(m=>inputs(m[1]).some(i=>i.name==='building_value'&&decode(i.value||'')===film.film.name));
   const codes=Object.fromEntries(inputs(inventoryBlock?.[1]||'').map(i=>[i.name,decode(i.value||'')]));if(codes.sel_g_code!=='01'||!codes.sel_m_code||!codes.sel_p_code)throw Error('롤필름 전송 코드를 확인하지 못했습니다.');
   const rosterResponse=await page(session,ROOT+'/new_user/process_builder_ajax.jsp?mode=getBuilderList&delete_yn=N');const roster=JSON.parse(rosterResponse.html);const builder=roster.data?.find(b=>b.builder_id===job.builder.id);if(String(roster.result)!=='1'||!builder)throw Error('틴팅프로 목록이 변경됐습니다.');
   const finish=Object.fromEntries(inputs(form(sign.html,'BuildingFinishForm')).map(i=>[i.name,decode(i.value||'')]));if(finish.mid!==session.id)throw Error('사이트 계정 정보가 일치하지 않습니다.');
   // Mark before any POST. No request in this job is retried, including after restart.
   job.state='submitting';job.message='1대 처리 요청 중입니다. 재제출하지 마세요.';save(session.id,job);
   try{
    if(visiblePerform){
     const response=await visiblePerform({session,job,onSubmit:async()=>{job.completionSubmitted=true;save(session.id,job);}});
     const result=resultState(response.html);job.state=result.state==='succeeded'?'succeeded_unreconciled':'uncertain';job.message=result.message;save(session.id,job);
    }else{
    // Same load of an existing authenticated voucher as the site's mode=link action.
    const auth=await page(session,ROOT+'/new_user/process_build.jsp',{method:'POST',captureResponse:true,headers:{'Content-Type':'application/x-www-form-urlencoded',Referer:linkedUrl},body:encodeForm({...base,vinno:job.vin,termsno:job.contract,confirm_:''})});
    const use=consumption(auth.html);
    if(film.film.remainingMeters<use.meters)throw Error('필름이 부족합니다. 완료 전송은 하지 않았습니다.');
    const other=parseInventory(sign.html).films.filter(f=>f.remainingMeters>2.5&&f.name!==film.film.name);
    requireReserve(job,film.film.remainingMeters,use.meters,!other.length);
    const payload={...finish,mode:'finished_confirm',termsno:job.contract,vinno:job.vin,gname:film.film.name,g_code:codes.sel_g_code,m_code:codes.sel_m_code,p_code:codes.sel_p_code,b_yn:'Y',building_roll:String(use.meters),stt_amt:String(use.amount),builder_id1:builder.builder_id,builder_name1:builder.builder_name,builder_full_mobile1:[builder.builder_mobile1,builder.builder_mobile2,builder.builder_mobile3].join('-'),builder_id2:'',builder_name2:'',builder_full_mobile2:''};
    job.completionSubmitted=true;save(session.id,job);
    const response=await page(session,ROOT+'/new_user/process_build.jsp',{method:'POST',captureResponse:true,headers:{'Content-Type':'application/x-www-form-urlencoded',Referer:ROOT+'/new_user/build_sign.jsp'},body:encodeForm(payload)});
    const result=resultState(response.html);job.state=result.state==='succeeded'?'succeeded_unreconciled':'uncertain';job.message=result.message;save(session.id,job);
    }
   }catch(error){job.state=job.completionSubmitted?'uncertain':'blocked_before_submission';job.message=error.message;save(session.id,job);return publicJob(job);}
   // One-test batch is now over: reconcile once, never retry a submission.
   try{
    const after=await readWorkCounts(u=>page(session,u));job.after=after;
    const completed=await page(session,ROOT+'/new_user/build_list.jsp?'+new URLSearchParams({ord_stat_cd:'2',start_dt:job.before.period.start,end_dt:job.before.period.end,srh_word:job.contract,page:'1'}));
    const record=require('./vehicle-status.cjs').completedRecord(completed.html,job.contract,job.vin);
    if(record.state==='already_completed'&&after.period.start===job.before.period.start&&after.period.end===job.before.period.end&&after.inProgress===job.before.inProgress-1&&after.completed===job.before.completed+1){
     rotation.commitVerifiedCompletion(session.id,{contract:job.contract,vin:job.vin,builderId:job.builder.id,expectedLastBuilderId:job.expectedLastBuilderId},{recordStatus:'completed',contract:job.contract,vin:job.vin,inProgressDelta:-1,completedDelta:1});
     job.state='verified';job.message='1대 완료를 확인했습니다. 테스트이므로 여기서 멈춥니다.';
    }else {job.state='uncertain';job.message='전체 건수 대조가 일치하지 않습니다. 재제출하지 않고 확인이 필요합니다.';}
   }catch{job.message='사이트 결과를 받았지만 최종 대조를 확인하지 못했습니다. 재제출하지 마세요.';}
   save(session.id,job);return publicJob(job);
  }finally{endTiming(session.id);locks.delete(session.id);}
 }
 return {prepare,execute,status:session=>{const j=read(session.id);return j?publicJob(j):null;}};
}
module.exports={pendingPage,resultState,createCompletionTest,encodeForm,consumption,batchSelection,requireReserve};
