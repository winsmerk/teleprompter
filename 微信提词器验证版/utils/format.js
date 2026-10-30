const RATIOS = ['1:1', '4:3', '16:9'];
function aspect(ratio, direction) {
  const parts = (RATIOS.includes(ratio) ? ratio : '16:9').split(':').map(Number);
  return direction === 'landscape' ? parts[0] / parts[1] : parts[1] / parts[0];
}
function label(ratio, direction) {
  return direction === 'landscape' || ratio === '1:1' ? ratio : ratio.split(':').reverse().join(':');
}
function layout(width, height, ratio, direction) {
  // 固定横屏页面刚进入时，iOS 可能仍返回上一页的竖屏窗口尺寸。
  // 先按页面方向归一化视口，避免用短边作横屏宽度、把画面推到屏幕下方。
  const short = Math.min(width, height), long = Math.max(width, height);
  width = direction === 'landscape' ? long : short;
  height = direction === 'landscape' ? short : long;
  const r = aspect(ratio, direction);
  const w = Math.min(width, height * r), h = w / r;
  return { viewportWidth:width, viewportHeight:height, stageWidth: Math.round(w), stageHeight: Math.round(h), stageLeft: Math.round((width-w)/2), stageTop: Math.round((height-h)/2) };
}
function crop(width, height, ratio, direction) {
  const r = aspect(ratio, direction);
  const w = Math.min(width, height*r), h = w/r;
  const pair = (RATIOS.includes(ratio) ? ratio : '16:9').split(':').map(Number);
  if (direction !== 'landscape') pair.reverse();
  const unit = Math.max(2, Math.floor(Math.min(w/pair[0],h/pair[1],1280/pair[0],1280/pair[1])/2)*2);
  const outW = pair[0]*unit, outH = pair[1]*unit;
  return { x: (width-w)/2/width, y: (height-h)/2/height, width: w/width, height: h/height, outW, outH };
}
module.exports = { RATIOS, aspect, label, layout, crop };
