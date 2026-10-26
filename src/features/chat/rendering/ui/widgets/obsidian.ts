import type { ResolvedElement } from '../evaluate';
import {
  type BuildContext,
  createBlock,
  createButton,
  readText,
  type WidgetBuilder,
} from './context';

/** Maximum note cards per rendered block; keeps a single answer from scanning the vault. */
const MAX_NOTE_CARDS = 3;

function buildNoteLink(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const linktext = readText(element, 0);
  const label = readText(element, 1) || linktext;
  const host = ctx.host;
  const hasOpenNote = host !== undefined && host.openNote !== undefined;
  const exists = host === undefined
    ? false
    : host.noteExists === undefined ? hasOpenNote : host.noteExists(linktext);

  const container = createBlock('claudian-plus-ui-note-link');
  const button = createButton('claudian-plus-ui-note-link-button', label);
  button.dataset.linktext = linktext;

  if (!exists || host === undefined || host.openNote === undefined) {
    container.classList.add('is-missing');
    button.setAttribute('disabled', 'disabled');
  } else {
    ctx.on(button, 'click', () => host.openNote?.(linktext));
  }

  container.appendChild(button);
  return container;
}

function readCounter(key: string | undefined): number {
  if (key === undefined) return 0;
  const parsed = Number(key.split('#')[1]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildNoteCard(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const linktext = readText(element, 0);
  const host = ctx.host;

  if (host === undefined || host.describeNote === undefined) return buildNoteLink(element, ctx);
  if (readCounter(ctx.autoKey?.('noteCard')) >= MAX_NOTE_CARDS) {
    return buildNoteLink(element, ctx);
  }

  const container = createBlock('claudian-plus-ui-note-card');
  const title = createEl('button', { cls: 'claudian-plus-ui-note-card-title', text: linktext });
  title.setAttribute('type', 'button');
  if (host.openNote === undefined) {
    title.setAttribute('disabled', 'disabled');
  } else {
    ctx.on(title, 'click', () => host.openNote?.(linktext));
  }
  container.appendChild(title);

  const body = createDiv({ cls: 'claudian-plus-ui-note-card-body' });
  container.appendChild(body);

  void host.describeNote(linktext)
    .then((summary) => {
      // The block may have been rebuilt while the note was read.
      if (summary === null || !container.isConnected) return;
      title.textContent = summary.title;
      body.replaceChildren();
      if (summary.excerpt.length > 0) {
        body.appendChild(createDiv({ cls: 'claudian-plus-ui-note-card-excerpt', text: summary.excerpt }));
      }
      if (summary.tags.length > 0) {
        const tags = createDiv({ cls: 'claudian-plus-ui-note-card-tags' });
        for (const tag of summary.tags) {
          tags.appendChild(createSpan({ cls: 'claudian-plus-ui-note-card-tag', text: tag }));
        }
        body.appendChild(tags);
      }
    })
    .catch(() => undefined);

  return container;
}

function buildMermaid(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const code = readText(element, 0);
  const container = createBlock('claudian-plus-ui-mermaid');
  const host = ctx.host;

  if (host === undefined || host.renderMarkdown === undefined) {
    const pre = createEl('pre');
    pre.appendChild(createEl('code', { text: code }));
    container.appendChild(pre);
    container.classList.add('is-plain');
    return container;
  }

  host.renderMarkdown(container, `\`\`\`mermaid\n${code}\n\`\`\``);
  return container;
}

/** Tag(name) — opens Obsidian search for the tag without touching the vault. */
function buildTag(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const name = readText(element, 0).trim().replace(/^#/, '');
  const container = createBlock('claudian-plus-ui-tag');
  const button = createButton('claudian-plus-ui-tag-button', `#${name}`);
  const host = ctx.host;

  if (name.length === 0 || host === undefined || host.openTag === undefined) {
    button.setAttribute('disabled', 'disabled');
  } else {
    ctx.on(button, 'click', () => host.openTag?.(name));
  }

  container.appendChild(button);
  return container;
}

function buildImage(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const path = readText(element, 0).trim();
  const alt = readText(element, 1);
  const container = createBlock('claudian-plus-ui-image');

  // Defence in depth: remote, absolute and traversal paths never reach the host.
  const unsafe = path.length === 0
    || path.includes('..')
    || path.startsWith('/')
    || path.startsWith('\\')
    || /^[a-z][a-z0-9+.-]*:/i.test(path);
  const host = ctx.host;
  const resource = unsafe || host === undefined || host.resolveResource === undefined
    ? null
    : host.resolveResource(path);

  if (resource === null) {
    container.classList.add('is-missing');
    container.appendChild(createSpan({
      cls: 'claudian-plus-ui-image-missing',
      text: alt.length > 0 ? alt : path,
    }));
    return container;
  }

  const image = createEl('img', { cls: 'claudian-plus-ui-image-el' });
  image.src = resource;
  image.alt = alt;
  image.setAttribute('loading', 'lazy');
  image.setAttribute('decoding', 'async');
  container.appendChild(image);
  return container;
}

export const OBSIDIAN_WIDGETS: Record<string, WidgetBuilder> = {
  NoteLink: buildNoteLink,
  NoteCard: buildNoteCard,
  Mermaid: buildMermaid,
  Image: buildImage,
  Tag: buildTag,
};
