import { createMockEl, type MockElement } from '@test/helpers/mockElement';

import { FeedbackBus } from '@/shared/feedback/FeedbackBus';
import { FeedbackHost } from '@/shared/feedback/FeedbackHost';
import { FEEDBACK_TOAST_LIMIT } from '@/shared/feedback/types';

const NOW = Date.parse('2026-11-06T10:00:00Z');

interface Harness {
  bus: FeedbackBus;
  host: FeedbackHost;
  toastAnchor: MockElement;
  drawerAnchor: MockElement;
  copyDiagnostics: jest.Mock;
}

function mountHost(): Harness {
  const bus = new FeedbackBus();
  const toastAnchor = createMockEl();
  const drawerAnchor = createMockEl();
  const copyDiagnostics = jest.fn();
  const host = new FeedbackHost({
    bus,
    toastAnchor: toastAnchor as unknown as HTMLElement,
    drawerAnchor: drawerAnchor as unknown as HTMLElement,
    onCopyDiagnostics: copyDiagnostics,
  });
  host.mount();
  return { bus, host, toastAnchor, drawerAnchor, copyDiagnostics };
}

function layerOf(toastAnchor: MockElement): MockElement {
  return toastAnchor.children[0] as MockElement;
}

function stackOf(toastAnchor: MockElement): MockElement {
  return layerOf(toastAnchor).children[2] as MockElement;
}

function toastsOf(toastAnchor: MockElement): MockElement[] {
  return stackOf(toastAnchor).children as MockElement[];
}

describe('FeedbackHost', () => {
  let harness: Harness;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    harness = mountHost();
  });

  afterEach(() => {
    harness?.host.unmount();
    jest.useRealTimers();
  });

  it('mounts the toast layer with both live regions', () => {
    const layer = layerOf(harness.toastAnchor);

    expect(layer.getClasses()).toContain('claudian-plus-feedback-layer');
    const [polite, assertive] = layer.children as MockElement[];
    expect(polite.getAttribute('aria-live')).toBe('polite');
    expect(polite.getAttribute('role')).toBe('status');
    expect(assertive.getAttribute('aria-live')).toBe('assertive');
    expect(assertive.getAttribute('role')).toBe('alert');
  });

  it('renders a toast for a new entry', () => {
    harness.bus.info('a.one', 'First');

    const toasts = toastsOf(harness.toastAnchor);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].getClasses()).toContain('claudian-plus-feedback-toast--info');
    expect(toasts[0].textContent ?? '').toBeDefined();
  });

  it('keeps at most three toasts, newest last', () => {
    for (let index = 0; index < FEEDBACK_TOAST_LIMIT + 2; index += 1) {
      harness.bus.info(`key.${index}`, `Entry ${index}`);
    }

    const toasts = toastsOf(harness.toastAnchor);
    expect(toasts).toHaveLength(FEEDBACK_TOAST_LIMIT);
    expect(toasts[toasts.length - 1].getAttribute('data-feedback-id')).toBe(
      harness.bus.getState().entries[0].id,
    );
  });

  it('dismisses an info toast after three seconds but keeps the entry', () => {
    harness.bus.info('a.one', 'First');

    jest.advanceTimersByTime(2_999);
    expect(toastsOf(harness.toastAnchor)).toHaveLength(1);

    jest.advanceTimersByTime(1);
    expect(toastsOf(harness.toastAnchor)).toHaveLength(0);
    expect(harness.bus.getState().entries).toHaveLength(1);
  });

  it('does not auto-dismiss an error toast', () => {
    harness.bus.blocked('a.one', 'Broken');

    jest.advanceTimersByTime(30_000);

    expect(toastsOf(harness.toastAnchor)).toHaveLength(1);
  });

  it('does not auto-dismiss an entry that carries an action', () => {
    harness.bus.retryable('a.one', 'Broken', jest.fn());

    jest.advanceTimersByTime(30_000);

    expect(toastsOf(harness.toastAnchor)).toHaveLength(1);
  });

  it('pauses the timer while the pointer is over the layer', () => {
    harness.bus.info('a.one', 'First');
    layerOf(harness.toastAnchor).dispatchEvent('mouseenter');

    jest.advanceTimersByTime(10_000);
    expect(toastsOf(harness.toastAnchor)).toHaveLength(1);

    layerOf(harness.toastAnchor).dispatchEvent('mouseleave');
    jest.advanceTimersByTime(3_000);
    expect(toastsOf(harness.toastAnchor)).toHaveLength(0);
  });

  it('shows the repeat count', () => {
    harness.bus.info('a.one', 'First');
    jest.advanceTimersByTime(1_000);
    harness.bus.info('a.one', 'First');

    const [toast] = toastsOf(harness.toastAnchor);
    const countEl = (toast.children[0] as MockElement).children
      .find((child: MockElement) => child.getClasses().includes('claudian-plus-feedback-toast-count'));

    expect(countEl).toBeDefined();
    expect(countEl?.textContent).toContain('2');
  });

  it('closing a toast hides it without dropping the entry from the log', () => {
    harness.bus.info('a.one', 'First');

    const [toast] = toastsOf(harness.toastAnchor);
    const close = (toast.children[0] as MockElement).children
      .find((child: MockElement) => child.getClasses().includes('claudian-plus-feedback-toast-close'));

    close?.click();

    expect(toastsOf(harness.toastAnchor)).toHaveLength(0);
    expect(harness.bus.getState().entries).toHaveLength(1);
  });

  it('runs an action button', () => {
    const run = jest.fn();
    harness.bus.emit({ level: 'error', kind: 'retryable', key: 'a.one', title: 'Broken', scope: 'chat', actions: [{ id: 'retry', label: 'Retry', run }] });

    const [toast] = toastsOf(harness.toastAnchor);
    const actionsRow = toast.children
      .find((child: MockElement) => child.getClasses().includes('claudian-plus-feedback-toast-actions'));
    (actionsRow?.children[0] as MockElement).click();

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('survives an action that throws', async () => {
    harness.bus.emit({
      level: 'error',
      kind: 'retryable',
      key: 'a.one',
      title: 'Broken',
      scope: 'chat',
      actions: [{ id: 'retry', label: 'Retry', run: () => { throw new Error('boom'); } }],
    });

    const [toast] = toastsOf(harness.toastAnchor);
    const actionsRow = toast.children
      .find((child: MockElement) => child.getClasses().includes('claudian-plus-feedback-toast-actions'));
    expect(() => (actionsRow?.children[0] as MockElement).click()).not.toThrow();
  });

  describe('activity drawer', () => {
    it('opens on request and lists entries newest first', () => {
      harness.bus.info('a.one', 'First');
      harness.bus.info('b.two', 'Second');

      harness.bus.openLog();

      const [drawer] = harness.drawerAnchor.children as MockElement[];
      expect(drawer.getClasses()).toContain('claudian-plus-feedback-drawer');
      const body = drawer.children[1] as MockElement;
      const entries = body.children as MockElement[];
      expect(entries).toHaveLength(2);
      expect(entries[0].getAttribute('data-feedback-id')).toBe(harness.bus.getState().entries[0].id);
    });

    it('shows an empty state', () => {
      harness.bus.openLog();

      const [drawer] = harness.drawerAnchor.children as MockElement[];
      const body = drawer.children[1] as MockElement;
      expect(body.children[0].getClasses()).toContain('claudian-plus-feedback-empty');
    });

    it('filters by level', () => {
      harness.bus.info('a.one', 'Info entry');
      harness.bus.blocked('b.two', 'Error entry');

      harness.bus.openLog();
      const [drawer] = harness.drawerAnchor.children as MockElement[];
      const header = drawer.children[0] as MockElement;
      const filters = header.children
        .find((child: MockElement) => child.getClasses().includes('claudian-plus-feedback-drawer-filters')) as MockElement;
      const errorFilter = filters.children.find(
        (child: MockElement) => child.getAttribute('data-feedback-filter') === 'error',
      ) as MockElement;

      errorFilter.click();

      const body = drawer.children[1] as MockElement;
      expect(body.children).toHaveLength(1);
      expect(body.children[0].getAttribute('data-feedback-id')).toBe(harness.bus.getState().entries[0].id);
    });

    it('closes on Escape', () => {
      harness.bus.openLog();
      const [drawer] = harness.drawerAnchor.children as MockElement[];

      drawer.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault: jest.fn() });

      expect(harness.drawerAnchor.children).toHaveLength(0);
    });

    it('copies diagnostics from the drawer', () => {
      harness.bus.info('a.one', 'First');
      harness.bus.openLog();

      const [drawer] = harness.drawerAnchor.children as MockElement[];
      const header = drawer.children[0] as MockElement;
      const copy = header.children.find(
        (child: MockElement) => child.getClasses().includes('claudian-plus-feedback-drawer-copy'),
      ) as MockElement;

      copy.click();

      expect(harness.copyDiagnostics).toHaveBeenCalledTimes(1);
    });

    it('clears the log from the drawer', () => {      harness.bus.info('a.one', 'First');
      harness.bus.openLog();

      const [drawer] = harness.drawerAnchor.children as MockElement[];
      const header = drawer.children[0] as MockElement;
      const clear = header.children.find(
        (child: MockElement) => child.getClasses().includes('claudian-plus-feedback-drawer-clear'),
      ) as MockElement;

      clear.click();

      expect(harness.bus.getState().entries).toEqual([]);
    });
  });

  it('removes its DOM and stops rendering after unmount', () => {
    harness.bus.info('a.one', 'First');
    harness.host.unmount();

    expect(harness.toastAnchor.children).toHaveLength(0);
    expect(() => harness.bus.info('b.two', 'Second')).not.toThrow();
    // Re-registering the host would be the only way to see it again.
    expect(harness.toastAnchor.children).toHaveLength(0);
  });
});
