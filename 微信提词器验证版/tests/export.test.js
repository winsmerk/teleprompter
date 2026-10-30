const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function load(wx) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../utils/video-export.js'),'utf8'), {
    module, wx, require: () => require('../utils/format'), setTimeout, clearTimeout, Date, Promise, Error, Uint8Array, Float32Array
  });
  return module.exports.exportVideo;
}
test('matching source keeps original video and audio without reencoding', async () => {
  const run = load({ getVideoInfo: o => o.success({ width:1080,height:1920,orientation:'up',duration:10 }) });
  const result = await run('original','16:9','portrait',()=>{});
  assert.equal(result.path,'original');
});
function fixture(blackOutput = false) {
  const added = [], cleaned = [];
  let stop;
  const state = {};
  const gl = new Proxy({}, { get(_, name) {
    if (['bindFramebuffer','useProgram','activeTexture','bindTexture'].includes(name)) return () => { state[name]=true; };
    if (name === 'drawArrays') return () => { for(const key of ['bindFramebuffer','useProgram','activeTexture','bindTexture']) assert.equal(state[key],true,'must rebind '+key+' after encoder mutates GL'); };
    if (name === 'getError') return () => 0;
    if (name === 'NO_ERROR') return 0;
    if (name === 'isContextLost') return () => false;
    if (name === 'readPixels') return (...args) => args[6].fill(100);
    if (name === 'getShaderParameter' || name === 'getProgramParameter') return () => true;
    if (String(name).startsWith('create')) return () => ({});
    return () => {};
  } });
  const originalAudio = {kind:'audio'}, oldVideo = {kind:'video',old:true}, newVideo = {kind:'video'};
  const wx = {
    getVideoInfo: o => o.success(o.src === 'original' ? {width:1920,height:1080,orientation:'up',duration:2,fps:1} : {width:1080,height:1080,orientation:'up',duration:2}),
    createVideoDecoder: () => {let ended, count=0, source; return {on: (_,f) => {ended=f;},start:async o=>{source=o.source;}, getFrameData:()=>{if(count++<4) return {width:2,height:2,data:new Uint8Array(16).fill(blackOutput && source==='encoded' && count>1 ? 0 : 100).buffer}; ended();return null;}, remove:async()=>{cleaned.push('decoder');}};},
    createOffscreenCanvas: o => ({...o,getContext:()=>gl}),
    createMediaRecorder: () => ({on:(_,f)=>{stop=f;},start:async()=>{},requestFrame:async f=>{for(const key of Object.keys(state)) state[key]=false; return f();},stop:async()=>{stop({tempFilePath:'encoded'});},destroy:async()=>{cleaned.push('recorder');}}),
    createMediaContainer: () => ({extractDataSource:o=>{setTimeout(()=>o.success({tracks:o.source==='original'?[oldVideo,originalAudio]:[newVideo]}),0);},addTrack:t=>added.push(t),export:o=>{setTimeout(()=>o.success({tempFilePath:'merged'}),0);},destroy:()=>cleaned.push('container')})
  };
  return {wx,added,cleaned,originalAudio,newVideo};
}
test('crop pipeline muxes original audio with new video, never original uncropped video', async () => {
  const {wx,added,cleaned,originalAudio,newVideo} = fixture();
  const result = await load(wx)('original','1:1','portrait',()=>{});
  assert.equal(result.path,'merged'); assert.deepEqual(added,[newVideo,originalAudio]);
  assert.deepEqual(cleaned,['decoder','decoder','recorder','container']);
});
test('unsupported conversion reports failure instead of silently saving original ratio', async () => {
  const run = load({getVideoInfo:o=>o.success({width:1920,height:1080,orientation:'up',duration:10})});
  await assert.rejects(run('original','1:1','portrait',()=>{}),/更新微信/);
});

test('first frame normal then encoded black frames must fail before mux/save', async () => {
  const {wx,added,cleaned}=fixture(true);
  await assert.rejects(load(wx)('original','1:1','portrait',()=>{}),/连续黑帧/);
  assert.equal(added.length,0);
  assert.ok(cleaned.includes('recorder'));
});
