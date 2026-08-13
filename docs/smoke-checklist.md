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

- [ ] 新建 Tab（+ 按钮），选择 provider（Claude / Codex / OpenCode / Kimi / Pi）
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
- [ ] Kimi: 设置页启用 Kimi → 模型目录加载 → 发送 prompt，确认流式回复与权限审批正常
- [ ] Pi: 发送 prompt，确认回复正常
- [ ] DeepSeek (dsh): 设置页启用 DeepSeek → CLI 路径留空（PATH 中的 `dsh`）→ Profile 填 DSH profile 名（如 `acp`）→ Provider 路由填 profile 中 llm 适配器的路由（如 `deepseek-official`）→ 发送 prompt，确认回复文本到达（DSH ACP 只输出完整文本，无 token 级流式）
- [ ] DeepSeek (dsh) Profile 自动供应: 填一个不存在的 profile 名（如 `acp-new`）→ 发送 prompt → 首次启动自动创建 profile（package.json + cordis.patch.yml + npm install，需要网络，约 1-3 分钟）→ 设置页「Profile 状态」行显示"Profile 已就绪"→ 后续启动秒级
- [ ] DeepSeek (dsh) Profile 修复按钮: 设置页「创建/修复」按钮 → 缺失 profile 被自动创建；存在但无 acp-agent 组合的 profile（如 `web`）→ 报错指引且不覆盖用户配置
- [ ] DeepSeek (dsh) bash 工具: 提示 agent 执行 `echo hello` → 回复包含命令输出（Windows 需 Git Bash；`npm` 重装 dsh/profile 后重跑 `node .context/dsh-integration/patch-windows-bash.mjs`）
- [ ] DeepSeek (dsh): 同一会话内追问，确认上下文延续；切换模型（重启进程）后发送 prompt，确认历史回灌且回复正常
- [ ] DeepSeek (dsh): 需要工具权限时（如 bash），确认 approval 弹窗出现并可批准/拒绝
- [ ] DeepSeek (dsh) 设置页「发现」区块: Skills / Agents / MCP 三个列表随 vault 内容实时显示（.claude/skills 放入 SKILL.md 后出现）
- [ ] DeepSeek (dsh) 技能真实加载: vault `.claude/skills/<name>/SKILL.md` → 发送提示词让 agent 使用该技能 → 回复体现技能指令生效
- [ ] DeepSeek (dsh) Agent mention 展开: 输入 `@代理名 (agent)` → 回复体现代理定义被注入（模型能说出代理的指令内容）
- [ ] DeepSeek (dsh) MCP: `.claude/mcp.json` 配置 stdio/http server → 设置页 MCP 列表显示"已注入" → 会话中模型可见 `mcp__<name>__*` 工具
- [ ] DeepSeek (dsh) 模型识别: 设置页模型选择器自动读取 `$DSH_HOME/profiles/<name>/cordis.patch.yml` 的 llm 模型列表（含 context window），无需启动子进程
- [ ] DeepSeek (dsh) 模型调用: 切换模型后发送 prompt，确认进程重启 + 历史回灌 + 新模型生效
- [ ] DeepSeek (dsh) 思考等级: 输入框齿轮选择 Off/High/Max → 发送 prompt → 确认进程重启；`--dump-config` 见 llm-deepseek 行 thinking/reasoningEffort 已钉（deepseek-official 路由）
- [ ] DeepSeek (dsh) 上下文显示: 聊天 UI 模型下拉与 usage 显示 profile 的真实 context window（如 1,000,000），不再是 128K 默认
- [ ] DeepSeek (dsh) Skill 发现: 设置 → Workspace 资源 → Skills 出现 `.claude/skills` / `.codex/skills` / `.agents/skills` 中的条目（标 dsh，只读）
- [ ] DeepSeek (dsh) Agent 发现: 输入 @ 触发 mention 列表，出现 `.claude/agents` / `.codex/agents` 中的代理
- [ ] DeepSeek (dsh) 图标: provider 选择器/模型下拉显示 DeepSeek 鲸鱼图标

## 拖拽上下文

- [ ] 从文件浏览器拖拽 .md 文件到输入框，确认文件加入上下文
- [ ] 拖拽多个文件，确认全部显示在 context tray

## Canvas 操作

- [ ] 在 Canvas 上右键节点 → Claudian Plus 子菜单 → "分析选中节点"
- [ ] "展开为大纲" → 确认结果写入 Canvas
- [ ] "建议邻居笔记" → 确认推荐面板出现
- [ ] Canvas 写入后 → undo → 确认撤销成功

## 编辑器集成

- [ ] 文件浏览器右键 → Claudian Plus → "发送到聊天"

## 性能

- [ ] 启动冷加载时间（Console 中 StartupProfiler 输出）
- [ ] 发送 prompt 到首次 token 出现的时间

## 无障碍

- [ ] Tab 键导航输入框和按钮
- [ ] 历史面板键盘滚动
- [ ] 高对比度主题下 UI 可读
