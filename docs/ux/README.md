# Claudian Plus 体验打磨程序（3.2.7 → 3.2.20）

> **本目录是这十四个版本的唯一事实源。** 任何 AI 或人类接手，先读本文件，再读当前版本卡。
> 计划批准日期：2026-11-02；起始发布：3.2.6。

## 现在在哪

| 项 | 值 |
| --- | --- |
| 当前已发布 | **3.2.7**（2026-11-06） |
| 当前版本 | **3.2.8「首开与标签」** |
| 状态 | 3.2.7 已完成，代码与文档已落盘；3.2.8 未开始 |
| 计划发布日 | 3.2.8 计划 2026-12-04 |
| 下一版 | 3.2.8「首开与标签」 |
| 总编排 | 3.2.7 – 3.2.20，共 14 个 patch，约 7 个月 |

## 30 秒接手（给任何 AI 平台）

1. 读 [`contract.md`](contract.md)——10 条红线，任何改动都不能破。
2. 打开当前版本卡 [`releases/3.2.8.md`](releases/3.2.8.md)——任务、验收、交付物。（上一版 3.2.7 见 [`releases/3.2.7.md`](releases/3.2.7.md)，已完成，留作追溯。）
3. 按下面的[工作流](#工作流)执行：先写会红的测试或 checklist，再实现，再真机验收。
4. 完成一项就在版本卡勾一项；发版后更新[状态表](#现在在哪)、[`baseline.md`](baseline.md)、[`roadmap.md`](roadmap.md) 的状态列。
5. 不在本目录写实现细节；实现进代码、测试与 CHANGELOG。

> 换平台时，把这句话发给新的 AI 即可：
> 「读 `docs/ux/README.md`，按当前版本卡执行；先读 `docs/ux/contract.md`，再读 `docs/ux/roadmap.md` 里该版本的详案。」

## 文件地图

| 文件 | 作用 | 更新时机 |
| --- | --- | --- |
| [`roadmap.md`](roadmap.md) | 14 个版本的主题、排期、每版详案与状态 | 每版开始/结束时 |
| [`contract.md`](contract.md) | 10 条体验契约与判定方式 | 只在全体同意时改 |
| [`baseline.md`](baseline.md) | 实测基线、复测命令、ratchet 初始名单 | 每版发布后 |
| [`releases/3.2.8.md`](releases/3.2.8.md) | 当前版本执行卡（DoR/任务/验收/交付/发布记录） | 执行期间持续 |
| [`releases/3.2.7.md`](releases/3.2.7.md) | 上一版执行卡（已完成，留作追溯） | 只读 |
| [`releases/_template.md`](releases/_template.md) | 新版本卡的模板 | 需要时复制 |
| [`backlog.md`](backlog.md) | 版本范围外冒出来的条目 | 随时 |
| [`../plans/2026-11-02-ux-polish-roadmap.md`](../plans/2026-11-02-ux-polish-roadmap.md) | 计划起点的时间点记录（指向本目录） | 不再更新 |

## 工作流

### 版本号

- 主线 3.2.7 → 3.2.20 共 14 个 patch；不切 3.3/4.0，不声明兼容性变化。
- 回归热修优先并入下一版；必须插队时占用下一个号，后续整体顺延。
- 每个 patch 的 CHANGELOG 仍写 `Added / Changed / Fixed`，中英双语同步。

### DoR（开始一个版本前）

- [ ] 版本卡里的验收已写成一条会红的测试，或一条 smoke checklist。
- [ ] 范围只含一个主题；范围外条目已进 `backlog.md`。
- [ ] 若有 schema/存储变更，兼容策略已写进版本卡（旧版本忽略未知字段、不回写会话元数据）。

### DoD（一个版本完成前）

- [ ] 红测试 → 最小实现 → 重构（TDD，遵循根目录 `AGENTS.md`）。
- [ ] `npm run typecheck && npm run lint && npm run test && npm run build` 全绿。
- [ ] `npm run test:architecture`、`npm run check:performance`、review-compliance 全绿。
- [ ] 真机走查：320 / 420 / 620px × 明暗主题，截图归档 `docs/smoke-results/<version>/`。
- [ ] 更新 `docs/smoke-checklist.md` 对应节并勾选。
- [ ] `CHANGELOG.md` + `CHANGELOG_ZH.md`；行为变化时同步 `README.md` + `README_ZH.md`。
- [ ] `npm version <x.y.z>` → `npm run build` → 同步到本地 vault → 重载 Obsidian 验收。
- [ ] 更新 `baseline.md` 数字与本文件状态表。

### 发布清单

```text
npm run typecheck && npm run lint && npm run test && npm run build
npm run test:architecture && npm run check:performance
npm version <version> --no-git-tag-version   # 或按仓库现有流程
node scripts/sync-vault.js
```

然后在 Obsidian 里重载插件，按版本卡的验收清单逐条勾选。

## 维护规则

1. **一版一主题。** 范围外的发现进 `backlog.md`，不夹带。
2. **基线只减不增。** `baseline.md` 里的计数是上限，不是参考值。
3. **不写实现细节。** 本目录只描述"做什么、怎么验收"；"怎么做"属于代码与测试。
4. **状态必须真实。** 未开始就写未开始；跳过就写跳过并说明原因。
5. **契约优先。** 如果某个需求与 `contract.md` 冲突，先改契约（需明确记录），再改实现。

## 决策记录

| 日期 | 决策 | 说明 |
| --- | --- | --- |
| 2026-11-02 | 版本号从 3.3.x 改为 3.2.7 起 | 用户拍板：这是 3.2 线的持续打磨，按补丁号发。 |
| 2026-11-02 | 只补外壳，不加功能面 | 7 个 provider / 54 个 GenUI 组件的表面已够，短板在反馈、导航、上手、文案、尺度。 |
| 2026-11-02 | 计划批准，先落文档与基线 | 3.2.7 代码从下一个工作轮开始。 |
| 2026-11-06 | **3.1.1「隐藏常驻标签条」继续有效** | 第一次修复试图把徽章行加回来，被用户当场否掉：他要的是"能切换、能关闭"的能力，不是那排常驻徽章。最终改为头部 chip + popover，标签条保持永久隐藏。 |
| 2026-11-06 | 标签可达并入 3.2.7，而非等到 3.2.8 | 是回归不是新功能，用户已在日常使用中受伤；3.2.8 只补键盘与计数。 |
| 2026-11-06 | 反馈总线按 `level` + `kind` 两轴建模 | level 管配色与播报礼貌级别，kind 管"必须带什么动作"，由单测约束对应关系。 |
| 2026-11-06 | 140 处 Notice 迁移与窗口修复同版交付 | 用户明确「不是说那 140 个地方就不修了，而是这两个问题要一起并入」。 |

## 总目标（一句话）

> 新人不看文档能发出第一句有用的话；任何一次失败都能在面板里看到原因、下一步和重试；用户的工作（草稿、位置、状态）不会丢。
