// Diagnostics deliberately accept only fixed categories, never error text or photos.
(()=>{
 const originalFetch=window.fetch.bind(window);
 const stages={'/api/login':'login','/api/logout':'logout','/api/recognize':'recognize','/api/site-overview':'site-overview','/api/completion-plan':'completion-plan'};
 let sent=0;const seen=new Map();
 window.couponRecordError=(stage,code='UNEXPECTED',status=null)=>{
  const key=[stage,code,status].join(':');const now=Date.now();
  if(sent>=20||now-(seen.get(key)||0)<60000)return;
  seen.set(key,now);sent++;
  originalFetch('/api/error-record',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({stage,code,status}),keepalive:true}).catch(()=>{});
 };
 window.fetch=async(input,options)=>{
  const stage=typeof input==='string'?stages[input]:null;
  try{const response=await originalFetch(input,options);if(stage&&!response.ok)window.couponRecordError(stage,'REQUEST_FAILED',response.status);return response}
  catch(error){if(stage)window.couponRecordError(stage,'NETWORK_FAILED');throw error}
 };
 window.addEventListener('error',()=>window.couponRecordError('browser'));
 window.addEventListener('unhandledrejection',()=>window.couponRecordError('browser'));
})();
