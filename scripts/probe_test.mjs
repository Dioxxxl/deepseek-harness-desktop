// 复现 server.ts 中新的 probe() 指纹逻辑（不依赖 electron），验证 bug #4 修复。
import http from 'node:http'

// 复刻 server.ts 的 probe：单次 fetch，读取根页面，按 __DSH_BOOT__ 指纹判 isDsh
async function probe(url) {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 1200)
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(t)
    const ok = res.ok || res.status === 307 || res.status === 401
    if (!ok) return { reachable: false, isDsh: false }
    const body = await res.text()
    return { reachable: true, isDsh: body.includes('__DSH_BOOT__') }
  } catch {
    return { reachable: false, isDsh: false }
  }
}

// 1) 模拟“被无关程序占用”的端口：返回 200 但无 dsh 指纹
const other = http.createServer((_req, r) => {
  r.writeHead(200, { 'content-type': 'text/html' })
  r.end('<html><body>Some other dev server / proxy page</body></html>')
})
// 2) 模拟“真实 dsh”：返回含 window.__DSH_BOOT__ 的根页面
const dsh = http.createServer((_req, r) => {
  r.writeHead(200, { 'content-type': 'text/html' })
  r.end('<html><head><script>window.__DSH_BOOT__={entries:[]}</script></head><body>dsh</body></html>')
})

function assert(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`)
  if (!cond) process.exitCode = 1
}

await new Promise((res) => other.listen(0, '127.0.0.1', res))
await new Promise((res) => dsh.listen(0, '127.0.0.1', res))
const otherPort = other.address().port
const dshPort = dsh.address().port

const a = await probe(`http://127.0.0.1:${otherPort}/`)
const b = await probe(`http://127.0.0.1:${dshPort}/`)
const c = await probe('http://127.0.0.1:59999/') // 无服务

assert('非 dsh 服务 → reachable=true 但 isDsh=false（不再误判 external 复用）', a.reachable === true && a.isDsh === false)
assert('真实 dsh → reachable=true 且 isDsh=true（正常复用/健康）', b.reachable === true && b.isDsh === true)
assert('无服务 → reachable=false', c.reachable === false && c.isDsh === false)

// 3) 若沙箱内仍有真实 dsh 后端在 :3099，顺带验一下真实指纹
try {
  const r3099 = await probe('http://127.0.0.1:3099/')
  console.log(`额外：真实 dsh(:3099) reachable=${r3099.reachable} isDsh=${r3099.isDsh}`)
} catch {}

other.close()
dsh.close()
console.log('done')
