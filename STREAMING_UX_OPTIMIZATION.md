# 流式输出交互体验优化方案

## 📋 问题分析

### 用户痛点
- 执行长时间任务时，只能看到卡片内容慢慢变化
- 缺乏对进度的感知，容易误以为软件卡住了
- 工具调用过程不够直观
- 完成后界面过于拥挤

### 参考案例
开源项目 **Proma** 的前端设计：
1. 实时展示思考链和工具调用流程
2. 任务完成后自动折叠中间过程
3. 清晰的视觉层次区分

---

## 🎨 优化方案

### 方案 A：渐进式优化（推荐）

**阶段 1：增强进度感知**
- ✅ 工具调用时显示"正在执行..."状态
- ✅ 添加进度指示器（1/3, 2/3, 3/3）
- ✅ 流式输出时高亮当前正在执行的步骤

**阶段 2：自动折叠**
- ✅ 完成后自动折叠工具调用详情
- ✅ 只保留工具调用摘要（数量和状态）
- ✅ 用户可点击展开查看详情

**阶段 3：视觉层次优化**
- ✅ 思考过程：浅灰背景，斜体
- ✅ 工具调用：蓝色边框，工具图标
- ✅ 最终回答：正常样式，突出显示

**阶段 4：流程可视化**
- ✅ 添加流程线连接各步骤
- ✅ 步骤完成时显示 ✓
- ✅ 执行失败时显示 ✗

### 方案 B：完整重构

类似 Proma 的完整实现：
- 独立的"执行面板"显示实时进度
- 瀑布流式展示思考→工具→结果
- 完成后可一键折叠整个执行过程

**优点**：体验最佳  
**缺点**：开发成本高，需要重构消息渲染逻辑

---

## 🚀 实施建议

### 推荐：采用方案 A（渐进式优化）

#### 第一步：进度指示器（1-2天）
```tsx
// 在 ToolGroup 中添加进度显示
<div className="tool-group-header">
  <span className="tool-progress">步骤 2/5</span>
  <span className="tool-status">● 正在执行</span>
</div>
```

#### 第二步：自动折叠（1天）
```tsx
// AgentRun 完成后默认折叠工具
const [collapsed, setCollapsed] = useState(true);

useEffect(() => {
  // 流式输出时展开，完成后折叠
  if (isStreaming) {
    setCollapsed(false);
  } else if (run.endedAt > 0) {
    setCollapsed(true);
  }
}, [isStreaming, run.endedAt]);
```

#### 第三步：视觉优化（1天）
```css
/* 思考过程 */
.thinking-bubble {
  background: var(--color-bg-muted);
  border-left: 3px solid var(--color-text-tertiary);
  font-style: italic;
  opacity: 0.8;
}

/* 工具调用 */
.tool-group {
  border-left: 3px solid var(--color-info);
  background: color-mix(in srgb, var(--color-info) 3%, transparent);
}

/* 流式输出高亮 */
.tool-group.streaming {
  border-left-color: var(--color-success);
  animation: pulse-border 2s ease-in-out infinite;
}
```

#### 第四步：流程线（1-2天）
```tsx
// 在 AgentRun 中添加步骤连接线
<div className="agent-run-timeline">
  <div className="timeline-step completed">
    <div className="timeline-dot">✓</div>
    <div className="timeline-line"></div>
  </div>
  <div className="timeline-step active">
    <div className="timeline-dot">●</div>
    <div className="timeline-line"></div>
  </div>
  <div className="timeline-step pending">
    <div className="timeline-dot">○</div>
  </div>
</div>
```

---

## 📐 技术实现细节

### 1. 流式状态管理

**当前状态**：
- `isStreaming` - 是否正在流式输出
- `activeThinking` - 当前思考内容

**需要添加**：
```tsx
// 在 App.tsx 中添加
const [streamingToolId, setStreamingToolId] = useState<string | null>(null);
const [completedToolIds, setCompletedToolIds] = useState<Set<string>>(new Set());
```

### 2. 工具调用进度追踪

监听工具调用事件：
```tsx
// tool_start 事件
case "tool_start":
  setStreamingToolId(event.toolCallId);
  
// tool_end 事件
case "tool_end":
  setStreamingToolId(null);
  setCompletedToolIds(prev => new Set([...prev, event.toolCallId]));
```

### 3. 自动折叠逻辑

```tsx
// 在 AgentRun 中
const isComplete = run.endedAt > 0;
const hasLongProcess = run.items.length > 3;
const [autoCollapsed, setAutoCollapsed] = useState(false);

useEffect(() => {
  if (isComplete && hasLongProcess && !autoCollapsed) {
    // 完成后 1 秒自动折叠
    const timer = setTimeout(() => {
      setCollapsed(true);
      setAutoCollapsed(true);
    }, 1000);
    return () => clearTimeout(timer);
  }
}, [isComplete, hasLongProcess, autoCollapsed]);
```

---

## ⏱️ 开发时间估算

### 阶段 1：进度感知（2-3天）
- [ ] 工具调用进度指示器
- [ ] 流式状态高亮
- [ ] "正在执行..."状态显示

### 阶段 2：自动折叠（1-2天）
- [ ] 完成后自动折叠逻辑
- [ ] 折叠/展开动画
- [ ] 摘要信息显示

### 阶段 3：视觉优化（1-2天）
- [ ] CSS 样式优化
- [ ] 颜色和图标调整
- [ ] 响应式适配

### 阶段 4：流程可视化（2-3天）
- [ ] Timeline 组件
- [ ] 步骤连接线
- [ ] 完成/失败状态图标

**总计：6-10 天**

---

## 🎯 最小可行方案（MVP）

如果时间有限，优先实现：

### 1️⃣ 进度指示器（必须）
在 ToolGroup 头部显示 "步骤 2/5 · 正在执行"

### 2️⃣ 流式高亮（必须）
正在执行的工具调用边框高亮

### 3️⃣ 自动折叠（重要）
完成后自动折叠，保留摘要

**MVP 开发时间：3-4 天**

---

## 🎨 UI 设计稿

### 执行中
```
┌─ Agent Run ──────────────────────┐
│ pi                    14:23:45   │
│                                   │
│ ┌─ 思考过程 ───────────────────┐│
│ │ 💭 我需要先读取文件...        ││
│ └───────────────────────────────┘│
│                                   │
│ ┌─ 步骤 1/3 · ● 正在执行 ──────┐│
│ │ 📄 Read file.ts               ││
│ │ ✓ 成功读取 1234 行             ││
│ └───────────────────────────────┘│
│                                   │
│ ┌─ 步骤 2/3 · ● 正在执行 ──────┐│◄── 高亮当前步骤
│ │ ✏️ Edit file.ts                ││
│ │ 正在修改...                    ││
│ └───────────────────────────────┘│
│                                   │
│ ○ 步骤 3/3 · 等待中               │
└───────────────────────────────────┘
```

### 完成后（折叠）
```
┌─ Agent Run ──────────────────────┐
│ pi                    14:23:50   │
│                                   │
│ ▸ 执行了 5 个操作（全部成功） ✓  │◄── 点击展开
│                                   │
│ 已完成文件修改，修改了 3 处代码。│
└───────────────────────────────────┘
```

---

## ✅ 验收标准

1. **进度可见**：用户能清楚看到"正在执行第几步"
2. **状态明确**：知道是在思考、调用工具还是生成回答
3. **完成反馈**：任务完成后有明确的完成提示
4. **界面整洁**：完成后自动折叠，保持界面简洁
5. **可回溯**：用户可以展开查看完整的执行过程

---

## 🔄 后续优化方向

1. **执行时长统计**：显示每个步骤耗时
2. **错误恢复提示**：失败时提示用户可以重试
3. **执行历史**：查看历史任务的执行过程
4. **并行执行可视化**：多个工具并行时的展示
5. **自定义折叠规则**：用户设置哪些步骤自动折叠

---

## 📝 总结

**建议采用渐进式优化方案（方案 A）**，原因：
1. ✅ 风险低 - 在现有基础上增强，不破坏现有功能
2. ✅ 成本可控 - 6-10 天完成，MVP 仅需 3-4 天
3. ✅ 体验提升明显 - 解决用户的核心痛点
4. ✅ 可持续迭代 - 分阶段实施，每个阶段都有价值

**优先级排序**：
1. 🔴 高优：进度指示器 + 流式高亮
2. 🟡 中优：自动折叠
3. 🟢 低优：视觉优化 + 流程线

是否要开始实施？我可以先做 **MVP 版本**（3-4天开发量），快速验证效果！
