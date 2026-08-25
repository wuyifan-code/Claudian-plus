/** @jest-environment jsdom */
import * as ActionableOutputController from '../../../../../src/features/chat/actions/ActionableOutputController';
import { FloatingSelectionToolbar } from '../../../../../src/features/chat/actions/FloatingSelectionToolbar';

describe('FloatingSelectionToolbar', () => {
  let mockApp: any;
  let containerEl: HTMLElement;

  beforeEach(() => {
    mockApp = {
      workspace: {
        getActiveViewOfType: jest.fn(),
      },
    };
    containerEl = document.createElement('div');
    document.body.appendChild(containerEl);
  });

  afterEach(() => {
    containerEl.remove();
    jest.restoreAllMocks();
  });

  it('initializes and cleans up on destroy', () => {
    const toolbar = new FloatingSelectionToolbar({
      app: mockApp,
      containerEl,
    });

    toolbar.show({
      getBoundingClientRect: () => ({ top: 100, left: 100, width: 50, height: 20 }),
    } as any);

    const toolbarEl = containerEl.querySelector('.claudian-plus-floating-selection-toolbar');
    expect(toolbarEl).toBeTruthy();
    expect(toolbarEl?.classList.contains('is-visible')).toBe(true);

    toolbar.hide();
    expect(toolbarEl?.classList.contains('is-visible')).toBe(false);

    toolbar.destroy();
    expect(containerEl.querySelector('.claudian-plus-floating-selection-toolbar')).toBeNull();
  });

  it('executes insertAtCursor when insert button is clicked', () => {
    const insertSpy = jest.spyOn(ActionableOutputController, 'insertAtCursor').mockReturnValue(true);

    const toolbar = new FloatingSelectionToolbar({
      app: mockApp,
      containerEl,
    });

    // Create assistant message with text
    const msgEl = containerEl.createDiv({ cls: 'claudian-plus-message claudian-plus-message-assistant' });
    const textBlock = msgEl.createDiv({ cls: 'claudian-plus-text-block' });
    textBlock.textContent = 'Useful AI text to insert';

    // Mock window selection
    window.getSelection = jest.fn().mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => ({
        commonAncestorContainer: textBlock,
        getBoundingClientRect: () => ({ top: 100, left: 100, width: 50, height: 20 }),
      }),
      toString: () => 'Useful AI text',
    });

    containerEl.dispatchEvent(new MouseEvent('mouseup'));

    const insertBtn = containerEl.querySelector<HTMLButtonElement>('.claudian-plus-floating-insert-btn');
    expect(insertBtn).toBeTruthy();

    insertBtn?.click();
    expect(insertSpy).toHaveBeenCalledWith(mockApp, 'Useful AI text', { isSelection: true });

    toolbar.destroy();
  });

  it('executes replaceSelection when replace button is clicked', () => {
    const replaceSpy = jest.spyOn(ActionableOutputController, 'replaceSelection').mockReturnValue(true);

    const toolbar = new FloatingSelectionToolbar({
      app: mockApp,
      containerEl,
    });

    const msgEl = containerEl.createDiv({ cls: 'claudian-plus-message claudian-plus-message-assistant' });
    const textBlock = msgEl.createDiv({ cls: 'claudian-plus-text-block' });
    textBlock.textContent = 'Selected text for replace';

    window.getSelection = jest.fn().mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => ({
        commonAncestorContainer: textBlock,
        getBoundingClientRect: () => ({ top: 100, left: 100, width: 50, height: 20 }),
      }),
      toString: () => 'Selected text',
    });

    containerEl.dispatchEvent(new MouseEvent('mouseup'));

    const replaceBtn = containerEl.querySelector<HTMLButtonElement>('.claudian-plus-floating-replace-btn');
    expect(replaceBtn).toBeTruthy();

    replaceBtn?.click();
    expect(replaceSpy).toHaveBeenCalledWith(mockApp, 'Selected text', null, { isSelection: true });

    toolbar.destroy();
  });
});

