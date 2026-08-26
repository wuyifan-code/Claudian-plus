# Claudian Plus 启动流水线分级调度与性能优化 — 设计规范

日期: 2026-08-25  
状态: 已批准 (Approved)  
目标版本: 3.1.0 / Performance Milestone  

---

## 1. 目标与背景

当前 Claudian Plus 在 Obsidian 中的冷启动和模块评估耗时仍有较大优化空间：
- `main.js` 包含多个 Provider、工具桥接、UI 资产和辅助计算逻辑；
- 在 `onload()` 期间，如果同步执行过多初始化（例如所有 Provider 模块全量注册、历史会话全量元数据加载、意识引擎预热、语义检索索引检查等），会导致 Obsidian 主线程在冷启动时出现瞬时微卡顿；
- 目标：通过**三阶段异步分级调度（Staged Startup Pipeline）**、**16ms 时间切片协作调度（Cooperative Time-Slicing）**和 **JIT 拦截晋升机制（Just-In-Time Promotion）**，使插件首屏骨架在 **<30ms** 内立即可用，主交互在 **~50-80ms** 激活，后台重量级服务平滑在空闲期间逐步就绪，主线程 UI 渲染绝无掉帧。

---

## 2. 核心架构设计

### 2.1 三阶段生命周期模型

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ Obsidian Plugin 启动 (onload)                                           │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
         ┌───────────────────────────┴───────────────────────────┐
         ▼ Phase 0: 瞬时骨架 (<30ms, 同步阻断极小)                 ▼
         │ • 挂载轻量 DOM 骨架与侧边栏 ItemView 容器              │
         │ • 注册 Obsidian 命令面板、Ribbon 图标与文件右键菜单     │
         │ • 加载精简设置（仅包含当前视图必需项）                 │
         │ • 渲染默认 TabBar 骨架，Blob 呈现静默呼吸状态           │
         └───────────────────────────┬───────────────────────────┘
                                     │
         ┌───────────────────────────┴───────────────────────────┐
         ▼ Phase 1: 激活首屏与默认 Provider (~50-80ms)            ▼
         │ • 恢复当前活动的 Tab 状态与输入框焦点                  │
         │ • 仅实例化当前活动 Provider（默认 Codex）              │
         │ • 快速加载最近会话的活跃上下文与草稿                   │
         │ • 输入框立即可响应用户打字与提交                       │
         └───────────────────────────┬───────────────────────────┘
                                     │
         ┌───────────────────────────┴───────────────────────────┐
         ▼ Phase 2: 时间切片空闲期任务（16ms 帧预算分片执行）    ▼
         │ • 非活动 Provider 注册与按需准备 (Claude/Pi/Kimi/...)  │
         │ • 意识引擎 (ConsciousnessEngine) 与记忆库初始化        │
         │ • Vault 语义检索索引构建与断点检查 (checkpoint check)  │
         │ • 全量历史会话元数据分批扫描                           │
         │ • 自动梦境整理 (DreamService) 与旧版数据归档检查       │
         └───────────────────────────────────────────────────────┘
```

### 2.2 核心组件职责

| 组件 | 路径 | 核心职责 |
| --- | --- | --- |
| `CooperativeIdleScheduler` | `src/core/performance/CooperativeIdleScheduler.ts` | 提供基于 `requestIdleCallback` (配合 16ms 预算保护) 的时间切片调度器，支持任务入队、切片执行、JIT 优先级晋升、销毁与取消。 |
| `StagedStartupCoordinator` | `src/core/performance/StagedStartupCoordinator.ts` | 编排 Phase 0 -> Phase 1 -> Phase 2 启动阶段，协调服务注册与状态发布，管理 JIT 拦截屏障（Barrier）。 |
| `StartupProfiler` | `src/core/performance/StartupProfiler.ts` | 记录各 Phase 耗时、分片调度耗时与 JIT 晋升统计指标。 |

---

## 3. JIT 拦截与按需晋升机制（Just-In-Time Promotion）

在 Phase 2 执行完成前，如果用户触发了未完成初始化的后台依赖服务（例如在空闲扫描完成前切换到了 Claude Tab，或触发了全局语义检索）：
1. 消费方通过 `StagedStartupCoordinator.ensureService(serviceId)` 发起请求；
2. 调度器检查目标任务如果处于 Phase 2 队列中，立即将其标记为最高优先级（JIT Promoted）并在当前宏/微任务周期内立即执行完成；
3. 前台 Mini Blob 呈现自然的 `thinking` 动效，避免任何遮罩或未就绪错误；
4. 调度器记录一次 `jit-promotion` 计数，用于性能指标观测。

---

## 4. 协作调度器技术实现细节

### 4.1 时间切片与协作让出（Time-Slicing）
- 每次分配最大 16ms 时间窗口（`deadline.timeRemaining() > 0` 且单次切片耗时 `< 16ms`）；
- 单个大任务（如读取 N 个文件）使用生成器 `function*` 或分步回调模式，每步执行完后检查剩余时间预算；预算不足时调用 `yield` 让出主线程，等待下一个空闲回调。

### 4.2 错误隔离与韧性
- 任何后台任务在调度器内独立包裹 `try/catch`；
- 失败任务记录诊断信息至 `StartupProfiler`，绝不级联打断后续队列或阻塞前台交互。

### 4.3 销毁与垃圾回收
- 插件 `onunload()` 时调用 `scheduler.dispose()`；
- 清理所有未完成的 `requestIdleCallback`、`setTimeout` 与队列引用，杜绝内存泄漏。

---

## 5. 测试与验证策略

### 5.1 自动化测试矩阵
- `tests/unit/core/performance/CooperativeIdleScheduler.test.ts`
  - 任务入队与按时序分片执行
  - 16ms 预算超出自动让出与续传
  - `promote()` 即时执行与优先级提升
  - `dispose()` 状态与计时器销毁
  - 任务异常隔离
- `tests/unit/core/performance/StagedStartupCoordinator.test.ts`
  - Phase 0/1/2 状态推进与回调触发
  - 未就绪服务的 JIT 拦截与返回
  - 销毁与重置行为
- `tests/unit/core/performance/StartupProfiler.test.ts`
  - 分阶段 spans 与 counts 记录准确性

### 5.2 全量工程回归
- `npm run typecheck`
- `npm run lint`
- `npm test` (全量通过)
- `npm run build`
- `npm run check:performance`
