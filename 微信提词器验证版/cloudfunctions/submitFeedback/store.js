function createStore(db){
async function read(tx,collection,id){
 try{const result=await tx.collection(collection).doc(id).get();return result.data;}
 catch(error){if(/document[^\n]*(?:not exist|not found)/i.test(error.message||error.errMsg||''))return null;throw error;}
}
function existing(doc,digest){return doc.contentDigest===digest?{ok:true,duplicate:true}:{ok:false,code:'REQUEST_CONFLICT'};}
return {
 reserve:({owner,id,digest,time,day})=>db.runTransaction(async tx=>{
  const doc=await read(tx,'feedback',id);if(doc)return existing(doc,digest);
  const limit=await read(tx,'feedback_limits',owner);
  if(limit && time-limit.lastAt<60000)return {ok:false,code:'RATE_LIMIT',retryAfterSeconds:Math.ceil((60000-time+limit.lastAt)/1000)};
  const count=limit && limit.day===day?limit.count:0;
  if(count>=5)return {ok:false,code:'DAILY_LIMIT'};
  await tx.collection('feedback_limits').doc(owner).set({data:{day,count:count+1,lastAt:time,expiresAt:new Date(time+2*86400000)}});
  return null;
 }),
 save:({id,digest,content,version,time})=>db.runTransaction(async tx=>{
  const doc=await read(tx,'feedback',id);if(doc)return existing(doc,digest);
  await tx.collection('feedback').doc(id).set({data:{content,version,contentDigest:digest,status:'pending',createdAt:new Date(time),expiresAt:new Date(time+90*86400000)}});
  return {ok:true};
 })
};
}
module.exports={createStore};
