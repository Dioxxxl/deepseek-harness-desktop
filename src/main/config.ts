import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export interface AppConfig {
  host: string
  port: number
  /** 当前 agent 工作根目录；空串表示使用 dsh 默认（用户主目录） */
  cwd: string
  recentProjects: string[]
  autostart: boolean
  /**
   * 是否在启动时自动检查应用更新。默认 false：
   * publish 源(github)尚无 Release，启动即检查只会拿到 404/连接重置并刷错误日志。
   * Release 上线后可将默认值改为 true。
   */
  autoUpdateCheck: boolean
  /**
   * 是否启用 Chromium 硬件加速（GPU 合成）。默认 true（Electron 默认行为）。
   * 关闭后强制软件渲染（SwiftShader），可消除部分机型/虚拟机/远程桌面下
   * 的页面闪烁与合成抖动，代价是首屏与重绘稍慢。需重启应用生效。
   */
  hardwareAcceleration: boolean
  /**
   * 应用更新源 URL（可选，设置页可配置）。指向含 latest.yml + 安装包 + .blockmap
   * 的静态目录（见 scripts/publish-release.cjs）；留空则使用打包内置的 app-update.yml 源。
   */
  updateFeedUrl?: string
  /** 默认使用的模型提供商（决定注入哪个 key） */
  provider: string
}

const DEFAULTS: AppConfig = {
  host: '127.0.0.1',
  port: 3080,
  cwd: '',
  recentProjects: [],
  autostart: false,
  autoUpdateCheck: false,
  hardwareAcceleration: true,
  provider: 'deepseek'
}

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

export function loadConfig(): AppConfig {
  const p = configPath()
  if (!existsSync(p)) return { ...DEFAULTS }
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8'))
    return { ...DEFAULTS, ...raw }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveConfig(cfg: AppConfig): void {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf-8')
}

export function updateConfig(patch: Partial<AppConfig>): AppConfig {
  const next = { ...loadConfig(), ...patch }
  saveConfig(next)
  return next
}
