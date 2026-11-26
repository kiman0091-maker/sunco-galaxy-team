const assert=require('node:assert/strict'),fs=require('node:fs');
const {REGIONS,rectangle}=require('./marked-regions.cjs');
for(const region of Object.values(REGIONS)){assert.equal(region.length,4);assert(region.every(n=>n>0&&n<1));assert(region[0]+region[2]<=1);assert(region[1]+region[3]<=1);const r=rectangle({width:4000,height:3000},region);assert(r.left+r.width<=4000);assert(r.top+r.height<=3000)}
const backend=fs.readFileSync('backend.cjs','utf8');const flow=backend.slice(backend.indexOf('async function recognize(buffer){'),backend.indexOf('const server=http.createServer'));assert(flow.includes('recognizeMarked'));assert(!flow.includes('recognizeFull'));assert(!flow.includes('recognizeLabels'));console.log('Marked region boundaries and no full-page fallback passed');
