const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
function fit(rect,bounds,fontSize){
 const minW=Math.min(bounds.width,Math.max(140,fontSize*4+16));
 const minH=Math.min(bounds.height,16+fontSize*1.7);
 const width=clamp(rect.width,minW,bounds.width),height=clamp(rect.height,minH,bounds.height);
 return {left:clamp(rect.left,bounds.left,bounds.left+bounds.width-width),top:clamp(rect.top,bounds.top,bounds.top+bounds.height-height),width,height};
}
function rows(height,fontSize){return Math.max(1,Math.floor((height-16+0.001)/(fontSize*1.7)));}
// Native overlays can expose x/y instead of WebView clientX/pageX.
function point(event){
 const lists=[event.touches,event.changedTouches,event.detail && event.detail.touches];
 for(const list of lists){
  const t=list && list[0];if(!t)continue;
  for(const pair of [['clientX','clientY'],['pageX','pageY'],['x','y']]){
   if(typeof t[pair[0]]==='number' && typeof t[pair[1]]==='number' && Number.isFinite(t[pair[0]]) && Number.isFinite(t[pair[1]]))return {x:t[pair[0]],y:t[pair[1]],kind:pair[0]};
  }
 }
 return null;
}
function hit(rect,p,edge=20){
 if(p.x<rect.left-edge/2 || p.y<rect.top-edge/2 || p.x>rect.left+rect.width+edge/2 || p.y>rect.top+rect.height+edge/2)return null;
 const horizontal=p.x-rect.left<=edge?'left':rect.left+rect.width-p.x<=edge?'right':'';
 const vertical=p.y-rect.top<=edge?'top':rect.top+rect.height-p.y<=edge?'bottom':'';
 return [horizontal,vertical].filter(Boolean).join('-') || 'move';
}
function transform(rect,mode,dx,dy,bounds,fontSize){
 if(mode==='move')return fit({...rect,left:rect.left+dx,top:rect.top+dy},bounds,fontSize);
 const minW=Math.min(bounds.width,Math.max(140,fontSize*4+16)), minH=Math.min(bounds.height,16+fontSize*1.7);
 let left=rect.left,right=rect.left+rect.width,top=rect.top,bottom=rect.top+rect.height;
 if(mode.includes('left'))left=clamp(left+dx,bounds.left,right-minW);
 if(mode.includes('right'))right=clamp(right+dx,left+minW,bounds.left+bounds.width);
 if(mode.includes('top'))top=clamp(top+dy,bounds.top,bottom-minH);
 if(mode.includes('bottom'))bottom=clamp(bottom+dy,top+minH,bounds.top+bounds.height);
 return {left,top,width:right-left,height:bottom-top};
}
module.exports={fit,rows,point,hit,transform};
