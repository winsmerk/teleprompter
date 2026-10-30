const cloud=require('wx-server-sdk');
cloud.init({env:cloud.DYNAMIC_CURRENT_ENV});
exports.main=async event=>{
 const ctx=cloud.getWXContext();
 if(ctx.OPENID || !event || event.Type!=='Timer' || event.TriggerName!=='feedbackRetention')return {ok:false};
 const db=cloud.database(),started=Date.now(),expiry=new Date();let removed=0,limited=false;
 // Keep each pass bounded on the experience tier; retry remaining expired data next run.
 for(const name of ['feedback','feedback_limits']){
  for(let batch=0;batch<4;batch++){
   if(Date.now()-started>1800){limited=true;break;}
   const result=await db.collection(name).where({expiresAt:db.command.lt(expiry)}).limit(100).get();
   if(!result.data.length)break;
   const ids=result.data.map(row=>row._id);
   const deleted=await db.collection(name).where({_id:db.command.in(ids),expiresAt:db.command.lt(expiry)}).remove();
   removed+=deleted.stats.removed;
   if(result.data.length<100)break;
   if(batch===3)limited=true;
  }
 }
 if(limited)console.warn('feedback.retention.backlog');
 return {ok:true,removed,limited};
};
