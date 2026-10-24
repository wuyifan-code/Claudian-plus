# 生成式界面（Intelligent UI）实现计划

> **给实现者：** 本计划按里程碑执行，每个里程碑遵循仓库现有 TDD 流程（`tests/` 镜像 `src/`，先写失败测试）。开工前先读 §2 的约束清单——其中三条（bundle 余量、无消息持久化、无 iframe）决定了架构，不是建议。

**目标：** 让 Claudian Plus 的 Agent 能用一份声明式界面程序代替纯 Markdown 回答，渲染成可交互、可计算、随 Obsidian 主题自适应的原生 DOM，并能把用户的操作结果带回对话。

**技术栈：** TypeScript、Obsidian DOM API（`createDiv`/`createEl`/`setIcon`）、esbuild（`bundle: true`、`format: cjs`）、Jest（`testEnvironment: 'node'`）。

**参考：** 两份原始材料已在 `.context/` 落地，研究简报在 `.context/research/`。

| 材料 | 位置 |
| --- | --- |
| OpenUI 参考实现（MIT） | `.context/open-intelligent-ui/` |
| OpenUI 官方 agent 规范 | `.context/skills-repo/skills/openui/` |
| ZCode 宿主文档 + 源码 | `.context/ZCode/` |
| 研究简报 | `.context/research/{openui-brief,zcode-host-brief,claudian-integration-map}.md` |

---

## 0. 结论先行

1. 两份文档说的是**同一件事的两端**：一份定义"模型该输出什么"（声明式语言 + 组件目录 + 交互状态），另一份定义"宿主该怎么接住它"（隔离、状态延续、回流对话）。二者互补，不是竞品。
2. 两份文档的**共同内核**是：回答的最终形态不是文本，而是一个**可执行界面程序**；而这个程序必须通过一条**窄协议**交给宿主渲染，并且用户交互**默认不触发模型回合**。
3. 对 Claudian Plus，**必须走"原生声明式渲染"**，不能走 ZCode 的"agent 写 HTML + iframe 沙箱"：插件当前 HTML 全转义、零 iframe、bundle 只剩 40,610 B。这条约束把选型直接锁死。
4. 传输走**文本围栏**（模型在正常回复里写 ` ```claudian-ui ` 块），不走工具调用——这是唯一能同时满足 7 个 provider、历史重放、无需 provider 改造的方案。
5. 词汇表**不进系统提示词常驻**，而是做成 **vault skill**（渐进披露），把每轮 8.5k token 的固定成本降到约 0.1k。

---

## 1. 先对齐：两份文档到底在讲同一件事

### 1.1 各自的定位

- **`open-intelligent-ui`（OpenUI）** 回答的是"**生成格式**"问题：模型吐什么文本、宿主怎么把它变成界面、界面里的状态怎么算。它的产物是一个语言（OpenUI Lang 1.0）+ 一个组件目录（library spec）+ 一套流式解析/求值语义。
- **`ZCode/UI_PLUGIN.md`** 回答的是"**宿主协议**"问题：一段 Agent 产出的界面凭什么能出现在聊天里、以什么身份运行、状态存在哪、用户点完之后怎么回到对话。它的产物是一套桥接 API（MCP Apps + `window.zcode`）+ 一套沙箱/限额/生命周期规则。

换句话说：OpenUI 是**内容标准**，ZCode 是**投递标准**。一个完整的"Intelligent UI"产品=两者之并。

### 1.2 七条共同点

| # | 共同点 | OpenUI 侧 | ZCode 侧 | 对我们的含义 |
| --- | --- | --- | --- | --- |
| 1 | 回答的终态是**界面程序**，不是文本 | `root = Col(...)` 程序流 | agent 生成 HTML 片段 | 渲染器是必须品，不是增强 |
| 2 | 有**显式协议边界**隔开生成与渲染 | Lang 文本 ⇄ parser ⇄ library spec | 页面 ⇄ bridge ⇄ 宿主能力 | 边界要定死，且要能单独演进 |
| 3 | 模型看到的是一份**能力目录** | 系统提示由 `library.ts` 生成 | 文档化的 `window.zcode` API 表 | 目录才是产品本体，渲染器只是执行器 |
| 4 | 状态是**宿主侧一等公民**，与渲染分离 | `$var` 在一个 store，变更→重算 props | `widgetState` / `{modelContent,privateContent}` | 状态必须存在 DOM 之外 |
| 5 | 交互**默认不触发模型回合** | 只有 `@ToAssistant` 走 `onAction` | 保存状态不算提交，需显式 follow-up | 省 token，也防自动失控 |
| 6 | 回流通道**窄且视为不可信** | action 事件带 `formState`/`context` | `<untrusted_gen_ui_state>` 围栏 | 回流必须过"不可信上下文"标记 |
| 7 | 失败时**删掉最小坏单元**，不废掉整答 | 逐条 error code 降级 | UI 工具失败退化为普通工具行 | 容错要细粒度，不能整块报错 |

补充两条暗线：两者都把**原始 HTML/JS 当成需要付代价的能力**（OpenUI 只在 `HtmlView` 里开 `sandbox="allow-scripts"`；ZCode 要上专用 scheme + Electron 分区；二者的默认路径都是"组件而非 HTML"）；两者都把**限流/限额**写进协议（OpenUI 提示 ~8k token、要求低推理档；ZCode 硬限 64/16/32 KiB 与 16 KiB 状态）。

### 1.3 两条根本差异（决定取舍）

| 维度 | OpenUI | ZCode |
| --- | --- | --- |
| 渲染底座 | **受控组件目录**（React，我们换成原生 DOM） | **任意 HTML/JS** 跑在沙箱页里 |
| 换来的 | 安全、可主题化、体积小、无沙箱 | 表达力无上限、游戏/canvas 都能跑 |
| 代价 | 词汇表要自己维护，模型只能用它认识的组件 | 必须自建沙箱栈，且**拿不到宿主的主题** |
| 关键结论 | ✅ 与 Obsidian 现状契合 | ❌ 与 Obsidian 现状冲突 |

**架构结论：拿 OpenUI 的"格式"，拿 ZCode 的"协议与状态延续"，底座用 Obsidian 原生 DOM。**

---

## 2. 硬约束清单（已实测）

| 约束 | 实测值 | 影响 |
| --- | --- | --- |
| bundle 上限 | `scripts/check-startup-performance.mjs:20` → `mainBudgetBytes = 3_850_000` | 超限 CI 直接 fail |
| 当前产物 | `…\.obsidian\plugins\claudian-plus\main.js` = **3,759,390 B** | **余量 40,610 B（1.07%）** |
| 结论 | React + `react-dom` 单独就超限 | **禁止引入任何 UI 框架/OpenUI 运行时依赖** |
| HTML 策略 | `src/utils/markdownHtml.ts` 先转义，再由**唯一一处** `MarkdownRenderer.render`（`MessageRenderer.ts:1317`）渲染 | 模型 HTML 永远渲不出来——这个不变量要保住 |
| iframe | `src/` 内零 iframe、零 `innerHTML`、零 DOM 净化库 | ZCode 那套沙箱页方案没有落脚点 |
| 消息持久化 | 插件只持久化 `SessionMetadata`（`core/types/chat.ts:120`），`Conversation.messages` 由各 provider 原生 transcript 重建 | **界面程序必须能从文本重新解析出来**，否则刷新即丢 |
| 渲染时机 | 流式期间每 ≤100 ms 整块重渲染（`StreamController.MIN_STREAM_RENDER_INTERVAL_MS:98`，`renderContent` 首行 `el.empty()`） | 必须容忍半截程序；组件实例要能被反复重建 |
| 历史虚拟化 | `MessageRenderWindow.ts:4-8`：初始 40 / 上限 120 节点，滚出即销毁 | **交互状态不能放在 DOM 里** |
| 测试环境 | `testEnvironment: 'node'` + `tests/helpers/mockElement.ts`（491 行 mock DOM） | 渲染器要么写在这个子集上，要么新开 jsdom project |

---

## 3. 目标架构

### 3.1 分层

```
provider 原生流 ──► StreamChunk(text) ──► StreamController（不动）
                                              │
                                              ▼
                              MessageRenderer.renderContent()
                                              │
                        ┌─────────────────────┴─────────────────────┐
                        │  ① UiFenceSplitter（新增，纯函数）          │
                        │     markdown → [prose, ui-fence, prose]   │
                        └─────────────────────┬─────────────────────┘
                              prose ──► MarkdownRenderer（不变）
                              fence ──► ② StreamingProgramParser（容错、增量）
                                              │
                                              ▼
                                        ③ Evaluator（表达式 + @functions + $vars）
                                              │
                                              ▼
                                        ④ UiBlockRenderer（DocNode → Obsidian DOM）
                                              ▲
                                              ⑤ UiStateStore（messageId 键，DOM 之外）
                                              │
                        ⑥ UiActionBridge ──► InputController / 下一条用户回合
```

职责划分严格按仓库既有架构规则：

- ①③ 解析与求值 —— 纯函数，无 DOM 依赖，放 `src/features/chat/rendering/ui/`。
- ④ 渲染 —— 只能在 `features/`，绝不能进 `core/`（架构守卫 `scripts/check-architecture-boundaries.test.mjs` 会拦）。
- ⑤⑥ 状态与回流 —— `features/chat/`，通过 `InputController` 既有入口注入用户消息。

### 3.2 为什么传输必须走"文本围栏"

| 方案 | provider 改造 | 刷新可重放 | 流式友好 | 判定 |
| --- | --- | --- | --- | --- |
| **A. 文本围栏** | 0 | ✅ transcript 里就是文本 | ✅ 天然增量 | **选它** |
| B. 新增 `ContentBlock.kind='ui'` | 需改 6 个 history mapper + 10 处 dispatch，且闭合 union 无编译期保护 | ⚠️ 需自行持久化 | 需新建累加器 | 作为 A 的**下游数据形态**，不作为入口 |
| C. 工具调用 `render_ui` | 每个 provider 的工具注册能力不同（DSH `supportsMcpTools:false`），且 `toolUseResult` 只有 Claude/ACP 稳定 | ✅ | ✅ | 后续可选增强 |

A、B 不是互斥的：**入口用 A（文本），在 `MessageRenderer` 内合并为 B（结构化 block）再交给渲染器**，这样将来换 provider 原生通道（如 DSH 的 `deliverables/presented`）时，渲染器不用改。

两侧文档都支持这个选择：OpenUI Lang 明确"若文本含代码围栏，只读围栏内容"；ZCode Gen UI 的触发也是**纯文本指令** `::visualize{"path":...}` 而非工具调用。

### 3.3 语言示例（MVP 语法）

````markdown
```claudian-ui
root = Col([head, prefs, summary], 4)
head = Row([Title("重构方案对比"), Badge("3 个候选", "info")], 2)
prefs = Card([SegmentedControl($mode, ["保守", "激进"], "策略"), Slider($hours, 1, 40, null, "每周投入", "h")], "soft")
summary = Card([Table(["项", "值"], [["总工时", $hours], ["预计收益", @Round($hours * 2.5, 1)]])])
```
````

语法取 OpenUI Lang 的**内核**，砍掉查询/变更/编辑态：

- 一行一个 `name = expression`，`root` 必须在第一行（决定渐进渲染的第一帧）。
- 参数**位置传参**（这是 OpenUI 的硬约定，冒号命名参数会静默失败）。
- 引用可先用后定义；未解析引用渲染为"空"而不是报错。
- 表达式：算术、比较、`&&`/`||`/`!`、三元、成员/下标访问；`@Each(list, "x", template)` 做列表映射。
- `$var = 默认值` 声明可变状态；控件首参接 `$var` 即双向绑定；`@Set`/`@Reset` 写值。
- 内置函数只保留约 20 个纯函数（`@Count/@Sum/@Avg/@Min/@Max/@Round/@Filter/@Sort/@Each/@Format/...`）。

### 3.4 状态模型（借 ZCode 的双通道）

沿用 ZCode 已验证的拆法，落到 Obsidian 的持久化现实上：

| 通道 | 内容 | 存放 | 是否进模型上下文 |
| --- | --- | --- | --- |
| `private` | 全部控件状态（滑块值、选中项、展开态） | `UiStateStore`（内存）+ `SessionMetadata.uiState` | ❌ |
| `model` | 经白名单挑选的、语义化的少量键值 | 同上，`SessionMetadata.uiState[v].modelContent` | ✅ 仅在下一次**用户主动**发送时注入 |

注入形态照抄 ZCode：`<untrusted_ui_state>{"messageId":…,"state":{…}}</untrusted_ui_state>`，并配 `stripUiStateContext()` 在展示/重放时移除，避免脏上下文堆积。限额沿用其量级：单条 ≤ 16 KiB，整会话 ≤ 64 KiB。

`SessionMetadata` 是本仓库唯一被持久化的层——把状态放这里，**不需要发明消息持久化**，也绕开了"插件不存消息"这个最大的坑。

### 3.5 交互回流（"能用的工具"而非"好看的卡片"）

| Action | 语义 | 实现 |
| --- | --- | --- |
| `@Set($v, expr)` / `@Reset($v, …)` | 纯本地重算 | 写 store → 重算 → patch DOM，**不发请求** |
| `@ToAssistant(text, context?)` | 唯一"回话"入口 | 转发 `InputController`，作为用户消息 + 上文 `stripUiStateContext` 边界 |
| `@OpenUrl(url)` | 打开外链 | 仅 `http(s)`，经 `shell.openExternal`/`window.open` |
| `@Copy(text)` | 复制 | `navigator.clipboard` |

三条硬规则（两份文档一致，也必须进测试）：

1. 改控件**永不**自动起回合；只有 `@ToAssistant` 且必须有用户手势才提交。
2. `@ToAssistant` 产生的用户消息里，界面上下文一律带"不可信"标记。
3. 同一份程序重复到达（Claude 会增量发一遍再在终态重发）必须幂等，不能出现两份界面。

### 3.6 安全不变量（写成测试）

1. **零 `innerHTML`。** 所有文本 → `createEl({text})` / `textContent`。渲染器模块内出现 `innerHTML` 即测试失败。
2. **颜色白名单。** 只接受 `ink/muted/faint/surface/info/success/warning/danger/...` 与 `/^#[0-9a-f]{3,8}$/i`；拒绝 `url(`、`var(`、`expression(`、`javascript:`。OpenUI 对模型写的 CSS 也是这么过滤的。
3. **URL 白名单。** 仅 `http(s):`；`Image` 在 MVP 只接受 vault 相对路径与 `data:`，**不加载远程图片**（浏览器会带 referer 泄露上下文；本插件没有服务端可代理）。
4. **无 iframe、无 `<script>`、无 `eval`。** 与当前零 iframe 姿态一致；`HtmlView` 类能力进 Phase 5 单独评估，默认不做。
5. **不求值不可信表达式。** 解析器不执行模型写的"代码"，只执行我们实现的白名单节点。

---

## 4. 组件词汇表（MVP 与后续）

| 分层 | MVP（M1–M3） | 后续 |
| --- | --- | --- |
| 布局 | `Col` `Row` `Box` `Grid` `Card` `Divider` `Spacer` | `Carousel` `Popover` |
| 文本 | `Title` `Text` `Caption` `Badge` `List` `ListItem` `Code` `Quote` | `Markdown`（复用现有渲染）`Math` |
| 输入 | `Button` `Pressable` `Input` `Select` `Checkbox` `SegmentedControl` | `Slider` `RadioGroup` `DatePicker` `Form` |
| 数据 | `Table` | `Chart`(bar/line/pie，纯 SVG) `Svg` 原语 `Image` |
| 明确不做 | `Map`（MapLibre，体积+网络）、`HtmlView`（沙箱）、`Timer`、`Celebration` | — |

MVP 15 个组件足以覆盖"对比表/方案卡/可调参数/清单勾选"这几类高频回答；`Chart` 放在 M4，因为它把"能算"升级为"能看懂"。

---

## 5. 提示词经济性

OpenUI 的完整系统提示是 **34,127 B ≈ 8.5k token**——逐轮常驻对 Codex/DSH 这类无缓存的 provider 是不可接受的成本。

采用**渐进披露**：

| 模式 | 常驻成本 | 触发方式 |
| --- | --- | --- |
| `off`（默认关） | 0 | 用户不用 |
| `skill`（推荐默认开） | ≈120 token 一行能力说明 + 按需加载 skill | 模型判断"这题适合出界面"时读 `.claude/skills/obsidian-ui/SKILL.md`（Codex 走 `.codex/skills/`） |
| `always` | ≈2–3k token（**精简版**词汇表，非 8.5k） | 追求稳定命中的重度用户 |

要点：
- 词汇表做成 **vault skill**，纯 Markdown，用户可改、可版本化，且不占 bundle。
- 系统提示只加一行指针，挂在 `src/core/prompt/mainAgent.ts:9` 的 `appendices` 槽位——该管线已接通（`getAppendixSections` `:161`、`buildSystemPrompt` `:190`），但**目前没有任何调用方传入**，正是现成的接入点。
- skill 里的规范**由代码生成**（一个脚本从组件注册表导出 Markdown），避免 OpenUI 那边已经发生的"文档与实现漂移"（其 18 条规则里有 4 条没同步进生成的提示词）。
- 前缀保持字节稳定，别在中间插入时间戳，否则 Claude 的 prompt cache 失效。

---

## 6. 分阶段计划

### M0：可行性尖刺（半天，先做，出数据再开工）

**Files:** `.context/spikes/ui-size/`（不入库）

- [ ] 写一个最小解析器 + 5 个组件的骨架，跑 `npm run build`，量 `main.js` 增量。
- [ ] 判定：增量 ≤ 40,610 B → 直接进 M1；否则在 `scripts/check-startup-performance.mjs:20` 把上限提到 **3,860,000 B**，并在同文件写注释说明取舍（启动评估阈值 50 ms 不受影响）。
- [ ] 验证 `renderContent` 内做围栏切分不会破坏 LaTeX/图片嵌入/文件链接三条既有后处理。

**产物：** 一个数字（字节增量）+ 一个决定（是否提预算）。

### M1：围栏识别 + 只读渲染（最小可用）

**Files:**
- New: `src/features/chat/rendering/ui/fenceSplitter.ts`、`ui/parser.ts`、`ui/documents.ts`、`src/features/chat/rendering/UiBlockRenderer.ts`、`src/style/components/generative-ui.css`
- Modify: `src/features/chat/rendering/MessageRenderer.ts`（`renderContent` 切分点 `:1296`）、`src/style/index.css`

- [ ] **测试先行** `tests/unit/features/chat/rendering/ui/fenceSplitter.test.ts`：普通文本不动；单围栏切三段；未闭合围栏在流式态不抛错；围栏内语言名不匹配则按普通代码块处理。
- [ ] 实现 `splitUiFences(markdown): Segment[]`（纯函数，无 DOM）。
- [ ] **测试先行** `tests/unit/features/chat/rendering/ui/parser.test.ts`：`root` 识别、位置传参、先用后定义、半截字符串/括号自动闭合、未知组件整条丢弃。
- [ ] 实现容错解析器（目标 ≤400 行），产出 `DocNode` 树。
- [ ] 实现 `UiBlockRenderer`：布局 6 + 文本 6 + `Table`，全部 `createDiv/createEl`，class 前缀 `claudian-plus-ui-`。
- [ ] 在 `MessageRenderer.renderContent` 中接入：**仅 role=assistant 的 text block**；thinking/用户文本一律不解析。
- [ ] 接 CSS：`src/style/components/generative-ui.css` + 在 `src/style/index.css` 注册；只用 `base/tokens.css` 的变量（字面色值会触发 `tests/unit/style/style-tokens.test.ts` 失败）。

**验收：** 手写一份程序塞进 mock 消息能渲染；流式重渲染 20 帧不闪、不重复。

### M2：表达式与计算（让它"会算"）

- [ ] 求值器：算术/比较/逻辑/三元/成员访问/下标。
- [ ] `@Each` 与其内联作用域。
- [ ] 约 20 个纯函数（聚合、排序过滤、取整、格式化、日期）。
- [ ] 错误降级：单表达式失败 → 该 prop 置空，其余照常渲染。

**验收：** 表格里的汇总值由表达式算出而非模型硬编码（这正是不返回对话也能用的关键）。

### M3：交互状态（让它"能动"）

- [ ] `UiStateStore`：键 `(messageId, fenceIndex)`；实现 `set/get/subscribe`。
- [ ] `$var` 绑定 + `@Set/@Reset`；控件变更 → 重算 → **patch 而非整树重建**。
- [ ] 与 `MessageRenderWindow` 的销毁/重建对齐：实例注销但状态保留（这是 120 节点淘汰下界面不丢状态的唯一办法）。
- [ ] 读模式（`Conversation.readingMode`）下界面默认折叠为一行摘要 + 展开，沿用 `rendering/collapsible.ts` 约定，保证 `[aria-expanded]` 状态能被窗口重挂载恢复。

**验收：** 拖动滑块后滚出视口再滚回，数值仍在。

### M4：回流对话 + 状态延续（闭环）

- [ ] `@ToAssistant` → `InputController` 注入用户消息（带手势校验）。
- [ ] `modelContent` 白名单挑选 + `<untrusted_ui_state>` 上下文注入 + strip 还原。
- [ ] `SessionMetadata.uiState` 持久化（16 KiB/条、64 KiB/会话限额 + 超限丢弃策略）。
- [ ] `Chart`（bar/line/pie，纯 SVG，~150 行）。

**验收：** 刷新 Obsidian 后界面与状态都还在；点按钮产生的回合里，模型能读到界面状态。

### M5：打磨与开关

- [ ] 设置项（`app/settings/defaultSettings.ts:23` + `ClaudianPlusSettings`）：三档模式、最大渲染高度、是否允许外链。
- [ ] i18n：10 个 locale 文件 + `TranslationKey` 类型同步（漏了会回退成裸 key）。
- [ ] 大纲/导航集成（`outlineExtraction.ts` 目前只认 4 种节点）。
- [ ] 渲染失败的可观测降级：围栏解析失败时按**普通代码块**展示，并给一条可复制的诊断。
- [ ] 可选：` ```openui ` 别名（模型可能按训练习惯写这个）。

### 不做 / 待评估

- `HtmlView`（iframe 沙箱）、`Map`、任意远程图片、MCP Apps 式的"插件提供持久界面"。
- DSH provider 的原生通道：`dshRecords.ts:16` 的 `deliverables/presented` 事件目前**收到即丢弃**，可能是天然的结构化通道——但需要先抓一份真实运行时 trace 才能定论，且 DSH 默认关闭。

---

## 7. 验收与验证

```bash
npm run typecheck && npm run lint && npm run test && npm run build
npm run check:performance        # bundle 预算
```

手工冒烟（至少 3 个 provider，Codex 为默认）：

1. 问一个天然适合界面的问题（"对比三种方案，让我调参数看总工时"），确认出界面而非 Markdown。
2. 交互一轮 → 确认不发请求（看网络/日志）。
3. 点 `@ToAssistant` → 确认产生 1 个用户回合，且带界面状态。
4. 切走再切回、滚出视口再滚回、刷新应用——三次都不能丢状态。
5. 故意让它输出坏程序（未知组件/半截括号）→ 必须降级成代码块或部分渲染，**不能空白**。
6. 暗色/亮色主题各看一遍；确认没有硬编码颜色。

新增测试必须有：安全不变量 5 条各一个用例、围栏切分的 4 个用例、流式幂等用例、窗口淘汰重建用例。

---

## 8. 风险登记

| # | 风险 | 等级 | 应对 |
| --- | --- | --- | --- |
| 1 | 40 KB 余量不够 | 高 | M0 先量；不够就显式提预算并写明取舍，别偷偷踩线 |
| 2 | 流式半截程序抖动/闪烁 | 高 | 保留"最后一个可渲染完整程序"；解析失败继续显示上一帧 |
| 3 | 模型不听话，围栏写坏 | 高 | 容错解析 + 降级成代码块 + `always` 模式提高命中；skill 里给 few-shot |
| 4 | 小模型（非前沿模型）生成质量差 | 中 | 词汇表越小越稳；先只推布局+表格+输入，复杂组件按需开 |
| 5 | 交互状态与虚拟化冲突 | 中 | 状态必须在 store，绝不放 DOM；M3 专门测 |
| 6 | 提示词被中间截断（Ollama 类 4k 上下文） | 中 | 用 skill 按需加载，而不是常驻 8.5k |
| 7 | 远程资源带来隐私/安全面 | 中 | MVP 禁远程图片；外链仅 http(s) 且需手势 |
| 8 | 文档与实现漂移 | 中 | skill 由注册表脚本生成，CI 里 diff 校验 |

---

## 9. 需要拍板的三个决定

1. ~~**预算**：若 M0 测得超 40,610 B，是否同意把上限提到 3,860,000 B？~~
   **已由 M0 数据回答：不需要提预算。** 实测 +21,514 B，仍在 40,610 B 余量之内。但**剩余余量只剩 19,096 B**，见 §10.3 的后续预算纪律。
2. **默认模式**：`off` 还是 `skill`？
   建议：`skill`（默认开，但零常驻成本）。用户只在真正需要时看到界面，不需要时只是多读一个 skill 的几百 token。
3. **MVP 功能边界**：`Chart` 放 M4（建议）还是砍到 M5？

---

## 10. M0 结果（已完成，2026-10-22）

### 10.1 实测数据

| 项目 | 数值 |
| --- | --- |
| 官方基线 `main.js`（已安装产物） | 3,759,390 B |
| 加入 UI 内核后 | **3,780,904 B** |
| **增量** | **+21,514 B（21.0 KB）** |
| 预算上限 | 3,800,000 B |
| **剩余余量** | **19,096 B** |
| CLI 近似构建交叉校验 | +21,578 B（与官方差 64 B，近似法可信） |
| `npm run check:performance` | **通过**（exit 0；冷启动评估 346.8 ms 是既有 warning，非本次引入） |
| `tsc --noEmit` | 通过 |
| `eslint`（新文件） | 0 error / 11 style warning（`element.style.*` 建议改 CSS 类） |
| 新增单测 | **31 passed**（fenceSplitter 9 / parser 12 / evaluate 10） |
| `MessageRenderer.test.ts` 回归 | **105 passed**，Markdown 漏斗未被破坏 |

增量覆盖的范围（已真实跑通，不是空壳）：围栏切分 + 容错流式解析器（含 tokenizer、位置传参、先用后定义、表达式优先级、三元、成员/下标、@函数、@Each）+ 求值器（22 个内置函数、5 个 action）+ 19 个组件的原生 DOM 渲染 + 状态 store + 块级渲染器。

**结论：架构可行，且不需要动预算。**

### 10.2 M0 已产出的代码（M1 直接复用）

| 文件 | 内容 |
| --- | --- |
| `src/features/chat/rendering/ui/fenceSplitter.ts` | 围栏切分（字节保真，未闭合围栏按流式保留） |
| `src/features/chat/rendering/ui/parser.ts` | 容错解析器，流式截断不抛错 |
| `src/features/chat/rendering/ui/evaluate.ts` | 求值器 + 内置函数 + action |
| `src/features/chat/rendering/ui/components.ts` | 19 个组件的 DOM 构建 + 颜色白名单 |
| `src/features/chat/rendering/ui/stateStore.ts` | DOM 之外的状态 store |
| `src/features/chat/rendering/UiBlockRenderer.ts` | 程序 → DOM，失败保留上一帧 |
| `MessageRenderer.renderContent` | 改为先切围栏再分发；原漏斗保留为私有 `renderMarkdownContent` |

已验证的关键不变量：无围栏时**字节级走原路径**（math / 图片嵌入 / wikilink 三条后处理完全不变，有测试锁定）；模型写的内容全程走 `textContent`/`createEl({text})`，无 `innerHTML`。

### 10.3 M0 暴露的三个问题（已在 M1 处理完毕）

1. ~~**`messageId` 没接进来**~~ → 两条路径都打通：`renderMessageMarkdown(..., msg.id)` 覆盖历史消息，`StreamController.activeAssistantMessageId` 覆盖流式渲染；并新增 `RenderContentOptions.allowUi`，保证只有助手文本能渲染程序（用户文本与思考块仍按原样显示代码块）。
2. ~~**每帧重解析**~~ → `parseUiProgramCached`（32 条上限）按源码缓存解析结果。
3. ~~**无 CSS 模块**~~ → `src/style/components/generative-ui.css` 已注册进 `index.css`，`styles.css` 已重新生成（257,172 B）。

### 10.4 环境坑（下次会话直接用）

- `npm install` 在受限沙箱下会因生命周期脚本 `spawn EPERM` 失败 → 加 `--ignore-scripts`。
- `npm run build` 会 `execSync` 子进程，受限沙箱下必然失败 → 需要完全权限，或直接用 `node_modules\@esbuild\win32-x64\esbuild.exe` 跑 CLI 近似构建（注意 CLI 构建会少掉 LICENSE banner 与自定义插件，只适合比较**增量**）。
- 仓库里 tracked 的 `styles.css` 与 `build-css` 产物**本来就不一致**（差 621 B）。这是既有漂移，与本功能无关；本次因新增 CSS 模块而重新生成，属于有意更新。

## 11. 实现完成度与真机验证

### 11.1 最终数据（干净构建，不含临时预览入口）

| 项 | 值 |
| --- | --- |
| 官方基线 `main.js` | 3,759,390 B |
| 最终产物 | **3,785,964 B** |
| 净增量 | **+26,574 B** |
| 预算上限 / 剩余 | 3,800,000 B / **14,036 B** |
| `npm run check:performance` | 通过（exit 0） |
| `tsc --noEmit` / `npm run lint` | 通过 / 0 error |
| `styles.css` | 257,172 B（+13,357 B，新模块并入） |
| 渲染层单测 | 500 passed（19 套） |

### 11.2 里程碑逐项

| 里程碑 | 状态 | 说明 |
| --- | --- | --- |
| M1 围栏识别 + 只读渲染 | 完成 | 切分 / 容错解析 / 19 个组件；补齐 `messageId`、解析缓存、CSS 模块 |
| M2 表达式与计算 | 完成 | 22 个内置函数、`@Each`、逐表达式降级 |
| M3 交互状态 | 完成 | `$var` / `@Set` / `@Reset`；store 按 `blockKey` 键控；**修复流式重渲染导致的 store 订阅泄漏**（单测锁定）；消息被窗口淘汰时 `disposeUiBlocksUnder` 释放 |
| M4 回流对话 | 完成 | `@ToAssistant` → `InputController.sendMessage`，上下文包在 `<untrusted_ui_state>`（16k 上限）；`@OpenUrl` 仅 http(s)；`@Copy`；`Chart`（bar/line/area/pie/donut，纯 SVG） |
| M5 打磨 | 部分 | 已做：渲染失败降级为代码块、`openui` 别名、沿用现有折叠约定。未做：设置三档开关、i18n 文案、大纲节点类型 |

### 11.3 真机验证（Kimi computer use，截图见 `.context/verification/`）

在真实 Obsidian 1.14.4 + Creative Vault 中完成：

1. 装入构建产物并冷启动 Obsidian → 插件加载无报错，命令面板可见其命令。
2. 渲染样例程序 → Title / Badge / Card / Table（数值由 `@Round` / `@Format` / `@Percent` 计算，非硬编码）/ SVG 柱状图（跟随主题色）/ SegmentedControl 全部正确。
3. 点击分段控件「紧凑」→ 文案由「均衡」变为「紧凑」，证明 *状态 → 重算 → 重渲染* 链路打通，且状态保存在 DOM 之外。
4. 点击「按这个方案继续」→ `@ToAssistant` 回调带着 `{pace, days}` 触发。
5. 删除临时预览入口后重新构建、重新装入并**重新加载 Obsidian** → 无报错、命令已消失，发布面干净。

> 临时预览命令仅用于验证，验证后已删除；最终产物与验证时版本的差异仅此入口。

### 11.4 有意留到后续

- 设置三档（`off` / `skill` / `always`）与由注册表生成 skill 文档的脚本。
- i18n（10 个 locale 文件 + `TranslationKey`）。
- 大纲/导航把界面块当作节点。
- `Svg` 原语、`Map`、`HtmlView` 与远程图片——按 §4 的边界继续不做。

---

## 附录：关键文件索引

| 用途 | 位置 |
| --- | --- |
| 唯一 Markdown 渲染漏斗 | `src/features/chat/rendering/MessageRenderer.ts:1296`（`renderContent`） |
| 助手块循环（结构化载荷落点） | `src/features/chat/rendering/MessageRenderer.ts:810-886` |
| 流式分发 | `src/features/chat/controllers/StreamController.ts:150`（`handleStreamChunk`） |
| 文本块提交 | `src/features/chat/controllers/StreamController.ts:851`（`finalizeCurrentTextBlock`） |
| 内容块/流块契约 | `src/core/types/chat.ts:32`、`:154` |
| 持久化边界 | `src/core/types/chat.ts:120`（`SessionMetadata`） |
| HTML 转义不变量 | `src/utils/markdownHtml.ts` |
| 提示词附录槽位 | `src/core/prompt/mainAgent.ts:9`（`appendices`，当前未用） |
| 样式模块注册 | `src/style/index.css` |
| bundle 预算 | `scripts/check-startup-performance.mjs:20` |
| 窗口虚拟化 | `src/features/chat/rendering/MessageRenderWindow.ts:4-8` |
| 测试 DOM 子集 | `tests/helpers/mockElement.ts` |
