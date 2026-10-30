const test=require('node:test');
const assert=require('node:assert/strict');
const {createHandler}=require('../cloudfunctions/submitFeedback/core');
const client=require('../utils/feedback');
const ctx={APPID:'wx45896fe0717f3c71',OPENID:'server-identity'};
const input={content:'希望增加更多字体',requestId:'request-123',version:'1.1.0'};
function harness(){let saved,gate,checks=0;const handler=createHandler({store:{async reserve(x){if(saved)return {ok:true,duplicate:true};return gate;},async save(x){saved=x;return {ok:true};}},moderate:async()=>{checks++;return {result:{suggest:'pass'}};},now:()=>100000});return {handler,get saved(){return saved;},get checks(){return checks;},gate(x){gate=x;}};}
test('feedback validates identity and input before storage',async()=>{const h=harness();assert.equal((await h.handler(input,{...ctx,APPID:'spoof'})).code,'UNAUTHORIZED');assert.equal((await h.handler({...input,content:'短'},ctx)).code,'INVALID_INPUT');assert.equal(h.saved,undefined);});
test('confirmed feedback saves only intended payload and deduplicates retries',async()=>{const h=harness();assert.equal((await h.handler({...input,openid:'spoof',video:'private'},ctx)).ok,true);assert.equal(h.saved.video,undefined);assert.equal(h.saved.openid,undefined);assert.equal((await h.handler(input,ctx)).duplicate,true);assert.equal(h.checks,1);});
test('rate limit stops moderation and write',async()=>{const h=harness();h.gate({ok:false,code:'RATE_LIMIT'});assert.equal((await h.handler(input,ctx)).code,'RATE_LIMIT');assert.equal(h.checks,0);});
test('unsafe content and unavailable checking fail closed',async()=>{for(const moderate of [async()=>({result:{suggest:'risky'}}),async()=>{throw Error('offline');}]){let writes=0;const handler=createHandler({store:{reserve:async()=>null,save:async()=>writes++},moderate});assert.equal((await handler(input,ctx)).ok,false);assert.equal(writes,0);}});
test('database failure never acknowledges success',async()=>{const handler=createHandler({store:{reserve:async()=>{throw Error('missing collection');}},moderate:async()=>{}});assert.equal((await handler(input,ctx)).code,'SERVICE_UNAVAILABLE');});
test('client sends only feedback and version; disabled service does not call cloud',async()=>{assert.deepEqual(Object.keys(client.payload(' 内容文字足够 ','request-1')).sort(),['content','requestId','version']);await assert.rejects(client.send({}, {enabled:false},input),/准备/);});
test('client only accepts explicit server acknowledgment and times out safely',async()=>{const wx={cloud:{init(){},callFunction(o){o.success({result:{ok:false,code:'CONTENT_REJECTED'}});}}};await assert.rejects(client.send(wx,{enabled:true,envId:'test'},input),/安全/);wx.cloud.callFunction=()=>{};await assert.rejects(client.send(wx,{enabled:true,envId:'test'},input,5),/自动去重/);});
const {createStore}=require('../cloudfunctions/submitFeedback/store');
function database(){const docs=new Map();let queue=Promise.resolve();return {docs,runTransaction(fn){const next=queue.then(()=>fn({collection:name=>({doc:id=>({get:async()=>({data:docs.get(name+id)}),set:async({data})=>{docs.set(name+id,data);}})})}));queue=next.catch(()=>{});return next;}};}
test('database adapter enforces minute and daily limits and resets the day count',async()=>{
 const db=database(),store=createStore(db),base={owner:'owner',id:'id',digest:'digest',day:'2026-10-30'};
 for(let n=0;n<5;n++)assert.equal(await store.reserve({...base,time:100000+n*60000}),null);
 assert.equal((await store.reserve({...base,time:340001})).code,'RATE_LIMIT');
 assert.equal((await store.reserve({...base,time:400000})).code,'DAILY_LIMIT');
 assert.equal(await store.reserve({...base,time:500000,day:'2026-10-31'}),null);
 assert.equal(db.docs.get('feedback_limitsowner').count,1);
});
test('database adapter keeps one record under concurrent saves and detects content conflicts',async()=>{
 const db=database(),store=createStore(db),data={id:'id',digest:'digest',content:'测试反馈内容',version:'1.1.0',time:100000};
 const results=await Promise.all([store.save(data),store.save(data)]);
 assert.equal(results.filter(x=>x.duplicate).length,1);assert.equal(db.docs.size,1);
 assert.equal((await store.save({...data,digest:'different'})).code,'REQUEST_CONFLICT');
 const doc=db.docs.get('feedbackid');assert.equal(doc.expiresAt.getTime()-doc.createdAt.getTime(),90*86400000);
 assert.equal((await store.reserve({id:'id',digest:'digest',owner:'owner',time:100000,day:'today'})).duplicate,true);
});
test('database adapter propagates permission and collection errors rather than treating them as missing documents',async()=>{
 const store=createStore({runTransaction:fn=>fn({collection:()=>({doc:()=>({get:async()=>{throw Error('permission denied');}})})})});
 await assert.rejects(store.reserve({id:'id'}),/permission denied/);
});
