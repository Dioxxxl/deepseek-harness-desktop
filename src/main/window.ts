import { BrowserWindow, app } from 'electron'
import { applySecurityHandlers } from './security.js'
import { logger } from './logger.js'
import { resolvePreloadPath } from './preloadPath.js'
import { rel } from './timing.js'

/**
 * 设计原则：双击必须有可见窗口。
 * 早期版本把窗口创建“门控”在 dsh 服务 healthy 之后，一旦后端启动慢或失败，
 * 窗口永不出现 → 表现为“双击无反应”。这里改为：启动即创建窗口并显示“启动中”页，
 * 后端就绪后再切到 dsh WebUI；后端出错则显示错误页（含日志路径与自救指引）。
 */

function logDir(): string {
  try {
    return `${app.getPath('userData')}/logs`
  } catch {
    return '(应用数据目录)/logs'
  }
}

const BOOT_HTML =
  'data:text/html;charset=utf-8,' +
  encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;height:100%;background:#0f1115;color:#e6e6e6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
  .wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px}
  .logo{width:54px;height:54px;border-radius:14px;background:linear-gradient(135deg,#3b82f6,#22d3ee);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:22px;color:#0f1115}
  .t{font-size:18px;font-weight:600}
  .s{font-size:13px;color:#9aa4b2;max-width:420px;text-align:center;line-height:1.6}
  .spin{width:26px;height:26px;border:3px solid #2a2f3a;border-top-color:#3b82f6;border-radius:50%}
</style></head><body><div class="wrap">
  <div class="logo">DS</div>
  <div class="t">正在启动 DeepSeek Harness</div>
  <div class="spin"></div>
  <div class="s">正在拉起 Harness 内核服务（首次约需 10–30 秒）…<br>若长时间无响应，请右键系统托盘 → “重置 Harness 数据”后重试。</div>
</div></body></html>`)

function errorHtml(detail: string): string {
  const safe = (detail || '未知错误').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!))
  return (
    'data:text/html;charset=utf-8,' +
    encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;height:100%;background:#0f1115;color:#e6e6e6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
  .wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:32px;box-sizing:border-box}
  .b{font-size:18px;font-weight:600;color:#ff6b6b}
  .d{font-size:13px;color:#cbd5e1;max-width:560px;white-space:pre-wrap;word-break:break-word;background:#1a1f29;padding:14px;border-radius:10px;line-height:1.6}
  .h{font-size:13px;color:#9aa4b2;max-width:560px;line-height:1.6}
  .k{font-weight:600;color:#e6e6e6}
</style></head><body><div class="wrap">
  <div class="b">Harness 服务未能启动</div>
  <div class="d">${safe}</div>
  <div class="h">可尝试：<span class="k">右键系统托盘 → 重置 Harness 数据</span>，或完全退出后重新双击启动。<br>诊断日志位于：<span class="k">${logDir()}</span></div>
</div></body></html>`)
  )
}

export interface MainWindowOptions {
  port: number
  host: string
}

export function createMainWindow(opts: MainWindowOptions): BrowserWindow {
  const preloadPath = resolvePreloadPath()
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: true,
    title: 'DeepSeek Harness',
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 托盘常驻应用：窗口隐藏/后台时不被节流，避免恢复时重绘闪烁
      backgroundThrottling: false
    }
  })

  applySecurityHandlers(win, opts.host)
  // 立即显示启动页，保证双击必有可见窗口
  win.loadURL(BOOT_HTML).catch((e) => logger.error(`加载启动页失败: ${String(e)}`))
  logger.info('主窗口已创建（启动页）')
  return win
}

/** 切到 dsh WebUI。 */
export function showDsh(win: BrowserWindow, host: string, port: number): void {
  const url = `http://${host}:${port}`
  logger.info(`[timing] +${rel()}s showDsh: 加载 dsh WebUI ${url}`)
  win.loadURL(url).catch((e) => logger.error(`加载 ${url} 失败: ${String(e)}`))
}

/** 重新显示启动页。 */
export function showBoot(win: BrowserWindow): void {
  logger.info(`[timing] +${rel()}s showBoot: 显示启动页`)
  win.loadURL(BOOT_HTML).catch((e) => logger.error(`加载启动页失败: ${String(e)}`))
}

/** 显示错误页。 */
export function showError(win: BrowserWindow, detail: string): void {
  logger.error(`[timing] +${rel()}s showError: ${detail}`)
  win.loadURL(errorHtml(detail)).catch((e) => logger.error(`加载错误页失败: ${String(e)}`))
}
