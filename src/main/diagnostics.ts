import { app, dialog } from 'electron'
import { createRequire } from 'node:module'
import { readLog } from './logger.js'
import { loadConfig } from './config.js'

function dshVersion(): string {
  try {
    const require = createRequire(import.meta.url)
    const pkg = require('@deepseek-ai/dsh/package.json')
    return pkg.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

function buildReport(): string {
  const cfg = loadConfig()
  const safeCfg = {
    ...cfg,
    // 不泄露凭据；仅说明是否存在
    credentialsPresent: undefined
  }
  const lines: string[] = []
  lines.push('# DeepSeek Harness Desktop — 诊断信息')
  lines.push(`生成时间: ${new Date().toISOString()}`)
  lines.push(`应用版本: ${app.getVersion()}`)
  lines.push(`Harness 内核(@deepseek-ai/dsh): ${dshVersion()}`)
  lines.push(`Electron: ${process.versions.electron ?? 'n/a'}`)
  lines.push(`Node: ${process.versions.node}`)
  lines.push(`平台: ${process.platform} ${process.arch}`)
  lines.push('')
  lines.push('## 配置 (已脱敏)')
  lines.push('```json')
  lines.push(JSON.stringify({ ...safeCfg, credentials: '[redacted]' }, null, 2))
  lines.push('```')
  lines.push('')
  lines.push('## 应用日志 (app.log)')
  lines.push('```')
  lines.push(readLog('app') || '(空)')
  lines.push('```')
  lines.push('')
  lines.push('## Harness 服务日志 (dsh.log)')
  lines.push('```')
  lines.push(readLog('dsh') || '(空)')
  lines.push('```')
  return lines.join('\n')
}

/** 弹出保存对话框，将诊断信息导出为 .md 文件。 */
export async function exportDiagnostics(): Promise<void> {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: '导出诊断信息',
    defaultPath: `harness-desktop-diagnostics-${Date.now()}.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  })
  if (canceled || !filePath) return
  const { writeFileSync } = await import('node:fs')
  writeFileSync(filePath, buildReport(), 'utf-8')
}
