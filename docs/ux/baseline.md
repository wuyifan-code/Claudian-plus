# 体验基线（Baseline）

> 测量时间：**3.2.7 发布后 2026-11-06**；上一轮为 2026-11-02（3.2.6，`be601da7`）。
> 这些数字是 **ratchet 上限**，不是参考值：只允许下降。每版发布后重跑第 6 节的命令并更新本文件。
> **逐文件的当前上限以 `tests/fixtures/ux-baseline.json` 为准**（由 `scripts/ux-baseline.mjs` 生成）；本文件只记录总览与分布。

## 1. 总览

| 指标 | 3.2.6 | 3.2.7 | 目标 | 负责版本 |
| --- | --- | --- | --- | --- |
| `new Notice(` 全库 | **299 处 / 46 文件** | **160 处 / 30 文件** | 面板外保留兜底 | 3.2.7 起逐版 |
| `new Notice(` chat 面 | **140 处 / 17 文件** | **0** | 3.2.7 后 0 ✅ | 3.2.7 |
| 直写英文 `new Notice('` | **60 处 / 14 文件** | **18 处 / 8 文件** | 3.2.9 后 0 | 3.2.9 |
| `localeText(` 全库 | **471 处 / 30 文件** | 471 处 / 30 文件 | 3.2.20 前 0 | 3.2.9 起 |
| `localeText(` chat 面 | **91 处 / 9 文件** | 91 处 / 9 文件 | 3.2.9 后 0 | 3.2.9 |
| CSS 模块 | **68 个** | **69 个**（新增 `feedback.css`） | 不新增未注册模块 | 每版 |
| 间距字面量（padding/margin/gap 带 px） | **628 处** | 628 处（新模块为 0） | 3.2.10 后降 80%+ | 3.2.10 |
| 圆角字面量 | **53 处 / 19 文件** | 53 处 | 3.2.10 后降 80%+ | 3.2.10 |
| 字号字面量（px） | **184 处 / 45 文件** | 184 处 | 3.2.10 后降 80%+ | 3.2.10 |
| `focus-visible` 选择器 | **22 条**（仅 `accessibility.css`） | 27 条（+5 条反馈控件） | 3.2.19 后覆盖全部可交互元素 | 3.2.19 |
| `toLocaleString(undefined)` | **4 处** | 4 处 | 3.2.9 后 0 | 3.2.9 |
| Obsidian 命令 / 默认快捷键 | **16 / 0** | **17 / 0**（+`open-feedback-log`） | 0 快捷键（规范） | 3.2.8 |
| 测试文件 | **443 个 `*.test.ts`** | **448 个** | 每版只增 | 每版 |
| `main.js` | **3,639,882 B**（预算 4,000,000） | **3,677,831 B**（+37.9 KB） | ≤5.0 MB | 每版 |
| `styles.css` | **323,564 B** | **342,336 B** | — | 每版 |
| GenUI 审计 | `flagged = 0`，5 项待真机 | 未复测 | 3.2.16 后 0 | 3.2.16 |
| smoke checklist 版本 | 3.1.1，条目未勾 | 新增 3.2.7 节 | 每版勾对应节 | 每版 |

> 3.2.7 之后全库仍剩的 160 处里，**1 处是反馈总线的回落**（`src/shared/feedback/FeedbackBus.ts`，无宿主时用），属于设计保留；其余 159 处在 chat 面之外，由后续版本逐版清理。

## 2. `new Notice(` 分布（3.2.6 起点：46 文件，299 处）

> **3.2.7 已把 chat 面 140 处全部迁完，chat 面现在为 0**；下表是起点记录，保留用于追溯。当前上限见 `tests/fixtures/ux-baseline.json`。

chat 面（140，**已清零**）：

| 文件 | 处 |
| --- | --- |
| `src/features/chat/controllers/InputController.ts` | 32 |
| `src/features/chat/CanvasNeighborsModal.ts` | 19 |
| `src/features/chat/tabs/Tab.ts` | 16 |
| `src/features/chat/controllers/ConversationController.ts` | 14 |
| `src/features/chat/ClaudianPlusView.ts` | 10 |
| `src/features/chat/rendering/MessageRenderer.ts` | 10 |
| `src/features/chat/actions/ActionableOutputController.ts` | 10 |
| `src/features/chat/fileMenu.ts` | 7 |
| `src/features/chat/ui/InputToolbar.ts` | 7 |
| `src/features/chat/tabs/TabManager.ts` | 6 |
| `src/features/chat/ui/FileContext.ts` | 2 |
| `src/features/chat/ui/ImageContext.ts` | 2 |
| `src/features/chat/actions/FloatingSelectionToolbar.ts` | 1 |
| `src/features/chat/composer/LivePreviewComposerEnhancement.ts` | 1 |
| `src/features/chat/QuickAgentInputModal.ts` | 1 |
| `src/features/chat/ui/StatusPanel.ts` | 1 |
| `src/features/chat/ui/TriggerModeManager.ts` | 1 |

chat 面之外（159）：

| 文件 | 处 |
| --- | --- |
| `src/main.ts` | 24 |
| `src/providers/opencode/ui/OpencodeAgentSettings.ts` | 14 |
| `src/shared/settings/McpSettingsManager.ts` | 13 |
| `src/features/settings/ClaudianPlusSettings.ts` | 11 |
| `src/providers/claude/ui/AgentSettings.ts` | 11 |
| `src/shared/settings/AgentSkillSettings.ts` | 10 |
| `src/providers/claude/ui/SlashCommandSettings.ts` | 10 |
| `src/providers/codex/ui/CodexSubagentSettings.ts` | 9 |
| `src/providers/claude/ui/PluginSettingsManager.ts` | 6 |
| `src/shared/settings/EnvSnippetManager.ts` | 6 |
| `src/providers/codex/ui/CodexSkillSettings.ts` | 6 |
| `src/features/settings/WorkspaceResourcesSettings.ts` | 5 |
| `src/providers/claude/runtime/ClaudeChatRuntime.ts` | 5 |
| `src/providers/claude/ui/ClaudeServiceSettings.ts` | 5 |
| `src/shared/modals/FileViewerModal.ts` | 4 |
| `src/shared/settings/McpServerModal.ts` | 4 |
| 其余 12 个文件（各 1–2 处） | 17 |

## 3. 裸英文 `new Notice('` 分布（60 处 / 14 文件）

| 文件 | 处 |
| --- | --- |
| `src/features/chat/controllers/InputController.ts` | 13 |
| `src/features/chat/CanvasNeighborsModal.ts` | 11 |
| `src/main.ts` | 9 |
| `src/features/chat/ClaudianPlusView.ts` | 6 |
| `src/features/chat/tabs/Tab.ts` | 5 |
| `src/features/chat/fileMenu.ts` | 3 |
| `src/providers/claude/runtime/ClaudeChatRuntime.ts` | 3 |
| `src/features/chat/ui/InputToolbar.ts` | 2 |
| `src/features/settings/ClaudianPlusSettings.ts` | 2 |
| `src/features/settings/WorkspaceResourcesSettings.ts` | 2 |
| 其余 4 个文件（各 1 处） | 4 |

## 4. `localeText(` 分布（471 处 / 30 文件；chat 面 91 处 / 9 文件）

| 文件 | 处 |
| --- | --- |
| `src/features/chat/rendering/MessageRenderer.ts` | 29 |
| `src/features/chat/controllers/ambientIndicator.ts` | 13 |
| `src/features/chat/actions/ActionableOutputController.ts` | 13 |
| `src/features/chat/actions/FloatingSelectionToolbar.ts` | 11 |
| `src/features/chat/QuickAgentInputModal.ts` | 8 |
| `src/features/chat/ClaudianPlusView.ts` | 6 |
| `src/features/chat/ui/TurnNavigator.ts` | 4 |
| `src/features/chat/actions/DiffReviewModal.ts` | 3 |
| `src/features/chat/controllers/ConversationController.ts` | 3 |
| 其余 21 个文件（settings / providers / shared） | 380 |

## 5. CSS 几何基线

| 类别 | 全库 | 其中 GenUI |
| --- | --- | --- |
| 间距字面量 | 628 | 1 |
| 圆角字面量 | 53 | 0 |
| 字号字面量 | 184 | 0 |

间距越轨最多的 12 个文件（3.2.10 优先处理）：

| 文件 | 处 |
| --- | --- |
| `src/style/settings/provider-model-picker.css` | 27 |
| `src/style/toolbar/model-selector.css` | 16 |
| `src/style/settings/tree-shell.css` | 15 |
| `src/style/settings/workspace-resources.css` | 10 |
| `src/style/settings/security.css` | 8 |
| `src/style/toolbar/thinking-selector.css` | 7 |
| `src/style/toolbar/mcp-selector.css` | 6 |
| `src/style/toolbar/external-context.css` | 4 |
| `src/style/toolbar/effort-slider.css` | 4 |
| `src/style/toolbar/permission-toggle.css` | 1 |
| `src/style/toolbar/mode-selector.css` | 1 |
| `src/style/settings/slash-settings.css` | 1 |

## 6. 复测命令

```powershell
# 总览
rg --stats "new Notice\(" src
rg --stats "new Notice\('" src
rg --stats "localeText\(" src
rg --stats "localeText\(" src/features/chat

# 按文件
rg -c "new Notice\(" src | Sort-Object -Descending
rg -c "new Notice\('" src | Sort-Object -Descending
rg -c "localeText\(" src | Sort-Object -Descending

# CSS
(rg --files src/style -g "*.css" | Measure-Object).Count
rg --stats "border-radius:\s*[0-9]+px" src/style
rg --stats "(padding|padding-top|padding-right|padding-bottom|padding-left|margin|margin-top|margin-right|margin-bottom|margin-left|gap|row-gap|column-gap):\s*[^;]*[0-9]+px" src/style
rg --stats "font-size:\s*[0-9]+px" src/style
rg -c "focus-visible" src/style/accessibility.css

# 其他
rg --stats "addCommand\(" src/main.ts
rg --stats "hotkeys:" src
(rg --files tests -g "*.test.ts" | Measure-Object).Count
Get-ChildItem main.js | Select-Object Length
```

## 7. Ratchet 初始化（3.2.7 落地）

1. 守卫测试读取 `tests/fixtures/ux-baseline.json`（3.2.7 建立），结构：
   ```json
   {
     "version": "3.2.7",
     "notices": { "src/main.ts": 24 },
     "rawLiterals": { "src/main.ts": 9 },
     "localeText": { "src/features/chat/...": 29 },
     "css": { "spacing": { "src/style/...": 27 }, "radius": {}, "fontSize": {} }
   }
   ```
2. 生成：`node scripts/ux-baseline.mjs --write`（**只在版本起点用**）。
3. 测试断言：当前计数 ≤ 基线；出现基线未记录的文件时计数必须为 0；chat 面合计必须为 0。
4. 降低基线是提交的一部分：每完成一个文件就手动删掉该键（缺席即 0）并提交，不允许"先降后忘"。
5. 不要用 `--write` 一键刷新；只允许手动改小的值，避免把回归洗进基线。
6. 唯一允许的 `new Notice(` 例外是 `src/shared/feedback/FeedbackBus.ts`
   （宿主未挂载时的回落），它在 `notice-ratchet.test.ts` 里以 allowlist
   形式显式声明，而不是记进基线。

## 8. 更新协议

每版发布后：

1. 重跑第 6 节命令。
2. 更新第 1 节总览与相关分布表。
3. 若某指标上升，先在 `roadmap.md` 状态表标注原因，再决定是修还是接受。
4. 在版本卡的"进度记录"写一行：`3.2.x 发布后：notices 299→…，localeText 471→…`。
