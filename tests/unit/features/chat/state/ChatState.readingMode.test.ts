import { ChatState } from '@/features/chat/state/ChatState';

describe('ChatState readingMode', () => {
  it('defaults readingMode to false', () => {
    const chatState = new ChatState();
    expect(chatState.getReadingMode()).toBe(false);
  });

  it('sets and gets readingMode value', () => {
    const chatState = new ChatState();
    chatState.setReadingMode(true);
    expect(chatState.getReadingMode()).toBe(true);
    chatState.setReadingMode(false);
    expect(chatState.getReadingMode()).toBe(false);
  });

  it('triggers onReadingModeChanged callback when value changes', () => {
    const onReadingModeChanged = jest.fn();
    const chatState = new ChatState({ onReadingModeChanged });

    chatState.setReadingMode(true);
    expect(onReadingModeChanged).toHaveBeenCalledTimes(1);
    expect(onReadingModeChanged).toHaveBeenCalledWith(true);

    chatState.setReadingMode(false);
    expect(onReadingModeChanged).toHaveBeenCalledTimes(2);
    expect(onReadingModeChanged).toHaveBeenCalledWith(false);
  });

  it('does not leak readingMode across different ChatState instances', () => {
    const stateA = new ChatState();
    const stateB = new ChatState();

    stateA.setReadingMode(true);
    expect(stateA.getReadingMode()).toBe(true);
    expect(stateB.getReadingMode()).toBe(false);
  });

  it('resets readingMode on resetForNewConversation', () => {
    const chatState = new ChatState();
    chatState.setReadingMode(true);
    chatState.resetForNewConversation();
    expect(chatState.getReadingMode()).toBe(false);
  });
});
