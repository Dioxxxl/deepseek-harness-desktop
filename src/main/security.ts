import { BrowserWindow, shell } from 'electron'
import { resolvePreloadPath } from './preloadPath.js'

/**
 * 判断是否允许加载。允许两类：
 * 1) 应用自带的本地 scheme：data:/about:/blob:/file:（设置窗口用 data: 加载内联 HTML，必须放行）；
 * 2) 本机回环地址 127.0.0.1 / localhost（dsh WebUI）。
 * 其余一律拒绝，避免本地服务被利用发起外跳。
 */
export function isLocalUrl(url: string, allowedHost = '127.0.0.1'): boolean {
  try {
    const u = new URL(url)
    if (u.protocol === 'data:' || u.protocol === 'about:' || u.protocol === 'blob:' || u.protocol === 'file:') {
      return true
    }
    return u.hostname === allowedHost || u.hostname === 'localhost'
  } catch {
    return false
  }
}

/**
 * 安全加固：
 * 1) will-navigate 守卫：只允许本机同源导航，外部链接改用系统浏览器打开。
 * 2) 弹窗拦截：同源在新窗口打开时改在主窗口内加载；外部一律拒绝。
 * 3) 注入 CSP：仅允许同源、localhost 的 ws/wss 与 data/blob，降低被 XSS 提权风险。
 */
export function applySecurityHandlers(win: BrowserWindow, allowedHost = '127.0.0.1'): void {
  const wc = win.webContents

  wc.on('will-navigate', (event, url) => {
    if (!isLocalUrl(url, allowedHost)) {
      event.preventDefault()
      shell.openExternal(url).catch(() => {})
    }
  })

  wc.setWindowOpenHandler(({ url }) => {
    if (isLocalUrl(url, allowedHost)) {
      // 同源：在独立子窗口中打开，绝不在主窗口内 loadURL（那会整窗重载 / 闪烁）
      const child = new BrowserWindow({
        parent: win,
        show: true,
        backgroundColor: '#0f1115',
        webPreferences: {
          preload: resolvePreloadPath(),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false
        }
      })
      applySecurityHandlers(child, allowedHost)
      child.loadURL(url)
      return { action: 'deny' }
    }
    // 外部：拒绝在应用内打开，转系统浏览器
    shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })

  // 仅在服务端未自带 CSP 时补充，避免覆盖官方策略
  wc.session.webRequest.onHeadersReceived((details, callback) => {
    const hdrs = details.responseHeaders || {}
    const hasCsp = Object.keys(hdrs).some((k) => k.toLowerCase() === 'content-security-policy')
    if (!hasCsp) {
      hdrs['Content-Security-Policy'] = [
        "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:;" +
          ` connect-src 'self' ws://${allowedHost}:* wss://${allowedHost}:* http://${allowedHost}:* https://api.deepseek.com;` +
          " img-src 'self' data: blob: http://127.0.0.1:* https://*;" +
          " font-src 'self' data:;"
      ]
    }
    callback({ responseHeaders: hdrs, cancel: false })
  })
}
