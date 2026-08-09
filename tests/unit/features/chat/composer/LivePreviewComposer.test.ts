/**
 * @jest-environment jsdom
 */
import { LivePreviewComposer } from '../../../../../src/features/chat/composer/LivePreviewComposer';

describe('LivePreviewComposer', () => {
  it('wraps long lines to the editor width instead of scrolling horizontally', () => {
    const host = document.createElement('div');
    const composer = new LivePreviewComposer(host, {});

    expect(composer.editorView.contentDOM.classList.contains('cm-lineWrapping')).toBe(true);

    composer.destroy();
  });
});
