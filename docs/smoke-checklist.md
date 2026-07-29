# Claudian Plus — Obsidian 实机 Smoke Checklist

> 版本: 2.2.1 · 日期: 2026-07-29
>
> 此 checklist 供在 Obsidian 实机环境中逐项验证。必须在真实 Obsidian vault 中执行，
> 不得以单元测试替代。

## 启动与基础

- [ ] 启动 Obsidian，确认 Claudian Plus 插件已启用（Settings → Community Plugins）
- [ ] 侧边栏图标出现（ribbon icon），点击打开 Claudian Plus 面板
- [ ] 面板显示 "Claudian Plus" 标题
- [ ] 启动时 Console 无红色错误

## Tab 与会话

- [ ] 新建 Tab（+ 按钮），选择 provider（Claude / Codex / OpenCode / Pi）
- [ ] 发送简单 prompt（如 "hello"），确认收到流式回复
- [ ] 关闭 Tab（✕），重新打开面板，确认 Tab 恢复
- [ ] 多个 Tab 之间切换，确认状态保持

## 历史搜索

- [ ] 在历史面板搜索关键词，确认搜索结果正确
- [ ] 点击历史条目恢复对话，确认消息加载
- [ ] Rewind 到之前的 turn，确认 fork 分支正常

## Provider 兼容

- [ ] Claude: 发送 prompt，确认工具调用（如文件读写）正常
- [ ] Codex: 发送 prompt，确认回复正常
- [ ] OpenCode: 发送 prompt，确认回复正常
- [ ] Pi: 发送 prompt，确认回复正常

## 拖拽上下文

- [ ] 从文件浏览器拖拽 .md 文件到输入框，确认文件加入上下文
- [ ] 拖拽多个文件，确认全部显示在 context tray

## Canvas 操作

- [ ] 在 Canvas 上右键节点 → Claudian Plus 子菜单 → "分析选中节点"
- [ ] "展开为大纲" → 确认结果写入 Canvas
- [ ] "建议邻居笔记" → 确认推荐面板出现
- [ ] Canvas 写入后 → undo → 确认撤销成功

## Vault 检索与语义

- [ ] 输入 prompt 涉及 vault 内容 → 确认自动注入上下文（vault_context 标签）
- [ ] 打开 Vault Health panel → 确认显示文件统计、断链、孤儿笔记
- [ ] 确认语义索引状态显示（已初始化/索引中/就绪）
- [ ] 如果配置了 Ollama / OpenAI embedding → 确认语义 reranking 生效

## 洞察建议（新增）

- [ ] Vault Health → Tag inconsistencies 卡片出现（如果 vault 有标签不一致）
- [ ] 点击 "Normalize" → 确认弹出确认框 → 确认后标签统一
- [ ] Vault Health → MOC suggestions 卡片出现（如果主题跨目录散布）
- [ ] 点击 "Preview" → 确认弹出 MOC 内容预览
- [ ] 点击 "Create MOC" → 确认弹出确认框 → 确认后文件创建成功

## 编辑器集成

- [ ] 选中文字 → 浮动工具栏出现 → 选择动作（解释/翻译/重写）
- [ ] 输入 `@agent 指令` → 按 Enter 触发 → 确认 inline 替换
- [ ] 文件浏览器右键 → Claudian Plus → "发送到聊天"

## 性能

- [ ] 启动冷加载时间（Console 中 StartupProfiler 输出）
- [ ] 发送 prompt 到首次 token 出现的时间
- [ ] 大 vault（>1000 文件）下 vault health panel 加载时间
- [ ] 语义索引后台构建时不阻塞 UI

## 无障碍

- [ ] Tab 键导航输入框和按钮
- [ ] 历史面板键盘滚动
- [ ] 高对比度主题下 UI 可读
