# 功能介绍

pi-desktop 的核心目标是把多个本地 pi Agent 会话收拢到一个稳定的桌面工作台里。

## 多项目工作区

- 添加、搜索、拖动排序和切换本地项目目录。
- 每个项目可以运行多个 Agent tab。
- 项目之间通过独立 cwd 和独立 pi RPC 进程隔离。
- 项目列表顶部提供内置 Chat 入口，适合不绑定代码目录的通用对话。

<img class="doc-screenshot" src="/images/overview.png" alt="工作区与对话界面">

## 会话管理

- 新建会话、恢复历史会话、重命名会话。
- 通过项目历史按钮、侧边栏或右键菜单操作会话。
- 支持将会话导出为 HTML。
- Agent 每轮回答完成后展示本轮修改文件名和修改行数。

## 输入增强

- `/` 斜线命令建议，例如 `/compact`、`/session`。
- `@` 文件引用建议。
- `!command` 和 `!!command` 可在聊天输入框中执行 Shell 命令。

<img class="doc-screenshot" src="/images/slash-commands.png" alt="斜线命令和历史会话">

## 文件与 Git

- 文件抽屉展示项目文件树。
- 文件项显示 Git 状态。
- 右键菜单支持打开文件、在系统文件管理器中定位文件。
- 顶部显示当前 Git 分支，并支持本地与远程分支切换。

<img class="doc-screenshot" src="/images/files.png" alt="文件树与会话操作">

## 工具调用展示

工具调用会聚合为可展开卡片，显示运行中、完成、失败等状态。对长任务来说，这比把所有调用明细直接堆进对话更容易扫描。

## 终端 Dock

当前 Agent 可以绑定独立终端 tab，支持 PowerShell、cmd、sh fallback、多 tab、主题切换、拖拽高度、右键复制选区和关闭确认。

<img class="doc-screenshot" src="/images/terminal.png" alt="终端 Dock 界面">
