# Claudian Plus

[![GitHub release](https://img.shields.io/github/v/release/wuyifan-code/Claudian-plus)](https://github.com/wuyifan-code/Claudian-plus/releases)
[![License](https://img.shields.io/github/license/wuyifan-code/Claudian-plus)](LICENSE)
[![Obsidian Version](https://img.shields.io/badge/Obsidian-v1.7.2%2B-purple)](https://obsidian.md)

[English](README.md) | 简体中文

**Claudian Plus** 是一个以 Codex 为首选的 AI 编程助手工作空间，专为 Obsidian 设计。它内置可选的本地记忆与意识系统，将 Codex、Claude、OpenCode 和 Pi 整合到同一个桌面聊天界面中，让你的对话、笔记知识和 provider 会话全部保留在本地 vault 中。

---

## ✨ 功能亮点

- 💬 **连续对话工作流** — 多标签界面、对话保存、快速搜索、恢复、分支、回退、provider 原生历史回放。悬浮大纲导航（横杠或圆点样式）预览并跳转到每条提示。
- 🧠 **意识与记忆系统** — 可选的意识文件、长期记忆积累、用户画像支持、vault 知识索引。跨会话携带上下文。
- ✏️ **内联编辑** — 在活跃编辑器中直接执行内联提示，实时展示词级差异预览。
- 📝 **实时编辑器** — `@note` 和 `@folder` 自动补全、拖拽 vault 文件、图片附件、文件管理器集成。
- 🌐 **多 Provider 支持** — 支持 Codex、Claude、OpenCode 和 Pi。模型、会话和权限遵循 provider 原生能力，不假设功能一致。
- ⚙️ **共享工作空间资源** — 跨 provider 管理 MCP 服务器、斜杠命令、技能和子代理。
- 🛡️ **隐私优先** — 直接调用本地 provider CLI，无第三方遥测，所有数据保留在你的 vault 中。

---

## 📸 预览

<!-- TODO: 在此添加预览截图 -->

---

## 📦 环境要求

- **Obsidian**：macOS / Linux / Windows 桌面版 1.7.2 或更高版本
- **Provider CLI**：至少安装一个以下 CLI 并将其加入系统 `$PATH`：
  - [Codex CLI](https://github.com/openai/codex) (`codex`)
  - [Claude Code](https://claude.ai/claude-code) (`claude`)
  - [OpenCode](https://opencode.ai/) (`opencode`)
  - [Pi](https://github.com/badlogic/pi-mono) (`pi`)
- **Node.js**：仅当从源码构建时需要

---

## 🚀 安装方式

### 方式一：手动安装 Release
1. 从 [最新发布页](https://github.com/wuyifan-code/Claudian-plus/releases/latest) 下载 `main.js`、`manifest.json` 和 `styles.css`。
2. 在你的 vault 中创建插件目录：`<vault>/.obsidian/plugins/claudian-plus/`。
3. 将三个文件复制到该目录。
4. 打开 Obsidian **设置 → 第三方插件**，启用 **Claudian Plus**。

### 方式二：从源码构建
需要 Node.js 24。

```bash
git clone https://github.com/wuyifan-code/Claudian-plus.git
cd Claudian-plus
npm ci
npm run build
```

将生成的 `main.js`、`manifest.json`、`styles.css` 复制到 `<vault>/.obsidian/plugins/claudian-plus/`。

开发时可设置 `.env.local` 中的 `OBSIDIAN_VAULT`，然后 `npm run build` 自动同步：

```
OBSIDIAN_VAULT=D:\\Obsidian\\My Vault
```

---

## ⚙️ 首次设置

1. 安装 [Codex CLI](https://github.com/openai/codex) 并完成身份验证，确保 `codex` 在终端中可用。
2. 在 Obsidian 中启用 Claudian Plus 并打开设置。
3. 选择 **Codex** 作为默认 provider。模型选择器默认优先使用 `gpt-5.6-sol`。
4. 权限模式保持 `normal` 即可，除非任务明确需要更宽松的设置。
5. 如果还需要使用 Claude、OpenCode 或 Pi，请分别配置它们的连接。启用此插件不会自动创建或转移这些 provider 的登录状态。

---

## 🧠 意识系统

受 QoderWork 的意识系统启发，Claudian Plus 提供了一个本地记忆层：

| 设置项 | 说明 |
|---------|------|
| **意识模式** | 开启意识文件和 vault 知识上下文 |
| **自动记忆** | 启用启发式提取对话中的重要信息 |
| **查看意识文件** | 打开 `.claudian/awareness/` 目录 |
| **重置所有** | 清除所有意识数据 |

### 记忆触发指令

| 类型 | 中文 | English |
|------|------|---------|
| **保存** | 记住... / 记得... | remember... / keep in mind... |
| **删除** | 忘记... / 忘掉... | forget... / remove memory... |
| **列出** | 列出记忆 | list memories / show memories |

命令：`打开记忆文件`、`扫描 Vault 知识`

---

## 🎨 大纲样式

在 **设置 → Outline style** 中可切换两种悬浮大纲样式：

| 样式 | 效果 |
|------|------|
| **横杠（Bars）** | 水平刻度线 + 弹簧动画；当前激活的刻度向左延伸并带有强调色发光 |
| **圆点（Dots）** | 圆形标记 + 波浪聚焦效果（codian 移植）；悬停时附近的圆点按距离缩放 |

两种样式均为 `fixed` 定位，固定在视口左侧垂直居中，随对话滚动自动更新当前激活的标记。

---

## ❓ 常见问题

### 1. 提示「未检测到 CLI」？
macOS 的 GUI 应用不会自动继承 shell 环境变量。请进入该 provider 的 **连接** 设置标签，手动输入 CLI 的绝对路径（例如 `/usr/local/bin/claude`）。

### 2. 能否与官方 Claudian 同时使用？
**不建议。** 如果两个插件共享同一个 `.claudian/` 数据目录，可能会产生冲突。请一次只启用一个。

---

## 🛠️ 开发者指南

```bash
# 类型检查
npm run typecheck

# 代码检查
npm run lint

# 运行测试
npm run test

# 构建
npm run build
```

提交 Pull Request 前请查阅 `CONTRIBUTING.md`（如有）。

---

## 🙏 致谢

Claudian Plus 是 [Claudian](https://github.com/YishenTu/claudian) 的增强分支，原作者 [Yishen Tu](https://github.com/YishenTu)。衷心感谢 Yishen Tu 及 Claudian 贡献者将 AI 编程助手带入 Obsidian 的开拓性工作。

---

## 📄 许可证

本项目基于 [MIT License](LICENSE) 发布。
