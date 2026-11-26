const fs=require('node:fs'),crypto=require('node:crypto');
const VERSION='2026.11.03.1';
const codes=new Set(['OCR_MEMORY_LIMIT','OCR_TIMEOUT','OCR_WORKER_EXIT','OCR_DEPENDENCY_MISSING','OCR_WORKER_EXCEPTION','OCR_START_FAILED','OCR_INPUT_PIPE_CLOSED','OCR_FIELD_PROCESSING_FAILED','OCR_INVALID_RESPONSE','PHOTO_PREPARE_FAILED','OCR_REQUEST_FAILED']);
function memory(){const m=process.memoryUsage(),out={nodeRssMiB:Math.round(m.rss/1048576),nodeHeapMiB:Math.round(m.heapUsed/1048576)};if(process.platform==='linux'){
 for(const [key,file] of [['containerMiB','/sys/fs/cgroup/memory.current'],['limitMiB','/sys/fs/cgroup/memory.max']])try{const n=Number(fs.readFileSync(file,'utf8').trim());if(Number.isFinite(n)&&n>=0)out[key]=Math.round(n/1048576)}catch{}
 try{const s=fs.readFileSync('/sys/fs/cgroup/memory.events','utf8');out.oomKills=Number(s.match(/^oom_kill (\d+)/m)?.[1]||0)}catch{}
}return out;}
function safeContext(data){const out={};for(const k of ['nodeRssMiB','nodeHeapMiB','containerMiB','limitMiB','oomKills','durationMs','imageBytes','width','height','orientation'])if(Number.isFinite(data?.[k])&&data[k]>=0)out[k]=Math.round(data[k]);if(/^[a-f0-9-]{36}$/.test(data?.traceId||''))out.traceId=data.traceId;return out;}
function event(phase,traceId,extra={}){if(!['start','prepared','finished','failed','startup'].includes(phase))throw Error('Unknown diagnostic phase');console.info(JSON.stringify({type:'ocr_diagnostic',version:VERSION,at:new Date().toISOString(),phase,...safeContext({...memory(),...extra,traceId})}));}
function begin(){return {traceId:crypto.randomUUID(),started:Date.now()};}
function code(error){return codes.has(error?.code)?error.code:error?.name==='TimeoutError'?'OCR_TIMEOUT':'OCR_REQUEST_FAILED';}
module.exports={VERSION,codes,memory,safeContext,event,begin,code};
