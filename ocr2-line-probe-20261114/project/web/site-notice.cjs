function decode(text){let value=text.replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"');for(let i=0;i<3;i++){try{const next=decodeURIComponent(value);if(next===value)break;value=next}catch{break}}return value}
function noticeState(html){
 const anchors=[...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
 const unread=anchors.some(m=>{const label=m[2].replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');return /[（(]\s*미열람\s*[）)]/.test(label)||/미열람\s*공지/.test(decode(m[1]))});
 return {unread,url:'https://www.tbtinting.com/new_user/notice.jsp?id=gongi1'};
}
module.exports={noticeState};
