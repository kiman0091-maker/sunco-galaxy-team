const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {progressInfo}=require('./site-counts.cjs');const {consumption,encodeForm}=require('./completion-test.cjs');const {noticeState}=require('./site-notice.cjs');
const ROOT='https://www.tbtinting.com';
const blocked=new Set(['R3126GX000049','A5325AX089652','A5326AX054857','A5326AX053987','A5326AX040287','A5325AX074056','A5326AX050585','A5325AX086001','R3126GN000019','R3125FX000305','A5325AX039809','R3126NX000013','EE126GL000059','EE126W2000077','R3126DN000044','R3126DN000040','EE126MQ000208','A3726GN000126']);
function attrs(s){const a={};for(const m of s.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))a[m[1].toLowerCase()]=(m[2]??m[3]??m[4]).replace(/&amp;/g,'&');return a}
function plain(s){return s.replace(/<!--[\s\S]*?-->/g,'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/\s+/g,' ').trim()}
function rows(html){
 const re=/<\/?div\b[^>]*>/gi,stack=[],out=[];let m;
 while((m=re.exec(html))){if(m[0][1]!=='/')stack.push({at:m.index,isRow:(attrs(m[0]).class||'').split(/\s+/).includes('table_list')});else{const open=stack.pop();if(!open?.isRow)continue;const part=html.slice(open.at,re.lastIndex),text=plain(part);const identities=[...part.matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span>/gi)].filter(x=>(attrs(x[1]).class||'').split(/\s+/).includes('txtN_15_03')).map(x=>plain(x[2]));const identity=identities.find(x=>/\b[A-HJ-NPR-Z0-9]{17}\b/.test(x)&&/\b[A-Z0-9]{13}\b/.test(x));if(!identity)continue;const vin=identity.match(/\b[A-HJ-NPR-Z0-9]{17}\b/)[0],contract=identity.match(/\b[A-Z0-9]{13}\b/)[0];out.push({contract,vin,state:/시공완료/.test(text)?'completed':/시공중/.test(text)?'pending':'other'});}}
 return out;
}
function parseList(html,{word,end}){
 if(!/시공\s*내역\s*조회/.test(plain(html)))throw Error('사이트 중복 조회 화면을 확인하지 못했습니다.');
 const f=Object.fromEntries([...html.matchAll(/<input\b[^>]*>/gi)].map(m=>attrs(m[0])).filter(a=>a.name).map(a=>[a.name,a.value||'']));
 if(f.start_dt!=='2000-01-01'||f.end_dt!==end||f.ord_stat_cd!==''||f.srh_word!==word)throw Error('중복 조회의 기간·검색 조건이 일치하지 않습니다.');
 return rows(html);
}
function authShape(html){
 // Fixed schema facts only: no HTML, arbitrary values, identifiers or credentials.
 const clean=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<!--[\s\S]*?-->/g,'');
 const forms=[...clean.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)];
 const form=forms.find(m=>attrs(m[1]).name==='BuildingForm');
 if(!form)return {found:false,formCount:Math.min(forms.length,20)};
 const tags=[...form[2].matchAll(/<input\b[^>]*>/gi)].map(m=>({tag:m[0],field:attrs(m[0])}));
 const modes=tags.filter(x=>x.field.name==='mode');
 const known=['','confirm','finished','finished_confirm','finished_h_confirm','delete_build_sign','set_build_expire_reason','set_h_build_expire_reason'];
 const mode=modes[0]?.field.value||'';
 return {found:true,formCount:Math.min(forms.length,20),modeCount:Math.min(modes.length,20),modeKind:known.includes(mode)?(mode||'blank'):'other',modeLength:Math.min(mode.length,1000),modeHasValue:!!modes[0]&&Object.hasOwn(modes[0].field,'value'),modeBeforeVin:modes.length===1&&tags.indexOf(modes[0])<tags.findIndex(x=>x.field.name==='vinno'),nestedForm:/<form\b/i.test(form[2]),hasVin:tags.some(x=>x.field.name==='vinno'),hasContract:tags.some(x=>x.field.name==='termsno'),hasCompletionFields:tags.some(x=>x.field.name==='stt_amt'||x.field.name==='gname'),scriptFirstMatches: false};
}
function authFields(html){
 const clean=html.replace(/<!--[\s\S]*?-->/g,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
 const form=[...clean.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].find(m=>attrs(m[1]).name==='BuildingForm');
 if(!form)throw Object.assign(Error('사이트 시공 인증 양식을 확인하지 못했습니다. 인증을 전송하지 않았습니다.'),{code:'CERT_FORM_MISSING'});
 const inputs=[...form[2].matchAll(/<input\b[^>]*>/gi)].map(m=>attrs(m[0]));
 const modes=inputs.filter(a=>a.name==='mode');
 // The site's chk() submits the initial blank mode. Never infer a missing mode.
 const fail=code=>{throw Object.assign(Error('사이트 인증 양식을 확인하지 못해 전송을 중단했습니다. 원인을 오류번호로 기록했습니다.'),{code});};
 if(modes.length===0)fail('CERT_MODE_MISSING');
 if(modes.length>1)fail('CERT_MODE_DUPLICATE');
 const mode=modes[0].value||'';
 // Record only fixed categories; never copy site field values to diagnostics.
 if(mode==='finished'){
  // Observed on the real initial BuildingForm. The separate completion action
  // is finished_confirm. Require the site's authentication handler as evidence.
  const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).join('\n');
  const handler=scripts.match(/function\s+chk\s*\(\s*\)\s*\{([\s\S]*?)(?=\n\s*function\s|$)/)?.[1]||'';
  const authHandler=/var\s+fm\s*=\s*document\.BuildingForm\s*;/.test(handler)&&/fm\.action\s*=\s*["']process_build\.jsp["']/.test(handler)&&/fm\.confirm_\.value\s*=\s*["']["']/.test(handler)&&/fm\.submit\s*\(\s*\)/.test(handler)&&!/\.mode\.value\s*=/.test(handler);
  const noCompletionFields=!inputs.some(a=>['stt_amt','gname','builder_id1','builder_id2'].includes(a.name));
  if(!authHandler||!noCompletionFields||!inputs.some(a=>a.name==='vinno')||!inputs.some(a=>a.name==='termsno'))fail('CERT_MODE_HAS_FINISHED');
 }else if(/finished/i.test(mode))fail('CERT_MODE_HAS_FINISHED');
 if(/del/i.test(mode))fail(/^delete(?:_|$)/i.test(mode)?'CERT_MODE_DELETE_ACTION':'CERT_MODE_HAS_DEL_FRAGMENT');
 if(/expire/i.test(mode))fail('CERT_MODE_HAS_EXPIRE');
 if(/cancel/i.test(mode))fail('CERT_MODE_HAS_CANCEL');
 if(!['','confirm','finished'].includes(mode))fail('CERT_MODE_UNKNOWN');
 return Object.fromEntries(inputs.filter(a=>['mode','confirm_','building_roll','tmp_carname'].includes(a.name)).map(a=>[a.name,a.value||'']));
}
function createCertification({directory,request,isAuthenticated,now=()=>new Date()}){
 const locks=new Set(),proof=new Map();
 const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
 const filename=(id,contract,vin)=>path.join(directory,'certification',hash(id),hash(contract+'/'+vin)+'.json');
 function read(id,c,v){try{return JSON.parse(fs.readFileSync(filename(id,c,v),'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw Error('이전 인증 기록을 읽지 못했습니다. 재전송하지 않습니다.')}}
 function save(id,j){const f=filename(id,j.contract,j.vin);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f+'.tmp',JSON.stringify(j),{mode:0o600});fs.renameSync(f+'.tmp',f)}
 const endDate=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(now());
 async function page(session,url,options){const r=await request(session.jar,url,options);if(!options?.method&&!isAuthenticated(r.html))throw Error('사이트 로그인 상태를 확인하지 못했습니다. 다시 로그인해주세요.');return r;}
 async function list(session,word,end){const q=new URLSearchParams({ord_stat_cd:'',start_dt:'2000-01-01',end_dt:end,srh_word:word});const r=await page(session,ROOT+'/new_user/build_list.jsp?'+q);return parseList(r.html,{word,end});}
 async function searchProof(session,end){const cached=proof.get(session.id);if(cached&&cached.end===end&&Date.now()-cached.at<300000)return;const first=await list(session,'',end);if(!first.length)throw Error('기존 계약으로 중복 검색 기능을 검증하지 못했습니다. 자동 인증을 중단합니다.');const item=first[0];for(const word of [item.contract,item.vin]){const found=await list(session,word,end);if(!found.some(r=>r.contract===item.contract&&r.vin===item.vin)||found.some(r=>r.contract!==item.contract||r.vin!==item.vin))throw Error('계약번호·차대번호 검색이 정확한지 확인하지 못했습니다.');}proof.set(session.id,{at:Date.now(),end});}
 async function lookup(session,contract,vin,end){await searchProof(session,end);const a=await list(session,contract,end),b=await list(session,vin,end);if(a.some(x=>x.contract!==contract)||b.some(x=>x.vin!==vin))throw Error('사이트가 검색 조건과 다른 계약을 반환했습니다.');const found=[...a,...b];if(found.some(x=>x.contract!==contract||x.vin!==vin))return {state:'identity_conflict'};const states=new Set(found.map(x=>x.state));if(states.size>1)return {state:'identity_conflict'};return {state:found.length?'already_'+found[0].state:'not_found'};}
 async function execute(session,{contract,vin}){
 if(!/^(?:[A-Z]\d{4}|[A-Z]{2}\d{3})[A-Z][A-Z0-9]\d{6}$/.test(contract||'')||!/^[A-HJ-NPR-Z0-9]{11}\d{6}$/.test(vin||''))return {state:'invalid_numbers',message:'계약번호와 차대번호가 모두 확인돼야 인증합니다.'};
 if(locks.has(session.id))throw Error('이 계정의 사이트 작업이 진행 중입니다. 잠시 후 확인해주세요.');locks.add(session.id);
 try{
 const end=endDate();const prior=read(session.id,contract,vin);const main=await page(session,ROOT+'/new_user/main_kia.jsp');if(noticeState(main.html).unread)return {state:'notice_required',message:'미열람 필수 공지를 먼저 직접 확인해주세요.'};
 const status=await lookup(session,contract,vin,end);
 if(status.state!=='not_found')return {...status,message:status.state==='identity_conflict'?'계약번호·차대번호가 기존 기록과 충돌합니다. 확인해주세요.':'사이트에 이미 등록된 건입니다. 재인증하지 않습니다.'};
 if(blocked.has(contract))return {state:'protected',message:'이미 처리한 것으로 지정된 서류입니다. 재인증하지 않습니다.'};
 if(prior?.postAttempted)return {state:'needs_review',message:'이전에 인증 요청한 기록이 있습니다. 재전송하지 않고 사이트에서 확인해야 합니다.'};
 const sign=await page(session,ROOT+'/new_user/build_sign.jsp');const before=progressInfo(sign.html);const fields=authFields(sign.html);
 const job={contract,vin,state:'submitting',postAttempted:true,before,startedAt:now().toISOString()};save(session.id,job);
 let response,vehicle,error;
 try{response=await page(session,ROOT+'/new_user/process_build.jsp',{method:'POST',captureResponse:true,headers:{'Content-Type':'application/x-www-form-urlencoded',Referer:ROOT+'/new_user/build_sign.jsp'},body:encodeForm({...fields,vinno:vin,termsno:contract,confirm_:''})});vehicle=consumption(response.html);}catch(e){error=e;}
 let after,record;
 try{after=progressInfo((await page(session,ROOT+'/new_user/build_sign.jsp')).html);record=await lookup(session,contract,vin,end);}catch(e){error??=e;}
 const success=!!vehicle&&!!after&&record?.state==='already_pending'&&after.inProgress===before.inProgress+1&&JSON.stringify(after.period)===JSON.stringify(before.period);
 const vehicleNotFound=/일치하는\s*차량정보가\s*없습니다/.test(response?.html||error?.message||'')&&record?.state==='not_found'&&after?.inProgress===before.inProgress&&JSON.stringify(after?.period)===JSON.stringify(before.period);
 const verification={vehicle:!!vehicle,counts:!!after,pending:record?.state==='already_pending',countPlusOne:!!after&&after.inProgress===before.inProgress+1,samePeriod:!!after&&JSON.stringify(after.period)===JSON.stringify(before.period)};
 const missing=[];if(!verification.vehicle)missing.push('차종·시공가 응답');if(!verification.counts)missing.push('처리 후 건수 조회');else{if(!verification.countPlusOne)missing.push('시공중 건수 1건 증가');if(!verification.samePeriod)missing.push('동일 조회 기간');}if(!verification.pending)missing.push('해당 계약의 시공중 등록 조회');
 const checkId=crypto.randomUUID();console.info(JSON.stringify({type:'certification_verification',at:now().toISOString(),checkId,state:success?'certified':vehicleNotFound?'vehicle_not_found':'needs_review',...verification}));
 job.state=success?'certified':vehicleNotFound?'vehicle_not_found':'needs_review';job.vehicle=vehicle;job.after=after;job.message=success?'시공 인증과 시공중 건수 1건 증가를 확인했습니다.':vehicleNotFound?'일치하는 차량정보가 없습니다.':'확인하지 못한 항목: '+missing.join(', ')+'. 사이트에 처리됐을 수 있으므로 재전송하지 마세요. 확인번호: '+checkId;job.finishedAt=now().toISOString();save(session.id,job);
 return {state:job.state,message:job.message,contract,vin,vehicle,before,after,siteMessage:error?.message?.startsWith('사이트 안내:')?error.message:undefined};
 }finally{locks.delete(session.id)}
 }
 return {execute,lookup:(session,data)=>lookup(session,data.contract,data.vin,endDate())};
}
module.exports={createCertification,parseList,rows,authFields,authShape};
