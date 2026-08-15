import { app } from 'electron'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig } from './config.js'
import { logger } from './logger.js'

// electron-updater 是 CommonJS 包，在 ESM 工程里用 createRequire 取命名导出最稳
const require = createRequire(import.meta.url)
const { autoUpdater } = require('electron-updater') as { autoUpdater: typeof import('electron-updater').autoUpdater }

export interface UpdaterHandlers {
  onChecking?: () => void
  onUpdateAvailable?: (info: { version: string }) => void
  onUpdateNotAvailable?: () => void
  onDownloaded?: (info: { version: string }) => void
  onError?: (err: Error) => void
}

/** 手动检查更新的结果，回传给设置窗口做用户可见的反馈。 */
export interface UpdateCheckOutcome {
  ok: boolean
  message: string
}

/**
 * 解析更新源：优先使用设置页配置的 config.updateFeedUrl（generic 静态源，
 * 可指向任意托管 latest.yml + 安装包的目录），否则使用打包期生成的
 * resources/app-update.yml。
 *
 * 【踩坑记录】不能用 autoUpdater.getFeedURL() 判断：
 * electron-updater 6.x 起该方法已废弃，无论是否配置更新源，都固定返回字符串
 * "Deprecated. Do not use it."（恒为真），用它做门禁等于没有门禁。
 * electron-updater 真正读取的是打包期生成的 resources/app-update.yml，
 * 因此以该文件是否存在作为兜底判据。
 */
function resolveUpdateFeed(): boolean {
  try {
    const cfg = loadConfig()
    const custom =
      cfg.updateFeedUrl && typeof cfg.updateFeedUrl === 'string' ? cfg.updateFeedUrl.trim() : ''
    if (custom) {
      autoUpdater.setFeedURL({ provider: 'generic', url: custom.replace(/\/+$/, '') })
      logger.info(`应用更新源（自定义）: ${custom}`)
      return true
    }
    if (!app.isPackaged) return false
    return existsSync(join(process.resourcesPath, 'app-update.yml'))
  } catch (e) {
    logger.warn(`解析更新源失败，按未配置处理: ${String(e)}`)
    return false
  }
}

/**
 * 初始化自动更新。
 *
 * 【为什么默认不在启动时自动检查】
 * electron-builder.yml 配了 publish(github) 用于 CI 发版，打包时会生成 app-update.yml，
 * 但该仓库尚未发布任何 Release。启动即检查的后果是每次都拿到 404 / ERR_CONNECTION_RESET
 * （国内还常被重置），既刷错误日志又白等一次网络超时。
 * 因此自动检查改为「显式开启」：config.autoUpdateCheck = true 时才在启动时检查；
 * 默认关闭，用户仍可在设置窗口手动点「检查应用更新」。
 * 等 Release 真正上线后，把 config 默认值改 true 即可恢复自动检查。
 */
export function setupUpdater(h: UpdaterHandlers): void {
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => h.onChecking?.())
  autoUpdater.on('update-available', (info) => h.onUpdateAvailable?.({ version: info.version }))
  autoUpdater.on('update-not-available', () => h.onUpdateNotAvailable?.())
  autoUpdater.on('update-downloaded', (info) => h.onDownloaded?.({ version: info.version }))
  autoUpdater.on('error', (err) => h.onError?.(err))

  if (!resolveUpdateFeed()) {
    logger.info('未配置应用更新源（无 app-update.yml 且未设置自定义源），跳过自动检查')
    return
  }
  if (!loadConfig().autoUpdateCheck) {
    logger.info('启动时自动更新检查已关闭（config.autoUpdateCheck=false），可在设置中开启')
    return
  }
  autoUpdater.checkForUpdates().catch((e) => logger.info(`启动时更新检查未完成: ${String(e)}`))
}

/**
 * 手动触发更新检查，并返回可直接展示给用户的结论。
 * 返回值会经 IPC(CHECK_APP_UPDATE) 回到设置窗口，避免「点了没反应」。
 */
export async function checkForAppUpdates(): Promise<UpdateCheckOutcome> {
  if (!app.isPackaged) {
    logger.info('开发环境下不检查应用更新')
    return { ok: false, message: '开发环境不检查应用更新' }
  }
  if (!resolveUpdateFeed()) {
    logger.info('未配置应用更新源，无法检查更新')
    return { ok: false, message: '未配置更新源（设置页「应用更新」可填写自定义更新源）' }
  }
  try {
    const r = await autoUpdater.checkForUpdates()
    const latest = r?.updateInfo?.version
    const current = app.getVersion()
    if (!latest || latest === current) return { ok: true, message: `已是最新版本（v${current}）` }
    return { ok: true, message: `发现新版本 v${latest}，正在后台下载…` }
  } catch (e) {
    const msg = String(e).replace(/^Error:\s*/, '')
    const hint = msg.includes('404') ? '（更新源暂无可用的发布版本，请关注后续发布）' : ''
    logger.info(`检查更新失败: ${msg}`)
    return { ok: false, message: `检查更新失败：${msg}${hint}` }
  }
}

/** 退出并安装已下载的更新。 */
export function quitAndInstall(): void {
  autoUpdater.quitAndInstall()
}
