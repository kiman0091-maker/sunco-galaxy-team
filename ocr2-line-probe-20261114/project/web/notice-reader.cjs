const BASE='https://www.tbtinting.com';
function attrs(tag){const out={};for(const m of tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))out[m[1].toLowerCase()]=m[2]??m[3]??m[4];return out}
function plain(html){return String(html).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<!--[\s\S]*?-->/g,'').replace(/<br\s*\/?>|<\/(?:p|div|tr|li)>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;|&#160;/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&amp;/g,'&').replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n').trim()}
function parseList(html,page){
 const items=[];
 const re=/<div\b([^>]*\bclass\s*=\s*["']notice_list["'][^>]*)>([\s\S]*?)(?=<div\b[^>]*\bclass\s*=\s*["']notice_list_01["'])/gi;
 for(const m of html.matchAll(re)){const id=attrs(m[1]).value;if(!/^\d{1,10}$/.test(id||''))continue;const label=plain(m[2]);items.push({id,title:label.replace(/[（(]\s*미열람\s*[）)]/g,'').trim(),unread:/[（(]\s*미열람\s*[）)]/.test(label)})}
 if(!items.length&&!/(?:공지|검색|등록)[^<]{0,30}(?:없습니다|없음)/.test(html))throw Error('공지 목록을 확인하지 못했습니다.');
 const pages=new Set([page]);for(const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi)){try{const u=new URL(m[1].replace(/&amp;/g,'&'),BASE+'/new_user/');const n=Number(u.searchParams.get('page'));if(u.origin===BASE&&u.pathname==='/new_user/notice.jsp'&&u.searchParams.get('id')==='gongi1'&&Number.isInteger(n)&&n>=1&&n<=100)pages.add(n)}catch{}}
 return {items,page,pages:[...pages].sort((a,b)=>a-b)};
}
function parseContent(data){
 if(!data||typeof data!=='object'||(!('content'in data)&&!('imgValue'in data)))throw Error('공지 내용을 확인하지 못했습니다.');
 const markup=String(data.content||'')+'\n'+String(data.imgValue||'');const images=[];
 const safeMarkup=markup.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
 for(const m of safeMarkup.matchAll(/<img\b[^>]*>/gi)){const a=attrs(m[0]);try{const u=new URL((a.src||'').replace(/&amp;/g,'&'),BASE+'/new_user/');if(u.hostname===new URL(BASE).hostname&&u.protocol==='http:')u.protocol='https:';if(u.origin===BASE&&!u.username&&!u.password&&/\.(?:png|jpe?g|gif|webp)$/i.test(u.pathname))images.push(u.href)}catch{}}
 const text=plain(markup);if(!text&&!images.length)throw Error('표시할 공지 내용이 없습니다.');return {text,images:[...new Set(images)].slice(0,20)};
}
module.exports={parseList,parseContent,plain};
