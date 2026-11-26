const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
class Node{constructor(){this.textContent='';this.children=[];this.nodes=new Map()}querySelector(s){if(!this.nodes.has(s))this.nodes.set(s,new Node());return this.nodes.get(s)}after(){}append(...nodes){this.children.push(...nodes)}replaceChildren(){this.children=[];this.textContent=''}showModal(){}close(){}click(){}scrollIntoView(){}}
(async()=>{const root=new Node(),events={},requests=[];const context={document:{createElement:()=>new Node(),querySelector:s=>root.querySelector(s),body:new Node()},window:{addEventListener:(name,fn)=>events[name]=fn},authenticated:true,toast(){},userErrorMessage:e=>e.message,fetch:(url,options)=>new Promise(resolve=>requests.push({url,options,resolve})),Date,Error};vm.runInNewContext(fs.readFileSync(__dirname+'/shortcuts.js','utf8'),context);
 const summary=root.querySelector('#open-stock small');const flush=()=>new Promise(resolve=>setImmediate(resolve));
 events['coupon:stock-login']();assert.equal(requests.length,1);assert.equal(requests[0].options.cache,'no-store');events['coupon:site-refresh']({detail:{state:'unavailable'}});
 requests[0].resolve({ok:true,json:async()=>({films:[{name:'롤필름 테스트',remainingMeters:7.25}],checkedAt:new Date().toISOString()})});await flush();assert.equal(summary.textContent,'1롤 보유 · 7.25m');
 events['coupon:stock-login']();events['coupon:stock-login']();assert.equal(requests.length,3);
 requests[2].resolve({ok:true,json:async()=>({films:[{name:'롤필름 새 계정',remainingMeters:4.125}],checkedAt:new Date().toISOString()})});await flush();
 requests[1].resolve({ok:true,json:async()=>({films:[{name:'롤필름 이전 계정',remainingMeters:99}],checkedAt:new Date().toISOString()})});await flush();assert.equal(summary.textContent,'1롤 보유 · 4.125m');
 context.authenticated=false;events['coupon:site-refresh']({detail:{state:'unavailable'}});assert(!summary.textContent.includes('4.125'));
 console.log('Fresh login request, overview failure independence, stale-account response rejection and logout clearing passed');
})().catch(error=>{console.error(error);process.exitCode=1});
