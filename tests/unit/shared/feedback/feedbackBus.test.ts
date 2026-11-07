import { Notice } from 'obsidian';

import { FeedbackBus } from '@/shared/feedback/FeedbackBus';
import { FEEDBACK_BUFFER_LIMIT } from '@/shared/feedback/types';

const noticeMock = Notice as unknown as jest.Mock;

const NOW = Date.parse('2026-11-06T10:00:00Z');

interface Harness {
  bus: FeedbackBus;
  sink: { render: jest.Mock; openLog: jest.Mock };
}

function createHarness(): Harness {
  const bus = new FeedbackBus();
  const sink = { render: jest.fn(), openLog: jest.fn() };
  bus.registerSink(sink);
  return { bus, sink };
}

describe('FeedbackBus', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    noticeMock.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('collapses repeats of the same key inside the window into one counted entry', () => {
    const { bus } = createHarness();

    bus.info('tab.create.failed', 'Failed');
    jest.advanceTimersByTime(1_000);
    bus.info('tab.create.failed', 'Failed');
    jest.advanceTimersByTime(1_000);
    bus.info('tab.create.failed', 'Failed');

    const { entries } = bus.getState();
    expect(entries).toHaveLength(1);
    expect(entries[0].count).toBe(3);
  });

  it('treats the same key outside the window as a fresh occurrence', () => {
    const { bus } = createHarness();

    bus.info('tab.create.failed', 'Failed');
    jest.advanceTimersByTime(6_000);
    bus.info('tab.create.failed', 'Failed');

    expect(bus.getState().entries).toHaveLength(2);
  });

  it('honours a per-entry dedupe window', () => {
    const { bus } = createHarness();

    bus.info('stream.aborted', 'Aborted', { dedupeMs: 0 });
    bus.info('stream.aborted', 'Aborted', { dedupeMs: 0 });

    expect(bus.getState().entries).toHaveLength(2);
  });

  it('keeps newest first and moves a repeated key back to the front', () => {
    const { bus } = createHarness();

    bus.info('a.one', 'First');
    bus.info('b.two', 'Second');
    expect(bus.getState().entries.map(entry => entry.key)).toEqual(['b.two', 'a.one']);

    bus.info('a.one', 'First');
    expect(bus.getState().entries.map(entry => entry.key)).toEqual(['a.one', 'b.two']);
  });

  it('drops the oldest entry past the buffer limit', () => {
    const { bus } = createHarness();

    for (let index = 0; index < FEEDBACK_BUFFER_LIMIT + 5; index += 1) {
      bus.info(`key.${index}`, `Entry ${index}`);
    }

    const { entries } = bus.getState();
    expect(entries).toHaveLength(FEEDBACK_BUFFER_LIMIT);
    expect(entries[0].key).toBe(`key.${FEEDBACK_BUFFER_LIMIT + 4}`);
    expect(entries.some(entry => entry.key === 'key.0')).toBe(false);
  });

  it('notifies subscribers immediately and stops after unsubscribe', () => {
    const bus = new FeedbackBus();
    const listener = jest.fn();

    const unsubscribe = bus.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);

    bus.info('a.one', 'First');
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    bus.info('b.two', 'Second');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('counts unread entries and clears them when the log opens', () => {
    const { bus } = createHarness();

    bus.info('a.one', 'First');
    expect(bus.getState().unread).toBe(1);

    bus.info('b.two', 'Second');
    expect(bus.getState().unread).toBe(2);

    bus.openLog();
    expect(bus.getState().unread).toBe(0);
  });

  it('opens the log on the most recently mounted sink', () => {
    const bus = new FeedbackBus();
    const first = { render: jest.fn(), openLog: jest.fn() };
    const second = { render: jest.fn(), openLog: jest.fn() };
    bus.registerSink(first);
    bus.registerSink(second);

    bus.openLog();

    expect(second.openLog).toHaveBeenCalledTimes(1);
    expect(first.openLog).not.toHaveBeenCalled();
  });

  it('falls back to a Notice once per window when no host is mounted', () => {
    const bus = new FeedbackBus();

    bus.retryable('stream.failed', 'Stream failed', jest.fn());
    bus.retryable('stream.failed', 'Stream failed', jest.fn());

    expect(noticeMock).toHaveBeenCalledTimes(1);
    expect(noticeMock).toHaveBeenCalledWith('Stream failed');
  });

  it('does not fall back to a Notice while a host is mounted', () => {
    const { bus } = createHarness();

    bus.info('a.one', 'First');

    expect(noticeMock).not.toHaveBeenCalled();
  });

  it('attaches a retry action that runs the caller operation', async () => {
    const { bus } = createHarness();
    const retry = jest.fn().mockResolvedValue(undefined);

    bus.retryable('tab.close.failed', 'Close failed', retry);

    const [entry] = bus.getState().entries;
    expect(entry.kind).toBe('retryable');
    expect(entry.level).toBe('error');

    const action = entry.actions?.find(candidate => candidate.id === 'retry');
    expect(action).toBeDefined();
    await action?.run();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('attaches the settings action to blocked entries', () => {
    const bus = new FeedbackBus();
    const openSettings = jest.fn();
    bus.configure({ openSettings });
    bus.registerSink({ render: jest.fn(), openLog: jest.fn() });

    bus.blocked('provider.unsupported', 'Not supported here');

    const [entry] = bus.getState().entries;
    expect(entry.kind).toBe('blocked');
    const action = entry.actions?.find(candidate => candidate.id === 'open-settings');
    expect(action).toBeDefined();
    action?.run();
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('omits the settings action when no opener is configured', () => {
    const { bus } = createHarness();

    bus.blocked('provider.unsupported', 'Not supported here');

    expect(bus.getState().entries[0].actions).toEqual([]);
  });

  it('clears the buffer', () => {
    const { bus } = createHarness();
    bus.info('a.one', 'First');

    bus.clear();

    expect(bus.getState().entries).toEqual([]);
  });

  it('carries the detail through a repeat when the repeat omits it', () => {
    const { bus } = createHarness();

    bus.info('a.one', 'First', { detail: 'because' });
    jest.advanceTimersByTime(1_000);
    bus.info('a.one', 'First');

    expect(bus.getState().entries[0].detail).toBe('because');
  });
});
