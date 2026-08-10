# Claudian Plus

<p align="center">
  <img src="docs/assets/claudian-plus-overview.png" alt="Claudian Plus 在 Obsidian 中的工作区" width="1120">
</p>

<p align="center"><strong>让 Agent 靠近你的笔记，让对话沉淀为可检索的知识。</strong></p>

[![GitHub release](https://img.shields.io/github/v/release/wuyifan-code/Claudian-plus)](https://github.com/wuyifan-code/Claudian-plus/releases)
[![License](https://img.shields.io/github/license/wuyifan-code/Claudian-plus)](LICENSE)

[English](README.md)

Claudian Plus 是一个以 Codex 为优先的 Obsidian AI 工作空间。它把对话、Provider 会话、本地记忆和 Vault 上下文保留在本地 Vault 中，同时支持 Codex、Claude、OpenCode、Kimi 和 Pi 五种独立运行时。

## 当前能力

- 多 Tab 对话：历史检索、恢复、分叉、回退、Provider 原生历史，以及悬浮对话大纲。
- Codex 默认 Provider：支持模型发现，检测到时优先使用 `gpt-5.6-sol`。
- 本地记忆与意识文件：可选自动记忆提取、意识文件、短期日志与 Dream 记忆整合。
- Obsidian 原生上下文：`@note`、`@folder`、拖拽文件、图片附件、编辑器选区操作和文件浏览器菜单。
- Provider 适配的 Obsidian 工具：Canvas、Properties、链接、图谱邻居和只读 Dataview 查询。Canvas 选中节点后右键“Suggest neighboring notes”，可查看方向、来源、打开和明确的插入链接动作。Codex/Claude 使用进程内适配；OpenCode 使用托管的本地 MCP sidecar；Pi 使用托管的 RPC 扩展。写入始终保持 Vault 范围，并经过 Provider 的确认流程；Canvas 写入会返回结构化 diff，并可在当前 Obsidian 会话中使用“Undo last Canvas write”撤销。
- Provider CLI 健康检查，以及可操作的 CLI 缺失提示。
- Provider 独立的权限和能力边界，不假设不同运行时功能完全一致。
- Kimi Code CLI 支持：通过标准 ACP 协议接入 `kimi acp`，模型/命令自动发现、图片附件、按工具调用审批、Kimi 原生 `session/set_model` 模型切换。

OpenCode 和 Pi 在 Obsidian JavaScript 进程之外运行，因此它们的托管适配器是基于文件的兼容层：OpenCode sidecar 只使用 Node 内置模块，Pi 扩展复用 Pi 已提供的 TypeBox 包。常见的 `FROM` 查询可读取 frontmatter，但不会调用 Dataview 插件 API。如果 Provider 环境中找不到 Node，聊天仍可使用，只会跳过外部工具层。

## 环境要求

- Obsidian 桌面版 1.11.4 或更高版本。
- 至少安装并登录一个 Provider CLI：
  - [Codex CLI](https://github.com/openai/codex)（`codex`）
  - [Claude Code](https://claude.ai/claude-code)（`claude`）
  - [OpenCode](https://opencode.ai/)（`opencode`）
  - [Kimi Code CLI](https://github.com/MoonshotAI/kimi-cli)（`kimi`）
  - [Pi](https://github.com/badlogic/pi-mono)（`pi`）
- 只有从源码构建时才需要 Node.js。

## 从 Release 安装

1. 从[最新 Release](https://github.com/wuyifan-code/Claudian-plus/releases/latest)下载 `main.js`、`manifest.json` 和 `styles.css`。
2. 在 Vault 中创建 `<vault>/.obsidian/plugins/claudian-plus/`。
3. 将三个文件复制到该目录。
4. 在 Obsidian「设置 → 第三方插件」中启用 **Claudian Plus**。

## 从源码构建

```bash
git clone https://github.com/wuyifan-code/Claudian-plus.git
cd Claudian-plus
npm ci
npm run typecheck
npm run build
```

如果希望构建后自动复制到 Vault，可在 `.env.local` 中设置：

```text
OBSIDIAN_VAULT=D:\\Obsidian\\My Vault
```

然后运行 `npm run build`。

## 第一次使用

1. 安装并登录至少一个 Provider CLI。检测到 Codex 时，它会作为默认 Provider。
2. 打开 Claudian Plus 设置；如果 Obsidian 没有继承终端的 `PATH`，请填写 CLI 的绝对路径。
3. 熟悉各 Provider 的确认流程前，建议保持权限模式为 `normal`。
4. 仅在需要时开启记忆和意识功能。
5. 如需探索 Canvas 邻近笔记，选中文件或链接节点后右键 Canvas，选择 **Suggest neighboring notes**。面板只读取 Obsidian 已解析的链接图，不会未经明确点击写入。

## 常用命令

- **打开聊天窗口**
- **快速 Agent 输入**
- **撤销最近一次 Canvas 写入**（当前 Obsidian 会话）
- **检查 Provider CLI 健康状态**
- **打开记忆文件**
- **扫描 Vault 知识**

可以把笔记或文件夹拖入输入框，或从文件浏览器右键菜单添加。

## 隐私与安全

插件不提供遥测服务。请求会按照所选 Provider 自身的配置发送到本地 CLI/运行时。知识索引和记忆数据保存在 `.claudian-plus/` 下；升级时会兼容读取旧的 `.claudian/` 数据。结构化工具运行前会校验 Vault 路径，Canvas 和 Properties 写入需要用户确认。

不要同时运行旧版 Claudian 和 Claudian Plus 访问同一个 Vault。

## 验证命令

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:architecture
npm run build
```

## 致谢

Claudian Plus 建立在两个上游项目之上。它们的原作者、许可证和贡献如下：

| 上游仓库 | 原作者 | 开源协议 | 在 Claudian Plus 中的贡献 |
| --- | --- | --- | --- |
| [Claudian](https://github.com/YishenTu/claudian) | [Yishen Tu](https://github.com/YishenTu) | [MIT](https://github.com/YishenTu/claudian/blob/main/LICENSE) | Obsidian Agent 工作区、Provider 架构、聊天/会话基础和原始工作流 |
| [Codian](https://github.com/BCS1037/codian) | [BCS1037 / BCS](https://github.com/BCS1037) | [AGPL-3.0](https://github.com/BCS1037/codian/blob/main/LICENSE) | Live Composer、文件浏览器动作、Skills 管理、Provider 服务设置等适配功能 |

感谢 Yishen Tu、BCS 以及两个项目的社区贡献者。详细的文件级来源说明见 [NOTICE](NOTICE)。

本仓库同时包含原创代码、Claudian 的 MIT 许可代码和 Codian 的 AGPL-3.0 许可代码。重新分发或修改 Codian 来源部分时，请遵守其上游许可证义务。

## 许可证

MIT，详见 [LICENSE](LICENSE)。
