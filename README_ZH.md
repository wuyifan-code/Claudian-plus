<p align="right">
  <b>简体中文</b> | <a href="README.md"><b>English</b></a>
</p>

<p align="center">
  <img src="docs/assets/readme-hero.svg" alt="Claudian Plus - 本地优先的 Obsidian AI 协同工作空间" width="100%">
</p>

<p align="center">
  <a href="https://github.com/wuyifan-code/Claudian-plus/releases"><img src="https://img.shields.io/github/v/release/wuyifan-code/Claudian-plus?display_name=tag&sort=semver&color=D9531E" alt="最新版本"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT%20%7C%20AGPL--3.0-292524" alt="开源协议"></a>
  <a href="https://obsidian.md/"><img src="https://img.shields.io/badge/Obsidian-桌面端专属-7C3AED" alt="Obsidian 桌面端"></a>
  <a href="https://github.com/wuyifan-code/Claudian-plus/actions"><img src="https://img.shields.io/github/actions/workflow/status/wuyifan-code/Claudian-plus/ci.yml?branch=main&label=CI%20检查&color=22C55E" alt="CI 状态"></a>
  <img src="https://img.shields.io/badge/遥测-0%20KB%20离线本地-10B981" alt="0 遥测">
</p>

<p align="center">
  <strong>你的笔记记得，你的 AI 也该记得。</strong><br>
  一个本地优先的 Obsidian AI 工作空间，把多 Agent 协同推演、认知记忆（Dreaming V3）与 Provider 会话完全沉淀在你的本地 Vault 中。
</p>

---

## 🎬 30 秒功能与美学演示视频

在 30 秒内完整体验 Claudian Plus 如何将日常对话蒸馏为持久的 Vault 知识网络、联动知识图谱，并在多个主流 Agent 间自由协同：

<div align="center">
  <video src="docs/assets/claudian-plus-demo.mp4" controls="controls" muted="muted" width="100%" style="border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,0.18);" poster="docs/assets/claudian-plus-demo-cover.png">
    <a href="docs/assets/claudian-plus-demo.mp4">
      <img src="docs/assets/claudian-plus-demo-cover.png" alt="Claudian Plus 3.0.1 视频演示海报" width="100%">
    </a>
  </video>
  <p><em>▶ <a href="docs/assets/claudian-plus-demo.mp4">点击查看或下载高清完整演示视频 (30s)</a></em></p>
</div>

### 演示视频核心亮点
- **知识图谱联动**：所有笔记、决策与对话节点自然融入 Obsidian 链接图，让每条思考彼此呼应。
- **Dreaming V3 闲时微梦**：停止打字静止 30 秒后，后台启动微梦机制，自动蒸馏会话沉淀至 `memory.md`。
- **统一会话总线**：在 Codex CLI、Claude Code、Kimi ACP 与 OpenCode/Pi 之间平滑穿梭，不丢上下文。

---

## 💡 为什么选择 Claudian Plus？

传统 AI 插件通常把聊天记录当成一次性的消耗品，窗口一关即付之东流。Claudian Plus 将对话视为严肃的工作会话：上下文进来，结构化决策留下，一个月后再问，AI 依然记得你的偏好。

| 核心诉求 | 传统 AI 插件 | Claudian Plus |
| :--- | :--- | :--- |
| **长程记忆沉淀** | 对话关闭后全部遗忘，重新开聊需反复说明背景 | **Dreaming V3**：空闲时自动提炼关键共识与偏好写入 `memory.md` |
| **Agent 选择自主** | 强绑定单一厂商的 Web API 或特定模型 | **Codex 优先**，同时拥抱 Claude、Kimi ACP、OpenCode 与 Pi |
| **笔记库原生融合** | 复制粘贴到输入框，上下文孤立 | 原生支持 `@note`、`@folder`、拖拽笔记、Canvas 白板与属性关联 |
| **隐私与数据主权** | 对话记录与知识上传至外部云端索引服务 | **0 KB 外部遥测**：所有历史与记忆纯本地存放于 Vault 根目录 |
| **长上下文聚焦** | 冗长的思维链与工具调用吞噬阅读视线 | **悬浮大纲栏**：折叠思考与工具噪音，仅保留关键提示词与跳转标记 |

---

## 🌟 核心特性详解

### 1. 🧠 Dreaming V3：闲时微梦认知记忆引擎

会话结束，记忆继续。当你的键盘静止 30 秒后，Claudian Plus 将在后台触发一次极轻量的蒸馏处理：

<p align="center">
  <img src="docs/assets/dreaming-preview.gif" alt="Dreaming V3 闲时微梦自动蒸馏动效" width="100%" style="border-radius: 10px; border: 1px solid #E5DDD1;">
</p>

- **闲时自动蒸馏**：智能识别讨论中的关键约束、用户偏好与项目决策，去重写入 `.claudian-plus/memory.md`。
- **硬上限注入预算**：提炼的记忆在未来会话中被严格控制在 **3,000 字符**以内注入，绝不浪费宝贵上下文窗口。
- **跨源知识去重**：自动比对多个历史会话得出的结论，合并冗余信息，保持记忆库凝练。
- **极低后台开销**：微梦过程仅占用 `<1.2%` CPU，随时可通过「打开记忆文件」人工查看或编辑。

---

### 2. ⚡ Codex 优先，多 Agent 统一总线

根据不同任务的深度自由调用最擅长的编码与推理 Agent，摆脱单一供应商生态锁定：

<p align="center">
  <img src="docs/assets/claudian-plus-overview.png" alt="Claudian Plus 在 Obsidian 中的实际工作界面" width="100%" style="border-radius: 12px; border: 1px solid #E5DDD1;">
</p>

- **Codex CLI（默认推荐）**：首选接入方案；当本地 CLI 暴露 `gpt-5.6-sol` 时自动优先选用，提供原汁原味的高速流式输出。
- **Claude Code**：深度适配 Anthropic 思维链折叠机制、权限分级审批流及原生项目历史回放。
- **Kimi ACP 标准协议**：通过 ACP 协议接入，具备模型与命令自动发现、按工具审批机制以及多模态图片附件能力。
- **OpenCode & Pi 隔离 Sidecar**：基于 Node 原生模块与预置 TypeBox 构建的零依赖文件桥，外部环境缺失 Node 依赖时基础会话依然稳定可用。

---

### 3. 🗺️ 你的 Vault 就是思考与操作的工作区

无需离开写作界面，轻松将笔记知识注入会话：

- **多元上下文引用**：在输入框使用 `@note` 引用笔记、`@folder` 包含目录，支持直接拖入文件或截取编辑器当前选区。
- **Canvas 白板与图谱感知**：在 Canvas 节点上右键选择 **Suggest neighboring notes**，基于已解析的链接图谱推荐关联笔记。
- **安全写盘防护**：所有对 Vault 文件的修改均提供直观的结构化差异对比（Diff Preview），并支持会话内随时一键撤销（Undo）。
- **轻量属性提取**：`FROM` 语法直接解析 Frontmatter 属性，无需安装或依赖 Dataview 插件 API。

---

## 🏛️ 系统架构设计

<p align="center">
  <img src="docs/assets/architecture-diagram.svg" alt="Claudian Plus 系统架构原理图" width="100%">
</p>

---

## 🚀 快速开始

### 方式一：从 Release 直接安装（推荐）

1. 从 [Latest Release](https://github.com/wuyifan-code/Claudian-plus/releases/latest) 下载 `main.js`、`manifest.json` 与 `styles.css`。
2. 打开你的 Obsidian 笔记库，进入 `.obsidian/plugins/` 目录，新建名为 `claudian-plus/` 的文件夹。
3. 将下载的三个文件放入该目录。
4. 打开 Obsidian，进入「设置 → 第三方插件」，点击重新加载插件，启用 **Claudian Plus** 即可。

> *提示：Claudian Plus 需要与本地 Agent CLI 进程通信并具备文件系统权限，因此仅支持桌面端。*

### 方式二：从源码编译构建

构建要求：**Node.js 24+** 以及至少一个受支持的本地 Provider CLI（[Codex](https://github.com/openai/codex)、[Claude Code](https://claude.ai/claude-code)、[OpenCode](https://opencode.ai/)、[Kimi](https://github.com/MoonshotAI/kimi-cli) 或 [Pi](https://github.com/badlogic/pi-mono)）。

```bash
# 1. 克隆代码仓库
git clone https://github.com/wuyifan-code/Claudian-plus.git
cd Claudian-plus

# 2. 安装依赖并验证类型系统
npm ci
npm run typecheck

# 3. 编译打包生成产物
npm run build
```

*开发技巧：在项目根目录的 `.env.local` 文件中配置 `OBSIDIAN_VAULT=D:\\Obsidian\\My Vault`，执行 `npm run build` 时会自动将编译产物推送到对应笔记库中！*

---

## ⌨️ 常用命令与快捷操作

| 快捷命令 | 功能说明 |
| :--- | :--- |
| `打开聊天窗口` (Open chat view) | 展开 Claudian Plus 侧边栏主工作台 |
| `快速 Agent 输入` (Quick agent input) | 提取当前编辑器焦点选区并发送针对性指令 |
| `搜索对话历史` (Search conversations) | 依据会话标题、Provider、模型名称或时间筛选过往记录 |
| `打开记忆文件` (Open memory file) | 查看由 Dreaming V3 提炼的 `.claudian-plus/memory.md` 知识库 |
| `扫描 Vault 知识` (Scan vault knowledge) | 手动触发笔记库全量知识与图谱引用的重新索引 |
| `撤销最近一次 Canvas 写入` (Undo Canvas write) | 安全回滚最近一次获批的白板画布写入操作 |
| `检查 Provider CLI 健康状态` (Check CLI health) | 诊断本地各 Agent 命令行工具的安装与版本状态 |

---

## 🔒 隐私防护、安全性与存储规范

- **0 KB 外部遥测**：绝不搜集任何使用数据，没有云端打点。提示词、会话历史与沉淀的认知记忆全部保存在笔记库内的 `.claudian-plus/` 目录下。
- **本地凭据隔离**：网络数据请求完全由你本地配置的 CLI 工具或 API 端点负责，插件本身不设立中转代理。
- **旧版平滑迁移**：自动兼容并无损迁移旧版 `.claudian/` 目录中的数据，保护你的知识资产完整延续。

---

## 🛠️ 工程化与测试验证

```bash
npm run typecheck            # 严格模式 TypeScript 类型边界校验
npm run lint                 # ESLint 代码规范静态检查
npm run test                 # 单元测试与集成测试全集
npm run test:architecture    # 跨层级架构依赖边界守卫
npm run check:performance    # 启动耗时与内存水合基线验证
```

---

## 🤝 上游开源项目致谢

Claudian Plus 站在两位先驱开发者的肩膀上构建，真诚致谢：

| 上游项目 | 原作者 | 开源协议 | 在 Claudian Plus 中的贡献 |
| :--- | :--- | :--- | :--- |
| **[Claudian](https://github.com/YishenTu/claudian)** | [Yishen Tu](https://github.com/YishenTu) | MIT | Obsidian Agent 架构基石、Provider 抽象层与会话系统底层设计 |
| **[Codian](https://github.com/BCS1037/codian)** | [BCS1037 / BCS](https://github.com/BCS1037) | AGPL-3.0 | Live Composer 交互设计、文件浏览器动作菜单、Skills 统一管理与服务设置 |

*原创与继承自 Claudian 的代码遵循 **MIT** 开源协议；继承自 Codian 的代码遵循 **AGPL-3.0** 开源协议。详细文件级归属说明请见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。*
