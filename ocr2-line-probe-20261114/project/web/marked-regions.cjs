const sharp=require('sharp');
const {createWorker}=require('tesseract.js');
// Regions inside the user's marked table cells on the delivery-envelope layout.
const REGIONS={contract:[.132,.171,.146,.105],customerName:[.282,.171,.093,.105],vin:[.556,.266,.166,.095],deliveryDate:[.691,.172,.139,.094],vehicle:[.145,.362,.414,.096],deliveryInfo:[.589,.476,.378,.249]};
function rectangle(m,b){const left=Math.round(m.width*b[0]),top=Math.round(m.height*b[1]);return {left,top,width:Math.min(Math.round(m.width*b[2]),m.width-left),height:Math.min(Math.round(m.height*b[3]),m.height-top)}}
async function recognizeMarked(buffer,{modelPath,parseText}){
 const source=await sharp(buffer,{limitInputPixels:40e6}).rotate().png().toBuffer(),meta=await sharp(source).metadata();
 const worker=await createWorker(['kor','eng'],1,{langPath:modelPath,cachePath:modelPath,gzip:false});let attempts=0;
 try{for(const angle of (meta.height>meta.width?[270,0,90,180]:[0,270,90,180])){
 const upright=await sharp(source).rotate(angle).png().toBuffer(),m=await sharp(upright).metadata();
 const read=async(key,numeric=false)=>{const image=await sharp(upright).extract(rectangle(m,key==='customerName'?[.290,.230,.080,.032]:REGIONS[key])).resize({width:key==='customerName'?700:1400}).grayscale().normalize().sharpen().png().toBuffer();await worker.setParameters({tessedit_pageseg_mode:'6',tessedit_char_whitelist:numeric?'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .\t':''});attempts++;const r=await worker.recognize(image);return r.data};
 const c=await read('contract',true),v=await read('vin',true),numbers=parseText(c.text+'\n'+v.text,Math.min(c.confidence,v.confidence));
 if(!numbers.contract||!numbers.vin)continue;
 const nameWorker=await createWorker('kor',1,{langPath:modelPath,cachePath:modelPath,gzip:false});let name='',nameText='';
 try{await nameWorker.setParameters({tessedit_pageseg_mode:'7'});const values=[];
 for(const width of [600,900]){const crop=await sharp(upright).extract(rectangle(m,[.290,.230,.080,.032])).resize({width}).png().toBuffer();const result=await nameWorker.recognize(crop);attempts++;const value=result.data.text.trim().replace(/\s+/g,'');values.push({value,confidence:result.data.confidence});}
 if(values[0].value===values[1].value&&values.every(v=>v.confidence>=70)&&/^[가-힣A-Za-z0-9·&().-]{2,30}$/.test(values[0].value))name=values[0].value;
 nameText=name;
 }finally{await nameWorker.terminate()}
 return {...numbers,customerName:name,text:[c.text,nameText,v.text].join('\n'),rotation:angle,attemptCount:attempts,strategy:'user-marked-regions',requiresReview:true};
 }
 return {...parseText('',0),customerName:'',strategy:'user-marked-regions',attemptCount:attempts,retakeRequired:true,requiresReview:true};
 }finally{await worker.terminate()}
}
module.exports={REGIONS,rectangle,recognizeMarked};
