const service=require('../../utils/feedback');
const config=require('../../config/feedback');
Page({
 data:{content:'',count:0,submitting:false,submitted:false,error:'',serviceReady:!!(config.enabled && config.envId),canSubmit:false},
 onLoad(){
  try{const saved=wx.getStorageSync(service.DRAFT_KEY);if(saved && typeof saved.content==='string' && saved.id && Date.now()-saved.createdAt<7*86400000){this._pending=saved;this.updateContent(saved.content);}else if(saved)wx.removeStorageSync(service.DRAFT_KEY);}catch(_){}
 },
 onUnload(){this._unloaded=true;},
 updateContent(content){this.setData({content,count:Array.from(content).length,canSubmit:!service.validate(content),error:'',submitted:false});},
 onInput(e){if(!this._sending)this.updateContent(e.detail.value);},
 remember(content){
  if(!this._pending || this._pending.content!==content)this._pending={id:service.requestId(),content,createdAt:Date.now()};
  try{wx.setStorageSync(service.DRAFT_KEY,this._pending);}catch(_){}
  return this._pending;
 },
 async submit(){
  if(this._sending || this.data.submitted)return;
  const error=service.validate(this.data.content);
  if(error){this.setData({error});return;}
  if(!this.data.serviceReady){this.setData({error:'反馈功能正在准备中，请稍后再来'});return;}
  const content=service.normalized(this.data.content),pending=this.remember(content);
  this._sending=true;this.setData({submitting:true,error:''});
  try{
   // The feedback purpose must also be configured in the platform privacy contract.
   if(wx.requirePrivacyAuthorize)await new Promise((resolve,reject)=>wx.requirePrivacyAuthorize({success:resolve,fail:()=>reject(Error('请同意隐私保护指引后再提交，文字已保留'))}));
   await service.send(wx,config,service.payload(content,pending.id));
   try{const stored=wx.getStorageSync(service.DRAFT_KEY);if(stored && stored.id===pending.id)wx.removeStorageSync(service.DRAFT_KEY);}catch(_){}
   this._pending=null;
   if(!this._unloaded)this.setData({content:'',count:0,canSubmit:false,submitted:true});
  }catch(e){if(!this._unloaded)this.setData({error:e.message || '暂时无法提交，文字已保留，请重试'});}
  finally{this._sending=false;if(!this._unloaded)this.setData({submitting:false});}
 },
 openPrivacy(){if(wx.openPrivacyContract)wx.openPrivacyContract({fail:()=>wx.showToast({title:'暂时无法打开隐私指引',icon:'none'})});},
 goBack(){wx.navigateBack({fail:()=>wx.showToast({title:'请返回首页继续使用',icon:'none'})});}
});
