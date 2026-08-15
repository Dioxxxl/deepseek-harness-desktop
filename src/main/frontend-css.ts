import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from './logger.js'

/**
 * dsh 前端 CSS 防闪补丁（v3）自愈模块。
 *
 * 背景：dsh 真正伺服的静态 CSS（@deepseek-ai/dsh-web-frontend/dist/assets/index-*.css）
 * 内含全屏 backdrop-filter 遮罩与大量动画，在本机 GPU 合成层不稳定的环境会整页重绘闪烁。
 * 修复手段是给该 CSS 末尾追加 v3 稳定层（恢复毛玻璃+动画，保留 will-change /
 * backface-visibility / scrollbar-gutter / contain 等无害稳定属性）。
 *
 * 关键：补丁必须打在「实际被伺服的副本」上。内置副本在 resources/app/node_modules，
 * 内核自更新副本在 userData/dsh-kernel/node_modules——两者都可能在运行期出现，
 * 因此每次拉起 dsh 前调用 ensureFrontendCssPatched() 幂等自愈，避免内核更新后补丁静默丢失。
 */

const V3_MARKER = '/* === anti-flicker v3 (restore glass+blur, keep stabilizers) === */'

/** 纯函数：对 CSS 内容应用 v3 补丁（幂等：先剥旧块再追加新块）。 */
export function applyV3Patch(css: string): string {
  let buf = css
  const markerIdx = buf.indexOf('/* === anti-flicker')
  if (markerIdx >= 0) buf = buf.slice(0, markerIdx)
  // 找出携带 animation 的类选择器（流式吐字/转圈等动画元素）
  const animClasses = new Set<string>()
  for (const c of buf.split('}')) {
    const i = c.indexOf('{')
    if (i < 0) continue
    const sel = c.slice(0, i).trim()
    const body = c.slice(i + 1)
    if (sel.startsWith('@')) continue
    if (/animation\s*:/i.test(body)) {
      const m = sel.match(/\._[A-Za-z0-9_]+(?:_[A-Za-z0-9]+)?/g)
      if (m) m.forEach((x) => animClasses.add(x))
    }
  }
  // 滚动/输出容器类（完整双段哈希）
  const findClass = (token: string): string | null => {
    const re = new RegExp('\\._' + token + '(_[A-Za-z0-9]+)+')
    const m = buf.match(re)
    return m ? m[0] : null
  }
  const containers = ['output', 'header', 'sources', 'footer']
    .map(findClass)
    .filter((x): x is string => !!x)
  const animList = [...animClasses].join(',')
  const contList = ['html', 'body', ...containers].join(',')
  const v3 =
    `\n${V3_MARKER}\n` +
    `*,*::before,*::after{backface-visibility:hidden}\n` +
    `${animList}{will-change:transform,opacity;backface-visibility:hidden}\n` +
    `${contList}{scrollbar-gutter:stable}\n` +
    `._output_10eou_162{contain:content}\n`
  return buf + v3
}

/**
 * 确保 dsh 前端 CSS 已打 v3 补丁（幂等，已带标记则跳过）。
 * @param dshPackageRoot @deepseek-ai/dsh 包根目录（lib/bin.js 的上一级）
 */
export function ensureFrontendCssPatched(dshPackageRoot: string): void {
  const candidates = [
    join(dshPackageRoot, '..', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'assets'),
    join(dshPackageRoot, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'assets')
  ]
  for (const dir of candidates) {
    let names: string[] = []
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (!/^index-.*\.css$/.test(name)) continue
      const p = join(dir, name)
      try {
        const orig = readFileSync(p, 'utf-8')
        if (orig.includes(V3_MARKER)) continue // 已补丁，跳过
        const patched = applyV3Patch(orig)
        writeFileSync(p, patched, 'utf-8')
        logger.info(`已为 dsh 前端 CSS 应用 v3 防闪补丁: ${p}（${orig.length} → ${patched.length} 字节）`)
      } catch (e) {
        logger.warn(`前端 CSS 补丁失败（忽略，不影响启动）: ${p}: ${String(e)}`)
      }
    }
  }
}