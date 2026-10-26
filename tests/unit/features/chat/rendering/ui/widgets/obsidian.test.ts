/**
 * @jest-environment jsdom
 */
import {
  pruneDetachedUiBlocks,
  renderUiBlock,
} from '@/features/chat/rendering/UiBlockRenderer';

import { flushFrame, installManualFrames } from './frame';

let blockCounter = 0;

let frames: ReturnType<typeof installManualFrames>;

function renderProgram(
  source: string,
  host?: Parameters<typeof renderUiBlock>[2]['host'],
): { container: HTMLElement; blockKey: string } {
  blockCounter += 1;
  const blockKey = `obsidian:${blockCounter}`;
  const container = document.createElement('div');
  document.body.appendChild(container);
  renderUiBlock(container, source, { blockKey, host });
  return { container, blockKey };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('Obsidian-native widgets', () => {
  beforeEach(() => {
    frames = installManualFrames();
  });

  afterEach(() => {
    frames.restore();
  });

  afterEach(() => {
    document.body.replaceChildren();
    pruneDetachedUiBlocks();
  });

  it('opens an existing note and disables a missing one', () => {
    const openNote = jest.fn();
    const existing = renderProgram('root = NoteLink("Reading Notes", "Notes")', {
      openNote,
      noteExists: () => true,
    });
    const existingButton = existing.container.querySelector<HTMLButtonElement>(
      '.claudian-plus-ui-note-link-button',
    );
    expect(existingButton?.hasAttribute('disabled')).toBe(false);
    existingButton!.click();
    flushFrame();
    expect(openNote).toHaveBeenCalledWith('Reading Notes');

    const missing = renderProgram('root = NoteLink("Missing Note")', {
      openNote,
      noteExists: () => false,
    });
    const missingButton = missing.container.querySelector<HTMLButtonElement>(
      '.claudian-plus-ui-note-link-button',
    );
    expect(missing.container.querySelector('.claudian-plus-ui-note-link.is-missing')).not.toBeNull();
    expect(missingButton?.hasAttribute('disabled')).toBe(true);
    missingButton!.click();
    flushFrame();
    expect(openNote).toHaveBeenCalledTimes(1);
  });

  it('fills a note card asynchronously', async () => {
    const { container } = renderProgram('root = NoteCard("Reading Notes")', {
      describeNote: async () => ({
        title: 'Reading Notes',
        path: 'Notes/Reading.md',
        excerpt: 'Habit formation.',
        tags: ['#habits'],
      }),
      openNote: jest.fn(),
    });

    await flush();

    expect(container.querySelector('.claudian-plus-ui-note-card-title')?.textContent)
      .toBe('Reading Notes');
    expect(container.textContent).toContain('Habit formation.');
    expect(container.querySelector('.claudian-plus-ui-note-card-tag')?.textContent).toBe('#habits');
  });

  it('caps note cards per block and degrades to links', () => {
    const { container } = renderProgram([
      'root = Col([a, b, c, d])',
      'a = NoteCard("A")',
      'b = NoteCard("B")',
      'c = NoteCard("C")',
      'd = NoteCard("D")',
    ].join('\n'), {
      describeNote: async () => null,
      openNote: jest.fn(),
      noteExists: () => true,
    });

    expect(container.querySelectorAll('.claudian-plus-ui-note-card')).toHaveLength(3);
    expect(container.querySelectorAll('.claudian-plus-ui-note-link')).toHaveLength(1);
  });

  it('renders mermaid through the host markdown pipeline', () => {
    const renderMarkdown = jest.fn();
    const { container } = renderProgram('root = Mermaid("graph TD; A-->B")', { renderMarkdown });

    expect(renderMarkdown).toHaveBeenCalledTimes(1);
    expect(renderMarkdown.mock.calls[0][1]).toBe('```mermaid\ngraph TD; A-->B\n```');
    expect(container.querySelector('.claudian-plus-ui-mermaid')).not.toBeNull();
  });

  it('falls back to plain text when the markdown host is missing', () => {
    const { container } = renderProgram('root = Mermaid("graph TD; A-->B")');

    expect(container.querySelector('.claudian-plus-ui-mermaid pre code')?.textContent)
      .toBe('graph TD; A-->B');
  });

  it('opens a tag in search only when the host supports it', () => {
    const openTag = jest.fn();
    const { container } = renderProgram('root = Tag("#habits")', { openTag });
    const button = container.querySelector<HTMLButtonElement>('.claudian-plus-ui-tag-button');

    expect(button?.textContent).toBe('#habits');
    button!.click();
    flushFrame();
    expect(openTag).toHaveBeenCalledWith('habits');

    const noHost = renderProgram('root = Tag("habits")');
    expect(noHost.container.querySelector('.claudian-plus-ui-tag-button')?.hasAttribute('disabled'))
      .toBe(true);
  });

  it('loads vault images through the host and rejects remote paths', () => {
    const resolveResource = jest.fn((path: string) => `app://local/${path}`);
    const allowed = renderProgram('root = Image("assets/diagram.png", "Diagram")', {
      resolveResource,
    });
    const image = allowed.container.querySelector<HTMLImageElement>('.claudian-plus-ui-image-el');
    expect(image?.getAttribute('src')).toBe('app://local/assets/diagram.png');
    expect(image?.getAttribute('alt')).toBe('Diagram');
    expect(image?.getAttribute('loading')).toBe('lazy');

    const remote = renderProgram('root = Image("https://evil.example/x.png")', { resolveResource });
    expect(remote.container.querySelector('.claudian-plus-ui-image-el')).toBeNull();
    expect(remote.container.querySelector('.claudian-plus-ui-image.is-missing')).not.toBeNull();
    expect(resolveResource).toHaveBeenCalledTimes(1);

    const traversal = renderProgram('root = Image("../secrets.png")', { resolveResource });
    expect(traversal.container.querySelector('.claudian-plus-ui-image-el')).toBeNull();
    expect(resolveResource).toHaveBeenCalledTimes(1);
  });
});
