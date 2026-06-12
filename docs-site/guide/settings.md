# 配置与 Skills

pi-desktop 提供图形化配置入口，减少频繁查找和编辑 pi 配置文件的成本。

## 配置管理

配置弹窗包含以下页面：

- Models：Provider 卡片、模型网格和连接测试。
- Auth：API Key 管理。
- Settings：类型感知的键值编辑器。
- 源文件：查看和编辑原始 JSON。
- Skills：管理全局 Skills。

<img class="doc-screenshot" src="/images/config.png" alt="配置管理界面">

## pi 路径

应用启动时会自动检测系统中的 `pi` 命令。自动检测失败时，可以在设置中手动输入路径。

Windows 下支持常见路径形式：

```text
"C:\Program Files\pi\pi.cmd"
C:\\Program Files\\pi\\pi.cmd
C:\Program Files\pi\pi
```

## 代理设置

pi-desktop 区分两类代理：

- pi agent 子进程代理：影响实际 Agent 进程。
- 桌面端代理：影响模型拉取、连接测试等桌面应用请求。

这种拆分可以避免桌面端检测和 Agent 执行互相干扰。

## Skills 管理

Skills 页面支持查看全局 Skill、创建模板、启用或禁用、删除和打开目录。删除操作会使用应用内确认弹窗，避免误删。
