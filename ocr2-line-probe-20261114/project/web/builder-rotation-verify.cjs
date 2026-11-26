const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');const {chooseBuilder,createRotationStore}=require('./builder-rotation.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'coupon-builder-rotation-'));const store=createRotationStore(dir),builders=Array.from({length:10},(_,i)=>({id:'b'+i,name:'틴팅프로'+(i+1)}));
function job(i,builderId,last){return {contract:'A5326AX'+String(100000+i),vin:'KMHB3516BVW'+String(100000+i),builderId,expectedLastBuilderId:last}}
function proof(j){return {recordStatus:'completed',contract:j.contract,vin:j.vin,inProgressDelta:-1,completedDelta:1}}
for(let i=0;i<10;i++){const state=store.get('store-a'),builder=chooseBuilder(builders,state);assert.equal(builder.id,'b'+i);assert.equal(builder.column,1);assert.equal(chooseBuilder(builders,state).id,builder.id);const j=job(i,builder.id,state.lastBuilderId);assert.throws(()=>store.commitVerifiedCompletion('store-a',j,{recordStatus:'completed'}));assert.equal(store.get('store-a').completedCount,i);store.commitVerifiedCompletion('store-a',j,proof(j));assert.equal(store.commitVerifiedCompletion('store-a',j,proof(j)).advanced,false)}
assert.equal(chooseBuilder(builders,store.get('store-a')).id,'b0');assert.equal(chooseBuilder(builders,store.get('store-b')).id,'b0');assert.equal(store.get('store-b').completedCount,0);
assert.equal(createRotationStore(dir).get('store-a').completedCount,10);
assert.equal(chooseBuilder(builders.slice(0,2),{lastBuilderId:'removed'}).id,'b0');assert.equal(chooseBuilder([],{}),null);
assert.throws(()=>chooseBuilder([builders[0],builders[0]],{}));
const stale=job(20,'b1',null);assert.throws(()=>store.commitVerifiedCompletion('store-a',stale,proof(stale)),/먼저 완료/);
console.log('PASS: 10 builders/10 jobs, 11th wraps, column 1 only, preview/failure do not advance, verified commit, duplicate idempotency, store isolation, persistence, roster change and stale-plan rejection.');
