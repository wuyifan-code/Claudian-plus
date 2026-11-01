import { parseUiProgram } from '@/features/chat/rendering/ui/parser';
import {
  collectUiProgramText,
  reserveEmbedHeight,
} from '@/features/chat/rendering/ui/reservation';

describe('collectUiProgramText', () => {
  it('collects the strings a program renders, nested and repeated', () => {
    const program = parseUiProgram([
      'root = Col([heading, body, cards])',
      'heading = Title("Quarterly review")',
      'body = Text("Revenue grew 12%.")',
      'cards = Row([Card("North", "up 4%"), Card("South", "up 8%")])',
    ].join('\n'));

    const text = collectUiProgramText(program);

    for (const expected of ['Quarterly review', 'Revenue grew 12%', 'North', 'up 4%', 'South', 'up 8%']) {
      expect(text).toContain(expected);
    }
  });

  it('ignores references, state, and non-string literals', () => {
    const program = parseUiProgram([
      'root = Col([count, label])',
      'count = Stat(12, 40, true)',
      'label = Text("only text")',
    ].join('\n'));

    expect(collectUiProgramText(program).trim()).toBe('only text');
  });

  it('returns an empty string for a program with no text', () => {
    const program = parseUiProgram('root = Spacer(8)');
    expect(collectUiProgramText(program)).toBe('');
  });
});

describe('reserveEmbedHeight', () => {
  it('adds block chrome to a predicted text height', () => {
    expect(reserveEmbedHeight(100)).toBe(156);
  });

  it('never reserves less than a usable minimum', () => {
    expect(reserveEmbedHeight(null)).toBe(72);
    expect(reserveEmbedHeight(0)).toBe(72);
    expect(reserveEmbedHeight(-20)).toBe(72);
    expect(reserveEmbedHeight(Number.NaN)).toBe(72);
    expect(reserveEmbedHeight(4)).toBe(72);
  });

  it('caps absurd predictions', () => {
    expect(reserveEmbedHeight(100_000)).toBe(1600);
  });
});
