# Claudian Plus

<p align="center">
  <img src="docs/assets/claudian-plus-overview.png" alt="Claudian Plus 在 Obsidian 中的工作区" width="1120">
</p>

<p align="center">
  <strong>你的笔记记得，你的 AI 也该记得。</strong><br>
  一个本地优先的 Obsidian AI 工作空间，把对话、记忆与 Provider 会话都留在你的 Vault 里。
</p>

<p align="center">
  <a href="https://github.com/wuyifan-code/Claudian-plus/releases"><img src="https://img.shields.io/github/v/release/wuyifan-code/Claudian-plus?display_name=tag&sort=semver" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/wuyifan-code/Claudian-plus" alt="License"></a>
  <a href="https://obsidian.md/"><img src="https://img.shields.io/badge/Obsidian-desktop-purple" alt="Obsidian desktop"></a>
  <a href="https://github.com/wuyifan-code/Claudian-plus/actions"><img src="https://img.shields.io/github/actions/workflow/status/wuyifan-code/Claudian-plus/ci.yml?branch=main&label=checks" alt="Checks"></a>
</p>

<p align="center"><a href="README.md">English</a></p>

Claudian Plus 把编码 Agent 放进你的笔记所在之处。它在同一个仅桌面端的 Obsidian 工作空间里整合 Codex、Claude、OpenCode、Kimi 与 Pi——对话结束后，它不会把一切忘光，而是安静地把对话沉淀为 Vault 内持久、可检索的记忆。

## 它与别的 AI 工具有什么不同

### 它会记得你聊过什么

意识机制在后台安静工作：空闲时，一次轻量模型调用会把短期日志蒸馏为长期记忆和用户画像。下个月再问，答案已经在那里。全程 opt-in、本地保存，随时可以用「打开记忆文件」浏览。

### Codex 优先，Provider 中立

检测到 Codex 时它作为默认 Agent，本地 CLI 暴露 `gpt-5.6-sol` 时优先选用。Claude、OpenCode、Kimi 与 Pi 依然是一等公民——各自保留能力、历史格式、权限与运行时边界，你永远不会被某个厂商的假设锁死。

Kimi 通过标准 ACP 协议接入，支持模型/命令自动发现、图片附件、按工具调用审批和 Kimi 原生模型切换。OpenCode 和 Pi 在 Obsidian 进程之外运行，托管适配器是基于文件的兼容层：OpenCode sidecar 只使用 Node 内置模块，Pi 扩展复用 Pi 已提供的 TypeBox 包。`FROM` 查询读取 frontmatter，不会调用 Dataview 插件 API；如果 Provider 环境缺少 Node，聊天仍可使用，只会跳过外部工具层。

### 你的 Vault 就是工作区

用 `@note`、`@folder`、拖拽文件、图片附件、编辑器选区和文件浏览器菜单把上下文带进对话。Provider 原生工具可以读取，并在你批准后更新 Canvas、Properties、链接与图谱邻居。写入始终限定在 Vault 范围内、展示结构化 diff、支持会话内撤销。

### 更平静的对话界面

悬浮大纲栏只呈现用户提示与助手标题，折叠思考与工具噪音，让你在长对话里始终保持方向感。悬停 tick 预览、跳转不丢状态，左右位置随你设置。

### 默认本地

无遥测、无云端索引。对话、记忆与知识数据都在 Vault 的 `.claudian-plus/` 下；旧版 `.claudian/` 数据会自动读取并迁移。

## 为什么选择 Claudian Plus？

多数 AI 工具把聊天记录当成一次性的。Claudian Plus 把对话当作一场工作会话：上下文进来，记忆留下，一个月后每个有用的结论依然可查。

| 你想要… | Claudian Plus 给你… |
| --- | --- |
| 用你熟悉的 Agent 工作 | Codex 优先的默认值、Provider 原生会话、模型发现与独立的权限流 |
| 让 Vault 始终在上下文里 | `@note` / `@folder` 上下文、拖拽文件、图片、编辑器选区、文件浏览器菜单、Canvas、Properties 与链接 |
| 找到上个月聊过的事 | 本地对话历史搜索、恢复、分叉、回退与 Provider 原生回放 |
| 不靠云端索引搭建第二大脑 | 可选记忆、意识文件与本地优先存储 |
| 在长对话里保持方向感 | 紧凑的悬浮大纲：提示与标题常驻，思考与工具噪音折叠 |

## 从 Release 安装

1. 从[最新 Release](https://github.com/wuyifan-code/Claudian-plus/releases/latest)下载 `main.js`、`manifest.json` 和 `styles.css`。
2. 在 Vault 中创建 `<vault>/.obsidian/plugins/claudian-plus/`。
3. 将三个文件复制到该目录。
4. 在 Obsidian「设置 → 第三方插件」中启用 **Claudian Plus**。

Claudian Plus 仅限桌面端，因为它需要集成本地 Agent CLI 与桌面文件系统能力。

## 从源码构建

环境要求：Node.js 24，以及至少一个受支持的 Provider CLI（[Codex](https://github.com/openai/codex)、[Claude Code](https://claude.ai/claude-code)、[OpenCode](https://opencode.ai/)、[Kimi](https://github.com/MoonshotAI/kimi-cli) 或 [Pi](https://github.com/badlogic/pi-mono)）。

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

然后重新运行 `npm run build`。构建会把三个插件文件复制到 `<vault>/.obsidian/plugins/claudian-plus/`。

## 第一次使用

1. 安装并登录至少一个 Provider CLI。检测到 Codex 时，它会作为默认 Provider。
2. 打开 Claudian Plus 设置；如果 Obsidian 没有继承终端的 `PATH`，请填写 CLI 的绝对路径。
3. 熟悉各 Provider 的确认流程前，建议保持权限模式为 `normal`。
4. 仅在需要时开启记忆和意识功能。
5. 如需探索 Canvas 邻近笔记：选中文件或链接节点后右键 Canvas，选择 **Suggest neighboring notes**。面板只读取 Obsidian 已解析的链接图，不会未经明确点击写入。

## 常用命令

- **打开聊天窗口** — 打开主工作空间。
- **快速 Agent 输入** — 带上当前编辑器上下文发送一个聚焦请求。
- **搜索对话** — 按标题、Provider、模型、日期或首条消息筛选历史记录。
- **打开记忆文件** / **扫描 Vault 知识** — 查看或刷新本地记忆层。
- **撤销最近一次 Canvas 写入** — 撤销当前 Obsidian 会话中已批准的 Canvas 操作。
- **检查 Provider CLI 健康状态** — 诊断缺失或过期的 Provider CLI。

可以把笔记或文件夹拖入输入框，或从文件浏览器右键菜单添加。

## 隐私、权限与存储

插件不提供遥测服务。请求只会通过你显式配置的 Provider CLI、SDK、MCP 服务器或嵌入端点发送。知识索引和记忆数据保存在 Vault 内的 `.claudian-plus/` 下。

插件会读取旧版 `.claudian/` 数据，并在相关数据下次保存时迁移到 `.claudian-plus/`。不要同时运行旧版 Claudian 和 Claudian Plus 访问同一个 Vault。Agent 工具可以读取文件、运行命令并修改已批准的 Vault 数据；处理敏感笔记前，请先确认当前 Provider 与权限模式。

## 验证命令

```bash
npm run typecheck
npm run lint
npm run test
npm run test:architecture
npm run build
npm run check:performance
```

## 上游项目、许可与致谢

Claudian Plus 建立在两个上游项目之上。它们的原作者、许可证和贡献如下：

| 上游仓库 | 原作者 | 开源协议 | 在 Claudian Plus 中的贡献 |
| --- | --- | --- | --- |
| [Claudian](https://github.com/YishenTu/claudian) | [Yishen Tu](https://github.com/YishenTu) | [MIT](https://github.com/YishenTu/claudian/blob/main/LICENSE) | Obsidian Agent 工作区、Provider 架构、聊天/会话基础和原始工作流 |
| [Codian](https://github.com/BCS1037/codian) | [BCS1037 / BCS](https://github.com/BCS1037) | [AGPL-3.0](https://github.com/BCS1037/codian/blob/main/LICENSE) | Live Composer、文件浏览器动作、Skills 管理、Provider 服务设置等适配功能 |

感谢 Yishen Tu、BCS 以及两个项目的社区贡献者。详细的文件级来源说明见 [NOTICE](NOTICE)。

本仓库同时包含原创代码、Claudian 的 MIT 许可代码和 Codian 的 AGPL-3.0 许可代码。重新分发或修改 Codian 来源部分时，请遵守其上游许可证义务。

## 许可证

MIT，详见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。上文的上游许可条款是发行版的一部分。
