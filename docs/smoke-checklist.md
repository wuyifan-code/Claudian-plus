# Claudian Plus — Obsidian 实机 Smoke Checklist

> 版本: 3.0.1 · 日期: 2026-09-13
>
> 此 checklist 供在 Obsidian 实机环境中逐项验证。必须在真实 Obsidian vault 中执行，
> 不得以单元测试替代。

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
