const crypto=require('crypto');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const APPID='wx45896fe0717f3c71';
function createHandler({store,moderate,now=()=>Date.now(),report=()=>{}}){
 return async(event,context)=>{
  if(!context || context.APPID!==APPID || !context.OPENID)return {ok:false,code:'UNAUTHORIZED'};
  const content=typeof event.content==='string'?event.content.trim():'';
  if(Array.from(content).length<5 || Array.from(content).length>500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(content) || !/^[\w-]{8,80}$/.test(event.requestId||'') || !/^\d+\.\d+\.\d+$/.test(event.version||''))return {ok:false,code:'INVALID_INPUT'};
  const owner=hash(APPID+context.OPENID),id=hash(owner+event.requestId),digest=hash(content),time=now();
  let stage='reserve';
  try{
   const gate=await store.reserve({owner,id,digest,time,day:new Date(time+8*3600000).toISOString().slice(0,10)});
   if(gate)return gate;
   stage='moderation';
   let check;
   try{check=await moderate(content,context.OPENID);}catch(error){report(stage,error);return {ok:false,code:'SECURITY_UNAVAILABLE'};}
   if(!check || !check.result || check.result.suggest!=='pass')return {ok:false,code:check && check.result?'CONTENT_REJECTED':'SECURITY_UNAVAILABLE'};
   stage='save';
   return await store.save({id,digest,content,version:event.version,time});
  }catch(error){report(stage,error);return {ok:false,code:'SERVICE_UNAVAILABLE'};}
 };
}
module.exports={createHandler};
