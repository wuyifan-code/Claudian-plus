/** @jest-environment jsdom */

import { EditorView } from '@codemirror/view';

import { createAgentInlinePlugin } from '@/features/inline-edit/editorAgentInline';

describe('createAgentInlinePlugin', () => {
  let parent: HTMLDivElement;
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
    parent?.remove();
  });

  it('submits a line-scoped @agent instruction and removes the trigger line', () => {
    const onSubmit = jest.fn();
    parent = document.createElement('div');
    document.body.appendChild(parent);
    view = new EditorView({
      doc: 'Before\n@agent improve the argument\nAfter',
      extensions: [createAgentInlinePlugin({ onSubmit })],
      parent,
    });
    view.dispatch({ selection: { anchor: '@agent improve the argument'.length + 1 + 6 } });

    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
    });
    view.dom.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      instruction: 'improve the argument',
      view,
    }));
    expect(view.state.doc.toString()).toBe('Before\n\nAfter');
  });

  it('leaves ordinary prose and Shift+Enter untouched', () => {
    const onSubmit = jest.fn();
    parent = document.createElement('div');
    document.body.appendChild(parent);
    view = new EditorView({
      doc: 'email @agent hello',
      extensions: [createAgentInlinePlugin({ onSubmit })],
      parent,
    });
    view.dispatch({ selection: { anchor: view.state.doc.length } });

    view.dom.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      shiftKey: true,
    }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe('email @agent hello');
  });

  it('submits a multi-line @agent block when Enter is pressed on @end', () => {
    const onSubmit = jest.fn();
    parent = document.createElement('div');
    document.body.appendChild(parent);
    view = new EditorView({
      doc: 'Before\n@agent\nRewrite with clearer transitions\nand add an example.\n@end\nAfter',
      extensions: [createAgentInlinePlugin({ onSubmit })],
      parent,
    });
    // Place cursor on the @end line (line 5).
    const endLine = view.state.doc.line(5);
    view.dispatch({ selection: { anchor: endLine.from + 2 } });

    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
    });
    view.dom.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      instruction: 'Rewrite with clearer transitions\nand add an example.',
      view,
    }));
    expect(view.state.doc.toString()).toBe('Before\n\nAfter');
  });

  it('ignores @end without a matching @agent block', () => {
    const onSubmit = jest.fn();
    parent = document.createElement('div');
    document.body.appendChild(parent);
    view = new EditorView({
      doc: 'Some text\n@end',
      extensions: [createAgentInlinePlugin({ onSubmit })],
      parent,
    });
    const endLine = view.state.doc.line(2);
    view.dispatch({ selection: { anchor: endLine.from + 2 } });

    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
    });
    view.dom.dispatchEvent(event);

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
