/**
 * Vault-facing services for a rendered interface.
 *
 * Chat and note embeds need the same Obsidian capabilities (notes, tags,
 * images, markdown). Only the markdown renderer differs — chat keeps its own
 * sanitising pipeline — so the rest lives here once and both callers share it.
 */

import { type App, type Component, MarkdownRenderer } from 'obsidian';

import type { UiNoteSummary, UiRenderHost } from './widgets/context';

/** Obsidian's command registry is not part of the public `App` type. */
interface AppWithCommands {
  commands?: { executeCommandById(id: string): boolean };
}

export interface VaultUiRenderHostOptions {
  /** Path that link lookups and resource resolution are relative to ('' for chat). */
  sourcePath: string;
  /** Component that owns the markdown children a widget renders. */
  component: Component;
  /** Overrides markdown rendering; chat injects its sanitising pipeline. */
  renderMarkdown?: (el: HTMLElement, markdown: string) => void;
}

/** First meaningful line of a note, without frontmatter or headings. */
function summarizeNoteExcerpt(text: string): string {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    return line.length > 180 ? `${line.slice(0, 177)}...` : line;
  }
  return '';
}

/** Opens Obsidian's search view for a tag; degrades silently if the API moves. */
function openTagSearch(app: App, tag: string): void {
  const normalized = tag.trim().replace(/^#/, '');
  if (normalized.length === 0) return;
  const query = `tag:#${normalized}`;

  const existing = app.workspace.getLeavesOfType('search')[0];
  if (existing !== undefined) {
    const view = existing.view as { setQuery?: (value: string) => void };
    view.setQuery?.(query);
    void app.workspace.revealLeaf(existing);
    return;
  }

  const commands = (app as App & AppWithCommands).commands;
  void commands?.executeCommandById('global-search:open');
  const opened = app.workspace.getLeavesOfType('search')[0];
  const view = opened?.view as { setQuery?: (value: string) => void };
  view?.setQuery?.(query);
}

async function describeNote(
  app: App,
  linktext: string,
  sourcePath: string,
): Promise<UiNoteSummary | null> {
  const file = app.metadataCache.getFirstLinkpathDest(linktext, sourcePath);
  if (file === null) return null;
  const cache = app.metadataCache.getFileCache(file);
  const tags = (cache?.tags ?? [])
    .map((tag) => tag.tag)
    .filter((tag, index, all) => tag.length > 0 && all.indexOf(tag) === index)
    .slice(0, 8);
  let excerpt: string;
  try {
    excerpt = summarizeNoteExcerpt(await app.vault.cachedRead(file));
  } catch {
    excerpt = '';
  }
  return { title: file.basename, path: file.path, excerpt, tags };
}

function resolveResource(app: App, path: string, sourcePath: string): string | null {
  const trimmed = path.trim();
  if (trimmed.length === 0) return null;
  // Vault-relative paths only: no schemes, no absolute paths, no traversal.
  if (trimmed.includes('..')
    || trimmed.startsWith('/')
    || trimmed.startsWith('\\')
    || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return null;
  }
  const file = app.metadataCache.getFirstLinkpathDest(trimmed, sourcePath);
  if (file === null) return null;
  return app.vault.adapter.getResourcePath(file.path);
}

/** Host services a generated widget may call; every capability degrades when absent. */
export function createVaultUiRenderHost(
  app: App,
  options: VaultUiRenderHostOptions,
): UiRenderHost {
  return {
    renderMarkdown: options.renderMarkdown ?? ((el, markdown) => {
      void MarkdownRenderer.render(app, markdown, el, options.sourcePath, options.component);
    }),
    openNote: (linktext) => {
      void app.workspace.openLinkText(linktext, options.sourcePath, false);
    },
    noteExists: (linktext) => app.metadataCache.getFirstLinkpathDest(linktext, options.sourcePath) !== null,
    openTag: (tag) => openTagSearch(app, tag),
    describeNote: (linktext) => describeNote(app, linktext, options.sourcePath),
    resolveResource: (path) => resolveResource(app, path, options.sourcePath),
  };
}
