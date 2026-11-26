if(process.env.NODE_ENV==='production'&&!process.env.TEST_PASSWORD)throw new Error('테스트 접속 암호 설정이 필요합니다.');
const port=Number(process.env.PORT||4188);
require('./backend.cjs').server.listen(port,'0.0.0.0',()=>console.log(`App listening on port ${port}`));
