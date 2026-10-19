import {
  extractCodexUserVisibleText,
  joinCodexUserTextParts,
  stripCodexImagePlaceholderText,
} from '@/providers/codex/codexUserText';

describe('codexUserText', () => {
  it('strips inline generated image placeholder tags', () => {
    expect(
      stripCodexImagePlaceholderText('<image name=[Image #1] path="/tmp/1-image-1.png"></image>what was in this img?'),
    ).toBe('what was in this img?');
  });

  it('strips generated image placeholder tags split across text parts', () => {
    expect(
      joinCodexUserTextParts([
        '<image name=[Image #1] path="/tmp/1-image-1.png">',
        '</image>',
        'what was in this img?',
      ], '\n\n'),
    ).toBe('what was in this img?');
  });

  it('strips an injected system context block from the visible user text', () => {
    expect(
      extractCodexUserVisibleText([
        '<system_context>',
        '## Long-term Memory',
        '',
        'Prefers Chinese.',
        '</system_context>',
        '',
        'Summarize this note.',
      ].join('\n')),
    ).toBe('Summarize this note.');
  });

  it('strips a system context block that is not at the start', () => {
    expect(
      extractCodexUserVisibleText([
        'Quoted line',
        '',
        '<system_context>',
        'noise',
        '</system_context>',
        '',
        'Real question',
      ].join('\n')),
    ).toBe('Quoted line\n\nReal question');
  });
});
