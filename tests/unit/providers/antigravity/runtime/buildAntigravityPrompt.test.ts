import type { ChatTurnRequest } from '@/core/runtime/types';
import type { ChatMessage, ImageAttachment } from '@/core/types';
import {
  ANTIGRAVITY_SYSTEM_GUIDANCE,
  buildAntigravityPrompt,
} from '@/providers/antigravity/runtime/buildAntigravityPrompt';

function createRequest(overrides: Partial<ChatTurnRequest> = {}): ChatTurnRequest {
  return {
    text: 'Summarize this note.',
    ...overrides,
  };
}

function createHistoryEntry(role: 'user' | 'assistant', content: string): ChatMessage {
  return {
    id: `${role}-1`,
    role,
    content,
    timestamp: 0,
  };
}

describe('buildAntigravityPrompt', () => {
  it('passes the user text through and appends headless execution guidance', () => {
    const prompt = buildAntigravityPrompt(createRequest());
    expect(prompt).toContain('Summarize this note.');
    expect(prompt).toContain(ANTIGRAVITY_SYSTEM_GUIDANCE);
  });

  it('appends the current note context', () => {
    const prompt = buildAntigravityPrompt(createRequest({ currentNotePath: 'Notes/idea.md' }));
    expect(prompt).toContain('Summarize this note.');
    expect(prompt).toContain('Notes/idea.md');
  });

  it('appends editor selection context', () => {
    const prompt = buildAntigravityPrompt(createRequest({
      editorSelection: {
        mode: 'selection',
        notePath: 'Notes/idea.md',
        selectedText: 'the selected passage',
      },
    }));
    expect(prompt).toContain('the selected passage');
  });

  it('does not re-encode conversation history: the CLI resumes its own conversation', () => {
    const history = [
      createHistoryEntry('user', 'earlier user question'),
      createHistoryEntry('assistant', 'earlier assistant answer'),
    ];
    const prompt = buildAntigravityPrompt(createRequest(), history);
    expect(prompt).toContain('Summarize this note.');
    expect(prompt).toContain(ANTIGRAVITY_SYSTEM_GUIDANCE);
    expect(prompt).not.toContain('earlier user question');
    expect(prompt).not.toContain('earlier assistant answer');
  });

  it('never encodes images: image attachments are not a verified capability', () => {
    const image: ImageAttachment = {
      id: 'img-1',
      name: 'diagram.png',
      mediaType: 'image/png',
      data: 'base64data',
      source: 'paste',
      size: 4,
    };
    const prompt = buildAntigravityPrompt(createRequest({ images: [image] }));
    expect(prompt).not.toContain('base64data');
  });
});
