# Claudian Plus — Obsidian 实机 Smoke Checklist

> 版本: 3.1.1 · 日期: 2026-10-19
>
> 此 checklist 供在 Obsidian 实机环境中逐项验证。必须在真实 Obsidian vault 中执行，
> 不得以单元测试替代。
>
> 2026-09-18 更新：新增节省模式（R1）、长会话窗口渲染（R3）、流式渲染节流（R4a）、
> Inline Edit 与 Antigravity provider（默认禁用）四节。**以下所有条目目前均未在实机勾选**；
> 自动化测试只覆盖其中一部分，详见 `.context/plans/2026-09-18-execution-status.md`。

## 启动与基础

- [ ] 启动 Obsidian，确认 Claudian Plus 插件已启用（Settings → Community Plugins）
- [ ] 侧边栏图标出现（ribbon icon），点击打开 Claudian Plus 面板
- [ ] 面板顶部显示 Chat / Sessions 文字导航，且不重复显示产品标题
- [ ] 启动时 Console 无红色错误

## Tab 与会话

- [ ] 新建 Tab（+ 按钮），选择 provider（Claude / Codex / OpenCode / Kimi / Pi / Antigravity / DeepSeek Harness）
- [ ] 发送简单 prompt（如 "hello"），确认收到流式回复
- [ ] 关闭 Tab（标签页关闭按钮），重新打开面板，确认 Tab 恢复
- [ ] 多个 Tab 之间切换，确认状态保持

## 历史搜索

- [ ] 在历史面板搜索关键词，确认搜索结果正确
- [ ] 点击历史条目恢复对话，确认消息加载
- [ ] Rewind 到之前的 turn，确认 fork 分支正常

## Provider 兼容

- [ ] Claude: 发送 prompt，确认工具调用（如文件读写）正常
- [ ] Codex: 发送 prompt，确认回复正常
- [ ] OpenCode: 发送 prompt，确认回复正常
- [ ] Kimi: 设置页启用 Kimi → 模型目录加载 → 发送 prompt，确认流式回复与权限审批正常
- [ ] Pi: 发送 prompt，确认回复正常

## 拖拽上下文

- [ ] 从文件浏览器拖拽 .md 文件到输入框，确认文件加入上下文
- [ ] 拖拽多个文件，确认全部显示在 context tray

## Canvas 操作

- [ ] 在 Canvas 上右键节点 → Claudian Plus 子菜单 → "Analyze selected nodes"（分析选中节点）
- [ ] "Expand into an outline"（展开为大纲）→ 确认结果写入 Canvas
- [ ] "Suggest neighboring notes"（建议邻居笔记）→ 确认推荐面板出现
- [ ] "Find related notes"（查找相关笔记）→ 确认推荐列表出现
- [ ] Canvas 写入后 → undo → 确认撤销成功

## 编辑器集成

- [ ] 文件浏览器右键 → Claudian Plus → "Add folder to Claudian Plus"
- [ ] 文件右键 → Claudian Plus → "Ask Claudian Plus about this file" / "Summarize with Claudian Plus" / "Suggest tags with Claudian Plus"

## 性能

- [ ] 启动冷加载时间（Console 中 StartupProfiler 输出）
- [ ] 发送 prompt 到首次 token 出现的时间
- [ ] 记忆读缓存生效：连续发送 3 条以上消息后，`app.plugins.plugins['claudian-plus'].storage.getContentCache().stats.misses` 不随消息数增长（首轮之后应基本不变）
- [ ] 记忆读缓存不陈旧：在 Obsidian 中手工编辑 `.claudian-plus/memory.md` 后，下一条消息的注入内容能看到改动

## 无障碍

- [ ] Tab 键导航输入框和按钮
- [ ] 历史面板键盘滚动
- [ ] 高对比度主题下 UI 可读

## 节省模式与后台请求预算（R1）

- [ ] 设置 → General → Conversations：切换 "Saving mode"，确认 economy 下新会话不再发起 AI 标题请求（改用本地截断标题）
- [ ] economy 下正常发送消息，确认聊天不受影响、逐条回复正常
- [ ] economy 下手动点击标题重新生成，确认仍然会调用模型（手动操作不被策略拦截）
- [ ] 设置页 "Background requests today" 随自动标题/记忆合成增长，且不因手动操作增长
- [ ] 达到每日上限后自动后台请求被跳过，不弹重复错误、不进入重试循环
- [ ] 重启 Obsidian 后当日计数不清零；跨天后归零

## 长会话窗口渲染（R3）

- [ ] 打开 3000 条以上历史的会话，确认首屏只渲染最近若干条；滚动到顶部按批加载更早消息
- [ ] 加载更早消息时滚动位置不跳变（锚点稳定）
- [ ] 用历史搜索定位到很早的消息，确认目标消息进入渲染窗口并可见
- [ ] 工具/图片/阅读模式/历史 fork 按钮仍指向正确的原始消息
- [ ] 消息折叠状态在移出窗口后再移回时能够还原
- [ ] 切换会话后不出现上一个会话的窗口内容

## 流式渲染节流（R4a）

- [ ] 长回复流式输出时文本平滑更新，结束时正文完整（不丢最后一个字符）
- [ ] 点击停止后，已接收的文本仍然显示
- [ ] 隐藏/最小化窗口期间不产生大量 DOM 重绘，重新显示后正文完整

## 3.1.1 修复验证

- [ ] 达到标签页上限时，从文件右键菜单 / 命令面板发送到聊天：提示上限且不写入当前会话的输入框
- [ ] Antigravity 新建会话首轮后，上下文指示器显示非 0% 的合理百分比
- [ ] Antigravity 长会话（token 超过 200K）不再一直显示 100%
- [ ] 点击上下文指示器选择 300K / 600K / 1M，下一轮对话后百分比仍按所选窗口计算（不被弹回默认）
- [ ] 上下文指示器菜单选择"使用提供方默认值"后，百分比回到 Provider 自己的窗口
- [ ] 上下文指示器菜单点击空白处可关闭；键盘 Escape 可关闭
- [ ] Claude 对话不再每轮弹出 "Obsidian tools unavailable"
- [ ] Claude 中执行 `!命令`，Windows 上不闪控制台窗口
- [ ] 多步工具调用的回复折叠为一行摘要，展开后思考与工具按原顺序显示
- [ ] 从历史记录重放 Kimi / OpenCode / Pi / DeepSeek / Antigravity / Codex 会话，用户消息中不出现注入的 `<system_context>` 块
- [ ] 顶部 Provider 图标：Claude 保留橙色，其余 Provider 为主题黑白

## Inline Edit

- [ ] 在 Markdown 编辑器选中文本 → 命令面板执行 inline edit 命令 → 确认弹出 inline edit 面板（该命令默认不绑定热键）
- [ ] 提交指令后确认按 provider 返回修改结果并可应用/放弃

## Antigravity Provider（默认禁用）

- [ ] 设置 → Providers 中出现 Antigravity 且默认关闭；关闭状态下不启动 `agy` 进程
- [ ] 启用后填写/清空 CLI 路径，确认诊断信息刷新且不发起模型请求
- [ ] 手动填写模型 ID 后新建 Tab 发送 prompt，确认流式回复（需本机已登录 Antigravity CLI）
- [ ] 停止正在进行的回复，确认进程被终止，下一次发送仍能按会话 ID 续聊
- [ ] 关闭并重新打开插件后，该会话历史可见且多轮对话可继续
- [ ] 确认界面中不存在 "跳过权限"/权限绕过开关，也不显示技能/MCP/图片等未支持入口
- [ ] 确认设置文案未承诺供应商配额、剩余额度或每日免费次数
- [ ] 人为制造一次启动失败（例如填写不存在的 CLI 路径）后，设置页显示最近失败类别与时间
- [ ] 点击复制诊断快照，确认内容只含版本/CLI 解析结果/能力等信息，且不含绝对路径、邮箱或 token

## 生成式界面（Intelligent UI）手感与 Obsidian 兼容

> 2026-10-25 新增。本节的自动化覆盖情况：连续性/节流/工具条唯一/滚动保持由 `tests/unit/features/chat/rendering/ui/{reconcile,blockRenderer}.test.ts` 覆盖；过渡时长 token、状态态零位移、`overscroll-behavior`、窄栏 `min-width` 由 `tests/unit/style/generative-ui-motion.test.ts` 覆盖。**以下条目仍需实机勾选**，尤其主题、真机手感与窄栏观感无法用单测替代。

### 连续性（本轮改动的核心）

- [ ] Progress / Checklist 的数值变化是**过渡**而不是瞬跳（说明填充节点被原地收养）
- [ ] 拖动 Slider 时读数逐帧跟随、拖动过程不被重建打断；松手后状态正确提交
- [ ] 在 TextArea 里连续快速输入：不丢字、光标不跳、块不闪烁
- [ ] Tabs / Accordion 切换有过渡，展开/收起不是瞬切
- [ ] 同一条回答里同时有 Slider + Progress + Table + Form 时，操作其中一个不会让其他块闪一下（块级重建已被 scope 过滤）
- [ ] 块内滚动位置在交互后保持（长表格滚到中间点排序，位置不弹回顶部）

### 工具条与交互

- [ ] 每个 UI 块右上角只出现**一组**工具条；多次交互后不叠加
- [ ] 工具条 hover 出现、移开消失；进入块内控件焦点时仍可见（键盘可达）
- [ ] 复制（原始程序）/ 重置状态 / 放大 三个动作均可用；放大面板可 Escape 关闭
- [ ] 点击选择态（Tabs、Segmented、Diagram 节点、Radio）时文字**不抖动**（本轮已移除这些状态的字重变化）
- [ ] Radio 选中时圆环厚度与选中前一致，圆点不跳尺寸

### Obsidian 环境兼容

- [ ] 明色主题与暗色主题下，卡片/表格/图表/Stat 的颜色都来自主题变量，无硬编码色
- [ ] 至少在一个社区主题下复查一遍（自定义 `--background-modifier-*` 的主题最容易暴露问题）
- [ ] 系统开启"减弱动态效果"（prefers-reduced-motion）后，入场动画、手翻卡、按钮与开关过渡全部停止
- [ ] 侧边栏宽度拖到 ≈320–360px：Row / Grid / ChoiceCards / Steps / Stat / Timeline 自动收窄，**不出现横向滚动条**
- [ ] 表格与 Diagram 横向可滚动，且滚到底不会把滚动传导给消息列表（`overscroll-behavior: contain`）
- [ ] 键盘 Tab 顺序可走完一个 Form 的控件；焦点环可见

### Obsidian 原生组件

- [ ] NoteLink 点击打开对应笔记；不存在的笔记显示为弱化态且不会被创建
- [ ] Tag 点击打开搜索视图（该 API 非公开契约，失败时应静默降级）
- [ ] Mermaid / Image 在块内正常渲染；vault 相对路径图片可加载
- [ ] 默认关闭的"插入到当前笔记"需显式确认后才写入

### 已知边界（不是 bug，不必报）

- [ ] 同一条块内**同一帧（<16ms）内**连点两次选择，只保留最后一次写入 —— 人手操作不会触发，脚本/辅助技术可能
- [ ] 插入同类型兄弟节点会导致其后节点 key 顺移，那些节点的过渡会重播一次
- [ ] 流式输出阶段仍是整块重建（收养只作用于状态驱动的重渲染），流式结束定稿时才播一次入场动画
