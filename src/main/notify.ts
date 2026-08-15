import { globalShortcut, Notification, app } from 'electron'
import { logger } from './logger.js'

const SHORTCUT = 'CommandOrControl+Shift+D'

/** 注册全局快捷键：切换主窗口显隐。 */
export function registerGlobalShortcut(toggle: () => void): void {
  try {
    const ok = globalShortcut.register(SHORTCUT, toggle)
    if (!ok) logger.warn(`全局快捷键 ${SHORTCUT} 注册失败（可能被占用）`)
  } catch (e) {
    logger.warn(`注册全局快捷键出错: ${String(e)}`)
  }
  app.on('will-quit', () => globalShortcut.unregisterAll())
}

/** 发送系统通知（任务完成/更新提示等）。 */
export function notify(title: string, body: string): void {
  if (!Notification.isSupported()) return
  try {
    new Notification({ title, body }).show()
  } catch (e) {
    logger.warn(`发送通知失败: ${String(e)}`)
  }
}
