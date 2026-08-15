import { contextBridge, ipcRenderer } from 'electron'
import { IPC, PROVIDERS } from '../shared/ipcChannels'

// 在隔离的渲染进程环境里，仅暴露一组受控的原生能力。
// dsh WebUI 与设置窗口都通过 window.electronAPI 调用，不接触 Node。

const api = {
  listProviders: () => PROVIDERS,

  getConfig: () => ipcRenderer.invoke(IPC.GET_CONFIG),
  saveConfig: (patch: Record<string, unknown>) => ipcRenderer.invoke(IPC.SAVE_CONFIG, patch),

  getCredential: (provider: string) => ipcRenderer.invoke(IPC.GET_CREDENTIAL, provider),
  setCredential: (provider: string, key: string) => ipcRenderer.invoke(IPC.SET_CREDENTIAL, provider, key),
  hasCredential: (provider: string) => ipcRenderer.invoke(IPC.HAS_CREDENTIAL, provider),
  clearCredential: (provider: string) => ipcRenderer.invoke(IPC.CLEAR_CREDENTIAL, provider),

  selectProject: () => ipcRenderer.invoke(IPC.SELECT_PROJECT),
  getRecentProjects: () => ipcRenderer.invoke(IPC.GET_RECENT_PROJECTS),
  switchProject: (path: string) => ipcRenderer.invoke(IPC.SWITCH_PROJECT, path),

  restartServer: () => ipcRenderer.invoke(IPC.SERVER_RESTART),
  getServerStatus: () => ipcRenderer.invoke(IPC.GET_SERVER_STATUS),

  setAutoStart: (enabled: boolean) => ipcRenderer.invoke(IPC.SET_AUTOSTART, enabled),
  exportDiagnostics: () => ipcRenderer.invoke(IPC.EXPORT_DIAGNOSTICS),
  checkAppUpdate: () => ipcRenderer.invoke(IPC.CHECK_APP_UPDATE),
  checkKernelUpdate: () => ipcRenderer.invoke(IPC.CHECK_KERNEL_UPDATE),
  restartApp: () => ipcRenderer.invoke(IPC.APP_RESTART),

  notify: (title: string, body: string) => ipcRenderer.send(IPC.NOTIFY, title, body),

  onServerStatus: (cb: (status: string) => void) => {
    const handler = (_e: unknown, status: string) => cb(status)
    ipcRenderer.on(IPC.SERVER_STATUS, handler)
    return () => ipcRenderer.removeListener(IPC.SERVER_STATUS, handler)
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)
