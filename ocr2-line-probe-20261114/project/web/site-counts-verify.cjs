const assert=require('node:assert/strict');const {progressInfo,completedPage,readWorkCounts}=require('./site-counts.cjs');
const period={start:'2026-08-01',end:'2026-10-31'};
const sign=n=>`<h2 id="build_sign">차량 시공 등록 (시공중 : <a href="build_list.jsp?ord_stat_cd=1&amp;start_dt=${period.start}&amp;end_dt=${period.end}&amp;srh_word=">${n}건</a>)</h2>`;
const rows=(page,ids)=>`<h2>시공 내역 조회</h2><script>var currentPage = "${page}";</script><input name="ord_stat_cd" value="2"><input name="start_dt" value="${period.start}"><input name="end_dt" value="${period.end}"><input name="srh_word" value=""><div>기간별 총 시공건수:152건 승인완료:95건</div>${ids.map(id=>`<div><span class="txtR_15_01">시공완료</span><button id="guarantee_output_btn" onclick="print_warranty('${id}')"></button></div>`).join('')}<a href="build_list.jsp?ord_stat_cd=2&start_dt=${period.start}&end_dt=${period.end}&page=1">1</a><a href="build_list.jsp?ord_stat_cd=2&start_dt=${period.start}&end_dt=${period.end}&page=2">2</a>`;
async function main(){
 assert.equal(progressInfo(sign(95)).inProgress,95);assert.deepEqual(progressInfo(sign(95)).period,period);
 assert.throws(()=>progressInfo('<p>시공중:95건</p>'));
 const first=Array.from({length:15},(_,i)=>'KMHB3516BVW'+String(100000+i)),last=['KMHB3516BVW200000','KMHB3516BVW200001'];
 assert.equal(completedPage(rows(1,first),period,1).identities.length,15);
 assert.throws(()=>completedPage(rows(1,first).replace('name="ord_stat_cd" value="2"','name="ord_stat_cd" value="1"'),period,1));
 assert.throws(()=>completedPage(rows(1,first),period,2));
 assert.throws(()=>completedPage(rows(1,first).replace('print_warranty','unknown'),period,1));
 const request=async address=>{const url=new URL(address);return {html:url.pathname.endsWith('build_sign.jsp')?sign(95):rows(Number(url.searchParams.get('page')),url.searchParams.get('page')==='1'?first:last)}};
 const result=await readWorkCounts(request);assert.equal(result.inProgress,95);assert.equal(result.completed,17);assert.equal(result.pagesChecked,2);assert.equal(result.verified,true);
 await assert.rejects(readWorkCounts(async address=>{const result=await request(address);return {html:result.html.replace('KMHB3516BVW200000',first[0])}}),/중복/);
 let signReads=0;await assert.rejects(readWorkCounts(async address=>new URL(address).pathname.endsWith('build_sign.jsp')?{html:sign(++signReads===1?95:96)}:request(address)),/바뀌었습니다/);
 console.log('PASS: real page structure, date scope, all-page sum, header total ignored, mismatched filter/page, duplicate and changing snapshot rejection.');
}
main().catch(e=>{console.error(e);process.exitCode=1});
