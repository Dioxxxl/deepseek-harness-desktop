import { app } from 'electron'

const APP_NAME = 'DeepSeek Harness Desktop'

/** Windows 开机自启；与设置项联动。 */
export function setAutoStart(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
    args: ['--hidden']
  })
}

export function applyAutoStartFromConfig(enabled: boolean): void {
  try {
    setAutoStart(enabled)
  } catch (e) {
    console.warn(`设置开机自启失败: ${String(e)}`)
  }
}

export { APP_NAME }
