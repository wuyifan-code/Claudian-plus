import { createMockEl, type MockElement } from '@test/helpers/mockElement';

import { TurnErrorSlot } from '@/features/chat/ui/TurnErrorSlot';
import { FeedbackBus } from '@/shared/feedback/FeedbackBus';

interface Harness {
  bus: FeedbackBus;
  containerEl: MockElement;
  slot: TurnErrorSlot;
}

function mountSlot(): Harness {
  const bus = new FeedbackBus();
  bus.registerSink({ render: jest.fn(), openLog: jest.fn() });
  const containerEl = createMockEl();
  const slot = new TurnErrorSlot(containerEl as unknown as HTMLElement, bus);
  return { bus, containerEl, slot };
}

function rowsOf(containerEl: MockElement): MockElement[] {
  return containerEl.children as MockElement[];
}

describe('TurnErrorSlot', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = mountSlot();
  });

  afterEach(() => {
    harness.slot.dispose();
  });

  it('renders a durable row for a retryable failure', () => {
    harness.bus.retryable('stream.failed', 'Stream failed', jest.fn());

    const [row] = rowsOf(harness.containerEl);
    expect(row.getClasses()).toContain('claudian-plus-turn-error');
    expect(row.getAttribute('role')).toBe('status');
  });

  it('ignores informational entries', () => {
    harness.bus.info('a.one', 'Just so you know');

    expect(rowsOf(harness.containerEl)).toHaveLength(0);
  });

  it('ignores entries from other surfaces', () => {
    harness.bus.retryable('settings.save', 'Save failed', jest.fn(), { scope: 'settings' });

    expect(rowsOf(harness.containerEl)).toHaveLength(0);
  });

  it('replaces the previous row instead of stacking them', () => {
    harness.bus.retryable('a.one', 'First failure', jest.fn());
    harness.bus.retryable('b.two', 'Second failure', jest.fn());

    const rows = rowsOf(harness.containerEl);
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute('data-feedback-id')).toBe(harness.bus.getState().entries[0].id);
  });

  it('clears when the next turn starts', () => {
    harness.bus.retryable('a.one', 'First failure', jest.fn());

    harness.slot.clear();

    expect(rowsOf(harness.containerEl)).toHaveLength(0);
  });

  it('dismissing the row keeps the entry in the activity log', () => {
    harness.bus.retryable('a.one', 'First failure', jest.fn());
    const [row] = rowsOf(harness.containerEl);
    const dismiss = row.children[0].children.find(
      (child: MockElement) => child.getClasses().includes('claudian-plus-turn-error-dismiss'),
    );

    dismiss?.click();

    expect(rowsOf(harness.containerEl)).toHaveLength(0);
    expect(harness.bus.getState().entries).toHaveLength(1);
  });

  it('runs an action from the row', () => {
    const retry = jest.fn();
    harness.bus.retryable('stream.failed', 'Stream failed', retry);

    const [row] = rowsOf(harness.containerEl);
    const actions = row.children.find(
      (child: MockElement) => child.getClasses().includes('claudian-plus-turn-error-actions'),
    ) as MockElement;
    actions.children[0].click();

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('stops listening after dispose', () => {
    harness.slot.dispose();

    harness.bus.retryable('a.one', 'First failure', jest.fn());

    expect(rowsOf(harness.containerEl)).toHaveLength(0);
  });
});
