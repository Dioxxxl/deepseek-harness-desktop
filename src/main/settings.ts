import { BrowserWindow } from 'electron'
import { resolvePreloadPath } from './preloadPath.js'

let settingsWin: BrowserWindow | null = null

const HTML = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1115;color:#e6e6e6;margin:0;padding:22px;font-size:14px}
  h1{font-size:18px;margin:0 0 4px}
  .sub{color:#8a90a0;font-size:12px;margin-bottom:18px}
  .card{background:#171a21;border:1px solid #262b36;border-radius:10px;padding:14px 16px;margin-bottom:14px}
  label{display:block;font-weight:600;margin-bottom:6px;color:#c7ccd6}
  select,input[type=text],input[type=password]{width:100%;box-sizing:border-box;background:#0f1115;border:1px solid #2c3340;color:#e6e6e6;border-radius:7px;padding:8px 10px}
  .row{display:flex;gap:8px;margin-top:8px}
  button{background:#2b6cff;color:#fff;border:0;border-radius:7px;padding:8px 12px;cursor:pointer}
  button.ghost{background:#262b36}
  button:hover{filter:brightness(1.1)}
  .status{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600}
  .ok{background:#103d22;color:#5ee08a}.bad{background:#3d1010;color:#ff8a8a}.warn{background:#3d3410;color:#ffd45e}
  .muted{color:#8a90a0;font-size:12px}
  #log{white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#9fb3c8;max-height:150px;overflow:auto;background:#0b0d11;padding:8px;border-radius:7px;margin-top:8px}
  .path{font-family:ui-monospace,monospace;font-size:12px;color:#9fb3c8;word-break:break-all}
</style></head>
<body>
<h1>DeepSeek Harness 设置</h1>
<div class="sub">桌面端配置 · API Key 经系统凭据管理器加密存储</div>

<div class="card">
  <label>服务状态</label>
  <span id="status" class="status warn">检测中…</span>
</div>

<div class="card">
  <label>模型提供商与 API Key</label>
  <select id="provider"></select>
  <div class="row"><input id="apikey" type="password" placeholder="粘贴 API Key，留空表示清除"></div>
  <div class="row">
    <button id="saveKey">保存 Key</button>
    <button id="clearKey" class="ghost">清除 Key</button>
  </div>
  <div class="muted" style="margin-top:6px">已保存：<span id="savedHint">—</span></div>
</div>

<div class="card">
  <label>当前工作目录（Agent 读写范围）</label>
  <div class="path" id="cwd">—</div>
  <div class="row"><button id="pick">选择项目目录…</button></div>
</div>

<div class="card">
  <label>启动</label>
  <div class="row" style="align-items:center">
    <input type="checkbox" id="autostart"><span>Windows 开机自动启动</span>
  </div>
</div>

<div class="card">
  <label>显示与性能</label>
  <div class="row" style="align-items:center">
    <input type="checkbox" id="hwAccel"><span>启用硬件加速（关闭可消除画面闪烁，需重启生效）</span>
  </div>
  <div class="row"><button id="restartApp" class="ghost">重启应用</button></div>
  <div class="muted" style="margin-top:6px">若关闭硬件加速后仍闪烁，则闪烁来源不是 GPU 合成层。</div>
</div>

<div class="card">
  <label>应用更新</label>
  <div class="muted" style="margin-bottom:6px">自定义更新源需包含 latest.yml、安装包与 .blockmap（见工程 scripts/publish-release.cjs）；留空 = 使用打包内置源</div>
  <div class="row"><input id="feedUrl" type="text" placeholder="https://example.com/updates/"></div>
  <div class="row" style="align-items:center">
    <input type="checkbox" id="autoUpdate"><span>启动时自动检查更新</span>
  </div>
  <div class="row">
    <button id="saveFeed" class="ghost">保存更新源</button>
    <button id="appUpdate" class="ghost">检查应用更新</button>
  </div>
</div>

<div class="card">
  <label>维护</label>
  <div class="row">
    <button id="restart" class="ghost">重启服务</button>
    <button id="kernelUpdate" class="ghost">检查内核更新</button>
    <button id="diag" class="ghost">导出诊断</button>
  </div>
  <div id="log"></div>
</div>

<script>
const A = window.electronAPI;
function log(m){ var el=document.getElementById('log'); el.textContent += m + "\\n"; el.scrollTop = el.scrollHeight; }
function setStatus(s){ var el=document.getElementById('status'); el.className='status '+(s==='healthy'||s==='external'?'ok':(s==='unhealthy'?'bad':'warn')); el.textContent=s; }

(async function(){
  // providers
  var providers = A.listProviders();
  var sel = document.getElementById('provider');
  providers.forEach(function(p){ var o=document.createElement('option'); o.value=p.id; o.textContent=p.label; sel.appendChild(o); });

  var cfg = await A.getConfig();
  sel.value = cfg.provider || 'deepseek';
  document.getElementById('cwd').textContent = cfg.cwd || '(默认：用户主目录)';
  document.getElementById('autostart').checked = !!cfg.autostart;
  document.getElementById('hwAccel').checked = cfg.hardwareAcceleration !== false;

  async function refreshSaved(){ var has=await A.hasCredential(sel.value); document.getElementById('savedHint').textContent = has?'已保存':'未保存'; }
  await refreshSaved();
  A.onServerStatus(setStatus);
  setStatus(await A.getServerStatus());

  sel.onchange = async function(){ cfg.provider=sel.value; await A.saveConfig({provider:sel.value}); await refreshSaved(); document.getElementById('apikey').value=''; };

  document.getElementById('saveKey').onclick = async function(){
    var k=document.getElementById('apikey').value.trim();
    if(!k){ log('请先填入 Key'); return; }
    await A.setCredential(sel.value, k); await refreshSaved(); document.getElementById('apikey').value=''; log('Key 已保存（加密）');
  };
  document.getElementById('clearKey').onclick = async function(){ await A.clearCredential(sel.value); await refreshSaved(); log('Key 已清除'); };

  document.getElementById('pick').onclick = async function(){ var p=await A.selectProject(); if(p){ log('已选择：'+p); document.getElementById('cwd').textContent=p; } };

  document.getElementById('autostart').onchange = async function(e){ await A.setAutoStart(e.target.checked); await A.saveConfig({autostart:e.target.checked}); log('开机自启：'+(e.target.checked?'开':'关')); };

  document.getElementById('hwAccel').onchange = async function(e){
    await A.saveConfig({hardwareAcceleration: e.target.checked});
    log('硬件加速：' + (e.target.checked ? '开' : '关') + '（重启后生效）');
  };
  document.getElementById('restartApp').onclick = async function(){ log('正在重启应用…'); try { await A.restartApp(); } catch(err){ log('重启失败：' + err); } };

  document.getElementById('restart').onclick = async function(){ log('重启服务中…'); await A.restartServer(); };
  document.getElementById('feedUrl').value = cfg.updateFeedUrl || '';
  document.getElementById('autoUpdate').checked = !!cfg.autoUpdateCheck;
  document.getElementById('saveFeed').onclick = async function(){
    var v = document.getElementById('feedUrl').value.trim();
    await A.saveConfig({updateFeedUrl: v || undefined});
    log('更新源已保存：' + (v || '内置源'));
  };
  document.getElementById('autoUpdate').onchange = async function(e){
    await A.saveConfig({autoUpdateCheck: e.target.checked});
    log('启动时自动检查更新：' + (e.target.checked ? '开' : '关'));
  };
  document.getElementById('appUpdate').onclick = async function(){
    log('检查应用更新…');
    try { var r = await A.checkAppUpdate(); log(r && r.message ? r.message : '检查已完成'); }
    catch(e){ log('检查更新失败：' + e); }
  };
  document.getElementById('kernelUpdate').onclick = async function(){
    log('检查内核更新…');
    try {
      var r = await A.checkKernelUpdate();
      if (r.error) { log('内核更新检查失败：' + r.error); return; }
      log('当前内核：'+r.current+' / 最新：'+r.latest+(r.updateAvailable?' （可更新）':' （已是最新）'));
    } catch(e){ log('检查内核更新失败：' + e); }
  };
  document.getElementById('diag').onclick = async function(){ log('导出诊断信息…'); await A.exportDiagnostics(); log('已导出'); };
})();
</script>
</body></html>`

export function createSettingsWindow(): BrowserWindow {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show()
    settingsWin.focus()
    return settingsWin
  }
  settingsWin = new BrowserWindow({
    width: 560,
    height: 720,
    title: 'DeepSeek Harness 设置',
    backgroundColor: '#0f1115',
    show: true,
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 托盘常驻应用：窗口隐藏/后台时不被节流，避免恢复时重绘闪烁
      backgroundThrottling: false
    }
  })
  const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(HTML)
  settingsWin.loadURL(dataUrl)
  settingsWin.on('closed', () => {
    settingsWin = null
  })
  return settingsWin
}
