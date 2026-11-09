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
| OpenCode | 拒绝所有 `session/request_permission` | **无 provider 级用例**（逻辑与 Kimi 同源，仅核心 helper 有测试） |

## 这次修掉的真问题

Antigravity 的跳过条件原来是 `settings.autoApproveTools !== false || yolo`，而
`autoApproveTools` **默认为 true**——所以 `read` 档也会照样带
`--dangerously-skip-permissions` 启动，等于没有限制。现在改为由
`resolveAntigravitySkipPermissions()` 决定，`read` 永远返回 false。

## 其它新功能

- **聊天字号**：provider 无关，`tests/unit/features/chat/ui/chatFontSize.test.ts`。
- **上下文用量**：Codex / Claude / DSH / Pi 有原生用量；ACP 系（Kimi / OpenCode）
  依赖 `session/prompt` 响应里的 `usage`，映射在 `buildAcpUsageInfo`（有单测），
  但 fixture 不带 usage，端到端未验。

## 未做

- OpenCode 的 provider 级集成用例（fixture 已具备，只差把 runtime 接进 ACP 假进程的测试）。
- 所有 provider 的真实会话验证：按仓库规矩，自动化测试不消耗账户额度。
