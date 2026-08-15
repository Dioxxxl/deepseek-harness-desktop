import { app } from 'electron'

/**
 * 单实例锁：避免多开导致多个 dsh 服务抢 3080 端口。
 * 返回 true 表示当前是主实例；第二个实例启动时会回调 onSecondInstance（用于聚焦窗口）。
 */
export function setupSingleInstance(onSecondInstance: () => void): boolean {
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
    return false
  }
  app.on('second-instance', (_event, _argv) => {
    onSecondInstance()
  })
  return true
}
