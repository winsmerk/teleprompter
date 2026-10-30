const test=require('node:test'), assert=require('node:assert/strict');
const {fit,rows}=require('../utils/prompt-window');
const {frame,wrap}=require('../utils/script');
test('drag and resize remain in bounds for six capture formats',()=>{
 const {layout}=require('../utils/format');
 for(const d of ['portrait','landscape'])for(const r of ['1:1','4:3','16:9']){
  const b=layout(393,852,r,d),bounds={left:8,top:8,width:b.stageWidth-16,height:b.stageHeight-16};
  for(const rect of [{left:-500,top:-500,width:40,height:10},{left:999,top:999,width:999,height:999}]){
   const w=fit(rect,bounds,28);assert.ok(w.left>=8&&w.top>=8);assert.ok(w.left+w.width<=b.stageWidth-8);assert.ok(w.top+w.height<=b.stageHeight-8);
  }
 }
});
test('window height determines row count and renderer includes the extra scrolling row',()=>{
 for(const n of [1,2,5,9]){
  const height=16+n*28*1.7;
  assert.equal(rows(height,28),n);
  assert.equal(frame(Array(30).fill('稿'),0,47.6,n).rows.length,n+1);
 }
});
test('narrower windows rewrap text without changing its contents',()=>{
 const text='这是一段用于调整窗口宽度的提词内容。';
 const wide=wrap(text,300,28),narrow=wrap(text,150,28);
 assert.ok(narrow.length>wide.length);assert.equal(narrow.join(''),text);
});
test('native x/y and web coordinates normalize including zero and changedTouches',()=>{
 const {point}=require('../utils/prompt-window');
 assert.deepEqual(point({touches:[{x:0,y:20}]}),{x:0,y:20,kind:'x'});
 assert.deepEqual(point({touches:[{pageX:12,pageY:30}]}),{x:12,y:30,kind:'pageX'});
 assert.deepEqual(point({changedTouches:[{clientX:40,clientY:50}]}),{x:40,y:50,kind:'clientX'});
 assert.equal(point({touches:[{x:NaN,y:2}]}),null);
});
test('border hit testing distinguishes edges, corners, interior and outside',()=>{
 const {hit}=require('../utils/prompt-window'),r={left:40,top:80,width:240,height:160};
 for(const [x,y,mode] of [[40,150,'left'],[280,150,'right'],[150,80,'top'],[150,240,'bottom'],[40,80,'left-top'],[280,240,'right-bottom'],[150,150,'move'],[0,0,null]])assert.equal(hit(r,{x,y}),mode);
});
test('edge resizing anchors the opposite edge and preserves unaffected dimension',()=>{
 const {transform}=require('../utils/prompt-window'),r={left:80,top:80,width:200,height:120},b={left:0,top:0,width:400,height:400};
 const left=transform(r,'left',-30,99,b,22);assert.equal(left.left,50);assert.equal(left.width,230);assert.equal(left.height,120);assert.equal(left.top,80);
 const top=transform(r,'top',99,-25,b,22);assert.equal(top.top,55);assert.equal(top.height,145);assert.equal(top.left,80);assert.equal(top.width,200);
 const right=transform(r,'right',500,0,b,22);assert.equal(right.left+right.width,400);
 const bottom=transform(r,'bottom',0,-500,b,22);assert.ok(bottom.height>=16+22*1.7);assert.equal(bottom.top,80);
});
