function text(html){return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim()}
function parseSettlement(html){
 const titles=[...html.matchAll(/<div\b[^>]*class\s*=\s*['"][^'"]*\bleftMenuTitle\b[^'"]*['"][^>]*>([\s\S]*?)<\/div>/gi)];
 const cards=[];
 for(let i=0;i<titles.length;i++){
  const title=text(titles[i][1]);
  if(!/^시공\s*정산\s*일정$/.test(title)&&!/^\d{1,2}월\s*(?:시공건수|정산\s*예정금액)\s*\d차분$/.test(title))continue;
  const end=i+1<titles.length?titles[i+1].index:html.length;
  const after=html.slice(titles[i].index+titles[i][0].length,end);
  const value=text(after.match(/<div\b[^>]*class\s*=\s*['"][^'"]*\bleftMenuValue\b[^'"]*['"][^>]*>([\s\S]*?)<\/div>/i)?.[1]||'');
  if(value)cards.push({title,value});
 }
 const unique=pattern=>{const matches=cards.filter(c=>pattern.test(c.title));return matches.length===1?matches[0]:null};
 const schedule=unique(/^시공\s*정산\s*일정$/),count=unique(/시공건수/),amount=unique(/정산\s*예정금액/);
 const key=card=>card?.title.match(/^(\d{1,2})월.*?(\d)차분$/)?.slice(1).join('-');
 const countValue=count?.value.match(/^([\d,]+)\s*건$/),amountValue=amount?.value.match(/^([\d,]+)\s*원$/);
 const samePeriod=!!count&&!!amount&&key(count)===key(amount);
 return {schedule:schedule&&/\d+일.*1차.*\d+일.*2차/.test(schedule.value)?schedule:null,
  count:samePeriod&&countValue?{...count,number:Number(countValue[1].replace(/,/g,''))}:null,
  amount:samePeriod&&amountValue?{...amount,number:Number(amountValue[1].replace(/,/g,''))}:null,
  verified:!!schedule&&samePeriod&&!!countValue&&!!amountValue};
}
module.exports={parseSettlement};
