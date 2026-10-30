const { crop, aspect } = require('./format');
const info = path => new Promise((resolve, reject) => wx.getVideoInfo({ src: path, success: resolve, fail: reject }));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
// MediaContainer 的两个异步方法通过 success/fail 返回结果，原生调用返回 undefined。
function containerCall(container, method, options, name) {
  return bounded(new Promise((resolve, reject) => {
    container[method]({ ...options, success: resolve, fail: e => reject(Error(name + '失败：' + (e.errMsg || '未知错误'))) });
  }), name);
}
function bounded(promise, name) {
  let timer;
  return Promise.race([Promise.resolve(promise), new Promise((_, reject) => { timer = setTimeout(() => reject(Error(name + '超时，请重试')), 30000); })]).finally(() => clearTimeout(timer));
}
function pixelsOf(frame) {
  const view = ArrayBuffer.isView(frame.data) ? new Uint8Array(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength) : new Uint8Array(frame.data);
  if (view.byteLength !== frame.width * frame.height * 4) throw Error('解码像素长度异常：' + view.byteLength + '，原片仍保留');
  return view;
}
function brightness(frame) {
  const bytes = pixelsOf(frame);
  let total = 0, count = 0;
  for (let y=1;y<8;y++) for (let x=1;x<8;x++) {
    const i=(Math.min(frame.height-1, Math.floor(frame.height*y/8))*frame.width+Math.min(frame.width-1,Math.floor(frame.width*x/8)))*4;
    total += (bytes[i]+bytes[i+1]+bytes[i+2])/3; count++;
  }
  return Math.round(total/count);
}
async function verifyPicture(path, fps, expectedBright, check, diagnostic) {
  const decoder = wx.createVideoDecoder();
  let ended = false, count = 0, bright = 0, idle = Date.now();
  decoder.on('ended', () => { ended = true; });
  try {
    await bounded(decoder.start({source:path,mode:1,abortAudio:true}), '验证成片画面');
    while (count < Math.min(30, Math.max(4,fps))) {
      check();
      const frame = decoder.getFrameData();
      if (!frame) { if (ended) break; if (Date.now()-idle>15000) throw Error('成片画面验证超时'); await delay(10); continue; }
      const mean = brightness(frame);
      if (mean>6) bright++;
      if (count<3) diagnostic('verify.frame',{index:count,mean,width:frame.width,height:frame.height});
      count++; idle=Date.now();
    }
    diagnostic('verify.summary',{frames:count,brightFrames:bright,renderBrightFrames:expectedBright});
    if (!count || (expectedBright>=3 && bright<=1 && count>=3)) throw Error('检测到编码后连续黑帧，已阻止保存错误成片；原片仍保留');
    return {frames:count,brightFrames:bright};
  } finally { try { await decoder.remove(); } catch (_) {} }
}
function renderer(canvas) {
  const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, alpha: false });
  if (!gl) throw Error('当前微信不支持视频裁剪所需的 WebGL');
  const shader = (type, source) => {
    const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
    return s;
  };
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, 'attribute vec2 p;attribute vec2 uv;varying vec2 v;void main(){gl_Position=vec4(p,0.,1.);v=uv;}'));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, 'precision mediump float;varying vec2 v;uniform sampler2D tex;void main(){gl_FragColor=texture2D(tex,v);}'));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error('视频绘制初始化失败');
  gl.useProgram(program);
  const buffers = {};
  const buffer = (name, values) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers[name] || (buffers[name] = gl.createBuffer())); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, name); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  };
  const texture = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.uniform1i(gl.getUniformLocation(program, 'tex'), 0);
  return (frame, rect, rotation, sample) => {
    if (gl.isContextLost()) throw Error('视频绘制上下文已丢失');
    // 编码器可触碰 WebGL 状态。每帧重新绑定目标、程序、纹理与两个顶点属性。
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(gl.getUniformLocation(program, 'tex'), 0);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.CULL_FACE);
    gl.colorMask(true,true,true,true);
    buffer('p', [-1,1, 1,1, -1,-1, 1,-1]);
    const coords = [rect.x,rect.y, rect.x+rect.width,rect.y, rect.x,rect.y+rect.height, rect.x+rect.width,rect.y+rect.height];
    for (let i=0;i<coords.length;i+=2) {
      const x=coords[i], y=coords[i+1];
      if (rotation === 'right') { coords[i]=y; coords[i+1]=1-x; }
      if (rotation === 'left') { coords[i]=1-y; coords[i+1]=x; }
      if (rotation === 'down') { coords[i]=1-x; coords[i+1]=1-y; }
    }
    buffer('uv', coords);
    gl.viewport(0,0,canvas.width,canvas.height);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
    gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,frame.width,frame.height,0,gl.RGBA,gl.UNSIGNED_BYTE,frame.data);
    const uploadError = gl.getError();
    if (uploadError !== gl.NO_ERROR) throw Error('视频像素上传失败，WebGL ' + uploadError);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4); gl.finish();
    const drawError = gl.getError();
    if (drawError !== gl.NO_ERROR) throw Error('视频绘制失败，WebGL ' + drawError);
    if (!sample) return null;
    let sum=0;
    const pixel=new Uint8Array(4);
    for(let y=1;y<4;y++) for(let x=1;x<4;x++) {
      gl.readPixels(Math.floor(canvas.width*x/4),Math.floor(canvas.height*y/4),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
      sum+=(pixel[0]+pixel[1]+pixel[2])/3;
    }
    if(gl.getError()!==gl.NO_ERROR) throw Error('无法验证绘制画面');
    return Math.round(sum/9);
  };
}
// 只在本机转换：解码原视频 -> WebGL 居中裁剪 -> 逐帧编码 -> 合回原音轨。
async function exportVideo(source, ratio, direction, progress, cancelled, diagnostic = () => {}) {
  const original = await info(source);
  diagnostic('source',{width:original.width,height:original.height,duration:original.duration,fps:original.fps,orientation:original.orientation});
  const target = aspect(ratio, direction);
  const rotated = /^(left|right)/.test(original.orientation || '');
  const sourceRatio = rotated ? original.height/original.width : original.width/original.height;
  if (Math.abs(sourceRatio-target) < 0.004 && !rotated) {
    diagnostic('passthrough',{reason:'source-ratio-matches'});
    // 该分支不经过编码器，单独记录原片采样，区分拍摄黑帧与转码黑帧。
    if(wx.createVideoDecoder) await verifyPicture(source, 4, 0, () => { if(cancelled && cancelled()) throw Error('处理已中断'); }, (event,detail)=>diagnostic('source.'+event,detail));
    return { path: source, info: original };
  }
  for (const api of ['createVideoDecoder','createOffscreenCanvas','createMediaRecorder','createMediaContainer']) {
    if (!wx[api]) throw Error('请更新微信后使用此比例');
  }
  let decoder, recorder, container;
  const check = () => { if (cancelled && cancelled()) throw Error('处理已中断，请回到页面后重试'); };
  try {
    decoder = wx.createVideoDecoder();
    let ended = false;
    decoder.on('ended', () => { ended = true; });
    await bounded(decoder.start({ source, mode: 1, abortAudio: true }), '启动解码');
    check();
    let first, lastData = Date.now();
    while (!(first = decoder.getFrameData())) {
      check(); if (ended || Date.now()-lastData > 15000) throw Error('无法解码视频首帧'); await delay(16);
    }
    const rotation = rotated && (first.width > first.height) !== (sourceRatio > 1) ? original.orientation.split('-')[0] : (original.orientation === 'down' ? 'down' : 'up');
    const swap = rotation === 'left' || rotation === 'right';
    const rect = crop(swap ? first.height : first.width, swap ? first.width : first.height, ratio, direction);
    const canvas = wx.createOffscreenCanvas({ type: 'webgl', width: rect.outW, height: rect.outH });
    const draw = renderer(canvas);
    const fps = Math.max(1, Math.min(60, Math.round(original.fps || 30)));
    recorder = wx.createMediaRecorder(canvas, { width: rect.outW, height: rect.outH, fps, videoBitsPerSecond: 2500, gop: fps });
    const stopped = new Promise(resolve => recorder.on('stop', resolve));
    await bounded(recorder.start(), '启动编码');
    let count = 0, current = first, renderBright = 0;
    lastData = Date.now();
    while (true) {
      check();
      if (current) {
        // 在异步编码回调之前持有一份自有像素，避免解码器复用底层缓冲区。
        const owned = { width:current.width, height:current.height, data:new Uint8Array(pixelsOf(current)) };
        const sample = count<30 || count%fps===0;
        const inputMean = sample ? brightness(owned) : null;
        let renderedMean = null;
        await bounded(recorder.requestFrame(() => { renderedMean = draw(owned, rect, rotation, sample); }), '处理视频帧');
        if(count<30 && renderedMean>6) renderBright++;
        if(count<3 || count%60===0) diagnostic('frame',{index:count,pts:current.pkPts,bytes:owned.data.byteLength,inputMean,renderedMean});
        count++; lastData = Date.now();
        if (count % fps === 0) progress(Math.min(95, Math.round(count/fps/original.duration*90)));
      } else {
        if (ended) break;
        if (Date.now()-lastData > 15000) throw Error('视频解码超时，原片仍保留');
        await delay(10);
      }
      current = decoder.getFrameData();
      if (count > (original.duration + 3)*fps*2) throw Error('视频帧数异常');
    }
    await bounded(recorder.stop(), '结束编码');
    const encoded = await bounded(stopped, '取得编码文件');
    if (!encoded.tempFilePath || !count) throw Error('视频编码未生成文件');
    diagnostic('encoded',{frames:count,fps,width:rect.outW,height:rect.outH,renderBrightFrames:renderBright});
    await verifyPicture(encoded.tempFilePath, fps, renderBright, check, diagnostic);
    check(); progress(96);
    container = wx.createMediaContainer();
    const rawTracks = await containerCall(container, 'extractDataSource', { source }, '读取原音轨');
    const newTracks = await containerCall(container, 'extractDataSource', { source: encoded.tempFilePath }, '读取裁剪画面');
    if (!rawTracks || !Array.isArray(rawTracks.tracks) || !newTracks || !Array.isArray(newTracks.tracks)) throw Error('微信没有返回有效音视频轨道，原片仍保留');
    const audio = rawTracks.tracks.filter(t => t.kind === 'audio');
    const video = newTracks.tracks.find(t => t.kind === 'video');
    if (!video || !audio.length) throw Error('未取得视频或声音轨道，原片仍保留');
    container.addTrack(video); audio.forEach(t => container.addTrack(t));
    const merged = await containerCall(container, 'export', {}, '合成成片');
    const path = merged.tempFilePath;
    if (!path) throw Error('视频合成失败，原片仍保留');
    const result = await info(path);
    if (Math.abs(result.width/result.height-target) > 0.01 || Math.abs(result.duration-original.duration) > Math.max(0.5, original.duration*0.02)) throw Error('成片比例或时长校验未通过，原片仍保留');
    check(); progress(100);
    return { path, info: result };
  } finally {
    if (decoder) { try { await decoder.remove(); } catch (_) {} }
    if (recorder) { try { await recorder.destroy(); } catch (_) {} }
    if (container) container.destroy();
  }
}
module.exports = { exportVideo };
