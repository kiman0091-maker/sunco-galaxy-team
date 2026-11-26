const ROOT='https://www.tbtinting.com';
function plain(html){return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<!--[\s\S]*?-->/g,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/\s+/g,' ').trim()}
function attrs(tag){const result={};for(const m of tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))result[m[1].toLowerCase()]=m[2]??m[3]??m[4];return result}
function links(html){return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].flatMap(m=>{const a=attrs(m[1]);if(!a.href)return [];try{const url=new URL(a.href.replace(/&amp;/gi,'&'),ROOT+'/new_user/');return url.origin===ROOT?[{url,label:plain(m[2])}]:[]}catch{return []}})}
function progressInfo(html){
 const headings=[...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map(m=>plain(m[1])).filter(s=>/차량\s*시공\s*등록/.test(s));
 const values=[...new Set(headings.flatMap(s=>[...s.matchAll(/시공\s*중\s*[:：]\s*([\d,]+)\s*건/g)].map(m=>Number(m[1].replace(/,/g,'')))))];
 if(values.length!==1||!Number.isSafeInteger(values[0]))throw Error('시공 등록 화면에서 시공중 건수를 확인하지 못했습니다.');
 const targets=links(html).filter(({url,label})=>url.pathname==='/new_user/build_list.jsp'&&url.searchParams.get('ord_stat_cd')==='1'&&Number(label.replace(/[^\d]/g,''))===values[0]&&!(url.searchParams.get('srh_word')||''));
 const periods=[...new Map(targets.map(({url})=>{const start=url.searchParams.get('start_dt'),end=url.searchParams.get('end_dt');return [start+'/'+end,{start,end}]})).values()];
 if(periods.length!==1||!/^\d{4}-\d{2}-\d{2}$/.test(periods[0].start)||!/^\d{4}-\d{2}-\d{2}$/.test(periods[0].end)||periods[0].start>periods[0].end)throw Error('시공중 건수의 조회 기간을 확인하지 못했습니다.');
 return {inProgress:values[0],period:periods[0]};
}
function completedPage(html,period,expectedPage){
 if(!/시공\s*내역\s*조회/.test(plain(html)))throw Error('시공 내역 화면을 확인하지 못했습니다.');
 const inputs={};for(const m of html.matchAll(/<input\b[^>]*>/gi)){const a=attrs(m[0]);if(a.name)inputs[a.name]=a.value||''}
 if(inputs.ord_stat_cd!=='2'||inputs.start_dt!==period.start||inputs.end_dt!==period.end||(inputs.srh_word||''))throw Error('시공완료 목록의 조회 조건이 일치하지 않습니다.');
 const current=html.match(/\bvar\s+currentPage\s*=\s*['"](\d+)['"]/i)?.[1];
 if(Number(current)!==expectedPage)throw Error('시공완료 목록의 페이지를 확인하지 못했습니다.');
 const statuses=[...html.matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span>/gi)].filter(m=>(attrs(m[1]).class||'').split(/\s+/).includes('txtR_15_01')&&plain(m[2])==='시공완료');
 const identities=[...html.matchAll(/<button\b[^>]*>/gi)].flatMap(m=>{const a=attrs(m[0]);if(a.id!=='guarantee_output_btn')return [];const vin=(a.onclick||'').match(/^\s*print_warranty\(\s*['"]([A-HJ-NPR-Z0-9]{17})['"]\s*\)\s*;?\s*$/)?.[1];return vin?[vin]:[]});
 if(statuses.length!==identities.length||new Set(identities).size!==identities.length)throw Error('시공완료 목록 행을 중복 없이 확인하지 못했습니다.');
 if(!identities.length&&!/(?:조회|검색|시공|등록|자료|내역)[^.!?]{0,40}(?:없습니다|없음)/.test(plain(html)))throw Error('빈 시공완료 목록인지 확인하지 못했습니다.');
 const pages=new Set([expectedPage]);
 for(const {url} of links(html)){
  if(url.pathname!=='/new_user/build_list.jsp'||url.searchParams.get('ord_stat_cd')!=='2'||url.searchParams.get('start_dt')!==period.start||url.searchParams.get('end_dt')!==period.end||(url.searchParams.get('srh_word')||''))continue;
  const n=Number(url.searchParams.get('page')||'1');if(Number.isSafeInteger(n)&&n>0)pages.add(n);
 }
 return {identities,pages:[...pages]};
}
async function readWorkCounts(request){
 const initial=await request(ROOT+'/new_user/build_sign.jsp');const info=progressInfo(initial.html);
 const listUrl=page=>{const url=new URL('/new_user/build_list.jsp',ROOT);for(const [key,value]of Object.entries({ord_stat_cd:'2',start_dt:info.period.start,end_dt:info.period.end,srh_word:'',page:String(page)}))url.searchParams.set(key,value);return url.href};
 const pending=[1],seenPages=new Set(),identities=new Set(),pageCounts=[];let first;
 while(pending.length){
  const page=pending.shift();if(seenPages.has(page))continue;if(seenPages.size>=100||page>100)throw Error('시공완료 목록이 많아 전체 확인이 필요합니다.');
  const response=await request(listUrl(page));const parsed=completedPage(response.html,info.period,page);seenPages.add(page);if(page===1)first=parsed;
  for(const id of parsed.identities){if(identities.has(id))throw Error('조회 중 목록이 변경됐거나 중복 행이 있어 다시 확인해야 합니다.');identities.add(id)}
  pageCounts.push({page,count:parsed.identities.length});for(const next of parsed.pages)if(!seenPages.has(next))pending.push(next);
 }
 const max=Math.max(...seenPages);if(seenPages.size!==max)throw Error('시공완료 목록의 일부 페이지를 확인하지 못했습니다.');
 const finalProgress=progressInfo((await request(ROOT+'/new_user/build_sign.jsp')).html);
 const finalFirst=completedPage((await request(listUrl(1))).html,info.period,1);
 if(finalProgress.inProgress!==info.inProgress||JSON.stringify(finalProgress.period)!==JSON.stringify(info.period)||JSON.stringify(finalFirst)!==JSON.stringify(first))throw Error('조회 중 사이트 건수가 바뀌었습니다. 다시 조회해주세요.');
 return {...info,completed:identities.size,verified:true,checkedAt:new Date().toISOString(),pagesChecked:seenPages.size,pageCounts:pageCounts.sort((a,b)=>a.page-b.page),source:'authenticated-service-and-completed-rows'};
}
module.exports={progressInfo,completedPage,readWorkCounts};
