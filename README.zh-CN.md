# pi-desktop

[English](README.md)

一个用于管理多个 [pi](https://pi.dev) 编码 Agent 会话的桌面工作台。

`pi-desktop` 不是 pi 的分支，也不会重新实现 Agent 能力。它是一个轻量的 Electron 桌面外壳，通过启动多个 `pi --mode rpc` 进程，把项目、会话、文件、历史记录、模型状态和对话导航整合到一个桌面 UI 中。

![Status](https://img.shields.io/badge/status-experimental-orange)
![License](https://img.shields.io/badge/license-MIT-blue)
![Electron](https://img.shields.io/badge/Electron-38-47848f)
![React](https://img.shields.io/badge/React-19-61dafb)

## 功能特性

- **多项目工作区**
  - 添加和切换本地项目目录。
  - 同时打开多个 pi agent。
  - 按项目记住上次激活的 agent。

- **多 Agent 会话管理**
  - 为项目创建新的 agent。
  - 恢复历史 pi 会话。
  - 打开历史会话后展示之前的聊天记录。
  - 从侧边栏关闭运行中的 agent。

- **pi RPC 集成**
  - 通过 `pi --mode rpc` 启动 pi。
  - Agent 循环、工具调用、会话、模型、上下文、压缩和 provider 鉴权都仍由 pi 原生负责。
  - 支持通过 prompt 路径触发 pi 斜线命令。

- **对话界面**
  - Markdown 渲染，支持 GFM。
  - Assistant 消息流式显示。
  - 单条消息时间展示。
  - 单条消息复制。
  - 工具调用详情展开/收起。
  - 悬浮式对话定位目录，便于快速跳转。

- **文件与历史记录**
  - 文件抽屉，目录默认折叠并支持展开。
  - 基于项目文件的 `@` 模糊建议。
  - 文件右键操作：
    - 加入对话引用。
    - 默认方式打开。
    - 在文件夹中显示。
  - 历史会话抽屉。
  - 通过 pi RPC 将指定会话导出为 HTML。

- **模型与上下文状态**
  - 显示当前模型。
  - 显示 thinking level。
  - 显示上下文窗口使用率。
  - 显示缓存用量。
  - 快速切换模型。
  - 从 pi 可用模型列表中选择模型。
  - 快速切换 thinking level。

- **Git 信息**
  - 当前项目是 Git 仓库时显示当前分支。
  - 支持切换本地分支。

- **桌面端体验**
  - 类 WeChat 的三栏布局。
  - 项目/会话列表和右侧抽屉支持拖拽调整宽度。
  - 支持配置发送快捷键。
  - 支持浏览器预览模式，便于调试响应式 UI。

## 截图

### 工作区总览

![工作区总览](docs/images/overview.png)

### 历史会话抽屉

![历史会话抽屉](docs/images/history.png)

### 文件抽屉与右键菜单

![文件抽屉与右键菜单](docs/images/files.png)

### 对话、工具详情与运行状态

![对话与运行状态](docs/images/conversation.png)

## 架构设计

```txt
pi-desktop
├─ Electron Main Process
│  ├─ 管理项目记录
│  ├─ 启动 pi --mode rpc 进程
│  ├─ 桥接文件、会话、Git 操作
│  └─ 暴露安全 IPC API
│
├─ Electron Preload
│  └─ 向 Renderer 暴露 window.piDesktop
│
├─ React Renderer
│  ├─ 项目和 agent 列表
│  ├─ 聊天时间线
│  ├─ 文件 / 历史抽屉
│  ├─ 模型和上下文状态
│  └─ 设置 UI
│
└─ pi Runtime
   ├─ 每个 agent 一个独立 pi RPC 进程
   ├─ 独立项目 cwd
   └─ 使用 pi 原生会话 / 工具 / 模型 / 上下文
```

核心设计原则：

```txt
一个 Agent Tab = 一个 pi RPC 进程
```

这样可以隔离不同项目和不同会话的运行状态，避免上下文串扰，也能让 pi 继续负责它擅长的原生能力。

## 环境要求

- 推荐 Node.js 20+。
- npm。
- 系统 `PATH` 中可以直接访问 `pi` 命令。
- 已经完成 pi 的 provider / 登录 / API Key 配置。

检查 pi 是否可用：

```bash
pi --version
pi --mode rpc
```

## 快速开始

```bash
git clone https://github.com/ayuayue/pi-desktop.git
cd pi-desktop
npm install
npm run make-icon
npm run dev
```

应用会通过下面的命令启动 agent：

```bash
pi --mode rpc
```

所以请确保 `pi` 已经加入系统 `PATH`。

## 开发命令

### 启动开发模式

```bash
npm run dev
```

### 类型检查

```bash
npm run typecheck
```

### 构建 Electron/Vite 输出

```bash
npm run build
```

### 生成图标资源

```bash
npm run make-icon
```

输出文件：

```txt
build/icon.svg
```

## 浏览器预览模式

可以直接在浏览器中打开 Vite Renderer 地址进行布局调试：

```txt
http://localhost:5173/
```

当页面运行在普通浏览器中时，`window.piDesktop` 不存在。此时 Renderer 会自动使用 mock preview API，避免页面崩溃。

适合用浏览器预览检查：

- 布局
- 响应式
- 聊天样式
- Markdown 渲染

浏览器预览不能验证真实 Electron IPC，例如：

- 启动 pi agent
- 读取本地会话
- 打开文件
- 导出 HTML

这些能力需要在 Electron App 中验证。

## 项目结构

```txt
src/
├─ main/
│  ├─ fs/                 # 文件树服务
│  ├─ git/                # Git 分支服务
│  ├─ pi/                 # pi 进程和 RPC 管理
│  ├─ projects/           # 项目记录持久化
│  ├─ sessions/           # pi 会话扫描
│  ├─ settings/           # 应用设置持久化
│  └─ index.ts            # Electron main 入口
│
├─ preload/
│  └─ index.ts            # 安全 IPC 桥接
│
├─ renderer/
│  └─ src/
│     ├─ App.tsx          # 主界面
│     ├─ previewApi.ts    # 浏览器预览 fallback
│     ├─ styles.css       # 应用样式
│     └─ main.tsx         # React 入口
│
└─ shared/
   ├─ ipc.ts              # IPC channel 名称
   └─ types.ts            # 共享类型
```

## 实现说明

### 会话归属

`pi-desktop` 会读取 pi session 文件用于列表展示和摘要，但不会直接修改 pi 的 JSONL 会话文件。恢复会话、获取消息、导出 HTML 都通过 pi RPC 完成。

### 进程隔离

每个打开的 agent 都拥有独立的 `pi --mode rpc` 子进程。这样可以保持 cwd 隔离，避免多个 agent 共享运行状态。

### 文件操作

文件打开和定位尽量使用 Electron `shell` API：

- `shell.openPath`
- `shell.showItemInFolder`

这样可以交给操作系统处理默认打开方式，跨平台行为也更自然。

### 模型和 Thinking 控制

模型与 thinking 控制使用 pi RPC：

- `get_state`
- `get_session_stats`
- `get_available_models`
- `set_model`
- `cycle_model`
- `set_thinking_level`
- `cycle_thinking_level`

## 当前限制

- 暂未配置安装包打包。当前只构建 Electron/Vite 输出，不生成安装器。
- 图标目前只生成 SVG。Windows/macOS 发布需要继续生成 `.ico` / `.icns`。
- 浏览器预览模式使用 mock 数据，不能验证真实 Electron IPC。
- 文件右键菜单目前在 Renderer 中实现，后续可以升级为更原生的菜单体验。
- 会话解析是 best-effort，尽量兼容 pi session 格式变化。

## Roadmap

- 使用 `electron-builder` 或 Forge 增加安装包打包。
- 增加 CI，自动执行 type-check 和 build。
- 增加 demo GIF。
- 增加 Windows/macOS/Linux 原生图标。
- 模型搜索、provider 分组、最近使用模型。
- 更丰富的工具调用详情渲染。
- 文件多选和附件托盘。
- 会话导出后的打开/定位操作。
- 自动化 Electron UI 测试。

## 安全说明

本应用会启动本地 `pi` 进程，并通过 Electron IPC 暴露有限的本地文件操作。请只运行你信任的源码。

应用自身不会发送遥测，也不会主动上传文件。模型和 provider 的网络行为由 pi 以及你配置的 provider 决定。

## License

MIT
