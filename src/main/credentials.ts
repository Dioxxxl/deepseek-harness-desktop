import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

// API Key 用 safeStorage 加密后落盘（Windows 走 Credential Manager / DPAPI）。
// 文件本身只存密文（base64），明文仅运行时以 env 注入 dsh 子进程。

interface Store {
  [provider: string]: string // provider -> encrypted base64
}

const storePath = () => join(app.getPath('userData'), 'credentials.json')

function loadStore(): Store {
  const p = storePath()
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return {}
  }
}

function saveStore(s: Store): void {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(storePath(), JSON.stringify(s), 'utf-8')
}

function available(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function setCredential(provider: string, apiKey: string): void {
  const s = loadStore()
  if (available()) {
    s[provider] = safeStorage.encryptString(apiKey).toString('base64')
  } else {
    // 无加密后端时的降级（Windows 上基本不会触发）
    s[provider] = 'plain:' + Buffer.from(apiKey).toString('base64')
  }
  saveStore(s)
}

export function getCredential(provider: string): string | undefined {
  const s = loadStore()
  const v = s[provider]
  if (!v) return undefined
  if (v.startsWith('plain:')) return Buffer.from(v.slice(6), 'base64').toString('utf-8')
  if (available()) return safeStorage.decryptString(Buffer.from(v, 'base64'))
  return undefined
}

export function hasCredential(provider: string): boolean {
  return !!loadStore()[provider]
}

export function clearCredential(provider: string): void {
  const s = loadStore()
  delete s[provider]
  saveStore(s)
}

/**
 * 构造注入 dsh 子进程的 env（仅含 API Key 类环境变量）。
 * dsh 不同 provider 读取的变量名 conventions：<PROVIDER>_API_KEY。
 */
export function buildCredentialEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  const s = loadStore()
  for (const [provider, v] of Object.entries(s)) {
    let key: string | undefined
    switch (provider) {
      case 'deepseek':
        key = 'DEEPSEEK_API_KEY'
        break
      case 'openai':
        key = 'OPENAI_API_KEY'
        break
      case 'anthropic':
        key = 'ANTHROPIC_API_KEY'
        break
      case 'kimi':
        key = 'KIMI_API_KEY'
        break
      case 'custom':
        key = 'OPENAI_API_KEY'
        break
    }
    if (key) {
      const val = v.startsWith('plain:')
        ? Buffer.from(v.slice(6), 'base64').toString('utf-8')
        : available()
          ? safeStorage.decryptString(Buffer.from(v, 'base64'))
          : undefined
      if (val) env[key] = val
    }
  }
  return env
}
