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
    // Guards against the recurring model slip of emitting a bare fence.
    expect(instruction).toContain('MUST be exactly');
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

  it('documents the implemented helper functions and host actions', () => {
    for (const name of ['@First', '@Last', '@Plural', '@Split', '@Contains', '@Upper', '@Lower']) {
      expect(GENERATIVE_UI_INSTRUCTION).toContain(name);
    }
    expect(GENERATIVE_UI_INSTRUCTION).toContain('@OpenUrl(url)');
    expect(GENERATIVE_UI_INSTRUCTION).toContain('@Copy(text)');
  });

  it('documents implemented component parameters', () => {
    expect(GENERATIVE_UI_INSTRUCTION).toContain('Text(text, size?, color?, weight?, italic?)');
    expect(GENERATIVE_UI_INSTRUCTION).toContain('List(children, marker?)');
    expect(GENERATIVE_UI_INSTRUCTION)
      .toContain('Button(label, action?, variant? "solid"|"outline"|"soft"|"ghost", disabled?, full-width?)');
  });

  it('documents the Slider, Select and Checkbox input signatures', () => {
    expect(GENERATIVE_UI_INSTRUCTION).toContain('Slider($value, min, max, step?, label?, unit?)');
    expect(GENERATIVE_UI_INSTRUCTION).toContain('Select($value, options, label?)');
    expect(GENERATIVE_UI_INSTRUCTION).toContain('Checkbox($value, label?)');
  });

  it('advertises the expanded component vocabulary', () => {
    for (const signature of [
      'Table(columns, rows, $sort?, options?)',
      'Chart(type "bar"|"line"|"area"|"pie"|"donut", data, x?, series?, height?, options?)',
      'Form(children, submitLabel, prompt)',
      'Tabs($active, tabs)',
      'Quiz(question, options, answer, explanation?)',
      'NoteCard(linktext)',
      'Image(path, alt?)',
    ]) {
      expect(GENERATIVE_UI_INSTRUCTION).toContain(signature);
    }
  });

  it('documents the new actions without advertising deferred ones', () => {
    for (const name of ['@Toggle($name)', '@OpenNote(linktext)', 'Action([']) {
      expect(GENERATIVE_UI_INSTRUCTION).toContain(name);
    }
    expect(GENERATIVE_UI_INSTRUCTION).not.toContain('@InsertToNote');
    expect(GENERATIVE_UI_INSTRUCTION).not.toContain('currency');
  });

  it('advertises @InsertToNote only when the write setting is enabled', () => {
    expect(resolveGenerativeUiInstruction(true)).not.toContain('@InsertToNote');
    expect(resolveGenerativeUiInstruction(true, true)).toContain('@InsertToNote');
    expect(resolveGenerativeUiInstruction(false, true)).toBeNull();
  });

  it('stays within the resident prompt budget', () => {
    expect(GENERATIVE_UI_INSTRUCTION.length).toBeLessThanOrEqual(8000);
  });
});
