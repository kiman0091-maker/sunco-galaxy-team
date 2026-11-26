const sharp=require('sharp');const {createWorker}=require('tesseract.js');
function labelBoxes(tsv){
 const rows=tsv.trim().split('\n').slice(1).map(l=>l.split('\t')).filter(r=>r[0]==='5'&&r[11]?.trim());const out={};
 for(let i=0;i<rows.length;i++)for(let n=1;n<=4&&i+n<=rows.length;n++){
 const group=rows.slice(i,i+n);if(group.some(r=>r.slice(1,5).join(':')!==group[0].slice(1,5).join(':')))continue;
 const text=group.map(r=>r[11]).join('').replace(/\s/g,'');const key=text==='계약번호'?'contract':text==='차대번호'?'vin':text==='계약자명'?'customerName':null;if(!key)continue;
 const x=Math.min(...group.map(r=>+r[6])),y=Math.min(...group.map(r=>+r[7]));const right=Math.max(...group.map(r=>+r[6]+ +r[8])),bottom=Math.max(...group.map(r=>+r[7]+ +r[9]));
 out[key]={x,y,width:right-x,height:bottom-y};
 }return out;
}
async function recognizeLabels(buffer,{modelPath,parseText}){
 const source=await sharp(buffer).rotate().png().toBuffer(),meta=await sharp(source).metadata();
 const worker=await createWorker(['kor','eng'],1,{langPath:modelPath,cachePath:modelPath,gzip:false});let attempts=0;
 try{for(const angle of (meta.height>meta.width?[270,0,90,180]:[0,270,90,180])){
 const image=await sharp(source).rotate(angle).resize({width:2400}).grayscale().normalize().png().toBuffer();const m=await sharp(image).metadata();
 await worker.setParameters({tessedit_pageseg_mode:'11',tessedit_char_whitelist:''});const page=await worker.recognize(image,{}, {text:true,tsv:true});attempts++;
 const boxes=labelBoxes(page.data.tsv||'');if(!boxes.contract&&!boxes.vin)continue;
 let texts=[];const fields={};
 for(const [key,b] of Object.entries(boxes)){
 // Find the value directly below its Korean heading, in the same table column.
 const width=m.width*(key==='vin'?.26:key==='customerName'?.14:.23);const left=Math.max(0,Math.round(b.x+b.width/2-width/2));const top=Math.round(b.y+b.height*1.25);
 const crop=await sharp(image).extract({left,top,width:Math.min(Math.round(width),m.width-left),height:Math.min(Math.round(b.height*4.8),m.height-top)}).resize({width:1600}).sharpen().png().toBuffer();
 await worker.setParameters({tessedit_pageseg_mode:'6',tessedit_char_whitelist:key==='customerName'?'':'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .\t'});
 const value=await worker.recognize(crop);attempts++;texts.push(value.data.text);const parsed=parseText(value.data.text,value.data.confidence);fields[key]=key==='customerName'?value.data.text.trim().replace(/\s+/g,' '):parsed[key];
 }
 const merged=parseText(texts.join('\n'),page.data.confidence);
 if(fields.contract&&fields.vin)return {...merged,contract:fields.contract,vin:fields.vin,customerName:fields.customerName||'',rotation:angle,attemptCount:attempts,strategy:'korean-labels'};
 }return null;}finally{await worker.terminate()}
}
module.exports={labelBoxes,recognizeLabels};
