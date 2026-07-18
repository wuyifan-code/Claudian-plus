# Claudian Plus Roadmap

Claudian Plus is a Codex-first fork of Claudian for local-first knowledge work in Obsidian.
The fork keeps provider compatibility while making Codex the default agent runtime.

## Product principles

- Keep the agent runtime, model selection, retrieval, and UI context layers independent.
- Preserve existing Claudian conversations and provider-owned history files.
- Keep search indexes local by default and make every retrieved fact traceable to a source.
- Reuse the existing `@file` and `@folder/` context semantics instead of creating a second attachment model.
- Discover Codex models through `model/list`; a preferred model must remain a fallback, not a hard capability claim.

## Milestones

### M0: Codex-first foundation

- Enable Codex for new installations.
- Select Codex as the settings and blank-tab provider.
- Prefer `gpt-5.6-sol`, while retaining dynamic model discovery and custom model support.
- Keep stored settings and existing Claude conversations unchanged during upgrades.
- Give the enhanced build a separate plugin identity before live side-by-side testing.

### M0.5: Codex floating conversation outline

- Render user prompts and assistant Markdown H1-H3 headings as a compact outline rail.
- Preview each section on hover or keyboard focus and jump to it without losing chat state.
- Track the active reading section and follow the current provider's theme color.
- Collapse to the existing directory control in narrow or touch-oriented layouts.

### M1: Drag notes and folders into chat

- Accept Obsidian file-explorer drag payloads in the composer.
- Route notes through the current file attachment flow.
- Route folders through the current `@folder/` context flow.
- Show visible context chips and reject unsupported or oversized payloads explicitly.

### M2: Conversation search

- Add instant title filtering to the history panel.
- Add a provider-neutral local full-text index for user and assistant messages.
- Support date, provider, and model filters with direct navigation to a matched message.
- Delete index records when a conversation is removed.

### M3: Hybrid vault retrieval

- Incrementally index Markdown blocks by path, heading, modification time, and content hash.
- Combine lexical retrieval with embeddings and optional reranking.
- Give explicit context, the current note, and linked notes predictable priority.
- Return clickable block-level citations and expose index privacy controls.

### M4: Insight engine

- Surface related older notes, topic evolution, and useful follow-up questions.
- Require at least two traceable sources for generated insights.
- Start with user-triggered reviews before adding optional scheduled discovery.
- Learn from useful, not useful, and mute-topic feedback.

## Verification baseline

Before each milestone is merged:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

The upstream repository currently has Windows-specific baseline failures in path-mocking unit tests and the
architecture-boundary path matcher. New work must not increase that known failure set.
