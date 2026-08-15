import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * 解析 preload 脚本路径。electron-vite 在 ESM 工程下把 preload 输出为 index.mjs，
 * 但 dev/历史产物也可能是 index.js。这里按存在性探测，兼容两种扩展名与 dev/prod。
 */
export function resolvePreloadPath(): string {
  const candidates = [
    join(here, '../preload/index.mjs'),
    join(here, '../preload/index.js')
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  // 兜底返回最可能的路径，便于报错信息清晰
  return candidates[0]
}
