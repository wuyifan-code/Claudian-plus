# Claudian Plus × Obsidian 深度整合 — 功能设计

> 状态：草案 · 日期：2025-07-28

---

## 1. 目标

让 Claudian Plus 从"侧边栏聊天窗口"升级为**嵌入 Obsidian 操作系统层级的 AI 外骨骼**——Agent 可以操作 Obsidian 原生数据结构（Canvas、Properties、Links），可以从编辑器、Canvas、文件浏览器等任何入口一键调用，可以持续理解并主动维护整个 Vault。

---

## 2. 三大模块

### 2.1 Agent 操作 Obsidian 原生对象

**现状：** Agent 把 Obsidian 当作文本文件集合，通过文件路径读写 markdown。Canvas（`*.canvas`）被 VaultKnowledgeEngine 排除。Properties（frontmatter）仅在 prompt 中出现，Agent 未将其作为结构化数据操作。Wiki-links 和反向链接关系对 Agent 不可见。

**目标：** 暴露 Obsidian 内部数据模型（Canvas 图、Properties 语义、Links 关系）为 Agent 可直接调用的工具。

#### 2.1.1 新增 Agent 工具

| 工具 | 输入 | 输出 | 功能 |
|------|------|------|------|
| `obsidian.canvas_read` | canvas 文件路径 | `{ nodes: [...], edges: [...] }` 结构化 JSON | 读取 Canvas 的完整图结构（节点 ID、类型、位置、内容文本、连线关系） |
| `obsidian.canvas_write` | canvas 路径 + 差异化操作（addNode / updateNode / deleteNode / addEdge / deleteEdge） | 操作结果 | 以编程方式修改 Canvas——创建思维导图分支、重组卡片位置、添加连线 |
| `obsidian.properties_get` | 文件路径（单文件）或 Dataview 查询（多文件） | `{ [path]: { key: value } }` | 读取 frontmatter 的结构化视图，类型感知（date 字段识别为日期而非字符串） |
| `obsidian.properties_set` | `{ path: string, set: { key: value }, delete?: string[] }` | 操作结果 | 批量设置/删除 frontmatter 字段，保留 YAML 格式和注释 |
| `obsidian.links_get` | 文件路径 | `{ outgoing: [{ target, displayText }], incoming: [{ source, context }] }` | 正向链接 + 反向链接 + 未解析链接（断链） |
| `obsidian.graph_neighbors` | 文件路径 + `depth?` (默认 1) | `[{ path, distance, linkCount }]` | 基于 Obsidian metadataCache 获取 1~2 度邻居，可用于自动扩展对话上下文 |
| `obsidian.dataview_query` | DQL 查询字符串 | 查询结果（表/列表/任务数组） | 执行 Dataview 查询；仅在用户 vault 已安装 Dataview 插件时可用，回退时给明确提示 |

#### 2.1.2 实现要点

- Canvas 读写：解析 `*.canvas` JSON（Obsidian Canvas 标准格式），通过 `obsidian.canvas_read` 返回简化视图，`obsidian.canvas_write` 生成合法的 Canvas JSON 补丁后写回文件
- Properties：复用 `app.metadataCache.getFileCache(file)?.frontmatter` 和 `app.fileManager.processFrontMatter()`，避免正则解析 frontmatter 的歧义
- Links：复用 `app.metadataCache.resolvedLinks` / `unresolvedLinks`，无需自行解析 wiki-link 语法
- Graph neighbors：依赖 `resolvedLinks` 构建邻接表，单次 BFS 即可获取 N 度邻居
- Dataview：通过 `app.plugins.getPlugin('dataview')` 检测可用性；执行路径：生成临时 note → 请求 Dataview API 执行 → 返回结果

#### 2.1.3 安全边界

- 所有文件操作限制在 vault 内（路径校验）
- Canvas 修改前 Agent 必须展示 diff 预览，由用户确认
- Properties 批量修改仅作用于 markdown 文件；模板文件（`templates/` 目录）默认排除
- Graph 遍历深度上限（默认 3），防止全库扫描

---

### 2.2 无处不在的 Agent 入口

**现状：** 用户必须打开侧边栏 → 选择/新建对话 → 输入 prompt。临时需求（"帮我改下这段"）摩擦大，打断心流。

**目标：** Agent 入口散布在 Obsidian 的各个角落，每种入口适配对应场景。

#### 2.2.1 入口矩阵

| 入口 | 触发方式 | UI 形态 | 对话模型 | 适用场景 |
|------|---------|---------|---------|---------|
| **编辑器浮动条** | 选中文字 → 浮出操作条 | Popover 浮层，带 3-5 个预设动作按钮 + "自定义"输入框 | 无持久对话，每次独立调用 | 写作中即时改写/翻译/解释/总结 |
| **编辑器内 @agent** | 输入 `@agent 帮我完善这段论证` | inline 替换：提交后光标位置显示加载动画，完成后替换为结果 | 无持久对话，每次独立调用 | 写作中自然语言指令，像 @mention 一样自然 |
| **Canvas 右键** | Canvas 节点上 右键 → Claudian Plus 子菜单 | 小浮窗输入 + 结果预览，确认后写入相邻节点或修改选中节点 | 可绑定到当前活动的 Tab 上下文 | 思维导图式协作——"基于这 3 个节点帮我展开成大纲" |
| **文件浏览器右键** | 文件/目录上 右键 → Claudian Plus 子菜单 | 复用侧边栏对话，自动把选中的文件加入上下文 | 新建或复用已有对话 | 项目级分析——"分析这个目录的代码结构" |
| **命令面板** | `Ctrl+P` → 搜索 "Claudian Plus:" | 预设命令列表：总结当前笔记、生成标签建议、修复断链、创建 MOC…… | 无对话窗口，静默执行后展示结果 | 一键无对话操作 |
| **全局快捷键** | 可配置快捷键 → 弹出浮动输入框 | 半透明浮动输入框，输入即发送，结果写入当前光标位置或弹窗展示 | 无持久对话 | 零摩擦即时调用 |

#### 2.2.2 实现要点

- **共享对话引擎**：所有入口复用 `ProviderRegistry.createRuntime`，通过 `query(turn, history, options)` 获取流式响应。轻量入口不渲染完整聊天 UI，只展示最终结果
- **浮动条**：基于 `@codemirror/view` 的 Tooltip/Widget 机制（项目已引入 CodeMirror 依赖），在选择变化时显示/隐藏
- **@agent inline**：通过 CodeMirror `Decoration` 标记 `@agent ...` 文本片段，在用户按 Enter/Ctrl+Enter 触发提交时替换为结果
- **Canvas 右键**：`obsidian.canvas` 节点的上下文菜单在 Obsidian Canvas API 中可注册（通过 `canvas.onNodeContextMenu` 事件）
- **文件浏览器右键**：Obsidian 的 `workspace.on('file-menu')` 事件
- **命令面板**：`plugin.addCommand(...)` 注册到 Obsidian 命令系统

#### 2.2.3 设计原则

- 每种入口的 UI 不打断当前工作流——轻量入口就地完成，重量入口才打开侧边栏
- 轻量入口的 provider/runtime 选择逻辑：优先使用侧边栏当前活动 Tab 的 provider；无活动 Tab 时使用默认 provider
- 结果预览优先——文件修改类操作先展示 diff，用户确认后写入

---

### 2.3 Vault 级别的全局智能

**现状：** Agent 仅在被 @mention 时才关注具体文件。不知道 vault 的整体结构、不发现孤立笔记、不推荐链接。

**目标：** Agent 持续理解整个 Vault 的知识结构，提供主动的智能服务。

#### 2.3.1 能力清单

| 能力 | 触发 | 说明 |
|------|------|------|
| **Vault 语义索引** | 启动时自动构建，文件变更时增量更新 | 本地嵌入向量索引，使 Agent 能回答"我的 vault 里有哪些关于 X 的笔记？"——比关键词搜索更语义化 |
| **Vault 健康面板** | 用户可随时打开查看 | 展示：孤立笔记（无入链）、断链目标、高度相似内容对、tags 使用分布、未完成 TODO 统计。每项可一键让 Agent 修复 |
| **周期性知识回顾** | 配置每日/每周/每月 | Agent 生成回顾报告："这周新增 12 篇，集中在项目管理 × 读书笔记。3 篇可能重复（链接到 diff 预览）。以下 5 个 TODO 过期未完成……" |
| **智能组织建议** | 按需或自动 | "最近 15 篇关于 Rust 的笔记分散在 4 个目录，要生成 MOC 索引页吗？""以下 tags 拼写不一致：`rust` vs `Rust` vs `rust-lang`，要统一吗？" |
| **链接推荐** | 编辑器中，保存文件时或手动触发 | 分析当前段落语义，推荐 vault 中高相关笔记作为链接候选项 |
| **全局对话上下文** | 对话中自动生效（可关闭） | 不再需要手动 @mention 所有相关文件——Agent 从语义索引中检索与当前话题最相关的笔记，自动注入上下文 |

#### 2.3.2 实现要点

- **语义索引**：技术上使用本地嵌入模型（如 `@xenova/transformers` 或 `onnxruntime`），在 Electron/Node 环境下运行，无需 GPU。首次构建全量扫描，后续通过 Obsidian 的 `vault.on('modify')` / `on('delete')` / `on('create')` 增量更新
- **健康面板**：在 `ClaudianPlusView` 中新增一个 Tab（"Vault"），类似 Settings 的子 Tab 结构
- **周期性回顾**：通过 `plugin.registerInterval()` 实现定时器（Obsidian 原生支持），回顾报告写入用户指定的目录
- **相似内容检测**：基于嵌入向量的余弦相似度 + 滑动窗口去重，避免 O(n²) 比较
- **链接推荐**：编辑器中当前段落的嵌入向量 vs 全库索引的 top-K 检索

#### 2.3.3 性能约束

- 语义索引首次构建在后台执行，不阻塞 UI。进度通过状态栏条展示
- 大 vault（>10,000 文件）：索引可配置排除目录（系统目录、附件目录等）
- 增量更新延迟 ≤ 5s（文件修改后 5s 内完成重新索引）
- 嵌入模型缓存到本地，不每次下载
- 嵌入计算使用 Web Worker 或 Worker Thread 避免阻塞主线程

---

## 3. 优先级路线图

```
Phase 1（基础设施 + 最高价值入口）
├── obsidian.canvas_read / canvas_write     ← Canvas 读写是 Obsidian 独有的杀手能力
├── obsidian.properties_get / properties_set ← 最常用的结构化操作
├── 编辑器浮动条                                ← 使用频率最高的入口
└── 全局对话上下文                              ← 对话体验质变

Phase 2（扩展入口 + 链接智能）
├── obsidian.links_get / graph_neighbors
├── @agent inline
├── Canvas 右键
├── 文件浏览器右键
└── 命令面板快捷操作

Phase 3（Vault 全局智能）
├── Vault 语义索引
├── Vault 健康面板
├── 链接推荐
├── 智能组织建议
└── 周期性回顾

Phase 4（全局快捷键 + 打磨）
├── 全局浮动输入框
├── 各入口的结果预览/确认流程
└── 性能优化、大 vault 适配
```

---

## 4. 技术风险与缓解

| 风险 | 缓解 |
|------|------|
| 嵌入模型体积大，首次下载慢 | 使用最小可用模型（~20MB），启动时后台静默下载，非阻塞 |
| Vault 超大（10000+ 文件）时索引慢 | 首次索引分批进行，记录进度可暂停/恢复；排除模式可配置 |
| Dataview 插件未安装时 `dataview_query` 不可用 | 工具声明为可选，运行时检测可用性并给出安装提示 |
| Canvas 直接操作可能破坏用户布局 | `canvas_write` 只输出 JSON 补丁 → 先预览 → 用户确认后写入 |
| 多个入口同时调用 runtime 导致资源竞争 | 入口层做去重/排队；轻量入口使用独立短生命周期 runtime |
