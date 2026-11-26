const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {consumption,resultState,encodeForm,pendingPage,createCompletionTest}=require('./completion-test.cjs');
assert.deepEqual(consumption('<script>parent.insert_val("car|name|phone", "44000", "캐스퍼EV", "1.5");</script>'),{meters:1.5,amount:44000,car:'캐스퍼EV'});
assert.throws(()=>consumption('<script>alert("기간 경과");parent.insert_val("a","44000","차량","1.5")</script>'));
assert.throws(()=>consumption('<script>parent.insert_val("a","44000","차량","0")</script>'));
assert.equal(resultState('<script>alert("시공완료가 정상처리되었습니다.       ");</script>').state,'succeeded');
assert.equal(resultState('<script>alert("시공완료가 정상 처리되지 않았습니다.");</script>').state,'uncertain');
assert.equal(resultState('<script>alert("시공완료가 정상처리되었습니다.");alert("추가 오류");</script>').state,'uncertain');
assert.equal(resultState('정상처리되었습니다').state,'uncertain');
assert.equal(encodeForm({film:'루마 15%',empty:''}),'film=%B7%E7%B8%B6+15%25&empty=');
const period={start:'2026-08-01',end:'2026-10-31'};
const html=`<input name="ord_stat_cd" value="1"><input name="start_dt" value="${period.start}"><input name="end_dt" value="${period.end}"><script>var currentPage="1";</script><a href="build_sign.jsp?vinno=KMHB3511FTW096612&amp;termsno=A5326AX042297&amp;mode=link">시공중</a>`;
assert.equal(pendingPage(html,period,1).jobs[0].contract,'A5326AX042297');
assert.throws(()=>pendingPage(html,{...period,end:'2026-11-30'},1));
assert.throws(()=>pendingPage(html,period,2));
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'coupon-test-'));let calls=0;
 const adapter=createCompletionTest({directory:dir,request:async()=>{calls++;throw Error('외부 요청 금지')},isAuthenticated:()=>true,rotation:{}});
 await assert.rejects(adapter.execute({id:'test'},'no-job',false),/승인/);assert.equal(calls,0);
 await assert.rejects(adapter.execute({id:'test'},'no-job',true),/찾지/);assert.equal(calls,0);
 assert.equal(adapter.status({id:'test'}),null);
 console.log('PASS: exact success alerts, failure/ambiguity rejection, real consumption required, Korean encoding, scoped pending rows, explicit approval and missing-job submission prevention');
})().catch(e=>{console.error(e);process.exitCode=1});
assert.equal(consumption("parent.insert_val('차량|이름', 44000, '캐스퍼EV', 1.5);").meters,1.5);
assert.equal(consumption("top.window.insert_val (\"차량|이름\", '44,000.00', \"캐스퍼EV\", '1.500');").amount,44000);
assert.equal(consumption("parent.insert_val('손님\\'이름', '44000', '캐스퍼EV', 1.5);").meters,1.5);
assert.throws(()=>consumption("parent.insert_val('a',44000,'차량',someVariable);"));
assert.throws(()=>consumption("parent.insert_val('a',44000,'차량',1.5+2);"));
assert.throws(()=>consumption("parent.insert_val('a',44000,'차량',1.5);parent.insert_val('a',44000,'차량',2);"));
console.log('PASS: numeric/quoted meter formats, price decimals, escaped strings; computed/ambiguous values rejected');

assert.equal(resultState('<script>alert("시공완료가 정상처리 되었습니다.");</script>').state,"succeeded");
assert.equal(resultState('<script>confirm("시공완료처리 하시겠습니까?");</script>').state,"uncertain");

assert.throws(()=>consumption('<script>alert("조회 기간을 확인해주세요.");</script>'),/사이트 안내: 조회 기간을 확인해주세요/);
