// 主进程 <-> 渲染进程（含设置窗口、dsh WebUI 窗口）共用的 IPC 通道名。
// 集中定义，避免拼写漂移。

export const IPC = {
  // 配置
  GET_CONFIG: 'app:get-config',
  SAVE_CONFIG: 'app:save-config',
  // 凭据（safeStorage）
  GET_CREDENTIAL: 'cred:get',
  SET_CREDENTIAL: 'cred:set',
  HAS_CREDENTIAL: 'cred:has',
  CLEAR_CREDENTIAL: 'cred:clear',
  // 项目目录
  SELECT_PROJECT: 'project:select',
  GET_RECENT_PROJECTS: 'project:recent-get',
  SWITCH_PROJECT: 'project:switch',
  // 服务控制
  SERVER_STATUS: 'server:status', // 主 -> 渲染（事件）
  GET_SERVER_STATUS: 'server:get-status',
  SERVER_RESTART: 'server:restart',
  SERVER_RESET: 'server:reset', // 清空 DSH_HOME 并重启
  SERVER_GET_ERROR: 'server:get-error', // 取最近一次 dsh 报错
  // 原生能力
  SET_AUTOSTART: 'native:set-autostart',
  EXPORT_DIAGNOSTICS: 'native:export-diagnostics',
  CHECK_APP_UPDATE: 'native:check-app-update',
  CHECK_KERNEL_UPDATE: 'native:check-kernel-update',
  OPEN_SETTINGS: 'native:open-settings',
  NOTIFY: 'native:notify',
  APP_RESTART: 'app:restart'
} as const

// 设置窗口里用到的 provider 列表（与 dsh 支持的模型提供商对应；此处仅作 UI 枚举，
// 实际生效取决于 dsh 是否安装对应 provider 插件）
export const PROVIDERS = [
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'kimi', label: 'Kimi' },
  { id: 'custom', label: '自定义 OpenAI 兼容' }
] as const

export type ProviderId = (typeof PROVIDERS)[number]['id']
