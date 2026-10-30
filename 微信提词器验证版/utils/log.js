const KEY = 'diagnostics-v1';
function log(event, detail) {
  const row = { time: new Date().toISOString(), event, detail: detail || {} };
  console.info('[随行提词]', row);
  try { const rows = wx.getStorageSync(KEY) || []; rows.push(row); wx.setStorageSync(KEY, rows.slice(-180)); } catch (_) {}
}
function exportLogs() {
  const info = wx.getDeviceInfo ? wx.getDeviceInfo() : {};
  const data = { version: '1.1.0', device: { model: info.model, system: info.system, platform: info.platform }, events: wx.getStorageSync(KEY) || [] };
  wx.setClipboardData({ data: JSON.stringify(data, null, 2) });
}
module.exports = { log, exportLogs };
