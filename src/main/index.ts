import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { loadConfig, updateConfig } from './config.js'
import { logger } from './logger.js'
import { setupSingleInstance } from './singleton.js'
import { ServerManager } from './server.js'
import { createMainWindow, showDsh, showBoot, showError } from './window.js'
import { TrayManager } from './tray.js'
import { applyAutoStartFromConfig, setAutoStart } from './autostart.js'
import {
  setCredential,
  getCredential,
  hasCredential,
  clearCredential
} from './credentials.js'
import { selectProjectDirectory } from './dialog.js'
import { getRecentProjects, addRecentProject } from './projects.js'
import { createSettingsWindow } from './settings.js'
import { exportDiagnostics } from './diagnostics.js'
import { setupUpdater, checkForAppUpdates, quitAndInstall } from './updater.js'
import { registerGlobalShortcut, notify } from './notify.js'
import { checkKernelUpdate, installKernelUpdate } from './kernel-updater.js'
import { IPC } from '../shared/ipcChannels.js'
import { rel } from './timing.js'

/**
 * 全局兜底：任何未捕获异常 / 未处理拒绝都写日志并弹窗，
 * 避免“双击无反应”这类静默崩溃。Electron 默认对主进程未捕获异常有弹窗，
 * 但某些路径（Promise reject、子模块）会被吞掉，这里显式兜住。
 */
function fatal(title: string, msg: string): void {
  logger.error(`FATAL ${title}: ${msg}`)
  try {
    if (app.isReady()) {
      dialog.showErrorBox(title, `${msg}\n\n日志位于：${app.getPath('userData')}/logs`)
    }
  } catch {
    /* ignore */
  }
}
process.on('uncaughtException', (e) => fatal('DeepSeek Harness 崩溃', String(e?.stack || e)))
process.on('unhandledRejection', (e) => fatal('DeepSeek Harness 未处理异常', String(e)))

let mainWin: BrowserWindow | null = null
let tray: TrayManager
let server: ServerManager
let errorShown = false
let bootTimer: NodeJS.Timeout | undefined
// --hidden：开机自启/静默启动时不创建主窗口（托盘常驻，点击托盘图标唤出）
const startHidden = process.argv.includes('--hidden')

function loadAppropriateUrl(win: BrowserWindow): void {
  // second-instance 事件可能在 bootstrap 完成前触发，此时 server 尚未初始化，
  // 一律先显示启动页，服务就绪后 status 回调会负责切到 dsh WebUI
  if (!server) {
    showBoot(win)
    return
  }
  const st = server.getStatus()
  if (st === 'healthy' || st === 'external') showDsh(win, server.getHost(), server.getPort())
  else showBoot(win)
}

/** 确保主窗口存在并返回（不重复创建）。 */
function ensureWindow(): BrowserWindow {
  if (!mainWin || mainWin.isDestroyed()) {
    const { host, port } = server ? { host: server.getHost(), port: server.getPort() } : loadConfig()
    mainWin = createMainWindow({ port, host })
    loadAppropriateUrl(mainWin)
  }
  return mainWin
}

function toggleWindow(): void {
  if (!mainWin || mainWin.isDestroyed()) {
    ensureWindow()
    return
  }
  if (mainWin.isVisible()) mainWin.hide()
  else {
    mainWin.show()
    mainWin.focus()
  }
}

function broadcastStatus(status: string): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(IPC.SERVER_STATUS, status)
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.GET_CONFIG, () => loadConfig())
  ipcMain.handle(IPC.SAVE_CONFIG, (_e, patch) => updateConfig(patch))
  ipcMain.handle(IPC.GET_CREDENTIAL, (_e, p) => getCredential(p))
  ipcMain.handle(IPC.SET_CREDENTIAL, (_e, p, k) => setCredential(p, k))
  ipcMain.handle(IPC.HAS_CREDENTIAL, (_e, p) => hasCredential(p))
  ipcMain.handle(IPC.CLEAR_CREDENTIAL, (_e, p) => clearCredential(p))

  ipcMain.handle(IPC.SELECT_PROJECT, async () => {
    const p = await selectProjectDirectory()
    if (!p) return null
    addRecentProject(p)
    updateConfig({ cwd: p })
    tray.refreshRecent()
    await server.setCwd(p)
    return p
  })
  ipcMain.handle(IPC.GET_RECENT_PROJECTS, () => getRecentProjects())
  ipcMain.handle(IPC.SWITCH_PROJECT, async (_e, p) => {
    addRecentProject(p)
    updateConfig({ cwd: p })
    tray.refreshRecent()
    await server.setCwd(p)
  })

  ipcMain.handle(IPC.SERVER_RESTART, () => server.restart())
  ipcMain.handle(IPC.SERVER_RESET, () => server.resetAndRestart())
  ipcMain.handle(IPC.SERVER_GET_ERROR, () => server.getLastError())
  ipcMain.handle(IPC.GET_SERVER_STATUS, () => server.getStatus())
  ipcMain.handle(IPC.SET_AUTOSTART, (_e, enabled) => setAutoStart(enabled))
  ipcMain.handle(IPC.EXPORT_DIAGNOSTICS, () => exportDiagnostics())
  ipcMain.handle(IPC.CHECK_APP_UPDATE, () => checkForAppUpdates())
  ipcMain.handle(IPC.APP_RESTART, () => {
    // 硬件加速等启动期开关需整进程重启才能重新评估
    app.relaunch()
    app.quit()
  })
  ipcMain.handle(IPC.CHECK_KERNEL_UPDATE, async () => {
    const check = await checkKernelUpdate()
    if (check.error) return check
    if (check.updateAvailable) {
      // 安装前确认，避免"检查"按钮意外触发下载安装
      const r = await dialog.showMessageBox({
        type: 'question',
        buttons: ['立即更新', '暂不'],
        title: 'Harness 内核更新',
        message: `发现新内核 v${check.latest}（当前 v${check.current}），是否下载安装？`,
        detail: '安装完成后将自动重启 Harness 服务。'
      })
      if (r.response !== 0) return { ...check, skipped: true }
      await installKernelUpdate((line) => logger.info(`[kernel-update] ${line.trim()}`))
      notify('Harness 内核已更新', `已升级到 ${check.latest}，正在重启服务…`)
      await server.restart()
    }
    return check
  })
  ipcMain.on(IPC.NOTIFY, (_e, title, body) => notify(title, body))
  ipcMain.on(IPC.OPEN_SETTINGS, () => createSettingsWindow())
}

async function bootstrap(): Promise<void> {
  logger.info(`[timing] +${rel()}s bootstrap start`)
  const cfg = loadConfig()
  applyAutoStartFromConfig(cfg.autostart)

  server = new ServerManager({ host: cfg.host, port: cfg.port, cwd: cfg.cwd })
  server.on('status', (s: string) => {
    tray.setStatus(s as any)
    broadcastStatus(s)
    // 服务已就绪 → 撤掉 30s 启动超时兜底：否则定时器会白挂到 30s 才空转一次，
    // 并留下 “bootTimer 30s fired, status=healthy” 这行有误导性的日志。
    if ((s === 'healthy' || s === 'external') && bootTimer) {
      clearTimeout(bootTimer)
      bootTimer = undefined
    }
    // 后端就绪后，把已存在的窗口切到 dsh WebUI
    if ((s === 'healthy' || s === 'external') && mainWin && !mainWin.isDestroyed()) {
      logger.info(`[timing] +${rel()}s status=${s} -> showDsh`)
      showDsh(mainWin, server.getHost(), server.getPort())
    }
  })
  // 把 dsh 的真实报错暴露给用户：弹窗说明根因 + 窗口内错误页，避免“无提示谜团”
  server.on('error', (msg: string) => {
    logger.error(`dsh 报错: ${msg}`)
    errorShown = true
    // 服务已报错即撤掉 30s 兜底定时器，避免其继续空转打误导日志
    if (bootTimer) {
      clearTimeout(bootTimer)
      bootTimer = undefined
    }
    if (!mainWin || mainWin.isDestroyed()) mainWin = ensureWindow()
    showError(mainWin, msg)
    dialog
      .showMessageBox({
        type: 'error',
        title: 'DeepSeek Harness 服务异常',
        message: 'dsh 服务启动失败，已尝试自动恢复。',
        detail: `${msg}\n\n常见原因：运行数据（DSH_HOME）状态损坏。可右键托盘 → “重置 Harness 数据”后重试。`,
        buttons: ['知道了']
      })
      .then(() => {
        setTimeout(() => (errorShown = false), 30000)
      })
  })

  tray = new TrayManager({
    toggleWindow,
    restartServer: () => server.restart(),
    selectProject: async () => {
      const p = await selectProjectDirectory()
      if (p) {
        addRecentProject(p)
        updateConfig({ cwd: p })
        tray.refreshRecent()
        await server.setCwd(p)
      }
    },
    switchProject: async (p) => {
      addRecentProject(p)
      updateConfig({ cwd: p })
      tray.refreshRecent()
      await server.setCwd(p)
    },
    openSettings: () => createSettingsWindow(),
    checkKernelUpdate: async () => {
      const r = await checkKernelUpdate()
      if (r.error) {
        notify('内核更新', `检查失败：${r.error}`)
        return
      }
      if (r.updateAvailable) {
        const res = await dialog.showMessageBox({
          type: 'question',
          buttons: ['立即更新', '暂不'],
          title: 'Harness 内核更新',
          message: `发现新内核 v${r.latest}（当前 v${r.current}），是否下载安装？`,
          detail: '安装完成后将自动重启 Harness 服务。'
        })
        if (res.response !== 0) return
        await installKernelUpdate((l) => logger.info(`[kernel-update] ${l.trim()}`))
        notify('Harness 内核已更新', `已升级到 ${r.latest}`)
        await server.restart()
      } else {
        notify('内核更新', `已是最新（${r.current}）`)
      }
    },
    exportDiagnostics,
    resetHarness: () => server.resetAndRestart(),
    quit: () => app.quit(),
    getRecentProjects,
    getServerStatus: () => server.getStatus()
  })

  registerIpc()
  tray.init()
  registerGlobalShortcut(toggleWindow)

  setupUpdater({
    onChecking: () => logger.info('正在检查应用更新…'),
    onUpdateAvailable: (i) => notify('发现新版本', `v${i.version} 下载中…`),
    onUpdateNotAvailable: () => logger.info('已是最新版本'),
    onDownloaded: (i) => {
      notify('更新就绪', `v${i.version} 已下载，重启后生效`)
      dialog
        .showMessageBox({
          type: 'question',
          buttons: ['立即重启', '稍后'],
          title: '更新就绪',
          message: `DeepSeek Harness Desktop v${i.version} 已下载，是否立即重启安装？`
        })
        .then((r: { response: number }) => {
          if (r.response === 0) quitAndInstall()
        })
    },
    onError: (e) => logger.info(`更新检查未完成（若未配置更新源可忽略）: ${String(e)}`)
  })

  app.on('window-all-closed', () => {
    // 托盘常驻应用：关闭窗口不退出
  })
  app.on('before-quit', () => server?.stop())

  if (startHidden) {
    logger.info('--hidden 启动：不创建主窗口（托盘常驻，可点击托盘图标唤出）')
  } else {
    // 启动即创建可见窗口（启动页），保证双击必有反应
    logger.info(`[timing] +${rel()}s before createMainWindow`)
    mainWin = createMainWindow({ port: cfg.port, host: cfg.host })
    logger.info(`[timing] +${rel()}s main window created (boot screen shown)`)
  }

  // 启动超时兜底：30s 仍未就绪且无错误弹窗 → 窗口内提示自救方式
  bootTimer = setTimeout(() => {
    logger.info(`[timing] +${rel()}s bootTimer 30s fired, status=${server.getStatus()}`)
    const st = server.getStatus()
    if ((st !== 'healthy' && st !== 'external') && !errorShown && mainWin && !mainWin.isDestroyed()) {
      showError(
        mainWin,
        '服务启动超时（30 秒内未就绪）。常见原因：端口 3080 被占用，或运行数据（DSH_HOME）损坏。可右键系统托盘 → “重置 Harness 数据”，或退出后重新双击启动。'
      )
    }
  }, 30000)

  await server.start()
  logger.info(`[timing] +${rel()}s server.start() returned, status=${server.getStatus()}`)
  logger.info('Harness 桌面端已启动')
}

// 硬件加速开关：必须在 app ready 之前决定是否禁用（disableHardwareAcceleration 仅启动期有效）。
// 默认开启（hardwareAcceleration:true）。关闭后强制软件渲染，可消除部分机型/虚拟机/远程桌面
// 下的页面闪烁与合成抖动。读取配置若失败，则沿用默认（启用硬件加速），不阻断启动。
try {
  const preCfg = loadConfig()
  if (preCfg.hardwareAcceleration === false) {
    app.disableHardwareAcceleration()
    logger.info('已按配置禁用硬件加速（software rendering / SwiftShader）')
  }
} catch (e) {
  logger.error(`读取硬件加速配置失败，沿用默认（启用硬件加速）: ${String(e)}`)
}

if (!setupSingleInstance(toggleWindow)) {
  // 第二个实例已被 quit（主实例常驻），这里无需继续
  logger.info('已有实例运行中，本次启动退出（交由主实例聚焦窗口）')
} else {
  app.whenReady().then(() => {
    logger.info(`[timing] app ready at +${rel()}s (process uptime ${process.uptime().toFixed(1)}s)`)
    bootstrap()
  }).catch((e) => {
    fatal('启动失败', String(e?.stack || e))
  })
}
