import { createMockEl } from '@test/helpers/mockElement';

import type { SemanticIndexProgress } from '@/core/retrieval/VaultRetrievalService';
import { VaultHealthModal } from '@/features/chat/VaultHealthModal';

function createProgressHarness(modal: VaultHealthModal) {
  const progressEl = createMockEl('p');
  const progressBarEl = createMockEl('progress') as unknown as HTMLProgressElement;
  const etaEl = createMockEl('p');
  const cancelBtn = createMockEl('button');

  // Wire classList for the visibility toggle.
  (modal as unknown as Record<string, unknown>).semanticProgressEl = progressEl;
  (modal as unknown as Record<string, unknown>).semanticProgressBarEl = progressBarEl;
  (modal as unknown as Record<string, unknown>).semanticEtaEl = etaEl;
  (modal as unknown as Record<string, unknown>).semanticCancelBtn = cancelBtn;
  (modal as unknown as Record<string, unknown>).semanticStartedAt = null;

  return { progressEl, progressBarEl, etaEl, cancelBtn };
}

function emit(modal: VaultHealthModal, progress: SemanticIndexProgress): void {
  (modal as unknown as { updateSemanticProgress: (p: SemanticIndexProgress) => void })
    .updateSemanticProgress(progress);
}

describe('VaultHealthModal semantic progress UI', () => {
  let modal: VaultHealthModal;
  let harness: ReturnType<typeof createProgressHarness>;

  beforeEach(() => {
    modal = Object.create(VaultHealthModal.prototype) as VaultHealthModal;
    harness = createProgressHarness(modal);
  });

  it('keeps the bar and ETA hidden when semantic indexing is idle', () => {
    emit(modal, { indexedBlocks: 0, totalBlocks: 0, status: 'idle', error: null });
    expect(harness.progressBarEl.classList.contains('claudian-plus-health-progress-hidden')).toBe(true);
    expect(harness.etaEl.classList.contains('claudian-plus-health-progress-hidden')).toBe(true);
    expect(harness.cancelBtn.classList.contains('claudian-plus-health-progress-hidden')).toBe(true);
  });

  it('reveals the bar, ETA, and cancel button when indexing starts', () => {
    emit(modal, { indexedBlocks: 0, totalBlocks: 100, status: 'indexing', error: null });
    expect(harness.progressBarEl.classList.contains('claudian-plus-health-progress-hidden')).toBe(false);
    expect(harness.cancelBtn.classList.contains('claudian-plus-health-progress-hidden')).toBe(false);
    // The bar's max matches the total; the value is 0 (no blocks done yet).
    expect(harness.progressBarEl.max).toBe(100);
    expect(harness.progressBarEl.value).toBe(0);
  });

  it('updates the bar value and ETA label as blocks finish', () => {
    jest.useFakeTimers();
    try {
      const t0 = Date.parse('2026-07-29T00:00:00Z');
      jest.setSystemTime(t0);
      emit(modal, { indexedBlocks: 0, totalBlocks: 1000, status: 'indexing', error: null });
      // Advance 10 seconds and emit 200 blocks done.
      jest.setSystemTime(t0 + 10_000);
      emit(modal, { indexedBlocks: 200, totalBlocks: 1000, status: 'indexing', error: null });
      // Rate should be 20 blocks/sec, ETA = (1000-200)/20 = 40s.
      expect(harness.progressBarEl.value).toBe(200);
      expect(harness.etaEl.textContent).toContain('20.0 sections/sec');
      expect(harness.etaEl.textContent).toContain('ETA 40s');
    } finally {
      jest.useRealTimers();
    }
  });

  it('hides the bar and cancel button when indexing reaches ready', () => {
    emit(modal, { indexedBlocks: 500, totalBlocks: 1000, status: 'indexing', error: null });
    emit(modal, { indexedBlocks: 1000, totalBlocks: 1000, status: 'ready', error: null });
    expect(harness.progressBarEl.classList.contains('claudian-plus-health-progress-hidden')).toBe(true);
    expect(harness.etaEl.classList.contains('claudian-plus-health-progress-hidden')).toBe(true);
    expect(harness.cancelBtn.classList.contains('claudian-plus-health-progress-hidden')).toBe(true);
    // After 'ready' the next 'indexing' must re-show the bar (it was hidden on
    // close, so re-enable is a useful regression check).
    emit(modal, { indexedBlocks: 0, totalBlocks: 100, status: 'indexing', error: null });
    expect(harness.progressBarEl.classList.contains('claudian-plus-health-progress-hidden')).toBe(false);
  });

  it('exposes the cancel handler that delegates to cancelSemanticWarmup', () => {
    const cancel = jest.fn();
    const fakeService = { cancelSemanticWarmup: cancel };
    (modal as unknown as { retrievalService: typeof fakeService }).retrievalService = fakeService;
    // render() would have wired the listener; tests bypass render() so we
    // call the helper directly to mirror production wiring.
    modal.wireSemanticCancelHandler(harness.cancelBtn as unknown as HTMLButtonElement);

    emit(modal, { indexedBlocks: 10, totalBlocks: 100, status: 'indexing', error: null });
    (harness.cancelBtn as unknown as { click: () => void }).click();
    expect(cancel).toHaveBeenCalledTimes(1);
    // Button shows the cancelling state until the next progress emit clears it.
    expect(harness.cancelBtn.textContent).toBe('Cancelling...');
    expect((harness.cancelBtn as unknown as { disabled: boolean }).disabled).toBe(true);

    // A subsequent progress event must re-enable the button so the user can
    // cancel a fresh pass.
    emit(modal, { indexedBlocks: 20, totalBlocks: 100, status: 'indexing', error: null });
    expect((harness.cancelBtn as unknown as { disabled: boolean }).disabled).toBe(false);
    expect(harness.cancelBtn.textContent).toBe('Cancel semantic indexing');
  });

  it('omits the rate/ETA when the sample is too small to be meaningful', () => {
    jest.useFakeTimers();
    try {
      const t0 = Date.parse('2026-07-29T00:00:00Z');
      jest.setSystemTime(t0);
      // First emit: status flips to indexing, no blocks done yet.
      emit(modal, { indexedBlocks: 0, totalBlocks: 1000, status: 'indexing', error: null });
      expect(harness.etaEl.textContent).toBe('');
    } finally {
      jest.useRealTimers();
    }
  });
});
