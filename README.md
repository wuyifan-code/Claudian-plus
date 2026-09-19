<p align="right">
  <a href="README_ZH.md">简体中文</a> | <b>English</b>
</p>

<p align="center">
  <img src="docs/assets/readme-hero.svg" alt="Claudian Plus - Local-First AI Workspace for Obsidian" width="100%">
</p>

<p align="center">
  <a href="https://github.com/wuyifan-code/Claudian-plus/releases"><img src="https://img.shields.io/github/v/release/wuyifan-code/Claudian-plus?display_name=tag&sort=semver&style=flat-square&color=262626" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT%20%7C%20AGPL--3.0-262626?style=flat-square" alt="License"></a>
  <a href="https://obsidian.md/"><img src="https://img.shields.io/badge/obsidian-desktop-262626?style=flat-square" alt="Obsidian desktop"></a>
  <a href="https://github.com/wuyifan-code/Claudian-plus/actions"><img src="https://img.shields.io/github/actions/workflow/status/wuyifan-code/Claudian-plus/ci.yml?branch=main&label=checks&style=flat-square&color=262626" alt="CI status"></a>
  <img src="https://img.shields.io/badge/telemetry-0%20KB%20offline-262626?style=flat-square" alt="Zero telemetry">
</p>

<p align="center">
  <strong>Your notes remember. Now your AI does too.</strong><br>
  A local-first AI workspace for Obsidian that anchors multi-agent reasoning, cognitive memory, and provider sessions directly inside your Vault.
</p>

Claudian Plus embeds provider-backed coding agents in an Obsidian workspace. It combines Codex, Claude, OpenCode, Kimi, and Pi with a quiet background consciousness mechanism: instead of discarding conversations when a chat closes, it distills short-term working context into durable, searchable memory inside your Vault.

---

## 01 / Demonstration

A 30-second walkthrough showing local memory distillation, knowledge graph linkage, and multi-agent coordination inside Obsidian:

<div align="center">
  <a href="docs/assets/claudian-plus-demo.mp4">
    <img src="docs/assets/claudian-plus-demo.gif" alt="Claudian Plus 30-second workflow demonstration" width="100%" style="border-radius: 8px; border: 1px solid #E6DFD5;">
  </a>
  <p><em>Auto-playing demonstration • <a href="docs/assets/claudian-plus-demo.mp4">View or download raw HD video (30s, 720p)</a></em></p>
</div>

### What the demonstration covers
- **Knowledge graph connection**: Conversations and decisions map directly into your Vault's link structure.
- **Dreaming V3 distillation**: 30 seconds of typing silence triggers background memory extraction into `memory.md`.
- **Multi-agent bus**: Coordinate across Codex CLI, Claude Code, Kimi ACP, and OpenCode/Pi without losing context.

---

## 02 / The Difference

Most AI plugins treat conversation history as disposable text. Claudian Plus treats conversations as creative working sessions: context enters, decisions distill into memory, and every insight remains searchable weeks later.

| Everyday Need | Traditional AI Extensions | Claudian Plus |
| :--- | :--- | :--- |
| **Long-term continuity** | Erased once the chat closes or context exceeds limits | **Dreaming V3**: idle micro-dreams distill facts into `memory.md` |
| **Agent flexibility** | Locked into one provider's web chat assumptions | **Codex-first default** with Claude, Kimi ACP, and OpenCode/Pi parity |
| **Vault context** | Manual copy-pasting into chat inputs | Direct `@note`, `@folder`, drag-and-drop, Canvas, and Properties queries |
| **Privacy & sovereignty** | Sessions indexed on external cloud servers | **0 KB telemetry**: All memories and sessions remain inside your Vault |
| **Long session focus** | Wall-of-text reasoning clutter | **Floating outline**: Collapses tool and thought noise into clickable ticks |

---

## 03 / Cognitive Memory: Dreaming V3

Conversations end; memory continues. When your keyboard rests for 30 seconds, Claudian Plus triggers an unobtrusive background micro-dream:

<p align="center">
  <img src="docs/assets/dreaming-preview.gif" alt="Dreaming V3 idle distillation preview" width="100%" style="border-radius: 8px; border: 1px solid #E6DFD5;">
</p>

### Verified Engineering Specifications

| Metric | Measured Value | Operational Scope |
| :--- | :--- | :--- |
| **Idle CPU overhead** | `< 1.2%` | Background memory distillation while typing is paused |
| **Memory character budget** | `3,000` chars | Strict upper limit injected into subsequent agent prompts |
| **Test suite pass rate** | `100%` | Continuous integration covering all provider runtimes |
| **External telemetry emitted** | `0 KB` | Completely offline; requests route solely to configured CLIs |

- **Idle micro-distillation**: Extracts user preferences, decisions, and constraints into `.claudian-plus/memory.md`.
- **Budget-bounded injection**: Distilled insights are compacted within a strict 3,000 character ceiling before injection.
- **Cross-source deduplication**: Resolves overlapping conclusions between multiple conversations automatically.
- **Local file control**: View, edit, or clear memory at any time via **Open memory file**.

---

## 04 / Multi-Agent Architecture

Work with the exact reasoning engine suited to your task without provider lock-in:

<p align="center">
  <img src="docs/assets/claudian-plus-overview.png" alt="Claudian Plus inside Obsidian workspace" width="100%" style="border-radius: 8px; border: 1px solid #E6DFD5;">
</p>

- **Codex CLI (Default)**: Preferred agent; automatically detects and leverages `gpt-5.6-sol` when exposed by your local CLI, with native real-time streaming output.
- **Claude Code**: Supports Anthropic thinking chain folding, permission modes, and native project history replay.
- **Kimi ACP protocol**: ACP standard integration with dynamic model/command discovery, tool approval dialogs, and multimodal image attachments.
- **OpenCode & Pi sidecars**: Sandboxed sidecars utilizing Node built-ins and pre-bundled TypeBox, ensuring chat operates even when external tool dependencies are absent.

---

## 05 / Vault Workspace Integration

Anchor agent assistance directly into your personal knowledge base:

- **Context ingestion**: Reference notes with `@note`, folders with `@folder`, drag-and-drop files, or highlight active editor selections.
- **Visual Canvas and graph awareness**: Right-click any Canvas node to **Suggest neighboring notes** based on Obsidian's resolved link graph.
- **Safe Vault guards**: File modifications display a structured diff preview with in-session **Undo** protection.
- **Metadata extraction**: Fast `FROM` frontmatter queries execute without dependency on third-party plugin APIs.

---

## 06 / System Architecture

<p align="center">
  <img src="docs/assets/architecture-diagram.svg" alt="Claudian Plus system architecture diagram" width="100%">
</p>

---

## 07 / Installation & Quickstart

### Method 1: Install from Release (Recommended)

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/wuyifan-code/Claudian-plus/releases/latest).
2. Inside your Obsidian Vault, navigate to `.obsidian/plugins/` and create a `claudian-plus/` directory.
3. Copy the three files into that directory.
4. In Obsidian, go to **Settings → Community plugins**, refresh the list, and enable **Claudian Plus**.

> *Note: Claudian Plus is desktop-only because it connects directly to local agent CLIs and the desktop filesystem.*

### Method 2: Build from Source

Requirements: **Node.js 24+** and at least one local provider CLI ([Codex](https://github.com/openai/codex), [Claude Code](https://claude.ai/claude-code), [OpenCode](https://opencode.ai/), [Kimi](https://github.com/MoonshotAI/kimi-cli), or [Pi](https://github.com/badlogic/pi-mono)).

```bash
# 1. Clone repository
git clone https://github.com/wuyifan-code/Claudian-plus.git
cd Claudian-plus

# 2. Install dependencies and verify types
npm ci
npm run typecheck

# 3. Build production bundle
npm run build
```

*Tip: Set `OBSIDIAN_VAULT=D:\\Obsidian\\My Vault` in `.env.local` to have `npm run build` copy build artifacts directly into your Vault.*

---

## 08 / Commands Reference

| Command | Action |
| :--- | :--- |
| `Open chat view` | Launches the primary Claudian Plus sidebar workspace |
| `Quick agent input` | Sends a focused prompt using the active editor selection |
| `Search conversations` | Filters historical sessions by title, provider, model, or date |
| `Open memory file` | Inspects `.claudian-plus/memory.md` distilled by Dreaming V3 |
| `Scan vault knowledge` | Manually refreshes the local Vault knowledge index |
| `Undo last Canvas write` | Reverts the last approved Canvas modification in the current session |
| `Check provider CLI health` | Diagnoses missing, outdated, or misconfigured provider CLIs |

---

## 09 / Privacy, Security & Data Layout

- **Zero telemetry**: No telemetry pings, no cloud analytics. All prompts, session archives, and memory files reside strictly under `.claudian-plus/` inside your Vault.
- **Direct provider connection**: Network calls occur exclusively through the CLI or API endpoint you configure.
- **Migration compatibility**: Claudian Plus automatically detects and non-destructively migrates historical data from legacy `.claudian/`.

---

## 10 / Verification

```bash
npm run typecheck            # TypeScript boundary verification
npm run lint                 # ESLint static analysis
npm run test                 # Unit and integration test suites
npm run test:architecture    # Architecture dependency boundary enforcement
npm run check:performance    # Startup and memory hydration baseline checks
```

---

## 11 / Upstream Projects & Attribution

Claudian Plus is built upon the work of two upstream projects:

| Upstream Project | Original Author | License | Contribution to Claudian Plus |
| :--- | :--- | :--- | :--- |
| **[Claudian](https://github.com/YishenTu/claudian)** | [Yishen Tu](https://github.com/YishenTu) | MIT | Core Obsidian agent workspace, provider abstraction, chat session foundation |
| **[Codian](https://github.com/BCS1037/codian)** | [BCS1037 / BCS](https://github.com/BCS1037) | AGPL-3.0 | Live Composer, File Explorer actions, shared Skills manager, provider settings |

*Original and Claudian-derived code are licensed under **MIT**; Codian-derived code retains **AGPL-3.0** obligations. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for complete attribution details.*
