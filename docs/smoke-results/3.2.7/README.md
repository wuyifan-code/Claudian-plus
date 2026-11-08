# 3.2.7 smoke results

Run on 2026-11-08 against the local vault (`D:\Vaults\Creative Vault`), Obsidian 1.15.0,
plugin built from `3402783c`.

## Verified on this machine

| Item | Evidence |
| --- | --- |
| 权限三档菜单：图标、顺序、当前项勾选 | `permission-menu.png` |
| 上下文用量卡与容量滑块口径一致（`~8K / 1M` ↔ 滑块 `1M`） | `context-card.png` |
| 窗口 chip 在 2 个窗口时出现，popover 列出窗口并带关闭 × | 会话内截图，未归档 |
| 选择器「完全权限」前有风险确认 | 代码路径 + 单测，未截图 |

## Still needs a human pass

The remaining checklist items cannot be produced by an agent safely, because they
need destructive or external conditions:

- 断网后发消息 → 错误条目与「重试」
- 连点两次同一错误 → 只出现一条、计数 ×2
- 关窗后「重新打开」、满额「先关一个再建」
- 抽屉里「复制诊断」后检查脱敏
- 320 / 420 / 620 px × 明暗主题的 toast 与抽屉几何

Run them from `docs/smoke-checklist.md` §「3.2.7 · 窗口与会话」与「3.2.7 · 反馈落点」.
