import { createMockEl } from '@test/helpers/mockElement';

import type { ProviderReasoningOption } from '@/core/providers/types';
import {
  applyDetent,
  createEffortSlider,
  type EffortSlider,
} from '@/features/chat/ui/EffortSlider';

const LADDER: ProviderReasoningOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'max', label: 'Max' },
];

const TRACK_WIDTH = 240;
const KNOB_WIDTH = 16;

/** The mock element reports no layout width, so the track span is stubbed explicitly. */
function stubTrackWidth(parentEl: any, width = TRACK_WIDTH): any {
  const track = parentEl.querySelector('.claudian-plus-effort-track');
  track.getBoundingClientRect = () => ({
    top: 0,
    left: 0,
    width,
    height: 30,
    right: width,
    bottom: 30,
    x: 0,
    y: 0,
    toJSON: () => {},
  });
  return track;
}

function clickAt(track: any, clientX: number): void {
  const base = {
    button: 0,
    clientX,
    pointerId: 1,
    preventDefault: () => {},
    stopPropagation: () => {},
  };
  track.dispatchEvent({ ...base, type: 'pointerdown' });
  track.dispatchEvent({ ...base, type: 'pointerup' });
}

function pressKey(track: any, key: string): void {
  track.dispatchEvent({
    type: 'keydown',
    key,
    preventDefault: () => {},
    stopPropagation: () => {},
  });
}

interface Mounted {
  slider: EffortSlider;
  onCommit: jest.Mock;
  root: any;
  track: any;
}

/**
 * Mirrors the toolbar owner: build the control, give it a laid-out track, then
 * paint. `createEffortSlider` never paints on its own.
 */
function mount(options: ProviderReasoningOption[], value: string): Mounted {
  const parentEl = createMockEl();
  const onCommit = jest.fn();
  const slider = createEffortSlider(parentEl, { read: () => ({ options, value }), onCommit });
  const track = stubTrackWidth(parentEl);
  slider.update();

  return { slider, onCommit, root: parentEl.querySelector('.claudian-plus-effort'), track };
}

describe('applyDetent', () => {
  it('returns the raw travel when the ladder has no segment', () => {
    expect(applyDetent(42, 0)).toBe(42);
    expect(applyDetent(42, -5)).toBe(42);
  });

  it('lands exactly on every rung', () => {
    const segment = 70;
    for (let rung = 0; rung <= 3; rung += 1) {
      expect(applyDetent(rung * segment, segment)).toBeCloseTo(rung * segment, 6);
    }
  });

  it('eases into a rung instead of tracking the pointer linearly', () => {
    const segment = 70;
    expect(applyDetent(0.25 * segment, segment)).toBeLessThan(0.25 * segment);
  });

  it('never moves backwards as travel grows', () => {
    const segment = 70;
    let previous = -1;
    for (let step = 0; step <= 40; step += 1) {
      const value = applyDetent((step / 10) * segment, segment);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});

describe('createEffortSlider', () => {
  let mounted: Mounted | null;

  beforeEach(() => {
    mounted = null;
  });

  afterEach(() => {
    mounted?.slider.destroy();
    mounted = null;
  });

  it('exposes the ladder as an accessible slider', () => {
    mounted = mount(LADDER, 'high');

    expect(mounted.track.getAttribute('role')).toBe('slider');
    expect(mounted.track.getAttribute('aria-valuemin')).toBe('0');
    expect(mounted.track.getAttribute('aria-valuemax')).toBe('3');
    expect(mounted.track.getAttribute('aria-valuenow')).toBe('2');
    expect(mounted.track.getAttribute('aria-valuetext')).toBe('High');
  });

  it('renders a shuffled ladder weakest to strongest', () => {
    mounted = mount([LADDER[3], LADDER[0], LADDER[2], LADDER[1]], 'high');

    expect(mounted.track.getAttribute('aria-valuemax')).toBe('3');
    expect(mounted.track.getAttribute('aria-valuenow')).toBe('2');
    expect(mounted.track.getAttribute('aria-valuetext')).toBe('High');
  });

  it('steps through rungs with the keyboard and clamps at the ends', () => {
    mounted = mount(LADDER, 'low');
    const { onCommit, track } = mounted;

    pressKey(track, 'ArrowLeft');
    expect(onCommit).not.toHaveBeenCalled();

    pressKey(track, 'ArrowRight');
    expect(onCommit).toHaveBeenLastCalledWith('medium');

    pressKey(track, 'End');
    expect(onCommit).toHaveBeenLastCalledWith('max');

    pressKey(track, 'ArrowRight');
    expect(onCommit).toHaveBeenCalledTimes(2);

    pressKey(track, 'Home');
    expect(onCommit).toHaveBeenLastCalledWith('low');
  });

  it('ignores keys it does not own', () => {
    mounted = mount(LADDER, 'low');

    pressKey(mounted.track, 'a');
    expect(mounted.onCommit).not.toHaveBeenCalled();
  });

  it('commits the nearest rung when the track is clicked', () => {
    mounted = mount(LADDER, 'low');

    clickAt(mounted.track, TRACK_WIDTH);
    expect(mounted.onCommit).toHaveBeenCalledWith('max');
  });

  it('leaves the knob on the committed rung while settings round-trip', () => {
    mounted = mount(LADDER, 'low');

    clickAt(mounted.track, TRACK_WIDTH);
    mounted.slider.update();

    expect(mounted.track.getAttribute('aria-valuenow')).toBe('3');
    expect(mounted.track.getAttribute('aria-valuetext')).toBe('Max');
  });

  it('snaps back to the persisted rung when an unconfirmed commit is cancelled', () => {
    mounted = mount(LADDER, 'low');

    clickAt(mounted.track, TRACK_WIDTH);
    expect(mounted.onCommit).toHaveBeenCalledWith('max');

    mounted.slider.cancelPending();

    expect(mounted.track.getAttribute('aria-valuenow')).toBe('0');
    expect(mounted.track.getAttribute('aria-valuetext')).toBe('Low');
  });

  it('marks the strongest rung as the apex state', () => {
    mounted = mount(LADDER, 'max');

    expect(mounted.root.hasClass('is-apex')).toBe(true);
    expect(mounted.root.getAttribute('data-apex')).toBe('true');
  });

  it('survives an empty ladder', () => {
    mounted = mount([], 'high');

    expect(mounted.root.getAttribute('data-empty')).toBe('true');
    expect(mounted.track.getAttribute('aria-valuenow')).toBe('0');
  });

  it('keeps the knob inside the track travel', () => {
    mounted = mount(LADDER, 'max');
    const knob = mounted.root.querySelector('.claudian-plus-effort-knob');

    const translate = Number.parseFloat(knob.style.translate);
    expect(translate).toBeGreaterThanOrEqual(0);
    expect(translate).toBeLessThanOrEqual(TRACK_WIDTH - KNOB_WIDTH);
  });
});
