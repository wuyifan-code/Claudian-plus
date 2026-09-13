# Claudian Plus 智能心智与微梦境引擎 (Dreaming V3 Architecture) — 设计规范

日期: 2026-08-25  
状态: 已批准 (Approved)  
设计参考: OpenAI Dreaming V3 (2026.06 ~ 2026.08) & Human Sleep Consolidation  
目标版本: 3.2.0 / Mind & Memory Milestone  

---

## 1. 背景与核心价值

当前 Claudian Plus 内部的 Awareness 记忆系统为简单的静态全量扫描与平面 JSON 堆叠，存在以下瓶颈：
- **静态无时态**：记忆条目缺乏生命周期与时态感知，旧的临时偏好容易永久滞留；
- **全量无差别注入**：未按当前打开的文件/项目进行动态关联，耗费无谓 Token 且干扰模型注意力；
- **缺乏审阅与隔离**：未将全局用户偏好与 Vault 专属规则物理隔离。

**本方案目标**：全面对标并演进 **OpenAI 2026 最新发布的「Dreaming V3」** 架构，打造一套 **会话驱动、时态感知、项目物理隔离、全透明可审阅的 Obsidian-Native 心智引擎**。

---

## 2. 核心架构与分层设计

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. 会话触发层 (Session Trajectory & Substantive Filter)                       │
│    • 监听会话结束 / Tab 关闭 / 新建会话 (实质对话 ≥ 3 轮)                       │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ 空闲切片调度 (CooperativeIdleScheduler)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. 微梦境提炼与时态演进层 (Micro-Dream Synthesizer)                           │
│    • 调用轻量 AuxQueryRunner 进行结构化推理                                    │
│    • 冲突消解 (Conflict Resolution): 新习惯自动覆盖过时旧偏好                  │
│    • 时态状态迁移 (Temporal Migration): Planned -> Active -> Completed/Stale  │
│    • 衰减分析 (Decay Engine): 长期未激活条目置信度衰减                          │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ 输出待审草稿
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. 待审与存储隔离层 (Staging Inbox & Isolated Storage)                        │
│    • 待审草稿箱: .claudian-plus/awareness/staging-habits.json                │
│    • 项目隔离 (Project-Only): .claudian-plus/awareness/project-rules.json     │
│    • 全局偏好 (Global Profile): ~/.claudian-plus/global-profile.json         │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ 混合双层注入 (Hybrid Prompt Injector)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4. 运行时动态精准注入 (Runtime Dynamic Precision Injection)                   │
│    • Layer 1: 全局用户核心偏好 (<user_profile>, 上限 150 字符常驻)             │
│    • Layer 2: 项目规则与上下文意图精准动态召回 (基于活跃文件与 Prompt 关键词)  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 数据契约与状态机 (Schema & State Machine)

### 3.1 条目生命周期与时态状态

```typescript
export type MindTemporalState = 
  | 'active'       // 当前活跃有效
  | 'planned'      // 计划中 (如: "准备重构为 Svelte 5")
  | 'completed'    // 已完成已落地
  | 'stale';       // 已过时/被覆盖

export type MindCategory = 
  | 'user_preference'   // 用户主观偏好 (如代码注释密度、中文语气)
  | 'coding_habit'      // 编码与技术习惯 (如 pnpm、函数式、TDD)
  | 'project_rule'      // 项目专属架构约束 (如 Provider 隔离原则)
  | 'correction_rule';  // 用户纠偏经验 (明确纠正过的禁忌)

/** 持久化心智条目 */
export interface DurableMindEntry {
  id: string;
  category: MindCategory;
  scope: 'global' | 'project';
  state: MindTemporalState;
  content: string;
  confidence: number;          // 0.0 ~ 1.0 置信度
  lastUsedAt: number;          // 最近被命中/引用的时间戳
  createdAt: number;
  updatedAt: number;
  matchPatterns?: string[];    // 文件路径通配符 (如 "src/providers/**")
  tags: string[];              // 标签索引 (如 ["test", "provider"])
}

/** 待审草稿箱条目 */
export interface StagingMindEntry {
  id: string;
  category: MindCategory;
  scope: 'global' | 'project';
  content: string;
  rationale: string;           // 提炼原因与上下文溯源
  sourceSessionId: string;
  createdAt: number;
}
```

---

## 4. 关键核心机制

### 4.1 会话微梦境提炼（Micro-Dream Synthesis）
- **门槛触发**：用户关闭 Tab、新建会话或清空会话时，若会话满足 `turns >= 3` 或有代码/工具执行实质记录，自动打包对话摘要（上限 6,000 字符）；
- **空闲调度**：利用插件已有的 `CooperativeIdleScheduler` 调度微梦境任务，在主线程空闲时派发给 `AuxQueryRunner`，绝不阻塞用户当前界面的任何操作；
- **时态演进推理**：梦境不仅发现新规则，还负责比对现有心智条目。如果发现某项原有 `planned` 状态已实施（如代码中已全部转为 Svelte 5），自动建议状态迁为 `active`；如果发现偏好改变，自动将旧条目归类为替换/过时。

### 4.2 置信度衰减与自动修剪（Decay & Auto-Pruning）
- 每次对话若动态召回了某条心智，刷新该条目的 `lastUsedAt` 并提升置信度；
- 长达 30 天未被激活且置信度低的心智条目，自动标记为 `stale`，并在设置页提示用户一键归档或移除。

### 4.3 全局与项目物理隔离（Project-Only Memory）
- **全局偏好（Global）**：存放跨 Vault 通用的用户习惯（如“使用中文回答”、“简洁代码风格”）；
- **项目专属（Project-Only）**：存放当前 Vault 独有的架构规范、技术栈约束、特定测试命令等，物理存储在当前 Vault 的 `.claudian-plus/awareness/` 目录下，彻底防止跨项目产生上下文污染。

### 4.4 设置面板集中审阅与管理（Settings Mind Tab）
- **待审草稿区**：展示待确认的偏好与项目规则列表，支持单条 `✓ 采纳`、`✕ 忽略`、行内编辑与 `全部采纳`；
- **已生效心智库**：按 Global / Project 分类标签展示，支持全文检索、行内编辑、置信度与状态切换、手动添加新规则。

---

## 5. 测试与工程验证矩阵

1. `tests/unit/core/memory/MicroDreamCoordinator.test.ts`
   - 会话实质性判定与触发防抖
   - 空闲调度器接入与超时隔离
2. `tests/unit/core/memory/MindStore.test.ts`
   - 草稿箱入队与一键审批
   - 全局与项目存储文件物理隔离
   - 时态状态机迁移与置信度衰减计算
3. `tests/unit/core/memory/HybridMindPromptInjector.test.ts`
   - 基础全局层 + 动态上下文层双层注入
   - 路径通配符与关键词关联匹配
   - Token 预算截断与格式安全保护
4. `tests/unit/features/settings/MindSettingsTab.test.ts`
   - 设置面板列表渲染、批量操作与行内编辑交互
5. **全量回归**：
   - `npm run typecheck && npm run lint && npm test && npm run build`
