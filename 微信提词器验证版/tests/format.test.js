const test = require('node:test');
const assert = require('node:assert/strict');
const { aspect, crop, layout, label } = require('../utils/format');
for (const direction of ['portrait','landscape']) for (const ratio of ['1:1','4:3','16:9']) {
  test(direction + ' ' + ratio + ': crop stays inside source and output keeps selected aspect', () => {
    for (const [width,height] of [[1920,1080],[1080,1920],[1280,720]]) {
      const r = crop(width,height,ratio,direction);
      assert.ok(r.x >= 0 && r.y >= 0 && r.x+r.width <= 1.00001 && r.y+r.height <= 1.00001);
      assert.equal(r.outW % 2,0); assert.equal(r.outH % 2,0);
      assert.ok(Math.abs(r.outW/r.outH-aspect(ratio,direction)) < 0.004);
      assert.ok(Math.max(r.outW,r.outH) <= 1280);
    }
    const box = layout(direction === 'portrait' ? 390 : 844,direction === 'portrait' ? 844 : 390,ratio,direction);
    assert.ok(Math.abs(box.stageWidth/box.stageHeight-aspect(ratio,direction)) < 0.005);
    assert.ok(box.stageLeft >= 0 && box.stageTop >= 0);
  });
}
test('portrait uses short:long labels, 9:16 is much taller than old half-screen', () => {
  assert.equal(label('16:9','portrait'),'9:16'); assert.equal(label('4:3','portrait'),'3:4');
  assert.ok(layout(390,844,'16:9','portrait').stageHeight > 690);
});
test('iPhone entering landscape with stale portrait dimensions keeps full stage on screen', () => {
  for(const ratio of ['1:1','4:3','16:9']) {
    const stale=layout(393,852,ratio,'landscape');
    const settled=layout(852,393,ratio,'landscape');
    assert.deepEqual(stale,settled);
    assert.equal(stale.viewportWidth,852); assert.equal(stale.viewportHeight,393);
    assert.equal(stale.stageTop,0);
    assert.equal(stale.stageHeight,393);
    assert.ok(stale.stageLeft + stale.stageWidth <=852);
  }
});
test('returning to portrait after landscape cannot retain landscape viewport dimensions', () => {
  assert.deepEqual(layout(852,393,'16:9','portrait'),layout(393,852,'16:9','portrait'));
});
