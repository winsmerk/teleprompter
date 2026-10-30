const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { wrap, frame } = require('../utils/script');

function harness() {
  let definition, start, stop, save;
  let now = 1000;
  const timers = new Map();
  let timerId = 0;
  const events = [];
  const camera = { startRecord: o => { start = o; }, stopRecord: o => { stop = o; } };
  const wx = {
    getWindowInfo: () => ({ windowWidth: 390 }), getStorageSync: () => null,
    createCameraContext: () => camera, setKeepScreenOn() {}, showToast() {}, openSetting() {},
    showModal: o => o.success({ confirm: true }),
    saveVideoToPhotosAlbum: o => { save = o; }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../utils/camera-page.js'), 'utf8'), {
    module: { set exports(p) { definition = p; } }, wx, getApp: () => ({ draft: { script: '测试文案\n第二行\n第三行\n第四行', speed: 25, fontSize: 28 } }),
    require: p => p.endsWith('/script') ? { wrap, frame } : p.endsWith('/prompt-window') ? require('../utils/prompt-window') : p.endsWith('/format') ? require('../utils/format') : p.endsWith('/video-export') ? { exportVideo: async () => { throw Error('stub'); } } : { log: (e, d) => events.push({ e, d }), exportLogs() {} },
    Date: { now: () => now },
    setInterval: f => { timers.set(++timerId, f); return timerId; }, clearInterval: id => timers.delete(id)
  });
  const page = { ...definition, data: { ...definition.data }, setData(d, cb) { Object.assign(this.data, d); if (cb) cb(); } };
  page.onLoad(); page.onShow(); page.onCameraReady();
  page.processVideo = () => {};
  return { page, events, timers, get start() { return start; }, get stop() { return stop; }, get save() { return save; }, tick(ms) { now += ms; [...timers.values()].forEach(f => f()); } };
}

test('recording starts only once, scrolls, ends and saves only after user request', () => {
  const h = harness(), p = h.page;
  p.toggleRecord(); const request = h.start;
  p.toggleRecord(); assert.equal(h.start, request);
  assert.equal(p.data.scrolling, false);
  request.success(); assert.equal(p.data.recording, true);
  h.tick(100); assert.ok(p.data.shift > 0);
  p.toggleRecord(); assert.equal(p.data.scrolling, false);
  h.stop.success({ tempVideoPath: 'wxfile://test.mp4' });
  assert.equal(p.data.videoPath, 'wxfile://test.mp4');
  assert.equal(h.save, undefined);
  p.saveVideo(); h.save.fail({ errMsg: 'permission denied' }); h.save.complete();
  assert.equal(p.data.saved, false); assert.equal(p.data.videoPath, 'wxfile://test.mp4');
  p.saveVideo(); h.save.success(); h.save.complete();
  assert.equal(p.data.saved, true);
});
test('system timeout and manual stop race preserve the first returned video', () => {
  const h = harness(); h.page.toggleRecord(); h.start.success(); h.page.stopRecording();
  h.start.timeoutCallback({ tempVideoPath: 'wxfile://timeout.mp4' });
  h.stop.fail({ errMsg: 'already stopped' });
  assert.equal(h.page.data.videoPath, 'wxfile://timeout.mp4');
  assert.equal(h.page.data.busy, false); assert.equal(h.timers.size, 0);
});
test('hide during pending start immediately stops rather than recording in background', () => {
  const h = harness(); h.page.toggleRecord(); h.page.onHide(); h.start.success();
  assert.ok(h.stop); assert.equal(h.page.data.scrolling, false);
  h.stop.success({ tempVideoPath: 'wxfile://background.mp4' }); h.page.onShow();
  assert.equal(h.page.data.videoPath, 'wxfile://background.mp4');
});
test('late callbacks from an old recording cannot overwrite the next recording', () => {
  const h = harness(); h.page.toggleRecord(); const old = h.start; old.success();
  old.timeoutCallback({ tempVideoPath: 'wxfile://first.mp4' });
  h.page.retake(); h.page.onCameraReady(); h.page.toggleRecord(); h.start.success();
  old.timeoutCallback({ tempVideoPath: 'wxfile://old.mp4' });
  assert.equal(h.page.data.recording, true); assert.equal(h.page.data.videoPath, '');
});
test('record start failure is retryable and does not scroll', () => {
  const h = harness(); h.page.toggleRecord(); h.start.fail({ errMsg: 'microphone denied' });
  assert.equal(h.page.data.recording, false); assert.equal(h.page.data.busy, false); assert.equal(h.timers.size, 0);
  h.page.toggleRecord(); h.start.success(); assert.equal(h.page.data.recording, true);
});
test('long scripts and surrogate characters stay intact; end does not scroll into blank space', () => {
  const content = '你好🙂'.repeat(1000);
  const lines = wrap(content, 320, 28);
  assert.equal(lines.join(''), content);
  assert.equal(wrap('第一行\n\n第三行', 320, 28)[1], '');
  const end = frame(lines, 10000000, 48);
  assert.equal(end.done, true); assert.equal(end.rows.length, 1); assert.equal(end.shift, 0);
});
function gestureEvent(p,x,y,kind='client') {
 const point=kind==='native'?{x:x-p._promptBounds.left,y:y-p._promptBounds.top}:{clientX:x+p.data.stageLeft,clientY:y+p.data.stageTop};
 return {touches:[point],currentTarget:{dataset:{}}};
}
test('moving and resizing prompt during recording keeps recording and scrolling active',()=>{
 const h=harness(),p=h.page;
 p.toggleRecord();h.start.success();h.tick(100);
 const r=p.promptRect(),x=r.left+r.width/2,y=r.top+r.height/2;
 p.promptTouchStart(gestureEvent(p,x,y));p.promptTouchMove(gestureEvent(p,x+10,y+30));p.promptTouchEnd();
 assert.equal(p.data.recording,true);assert.equal(p.data.scrolling,true);assert.ok(p.data.promptTop>r.top);
 const old=p.promptRect(),right=old.left+old.width,bottom=old.top+old.height;
 p.promptTouchStart(gestureEvent(p,right,bottom));
 p.promptTouchMove(gestureEvent(p,right-30,bottom+70));p.promptTouchEnd();
 assert.ok(p.data.promptWidth<old.width);assert.ok(p.data.promptHeight>old.height);
 assert.equal(p.data.recording,true);assert.equal(p.data.scrolling,true);
});
test('native overlay x/y drag and cancellation are logged with actual progress',()=>{
 const h=harness(),p=h.page,r=p.promptRect(),x=r.left+r.width/2,y=r.top+r.height/2;
 p.promptTouchStart(gestureEvent(p,x,y,'native'));
 p.promptTouchMove(gestureEvent(p,x+20,y+40,'native'));p.promptTouchCancel();
 assert.ok(p.data.promptLeft>r.left);assert.ok(p.data.promptTop>r.top);
 const result=h.events.find(x=>x.e==='prompt.touch.finish').d;
 assert.equal(result.reason,'cancel');assert.equal(result.moveEvents,1);assert.equal(result.dx,20);
 assert.equal(p._promptGesture,null);
});
test('fixed touch surface does not move or resize when prompt changes',()=>{
 const h=harness(),p=h.page,surface=[p.data.promptSurfaceLeft,p.data.promptSurfaceTop,p.data.promptSurfaceWidth,p.data.promptSurfaceHeight];
 const r=p.promptRect(),x=r.left+r.width/2,y=r.top+r.height/2;
 p.promptTouchStart(gestureEvent(p,x,y));p.promptTouchMove(gestureEvent(p,x+10,y+20));p.promptTouchEnd();
 assert.deepEqual([p.data.promptSurfaceLeft,p.data.promptSurfaceTop,p.data.promptSurfaceWidth,p.data.promptSurfaceHeight],surface);
});
