#!/usr/bin/env node
/**
 * 发布脚本：构建 NSIS 安装器并组装可上传的更新文件（electron-updater 通用源）。
 *
 * 用法（在工程根目录执行）:
 *   node scripts/publish-release.cjs patch          # 补丁版本 +1（0.1.0 -> 0.1.1）
 *   node scripts/publish-release.cjs minor          # 0.1.0 -> 0.2.0
 *   node scripts/publish-release.cjs 0.2.0          # 显式指定版本
 *   node scripts/publish-release.cjs patch --github # 组装后尝试用 gh CLI 发布 GitHub Release
 *
 * 产出 release/<version>/ 目录（注意：文件名按 latest.yml 的 url 字段命名，
 * electron-builder 会把 productName 中的空格转成连字符，上传必须同名）:
 *   latest.yml
 *   DeepSeek-Harness-Desktop-<version>-x64.exe
 *   DeepSeek-Harness-Desktop-<version>-x64.exe.blockmap
 *
 * 发布到任意静态托管（对象存储 / 云服务器 / Gitee Release / 局域网 NAS）后，
 * 在客户端 设置 → 应用更新 填入该目录 URL 并保存，即可检测并下载更新。
 */
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const bump = (process.argv[2] || 'patch').trim()
const withGithub = process.argv.includes('--github')

function run(cmd) {
  console.log('$ ' + cmd)
  execSync(cmd, { cwd: root, stdio: 'inherit' })
}

// 1) 版本号
const pkgPath = path.join(root, 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
let version
if (/^\d+\.\d+\.\d+$/.test(bump)) {
  version = bump
} else if (bump === 'patch' || bump === 'minor' || bump === 'major') {
  const [maj, min, pat] = pkg.version.split('.').map(Number)
  version =
    bump === 'major' ? `${maj + 1}.0.0` : bump === 'minor' ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`
} else {
  console.error(`无法识别的版本参数: ${bump}（支持 patch|minor|major 或显式版本号）`)
  process.exit(1)
}
if (version !== pkg.version) {
  pkg.version = version
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  console.log(`版本号: ${version}`)
} else {
  console.log(`版本号保持: ${version}`)
}

// 2) 构建 + 打包（含 electron-vite build）
run('npm run package:nsis')

// 3) 解析 latest.yml 并组装 release 目录
const distDir = path.join(root, 'dist')
const latest = fs.readFileSync(path.join(distDir, 'latest.yml'), 'utf-8')
const urlMatch = latest.match(/^\s*-\s+url:\s*(\S+)/m)
if (!urlMatch) {
  console.error('latest.yml 中未找到 url 字段')
  process.exit(1)
}
const fileUrl = urlMatch[1]
const outDir = path.join(root, 'release', version)
fs.mkdirSync(outDir, { recursive: true })
const srcExe = fs.readdirSync(distDir).find((f) => f.endsWith('.exe') && !f.includes('__uninstaller'))
if (!srcExe) {
  console.error('dist 中未找到安装器')
  process.exit(1)
}
fs.copyFileSync(path.join(distDir, srcExe), path.join(outDir, fileUrl))
const blockSrc = srcExe + '.blockmap'
if (fs.existsSync(path.join(distDir, blockSrc))) {
  fs.copyFileSync(path.join(distDir, blockSrc), path.join(outDir, fileUrl + '.blockmap'))
}
fs.copyFileSync(path.join(distDir, 'latest.yml'), path.join(outDir, 'latest.yml'))
console.log(`\n发布文件已组装到 release/${version}/ :`)
for (const f of fs.readdirSync(outDir)) console.log('  ' + f)

// 4) 可选：GitHub Release
if (withGithub) {
  try {
    run('gh --version')
  } catch {
    console.error('未安装 gh CLI，跳过 GitHub 发布（文件已就绪，可手动上传 Release）')
    process.exit(0)
  }
  run(
    `gh release create "v${version}" "${path.join(outDir, fileUrl)}" "${path.join(outDir, fileUrl + '.blockmap')}" "${path.join(outDir, 'latest.yml')}" --title "DeepSeek Harness Desktop v${version}" --notes "自动发布"`
  )
  console.log(`GitHub Release v${version} 已发布`)
} else {
  console.log('\n下一步：把 release/' + version + '/ 下 3 个文件上传到你的静态托管，')
  console.log('然后在客户端 设置 → 应用更新 填入该目录 URL 并点「检查应用更新」。')
}