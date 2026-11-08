import { chatFontSizeStyle, normalizeChatFontSize } from '@/features/chat/ui/chatFontSize';

describe('chat font size', () => {
  it('treats zero, blanks and junk as "follow the theme"', () => {
    expect(normalizeChatFontSize(0)).toBe(0);
    expect(normalizeChatFontSize(undefined)).toBe(0);
    expect(normalizeChatFontSize('')).toBe(0);
    expect(normalizeChatFontSize('abc')).toBe(0);
    expect(normalizeChatFontSize(-4)).toBe(0);
  });

  it('clamps a chosen size into a readable range', () => {
    expect(normalizeChatFontSize(16)).toBe(16);
    expect(normalizeChatFontSize('18')).toBe(18);
    expect(normalizeChatFontSize(4)).toBe(11);
    expect(normalizeChatFontSize(80)).toBe(24);
  });

  it('emits no custom property while the theme wins', () => {
    expect(chatFontSizeStyle(0)).toEqual({});
  });

  it('emits the container custom property for a chosen size', () => {
    expect(chatFontSizeStyle(17)).toEqual({ '--claudian-plus-chat-font-size': '17px' });
  });
});
