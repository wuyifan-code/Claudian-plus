import {
  GENERATIVE_UI_INSTRUCTION,
  resolveGenerativeUiInstruction,
} from '@/core/prompt/generativeUi';
import { buildSystemPrompt, computeSystemPromptKey } from '@/core/prompt/mainAgent';

describe('generative UI instruction', () => {
  it('returns the instruction when the feature is enabled', () => {
    const instruction = resolveGenerativeUiInstruction(true);

    expect(instruction).toBe(GENERATIVE_UI_INSTRUCTION);
    expect(instruction).toContain('claudian-ui');
    expect(instruction).toContain('## Response form');
  });

  it('returns nothing when the feature is disabled', () => {
    expect(resolveGenerativeUiInstruction(false)).toBeNull();
  });

  it('reaches the system prompt through the appendix channel', () => {
    const withUi = buildSystemPrompt({}, { appendices: [GENERATIVE_UI_INSTRUCTION] });
    const withoutUi = buildSystemPrompt({}, {});

    expect(withUi).toContain('## Response form');
    expect(withoutUi).not.toContain('## Response form');
    expect(withUi.length).toBeGreaterThan(withoutUi.length);
  });

  it('changes the prompt cache key so toggling restarts providers', () => {
    const enabledKey = computeSystemPromptKey({}, { appendices: [GENERATIVE_UI_INSTRUCTION] });
    const disabledKey = computeSystemPromptKey({}, {});

    expect(enabledKey).not.toBe(disabledKey);
  });

  it('tells the model to keep plain text when it is better', () => {
    expect(GENERATIVE_UI_INSTRUCTION).toContain('plain text');
    expect(GENERATIVE_UI_INSTRUCTION).toContain('Diagram(');
  });
});
