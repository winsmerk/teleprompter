const cloud=require('wx-server-sdk');
const {createHandler}=require('./core');
cloud.init({env:cloud.DYNAMIC_CURRENT_ENV});
const db=cloud.database();
const store=require('./store').createStore(db);
const handler=createHandler({store,report:(stage,error)=>console.warn('feedback.service.error',{stage,code:String(error && (error.errCode || error.code) || 'UNKNOWN').replace(/[^A-Za-z0-9_.-]/g,'').slice(0,80)}),moderate:(content,openid)=>cloud.openapi.security.msgSecCheck({content,openid,scene:2,version:2})});
exports.main=event=>handler(event||{},cloud.getWXContext());
