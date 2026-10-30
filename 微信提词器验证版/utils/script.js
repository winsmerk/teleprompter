// 按估计字宽换行，覆盖层仅保留可见行，避免长稿每帧跨桥传输。
function wrap(text, width, fontSize) {
  const limit = Math.max(4, width / fontSize);
  const lines = [];
  String(text).replace(/\r/g, '').split('\n').forEach(paragraph => {
    let row = '', units = 0;
    for (const char of paragraph) {
      const unit = /[\x00-\xff]/.test(char) ? 0.62 : 1;
      if (units + unit > limit && row) { lines.push(row); row = ''; units = 0; }
      row += char; units += unit;
    }
    lines.push(row);
  });
  return lines;
}
function frame(lines, offset, lineHeight, visibleRows = 4) {
  const end = Math.max(0, (lines.length - 1) * lineHeight);
  const position = Math.min(Math.max(0, offset), end);
  const index = Math.floor(position / lineHeight);
  return { rows: lines.slice(index, index + Math.max(1,visibleRows) + 1).map((text, id) => ({ id, text })), shift: Math.round(position % lineHeight), done: position >= end };
}
module.exports = { wrap, frame };
