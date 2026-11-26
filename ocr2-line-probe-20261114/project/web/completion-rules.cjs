const MIN_STOCK_METERS=2.5;
const RULES={version:1,minStockMeters:MIN_STOCK_METERS,select:'smallest-eligible-stock',requireGreaterThanConsumption:true,dustProvided:true,singleBuilderColumn:1,multipleBuilders:'round-robin',advanceRotation:'verified-completion-only',unknownConsumption:'ask-user',noStock:'keep-in-progress',retryUncertainSubmission:false};
function selectFilm(films,requiredMeters){
 if(typeof requiredMeters!=='number'||!Number.isFinite(requiredMeters)||requiredMeters<=0)return {state:'needs_vehicle_length',message:'차종별 필요 길이를 확인해주세요. 임의로 2m를 적용하지 않습니다.'};
 const valid=films.filter(f=>typeof f.remainingMeters==='number'&&Number.isFinite(f.remainingMeters)&&f.name?.startsWith('롤필름 ')&&f.remainingMeters>=MIN_STOCK_METERS&&f.remainingMeters>requiredMeters);
 valid.sort((a,b)=>a.remainingMeters-b.remainingMeters);
 if(!valid.length)return {state:'awaiting_stock',message:'조건에 맞는 필름 재고 없음 · 인증된 건은 시공중으로 유지'};
 return {state:'selected',film:valid[0]};
}
// Existing in-progress vehicles: use the user's confirmed stock rule, without
// treating the 2.3m capacity estimate as the site's actual consumption.
const COUNT_COMPLETION_RULES=Object.freeze({version:1,periodMonths:3,order:'oldest-first',existingInProgressOnly:true,reauthenticate:false,minStockMetersExclusive:2.5,filmOrder:'remaining-meters-ascending',builderColumn:1,builderOrder:'round-robin',dustProvided:true,confirmCompletion:true,acknowledgeResultAlert:true,successSource:'site-success-response',verifyVehicleCompleted:'on-uncertain-response',verifyCounts:'batch-end',verifyProgressDelta:-1,verifyCompletedDelta:1,retryUncertainSubmission:false,refreshStockAfterEach:false,refreshStockAt:['start','roll-change','reserve-boundary','error','batch-end'],unknownConsumption:'refresh-stock'});
function selectCountFilm(films){
 const valid=films.filter(f=>typeof f.remainingMeters==='number'&&Number.isFinite(f.remainingMeters)&&f.name?.startsWith('롤필름 ')&&f.remainingMeters>COUNT_COMPLETION_RULES.minStockMetersExclusive).sort((a,b)=>a.remainingMeters-b.remainingMeters);
 return valid.length?{state:'selected',film:valid[0]}:{state:'awaiting_stock',message:'잔여량 2.5m를 초과하는 필름이 없습니다. 완료를 진행하지 않습니다.'};
}
function planCompletion({films,builders,requiredMeters,rotationState={},selectionMode}){
 const stock=selectionMode==='count'?selectCountFilm(films):selectFilm(films,requiredMeters);
 if(stock.state!=='selected')return {...stock,dustProvided:true};
 if(!builders.length)return {state:'needs_builder_confirmation',message:'사이트의 틴팅프로 명단을 확인하지 못했습니다.',film:stock.film,dustProvided:true};
 const builder=require('./builder-rotation.cjs').chooseBuilder(builders,rotationState);
 return {state:'ready_to_review',film:stock.film,builder,requiredMeters,dustProvided:true,message:'완료 준비 선택안 · 실제 등록 전 재고와 기존 건 상태를 다시 확인해야 합니다.'};
}
function attrs(tag){const result={};for(const m of tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))result[m[1].toLowerCase()]=m[2]??m[3]??m[4];return result}
const unescape=s=>s.replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&amp;/g,'&');
function parseInventory(html){
 const films=[];
 for(const m of html.matchAll(/<span\b[^>]*>([^]*?)<\/span>/gi)){
  if(!/name\s*=\s*['"]building_value['"]/.test(m[1]))continue;
  const radio=[...m[1].matchAll(/<input\b[^>]*>/gi)].map(x=>attrs(x[0])).find(a=>a.name==='building_value');
  const stock=m[1].match(/잔여량\s*(?:&nbsp;|\s)*<font\b[^>]*>\s*(-?\d+(?:\.\d+)?)\s*<\/font>\s*m/i);
  if(radio?.value&&stock)films.push({name:unescape(radio.value),remainingMeters:Number(stock[1])});
 }
 const builders=[];
 for(const m of html.matchAll(/<tr\b([^>]*)>([^]*?)<\/tr>/gi)){
  if(!/name\s*=\s*['"]builder1_check['"]/.test(m[2]))continue;
  const a=attrs(m[1]);let item;try{item=JSON.parse(unescape(a['data-item']||''))}catch{}
  if(item?.builder_name&&item?.builder_id)builders.push({name:item.builder_name,id:item.builder_id});
 }
 return {films,builders};
}
module.exports={RULES,COUNT_COMPLETION_RULES,selectCountFilm,selectFilm,planCompletion,parseInventory};
