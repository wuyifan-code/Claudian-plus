import {
  AuxiliaryRequestGate,
  AuxiliaryRequestPolicy,
  buildLocalFallbackTitle,
  getSharedBackgroundRequestGate,
  resolveAuxiliarySavingMode,
  setSharedBackgroundRequestGate,
} from '@/core/auxiliary/AuxiliaryRequestPolicy';

const DAY_18 = new Date(2026, 8, 18, 9, 0, 0);
const DAY_19 = new Date(2026, 8, 19, 0, 5, 0);
const DAY_18_KEY = '2026-09-18';

function createGate(
  overrides: Partial<ConstructorParameters<typeof AuxiliaryRequestGate>[0]> = {},
): AuxiliaryRequestGate {
  return new AuxiliaryRequestGate({
    resolveSavingMode: () => 'standard',
    resolveDailyLimit: () => null,
    now: () => DAY_18,
    ...overrides,
  });
}

describe('AuxiliaryRequestPolicy', () => {
  describe('saving mode resolution', () => {
    it('keeps existing installs on standard when the setting is missing or unknown', () => {
      expect(resolveAuxiliarySavingMode(undefined)).toBe('standard');
      expect(resolveAuxiliarySavingMode(null)).toBe('standard');
      expect(resolveAuxiliarySavingMode('standard')).toBe('standard');
      expect(resolveAuxiliarySavingMode('turbo')).toBe('standard');
    });

    it('accepts the explicit economy value', () => {
      expect(resolveAuxiliarySavingMode('economy')).toBe('economy');
    });
  });

  describe('automatic task decisions', () => {
    it('blocks every automatic background task in economy mode', () => {
      const policy = new AuxiliaryRequestPolicy('economy');

      expect(policy.allowsAutomaticTask('auto-title')).toBe(false);
      expect(policy.allowsAutomaticTask('auto-micro-dream')).toBe(false);
      expect(policy.allowsAutomaticTask('auto-dream')).toBe(false);
    });

    it('allows every automatic background task in standard mode', () => {
      const policy = new AuxiliaryRequestPolicy('standard');

      expect(policy.allowsAutomaticTask('auto-title')).toBe(true);
      expect(policy.allowsAutomaticTask('auto-micro-dream')).toBe(true);
      expect(policy.allowsAutomaticTask('auto-dream')).toBe(true);
    });

    it('never consumes the budget when the policy blocks a task', () => {
      const gate = createGate({ resolveSavingMode: () => 'economy' });

      expect(gate.allowsAutomaticTask('auto-micro-dream')).toBe(false);
      expect(gate.getIssuedToday()).toBe(0);
    });
  });

  describe('background request budget', () => {
    it('issues a request and counts it immediately', () => {
      const gate = createGate();

      expect(gate.tryBegin()).toBeNull();
      expect(gate.getIssuedToday()).toBe(1);
      expect(gate.getInFlightCount()).toBe(1);

      gate.end();
      expect(gate.getInFlightCount()).toBe(0);
      // A counted request stays counted after it finishes.
      expect(gate.getIssuedToday()).toBe(1);
    });

    it('never lets two simultaneous requests pass the single concurrency slot', () => {
      const gate = createGate({ resolveDailyLimit: () => 2 });

      expect(gate.tryBegin()).toBeNull();
      expect(gate.tryBegin()).toBe('busy');

      gate.end();
      expect(gate.tryBegin()).toBeNull();
      gate.end();
      expect(gate.tryBegin()).toBe('daily-limit-reached');
    });

    it('still counts a request that fails after being issued', () => {
      const gate = createGate({ resolveDailyLimit: () => 1 });

      expect(gate.tryBegin()).toBeNull();
      gate.end();

      expect(gate.getIssuedToday()).toBe(1);
      expect(gate.tryBegin()).toBe('daily-limit-reached');
    });

    it('does not count a request cancelled before dispatch', () => {
      const gate = createGate();
      const controller = new AbortController();
      controller.abort();

      expect(gate.tryBegin(controller.signal)).toBe('cancelled');
      expect(gate.getIssuedToday()).toBe(0);
      expect(gate.getInFlightCount()).toBe(0);
    });

    it('resets the count when the local day rolls over', () => {
      let now = DAY_18;
      const gate = createGate({ now: () => now });

      expect(gate.tryBegin()).toBeNull();
      gate.end();
      expect(gate.getIssuedToday()).toBe(1);

      now = DAY_19;
      expect(gate.getIssuedToday()).toBe(0);
      expect(gate.tryBegin()).toBeNull();
      expect(gate.getIssuedToday()).toBe(1);
    });

    it('restores the same-day count after a restart', () => {
      const gate = createGate({ resolveDailyLimit: () => 2 });
      gate.tryBegin();
      gate.end();
      gate.tryBegin();
      gate.end();
      const persisted = gate.getUsageSnapshot();

      const restarted = createGate({
        resolveDailyLimit: () => 2,
        initialUsage: persisted,
      });

      expect(restarted.getIssuedToday()).toBe(2);
      expect(restarted.tryBegin()).toBe('daily-limit-reached');
    });

    it('ignores persisted usage from a previous day', () => {
      const restarted = createGate({
        initialUsage: { day: '2026-09-17', count: 9 },
      });

      expect(restarted.getIssuedToday()).toBe(0);
      expect(restarted.tryBegin()).toBeNull();
    });

    it('discards malformed persisted usage instead of trusting it', () => {
      const negative = createGate({ initialUsage: { day: DAY_18_KEY, count: -3 } });
      expect(negative.getIssuedToday()).toBe(0);

      const fractional = createGate({ initialUsage: { day: DAY_18_KEY, count: 1.5 } });
      expect(fractional.getIssuedToday()).toBe(0);
    });

    it('notifies persistence with the usage snapshot after each counted request', () => {
      const onUsageChanged = jest.fn();
      const gate = createGate({ onUsageChanged });

      gate.tryBegin();

      expect(onUsageChanged).toHaveBeenCalledWith({ day: DAY_18_KEY, count: 1 });
    });

    it('keeps issuing requests when no daily limit is configured', () => {
      const gate = createGate();

      for (let index = 0; index < 25; index++) {
        expect(gate.tryBegin()).toBeNull();
        gate.end();
      }
      expect(gate.getIssuedToday()).toBe(25);
    });

    it('survives persistence callbacks that throw', () => {
      const gate = createGate({
        onUsageChanged: () => {
          throw new Error('storage offline');
        },
      });

      expect(gate.tryBegin()).toBeNull();
      expect(gate.getIssuedToday()).toBe(1);
    });
  });

  describe('local fallback title', () => {
    it('uses the first non-empty line of the message', () => {
      expect(buildLocalFallbackTitle('Fix the login bug')).toBe('Fix the login bug');
      expect(buildLocalFallbackTitle('   \n  \nSecond line comes first\nThird')).toBe('Second line comes first');
      expect(buildLocalFallbackTitle('multi\nline\nmessage')).toBe('multi');
    });

    it('truncates long messages', () => {
      const long = 'x'.repeat(80);
      expect(buildLocalFallbackTitle(long)).toBe(`${'x'.repeat(50)}...`);
    });

    it('collapses whitespace inside the line', () => {
      expect(buildLocalFallbackTitle('Fix   the\tlogin  bug')).toBe('Fix the login bug');
    });

    it('falls back to a neutral title for an empty message', () => {
      expect(buildLocalFallbackTitle('')).toBe('Untitled');
      expect(buildLocalFallbackTitle('   \n  ')).toBe('Untitled');
    });
  });

  describe('shared gate registry', () => {
    afterEach(() => {
      setSharedBackgroundRequestGate(null);
    });

    it('starts empty and round-trips the assembled gate', () => {
      expect(getSharedBackgroundRequestGate()).toBeNull();

      const gate = createGate();
      setSharedBackgroundRequestGate(gate);
      expect(getSharedBackgroundRequestGate()).toBe(gate);

      setSharedBackgroundRequestGate(null);
      expect(getSharedBackgroundRequestGate()).toBeNull();
    });
  });
});
