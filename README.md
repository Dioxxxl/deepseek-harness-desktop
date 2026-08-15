# DeepSeek Harness Desktop（Windows）

用 **Electron** 把官方 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 WebUI 包装成原生 Windows 桌面客户端。不重写 UI，只做「服务壳 + 原生能力」，最大化抗住开发者预览版的接口变动。

> 状态：基于 DeepSeek Harness v0.1.0-rc.6（开发者预览）。Harness 接口仍会变化，本项目的调用全部走可配置参数，不依赖内部协议。

## 架构

```
┌─────────────────────────────────────────────┐
│ Electron 主进程                               │
│  ServerManager ──spawn──> dsh web (Node)      │
│  (端口探测/复用 · 健康检查 · 自动重启 · env注入) │
│  Tray / 设置窗口 / safeStorage / 自动更新 ...   │
└───────────────────┬─────────────────────────┘
                     │  http://127.0.0.1:3080
                     ▼
            dsh WebUI (React, 官方)
```

- 后端 `@deepseek-ai/dsh` 作为应用内依赖随包发布；主进程用 Node 拉起 `dsh web` 服务。
- `BrowserWindow` 加载 `http://127.0.0.1:3080`，复用官方 WebUI，零 UI 重写。
- 所有原生能力（托盘、凭据、更新、通知、快捷键）都落在主进程，不依赖 WebUI 内部。

## 原生能力

- 系统托盘 + 后台常驻，图标实时反映服务健康（绿/红/黄）
- 原生「选择项目目录」对话框 + 最近项目快速切换
- `safeStorage`（Windows 凭据管理器）加密存储 API Key
- `electron-updater` 应用自动更新（GitHub Releases）+ 桌面通知 + 全局快捷键（Ctrl+Shift+D）
- Windows 开机自启
- 内核独立更新：应用内重装 `@deepseek-ai/dsh@latest` 再重启服务（壳与内核分离演进）
- 诊断信息导出（应用日志 + dsh 服务日志打包）

## 运行（开发）

前置：Node.js 22+（开发机需安装；打包后的应用可内置 Node）。

```bash
npm install
npm run dev        # electron-vite 启动，自动拉起 dsh 并打开窗口
```

或单独的：

```bash
npm run build      # 编译 main/preload
npm start          # electron .
```

## 运行（打包产物 / 双击）

打包完成后，产物在仓库根目录的 `dist/` 下：

- **便携版（单文件）**：`dist/DeepSeek Harness Desktop-0.1.0-portable.exe`
  → 双击即可运行，无需安装，可放 U 盘带走。
- **安装版**：`dist/DeepSeek Harness Desktop-0.1.0-x64.nsis.7z`（用 `npm run package:nsis` 产出）
  → 解压后运行里面的 `DeepSeek Harness Desktop Setup.exe` 安装到系统。

**已经是自包含的**：打包时会把 `node.exe` 一并打进 `resources/node/node.exe`，
`ServerManager.findNodeBin()` 优先用它拉起 dsh 服务，因此**无需在系统 PATH 上装 Node**。
双击后预期行为：

1. Electron 启动 → 主进程 spawn 内置 `node` 跑 `dsh web --host 127.0.0.1 --port 3080`；
2. 主窗口加载 `http://127.0.0.1:3080` 的官方 WebUI；
3. 托盘图标变**绿**表示服务健康；**黄**=启动中，**红**=不健康/未连接。

> 未签名提示：当前 exe 没有代码签名，首次运行 Windows SmartScreen 可能拦截/警告，
> 选择「仍要运行」即可。CI 里配 `CSC_LINK` 后可自动签名消除该提示。

## 打包（Windows）

```bash
npm run package            # 默认产出 nsis 安装版
npm run package:nsis       # 仅安装版
npm run package:portable   # 仅便携版（单文件 exe，约 105MB）
```

- 目标由 CLI 指定（`--win nsis` / `--win portable`），配置见 `electron-builder.yml`（已移除顶层 `win` 块，因 electron-builder 26 的 schema 校验）。
- 自动更新发布到 GitHub Releases：`publish` 配置见 `electron-builder.yml`，CI 用 `GH_TOKEN` 注入（见 `.github/workflows/build.yml`）。
- 打包会把 `@deepseek-ai/dsh` 及其全部依赖打入（portable 解包前约 140MB，unpacked 约 600MB+）。
- **Node 运行时已随包内置**：`build-resources/node/node.exe`（v22.22.2）经 `electron-builder.yml` 的 `extraResources` 打进 `resources/node/node.exe`，`ServerManager.findNodeBin()` 优先读取，故用户无需在系统 PATH 安装 Node。如需换 Node 版本，替换该文件即可。

### 打包环境注意事项（已实测）

1. **Electron 二进制下载**：`npm install` 时 Electron 的二进制可能未随包下载。打包阶段会由 electron-builder 重新下载（~100MB）。**国内网络建议设置镜像**，否则易卡住：
   ```bash
   export ELECTRON_MIRROR="https://registry.npmmirror.com/-/binary/electron/"
   export ELECTRON_BUILDER_BINARIES_MIRROR="https://registry.npmmirror.com/-/binary/electron-builder-binaries/"
   ```
2. **原生模块重编译**：dsh 依赖 `node-pty` 等原生模块，electron-builder 默认会重编译以匹配 Electron ABI，需要本机有 C++ 工具链（Windows 需 Visual Studio Build Tools）。当前配置 `npmRebuild: false` 已临时跳过（沙箱无工具链）；**正式 CI 应设为 `true` 并确保构建环境带工具链**，否则打出的原生模块 ABI 可能不匹配导致运行期报错。
3. **代码签名**：未配置证书时打出的 exe 未经验证签名，首次运行会触发 Windows SmartScreen 警告。正式发布需配置 `CSC_LINK` / `CSC_KEY_PASSWORD`（或在 CI secrets 中注入）。

## dsh 启动与配置事实清单（验证记录）

- 包名 `@deepseek-ai/dsh`，bin 入口 `lib/bin.js`（ESM），最新 `0.1.0-rc.6`。
- 启动入口：`dsh web`（等价于 `dsh --profile web`）启动 WebUI；默认地址 `http://127.0.0.1:3080`。
- **`dsh web --help` 实测确认** web app 支持以下 flag（2026-08-14 验证）：
  - `--host <host>`：bind host（**已实测可用**，本项目显式传 `127.0.0.1` 以仅绑本地，避免暴露到 0.0.0.0）。
  - `--port <port>`：监听端口；传 `0` 让 OS 自动选空闲端口。
  - `--trusted-host <authority...>`：额外信任的 `/api` browser-trust fence 授权（host 或 host:port，可重复）。默认已信任 127.0.0.1，Electron 同源加载一般无需追加。
  - 示例：`dsh --profile web --port 8080`；`dsh --profile web` 用组合后的 host/port。
- CLI 结构：launcher 只解析自身 flag（`--profile`/`--patch`/`--dump-config`），其余参数 **透传** 给被拉起的 web 应用（`passThroughOptions`）。
- 冒烟测试（2026-08-14）：`node lib/bin.js web --host 127.0.0.1 --port 3099` 约 2 秒启动，`GET /` 返回 200、`<title>DeepSeek Harness</title>`，并加载 `@deepseek-ai/dsh-api-gateway`、`dsh-session-log-export` 等插件 → **ServerManager 的拉起+健康检查策略已实测成立**。
- 环境：通过 `loadLayeredEnv("dsh")` 加载分层环境变量（涉及 `DSH_HOME`/`DSH_PROFILES` 等），首次运行会在用户目录初始化 profiles。
- API Key：本项目以 env 方式注入（`DEEPSEEK_API_KEY` 等），具体变量名以 dsh 官方文档/`dsh web --help` 为准；如官方改读取配置文件，则需改为写配置文件后注入。
- 待最终确认：是否有会话事件可订阅（用于精确通知）、API Key 与多 Provider 的精确 env 变量名。运行时执行 `node node_modules/@deepseek-ai/dsh/lib/bin.js web --help` 查看最新 flag。

## 风险与已知限制

- 开发者预览，dsh CLI/配置可能破坏式变更。
- 若未内置 Node，打包应用在缺少 Node 的机器上无法启动 dsh（开发环境不受影响）。
- 预览版接口未稳定前，会话「精确通知」采用尽力而为策略。

## 排错：托盘红色 / dsh 服务异常

托盘红色表示 dsh 子进程未起来或健康检查失败。常见根因与对策：

1. **`DSH_HOME` 状态损坏（最常见）**：dsh 首次启动会在 `DSH_HOME/profiles` 建符号链接，若目录已存在「损坏状态」（如首次启动被中断、符号链接指向已不存在的路径），再次启动会走 trash/heal 修复，该步骤失败即崩溃。
   - 桌面端已做隔离与自愈：`DSH_HOME` 默认隔离到 `userData/dsh-home`（不再用 `~/.dsh`），且启动早期崩溃会**自动清空并重试一次**。
   - 仍异常时：右键托盘 → **「重置 Harness 数据」**（清空 `DSH_HOME` 并重启）。
2. **asar 打包导致读取失败**：本项目 `electron-builder.yml` 设了 `asar: false`。原因——桌面端用**普通 node.exe（无 Electron 的 asar 补丁）** 子进程拉起 dsh，而 dsh 有数百个动态 `require` 依赖；若启用 asar，这些依赖被归档进 `app.asar`，普通 node 读不了 → dsh 静默卡死。故必须 `asar: false`。
3. **端口被占用**：`server.ts` 会先探测 3080 是否已有服务，有则复用，否则拉起；极少见冲突时可在托盘「重启 Harness 服务」。
4. **缺 Node**：确认 `resources/node/node.exe` 已打入（portable 自包含；开发环境需本机 Node 22）。

排查日志：`userData/logs/app.log` 与 `dsh.log`（`导出诊断信息` 菜单可一键打包）。
