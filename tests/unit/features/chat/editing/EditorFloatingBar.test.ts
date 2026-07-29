/** @jest-environment jsdom */

import {
  buildFloatingBarPrompt,
  DEFAULT_ACTIONS,
  isFloatingBarEligibleEditorView,
} from '@/features/chat/editing/EditorFloatingBar';

describe('editor floating bar actions', () => {
  it('keeps the compact row focused on three high-frequency actions', () => {
    expect(DEFAULT_ACTIONS.filter(action => action.primary).map(action => action.id)).toEqual([
      'rewrite',
      'explain',
      'translate',
    ]);
  });

  it('routes edit actions to inline preview and secondary actions to the menu', () => {
    expect(DEFAULT_ACTIONS.filter(action => action.mode === 'inline').map(action => action.id))
      .toEqual(['rewrite', 'translate', 'fix-grammar']);
    expect(DEFAULT_ACTIONS.filter(action => !action.primary).map(action => action.id))
      .toEqual(['summarize', 'fix-grammar', 'custom']);
  });

  it('builds a prompt with the selected text intact', () => {
    const action = DEFAULT_ACTIONS.find(candidate => candidate.id === 'explain')!;
    expect(buildFloatingBarPrompt(action, 'A selected paragraph')).toContain('A selected paragraph');
  });

  it('does not attach to ClaudianPlus chat composer editors', () => {
    document.body.innerHTML = `
      <div class="claudian-plus-input-wrapper">
        <div class="claudian-plus-live-preview-composer cm-editor"></div>
      </div>
    `;
    const view = { dom: document.querySelector('.claudian-plus-live-preview-composer') } as any;
    expect(isFloatingBarEligibleEditorView(view)).toBe(false);
  });

  it('attaches to Markdown source editors', () => {
    document.body.innerHTML = `
      <div class="markdown-source-view mod-cm6">
        <div class="cm-editor"></div>
      </div>
    `;
    const view = { dom: document.querySelector('.cm-editor') } as any;
    expect(isFloatingBarEligibleEditorView(view)).toBe(true);
  });
});
