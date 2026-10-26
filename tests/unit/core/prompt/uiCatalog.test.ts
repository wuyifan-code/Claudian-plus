import { GENERATIVE_UI_INSTRUCTION } from '@/core/prompt/generativeUi';
import { UI_CATALOG } from '@/core/prompt/uiCatalog';

function splitArgs(signature: string): string[] {
  const open = signature.indexOf('(');
  const close = signature.lastIndexOf(')');
  if (open < 0 || close <= open) return [];
  const inner = signature.slice(open + 1, close).trim();
  if (inner.length === 0) return [];

  const args: string[] = [];
  let current = '';
  let depth = 0;
  let quoted = false;
  for (const char of inner) {
    if (char === '"') quoted = !quoted;
    if (!quoted && char === '(') depth += 1;
    if (!quoted && char === ')') depth -= 1;
    if (!quoted && depth === 0 && char === ',') {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim().length > 0) args.push(current.trim());
  return args;
}

describe('generative UI catalog', () => {
  it('has unique names and a non-empty signature for every component', () => {
    const names = UI_CATALOG.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    for (const entry of UI_CATALOG) {
      expect(entry.signature.startsWith(`${entry.name}(`)).toBe(true);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it('declares bindings exactly where the signature uses $arguments', () => {
    for (const entry of UI_CATALOG) {
      const fromSignature = splitArgs(entry.signature)
        .flatMap((argument, index) => (argument.startsWith('$') ? [index] : []));
      expect({ name: entry.name, bindings: entry.bindings ?? [] })
        .toEqual({ name: entry.name, bindings: fromSignature });
    }
  });

  it('covers every group with at least one component', () => {
    const groups = new Set(UI_CATALOG.map((entry) => entry.group));
    expect(groups).toEqual(new Set([
      'Layout', 'Text', 'Data', 'Inputs', 'Structure', 'Learning', 'Obsidian',
    ]));
  });

  it('builds the instruction from every catalog signature', () => {
    expect(UI_CATALOG).toHaveLength(54);
    for (const entry of UI_CATALOG) {
      expect(GENERATIVE_UI_INSTRUCTION).toContain(entry.signature);
    }
  });

  it('keeps the resident prompt within its token budget', () => {
    expect(GENERATIVE_UI_INSTRUCTION.length).toBeLessThanOrEqual(8000);
    expect(GENERATIVE_UI_INSTRUCTION).toContain('claudian-ui');
    expect(GENERATIVE_UI_INSTRUCTION).toContain('MUST be exactly');
  });

  it('documents the actions that shipped with the expansion', () => {
    for (const name of ['@Toggle', '@OpenNote', 'Action([', '@ToAssistant']) {
      expect(GENERATIVE_UI_INSTRUCTION).toContain(name);
    }
    expect(GENERATIVE_UI_INSTRUCTION).not.toContain('@InsertToNote');
    expect(GENERATIVE_UI_INSTRUCTION).not.toContain('currency');
  });
});
