const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
function harness(granted=true){
 let def, navigation, modal, pending;const calls=[], events=[];
 const wx={getStorageSync(){},getSetting(){throw Error('must not query settings');},getPrivacySetting(){throw Error('must not query privacy');},requirePrivacyAuthorize(o){calls.push('privacy');o.success({});},authorize(o){calls.push(o.scope);o.success({});},navigateTo(o){calls.push('navigate');navigation=o;},showModal(o){modal=o;},showToast(){},openSetting(){}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../pages/index/index.js'),'utf8'),{Page:p=>def=p,wx,getApp:()=>({}),require:()=>({log:(e,d)=>events.push({e,d})}),setTimeout:f=>(pending=f,1),clearTimeout(){},Date});
 const page={...def,data:{...def.data},setData(d){Object.assign(this.data,d);}};
 return {page,calls,events,wx,get nav(){return navigation;},get modal(){return modal;},waitHint(){pending();}};
}
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
test('direct authorization never queries permission state and retains loading until navigation completes',async()=>{
 const h=harness();const p=h.page;const first=p.enterCamera();assert.equal(p.data.entering,true);
 await p.enterCamera();await flush();assert.deepEqual(h.calls,['privacy','scope.camera','scope.record','navigate']);
 assert.equal(p.data.entering,true);h.nav.success({});await first;assert.equal(p.data.entering,false);
 assert.ok(h.events.some(x=>x.e==='permissions.ready'&&typeof x.d.durationMs==='number'));
});
test('missing grants are requested in order with a long-wait hint',async()=>{
 const h=harness(false);let camera;h.wx.authorize=o=>{h.calls.push(o.scope);if(o.scope==='scope.camera')camera=o;else o.success({});};
 const run=h.page.enterCamera();await flush();assert.equal(h.page.data.entryLabel,'请允许相机权限');
 h.waitHint();assert.match(h.page.data.entryHint,/仍在等待/);camera.success({});await flush();
 assert.deepEqual(h.calls,['privacy','scope.camera','scope.record','navigate']);
 h.nav.success({});await run;
});
test('permission failure clears loading and does not navigate',async()=>{
 const h=harness(false);h.wx.authorize=o=>o.fail({errMsg:'denied'});await h.page.enterCamera();
 assert.equal(h.page.data.entering,false);assert.equal(h.nav,undefined);assert.equal(h.modal.title,'拍摄授权未完成');
});
test('navigation failure is explained separately from permission denial',async()=>{
 const h=harness();const run=h.page.enterCamera();await flush();h.nav.fail({errMsg:'route failed'});await run;
 assert.equal(h.modal.title,'暂时无法进入拍摄');assert.equal(h.page.data.entering,false);
});
