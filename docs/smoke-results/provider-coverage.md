# Provider coverage — three-tier sandbox, permission selector, usage

Checked 2026-11-09. Each row states what the provider actually does in the
`read` tier and where that is proven. `--` means no provider-level test exists.

| Provider | `read` 档的实际动作 | 证据 |
| --- | --- | --- |
| Codex | 下发 `sandbox: 'read-only'` | `tests/unit/providers/codex/runtime/CodexChatRuntime.test.ts` › `resolveCodexSandboxConfig`（4 例） |
| Claude | `permissionMode: 'plan'` | `tests/unit/providers/claude/runtime/QueryOptionsBuilder.test.ts`（4 例） |
| Kimi | 拒绝所有 `session/request_permission` | `tests/integration/features/chat/kimiPermissionMode.test.ts`（3 例，fixture 驱动真实 runtime） |
| Pi | 启动参数收窄为只读工具表 | `tests/unit/providers/pi/runtime/piToolModePolicy.test.ts` + `PiLaunchSpec` |
| Antigravity | 不下发 `--dangerously-skip-permissions` | `tests/unit/providers/antigravity/runtime/antigravityPermissionPolicy.test.ts`（3 例） |
| DSH | 拒绝所有 `approval/request` | `tests/unit/providers/dsh/runtime/DshChatRuntime.test.ts` › read-only refuses every approval |
| OpenCode | 拒绝所有 `session/request_permission` | `tests/integration/features/chat/opencodePermissionMode.test.ts`（3 例，fixture 驱动真实 runtime） |

## 这次修掉的真问题

Antigravity 的跳过条件原来是 `settings.autoApproveTools !== false || yolo`，而
`autoApproveTools` **默认为 true**——所以 `read` 档也会照样带
`--dangerously-skip-permissions` 启动，等于没有限制。现在改为由
`resolveAntigravitySkipPermissions()` 决定，`read` 永远返回 false。

## 其它新功能

- **聊天字号**：provider 无关，`tests/unit/features/chat/ui/chatFontSize.test.ts`。
- **上下文用量**：Codex / Claude / DSH / Pi 有原生用量；ACP 系（Kimi / OpenCode）
  依赖 `session/prompt` 响应里的 `usage`。fixture 现在会返回 `usage`，两家的端到端
  用例都断言了 `contextTokens = 1500` / `inputTokens = 1200`。

## 未做

- 真实会话验证：按仓库规矩，自动化测试不消耗账户额度。

## 2026-11-09 补记

上一版留下的两个缺口都已关闭：OpenCode 有了 provider 级用例；ACP 系的用量
做了端到端（fixture 在 `session/prompt` 结果里带 `usage`，Kimi 与 OpenCode 各一条断言）。
