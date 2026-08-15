import { Tray, Menu, app } from 'electron'
import { makeStatusIcon } from './trayIcon.js'
import type { ServerStatus } from './server.js'

export interface TrayDeps {
  toggleWindow: () => void
  restartServer: () => void
  selectProject: () => void
  switchProject: (p: string) => void
  openSettings: () => void
  checkKernelUpdate: () => void
  exportDiagnostics: () => void
  resetHarness: () => void
  quit: () => void
  getRecentProjects: () => string[]
  getServerStatus: () => ServerStatus
}

const STATUS_TEXT: Record<ServerStatus, string> = {
  healthy: '服务正常',
  external: '复用外部服务',
  unhealthy: '服务异常',
  starting: '启动中…',
  stopped: '已停止'
}

export class TrayManager {
  private tray?: Tray
  private deps: TrayDeps

  constructor(deps: TrayDeps) {
    this.deps = deps
  }

  init(): void {
    this.tray = new Tray(makeStatusIcon(this.deps.getServerStatus()))
    this.tray.setToolTip(`DeepSeek Harness — ${STATUS_TEXT[this.deps.getServerStatus()]}`)
    this.tray.on('click', () => this.deps.toggleWindow())
    this.rebuild()
  }

  setStatus(s: ServerStatus): void {
    if (!this.tray) return
    this.tray.setImage(makeStatusIcon(s))
    this.tray.setToolTip(`DeepSeek Harness — ${STATUS_TEXT[s]}`)
  }

  private rebuild(): void {
    if (!this.tray) return
    const recent = this.deps.getRecentProjects()
    const recentMenu =
      recent.length > 0
        ? recent.map((p) => ({
            label: p.length > 40 ? '…' + p.slice(-40) : p,
            click: () => this.deps.switchProject(p)
          }))
        : [{ label: '(无最近项目)', enabled: false }]

    const menu = Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => this.deps.toggleWindow() },
      { label: '重启 Harness 服务', click: () => this.deps.restartServer() },
      { label: '重置 Harness 数据', click: () => this.deps.resetHarness() },
      { type: 'separator' },
      { label: '选择项目目录…', click: () => this.deps.selectProject() },
      { label: '最近项目', submenu: recentMenu },
      { type: 'separator' },
      { label: '设置', click: () => this.deps.openSettings() },
      { label: '检查 Harness 内核更新', click: () => this.deps.checkKernelUpdate() },
      { label: '导出诊断信息', click: () => this.deps.exportDiagnostics() },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          this.deps.quit()
        }
      }
    ])
    this.tray.setContextMenu(menu)
  }

  refreshRecent(): void {
    this.rebuild()
  }
}

export function appQuit(): void {
  app.quit()
}
