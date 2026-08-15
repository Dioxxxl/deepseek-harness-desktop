import { app } from 'electron'
import { spawn, ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { logger } from './logger.js'
import { ensureFrontendCssPatched } from './frontend-css.js'

/**
 * 内核独立更新：把 @deepseek-ai/dsh 安装到 userData/dsh-kernel（可写目录），
 * 启动时优先使用该目录下的 dsh，实现「壳与内核分离演进」。
 * 若用户机器没有 npm/Node，则降级为提示手动升级整个应用。
 */

const KERNEL_DIR = () => join(app.getPath('userData'), 'dsh-kernel')

function ensureKernelProject(): void {
  const dir = KERNEL_DIR()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) {
    writeFileSync(
      pkgPath,
      JSON.stringify({ name: 'dsh-kernel-local', private: true, version: '0.0.0' }, null, 2),
      'utf-8'
    )
  }
}

function bundledVersion(): string {
  try {
    const require = createRequire(import.meta.url)
    return require('@deepseek-ai/dsh/package.json').version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/** 解析实际使用的 dsh bin：优先 userData 内核目录，其次打包内置。 */
export function resolveDshBin(): { bin: string; fromKernel: boolean } {
  const kernelBin = join(KERNEL_DIR(), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (existsSync(kernelBin)) return { bin: kernelBin, fromKernel: true }
  try {
    const require = createRequire(import.meta.url)
    const bin = require.resolve('@deepseek-ai/dsh/lib/bin.js')
    return { bin, fromKernel: false }
  } catch {
    throw new Error('找不到 @deepseek-ai/dsh，应用可能损坏，请重新安装。')
  }
}

export function getCurrentKernelVersion(): string {
  const { fromKernel } = resolveDshBin()
  if (!fromKernel) return bundledVersion()
  try {
    const vp = join(KERNEL_DIR(), 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
    return JSON.parse(readFileSync(vp, 'utf-8')).version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

export interface KernelUpdateCheck {
  current: string
  latest: string
  updateAvailable: boolean
  /** 检查失败原因（npm 缺失 / 网络超时等），失败时 updateAvailable 恒为 false */
  error?: string
}

const CHECK_TIMEOUT_MS = 15000

export function checkKernelUpdate(): Promise<KernelUpdateCheck> {
  return new Promise((resolve) => {
    const fail = (error: string): void =>
      resolve({ current: getCurrentKernelVersion(), latest: 'unknown', updateAvailable: false, error })
    let child: ChildProcess
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      fail(`检查超时（${CHECK_TIMEOUT_MS / 1000}s），请确认网络与 npm 可用`)
    }, CHECK_TIMEOUT_MS)
    let out = ''
    try {
      child = spawn('npm', ['view', '@deepseek-ai/dsh', 'version'], { shell: true })
    } catch (e) {
      clearTimeout(timer)
      fail(`无法启动 npm: ${String(e)}`)
      return
    }
    child.stdout?.on('data', (d) => (out += d.toString()))
    child.on('error', (e) => {
      clearTimeout(timer)
      fail(`npm 启动失败（请确认系统已安装 Node/npm）: ${String(e)}`)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const current = getCurrentKernelVersion()
      if (code !== 0) {
        fail(`npm 检查失败 (exit ${code})，请确认系统已安装 Node/npm`)
        return
      }
      const latest = out.trim()
      if (!latest) {
        fail('npm 返回为空，无法获取最新版本')
        return
      }
      resolve({ current, latest, updateAvailable: latest !== current && latest !== 'unknown' })
    })
  })
}

/**
 * 执行内核更新：在 KERNEL_DIR 安装 @deepseek-ai/dsh@latest。
 * onLog 用于把进度回传 UI。返回更新后的版本号（失败抛错）。
 */
export function installKernelUpdate(onLog?: (line: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    ensureKernelProject()
    const child = spawn('npm', ['install', '@deepseek-ai/dsh@latest', '--no-audit', '--no-fund'], {
      cwd: KERNEL_DIR(),
      shell: true
    })
    child.stdout?.on('data', (d) => {
      const s = d.toString()
      logger.info(`[kernel-update] ${s.trim()}`)
      onLog?.(s)
    })
    child.stderr?.on('data', (d) => {
      const s = d.toString()
      logger.warn(`[kernel-update] ${s.trim()}`)
      onLog?.(s)
    })
    child.on('error', (e) => reject(new Error(`无法启动 npm: ${String(e)}`)))
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`内核更新失败 (npm exit ${code})。请确认系统已安装 Node/npm。`))
        return
      }
      // 新内核自带的前端 CSS 未打防闪补丁，安装后立即补上，避免补丁静默丢失
      try {
        ensureFrontendCssPatched(join(KERNEL_DIR(), 'node_modules', '@deepseek-ai', 'dsh'))
      } catch (e) {
        logger.warn(`内核前端 CSS 补丁失败（忽略）: ${String(e)}`)
      }
      resolve(getCurrentKernelVersion())
    })
  })
}
