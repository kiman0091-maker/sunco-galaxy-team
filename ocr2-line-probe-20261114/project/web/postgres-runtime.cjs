const {createPostgresGuard}=require('./postgres-guard.cjs');
const {createAuthorityClient}=require('./recovery-authority-client.cjs');
// No connection defaults and no automatic schema creation. Missing driver/config fails closed.
function createFromEnv(env){
 try{
  // R8 supplies a LOCAL_MOCK provider only. Operating integration is deliberately disabled.
  if(env.SUNCOO_RECOVERY_LAB!=='1'||!env.SUNCOO_CHECKPOINT_PUBLIC_KEY||!env.SUNCOO_CHECKPOINT_ID)return null;
  if(!env.SUNCOO_POSTGRES_URL||!env.SUNCOO_PG_STORE_ID||!env.SUNCOO_PG_STORE_UUID||!env.SUNCOO_PG_EPOCH||!env.SUNCOO_RECOVERY_URL||!env.SUNCOO_RECOVERY_ID||!env.SUNCOO_RECOVERY_WORKER_SECRET)return null;
  const u=new URL(env.SUNCOO_POSTGRES_URL);if(!['postgres:','postgresql:'].includes(u.protocol))return null;
  const authority=createAuthorityClient({url:env.SUNCOO_RECOVERY_URL,secret:env.SUNCOO_RECOVERY_WORKER_SECRET,identity:{authorityId:env.SUNCOO_RECOVERY_ID,storeId:env.SUNCOO_PG_STORE_ID,storeUuid:env.SUNCOO_PG_STORE_UUID,checkpointId:env.SUNCOO_CHECKPOINT_ID},epoch:env.SUNCOO_PG_EPOCH,checkpointPublicKey:env.SUNCOO_CHECKPOINT_PUBLIC_KEY,allowLocalMock:true});
  const {Pool}=require('pg');
  const pool=new Pool({connectionString:env.SUNCOO_POSTGRES_URL,ssl:{rejectUnauthorized:true},max:5,connectionTimeoutMillis:3000,idleTimeoutMillis:10000});
  pool.on('error',()=>{}); // No credentials, payloads, or connection strings in logs.
  return createPostgresGuard({pool,storageId:env.SUNCOO_PG_STORE_ID,storeUuid:env.SUNCOO_PG_STORE_UUID,epoch:env.SUNCOO_PG_EPOCH,authority});
 }catch{return null;}
}
module.exports={createFromEnv};
