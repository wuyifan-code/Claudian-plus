# Claudian Plus — Obsidian 实机 Smoke Checklist

> 版本: 3.0.1 · 日期: 2026-09-18
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
- [ ] 面板显示 "Claudian Plus" 标题
- [ ] 启动时 Console 无红色错误

## Tab 与会话

- [ ] 新建 Tab（+ 按钮），选择 provider（Claude / Codex / OpenCode / Kimi / Pi）
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

## Inline Edit

- [ ] 在 Markdown 编辑器选中文本 → Mod+K → 确认弹出 inline edit 面板
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
