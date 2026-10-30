const VERSION='1.1.0';
const DRAFT_KEY='feedback-pending-v1';
function normalized(text){return String(text || '').trim();}
function validate(text){
 const content=normalized(text),length=Array.from(content).length;
 if(length<5)return '请至少填写5个字';
 if(length>500)return '反馈内容不能超过500个字';
 if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(content))return '请移除不支持的控制字符';
 return '';
}
function requestId(){return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,12)+'-'+Math.random().toString(36).slice(2,12);}
function payload(content,id){return {content:normalized(content),requestId:id,version:VERSION};}
function responseMessage(result){
 const code=result && result.code;
 if(code==='RATE_LIMIT')return '提交较频繁，请'+Math.max(1,Math.ceil(Number(result.retryAfterSeconds)||60))+'秒后重试';
 return ({DAILY_LIMIT:'今天提交次数已达上限，请明天再来',CONTENT_REJECTED:'内容未通过安全检查，请调整后再提交',SECURITY_UNAVAILABLE:'内容检查暂不可用，请稍后重试',INVALID_INPUT:'请填写5–500字的有效反馈',UNAUTHORIZED:'身份验证失败，请重新打开小程序再试',REQUEST_CONFLICT:'本次请求已变更，请修改内容后重试',SERVICE_UNAVAILABLE:'反馈服务暂不可用，文字已保留，请稍后重试'})[code] || '暂未收到提交成功确认，文字已保留，请稍后重试';
}
function send(wxApi,config,data,timeoutMs=25000){
 if(!config.enabled || !config.envId)return Promise.reject(Error('反馈功能正在准备中，请稍后再来'));
 if(!wxApi.cloud)return Promise.reject(Error('请更新微信后使用意见反馈'));
 return new Promise((resolve,reject)=>{
  let done=false;
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value);};
  const timer=setTimeout(()=>finish(Error('暂未确认提交结果，文字已保留。请稍后重试，系统会自动去重。')),timeoutMs);
  try{
   wxApi.cloud.init({env:config.envId,traceUser:false});
   wxApi.cloud.callFunction({name:'submitFeedback',config:{env:config.envId},data,
    success:res=>{const result=res && res.result;if(result && result.ok===true)finish(null,result);else finish(Error(responseMessage(result)));},
    fail:()=>finish(Error('网络或反馈服务暂不可用，文字已保留，请稍后重试'))});
  }catch(_){finish(Error('反馈服务暂不可用，文字已保留，请稍后重试'));}
 });
}
module.exports={VERSION,DRAFT_KEY,normalized,validate,requestId,payload,responseMessage,send};
