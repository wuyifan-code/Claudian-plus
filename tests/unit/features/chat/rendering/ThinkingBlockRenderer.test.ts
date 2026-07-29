import {
  cleanupThinkingBlock,
  finalizeThinkingBlock,
  type ThinkingBlockState,
} from '@/features/chat/rendering/ThinkingBlockRenderer';

jest.mock('@/features/chat/rendering/collapsible', () => ({
  collapseElement: jest.fn(),
  setupCollapsible: jest.fn(),
}));

function createThinkingState(timerInterval: number | null): ThinkingBlockState {
  return {
    wrapperEl: { querySelector: jest.fn().mockReturnValue(null) } as unknown as HTMLElement,
    contentEl: {} as HTMLElement,
    labelEl: { setText: jest.fn() } as unknown as HTMLElement,
    content: '',
    startTime: Date.now(),
    timerInterval,
    timerWindow: { clearInterval: jest.fn() } as unknown as Window,
    isExpanded: false,
  };
}

describe('ThinkingBlockRenderer timer cleanup', () => {
  it('finalizes a timer whose browser handle is zero', () => {
    const state = createThinkingState(0);
    const timerWindow = state.timerWindow as unknown as { clearInterval: jest.Mock };

    finalizeThinkingBlock(state);

    expect(timerWindow.clearInterval).toHaveBeenCalledWith(0);
    expect(state.timerWindow).toBeNull();
    expect(state.timerInterval).toBeNull();
  });

  it('cleans up a zero-valued timer when a thinking block is discarded', () => {
    const state = createThinkingState(0);
    const timerWindow = state.timerWindow as unknown as { clearInterval: jest.Mock };

    cleanupThinkingBlock(state);

    expect(timerWindow.clearInterval).toHaveBeenCalledWith(0);
    expect(state.timerWindow).toBeNull();
    expect(state.timerInterval).toBeNull();
  });
});
