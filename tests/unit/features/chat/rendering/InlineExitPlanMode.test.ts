import { createMockEl } from '@test/helpers/mockElement';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { InlineExitPlanMode } from '@/features/chat/rendering/InlineExitPlanMode';

beforeAll(() => {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  };
  (globalThis as any).document = { activeElement: null };
});

function fireKeyDown(root: any, key: string, isComposing = false): void {
  root.dispatchEvent({
    type: 'keydown',
    key,
    isComposing,
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
  });
}

function findRoot(container: any): any {
  return container.querySelector('.claudian-plus-plan-approval-inline');
}

function findItems(root: any): any[] {
  return root.querySelectorAll('claudian-plus-ask-item');
}

describe('InlineExitPlanMode', () => {
  it('resolves with approve-new-session and includes plan content when readable', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudian-plus-'));
    const plansDir = path.join(tmpDir, '.claude', 'plans');
    fs.mkdirSync(plansDir, { recursive: true });
    const planFilePath = path.join(plansDir, 'plan.md');
    fs.writeFileSync(planFilePath, 'Step 1\nStep 2\n', 'utf8');

    const container = createMockEl();
    const resolve = jest.fn();
    const renderContent = jest.fn().mockResolvedValue(undefined);

    const widget = new InlineExitPlanMode(
      container,
      {
        planFilePath,
        allowedPrompts: [{ tool: 'Bash', prompt: 'Run bash commands' }],
      },
      resolve,
      undefined,
      renderContent,
      '/.claude/plans/',
    );

    widget.render();

    const root = findRoot(container);
    expect(root).toBeTruthy();
    expect(root.getEventListenerCount('keydown')).toBe(1);
    expect(container.querySelector('.claudian-plus-plan-permissions-list')).toBeTruthy();
    expect(renderContent).toHaveBeenCalled();

    fireKeyDown(root, 'Enter');

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith({
      type: 'approve-new-session',
      planContent: 'Implement this plan:\n\nStep 1\nStep 2',
    });
    expect(root.getEventListenerCount('keydown')).toBe(0);
  });

  it('shows a read error when plan file cannot be read', () => {
    const container = createMockEl();
    const resolve = jest.fn();

    const widget = new InlineExitPlanMode(
      container,
      { planFilePath: '/path/.claude/plans/does-not-exist.md' },
      resolve,
      undefined,
      undefined,
      '/.claude/plans/',
    );

    widget.render();

    const root = findRoot(container);
    expect(root).toBeTruthy();
    expect(container.querySelector('.claudian-plus-plan-read-error')).toBeTruthy();

    fireKeyDown(root, 'Enter');
    expect(resolve).toHaveBeenCalledWith({
      type: 'approve-new-session',
      planContent: 'Implement the approved plan.',
    });
  });

  it('rejects plan file paths outside .claude/plans/', () => {
    const container = createMockEl();
    const resolve = jest.fn();

    const widget = new InlineExitPlanMode(
      container,
      { planFilePath: '/etc/passwd' },
      resolve,
      undefined,
      undefined,
      '/.claude/plans/',
    );

    widget.render();

    const root = findRoot(container);
    expect(root).toBeTruthy();
    expect(container.querySelector('.claudian-plus-plan-read-error')).toBeTruthy();

    fireKeyDown(root, 'Enter');
    expect(resolve).toHaveBeenCalledWith({
      type: 'approve-new-session',
      planContent: 'Implement the approved plan.',
    });
  });

  it('supports keyboard navigation for approve/current-session', () => {
    const container = createMockEl();
    const resolve = jest.fn();

    const widget = new InlineExitPlanMode(container, {}, resolve);
    widget.render();

    const root = findRoot(container);
    expect(root).toBeTruthy();

    fireKeyDown(root, 'ArrowDown');
    fireKeyDown(root, 'Enter');

    expect(resolve).toHaveBeenCalledWith({ type: 'approve' });
  });

  it('supports feedback flow and Escape when input is focused', () => {
    const container = createMockEl();
    const resolve = jest.fn();

    const widget = new InlineExitPlanMode(container, {}, resolve);
    widget.render();

    const root = findRoot(container);
    expect(root).toBeTruthy();

    fireKeyDown(root, 'ArrowDown');
    fireKeyDown(root, 'ArrowDown');
    fireKeyDown(root, 'Enter');

    const items = findItems(root);
    const feedbackRow = items[2];
    const feedbackInput = feedbackRow.querySelector('claudian-plus-ask-custom-text');

    expect(resolve).not.toHaveBeenCalled();

    feedbackInput.dispatchEvent('focus');

    fireKeyDown(root, 'Escape');
    expect(resolve).not.toHaveBeenCalled();

    feedbackInput.value = 'Please revise the plan';
    feedbackInput.dispatchEvent('focus');

    fireKeyDown(root, 'Enter');
    expect(resolve).toHaveBeenCalledWith({ type: 'feedback', text: 'Please revise the plan' });
  });

  it('does not submit feedback on Enter during IME composition', () => {
    const container = createMockEl();
    const resolve = jest.fn();
    const widget = new InlineExitPlanMode(container, {}, resolve);
    widget.render();

    const root = findRoot(container);
    const feedbackInput = findItems(root)[2].querySelector('claudian-plus-ask-custom-text');
    feedbackInput.value = 'composing text';
    feedbackInput.dispatchEvent('focus');

    fireKeyDown(root, 'Enter', true);

    expect(resolve).not.toHaveBeenCalled();
    expect((widget as any).isInputFocused).toBe(true);
  });

  it('resolves null on abort and does not resolve twice', () => {
    const container = createMockEl();
    const resolve = jest.fn();
    const controller = new AbortController();

    const widget = new InlineExitPlanMode(container, {}, resolve, controller.signal);
    widget.render();

    controller.abort();

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(null);

    widget.destroy();
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('cancels the deferred focus frame and ignores it after destruction', () => {
    const container = createMockEl();
    let runFrame!: FrameRequestCallback;
    const ownerWindow = globalThis.window as any;
    const originalRequestAnimationFrame = ownerWindow.requestAnimationFrame;
    const originalCancelAnimationFrame = ownerWindow.cancelAnimationFrame;
    ownerWindow.requestAnimationFrame = jest.fn((callback: FrameRequestCallback) => {
      runFrame = callback;
      return 18;
    });
    ownerWindow.cancelAnimationFrame = jest.fn();
    try {
      const widget = new InlineExitPlanMode(container, {}, jest.fn());

      widget.render();
      const root = findRoot(container);
      root.focus = jest.fn();
      root.scrollIntoView = jest.fn();
      widget.destroy();
      runFrame(0);

      expect(ownerWindow.cancelAnimationFrame).toHaveBeenCalledWith(18);
      expect(root.focus).not.toHaveBeenCalled();
      expect(root.scrollIntoView).not.toHaveBeenCalled();
    } finally {
      ownerWindow.requestAnimationFrame = originalRequestAnimationFrame;
      ownerWindow.cancelAnimationFrame = originalCancelAnimationFrame;
    }
  });
});
