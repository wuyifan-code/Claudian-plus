# Claudian Plus Code Wiki

> 本文档对 Claudian Plus 仓库进行结构化梳理，覆盖整体架构、模块职责、关键类型/类/函数、依赖关系以及构建运行方式。
> 仓库版本：`3.0.1`（见 [package.json](../package.json) / [manifest.json](../manifest.json)）。

---

## 目录

1. [项目概览](#1-项目概览)
2. [整体架构](#2-整体架构)
3. [目录与模块职责](#3-目录与模块职责)
4. [核心契约与关键类型](#4-核心契约与关键类型)
5. [关键类与函数说明](#5-关键类与函数说明)
6. [Provider 适配层详解](#6-provider-适配层详解)
7. [Feature 层详解](#7-feature-层详解)
8. [Memory / Consciousness 子系统](#8-memory--consciousness-子系统)
9. [依赖关系图](#9-依赖关系图)
10. [存储布局](#10-存储布局)
11. [构建与运行](#11-构建与运行)
12. [测试体系](#12-测试体系)
13. [开发约定与陷阱](#13-开发约定与陷阱)

---

## 1. 项目概览

**Claudian Plus** 是一个仅桌面端的 Obsidian 插件（`isDesktopOnly: true`），把编码 Agent（Codex、Claude、OpenCode、Kimi、Pi）嵌入 Obsidian 侧边栏。设计目标：

- **本地优先**：会话、记忆、Provider 会话都保存在 Vault 内（`.claudian-plus/`），无遥测。
- **Provider 可插拔**：五个 Provider 通过 `ProviderRegistry` 与 `ProviderWorkspaceRegistry` 接入，共享 `Conversation` 模型与 `ChatRuntime` 契约，但保留各自的运行时协议、历史格式、权限流。
- **Codex 优先**：默认 Provider 为 Codex，默认模型 `gpt-5.6-sol`（见 [src/app/settings/defaultSettings.ts](../src/app/settings/defaultSettings.ts)）。
- **Vault 即工作区**：`@note` / `@folder` 上下文、Canvas/Properties/links 读写、知识索引、意识机制等围绕笔记展开。

上游来源：基于 [Claudian](https://github.com/YishenTu/claudian)（MIT）与 [Codian](https://github.com/BCS1037/codian)（AGPL-3.0）二次开发，详见 [README.md](../README.md) 的 "Upstream projects" 章节。

---

## 2. 整体架构

### 2.1 分层模型

```text
┌────────────────────────────────────────────────────────────────────┐
│ Obsidian Plugin Shell (src/main.ts: ClaudianPlusPlugin extends Plugin)│
│  - 注册 View / Command / Ribbon / Settings Tab                      │
│  - 装配 ProviderHost、SettingsCoordinator、ConversationRepository   │
│  - 启动 Memory / Consciousness / Dream 后台任务          │
└──────────────┬─────────────────────────────────────────────────────┘
               │ FeatureHost 接口（扩展 ProviderHost）
┌──────────────▼─────────────────────────────────────────────────────┐
│ Feature Layer (src/features/*)                                     │
│  chat/ │ settings/                                                │
│  依赖 core 契约 + ProviderHost/FeatureHost，禁止 import provider 实现 │
└──────────────┬─────────────────────────────────────────────────────┘
               │ ChatRuntime / ProviderCapabilities / StreamChunk
┌──────────────▼─────────────────────────────────────────────────────┐
│ Core Layer (src/core/*)                                            │
│  providers/ runtime/ types/ storage/ bootstrap/ mcp/ memory/        │
│  skills/ security/ obsidian/ performance/ ...            │
│  Provider-neutral 契约，禁止反向依赖 provider 实现                  │
└──────────────┬─────────────────────────────────────────────────────┘
               │ ProviderRegistration / ProviderWorkspaceRegistration
┌──────────────▼─────────────────────────────────────────────────────┐
│ Provider Layer (src/providers/*)                                   │
│  claude/ │ codex/ │ opencode/ │ pi/ │ acp/ (shared ACP transport)  │
│  实现 core 契约；通过 ProviderRegistry / ProviderWorkspaceRegistry 注册│
└────────────────────────────────────────────────────────────────────┘
```

### 2.2 关键设计原则（来自 [AGENTS.md](../AGENTS.md)）

- **Provider 不对等**：每个 Provider 的 capabilities、UI 配置、settings 归一化各自实现，feature 代码不可假设 parity。
- **Feature → core 契约，不 → provider 内部**：`Conversation.providerState` 对 feature 是不透明 bag，provider 自有字段必须藏在 provider 目录下的 typed helper 之后。
- **Live streaming ≠ History replay**：实时输出走 provider 运行时协议；transcript 文件只用于历史回放。
- **Provider-native 优先**：尽量复用 provider 原生能力，在边界做适配而不是本地重建。
- **新 provider 行为必须通过 registry/capability 表达**：`ProviderRegistry`、`ProviderWorkspaceRegistry`、`ProviderChatUIConfig`、provider-owned settings reconciliation。

### 2.3 启动流程（[src/main.ts](../src/main.ts) `onload`）

1. `patchSetMaxListenersForElectron()` 在任何 SDK import 之前修补 Electron 兼容性。
2. `StartupProfiler.finishModuleEvaluation()` 标记模块求值完成。
3. 动态 `import('./providers')` → `registerBuiltInProviders()` 注册五个 Provider 到两个 registry。
4. `loadSettings({ deferNonRestoredSessionMetadata: true })`：并行加载 settings 与 tabManagerState，迁移 Claude service 设置，归一化 plan mode 与 provider selection，仅同步加载已恢复 tab 的会话元数据，剩余延后到 `onLayoutReady` 之后。
5. 绑定 `ClaudePlusPlugin` 到 vault 事件。
6. 启动定时器：Dream（每小时检查 + 启动后 30s 一次启动梦境）。
7. 启动后 3s 检测 legacy `.claudian/` 数据并提示。
8. 若 `consciousnessEnabled`，懒加载并初始化 `ConsciousnessEngine`。
9. 注册 `VIEW_TYPE_CLAUDIAN_PLUS` 视图、ribbon 图标、文件菜单以及一系列命令（Open chat view、New tab/session、Quick agent input、Undo last canvas write、Scan vault knowledge、Summarize/Suggest tags/Create MOC、Dream、Cleanup expired memories 等）。
10. 注册 `ClaudianPlusSettingTab`，调度剩余会话元数据加载。

`onunload`：冻结 `StartupProfiler`、持久化打开 tab 状态、停止 `ObsidianToolBridge`、`ProviderWorkspaceRegistry.disposeInitialized()`。

---

## 3. 目录与模块职责

### 3.1 顶层布局

| 路径 | 职责 |
| --- | --- |
| `src/app/` | 共享 settings 默认值、插件级 storage helper、Conversation 仓储、ProviderHost 实现 |
| `src/core/` | Provider-neutral 运行时、registry、storage、工具、类型契约 |
| `src/providers/*/` | Provider 适配器、provider-owned 运行时协议、历史、storage、settings、UI |
| `src/features/chat/` | 侧边栏 chat 编排（基于 core 契约） |
| `src/features/settings/` | 共享 settings shell 与 provider tab 装配 |
| `src/shared/` | 可复用 UI 组件（dropdown、modal、mention、settings section 等） |
| `src/style/` | 模块化 CSS，构建为 `styles.css` |
| `src/i18n/` | 多语言（en/zh-CN/zh-TW/ja/ko/de/es/fr/pt/ru） |
| `scripts/` | 构建、CSS 合并、架构边界检查、版本同步、性能检查、测试运行器 |
| `tests/` | `src/` 的镜像测试（`unit/` 与 `integration/`） |
| `docs/` | `CODE_WIKI.md`、`smoke-checklist.md`、图片资源 `assets/`、已归档设计文档 `plans/archive/` |
| `.github/workflows/` | CI、release、claude review、stale、duplicate-issues |
| `.context/` | 非提交的笔记（`notes/`）、探针与性能夹具（`probes/`）、baseline JSON（按 AGENTS.md 约定） |

### 3.2 `src/core/` 模块（见 [src/core/AGENTS.md](../src/core/AGENTS.md)）

| 子模块 | 职责 |
| --- | --- |
| `bootstrap/` | Provider-neutral 会话元数据存储、共享 app-storage 契约、`StoragePaths`、tabManagerState |
| `commands/builtInCommands.ts` | 跨 provider 内建命令 |
| `mcp/` | Provider-neutral MCP 协调与配置解析（`McpConfigParser`、`McpServerManager`、`McpTester`） |
| `prompt/` | 共享 prompt 模板（mainAgent / instructionRefine / titleGeneration / dreamMemory） |
| `providers/` | Registry、capability、environment、model-routing、workspace-service 契约（见 §4） |
| `providers/commands/` | 共享命令目录契约（`ProviderCommandCatalog`、`ProviderCommandEntry`、hidden commands） |
| `runtime/` | `ChatRuntime`、`QueuedTurn`、`SubprocessRunner`、`compactCommand`、runtime types |
| `security/` | `ApprovalManager` 权限/审批 helper |
| `storage/` | 通用 vault/home filesystem adapter（`VaultFileAdapter`、`HomeFileAdapter`、`pathContainment`、`NotifiedMutationError`） |
| `tools/` | 共享工具常量与格式化（`toolNames`、`toolIcons`、`toolInput`、`toolResultContent`、`todo`） |
| `types/` | 共享类型（chat / settings / provider / tools / agent / mcp / plugins / diff / index） |
| `auxiliary/` | `AuxQueryRunner` 与基于 query 的 instruction refine / title generation service |
| `memory/` | 意识机制、梦境、记忆提取/存储、Vault 知识引擎（见 §8） |
| `obsidian/` | Obsidian 工具桥（Canvas/Properties/links/portable tool runtime） |
| `skills/` | `AgentSkill`、`AgentSkillCodec`、`AgentSkillRepository`、`validateAgentSkill` |
| `performance/` | `StartupProfiler` 启动性能追踪 |

### 3.3 `src/features/chat/`（见 [src/features/chat/AGENTS.md](../src/features/chat/AGENTS.md)）

| 子模块 | 职责 |
| --- | --- |
| `ClaudianPlusView.ts` | 生命周期、装配、active-tab 编排（继承 `ItemView`） |
| `state/ChatState.ts` + `types.ts` | 每 tab 的状态与持久化输入 |
| `controllers/` | `ConversationController`、`StreamController`、`InputController`、`NavigationController`、`SelectionController`、`BrowserSelectionController`、`CanvasSelectionController`、`TurnCoordinator` |
| `rendering/` | `MessageRenderer`、`ToolCallRenderer`、`ThinkingBlockRenderer`、`DiffRenderer`、`WriteEditRenderer`、`SubagentRenderer`、`InlineAskUserQuestion`、`InlineExitPlanMode`、`InlineOptionList`、`InlinePlanApproval`、`collapsible`、`todoUtils` |
| `tabs/` | `TabManager`、`TabBar`、`Tab`、`TabSession`、`RuntimeSupervisor`、provider resolution |
| `ui/` | `InputToolbar`、`StatusPanel`、`NavigationSidebar`、`ComposerContextTray`、`FileContext`、`ImageContext`、各 mode manager、`ConstellationCubeWelcome`、dragDrop、textareaResize、file-context chip |
| `composer/` | `LivePreviewComposer`、`LivePreviewInputBridge`、`VaultContextDropController` |
| `services/` | `BangBashService`、`MentionCacheCoordinator`、`SubagentManager` |
| `utils/` | `conversationDirectoryTitle`、`usageInfo` |
| `CanvasNeighborsModal.ts` / `QuickAgentInputModal.ts` / `rewind.ts` / `fileMenu.ts` / `constants.ts` | 各类 modal 与工具入口 |

### 3.4 `src/features/settings/`

- `ClaudianPlusSettings.ts`：共享 settings shell，按 provider 装配 tab。
- `AgentSkillManagementCoordinator.ts`：共享 vault agent skill 管理。
- `keyboardNavigation.ts`、`workspaceResources.ts`：辅助。

### 3.5 `src/providers/`

| Provider | 入口文件 | 传输方式 | 默认启用 |
| --- | --- | --- | --- |
| Codex | [src/providers/codex/](../src/providers/codex/) | `codex app-server` stdio JSON-RPC 2.0 | 是（`enabled: true`，见 `defaultSettings.ts`） |
| Claude | [src/providers/claude/](../src/providers/claude/) | `@anthropic-ai/claude-agent-sdk` + Claude Code CLI 兼容 | 是（注册表内置，`DEFAULT_CHAT_PROVIDER_ID = 'claude'`，但实际默认聊天 provider 是 codex） |
| OpenCode | [src/providers/opencode/](../src/providers/opencode/) | Agent Client Protocol over `opencode acp` 子进程 | 否 |
| Kimi | [src/providers/kimi/](../src/providers/kimi/) | Agent Client Protocol over `kimi acp` 子进程 | 否 |
| Pi | [src/providers/pi/](../src/providers/pi/) | `pi --mode rpc` 子进程 | 否 |
| ACP（共享） | [src/providers/acp/](../src/providers/acp/) | 共享 ACP 客户端连接、JSON-RPC transport、session normalizer、tool stream adapter | — |

注册入口 [src/providers/index.ts](../src/providers/index.ts)：

```typescript
export const BUILT_IN_PROVIDER_MODULES = [
  claudeProviderRegistration,
  codexProviderRegistration,
  opencodeProviderRegistration,
  kimiProviderRegistration,
  piProviderRegistration,
] as const;

export function registerBuiltInProviders(): void {
  if (builtInProvidersRegistered) return;
  for (const providerModule of BUILT_IN_PROVIDER_MODULES) {
    ProviderRegistry.register(providerModule.id, providerModule);
    ProviderWorkspaceRegistry.register(providerModule.id, providerModule.workspace);
  }
  builtInProvidersRegistered = true;
}
```

---

## 4. 核心契约与关键类型

### 4.1 `ChatRuntime`（[src/core/runtime/ChatRuntime.ts](../src/core/runtime/ChatRuntime.ts)）

Provider 必须实现的核心运行时接口。关键方法：

| 方法 | 作用 |
| --- | --- |
| `prepareTurn(request: ChatTurnRequest): PreparedChatTurn` | 同步编码 turn，provider-owned |
| `query(turn, history?, options?): AsyncGenerator<StreamChunk>` | 流式查询，产出 provider-neutral `StreamChunk` |
| `ensureReady(options?): Promise<boolean>` | 启动/重启运行时，幂等 |
| `syncConversationState(conversation, externalContextPaths?)` | 同步会话状态到 provider runtime |
| `reloadMcpServers()` | 重载 MCP 服务 |
| `cancel()` / `resetSession()` / `cleanup()` | 取消、重置、清理 |
| `rewind(userMessageId, assistantMessageId?, mode?)` | 回退到指定消息（capability 驱动） |
| `setApprovalCallback` / `setAskUserQuestionCallback` / `setExitPlanModeCallback` / `setPermissionModeSyncCallback` / `setAutoTurnCallback` | 注册各类回调 |
| `buildSessionUpdates({ conversation, sessionInvalidated })` | 构建 provider 会话更新结果 |
| `resolveSessionIdForFork(conversation)` | 解析 fork 目标 session |
| `consumeTurnMetadata()` | 消费 turn 元数据（usage、collaboration mode 等） |

### 4.2 `ProviderCapabilities`（[src/core/providers/types.ts](../src/core/providers/types.ts)）

```typescript
export interface ProviderCapabilities {
  providerId: ProviderId;
  supportsPersistentRuntime: boolean;
  supportsNativeHistory: boolean;
  supportsPlanMode: boolean;
  supportsRewind: boolean;
  supportsFork: boolean;
  supportsProviderCommands: boolean;
  supportsImageAttachments: boolean;
  supportsInstructionMode: boolean;
  supportsMcpTools: boolean;
  supportsSharedAgentSkills?: boolean;
  supportsTurnSteer?: boolean;
  reasoningControl: 'effort' | 'token-budget' | 'none';
  planPathPrefix?: string;
}
```

Feature 代码必须以 capability 判断能力，不可硬编码 provider id（除非契约无法表达）。

### 4.3 `ProviderRegistration` 与 `ProviderModule`

`ProviderRegistration`（chat-facing 服务）：`displayName`、`blankTabOrder`、`isEnabled/setEnabled`、`capabilities`、`environmentKeyPatterns?`、`chatUIConfig`、`settingsReconciler`、`createRuntime`、`createTitleGenerationService`、`createInstructionRefineService`、`createAuxQueryRunner?`、`historyService`、`taskResultInterpreter`、`subagentLifecycleAdapter?`。

`ProviderModule extends ProviderRegistration`：追加 `id`、`settingsStorage: ProviderSettingsStorageAdapter`、`workspace: ProviderWorkspaceRegistration`。

### 4.4 `Conversation` / `SessionMetadata` / `ChatMessage` / `StreamChunk`

见 [src/core/types/chat.ts](../src/core/types/chat.ts)。关键点：

- `Conversation.providerState`：opaque bag，feature 代码不可读，必须走 provider typed helper。
- `Conversation.sessionId`：provider-native 会话 ID，可被 invalidate。
- `StreamChunk`：所有 provider 必须产出 `text`、`tool_use`、`tool_result`、`error`、`done`、`usage`；provider-specific 行为在产出前归一化。包含 `subagent_tool_use` / `subagent_tool_result` / `context_compacted` / `notice` / `thinking` / `tool_output` 等变体。
- `UsageInfo.contextTokens` 是 provider 计算的上下文窗口总 token；cache 字段仅 Claude 填充。

### 4.5 `ClaudianPlusSettings`（[src/core/types/settings.ts](../src/core/types/settings.ts)）

存储于 `.claudian-plus/claudian-plus-settings.json`。注意：

- 顶层 `model` / `thinkingBudget` / `effortLevel` / `serviceTier` / `permissionMode` 由 `settingsProvider` 指定的 provider 投影出来（`ProviderSettingsCoordinator.projectActiveProviderState`）。
- `providerConfigs`：每个 provider 自有的 opaque bag。
- `savedProviderModel` / `savedProviderEffort` / `savedProviderServiceTier` / `savedProviderThinkingBudget` / `savedProviderPermissionMode`：跨 provider 切换时保存的 per-provider 选择。
- `pendingProviderSessionInvalidations`：环境变更后等待持久化的 provider 会话失效 generation map。
- Memory / Consciousness / Dream 各有一组开关与参数。

### 4.6 `ProviderHost` / `FeatureHost`

- [`ProviderHost`](../src/core/providers/ProviderHost.ts)：暴露给 provider adapter 的应用能力（settings、storage、env、CLI、memory/consciousness injection、obsidian tool bridge）。**故意排除** plugin 生命周期、命令注册、会话所有权。
- [`FeatureHost`](../src/features/FeatureHost.ts) `extends ProviderHost`：追加 feature 所需的 Conversation 仓储、memory/consciousness/dream/vaultKnowledge engine、composer enhancement、agent skill repository、view 访问。

---

## 5. 关键类与函数说明

### 5.1 插件主类 `ClaudianPlusPlugin`（[src/main.ts](../src/main.ts)）

继承 `Plugin`，是整个插件的装配根。核心成员与方法：

| 成员/方法 | 说明 |
| --- | --- |
| `providerHost: ClaudianPlusProviderHost` | ProviderHost 实现，传给 provider runtime |
| `memoryExtractor` / `getMemoryStore()` / `getConsciousnessEngine()` / `getVaultKnowledgeEngine()` / `getDreamService()` | 懒加载 memory 子系统 |
| `agentSkillRepository` | 共享 vault agent skill 仓储 |
| `settingsCoordinator` | settings 持久化协调器（合并 + 条件写入） |
| `conversationRepository` | 会话仓储 |
| `loadSettings({ deferNonRestoredSessionMetadata })` | 加载 settings + 会话元数据，迁移 Claude service、归一化 plan mode / provider selection / model variants |
| `applyEnvironmentVariablesBatch(updates)` | 串行应用环境变量变更，触发 provider 重启、model catalog 刷新、会话失效 |
| `getResolvedProviderCliPath(providerId)` | 通过 workspace registry 解析 provider CLI 路径 |
| `reconcileModelWithEnvironment(providerIds?)` | 调用 `ProviderSettingsCoordinator.reconcileProviders` |
| `markPendingSessionInvalidations` / `completePendingSessionInvalidations` / `blockEnvironmentInvalidationCompletion` / `releaseEnvironmentInvalidationCompletion` | 会话失效 generation 的标记/阻塞/完成生命周期 |
| `runStartupDream()` / `checkDreamDue()` | 启动梦境与每小时梦境检查 |
| `getActiveChatContext()` | 当前活动 tab 的 `{ providerId, model }`，供 Dream 使用 |
| `findConversationAcrossViews(conversationId)` | 跨视图定位 tab |
| `notifyAgentSkillsChanged()` | 通知支持 shared agent skills 的 provider 刷新命令缓存 |

### 5.2 `ProviderRegistry`（[src/core/providers/ProviderRegistry.ts](../src/core/providers/ProviderRegistry.ts)）

静态 registry。关键方法：

- `register(providerId, registration)`：注册 chat-facing 服务。
- `createChatRuntime(options)` / `createTitleGenerationService` / `createInstructionRefineService` / `createAuxQueryRunner`：工厂方法。
- `getCapabilities` / `getChatUIConfig` / `getSettingsReconciler` / `getSettingsStorageAdapter` / `getEnvironmentKeyPatterns` / `getSubagentLifecycleAdapter` / `getTaskResultInterpreter` / `getConversationHistoryService`：查询 provider 元数据。
- `getEnabledProviderIds(settings)`：按 `blankTabOrder` 排序的启用 provider 列表。
- `resolveSettingsProviderId(settings)` / `resolveDefaultChatProviderId(settings)` / `resolveProviderForModel(model, settings, options)`：解析当前 settings provider / 默认 chat provider / 模型所属 provider。
- `resolveTitleGenerationProviderId(settings)`：根据 `titleGenerationModel` 路由标题生成 provider（独立于活动 chat tab）。
- `RoutedTitleGenerationService`：内部类，按会话路由并取消旧任务。

### 5.3 `ProviderWorkspaceRegistry`（[src/core/providers/ProviderWorkspaceRegistry.ts](../src/core/providers/ProviderWorkspaceRegistry.ts)）

与 `ProviderRegistry` 平行，管理 app-level provider workspace 服务。**懒初始化**：只在 `ensureInitialized` 第一次调用时初始化。关键方法：

- `register(providerId, registration)`
- `ensureInitialized(plugin, providerId, reason)` / `initializeAll(plugin)` / `disposeInitialized()`
- `getServices(providerId)` / `requireServices(providerId)`
- 便捷访问：`getCommandCatalog` / `getAgentMentionProvider` / `getCliResolver` / `getRuntimeCommandLoader` / `getTabWarmupPolicy` / `getMcpServerManager` / `getSettingsTabRenderer`
- `refreshAgentMentions(providerId)` / `refreshModelCatalog(providerId)` / `prepareSettings(providerId)`

底层由 `ProviderInitializationBoundary` 串行化初始化、记录 `StartupProfiler` span、容错（单个 provider 失败不阻塞其他）。

### 5.4 `ProviderSettingsCoordinator`（[src/core/providers/ProviderSettingsCoordinator.ts](../src/core/providers/ProviderSettingsCoordinator.ts)）

跨 provider settings 协调。关键静态方法：

- `normalizeProviderSelection(settings)`：归一化 `settingsProvider` / `defaultChatProviderId`，确保指向已启用 provider。
- `projectActiveProviderState(settings)`：把 active provider 的 model/effort/budget/tier/permission 投影到顶层字段。
- `persistProjectedProviderState(settings)`：反向把顶层字段写回 `savedProvider*`。
- `handleEnvironmentChange(settings, providerIds)`：触发 provider settingsReconciler 的 `handleEnvironmentChange`。
- `reconcileProviders(settings, conversations, providerIds)`：调用各 provider reconciler，返回 `{ changed, invalidatedConversations, environmentChangedProviderIds }`。
- `invalidateConversationSessions(conversations, providerIds)`：标记受影响会话。
- `normalizeAllModelVariants(settings)`：归一化所有 provider 的 model variant。

### 5.5 `SettingsCoordinator<T>`（[src/app/settings/SettingsCoordinator.ts](../src/app/settings/SettingsCoordinator.ts)）

通用 settings 协调器。`persistCurrent()` 持久化当前快照；`mutate(mutation)` 串行执行 mutation 并持久化；`mutateConditionally(mutation)` 仅在 mutation 返回 true 时持久化。

### 5.6 `SharedStorageService`（[src/app/storage/SharedStorageService.ts](../src/app/storage/SharedStorageService.ts)）

实现 `SharedAppStorage`：`initialize()` 读取 `.claudian-plus/claudian-plus-settings.json` 与 legacy `.claudian/`；`sessions` 暴露 `AppSessionStorage`；`getTabManagerState` / `setTabManagerState` 持久化 tab 布局；`getAdapter()` 返回 `VaultFileAdapter`。

### 5.7 `ConversationRepository`（[src/app/conversations/ConversationRepository.ts](../src/app/conversations/ConversationRepository.ts)）

会话仓储。`create` / `switchTo` / `delete` / `rename` / `update` / `getById` / `getSync` / `getCachedConversation` / `list` / `findEmpty` / `backfillResponseTimestamps` / `mergeMetadataConversations` / `ensureSearchIndex` / `handleMissingProviderSession`。

### 5.8 `ClaudianPlusProviderHost`（[src/app/providers/ClaudianPlusProviderHost.ts](../src/app/providers/ClaudianPlusProviderHost.ts)）

`ProviderHost` 的具体实现，绑定到 `ClaudianPlusPlugin`，转发 settings/storage/env/CLI/memory injection/obsidian tool bridge 调用。

### 5.9 `ObsidianToolBridge`（[src/core/obsidian/ObsidianToolBridge.ts](../src/core/obsidian/ObsidianToolBridge.ts)）

把原生 Obsidian API（Canvas、Properties、links、Canvas neighbors、portable tool runtime）通过 loopback 暴露给外部 provider 子进程。`start()` / `stop()` / `undoLastCanvasWrite(vault)`。`CanvasWriteHistory.ts` 记录本会话 Canvas 写入以支持撤销。

### 5.10 `StartupProfiler`（[src/core/performance/StartupProfiler.ts](../src/core/performance/StartupProfiler.ts)）

启动性能追踪。`start(label)` / `finish(span)` / `runAsync(label, fn)` / `recordCount` / `increment` / `freeze` / `copyToClipboard`。在 `onload` 各阶段埋点，命令 `Copy startup diagnostics` 输出。

---

## 6. Provider 适配层详解

每个 provider 目录结构高度一致，遵循 [src/providers/<id>/AGENTS.md](../src/providers/) 约定：

```
src/providers/<id>/
  AGENTS.md           # provider 约定与陷阱
  CLAUDE.md           # import AGENTS.md
  capabilities.ts     # ProviderCapabilities
  registration.ts     # ProviderModule 装配
  settings.ts         # provider-owned settings 读写/归一化
  models.ts / modelOptions.ts / modelSelection.ts  # 模型目录与选择
  app/<Provider>WorkspaceServices.ts  # ProviderWorkspaceRegistration
  auxiliary/          # InstructionRefineService / TitleGenerationService / extractAssistantText
  commands/           # CommandCatalog / probeRuntimeCommands
  env/                # SettingsReconciler / claudeModelEnv
  history/            # HistoryStore / SessionPaths / sdkMessageParsing / ...
  prompt/             # TurnEncoder / encodeCodexTurn / buildPiPrompt
  runtime/            # ChatRuntime 实现 + CliResolver + SessionManager + DynamicUpdates + ...
  storage/            # provider-owned storage（CCSettingsStorage / McpStorage / SkillStorage / AgentVaultStorage / ...）
  ui/                 # ChatUIConfig + SettingsTab + 各类设置 UI
  types/              # provider-owned types
```

### 6.1 Codex（[src/providers/codex/](../src/providers/codex/)）

- 传输：`codex app-server` stdio JSON-RPC 2.0。握手必须 `initialize` → `initialized`，`initialize` 含 `{ experimentalApi: true }`。
- 实时输出：`thread/start` / `thread/resume` 请求 `experimentalRawEvents: true`，`CodexNotificationRouter` 把通知与 raw item 投影成 `StreamChunk`。
- 历史：JSONL 是 replay 源；`CodexHistoryStore` / `CodexHistoryPathResolver`。
- 关键类：`CodexChatRuntime`、`CodexAppServerProcess`、`CodexRpcTransport`、`CodexServerRequestRouter`、`CodexSessionManager`、`CodexModelDiscoveryService`、`CodexModelCatalogCoordinator`、`CodexDynamicToolRegistry`、`CodexObsidianTools`、`CodexSkillListingService`（独立短生命周期进程）、`CodexAuxQueryRunner`（独立进程/transport/thread）、`NoopTaskResultInterpreter`（Codex 不适用 Claude async-agent task 系统）。
- 环境失效键：`OPENAI_MODEL`、`OPENAI_BASE_URL`、`OPENAI_API_KEY`（`environmentKeyPatterns: [/^OPENAI_/i, /^CODEX_/i]`）。
- 默认 `enabled: true`，默认模型 `gpt-5.6-sol`。

### 6.2 Claude（[src/providers/claude/](../src/providers/claude/)）

- 传输：`@anthropic-ai/claude-agent-sdk`，叠加 Claude Code CLI 兼容层（`.claude/settings.json`、`.claude/mcp.json`、`.claude/commands`、`.claude/skills`、`.claude/agents`）。
- 持久 query：尽量跨 turn 复用 SDK query；系统 prompt、disabled-tool、plugin set、settings source、CLI path、Chrome enablement、external context paths 变更时重启。
- 去重：SDK 可能增量输出文本并在最终 assistant message 重复，stream 处理保留 dedupe。
- Token usage：从 assistant 与 result message 合并（assistant 提供 input-side，result 提供权威 context-window）。
- `createCustomSpawnFunction()` 处理 Obsidian/Electron 进程怪癖。
- 关键类：`ClaudeChatRuntime`、`ClaudeSessionManager`、`ClaudeMessageChannel`、`ClaudeDynamicUpdates`、`ClaudeApprovalHandler`、`ClaudeTaskResultInterpreter`、`ClaudeHistoryStore`、`ClaudeObsidianMcp`、`PluginManager`、`AgentManager`、`ClaudeServiceConnection`、`ClaudeThirdPartyServices`、`ClaudeServiceMigration`、`CCSettingsStorage`、`McpStorage`、`SkillStorage`、`SlashCommandStorage`、`AgentVaultStorage`、`ClaudeCommandCatalog`、`ClaudeChatUIConfig`、`ClaudeSettingsTab`、`loadClaudeAgentSdk`。
- 陷阱：SDK amnesia（返回 sessionId 与 resume id 不一致时下一 turn 注入完整历史，除非 fork 后首次 session_init）；crash recovery 仅在前次未产出 chunk 时重试一次；`EnterPlanMode` 不触发 `canUseTool`，`ExitPlanMode` 触发。
- `DEFAULT_CHAT_PROVIDER_ID = 'claude'`（注册表回退默认），但实际默认 chat provider 由 `defaultChatProviderId` / `settingsProvider = 'codex'` 决定。

### 6.3 OpenCode（[src/providers/opencode/](../src/providers/opencode/)）

- 传输：Agent Client Protocol over `opencode acp` 子进程（共享 [src/providers/acp/](../src/providers/acp/)）。
- 实时输出：ACP session 通知 → `AcpSessionUpdateNormalizer` + OpenCode tool normalization → `StreamChunk`。
- 历史：读 OpenCode 原生 SQLite（`OpencodeSqliteReader` 带 fallback），**不可** 从 Claudian Plus 修改原生历史。
- `providerState.databasePath` 保留会话所用数据库；`sessionCwds` 映射 ACP session → vault cwd。
- 启动：`prepareOpencodeLaunchArtifacts()` 在 `.claudian-plus/opencode/` 写入 managed config 与 system prompt，加载用户 `OPENCODE_CONFIG` 并叠加。
- 环境失效键：`OPENCODE_CONFIG`、`OPENCODE_DB`、`OPENCODE_DISABLE_PROJECT_CONFIG`、`XDG_DATA_HOME`。
- 模式：`modes.ts` 把 OpenCode mode ID 映射到共享 permission mode（`OPENCODE_PLAN_MODE_ID` / `OPENCODE_SAFE_MODE_ID`）。
- 关键类：`OpencodeChatRuntime`、`OpencodeAuxQueryRunner`（独立进程/session）、`OpencodeCliResolver`、`OpencodeCommandCatalog`、`OpencodeAgentStorage`、`OpencodeSettingsReconciler`、`OpencodeSettingsTab`、`OpencodeChatUIConfig`。

### 6.4 Kimi（[src/providers/kimi/](../src/providers/kimi/)）

- 传输：Agent Client Protocol over `kimi acp` 子进程（共享 [src/providers/acp/](../src/providers/acp/)，`kimi acp` 无额外参数，工作目录走 ACP `cwd` 字段）。
- 模型：`session/new` 返回 `models`（条目用 `modelId` 键而非 spec 的 `id`；`AcpModelInfo` 已兼容两者）。思考通过模型 id 的 `,thinking` 后缀变体表达（`kimi-code/k3,thinking`），不是 effort config option → `reasoningControl: 'none'`。
- 模型切换：`session/set_config_option` 不受支持（Method not found）；Kimi 自定义 RPC **`session/set_model { sessionId, modelId }`**，通过 `AcpClientConnection.setModel` 调用。
- 模式：ACP `modes` 只有 `default` → 无 mode selector，`supportsPlanMode: false`（plan 仅是 `/plan` slash 命令），权限走标准 `session/request_permission` 逐个审批。
- MCP：`session/new` 的 `mcpServers` 只接受 HTTP server（stdio 被 pydantic 拒绝）→ Obsidian 工具桥（stdio MCP）暂无法注入，`KimiLaunchArtifacts` 返回空列表。
- 历史：`supportsNativeHistory: true` 但仅会话级（ACP `session/list` + `session/load` 恢复 `providerState.sessionId`）；Kimi 原生 transcript 不回放，消息列表保持为空。
- 未登录：`AUTH_REQUIRED`（-32000）翻译为 Notice，引导终端执行 `kimi login`。
- 记忆/意识注入：Kimi config 无 system prompt 字段，注入走 prompt 前缀（`<system_context>` 块，`buildKimiPrompt`）。
- 环境失效键：`KIMI_CONFIG`、`KIMI_HOME`、`KIMI_DATA_DIR`、`XDG_DATA_HOME`。
- 关键类：`KimiChatRuntime`、`KimiAuxQueryRunner`（独立 ACP 进程）、`KimiCliResolver`、`KimiCommandCatalog`、`KimiSettingsReconciler`、`KimiSettingsTab`、`KimiChatUIConfig`、`KimiConversationHistoryService`。
- 探查记录：`.context/probes/kimi-probe/NOTES.md`（含账号配额 403 静默吞错的行为说明）。

### 6.5 Pi（[src/providers/pi/](../src/providers/pi/)）
- 传输：`pi --mode rpc` 子进程。`PiLaunchSpec.ts` 集中命令行参数。
- 实时事件：`normalizePiRpcEvent()` + `PiEventNormalizationState` 归一化。
- Extension UI：`PiExtensionUiBridge` 路由，`ObsidianPiExtensionUiRenderer` 渲染。
- 历史：Pi JSONL（vault-local 与 user-level roots），`PiHistoryStore` / `PiHistoryPathResolver` / `PiConversationHistoryService`。
- Fork：复制源 branch 到 `resumeAt` 创建新 session 文件，provider-owned 物化。
- 环境失效键：影响 Pi 数据/包位置的键。
- 关键类：`PiChatRuntime`、`PiSubprocess`、`PiRpcTransport`、`PiRpcPayloads`、`PiJsonl`、`PiModelDiscoveryService`、`PiCommandCatalog`、`PiExtensionUiRenderer`、`PiSettingsTab`、`PiAuxQueryRunner`（独立进程）、`PiInstructionRefineService` / `PiTitleGenerationService`。

### 6.6 共享 ACP（[src/providers/acp/](../src/providers/acp/)）

`AcpClientConnection`、`AcpJsonRpcTransport`、`AcpSessionConfig`、`AcpSessionUpdateNormalizer`、`AcpSubprocess`、`AcpToolStreamAdapter`、`buildAcpUsageInfo`、`permissionMapping`、`methodNames`、`types`。OpenCode 与 Kimi 复用此模块（`permissionMapping` 原在 `opencode/internal/`，纯 ACP 逻辑，已上移共享）。

---

## 7. Feature 层详解

### 7.1 Chat 状态流（来自 [src/features/chat/AGENTS.md](../src/features/chat/AGENTS.md)）

```text
User input
  -> InputController
  -> ensure runtime for active provider
  -> ChatRuntime.prepareTurn()
  -> ChatRuntime.query()
  -> StreamController
  -> renderers + ChatState persistence
```

Tab 在首次发送前保持冷态；runtime warmup 必须 explicit 且 provider-owned，避免 command discovery 为历史会话创建真实 session。

### 7.2 `ClaudianPlusView`

继承 `ItemView`，持有 `TabManager` / `TabBar` / `MentionCacheCoordinator` / `TabStatePersistenceCoordinator`。构造时为 Hover Editor 兼容性把 `load` 定义为不可重写的实例方法。`onclose` 必须 abort 活动 tab 并 dispose runtime。

### 7.3 `ChatState`（[src/features/chat/state/ChatState.ts](../src/features/chat/state/ChatState.ts)）

每 tab 状态机：messages、isStreaming、cancelRequested、streamGeneration、queuedMessage、currentContentEl/TextEl、thinkingState、toolCallElements map、writeEditStates map、pendingTools map、usage、currentTodos、planFilePath、prePlanPermissionMode 等。通过 `ChatStateCallbacks` 通知 controller。

### 7.4 Controllers

- `InputController`：构建 `ChatTurnRequest`，处理发送、取消、队列、`/compact`（provider-specific）与内建命令。
- `ConversationController`：新建/切换/fork/rewind/delete 会话。
- `StreamController`：消费 `ChatRuntime.query()` 的 `AsyncGenerator<StreamChunk>`，分派给 renderer 与 `ChatState`。
- `NavigationController`：浮动大纲导航。
- `SelectionController` / `BrowserSelectionController` / `CanvasSelectionController`：编辑器/浏览器/Canvas 选区上下文。
- `TurnCoordinator`：单 turn 生命周期协调。

### 7.5 Renderers

`MessageRenderer`（主入口）、`ToolCallRenderer`、`ThinkingBlockRenderer`、`DiffRenderer`、`WriteEditRenderer`、`SubagentRenderer`、`InlineAskUserQuestion` / `InlineExitPlanMode` / `InlineOptionList` / `InlinePlanApproval`（provider 交互 UI）。`collapsible` / `todoUtils` / `subagentLifecycleResolution` 为辅助。

### 7.6 Tabs

`TabManager` 协调 tab 级操作（fork、provider-aware command catalog、warmup policy）；`Tab` 单 tab 状态与 provider 解析；`TabBar` 渲染；`TabSession` 会话绑定；`RuntimeSupervisor` 监控 runtime 就绪状态；`providerResolution.ts` 解析 tab provider。

### 7.7 UI 组件

`InputToolbar`、`StatusPanel`、`NavigationSidebar`（浮动大纲）、`ComposerContextTray`、`FileContext` + `file-context/`（chip 视图与状态）、`ImageContext`、`BangBashModeManager`、`InstructionModeManager`、`TriggerModeManager`、`ConstellationCubeWelcome`、`dragDrop`、`textareaResize`。

### 7.8 Composer

`LivePreviewComposer` / `LivePreviewInputBridge`：增强 Obsidian Live Preview 输入；`VaultContextDropController`：拖拽 vault 文件入 composer。

### 7.9 Services

`BangBashService`：绕过 provider runtime 直接执行本地 shell（仅当 `ProviderChatUIConfig.isBangBashEnabled` 返回 true）。`MentionCacheCoordinator`：`@` mention 缓存。`SubagentManager`：subagent 生命周期。

---

## 8. Memory / Consciousness 子系统

位于 [src/core/memory/](../src/core/memory/)，受 `consciousnessEnabled` / `consciousnessAutoMemory` / `memoryEnabled` 等 settings 控制。

| 文件 | 职责 |
| --- | --- |
| `MemoryStore.ts` | 用户显式记忆（`remember...` / `forget...`）读写，构建 injection text |
| `MemoryExtractor.ts` | 从对话中提取记忆候选 |
| `ConsciousnessEngine.ts` | 意识机制：awareness 目录（soul/user/short-term/activity），self-reflection 与记忆累积，灵感来自 QoderWork |
| `DreamService.ts` | 梦境记忆整合：周期性把短期日志蒸馏为长期记忆 facts / profile updates / insights。`DREAM_CHECK_INTERVAL_MS` 每小时检查；启动后 30s 跑一次 startup dream |
| `VaultKnowledgeEngine.ts` | 轻量 Vault 知识摘要，注入 awareness context |
| `memoryPrompt.ts` | `wrapMemoryInjection` / `escapePromptTagCloser` / `formatMemoryAppendix` |
| `MindStore.ts` | Dreaming V3 心智存储：durable / staging 条目、scope 与时序状态（`DurableMindEntry`、`StagingMindEntry`、`MindTemporalState`） |
| `MicroDreamCoordinator.ts` | 微梦境协调：借 `AuxQueryRunner` 与 `prompt/dreamMemory` 在空闲时做小规模整合 |
| `HybridMindPromptInjector.ts` | memory 与 mind 双通道混合注入，产出 `HybridMindInjectionResult` / `MindRecallInfo` |
| `deduplication.ts` | 记忆条目去重：`normalizeMemoryContent` / `isMemoryDuplicate` / `deduplicateMemoryEntries`（`MIN_CONTAINMENT_LENGTH`） |
| `mind-types.ts` | Dreaming V3 Mind & Habit Engine 类型与 schema（`MindCategory`: user_preference / coding_habit / project_rule / correction_rule） |
| `consciousness-types.ts` / `types.ts` | 配置与类型 |
| `index.ts` | 模块导出（barrel） |
| `backup.ts` | 写入前备份 |

注入入口：`ClaudianPlusPlugin.getMemoryInjectionText()` / `getConsciousnessInjectionText()`，作为 system prompt 增强返回给 provider runtime（增强失败必须静默，不可阻断 provider 启动）。

---

## 9. 依赖关系图

### 9.1 模块依赖方向（强制，由 [scripts/check-architecture-boundaries.test.mjs](../scripts/check-architecture-boundaries.test.mjs) 检查）

```text
types/            <- 所有模块
storage/          <- bootstrap/, provider workspace services
runtime/ + providers/   <- provider 实现
features/         -> core 契约 only（禁止 import provider 实现）
providers/*/      -> core 契约 + 自有实现
```

`core/` 不可 import provider 实现文件；共享行为需要 provider 数据时，在 core 定义显式契约，由 provider 实现。

### 9.2 运行时依赖（package.json）

| 依赖 | 用途 |
| --- | --- |
| `@anthropic-ai/claude-agent-sdk` | Claude provider SDK |
| `@modelcontextprotocol/sdk` | MCP 客户端/服务端 SDK |
| `@codemirror/commands` / `state` / `view` | 编辑器扩展（Live Preview composer 等） |
| `three` / `@types/three` | 3D 渲染（ConstellationCubeWelcome 等） |
| `smol-toml` | TOML 解析（Codex subagent `.toml` 等） |
| `zod` | schema 校验 |
| `tslib` | TS 运行时 helper |

devDependencies 含 esbuild、eslint（含 `eslint-plugin-obsidianmd`、`eslint-plugin-simple-import-sort`、`eslint-plugin-jest`）、jest、ts-jest、tsx、typescript 6、obsidian type。

`overrides`：固定 `@babel/core`、`hono`、`js-yaml` 版本。

### 9.3 Provider 间依赖

- Claude 依赖 `@anthropic-ai/claude-agent-sdk`，独立于其他 provider。
- OpenCode 依赖共享 `src/providers/acp/`。
- Codex、Pi 各自独立子进程协议。
- 五个 provider 之间无直接代码依赖，仅通过 core 契约协作。

---

## 10. 存储布局

来自 [AGENTS.md Storage](../AGENTS.md)：

| 路径 | 内容 |
| --- | --- |
| `.claudian-plus/claudian-plus-settings.json` | 共享 Claudian Plus settings + provider 配置 |
| `.claudian-plus/sessions/*.meta.json` | Provider-neutral 会话元数据 |
| `.claudian-plus/opencode/` | OpenCode managed config/system prompt |
| `.claudian-plus/archived-legacy/` | 迁移后的 legacy `.claudian/` 数据归档 |
| `.claudian/` | Legacy Claudian 数据（读取做迁移兼容） |
| `.claude/settings.json` | Claude Code 兼容项目设置（permissions、plugin overrides） |
| `.claude/mcp.json` | Claudian Plus 管理的 Claude MCP（`mcpServers` + `_claudian.servers` 元数据） |
| `.claude/commands/**/*.md` | Claude slash commands |
| `.claude/skills/*/SKILL.md` | Claude skills |
| `.claude/agents/*.md` | Claude vault agents |
| `.codex/skills/*/SKILL.md` | Codex vault skills |
| `.agents/skills/*/SKILL.md` | 备选 Codex vault skill root |
| `.codex/agents/*.toml` | Codex vault subagent 定义 |
| `.opencode/agent`, `.opencode/agents` | OpenCode agent 定义 |
| `.pi/agent/sessions/` | Pi vault-local sessions |
| `~/.claude/projects/{vault}/*.jsonl` | Claude-native transcripts |
| `~/.codex/sessions/**/*.jsonl` | Codex-native transcripts |
| `~/.pi/agent/sessions/` | Pi user-level sessions |

Settings writer 必须 merge 现有 provider-owned 数据，不可 clobber。

---

## 11. 构建与运行

### 11.1 环境要求

- Node.js `>=24 <25`（见 [package.json](../package.json) `engines`，[.node-version](../.node-version)）。
- 至少一个支持的 provider CLI（Codex / Claude / OpenCode / Kimi / Pi）。
- Obsidian 桌面端（`minAppVersion: 1.11.4`，`isDesktopOnly: true`）。

### 11.2 安装依赖

```bash
npm ci
```

`postinstall` 脚本：[scripts/postinstall.mjs](../scripts/postinstall.mjs)。

### 11.3 开发与构建命令（见 [AGENTS.md Commands](../AGENTS.md)）

```bash
npm run dev              # build:css + esbuild watch
npm run build            # production build via scripts/build.mjs production
npm run typecheck        # tsc --noEmit
npm run lint             # eslint "{src,tests}/**/*.ts"
npm run lint:fix
npm run test             # scripts/run-tests.js（jest + node --test 架构测试）
npm run test:unit        # scripts/run-jest.js
npm run test:watch
npm run test:coverage
npm run test:architecture # 架构边界检查
npm run check:performance # 启动性能检查
npm run build:css        # scripts/build-css.mjs 合并模块化 CSS
```

默认完整验证：`npm run typecheck && npm run lint && npm run test && npm run build`。

### 11.4 从源码构建并安装到 Vault

1. 克隆仓库。
2. `npm ci` → `npm run typecheck` → `npm run build`。
3. 在 `.env.local` 设置 `OBSIDIAN_VAULT=D:\\Obsidian\\My Vault`（参考 [.env.local.example](../.env.local.example)）。
4. 再次 `npm run build`，构建脚本会把 `main.js` / `manifest.json` / `styles.css` 复制到 `<vault>/.obsidian/plugins/claudian-plus/`。

构建脚本：[scripts/build.mjs](../scripts/build.mjs)、[esbuild.config.mjs](../esbuild.config.mjs)、[scripts/build-css.mjs](../scripts/build-css.mjs)、[scripts/sync-version.js](../scripts/sync-version.js)（`version` 脚本同步 `manifest.json`）。

### 11.5 从 release 安装

1. 从 [releases](https://github.com/wuyifan-code/Claudian-plus/releases/latest) 下载 `main.js`、`manifest.json`、`styles.css`。
2. 创建 `<vault>/.obsidian/plugins/claudian-plus/`。
3. 复制三个文件到该目录。
4. Obsidian → Settings → Community plugins → 启用 Claudian Plus。

### 11.6 首次运行

1. 安装并认证一个 provider CLI（Codex 默认）。
2. 打开 Claudian Plus → Settings，若 Obsidian 未继承 shell `PATH`，设置 provider 的绝对 CLI 路径。
3. permission mode 保持 `normal` 直到理解 provider-specific 审批流。
4. 按需启用 memory / 意识功能。

### 11.7 实用命令（Obsidian command palette）

Open chat view、New tab、New session (in current tab)、Close current tab、Copy startup diagnostics、Check provider CLI health、Open memory file、Quick agent input、Undo last canvas write、Scan vault knowledge、Summarize current note、Suggest tags for current note、Create MOC for topic、Cleanup expired short-term memories、Dream: consolidate short-term memories。

Composer 内：`/clear`、`/resume`、`/fork`、`/add-dir`、`/compact`（provider-specific）。

---

## 12. 测试体系

- 配置：[jest.config.js](../jest.config.js)、[scripts/run-tests.js](../scripts/run-tests.js)、[scripts/run-jest.js](../scripts/run-jest.js)。
- 测试镜像 `src/` 结构：`tests/unit/` 与 `tests/integration/`。
- 架构边界测试：[scripts/check-architecture-boundaries.test.mjs](../scripts/check-architecture-boundaries.test.mjs)（`npm run test:architecture`），强制 §9.1 依赖方向。
- ESLint 配置测试：[scripts/check-eslint-config.test.mjs](../scripts/check-eslint-config.test.mjs)。
- Release 版本检查：[scripts/check-release-version.mjs](../scripts/check-release-version.mjs) + 其测试。
- 启动性能检查：[scripts/check-startup-performance.mjs](../scripts/check-startup-performance.mjs)。
- TDD 工作流（见 [AGENTS.md TDD Workflow](../AGENTS.md)）：新行为或修复先写失败测试 → 最窄实现通过 → 重构保持边界。

---

## 13. 开发约定与陷阱

### 13.1 通用约定（[AGENTS.md Development Rules](../AGENTS.md)）

- 仓库搜索用 `rg` 或 `rg --files`（在 IDE 工具内使用 Grep/Glob）。
- 代码、注释、标识符、commit message、代码块用英语。
- 注释稀疏，只解释非显然意图、协议约束、不变量。
- 生产代码禁用 `console.*`。
- 保留用户数据与 provider-native 文件；settings writer 必须 merge 而非 clobber。
- 非提交笔记、handoff、trace、临时脚本放 `.context/`。
- 不无故新增生产依赖。

### 13.2 Provider 边界陷阱

- **不假设 provider 对等**：编辑前检查各 provider 的 `capabilities.ts`、`registration.ts`、UI config。
- **`Conversation.providerState` 对 feature 不透明**：必须走 runtime 方法 / provider history service / typed provider helper。
- **Plan mode 是 capability 驱动**：不要在 feature 逻辑硬编码 provider id（除非契约无法表达）。
- **Command discovery 因 provider 而异**：Claude 合并 runtime-discovered + vault + skills；Codex skills 来自 `CodexSkillCatalog`，不依赖 runtime command discovery；OpenCode/Pi 通过 provider protocol 暴露 runtime commands。
- **Tab 冷态**：首次发送前 runtime 不 warmup；command discovery 不可为历史会话意外创建真实 session。
- **`/compact` provider-specific**：Claude 跳过 context injection 让 provider 处理内建命令；Codex 路由到 `thread/compact/start` 并持久化 `context_compacted`；Pi 发 `compact` RPC。
- **Fork provider-owned**：用 runtime 与 provider history 契约，不在 feature 重建 provider session id。

### 13.3 启动性能

- `StartupProfiler` 在 `onload` 各阶段埋点；`loadSettings` 默认 `deferNonRestoredSessionMetadata: true`，仅同步加载已恢复 tab 的元数据，剩余延后到 `onLayoutReady` 后用 0ms timeout 调度，分批 publish。
- Provider workspace services 懒初始化（首次使用才 init）。

### 13.4 环境变量与会话失效

- `applyEnvironmentVariablesBatch` 串行化（`environmentUpdateTail` promise 链）。
- 受影响 provider 触发 `markPendingSessionInvalidations`（generation = `max(Date.now(), prev+1)`），阻塞完成直到 model catalog 刷新 + 会话持久化 + runtime 重启。
- 失效 generation 持久化到 `settings.pendingProviderSessionInvalidations`，全部受影响会话元数据持久化后才清除。

### 13.5 迁移与兼容

- 读取 legacy `.claudian/` 数据，迁移到 `.claudian-plus/`，归档到 `archived-legacy/`，从不自动删除。
- 不要同时对同一 Vault 运行旧 Claudian 与 Claudian Plus。
- `migrateClaudeServiceSettings` 把 legacy Claude 兼容 endpoint 环境块迁入结构化 service registry。
- Plan mode 是临时的，加载时归一化回 `normal`（`prePlanPermissionMode` 会丢失）。

### 13.6 i18n

[src/i18n/i18n.ts](../src/i18n/i18n.ts) 提供 `localeText(zh, en)` 与 `setLocale(locale)`。UI 语言跟随 Obsidian locale，支持 en/zh-CN/zh-TW/ja/ko/de/es/fr/pt/ru（见 [src/i18n/locales/](../src/i18n/locales/)）。

### 13.7 上游许可

仓库含 MIT（Claudian 派生 + 原创部分）与 AGPL-3.0（Codian 派生部分）双许可。再分发或修改 Codian 派生部分须遵循 AGPL-3.0。详见 [LICENSE](../LICENSE) 与 [NOTICE](../NOTICE)。

---

## 附录：关键文件快速索引

| 关注点 | 文件 |
| --- | --- |
| 插件入口 | [src/main.ts](../src/main.ts) |
| Provider 注册 | [src/providers/index.ts](../src/providers/index.ts) |
| Chat 运行时契约 | [src/core/runtime/ChatRuntime.ts](../src/core/runtime/ChatRuntime.ts) |
| Provider 类型与契约 | [src/core/providers/types.ts](../src/core/providers/types.ts) |
| Provider registry | [src/core/providers/ProviderRegistry.ts](../src/core/providers/ProviderRegistry.ts) |
| Workspace registry | [src/core/providers/ProviderWorkspaceRegistry.ts](../src/core/providers/ProviderWorkspaceRegistry.ts) |
| ProviderHost 接口 | [src/core/providers/ProviderHost.ts](../src/core/providers/ProviderHost.ts) |
| FeatureHost 接口 | [src/features/FeatureHost.ts](../src/features/FeatureHost.ts) |
| Chat 类型 | [src/core/types/chat.ts](../src/core/types/chat.ts) |
| Settings 类型 | [src/core/types/settings.ts](../src/core/types/settings.ts) |
| 默认 settings | [src/app/settings/defaultSettings.ts](../src/app/settings/defaultSettings.ts) |
| Chat 视图 | [src/features/chat/ClaudianPlusView.ts](../src/features/chat/ClaudianPlusView.ts) |
| Chat 状态 | [src/features/chat/state/ChatState.ts](../src/features/chat/state/ChatState.ts) |
| Memory 子系统入口 | [src/core/memory/index.ts](../src/core/memory/index.ts) |
| Obsidian 工具桥 | [src/core/obsidian/ObsidianToolBridge.ts](../src/core/obsidian/ObsidianToolBridge.ts) |
| 启动性能 | [src/core/performance/StartupProfiler.ts](../src/core/performance/StartupProfiler.ts) |
| 架构边界测试 | [scripts/check-architecture-boundaries.test.mjs](../scripts/check-architecture-boundaries.test.mjs) |
| 构建脚本 | [scripts/build.mjs](../scripts/build.mjs) |
| 包配置 | [package.json](../package.json) |
| 清单 | [manifest.json](../manifest.json) |
| 跨 agent 指南 | [AGENTS.md](../AGENTS.md) |
