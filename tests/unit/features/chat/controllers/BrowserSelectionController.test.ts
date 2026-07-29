/** @jest-environment jsdom */

import { BrowserSelectionController } from '@/features/chat/controllers/BrowserSelectionController';

function createMockContextTray() {
  return {
    setItems: jest.fn(),
    clearItems: jest.fn(),
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

describe('BrowserSelectionController', () => {
  let controller: BrowserSelectionController;
  let app: any;
  let contextTray: ReturnType<typeof createMockContextTray>;
  let inputEl: HTMLTextAreaElement;
  let containerEl: HTMLElement;
  let selectionText = 'selected web snippet';
  let getSelectionSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    selectionText = 'selected web snippet';

    contextTray = createMockContextTray();
    inputEl = document.createElement('textarea');
    document.body.appendChild(inputEl);
    containerEl = document.createElement('div');
    const selectionAnchor = document.createElement('span');
    containerEl.appendChild(selectionAnchor);

    getSelectionSpy = jest.spyOn(document, 'getSelection').mockImplementation(() => ({
      toString: () => selectionText,
      anchorNode: selectionAnchor,
      focusNode: selectionAnchor,
    } as unknown as Selection));

    const view = {
      getViewType: () => 'surfing-view',
      getDisplayText: () => 'Surfing',
      containerEl,
      currentUrl: 'https://example.com',
    };

    app = {
      workspace: {
        activeLeaf: { view },
        getMostRecentLeaf: jest.fn(() => ({ view })),
      },
    };

    controller = new BrowserSelectionController(app, contextTray as any, inputEl);
  });

  afterEach(() => {
    controller.stop();
    inputEl.remove();
    getSelectionSpy.mockRestore();
    jest.useRealTimers();
  });

  it('captures browser selection and updates indicator', async () => {
    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    expect(controller.getContext()).toEqual({
      source: 'browser:https://example.com',
      selectedText: 'selected web snippet',
      title: 'Surfing',
      url: 'https://example.com',
    });
    expect(contextTray.setItems).toHaveBeenLastCalledWith('browser-selection', [
      expect.objectContaining({
        label: '1 line selected',
      }),
    ]);
    expect(contextTray.setItems.mock.calls[0][1][0]).not.toHaveProperty('title');
  });

  it('shows line-based indicator text for multi-line browser selection', async () => {
    selectionText = 'line 1\nline 2';
    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    expect(contextTray.setItems).toHaveBeenLastCalledWith('browser-selection', [
      expect.objectContaining({ label: '2 lines selected' }),
    ]);
  });

  it('clears selection when text is deselected and input is not focused', async () => {
    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();
    expect(controller.hasSelection()).toBe(true);

    selectionText = '';
    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    expect(controller.hasSelection()).toBe(false);
    expect(contextTray.clearItems).toHaveBeenCalledWith('browser-selection');
  });

  it('keeps selection while input is focused', async () => {
    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();
    expect(controller.hasSelection()).toBe(true);

    selectionText = '';
    inputEl.focus();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    expect(controller.hasSelection()).toBe(true);
  });

  it('clears selection when clear is called', async () => {
    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();
    expect(controller.hasSelection()).toBe(true);

    controller.clear();

    expect(controller.hasSelection()).toBe(false);
    expect(contextTray.clearItems).toHaveBeenCalledWith('browser-selection');
  });

  it('clears selection from the tray remove action', async () => {
    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    const items = contextTray.setItems.mock.calls[0][1];
    items[0].onRemove();

    expect(controller.hasSelection()).toBe(false);
    expect(contextTray.clearItems).toHaveBeenCalledWith('browser-selection');
  });

  it('handles polling errors without unhandled rejection', async () => {
    const extractSpy = jest.spyOn(controller as any, 'extractSelectedText')
      .mockRejectedValueOnce(new Error('poll failed'));

    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    expect(extractSpy).toHaveBeenCalled();
    expect(controller.hasSelection()).toBe(false);
  });

  it('ignores a late async selection result after tracking stops', async () => {
    const deferred = createDeferred<string | null>();
    jest.spyOn(controller as any, 'extractSelectedText').mockReturnValue(deferred.promise);

    controller.start();
    jest.advanceTimersByTime(250);
    controller.stop();
    deferred.resolve('late web selection');
    await flushMicrotasks();

    expect(controller.getContext()).toBeNull();
    expect(contextTray.setItems).not.toHaveBeenCalled();
  });

  it('resumes polling after a tab is reactivated while an old webview read is pending', async () => {
    const deferred = createDeferred<string | null>();
    const extractSpy = jest.spyOn(controller as any, 'extractSelectedText')
      .mockReturnValueOnce(deferred.promise)
      .mockResolvedValueOnce('new tab selection');

    controller.start();
    jest.advanceTimersByTime(250);
    controller.stop();
    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    expect(extractSpy).toHaveBeenCalledTimes(2);
    expect(controller.getContext()?.selectedText).toBe('new tab selection');

    deferred.resolve('stale tab selection');
    await flushMicrotasks();
    expect(controller.getContext()?.selectedText).toBe('new tab selection');
  });

  it('uses the composer window to own its polling interval', () => {
    const popupWindow = {
      setInterval: jest.fn().mockReturnValue(42),
      clearInterval: jest.fn(),
    } as unknown as Window;
    Object.defineProperty(inputEl, 'ownerDocument', {
      value: { defaultView: popupWindow },
      configurable: true,
    });
    controller = new BrowserSelectionController(app, contextTray as any, inputEl);

    controller.start();
    controller.stop();

    expect(popupWindow.setInterval).toHaveBeenCalledWith(expect.any(Function), 250);
    expect(popupWindow.clearInterval).toHaveBeenCalledWith(42);
  });

  it('reads a browser input selection without relying on the main-window constructor', () => {
    const popupInput = {
      tagName: 'TEXTAREA',
      value: 'popup selection',
      selectionStart: 0,
      selectionEnd: 5,
    };
    const popupDocument = { activeElement: popupInput } as unknown as Document;
    const scope = { contains: jest.fn().mockReturnValue(true) } as unknown as HTMLElement;

    expect((controller as any).extractSelectionFromActiveInput(popupDocument, scope)).toBe('popup');
  });
});
