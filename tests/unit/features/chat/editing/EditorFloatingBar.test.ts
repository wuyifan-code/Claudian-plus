/** @jest-environment jsdom */

import {
  buildFloatingBarPrompt,
  DEFAULT_ACTIONS,
  type EditorFloatingBarOptions,
  FloatingToolbarWidget,
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

describe('floating toolbar rAF coalescing', () => {
  interface PendingFrame {
    id: number;
    callback: FrameRequestCallback;
  }

  let pendingFrames: PendingFrame[];
  let nextFrameId: number;

  const makeWidget = (): FloatingToolbarWidget => {
    const options: EditorFloatingBarOptions = { onAction: jest.fn() };
    return new FloatingToolbarWidget(null, options);
  };

  const flushFrames = (): void => {
    const frames = pendingFrames.splice(0, pendingFrames.length);
    for (const frame of frames) frame.callback(Date.now());
  };

  beforeEach(() => {
    pendingFrames = [];
    nextFrameId = 1;
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      pendingFrames.push({ id, callback });
      return id;
    });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) => {
      const index = pendingFrames.findIndex(frame => frame.id === id);
      if (index !== -1) pendingFrames.splice(index, 1);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('coalesces multiple selection triggers in the same frame into one position update', () => {
    const widget = makeWidget();
    const updateSpy = jest.spyOn(widget, 'updatePositionFromSelection').mockReturnValue(true);

    widget.schedulePositionUpdate();
    widget.schedulePositionUpdate();
    widget.schedulePositionUpdate();

    // Three triggers (e.g. selectionchange + mouseup + keyup) must schedule a
    // single frame callback instead of three synchronous layout passes.
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    flushFrames();
    expect(updateSpy).toHaveBeenCalledTimes(1);

    // Once the pending frame has run, the next trigger schedules a new one.
    widget.schedulePositionUpdate();
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(2);
    flushFrames();
    expect(updateSpy).toHaveBeenCalledTimes(2);
  });

  it('cancels a pending frame update when the widget is destroyed', () => {
    const widget = makeWidget();
    const updateSpy = jest.spyOn(widget, 'updatePositionFromSelection').mockReturnValue(true);

    widget.schedulePositionUpdate();
    const scheduledId = pendingFrames[0].id;

    widget.destroy();

    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(scheduledId);
    expect(pendingFrames).toHaveLength(0);

    // A destroyed widget must neither schedule nor run further updates.
    widget.schedulePositionUpdate();
    flushFrames();
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('hides immediately and cancels the pending frame update', () => {
    const widget = makeWidget();
    const dom = widget.toDOM();
    const updateSpy = jest.spyOn(widget, 'updatePositionFromSelection').mockReturnValue(true);

    widget.show();
    expect(dom.classList.contains('claudian-plus-floating-bar-hidden')).toBe(false);

    widget.schedulePositionUpdate();
    const scheduledId = pendingFrames[0].id;

    widget.hide();

    // hide() stays synchronous: the bar is hidden right away…
    expect(dom.classList.contains('claudian-plus-floating-bar-hidden')).toBe(true);
    // …and the deferred position update is cancelled instead of re-showing it.
    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(scheduledId);
    expect(pendingFrames).toHaveLength(0);
    flushFrames();
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
