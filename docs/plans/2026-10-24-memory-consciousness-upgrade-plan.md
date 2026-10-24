# 记忆与意识模块升级计划

> **给实现者：** 本计划按阶段执行，每个工作项遵循仓库现有 TDD 流程（`tests/` 镜像 `src/`，先写失败测试再实现）。开工前先读 §2 的硬约束清单——其中两条（不新增生产依赖、用户数据只停写不删档）决定了退役策略，不是建议。每阶段收尾跑 `npm run typecheck && npm run lint && npm run test && npm run build`。

**目标：** 把"自动记忆"收敛为一条以 V2 事件源系统为单一真相的闭环管线（写入→蒸馏→检索→反馈→遗忘），把"意识"从"发消息时注入一帧快照"升级为"带时间与活动感知、空闲时持续观察沉淀"的被动增强系统。

**技术决策（已与用户确认）：** 检索增强走无新依赖路线（BM25 风格打分 + 辅助模型生成关键词索引），不引入本地 embedding；意识模块的主动性止步于"空闲观察进记忆"，不做主动推送消息。

---

## 0. 结论先行（诊断摘要）

1. **记忆侧三代并行，V2 已是主路径但未收敛**：V1（`memory.md` 正则提取 + 全量注入）、V3（MindStore 微梦 staging）、V2（`src/core/memory/v2/` 事件源：episodes → 梦境蒸馏 → 世代快照）。V2 packet 为空时仍回退 V1 注入器（`main.ts` `getMemoryInjectionText`），两条 LLM 做梦管线（V1 `DreamService` 每小时 / V2 `DreamRunner` 回合结束）同时在跑。
2. **遗忘机制在生产代码零调用**：`MindStore.applyDecay` 与 `MemoryRepository.recordFeedback`（`MemoryRepository.ts:515`）只有测试引用；`reviewAfter`/`validUntil` 只有 LLM 主动给出才存在。episodes 不可变且永不清理，世代快照每次写操作全量重写（O(n²) I/O）。
3. **检索几乎失明**：纯词元重叠打分（`MemoryRetriever.ts:174-232`）；更关键的是 7 个 provider runtime 调用 `getMemoryInjectionText()` **均不传 `userPromptOverride`**，检索查询只有 `File: <活动文件路径>` 或空串——检索器从未见过用户消息。
4. **claimKey 不稳定**：`simpleSlug(内容前 20 字符)` 本地生成、LLM 自由生成，同一事实不同表述产生不同键 → `commitDream` 同键去重失效。显式命令仅句首锚定，forget 静默处理第一条匹配。
5. **意识侧是"半成品 + 死代码"**：`shouldReflect`/`reflectionIntervalMs`/`minConversationsForReflection`/`requireConfirmationForImplicit`/`includeSourceContext` 定义后从未生效；SOUL/USER 注入按行数（10/15 行）硬截断；无时间感知、无最近活动感知；Ambient 500ms 常驻轮询、预算硬编码、模式不持久化。
6. **单位混用**：`memoryMaxInjectionChars`（字符）在 `main.ts:1473` 被直接当 `maxTokens` 传给 V2 检索器。

## 1. 目标架构

| # | 目标 | 一句话描述 |
| --- | --- | --- |
| 1 | V2 单一真相 | 唯一 LLM 做梦管线、唯一记忆存储；`memory.md` 降级为 dream commit 后刷新的用户可读导出视图；V1/V3 经一次性迁移退役 |
| 2 | 闭环记忆 | 曝光（exposed）→ 引用（referenced）→ 纠正（corrected）反馈回流驱动置信度；reviewAfter 过期、长期未引用、GC 真正接线 |
| 3 | 无新依赖检索 | BM25 风格 IDF 打分 + recency/scope/feedback 加权 + dream 时辅助模型生成关键词索引 + 查询=用户消息+活动文件 |
| 4 | 意识升级 | 注入块带时间/最近活动感知、token 预算化截断；空闲观察器把活动摘要作为 episode 喂进 V2（零通知零推送，全程过 `AuxiliaryRequestGate`） |

## 2. 硬约束清单

| 约束 | 出处/证据 | 影响 |
| --- | --- | --- |
| 不新增生产依赖 | `AGENTS.md` 开发规则 | 检索增强只能用打分函数 + 辅助模型，禁止 embedding 库 |
| 用户数据只停写不删档 | trash/backup 机制（`backup.ts`、`TRASH_DIR`） | V1/V3 退役走"停写 + 一次性迁移 + 保留原文件"，绝不物理删除 |
| `console.*` 禁用 | `AGENTS.md` | 后台任务失败静默或 Notice |
| 隐私默认关 | `defaultSettings.ts`（consciousness 两开关默认 false） | 空闲观察必须级联 consciousnessEnabled && consciousnessAutoMemory，设置页明示 |
| 注入 IO 预算 | `tests/integration/memory/injectionIoBudget.test.ts`（冷轮 ≤12 ops / 暖轮 0 ops 棘轮） | 新增注入内容（时间/活动/关键词）不得增加每轮磁盘 IO |
| 后台 LLM 预算 | `AuxiliaryRequestGate`（省电模式 + 每日限额 + 前台忙碌） | 一切新增自动模型调用（含空闲观察、关键词懒补）必须过 gate |
| 代码/注释/提交英文 | `AGENTS.md` | 本文档除外（循 `docs/plans/` 现有惯例用中文） |

---

## 3. 阶段 0：清理与止损 ✅（本次开工）

> 小而安全，不改变任何用户可见行为（除预算单位修复）。

- [x] **0.1 路线图落盘**：本文档。
- [x] **0.2 删死代码**：`ConsciousnessEngine.shouldReflect`（原 L197-212）、`ConsciousnessConfig.minConversationsForReflection`/`minMemoriesForConsolidation`/`reflectionIntervalMs`、`ConsciousnessPrivacyConfig.requireConfirmationForImplicit`/`includeSourceContext`（`consciousness-types.ts` 接口与 `DEFAULT_CONSCIOUSNESS_CONFIG`）；同步删除 `ConsciousnessEngine.test.ts` 的 `shouldReflect` describe 块与 `DreamService.test.ts` mock 中的死字段。保留 `allowImplicitExtraction`（`DreamService.ts:317` 在用）。
- [x] **0.3 修单位混用**：新增设置 `memoryMaxInjectionTokens?: number`（默认 1200），`settings.ts` + `defaultSettings.ts` + 设置 UI（Memory 卡）+ i18n（en/zh）；`main.ts` `getMemoryInjectionText` 改用它传 `maxTokens`。旧 `memoryMaxInjectionChars` 语义收窄为 V1 导出视图字符上限，设置 UI 文案同步澄清。
- [x] **0.4 InputController 不可达分支清理**：coordinator 恒存在（`main.ts` 懒加载单例）时 `extractAndSaveMemories`/`recordTurnCompleted` 的 legacy 提取与落日志分支不可达——先以测试证实，再删除分支；保留 consciousness 短期日志写入（若证明仍可达且为 DreamService 输入，则保留到阶段 1 再处置）。
- [x] **0.5 补测试缺口**：InputController 的 ambient 快照装配（`buildTurnSubmission` 挂 `ambientContext`）无任何测试覆盖，补齐。

## 4. 阶段 1：管线统一（V2 单一真相）

- [x] **1.1 检索看见用户消息（速赢）**：7 个 runtime（codex/claude/kimi×2/opencode/pi/dsh）调用 `getMemoryInjectionText()` 时传入当轮用户消息（`userPromptOverride` 参数已存在）。各 provider 的调用点见探索结论：`CodexChatRuntime.ts:360`、`ClaudeChatRuntime.ts:817`、`KimiChatRuntime.ts:329/509`、`OpencodeChatRuntime.ts:357`、`PiChatRuntime.ts:315`、`DshChatRuntime.ts:248`。
- [x] **1.2 V1 做梦退役**：`DreamService` 的 LLM 蒸馏路径移除（每小时 `checkDreamDue`、`runStartupDream` 中对它的调用改为 V2 `processPendingJobs` 的调度入口）；短期日志（`awareness/memory/YYYY-MM-DD.md`）保留为意识日志展示用途。设置页 Dream 参数卡迁移为 V2 作业调度参数。
  > 阶段 0 实施时坐实：清理后 `ConsciousnessEngine.saveShortTermMemory` 在生产已无任何调用点（原唯一调用点即被删除的不可达分支）——短期日志管线实际上早已断粮，V1 做梦在退役前就不再产生效果。`MemoryExtractor` 的生产消费者也已清零（仅剩 `main.ts` 构造与 `FeatureHost` 声明），可随本阶段一并退役。
- [x] **1.3 V3 并入 V2**：`MicroDreamCoordinator.evaluateSession` 改为向 V2 `MemoryRepository` 提交 `status:'candidate'` 记录（复用 `commitExplicit` 或新增 `commitCandidate`）；`MindStore` staging 停写；`MindSettingsTab` 改为审阅 V2 candidates（approve→active / dismiss→forget ledger）。`LegacyMemoryMigrator` 补 MindStore staging→V2 candidate 迁移。
- [x] **1.4 memory.md 变导出视图**：dream commit 后按 kind/scope 刷新导出 `.claudian-plus/memory.md`（用户可见可读，不作为注入源）；删除 `main.ts:1478` 的 `HybridMindPromptInjector` 回退与注入器本身（其 `recordHit` 调用随 V3 退役）。
- [x] **1.5 claimKey 稳定化**：`DreamRunner` 提示词附现有 active claimKey 清单（截断到预算），要求模型对同义事实复用既有键或派生规范键；本地兜底改为归一化内容哈希（替代 `simpleSlug(前 20 字符)`）；`handleExplicitCommand` 的 remember/correct 同样改用规范键生成。契约文件 `dreamMemory.ts` + `v2/types.ts`（`DreamProposal.claimKey` 语义注释）。

## 5. 阶段 2：遗忘、反馈与 GC

- [x] **2.1 反馈闭环**：`getMemoryInjectionText` 拿到 packet 后按 `traceId`+`entries` 批量记 `exposed`（走 `MemoryRepository.recordFeedback`，已有 API）；回合结束时若 assistant 输出包含某 entry 的 claimKey/content 则记 `referenced`；显式纠正记 `corrected`。反馈写盘合并为一次批量调用，不得突破注入 IO 预算。
- [x] **2.2 遗忘接线**：新增维护任务（挂 startup/hourly，无 LLM 调用）：`reviewAfter` 过期 → `archived`；连续 N 次 `exposed` 未 `referenced` 且超阈值天数 → 提前 `reviewAfter`；forget ledger 优先裁决。参数进设置（默认值保守）。
- [x] **2.3 存储 GC**：episodes 保留窗口（默认 90 天，可配置，0=不限）；世代快照在无 queued/running jobs 时压缩重写、仅保留最近 N 代 + CURRENT；feedback/forget-ledger 修剪。全部挂维护任务。
- [x] **2.4 作用域接线**：projectId 派生（vault 根 git remote 优先 → 目录名兜底），贯通 `recordTurnCompleted`/`retrieveContext`/`handleExplicitCommand`；`activeFilePath` 在检索中作加分信号而非过滤条件。
- [x] **2.5 显式命令增强**：句中匹配（"顺便记住…"）；forget 多匹配时全部处理并 Notice 列出，不再静默第一条；`^(?:请?记住…)` 锚定放宽；恢复"列出记忆"命令（legacy 路径删除后该请求在 V2 路径无处理，现状对用户已失效——按 V2 records 计数并 Notice）。

## 6. 阶段 3：检索增强（无新依赖）

- [x] **3.1 打分升级**：`MemoryRetriever.scoreRecord` 改为 IDF 加权的 BM25 风格打分（记录集内文档频率统计，内存中计算，无新增 IO）；加权项：recency 衰减、feedback 衍生置信度、scope/projectId 匹配、active-file 条件匹配。
- [x] **3.2 关键词索引**：`DreamProposal` 增 `keywords: string[]`（3-8 个，辅助模型在蒸馏时顺带生成，不增加额外模型调用）；检索时关键词参与匹配；存量记录由维护任务在下一次 dream 触及时懒补。
- [x] **3.3 预算重平衡**：kind 分层预算改进（当前 profile 被压到 `min(200, 25%)` 过小），随 `memoryMaxInjectionTokens` 重算比例。

## 7. 阶段 4：意识模块升级

- [x] **4.1 时间与活动感知**：`getConsciousnessInjectionText` 注入块新增当前日期时间/星期、最近编辑文件 top-N（`metadataCache`，内存可得零 IO）、最近会话主题；全部纳入 token 预算。
- [x] **4.2 SOUL/USER 截断改 token 预算**：`buildConsciousnessInjection` 的行数截断（10/15 行）改为按 `estimateTokens` 预算截断（预算来自设置）。
- [x] **4.3 Ambient 完善化**：全局开关 + 内容/大纲/链接预算进设置（替换 `ambientFormatter.ts:9-11` 硬编码）；pinned/ignored 按文件持久化到 `.claudian-plus` 设置文件。
- [x] **4.4 空闲观察（IdleActivityObserver）**：空闲 ≥15 分钟且期间有可观活动时，把活动摘要（读了/改了哪些文件、时长）作为 episode（`reason='idle_observation'`）写入 V2，由现有 dream 管线沉淀；零通知零推送；级联 consciousnessEnabled && consciousnessAutoMemory && `AuxiliaryRequestGate.allowsAutomaticTask`。
- [x] **4.5 轮询性能**：`ActiveContextObserver` 仅 composer 聚焦时 500ms 轮询，失焦降频至 2s；文档 stat 未变时跳过 `editor.getValue()` 全读。

## 8. 阶段 5：验证与文档收尾

- [x] 扩展 `tests/integration/memory/injectionIoBudget.test.ts` 覆盖新路径（冷/暖轮 IO 棘轮不回退）。
- [x] 新增单测清单：GC（episodes/世代/修剪）、claimKey 稳定性（同义表述同键）、检索排序（IDF/加权）、反馈回流（exposed/referenced/corrected）、空闲观察（门控与 episode 落盘）。
- [x] 更新 `docs/CODE_WIKI.md` §8（Memory/Consciousness 子系统）、设置 i18n 全量补齐、本文档勾选进度。

---

## 9. 执行约束（全程有效）

1. **TDD**：每个工作项先写失败测试；无法直接测试的（如 Obsidian 事件接线）覆盖最近稳定契约并注明原因。
2. **每阶段收尾**：`npm run typecheck && npm run lint && npm run test && npm run build` 全绿再进入下一阶段。
3. **提交纪律**：代码/注释/提交信息英文；不主动 commit（用户要求时才提交）。
4. **回退安全**：V1/V3 退役相关的每个工作项独立成提交粒度的改动，出问题可单独回退。

## 10. 风险与边界

| 风险 | 缓解 |
| --- | --- |
| V3 staging 有用户未审阅条目时退役丢数据 | 退役前 `LegacyMemoryMigrator` 补 staging→candidate 迁移；MindStore 文件保留不删 |
| 反馈回流写盘放大 IO | 批量合并 + 仅在 packet 非空时写；集成预算测试守住 |
| 空闲观察隐私 | 级联默认关的 consciousness 开关 + gate 预算 + 设置页明示"会记录哪些活动" |
| 关键词索引质量差反而干扰检索 | 关键词只加分不兜底（无关键词命中时回落到现有词元打分） |
| 阶段 1 删除回退路径导致空记忆用户注入变空 | `memory.md` 导出视图在迁移完成后仍可读；migration 幂等（`legacy_v2` 标记） |

## 11. 实施记录（2026-10-24）

阶段 0-5 全部实施完毕。与计划的两点偏差与原因：

1. **V1 短期日志展示保留但不再写入**：清理不可达分支后 `ConsciousnessEngine.saveShortTermMemory` 已无生产调用点；`awareness/` 下的 SOUL/USER/activity 仍作为意识展示面保留，短期日志目录交由用户自行清理（`cleanup-expired-memories` 命令仍在）。
2. **子预算设置保留**：`memoryMaxGlobalInjectionChars` / `memoryMaxProjectInjectionChars` 随注入器退役已不被读取，字段保留仅为设置文件兼容（标记 `@deprecated`），UI 滑杆已移除。

验证结果：`npm run typecheck` 通过；`npm run lint` 0 error；`npm run test` 419 套件 / 7482 通过（1 个存量 skip）；`npm run build` 成功。新增单测覆盖：claimKey 稳定性、候选审批/驳回、保留期归档、存储 GC、反馈汇总与回流、检索 IDF/关键词/反馈/作用域排序、关键词回填、导出视图、projectScope、活动上下文、空闲观察器。
