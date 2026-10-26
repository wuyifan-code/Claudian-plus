import {
  createScope,
  evaluate,
  readActionTarget,
  type ResolvedElement,
  toDisplayText,
} from '@/features/chat/rendering/ui/evaluate';
import { parseUiProgram, type UiExpr } from '@/features/chat/rendering/ui/parser';

function evaluateSource(source: string, state: Record<string, unknown> = {}): unknown {
  const program = parseUiProgram(source);
  const scope = createScope(program, (name) => state[name]);
  const target = program.statements.get('value');
  if (target?.expr === null || target === undefined) throw new Error('missing value statement');
  return evaluate(target.expr, scope);
}

describe('evaluate', () => {
  it('applies arithmetic precedence', () => {
    expect(evaluateSource('value = 1 + 2 * 3')).toBe(7);
  });

  it('concatenates when either side is a string', () => {
    expect(evaluateSource('value = "n=" + 4')).toBe('n=4');
  });

  it('selects a ternary branch', () => {
    expect(evaluateSource('value = 1 > 2 ? "a" : "b"')).toBe('b');
  });

  it('maps a field across a list', () => {
    const value = evaluateSource(
      'value = rows.amount\nrows = [{amount: 10}, {amount: 20}]',
    );
    expect(value).toEqual([10, 20]);
  });

  it('aggregates lists', () => {
    expect(evaluateSource('value = @Sum(numbers)\nnumbers = [1, 2, 3]')).toBe(6);
    expect(evaluateSource('value = @Round(3.14159, 2)')).toBe(3.14);
    expect(evaluateSource('value = @Percent(1, 4)')).toBe(25);
  });

  it('expands @Each with a loop-local variable', () => {
    const value = evaluateSource('value = @Each(items, "n", n * 2)\nitems = [1, 2, 3]');
    expect(value).toEqual([2, 4, 6]);
  });

  it('resolves references that are declared later', () => {
    expect(evaluateSource('value = base + 1\nbase = 41')).toBe(42);
  });

  it('survives a reference cycle without recursing forever', () => {
    const program = parseUiProgram('value = a\na = value');
    const scope = createScope(program, () => undefined);
    const expression = program.statements.get('value')?.expr;
    expect(() => evaluate(expression ?? { kind: 'literal', value: null }, scope)).not.toThrow();
  });

  it('reads bound state and falls back to the declared default', () => {
    const source = 'value = $count\n$count = 7';
    expect(evaluateSource(source)).toBe(7);
    expect(evaluateSource(source, { count: 3 })).toBe(3);
  });

  it('produces an element node that keeps its raw argument expressions', () => {
    const program = parseUiProgram('value = Input($name, "Name")\n$name = "x"');
    const scope = createScope(program, () => undefined);
    const result = evaluate(program.statements.get('value')?.expr ?? { kind: 'literal', value: null }, scope) as ResolvedElement;

    expect(result.type).toBe('element');
    expect(result.name).toBe('Input');
    expect(result.args[0]?.kind).toBe('state');
    expect(result.values[0]).toBe('x');
  });

  it('keeps the action target of @Set addressable', () => {
    const program = parseUiProgram('value = @Set($step, 2)\n$step = 0');
    const scope = createScope(program, () => 0);
    const expression = program.statements.get('value')?.expr;
    evaluate(expression ?? { kind: 'literal', value: null }, scope);

    expect(expression?.kind === 'call' && readActionTarget(expression.args[0])).toBe('step');
  });

  it('keeps a state default when a named statement shares its name', () => {
    const program = parseUiProgram([
      'root = Col([day])',
      '$day = "2026-10-25"',
      'day = DatePicker($day, "Day", "date")',
    ].join('\n'));
    const scope = createScope(program, () => undefined);
    const stateRef: UiExpr = { kind: 'state', name: 'day' };

    expect(evaluate(stateRef, scope)).toBe('2026-10-25');
    expect(program.statements.get('day')?.state).toBe(false);
  });

  it('renders text from scalars and lists', () => {
    expect(toDisplayText(null)).toBe('');
    expect(toDisplayText(3)).toBe('3');
    expect(toDisplayText(['a', 'b'])).toBe('a, b');
  });
});
