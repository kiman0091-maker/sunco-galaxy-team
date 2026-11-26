const assert=require('node:assert/strict'),{parseList,parseContent}=require('./notice-reader.cjs');
const fixture='<div><div class="notice_list" value="2716"><div class="bullet_red"></div><span>정산 일정 <span id="nochk_2716">(미열람)</span></span></div><div class="notice_list_01"><button value="2716"></button></div></div><div class="notice_none"></div><div><div class="notice_list" value="2713"><span>교육 안내</span></div><div class="notice_list_01"></div></div><a href="notice.jsp?id=gongi1&amp;page=2">2</a><a href="https://evil.example/notice.jsp?id=gongi1&page=99">99</a>';
const list=parseList(fixture,1);assert.deepEqual(list.items,[{id:'2716',title:'정산 일정',unread:true},{id:'2713',title:'교육 안내',unread:false}]);assert.deepEqual(list.pages,[1,2]);
assert.throws(()=>parseList('<form><input name="pass"></form>',1));
const content=parseContent({content:'<p>내용 &amp; 안내</p><script>alert("secret")</script>',imgValue:'<img src="../uploads/a.jpg"><img src="https://evil.example/a.jpg"><img src="javascript:alert(1)"><img src="/uploads/b.svg">'});
assert.equal(content.text,'내용 & 안내');assert.deepEqual(content.images,['https://www.tbtinting.com/uploads/a.jpg']);assert.throws(()=>parseContent({}));assert.throws(()=>parseContent({content:'',imgValue:''}));
console.log('Actual notice layout, unread markers, pagination, text-only rendering and image destination checks passed');
