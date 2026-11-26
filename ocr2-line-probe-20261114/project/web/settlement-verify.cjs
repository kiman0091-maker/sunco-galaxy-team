const assert=require('node:assert/strict'),{parseSettlement}=require('./settlement.cjs');
const card=(title,value)=>`<div><div class="leftMenuTitle"><span>${title}</span></div><div class="leftMenuValue"><span>${value}</span></div></div>`;
const html=card('시공 정산 일정','15일 1차 | 27일 2차')+card('지급 계좌번호','9999999999 은행')+card('10월 시공건수 2차분','3건')+card('10월 정산 예정금액 2차분','165,300원');
let result=parseSettlement(html);assert.equal(result.verified,true);assert.equal(result.count.number,3);assert.equal(result.amount.number,165300);assert.ok(!JSON.stringify(result).includes('9999999999'));
assert.equal(parseSettlement(html.replace('10월 정산 예정금액','11월 정산 예정금액')).verified,false);
assert.equal(parseSettlement(html.replace('165,300원','알 수 없음')).amount,null);
assert.equal(parseSettlement('로그인이 필요합니다.').verified,false);
assert.equal(parseSettlement(html.replace('3건','0건').replace('165,300원','0원')).count.number,0);
console.log('PASS: actual card structure, bank exclusion, dynamic labels, same settlement phase, zero and missing/invalid data.');
