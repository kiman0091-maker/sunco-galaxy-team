const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createErrorStore}=require('./error-records.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'coupon-errors-'));
const log=console.info;console.info=()=>{};
try{
 const store=createErrorStore(dir);
 const row=store.record({stage:'recognize',code:'REQUEST_FAILED',status:503,password:'SECRET',message:'PRIVATE',contract:'PRIVATE'});
 assert.equal(row.stage,'recognize');assert.equal(row.status,503);
 assert.equal(Object.keys(row).sort().join(','),'at,code,id,stage,status,version');
 let content=fs.readFileSync(path.join(dir,'errors.json'),'utf8');assert(!/SECRET|PRIVATE/.test(content));
 const sanitized=store.record({stage:'PRIVATE',code:'PRIVATE',status:200});
 assert.equal(sanitized.stage,'browser');assert.equal(sanitized.code,'UNEXPECTED');assert.equal(sanitized.status,null);
 fs.writeFileSync(path.join(dir,'errors.json'),JSON.stringify([{at:'2000-01-01'},...Array.from({length:505},()=>row)]));
 store.record({stage:'login'});const entries=JSON.parse(fs.readFileSync(path.join(dir,'errors.json')));
 assert.equal(entries.length,500);assert(!entries.some(e=>e.at==='2000-01-01'));
 const blocked=path.join(dir,'not-directory');fs.writeFileSync(blocked,'x');assert.equal(createErrorStore(blocked).record({}),null);
}finally{console.info=log;fs.rmSync(dir,{recursive:true,force:true})}
console.log('Error privacy, retention, bounds, and storage-failure checks passed');
