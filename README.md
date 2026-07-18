# Claudian Plus

[![GitHub stars](https://img.shields.io/github/stars/wuyifan-code/Claudian-plus?style=social)](https://github.com/wuyifan-code/Claudian-plus)
[![GitHub release](https://img.shields.io/github/v/release/wuyifan-code/Claudian-plus)](https://github.com/wuyifan-code/Claudian-plus/releases)
[![License](https://img.shields.io/github/license/wuyifan-code/Claudian-plus)](LICENSE)

> Obsidian 插件 ID：`Claudian-plus`

Claudian Plus 是 [Claudian](https://github.com/YishenTu/claudian) 的 Codex-first 增强分支，把 Codex、Claude Code、OpenCode、Pi 等编码 Agent 带进 Obsidian，并以本地优先的方式读写、检索和整理知识库。

![Preview](assets/Preview.png)

## 当前增强

- 新安装默认启用并选择 Codex，优先使用 `gpt-5.6-sol`，同时保留动态模型发现和自定义模型能力。
- Codex 版悬浮对话大纲：提取用户问题与助手 H1–H3 标题，支持悬浮预览、键盘操作、当前位置追踪和点击跳转。
- 独立的 Obsidian 插件身份、View Type、热键命令前缀和开发安装目录，不会覆盖官方 Claudian 插件目录。
- 继续兼容上游的多标签页、历史对话、行内编辑、`@mention`、Slash Commands、Skills、MCP 和多 Provider 架构。

后续的拖拽笔记/文件夹、聊天记录检索、混合 RAG 与类 flomo 洞察计划见 [ENHANCEMENTS.md](ENHANCEMENTS.md)。

## 要求

- Obsidian 1.7.2 或更高版本，仅支持桌面端。
- 使用 Codex 时需安装并登录 [Codex CLI](https://github.com/openai/codex)。
- 其他 Provider 需要各自的 CLI 或认证配置。

## 安装

Claudian Plus 目前未上架 Obsidian Community Plugins，请通过 GitHub Release 或源码安装。

### GitHub Release

1. 从 [最新 Release](https://github.com/wuyifan-code/Claudian-plus/releases/latest) 下载 `main.js`、`manifest.json` 和 `styles.css`。
2. 在库中创建目录 `.obsidian/plugins/Claudian-plus/`。
3. 将三个文件放入该目录，然后在 Obsidian 的“第三方插件”中启用 **Claudian Plus**。

### 从源码构建

```bash
cd /path/to/vault/.obsidian/plugins
git clone https://github.com/wuyifan-code/Claudian-plus.git
cd Claudian-plus
npm install
npm run build
```

开发环境需要 Node.js 24。常用命令：

```bash
npm run dev
npm run typecheck
npm run lint
npm run test
npm run build
```

设置 `OBSIDIAN_VAULT` 后运行开发构建，产物会依据 `manifest.json` 中的 ID 自动复制到 `.obsidian/plugins/Claudian-plus/`。

## 数据兼容说明

为了继承现有设置和历史，Claudian Plus 目前继续使用库内的 `.claudian/` 数据目录，并读取各 Provider 自己维护的会话记录。请暂时不要让官方 Claudian 与 Claudian Plus 在同一个库中同时启用，以免两者并发修改共享数据；后续会通过带迁移机制的独立存储解决真正并行启用的问题。

Claudian Plus 不包含遥测。网络请求只来自你主动调用的 Provider、MCP 服务或对应 SDK/CLI。

## 上游与许可证

本项目基于 Yishen Tu 与 Claudian contributors 的 [YishenTu/claudian](https://github.com/YishenTu/claudian) 开发，感谢原项目公开的代码、架构与文档。Claudian Plus 的增强记录保留在当前 Git 历史中，上游仓库仍作为同步来源。

项目依据 [MIT License](LICENSE) 发布。
