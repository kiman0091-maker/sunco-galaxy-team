const strip=s=>s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/\s+/g,' ').trim();
function completedRecord(html,contract,vin){
 const stack=[],blocks=[];const re=/<\/?(div|tr|li)\b[^>]*>/gi;let m;
 while((m=re.exec(html))){if(m[0][1]!=='/')stack.push({tag:m[1].toLowerCase(),at:m.index});else {let i=stack.length-1;while(i>=0&&stack[i].tag!==m[1].toLowerCase())i--;if(i<0)continue;const open=stack[i];stack.length=i;const part=html.slice(open.at,re.lastIndex);const text=strip(part);if(text.includes(contract)&&text.includes(vin)&&text.includes('시공완료'))blocks.push(text);}}
 for(const text of blocks.sort((a,b)=>a.length-b.length)){
 const vins=new Set(text.match(/\b[A-HJ-NPR-Z0-9]{17}\b/g)||[]);
 if(vins.size===1&&vins.has(vin)&&!text.includes('시공중'))return {state:'already_completed',contract,vin};
 }return {state:'not_verified',contract,vin};
}
module.exports={completedRecord};
