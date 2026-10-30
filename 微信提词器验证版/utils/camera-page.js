const format = require('./format');
const promptWindow = require('./prompt-window');
const { exportVideo } = require('./video-export');
const { wrap, frame } = require('./script');
const { log, exportLogs } = require('./log');
module.exports = {
  data: { mounted: true, ready: false, busy: false, recording: false, scrolling: false, position: 'front', status: '相机准备中', error: '', elapsed: '00:00', speed: 25, fontSize: 28, rows: [], shift: 0, videoPath: '', saved: false, saving: false, processing: false, exportError: '', direction: 'portrait', ratio: '16:9', formatLabel: '9:16', stageWidth: 0, stageHeight: 0, stageLeft: 0, stageTop: 0, topInset: 44 },
  onLoad() {
    const draft = getApp().draft || wx.getStorageSync('draft-v1') || {};
    this._script = draft.script || '请返回输入文案';
    this.setData({ speed: draft.speed || 25, fontSize: draft.fontSize || 28, direction: draft.direction || 'portrait', ratio: draft.ratio || '16:9', formatLabel: format.label(draft.ratio || '16:9', draft.direction || 'portrait') });
    this._offset = 0;
    this.updateLayout();
    this.renderFrame();
    log('camera.page.load', { overlayHost:'webview-surface-v1', speed: this.data.speed, fontSize: this.data.fontSize, direction:this.data.direction, ratio:this.data.ratio });
    wx.setKeepScreenOn({ keepScreenOn: true });
  },
  updateLayout(size, source = 'window-info') {
    const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const rawWidth = size && size.windowWidth || win.windowWidth;
    const rawHeight = size && size.windowHeight || win.windowHeight || 760;
    const box = format.layout(rawWidth, rawHeight, this.data.ratio, this.data.direction);
    const key = [box.viewportWidth,box.viewportHeight,this.data.ratio,this.data.direction].join(':');
    if (this._layoutKey === key) return;
    this._layoutKey = key;
    const landscape=this.data.direction==='landscape';
    let menu;
    try { menu=wx.getMenuButtonBoundingClientRect && wx.getMenuButtonBoundingClientRect(); } catch (_) {}
    const topInset=landscape?8:(win.statusBarHeight || 24);
    const navTop=menu && menu.top>=0 && menu.top<box.viewportHeight/2 ? menu.top : topInset+4;
    const navHeight=Math.max(32,menu && menu.height || 32);
    const navLeft=landscape?Math.max(16,win.safeArea && win.safeArea.left || 0):12;
    const contentTop=navTop+navHeight+12;
    const bottomInset=landscape?8:Math.min(34,Math.max(12,win.screenHeight && win.safeArea ? win.screenHeight-win.safeArea.bottom : 20));
    const dockWidth=landscape?168:box.viewportWidth;
    const dockHeight=landscape?Math.max(100,box.viewportHeight-contentTop-bottomInset):204+bottomInset;
    const dockLeft=landscape?box.viewportWidth-dockWidth-12:0;
    const dockTop=landscape?contentTop:box.viewportHeight-dockHeight;
    // Maximize the selected aspect in the entire viewport; controls overlay it.
    const promptTop=Math.max(12,contentTop-box.stageTop);
    const resultArea = this.data.direction==='landscape'
      ? {left:16,top:64,width:Math.max(100,box.viewportWidth-280),height:Math.max(100,box.viewportHeight-88)}
      : {left:16,top:topInset+60,width:box.viewportWidth-32,height:Math.max(100,box.viewportHeight-topInset-60-256)};
    const aspect=format.aspect(this.data.ratio,this.data.direction);
    const resultWidth=Math.min(resultArea.width,resultArea.height*aspect), resultHeight=resultWidth/aspect;
    this.setData({ ...box, topInset, navTop, navLeft, navHeight, promptTop, dockWidth, dockHeight, dockLeft, dockTop, resultWidth:Math.round(resultWidth),resultHeight:Math.round(resultHeight),resultLeft:Math.round(resultArea.left+(resultArea.width-resultWidth)/2),resultTop:Math.round(resultArea.top+(resultArea.height-resultHeight)/2) });
    log('camera.layout',{source,rawWidth,rawHeight,direction:this.data.direction,ratio:this.data.ratio,...box});
    this._promptBounds={left:8,top:Math.max(8,contentTop-box.stageTop),width:Math.max(100,Math.min(box.stageWidth-16,landscape?dockLeft-box.stageLeft-16:box.stageWidth-16)),height:0};
    this._promptBounds.height=Math.max(this.data.fontSize*1.7+16,Math.min(box.stageHeight-8,(landscape?box.viewportHeight-bottomInset:dockTop)-box.stageTop)-this._promptBounds.top);
    this.setData({promptSurfaceLeft:this._promptBounds.left,promptSurfaceTop:this._promptBounds.top,promptSurfaceWidth:this._promptBounds.width,promptSurfaceHeight:this._promptBounds.height});
    let saved;
    try { saved=wx.getStorageSync('prompt-window-v3-'+this.data.direction+'-'+this.data.ratio); } catch (_) {}
    const rect=saved && saved.width>0?{left:saved.left*box.stageWidth,top:saved.top*box.stageHeight,width:saved.width*box.stageWidth,height:saved.height*box.stageHeight}:{left:16,top:this._promptBounds.top,width:this._promptBounds.width*.82,height:16+this.data.fontSize*1.7*2};
    this.applyPromptWindow(promptWindow.fit(rect,this._promptBounds,this.data.fontSize));
  },
  applyPromptWindow(rect) {
    const widthChanged=!this._lines || Math.abs(rect.width-(this.data.promptWidth||0))>=1;
    const lineHeight=this.data.fontSize*1.7;
    if(widthChanged){
      const old=this._lines || [];
      const index=Math.floor((this._offset||0)/lineHeight);
      const readChars=old.slice(0,index).reduce((n,line)=>n+line.length,0);
      this._lines=wrap(this._script,Math.max(80,rect.width-16),this.data.fontSize);
      let used=0,newIndex=0;
      while(newIndex<this._lines.length-1 && used+this._lines[newIndex].length<=readChars){used+=this._lines[newIndex].length;newIndex++;}
      this._offset=newIndex*lineHeight+((this._offset||0)%lineHeight);
    }
    this.setData({promptLeft:rect.left,promptTop:rect.top,promptWidth:rect.width,promptHeight:rect.height,promptRows:promptWindow.rows(rect.height,this.data.fontSize)});
    this.renderFrame();
  },
  promptEventPoint(e) {
    const p=promptWindow.point(e);
    if(!p)return null;
    // client/page coordinates are viewport based; native x/y are surface local.
    return p.kind==='x'?{x:p.x+this._promptBounds.left,y:p.y+this._promptBounds.top,kind:p.kind}:{x:p.x-this.data.stageLeft,y:p.y-this.data.stageTop,kind:p.kind};
  },
  promptRect() { return {left:this.data.promptLeft,top:this.data.promptTop,width:this.data.promptWidth,height:this.data.promptHeight}; },
  promptTouchStart(e) {
    if(this._promptGesture)this.finishPromptGesture('replaced');
    if(this.data.busy || !this.data.ready){log('prompt.touch.ignored',{reason:'not-ready-or-busy'});return;}
    const point=this.promptEventPoint(e);
    if(!point){log('prompt.touch.invalid',{phase:'start'});return;}
    const rect=this.promptRect(),mode=promptWindow.hit(rect,point);
    if(!mode){log('prompt.touch.ignored',{reason:'outside-window'});return;}
    // Never change the touch receiver's geometry or appearance during a gesture.
    this._promptGesture={x:point.x,y:point.y,mode,...rect,at:Date.now(),moves:0,invalid:0,samples:[]};
    log('prompt.touch.start',{mode,coordinateKind:point.kind,overlayHost:'webview-surface-v1',rect,bounds:this._promptBounds});
  },
  promptTouchMove(e) {
    const g=this._promptGesture;
    if(!g)return;
    const point=this.promptEventPoint(e);
    if(!point){g.invalid++;return;}
    if(this.data.busy){this.finishPromptGesture('busy');return;}
    const dx=point.x-g.x,dy=point.y-g.y;
    const rect=promptWindow.transform(g,g.mode,dx,dy,this._promptBounds,this.data.fontSize);
    if(g.mode==='move')this.setData({promptLeft:rect.left,promptTop:rect.top});
    else this.applyPromptWindow(rect);
    g.moves++;g.dx=dx;g.dy=dy;
    g.lastMoveAt=Date.now();
    if(g.samples.length<5)g.samples.push({ms:Date.now()-g.at,dx:Math.round(dx),dy:Math.round(dy)});
  },
  finishPromptGesture(reason) {
    const g=this._promptGesture;if(!g)return;
    this._promptGesture=null;
    const rect=this.promptRect();
    try { wx.setStorageSync('prompt-window-v3-'+this.data.direction+'-'+this.data.ratio,{left:rect.left/this.data.stageWidth,top:rect.top/this.data.stageHeight,width:rect.width/this.data.stageWidth,height:rect.height/this.data.stageHeight}); } catch (_) {}
    log('prompt.touch.finish',{reason,mode:g.mode,moveEvents:g.moves,invalidEvents:g.invalid,durationMs:Date.now()-g.at,lastMoveGapMs:g.lastMoveAt?Date.now()-g.lastMoveAt:null,dx:Math.round(g.dx||0),dy:Math.round(g.dy||0),samples:g.samples,rect,rows:this.data.promptRows});
  },
  promptTouchEnd(e) {
    if(e && promptWindow.point(e))this.promptTouchMove(e);
    this.finishPromptGesture('end');
  },
  promptTouchCancel() { this.finishPromptGesture('cancel'); },
  measureLayout() {
    if (!wx.createSelectorQuery || this._unloaded) return;
    wx.createSelectorQuery().in(this).select('.page').boundingClientRect(rect => {
      if(this._unloaded || !rect || rect.width<=0 || rect.height<=0) return;
      this.updateLayout({windowWidth:rect.width,windowHeight:rect.height},'page-bounds');
      this.renderFrame();
    }).exec();
  },
  onReady() { this.updateLayout(); this.renderFrame(); this.measureLayout(); },
  onResize(e) { this.pauseScroll(); this.updateLayout(e && e.size,'resize'); this._offset = 0; this.renderFrame(); this.measureLayout(); },
  actionHint(title) { wx.showToast({title,icon:'none',duration:1400}); },
  goBack() { if (this.data.recording || this.data.busy || this.data.processing || this.data.saving) return this.actionHint(this.data.saving?'正在保存，请稍候':'请先结束录像或等待处理完成'); wx.navigateBack({fail:()=>this.actionHint('返回失败，请重试')}); },
  onShow() {
    this._hidden = false;
    this.measureLayout();
    if (!this.data.videoPath && !this.data.mounted && !this._unloaded) this.setData({ mounted: true, status: '相机准备中', error: '' });
  },
  onHide() {
    this._hidden = true;
    this.finishPromptGesture('page-hide');
    if (this.data.processing) this._cancelExport = true;
    this.pauseScroll();
    log('camera.page.hide', { recording: this.data.recording, busy: this.data.busy });
    // 不假设退后台还能录像。主动结束，bindstop/timeoutCallback 作为系统中断兜底。
    if (this.data.recording && !this.data.busy) this.stopRecording();
    this.setData({ ready: false });
    if (!this.data.recording && !this.data.busy) this.setData({ mounted: false });
  },
  onUnload() {
    this.finishPromptGesture('page-unload');
    this._unloaded = true;
    this._cancelExport = true;
    this.pauseScroll();
    clearInterval(this._recordTimer);
    if (this.data.recording && this._camera) this._camera.stopRecord({});
    wx.setKeepScreenOn({ keepScreenOn: false });
    log('camera.page.unload');
  },
  onCameraReady() {
    this._camera = wx.createCameraContext();
    this.setData({ ready: true, status: '画面已就绪', error: '' });
    log('camera.ready', { position: this.data.position });
  },
  onCameraError(e) {
    const message = e.detail && e.detail.errMsg || '相机不可用';
    log('camera.error', { message });
    this.pauseScroll();
    this.setData({ ready: false, error: message, status: '相机中断' });
    if (this.data.recording && !this.data.busy) this.stopRecording();
  },
  onCameraStop(e) {
    log('camera.stop', { detail: e.detail || {} });
    this.pauseScroll();
    this.setData({ ready: false, mounted: false, status: '相机已暂停，请重新启用' });
    // 系统停止时，录像文件由 startRecord 的 timeoutCallback 返回。
    if (this.data.recording && !this.data.busy) this.stopRecording();
  },
  retryCamera() {
    if (this.data.busy || this.data.recording) return;
    this.setData({ mounted: false, ready: false, error: '', status: '相机准备中' }, () => {
      if (!this._hidden && !this._unloaded) this.setData({ mounted: true });
    });
  },
  switchCamera() {
    if (this.data.recording || this.data.busy || !this.data.ready) return this.actionHint(this.data.recording?'录像中无法切换镜头':this.data.status);
    this.pauseScroll();
    this.setData({ mounted: false, ready: false, position: this.data.position === 'front' ? 'back' : 'front', status: '正在切换镜头' }, () => {
      if (!this._hidden && !this._unloaded) this.setData({ mounted: true });
    });
  },
  renderFrame() { this.setData(frame(this._lines, this._offset, this.data.fontSize * 1.7, this.data.promptRows)); },
  startScroll() {
    if (this.data.scrolling) return;
    const max = Math.max(0, (this._lines.length - 1) * this.data.fontSize * 1.7);
    if (this._offset >= max) this._offset = 0;
    this._lastTick = Date.now();
    this.setData({ scrolling: true });
    this._scrollTimer = setInterval(() => {
      const now = Date.now();
      this._offset += Math.min(now - this._lastTick, 250) / 1000 * this.data.speed;
      this._lastTick = now;
      const current = frame(this._lines, this._offset, this.data.fontSize * 1.7, this.data.promptRows);
      this.setData({ rows: current.rows, shift: current.shift });
      if (current.done) this.pauseScroll();
    }, 80);
  },
  pauseScroll() { clearInterval(this._scrollTimer); this._scrollTimer = null; if (!this._unloaded) this.setData({ scrolling: false }); },
  toggleScroll() { if (!this.data.ready || this.data.busy) return this.actionHint(this.data.status); this.data.scrolling ? this.pauseScroll() : this.startScroll(); },
  resetScroll() { if(this.data.busy) return this.actionHint(this.data.status); this._offset = 0; this.renderFrame(); this.actionHint('已回到文案开头'); },
  stepSpeed(e) { if (this.data.busy || !this.data.ready) return this.actionHint(this.data.status); if((this.data.speed<=5 && Number(e.currentTarget.dataset.delta)<0)||(this.data.speed>=80 && Number(e.currentTarget.dataset.delta)>0)) return this.actionHint('已到速度调节边界'); this.onSpeed({ detail: { value: Math.max(5, Math.min(80, this.data.speed + Number(e.currentTarget.dataset.delta))) } }); },
  onSpeed(e) { this.setData({ speed: e.detail.value }); log('scroll.speed', { speed: e.detail.value }); },
  toggleRecord() {
    if (this.data.busy || (!this.data.ready && !this.data.recording)) return this.actionHint(this.data.status);
    if (this.data.recording) return this.stopRecording();
    this.setData({ busy: true, status: '正在开始录像', error: '' });
    this._finished = false;
    const session = this._session = (this._session || 0) + 1;
    this._startedAt = 0;
    log('record.start.request');
    this._camera.startRecord({
      timeout: 300,
      selfieMirror: false,
      success: () => {
        if (session !== this._session || this._finished || this._unloaded) return;
        this._startedAt = Date.now();
        this.setData({ busy: false, recording: true, elapsed: '00:00', status: '正在录像' });
        log('record.start.success');
        if (this._hidden) { this.stopRecording(); return; }
        this.startScroll();
        this._recordTimer = setInterval(() => {
          const seconds = Math.floor((Date.now() - this._startedAt) / 1000);
          this.setData({ elapsed: String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0') });
        }, 500);
      },
      fail: e => {
        if (session !== this._session || this._finished) return;
        log('record.start.fail', { message: e.errMsg });
        if (!this._unloaded) this.setData({ busy: false, recording: false, status: '录像未开始', error: '请检查麦克风授权并重试' });
      },
      timeoutCallback: res => { if (session === this._session) this.finishVideo(res, 'timeout-or-interruption'); }
    });
  },
  stopRecording() {
    if (!this._camera || this.data.busy) return;
    this.pauseScroll();
    this.setData({ busy: true, status: '正在生成视频' });
    log('record.stop.request');
    const session = this._session;
    this._camera.stopRecord({
      compressed: false,
      success: res => { if (session === this._session) this.finishVideo(res, 'manual'); },
      fail: e => {
        if (session !== this._session) return;
        log('record.stop.fail', { message: e.errMsg });
        if (this._finished || this._unloaded) return;
        clearInterval(this._recordTimer);
        this.setData({ busy: false, recording: false, status: '停止录像失败', error: '系统未返回视频，请重新启用相机后再试', ready: false });
      }
    });
  },
  finishVideo(res, reason) {
    if (this._finished) return;
    clearInterval(this._recordTimer);
    this.pauseScroll();
    const path = res && res.tempVideoPath;
    this._finished = !!path;
    log('record.finish', { reason, hasVideo: !!path, durationMs: this._startedAt ? Date.now() - this._startedAt : 0 });
    if (this._unloaded) return;
    if (!path) {
      this.setData({ recording: false, busy: false, ready: false, mounted: false, status: '录像被中断，未取得视频', error: '请重新启用相机重试' });
      return;
    }
    this._originalPath = path;
    this.setData({ recording: false, busy: false, ready: false, mounted: false, videoPath: path, saved: false, status: '录像已完成', error: '', exportError: '' });
    this.processVideo();
  },
  async processVideo() {
    if (this.data.processing || !this._originalPath) return;
    this._cancelExport = false;
    this.setData({ processing: true, exportError: '', status: '正在按比例生成视频…' });
    log('export.start', { ratio: this.data.ratio, direction: this.data.direction });
    try {
      const result = await exportVideo(this._originalPath, this.data.ratio, this.data.direction,
        value => { if (!this._unloaded) this.setData({ status: '正在生成视频 ' + value + '%' }); },
        () => this._cancelExport || this._unloaded,
        (event, detail) => log('export.' + event, detail));
      const seconds=Math.max(0,Math.round(Number(result.info.duration)||0));
      if (!this._unloaded) this.setData({ videoPath: result.path, videoDuration:String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0'),status: '成片 ' + this.data.formatLabel + ' · 已就绪' });
      log('export.success', { width: result.info.width, height: result.info.height, duration: result.info.duration, orientation: result.info.orientation });
    } catch (error) {
      log('export.fail', { message: error.message || error.errMsg });
      if (!this._unloaded) this.setData({ exportError: error.message || error.errMsg || '视频处理失败', status: '比例处理未完成，原片仍保留' });
    } finally { if (!this._unloaded) this.setData({ processing: false }); }
  },
  saveVideo() {
    if (!this.data.videoPath || this.data.saving || this.data.saved || this.data.processing || this.data.exportError) return;
    this.setData({ saving: true });
    log('album.save.request');
    wx.saveVideoToPhotosAlbum({
      filePath: this.data.videoPath,
      success: () => { this.setData({ saved: true }); log('album.save.success'); wx.showToast({ title: '已保存到相册' }); },
      fail: e => {
        log('album.save.fail', { message: e.errMsg });
        wx.showModal({ title: '视频尚未保存', content: '视频仍保留在当前页面。请检查相册授权和手机存储空间，之后再次保存。', confirmText: '打开设置', success: r => { if (r.confirm) wx.openSetting({}); } });
      },
      complete: () => this.setData({ saving: false })
    });
  },
  retake() {
    if (this.data.processing || this.data.saving || this._retakePrompt) return;
    const reset = () => { this._offset = 0; this.setData({ videoPath: '', videoDuration:'', exportError: '', saved: false, ready: false, mounted: true, elapsed: '00:00', status: '相机准备中', error: '' }); this.renderFrame(); };
    if (this.data.saved) return reset();
    this._retakePrompt=true;
    wx.showModal({ complete:()=>{this._retakePrompt=false;}, title: '视频还未保存', content: '重新拍摄会离开当前预览，是否继续？', success: r => { if (r.confirm) reset(); } });
  },
  copyLogs() { exportLogs(); }
};
