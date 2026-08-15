import { ChildProcess, spawn } from 'node:child_process'
import getPort from 'get-port'
import { existsSync, rmSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { EventEmitter } from 'node:events'
import { logger } from './logger.js'
import { logDsh } from './logger.js'
import { buildCredentialEnv } from './credentials.js'
import { resolveDshBin } from './kernel-updater.js'
import { ensureFrontendCssPatched } from './frontend-css.js'
import { rel } from './timing.js'

export type ServerStatus = 'starting' | 'healthy' | 'unhealthy' | 'external' | 'stopped'

/**
 * dsh 的运行时家目录（profiles / 符号链接 / 会话数据）。
 * 关键：隔离到应用可控的 userData 下，而不是默认的 ~/.dsh。
 * 原因：dsh 启动会在 DSH_HOME/profiles 建符号链接，若 ~/.dsh 已存在“损坏状态”
 * （如首次启动被中断、符号链接指向已不存在的路径），后续启动会走 trash/heal 修复，
 * 在受限环境该步骤会抛错导致整个服务崩溃 → 红托盘。隔离到独立目录可绕过任何历史坏状态。
 */
function getDshHome(): string {
  return join(app.getPath('userData'), 'dsh-home')
}

function clearDshHome(): void {
  const home = getDshHome()
  if (existsSync(home)) {
    try {
      rmSync(home, { recursive: true, force: true })
      logger.warn(`已清空 DSH_HOME 以自愈: ${home}`)
    } catch (e) {
      logger.error(`清空 DSH_HOME 失败: ${String(e)}`)
    }
  }
}

/**
 * 清理 DSH_HOME 内遗留的 *.lock 写锁（best-effort）。
 *
 * 背景：dsh 用 dsh-atomic-write 的 withFileLock 做跨进程写串行化，锁是 `<file>.lock`
 * 兄弟文件，且“永不”删除他人持有的锁（orphan recovery is an operator action）。一旦某个
 * dsh 进程在持有锁时崩溃/被杀，该锁文件会遗留，使此后该 DSH_HOME 内所有 settings.mutate
 * 永久超时失败 —— 具体表现为：内测声明（“继续”）报“暂时无法保存确认状态，请重试”，且重试无效；
 * 进一步的 API Key 等设置保存也会失败。早期崩溃的构建（如 MODULE_NOT_FOUND）极易残留此锁。
 *
 * 因此每次拉起 dsh 前主动清理 *.lock，让写锁回到干净状态。仅清理文件、不动数据，安全。
 * 注意：start() 在探测到端口已有存活 dsh 时会复用（不进入 spawn），故此处只在确实要新拉起时执行。
 */
function clearOrphanedLocks(home: string): void {
  if (!existsSync(home)) return
  const walk = (dir: string): void => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = join(dir, e.name)
      try {
        if (e.isDirectory()) walk(full)
        else if (e.name.endsWith('.lock')) rmSync(full, { force: true })
      } catch {
        /* best-effort：忽略单个文件/目录的删除失败 */
      }
    }
  }
  try {
    walk(home)
  } catch {
    /* 整树遍历失败也不阻塞启动 */
  }
}

interface ServerOptions {
  host: string
  port: number
  cwd: string
}

/**
 * 定位可用的 node 运行时：
 * 1) 打包后优先用 extraResource 内置的 node（resources/node/node.exe）
 * 2) 否则回退 PATH 上的 node（开发/已装 Node 的环境）
 */
function findNodeBin(): string {
  if (app.isPackaged) {
    const bundled = join(process.resourcesPath, 'node', 'node.exe')
    if (existsSync(bundled)) return bundled
  }
  return 'node'
}

export class ServerManager extends EventEmitter {
  private child?: ChildProcess
  private opts: ServerOptions
  private status: ServerStatus = 'stopped'
  private healthTimer?: NodeJS.Timeout
  private restartTimer?: NodeJS.Timeout
  private restartAttempts = 0
  private intentionalStop = false
  private usingExternal = false
  private healedOnce = false
  private spawnTime = 0
  private lastError = ''
  /** 实际监听端口（端口冲突换端口后与 opts.port 不同） */
  private actualPort?: number
  /** 复用外部服务时的连续失败次数，>=3 触发接管 */
  private externalFailures = 0

  constructor(opts: ServerOptions) {
    super()
    this.opts = { ...opts }
  }

  getStatus(): ServerStatus {
    return this.status
  }

  getPort(): number {
    return this.actualPort ?? this.opts.port
  }

  getHost(): string {
    return this.opts.host
  }

  getLastError(): string {
    return this.lastError
  }

  /** 重置 Harness 运行数据（清空 DSH_HOME）并重启服务。供“重置 Harness 数据”菜单使用。 */
  async resetAndRestart(): Promise<void> {
    this.healedOnce = false
    clearDshHome()
    await this.restart()
  }

  private setStatus(s: ServerStatus): void {
    this.status = s
    this.emit('status', s)
  }

  /** 启动：先探测是否已有 dsh 在监听，有则复用，否则拉起新进程。 */
  async start(): Promise<void> {
    this.intentionalStop = false
    logger.info(`[timing] +${rel()}s ServerManager.start() begin`)
    const { reachable, isDsh } = await this.probe()
    logger.info(`[timing] +${rel()}s probe done, reachable=${reachable}, isDsh=${isDsh}`)
    if (reachable && isDsh) {
      this.usingExternal = true
      this.setStatus('external')
      logger.info(`检测到已有 dsh 服务在 ${this.url()}，直接复用`)
      this.startHealthLoop()
      return
    }
    if (reachable && !isDsh) {
      // 端口被无关程序占用：不能直接复用，否则会把他人页面当 UI 加载。
      // 仍尝试拉起自有 dsh；若 dsh 绑定端口失败，现有崩溃/重启/错误链路会向用户暴露问题。
      logger.warn(
        `端口 ${this.opts.port} 已被非 dsh 服务占用，无法复用；将尝试拉起自有 dsh（若 dsh 启动失败，请检查端口冲突）`
      )
    }
    this.usingExternal = false
    await this.spawn()
  }

  private url(): string {
    return `http://${this.opts.host}:${this.getPort()}`
  }

  /**
   * 探测端口服务：返回 { reachable, isDsh }。
   * - reachable：端口是否有 HTTP 服务响应（ok / 307 / 401）。
   * - isDsh：响应确属 dsh 自身（根页面含 window.__DSH_BOOT__ 指纹）。
   *
   * 关键修复：早期版本仅凭“端口有 HTTP 响应”就判定 external 并复用，若 3080 被无关
   * 程序（开发服务器 / 代理 / 其他应用）占用，Harness 会把他人页面当自己 UI 加载且
   * 永不启动自身 dsh。现改为必须匹配 dsh 指纹才算“可用且是 dsh”，从而同时修复：
   *   1) start() 误复用他人服务；
   *   2) startHealthLoop() 在自有 dsh 未起、但端口被占用时误报 healthy。
   */
  private async probe(): Promise<{ reachable: boolean; isDsh: boolean }> {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 1200)
      const res = await fetch(this.url(), { signal: ctrl.signal })
      clearTimeout(t)
      const ok = res.ok || res.status === 307 || res.status === 401
      if (!ok) return { reachable: false, isDsh: false }
      // 读取根页面，确认是 dsh（含 __DSH_BOOT__ 指纹）而非端口上的任意 HTTP 服务
      const body = await res.text()
      return { reachable: true, isDsh: body.includes('__DSH_BOOT__') }
    } catch {
      return { reachable: false, isDsh: false }
    }
  }

  private buildArgs(port: number): string[] {
    // 经 `dsh web --help` 实测：`dsh web` 等价于 `--profile web`，支持
    // `--host <host>`（bind host）与 `--port <port>`。
    // 显式绑定 127.0.0.1，避免服务暴露到 0.0.0.0（安全加固的一部分）。
    return ['web', '--host', this.opts.host, '--port', String(port)]
  }

  private async spawn(): Promise<void> {
    logger.info(`[timing] +${rel()}s spawn() begin`)
    const nodeBin = findNodeBin()
    const { bin } = resolveDshBin()
    // 端口决策：3080 若被其他程序/失效的外部服务占用，改用空闲端口
    // （getPort 优先返回原端口，原端口空闲时行为不变）
    let port = this.opts.port
    try {
      port = await getPort({ port: this.opts.port })
    } catch {
      /* getPort 异常时保持默认端口 */
    }
    this.actualPort = port
    if (port !== this.opts.port) {
      logger.warn(`端口 ${this.opts.port} 不可用，本次 dsh 将监听端口 ${port}`)
    }
    // 前端 CSS v3 防闪补丁自愈（内核自更新后同样生效）
    try {
      ensureFrontendCssPatched(join(dirname(bin), '..'))
    } catch (e) {
      logger.warn(`前端 CSS 补丁自愈失败（忽略）: ${String(e)}`)
    }
    // 把内置 node 所在目录前置到 PATH，确保 dsh 自身 spawn 的子进程也能找到 node
    const nodeDir = dirname(nodeBin)
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...buildCredentialEnv(),
      // 隔离 dsh 运行数据到应用可控目录，绕过任何历史损坏状态
      DSH_HOME: getDshHome(),
      PATH: nodeDir + (process.env.PATH ? `;${process.env.PATH}` : '')
    }
    const args = this.buildArgs(port)
    // 拉起前清理遗留写锁，避免历史崩溃残留的 *.lock 让 settings 写入永久超时
    clearOrphanedLocks(getDshHome())
    logger.info(`启动 dsh 服务: ${nodeBin} ${bin} ${args.join(' ')}`)
    logger.info(`DSH_HOME=${env.DSH_HOME}`)

    const child = spawn(nodeBin, [bin, ...args], {
      env,
      cwd: this.opts.cwd || undefined,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: nodeBin === 'node'
    })

    this.child = child
    this.lastError = ''
    this.spawnTime = Date.now()
    logger.info(`[timing] +${rel()}s spawn() child launched (pid ${child.pid})`)
    child.stdout?.on('data', (d) => logDsh('stdout', d.toString()))
    child.stderr?.on('data', (d) => {
      const s = d.toString()
      logDsh('stderr', s)
      this.lastError = (this.lastError + s).slice(-4000)
    })
    child.on('exit', (code, signal) => {
      // 只处理「当前」子进程的退出：被 restart()/stop() 取代的旧进程退出事件
      // 一律忽略，否则会在新进程正常运行时误触发 scheduleRestart 造成双开/连环重启
      if (this.child !== child) return
      this.child = undefined
      const crashed = code !== 0 && code !== null
      const earlyExit = Date.now() - this.spawnTime < 90000
      logDsh('stderr', `dsh 进程退出 code=${code} signal=${signal} crashed=${crashed}`)
      logger.info(`[timing] +${rel()}s dsh exited code=${code} crashed=${crashed} spawnAge=${Date.now() - this.spawnTime}ms`)
      this.child = undefined
      if (this.intentionalStop) return
      // 自愈：启动早期崩溃（疑似 DSH_HOME 状态损坏）时，清空后重试一次
      if (crashed && earlyExit && !this.healedOnce && existsSync(getDshHome())) {
        this.healedOnce = true
        logger.warn(`[timing] +${rel()}s dsh 早期崩溃自愈，800ms 后重试`)
        logger.warn('dsh 启动早期崩溃，疑似 DSH_HOME 状态损坏，清空后自愈重试一次')
        clearDshHome()
        this.emit('error', this.lastError || `dsh 启动失败（code=${code}），正在清空数据后重试`)
        this.setStatus('starting')
        if (this.restartTimer) clearTimeout(this.restartTimer)
        this.restartTimer = setTimeout(() => this.spawn(), 800)
        return
      }
      if (crashed) this.emit('error', this.lastError || `dsh 进程退出 code=${code} signal=${signal}`)
      this.scheduleRestart()
    })
    child.on('error', (err) => {
      logger.error(`dsh 启动失败: ${String(err)}`)
      this.emit('error', `dsh 启动失败: ${String(err)}`)
    })

    this.setStatus('starting')
    this.startHealthLoop()
  }

  private startHealthLoop(): void {
    if (this.healthTimer) clearInterval(this.healthTimer)
    this.healthTimer = setInterval(async () => {
      const { reachable, isDsh } = await this.probe()
      if (reachable && isDsh) {
        this.restartAttempts = 0
        this.externalFailures = 0
        if (this.status !== 'healthy' && this.status !== 'external') {
          logger.info(`[timing] +${rel()}s healthy detected via probe`)
          this.setStatus('healthy')
        }
      } else if (!this.usingExternal) {
        if (this.status === 'healthy') this.setStatus('unhealthy')
      } else {
        // 复用外部服务时：连续探测失败即接管拉起自有 dsh，避免窗口永远指向死 URL
        this.externalFailures++
        if (this.externalFailures >= 3) {
          this.usingExternal = false
          this.externalFailures = 0
          logger.warn(`[timing] +${rel()}s 外部 dsh 服务连续探测失败，接管并拉起自有 dsh`)
          this.setStatus('unhealthy')
          if (this.restartTimer) clearTimeout(this.restartTimer)
          this.restartTimer = setTimeout(() => {
            this.spawn().catch((e) => logger.error(`接管拉起自有 dsh 失败: ${String(e)}`))
          }, 2000)
        }
      }
    }, 3000)
  }

  private scheduleRestart(): void {
    if (this.usingExternal) {
      // 外部服务断开，仅标记为不健康，不接管
      this.setStatus('unhealthy')
      return
    }
    this.restartAttempts++
    const delay = Math.min(1000 * 2 ** Math.min(this.restartAttempts, 5), 30000)
    logger.warn(`[timing] +${rel()}s dsh 意外退出，将在 ${delay}ms 后第 ${this.restartAttempts} 次重启`)
    this.setStatus('unhealthy')
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = setTimeout(() => this.spawn(), delay)
  }

  /** 切换工作目录并重启服务。 */
  async setCwd(newCwd: string): Promise<void> {
    this.opts.cwd = newCwd
    await this.restart()
  }

  /** 重启服务（保留当前工作目录）。 */
  async restart(): Promise<void> {
    this.intentionalStop = true
    if (this.child) this.child.kill('SIGTERM')
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.intentionalStop = false
    if (this.usingExternal) {
      // external 模式下重启无意义：重新探测，外部 dsh 仍存活则继续复用
      const { reachable, isDsh } = await this.probe()
      if (reachable && isDsh) {
        logger.info('外部 dsh 服务仍存活，保持复用（无需重启）')
        this.setStatus('external')
        return
      }
      this.usingExternal = false
      logger.warn('外部 dsh 服务已失效，接管并拉起自有 dsh')
    }
    await this.spawn()
  }

  /** 停止服务并清理。 */
  stop(): void {
    this.intentionalStop = true
    if (this.healthTimer) clearInterval(this.healthTimer)
    if (this.restartTimer) clearTimeout(this.restartTimer)
    if (this.child) this.child.kill('SIGTERM')
    this.child = undefined
    this.setStatus('stopped')
  }
}
