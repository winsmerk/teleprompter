const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function harness(context={},rows=[]){
 const queries=[],deletes=[];const exports={};
 const db={command:{lt:value=>({lt:value}),in:value=>({in:value})},collection:name=>({where:query=>({limit:()=>({get:async()=>{queries.push({name,query});return {data:rows};}}),remove:async()=>{deletes.push({name,query});return {stats:{removed:rows.length}};}})})};
 const cloud={init(){},getWXContext:()=>context,database:()=>db};
 vm.runInNewContext(fs.readFileSync(require.resolve('../cloudfunctions/cleanupFeedback/index.js'),'utf8'),{require:()=>cloud,exports,Date,console:{warn(){}}});
 return {run:exports.main,queries,deletes};
}
const event={Type:'Timer',TriggerName:'feedbackRetention'};
test('retention rejects mini program calls and mismatched triggers before any database operation',async()=>{
 for(const [ctx,input] of [[{OPENID:'user'},event],[{},{}],[{},{...event,TriggerName:'other'}]]){
  const h=harness(ctx);assert.equal((await h.run(input)).ok,false);assert.equal(h.queries.length,0);assert.equal(h.deletes.length,0);
 }
});
test('empty retention pass succeeds without deletes and checks both collections',async()=>{
 const h=harness();const result=await h.run(event);assert.equal(result.ok,true);assert.equal(result.removed,0);assert.deepEqual(h.queries.map(x=>x.name),['feedback','feedback_limits']);assert.equal(h.deletes.length,0);
});
test('retention deletes only selected ids with an expiry guard',async()=>{
 const h=harness({},[{_id:'old'}]);const result=await h.run(event);assert.equal(result.removed,2);
 for(const deletion of h.deletes){assert.equal(deletion.query._id.in[0],'old');assert.ok(deletion.query.expiresAt.lt instanceof Date);}
});
