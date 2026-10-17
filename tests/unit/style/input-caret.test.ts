/** @jest-environment jsdom */

import { readFileSync } from 'fs';
import { join } from 'path';

describe('composer caret theme contract', () => {
  it('overrides the CodeMirror light caret for both editor and textarea inputs', () => {
    const style = document.createElement('style');
    style.textContent = '.cm-editor.cm-light .cm-content { caret-color: black; }\n'
      + readFileSync(join(__dirname, '../../../src/style/components/input.css'), 'utf-8');
    document.head.appendChild(style);
    const wrapper = document.createElement('div');
    wrapper.className = 'claudian-plus-input-wrapper';
    wrapper.innerHTML = '<textarea class="claudian-plus-input"></textarea>'
      + '<div class="cm-editor cm-light claudian-plus-live-preview-composer">'
      + '<div class="cm-content" contenteditable="true"></div></div>';
    document.body.appendChild(wrapper);

    try {
      for (const input of wrapper.querySelectorAll('textarea, .cm-content')) {
        expect(getComputedStyle(input).caretColor).toBe('var(--text-normal)');
      }
    } finally {
      wrapper.remove();
      style.remove();
    }
  });
});
