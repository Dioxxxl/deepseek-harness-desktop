import { app } from 'electron'
import { appendFileSync, mkdirSync, existsSync, readFileSync, statSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const logDir = join(app.getPath('userData'), 'logs')
if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })

function ts(): string {
  return new Date().toISOString()
}

// 日志按大小轮转（5MB 上限，保留一份 .1 备份），防止长期运行磁盘膨胀
const MAX_LOG_BYTES = 5 * 1024 * 1024

function appendRotated(name: string, line: string): void {
  try {
    const p = join(logDir, name)
    if (existsSync(p) && statSync(p).size > MAX_LOG_BYTES) {
      const bak = join(logDir, `${name}.1`)
      if (existsSync(bak)) rmSync(bak, { force: true })
      renameSync(p, bak)
    }
    appendFileSync(p, line)
  } catch {
    /* 日志写入失败不阻断主流程 */
  }
}

export function logApp(level: string, msg: string): void {
  const line = `[${ts()}][${level}] ${msg}\n`
  appendRotated('app.log', line)
  if (level === 'error') console.error(line.trim())
  else console.log(line.trim())
}

export const logger = {
  info: (m: string) => logApp('info', m),
  warn: (m: string) => logApp('warn', m),
  error: (m: string) => logApp('error', m)
}

/** dsh 子进程输出单独记录，便于诊断导出 */
export function logDsh(stream: 'stdout' | 'stderr', chunk: string): void {
  const line = `[${ts()}][dsh:${stream}] ${chunk}`
  appendRotated('dsh.log', line.endsWith('\n') ? line : line + '\n')
}

export function readLog(name: 'app' | 'dsh'): string {
  try {
    const p = join(logDir, `${name}.log`)
    if (!existsSync(p)) return ''
    return readFileSync(p, 'utf-8')
  } catch {
    return ''
  }
}
