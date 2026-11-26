const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
let child,output='',nextId=0,idle;const pending=new Map();
function stop(message='사진 인식 연결이 종료됐습니다. 다시 시도해주세요.',failureCode='OCR_WORKER_EXIT'){const current=child;child=null;output='';current?.kill();for(const job of pending.values()){clearTimeout(job.timer);job.reject(Object.assign(Error(message),{code:failureCode}));}pending.clear();}
function start(){
 if(child)return child;
 const bundled=path.join(process.env.USERPROFILE||'','.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
 const python=process.env.OCR_PYTHON||(process.platform==='win32'&&fs.existsSync(bundled)?bundled:'python3');
 const processHandle=spawn(python,[path.join(__dirname,'ocr-local-worker.py')],{cwd:__dirname,windowsHide:true,stdio:['pipe','pipe','pipe']});child=processHandle;let completed=0;let failureCode='OCR_WORKER_EXIT';processHandle.stderr.on('data',data=>{const text=data.toString();if(/ModuleNotFoundError|ImportError/.test(text))failureCode='OCR_DEPENDENCY_MISSING';else if(/out of memory|bad_alloc|MemoryError/i.test(text))failureCode='OCR_MEMORY_LIMIT';else if(/Traceback/.test(text))failureCode='OCR_WORKER_EXCEPTION';});
 processHandle.stdin.on('error',()=>{if(child===processHandle){console.warn(JSON.stringify({type:'ocr_worker_error',code:'OCR_INPUT_PIPE_CLOSED'}));stop('서버 인식기에 사진을 전달하지 못했습니다. 인식기 실행 상태를 확인해주세요.','OCR_INPUT_PIPE_CLOSED')}});
 processHandle.on('error',()=>{console.warn(JSON.stringify({type:'ocr_worker_error',code:'OCR_START_FAILED'}));if(child===processHandle)stop(undefined,'OCR_START_FAILED')});
 processHandle.on('close',(code,signal)=>{if(child===processHandle){if(pending.size)console.warn(JSON.stringify({type:'ocr_worker_error',code:failureCode,exitCode:code,signal}));stop(failureCode==='OCR_DEPENDENCY_MISSING'?'서버 사진 인식 프로그램을 불러오지 못했습니다. 관리자에게 문의해주세요.':failureCode==='OCR_MEMORY_LIMIT'?'서버의 사진 처리 메모리가 부족합니다. 더 낮은 해상도로 다시 시도해주세요.':'서버 사진 인식기가 종료됐습니다. 다시 시도해주세요.',failureCode)}});
 processHandle.stdout.setEncoding('utf8');processHandle.stdout.on('data',chunk=>{
  output+=chunk;if(output.length>5e6){stop();return;}
  for(let end;(end=output.indexOf('\n'))>=0;){const line=output.slice(0,end);output=output.slice(end+1);let message;try{message=JSON.parse(line)}catch{continue;}
   const job=pending.get(message.id);if(!job)continue;pending.delete(message.id);clearTimeout(job.timer);
   if(message.error&&['OCR_MEMORY_LIMIT','OCR_FIELD_PROCESSING_FAILED'].includes(message.errorCode))console.warn(JSON.stringify({type:'ocr_worker_error',code:message.errorCode}));
   const settle=()=>{if(message.error)job.reject(Object.assign(Error('서버 사진 인식 처리에 실패했습니다.'),{code:require('./runtime-diagnostics.cjs').codes.has(message.errorCode)?message.errorCode:'OCR_FIELD_PROCESSING_FAILED'}));else job.resolve(message.result);};
   completed++;
   if(process.env.OCR_LOW_MEMORY==='1'&&completed>=4&&pending.size===0){
    // Wait for the old worker to exit before accepting the next photo.
    child=null;output='';processHandle.once('close',settle);processHandle.kill();
   }else settle();
   // Keep the initialized worker for the server lifetime; stop() handles shutdown/errors.
  }
 });return processHandle;
}
async function recognizeLocal(buffer,{parseText}){
 clearTimeout(idle);const id=++nextId;
 const result=await new Promise((resolve,reject)=>{const processHandle=start();const timer=setTimeout(()=>{console.warn(JSON.stringify({type:'ocr_worker_error',code:'OCR_TIMEOUT'}));stop(undefined,'OCR_TIMEOUT')},60000);timer.unref?.();pending.set(id,{resolve,reject,timer});processHandle.stdin.write(JSON.stringify({id,image:buffer.toString('base64')})+'\n');});
 const prior=parseText([result.contract,result.vin].join('\n'),0);
 return {...result,recognitionTiming:result.timing,fieldStatus:Object.fromEntries(Object.entries(result.fields||{}).map(([k,v])=>[k,v.status])),contracts:result.contract?[result.contract]:[],vins:result.vin?[result.vin]:[],previouslyProcessed:prior.previouslyProcessed,text:[['계약번호',result.contract],['차대번호',result.vin],['계약자명',result.customerName]].map(([k,v])=>`${k}: ${v||'확인 필요'}`).join('\n')};
}
module.exports={recognizeLocal,stop};
