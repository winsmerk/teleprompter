const diagnostics = require('../../utils/log');
const DEFAULT = '你好，欢迎使用随行提词。\n把想说的话提前写下来，拍摄时跟着文字慢慢说。\n不必一次就说得完美，自然表达就很好。\n现在试着录制十秒，再检查相册里的视频和声音。';
Page({
  data: { script: DEFAULT, speed: 25, fontSize: 28, direction: 'portrait', ratio: '16:9', draftSaved:true, entering:false, entryLabel:'进入拍摄', entryHint:'' },
  onLoad() { try { const saved = wx.getStorageSync('draft-v1'); if (saved) this.setData(saved); } catch (_) {} },
  persist() { try { wx.setStorageSync('draft-v1', {script:this.data.script,speed:this.data.speed,fontSize:this.data.fontSize,direction:this.data.direction,ratio:this.data.ratio}); this.setData({draftSaved:true}); } catch (_) { this.setData({draftSaved:false}); wx.showToast({ title: '本机存储失败，请勿退出', icon: 'none' }); } },
  onInput(e) { this.setData({ script: e.detail.value }); this.persist(); },
  onSpeed(e) { this.setData({ speed: e.detail.value }); this.persist(); },
  onFont(e) { this.setData({ fontSize: e.detail.value }); this.persist(); },
  onDirection(e) { this.setData({ direction: e.currentTarget.dataset.value }); this.persist(); },
  onRatio(e) { this.setData({ ratio: e.currentTarget.dataset.value }); this.persist(); },
  stepSetting(e) {
    const kind=e.currentTarget.dataset.kind;
    const min=kind==='speed'?5:22, max=kind==='speed'?80:38;
    this.setData({[kind]:Math.max(min,Math.min(max,this.data[kind]+Number(e.currentTarget.dataset.delta)))}); this.persist();
  },
  openFeedback() { wx.navigateTo({url:'/pages/feedback/feedback',fail:()=>wx.showToast({title:'页面打开失败，请重试',icon:'none'})}); },
  showHelp() {
    wx.showActionSheet({itemList:['使用说明','用户隐私保护指引','本机数据说明','复制诊断日志'],success:r=>{
      if(r.tapIndex===3) return diagnostics.exportLogs();
      if(r.tapIndex===1) {
        if(!wx.openPrivacyContract)return wx.showToast({title:'请更新微信后查看隐私指引',icon:'none'});
        return wx.openPrivacyContract({fail:()=>wx.showToast({title:'暂时无法打开隐私指引，请稍后再试',icon:'none'})});
      }
      if(r.tapIndex===2)return wx.showModal({title:'本机数据说明',content:'文案、拍摄设置、提词框位置和最近诊断日志保存在本机。视频在本机处理，保存相册需由你主动操作。提词文案和视频不上传到开发者服务器。意见反馈只有点击提交时才上传反馈文字和版本，用于改进产品；云端使用微信身份摘要标识控制提交频率并去重。复制诊断日志会将设备型号、系统版本和操作记录写入剪贴板，不含文案及视频内容；仅在你主动发送后才会提供给接收方。',showCancel:false});
      wx.showModal({title:'自然表达，轻松开拍',content:'输入文案并选好方向、比例后进入拍摄。开始录像会自动滚动提词；暂停提词不会停止录像。拍完等待生成视频，再保存到相册。拖动提词框内部可移动位置，拖动边框可调整大小，文字行数自动适配。提词文字不会出现在成片中，视频不上传服务器。',showCancel:false});
    }});
  },
  onUnload() { this._unloaded=true; clearTimeout(this._entryWaitTimer); },
  async enterCamera() {
    if (this._entering) return;
    if (!this.data.script.trim()) return wx.showToast({ title: '请先输入文案', icon: 'none' });
    this._entering = true;
    const started=Date.now();
    const draft={script:this.data.script,speed:this.data.speed,fontSize:this.data.fontSize,direction:this.data.direction,ratio:this.data.ratio};
    const phase=(label,hint)=>{
      if(!this._unloaded)this.setData({entering:true,entryLabel:label,entryHint:hint});
      clearTimeout(this._entryWaitTimer);
      this._entryWaitTimer=setTimeout(()=>{if(!this._unloaded)this.setData({entryHint:'仍在等待微信或系统响应，请查看是否有授权弹窗'});},4000);
    };
    const call=(name,args={})=>new Promise((resolve,reject)=>wx[name]({...args,success:resolve,fail:reject}));
    const timed=async(name,args)=>{
      const at=Date.now(); diagnostics.log('permissions.step.start',{step:name,scope:args && args.scope});
      try{return await call(name,args);}finally{diagnostics.log('permissions.step.end',{step:name,scope:args && args.scope,durationMs:Date.now()-at});}
    };
    let navigating=false;
    phase('正在准备拍摄…','正在请求必要授权，请稍候');
    try {
      // Request necessary authorization directly; no status-query round trips.
      if(wx.requirePrivacyAuthorize){
        phase('请确认隐私授权','同意隐私保护指引后继续拍摄');
        await timed('requirePrivacyAuthorize');
      }
      for (const [scope,label] of [['scope.camera','相机'],['scope.record','麦克风']]) {
        phase('请允许'+label+'权限','请在微信或系统弹窗中选择允许');
        await timed('authorize',{scope});
      }
      phase('正在打开相机…','权限已就绪，正在进入拍摄页面');
      getApp().draft=draft;
      diagnostics.log('permissions.ready',{durationMs:Date.now()-started});
      navigating=true;
      await call('navigateTo',{url:draft.direction==='landscape'?'/pages/landscape/landscape':'/pages/camera/camera'});
      diagnostics.log('camera.navigation.ready',{durationMs:Date.now()-started});
    } catch(error) {
      diagnostics.log('permissions.failed',{message:error.errMsg || error.message,durationMs:Date.now()-started,navigating});
      if(!this._unloaded)wx.showModal({title:navigating?'暂时无法进入拍摄':'拍摄授权未完成',content:navigating?'页面打开失败，请重试。':'请允许隐私协议、相机和麦克风权限后重试。已拒绝的权限可以在设置中开启。',confirmText:navigating?'知道了':'打开设置',showCancel:!navigating,success:r=>{if(r.confirm&&!navigating)wx.openSetting({});}});
    } finally {
      clearTimeout(this._entryWaitTimer); this._entering=false;
      if(!this._unloaded)this.setData({entering:false,entryLabel:'进入拍摄',entryHint:''});
    }
  },
  copyLogs() { diagnostics.exportLogs(); }
});
