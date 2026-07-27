# Claudian Plus

[![GitHub release](https://img.shields.io/github/v/release/wuyifan-code/Claudian-plus)](https://github.com/wuyifan-code/Claudian-plus/releases)
[![License](https://img.shields.io/github/license/wuyifan-code/Claudian-plus)](LICENSE)
[![Obsidian Version](https://img.shields.io/badge/Obsidian-v1.7.2%2B-purple)](https://obsidian.md)

[English](README.md) | [简体中文](README_ZH.md)

**Claudian Plus** is a Codex-first AI agent workspace for Obsidian with an opt-in local memory and awareness layer. It combines Codex, Claude, OpenCode, and Pi in one desktop chat workspace, keeping your conversations, vault knowledge, and provider sessions entirely in your local vault.

---

## ✨ Feature Highlights

- 💬 **Continuous Conversation Workflow** — Multi-tab interface, saved conversations, fast session search, resume, fork, rewind, and provider-native history replay. Floating outline navigation (bars or dots) previews and jumps to each prompt.
- 🧠 **Consciousness & Memory System** — Opt-in awareness files, long-term memory accumulation, user profile support, and vault knowledge indexing. Cross-session context carried across conversations.
- ✏️ **Inline Editing** — Inline prompt execution with real-time word-level diff previews directly in your active editor.
- 📝 **Live Composer** — Auto-completing `@note` and `@folder` mentions, drag-and-drop vault items, image attachments, and File Explorer integration.
- 🌐 **Multi-Provider Support** — Works with Codex, Claude, OpenCode, and Pi. Models, sessions, and permissions follow provider-native capabilities; feature parity is never assumed.
- ⚙️ **Shared Workspace Resources** — Manage MCP servers, slash commands, Skills, and subagents across supported providers.
- 🛡️ **Privacy First** — Operates directly with local provider CLIs. No third-party telemetry. All data stays in your vault.

---

## 📸 Preview

<!-- TODO: Add a preview screenshot here. Example: assets/Preview.png -->

---

## 📦 Requirements

- **Obsidian**: Version 1.7.2 or later on macOS, Linux, or Windows (desktop only).
- **Provider CLI**: At least one of the following installed and available on your system `$PATH`:
  - [Codex CLI](https://github.com/openai/codex) (`codex`)
  - [Claude Code](https://claude.ai/claude-code) (`claude`)
  - [OpenCode](https://opencode.ai/) (`opencode`)
  - [Pi](https://github.com/badlogic/pi-mono) (`pi`)
- **Node.js**: Only required if building from source.

---

## 🚀 Installation

### Option 1: Manual Install from Release
1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/wuyifan-code/Claudian-plus/releases/latest).
2. Create the plugin directory inside your vault: `<vault>/.obsidian/plugins/claudian-plus/`.
3. Copy the three downloaded files into that directory.
4. Open Obsidian **Settings → Community plugins**, enable **Claudian Plus**.

### Option 2: Build from Source
The project requires Node.js 24.

```bash
git clone https://github.com/wuyifan-code/Claudian-plus.git
cd Claudian-plus
npm ci
npm run build
```

Copy the generated `main.js`, `manifest.json`, and `styles.css` to `<vault>/.obsidian/plugins/claudian-plus/`.

For development, set `OBSIDIAN_VAULT` in `.env.local` before building:

```
OBSIDIAN_VAULT=D:\\Obsidian\\My Vault
```

Then `npm run build` copies the files automatically.

---

## ⚙️ First-Time Setup

1. Install and authenticate the [Codex CLI](https://github.com/openai/codex) — make sure `codex` is available in your terminal.
2. Enable Claudian Plus in Obsidian and open its settings.
3. Select **Codex** as the default provider. The model selector prefers `gpt-5.6-sol` when available.
4. Keep the default permission mode at `normal` unless a task explicitly requires a different approval policy.
5. Configure Claude, OpenCode, or Pi separately if you need those providers. Enabling this plugin does not create or transfer their login state.

---

## 🧠 Consciousness System

Inspired by QoderWork's awareness system, Claudian Plus provides an early local memory layer:

| Setting | Description |
|---------|-------------|
| **Consciousness Mode** | Opt in to awareness files and vault knowledge context |
| **Auto Memory** | Enable heuristic extraction of important conversation details |
| **View Awareness Files** | Open the `.claudian/awareness/` directory |
| **Reset All** | Clear all consciousness data |

### Memory Triggers

| Type | Chinese | English |
|------|---------|---------|
| **Save** | 记住... / 记得... | remember... / keep in mind... |
| **Delete** | 忘记... / 忘掉... | forget... / remove memory... |
| **List** | 列出记忆 | list memories / show memories |

Commands: `Open memory file`, `Scan vault knowledge`

---

## 🎨 Outline Style

Choose between two floating outline styles in **Settings → Outline style**:

| Style | Preview |
|-------|---------|
| **Bars** | Horizontal tick marks with spring animation; active marker extends to the left with accent color glow |
| **Dots** | Circular markers with codian-inspired wave-focus effect; dots near the hovered marker grow in proportion to their distance |

Both styles remain fixed-positioned at the left side of the viewport and update the active marker as you scroll through the conversation.

---

## ❓ FAQ & Troubleshooting

### 1. CLI not detected?
macOS GUI apps don't inherit shell environment variables. Go to the provider's **Connection** tab in Settings and enter the absolute CLI path (e.g., `/usr/local/bin/claude`).

### 2. Can I use Claudian Plus alongside the official Claudian?
**Not recommended.** If both plugins share the same `.claudian/` data directory, they may conflict. Use only one at a time.

---

## 🛠️ Development & Verification

```bash
# Type check
npm run typecheck

# Lint
npm run lint

# Test
npm run test

# Build
npm run build
```

Review [CONTRIBUTING.md](CONTRIBUTING.md) (if available) before submitting pull requests.

---

## 🙏 Acknowledgments

Claudian Plus is an enhanced fork of [Claudian](https://github.com/YishenTu/claudian), created by [Yishen Tu](https://github.com/YishenTu). I am deeply grateful to Yishen Tu and the Claudian contributors for their pioneering work in bringing AI coding agents to Obsidian.

---

## 📄 License

This project is released under the [MIT License](LICENSE).
