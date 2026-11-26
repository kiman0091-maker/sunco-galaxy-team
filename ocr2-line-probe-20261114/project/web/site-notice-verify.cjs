const assert=require('node:assert/strict'),{noticeState}=require('./site-notice.cjs');
assert.equal(noticeState('<a href="notice.jsp?num=1">11월 정산 일정 (미열람)</a>').unread,true);
const warning=encodeURIComponent(encodeURIComponent('미열람 공지가 있습니다.'));
assert.equal(noticeState(`<a href="javascript:alert('${warning}');">시공 서비스</a>`).unread,true);
assert.equal(noticeState('<a href="build_sign.jsp">시공 서비스</a><a href="notice.jsp">공지사항</a>').unread,false);
assert.equal(noticeState('<p>미열람 공지가 있는 경우 안내합니다.</p>').unread,false);
assert.equal(noticeState('<a href="https://other.example">공지 (미열람)</a>').url,'https://www.tbtinting.com/new_user/notice.jsp?id=gongi1');
console.log('Unread marker, encoded warning, normal page and fixed destination checks passed');
