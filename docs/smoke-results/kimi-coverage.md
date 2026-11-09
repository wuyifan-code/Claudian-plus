# Kimi provider — new-feature coverage

Checked on 2026-11-09 against commits `8805327f` / `caf87315`, using the deterministic
ACP fixture peer (`tests/fixtures/acp`). No live model call was made, per the repo rule
that automated tests never spend account credits.

## Covered

| Feature | Test | Result |
| --- | --- | --- |
| 三档选择器渲染与持久化（workspace ↔ full） | `tests/integration/features/chat/kimiPermissionMode.test.ts` › switches the real toolbar selector | pass |
| `workspace` 档：请求走审批回调，被拒则 `fixture:denied` | 同上 › routes real ACP tool requests | pass |
| `full` 档：不询问、直接放行 `fixture:approved` | 同上 | pass |
| `read` 档：**不询问用户**，直接 `fixture:denied` | 同上 › read-only refuses the request without asking the user | pass (new) |
| 审批轴与沙箱轴的投影 | `tests/unit/core/security/sandboxMode.test.ts` | pass |
| ACP 用量映射 | `tests/unit/providers/acp/buildAcpUsageInfo.test.ts` | pass |

Kimi + ACP suites: 17 suites / 119 tests, all green.

## Not covered here

- **真实 Kimi 会话**：CLI 在本机（`C:\Users\weixi\.kimi-code\bin\kimi.exe`），但会消耗账户额度，
  留给人工按需跑。
- **上下文用量卡在 Kimi 上的端到端表现**：`buildAcpUsageInfo` 有单测，但 fixture 的
  `session/prompt` 响应不带 `usage`，所以端到端未验证。真实 Kimi 若返回 usage，圆环与卡片才出现。
- **聊天字号**：provider 无关，由 `tests/unit/features/chat/ui/chatFontSize.test.ts` 覆盖；
  在 Kimi 标签页上的实际观感需人工确认。
