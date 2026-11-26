const sharp=require('sharp'),crypto=require('node:crypto');
async function preparePhoto(bytes){
 const start=Date.now();let metadata;
 try{metadata=await sharp(bytes,{limitInputPixels:40000000}).metadata()}catch{throw Error('사진 형식을 읽지 못했습니다. JPG 또는 PNG로 다시 촬영해주세요.')}
 if(!['jpeg','png','webp'].includes(metadata.format))throw Error('지원하지 않는 사진 형식입니다. JPG 또는 PNG로 저장해주세요.');
 // Apply EXIF exactly once; preserve all pixels up to a 4000-pixel long edge.
 const requiresTransform=(metadata.orientation||1)!==1||Math.max(metadata.width,metadata.height)>4000;
 const normalized=requiresTransform?await sharp(bytes,{limitInputPixels:40000000}).rotate().resize({width:4000,height:4000,fit:'inside',withoutEnlargement:true}).png({compressionLevel:6}).toBuffer({resolveWithObject:true}):{data:bytes,info:{width:metadata.width,height:metadata.height}};
 if(normalized.data.length>22000000)throw Error('방향 보정 후 사진 용량이 너무 큽니다. 카메라 해상도를 낮춰 다시 촬영해주세요.');
 return {bytes:normalized.data,info:{originalBytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),originalWidth:metadata.width,originalHeight:metadata.height,exifOrientation:metadata.orientation||1,width:normalized.info.width,height:normalized.info.height,orientationApplied:true,originalPreserved:!requiresTransform,losslessEncoding:true,resized:Math.max(metadata.width,metadata.height)>4000,prepareMs:Date.now()-start}};
}
module.exports={preparePhoto};
