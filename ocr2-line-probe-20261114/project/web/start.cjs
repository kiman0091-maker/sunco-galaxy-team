const path=require('node:path');
const fs=require('node:fs');
const bundled=path.join(process.env.USERPROFILE||'', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
if(fs.existsSync(bundled)){
 process.env.NODE_PATH=[process.env.NODE_PATH,bundled].filter(Boolean).join(path.delimiter);
 require('node:module').Module._initPaths();
}
require('./server.cjs');
