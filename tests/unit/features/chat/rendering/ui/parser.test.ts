import { getRootStatement, parseUiProgram, type UiExpr } from '@/features/chat/rendering/ui/parser';

function rootExpr(source: string): UiExpr {
  const program = parseUiProgram(source);
  const root = getRootStatement(program);
  if (root === undefined || root.expr === null) throw new Error(`no root in: ${source}`);
  return root.expr;
}

describe('parseUiProgram', () => {
  it('parses a root component call with an array of children', () => {
    const expr = rootExpr('root = Col([title, table])\ntitle = Title("Hi")');

    expect(expr.kind).toBe('call');
    expect(expr.kind === 'call' && expr.name).toBe('Col');
    expect(expr.kind === 'call' && expr.args[0]?.kind).toBe('array');
  });

  it('reads arguments positionally', () => {
    const expr = rootExpr('root = Button("Save", null, "ghost")');

    expect(expr.kind === 'call' && expr.args).toHaveLength(3);
    const [label, action, variant] = expr.kind === 'call' ? expr.args : [];
    expect(label).toEqual({ kind: 'literal', value: 'Save' });
    expect(action).toEqual({ kind: 'literal', value: null });
    expect(variant).toEqual({ kind: 'literal', value: 'ghost' });
  });

  it('allows a reference to be defined after it is used', () => {
    const program = parseUiProgram('root = Col([later])\nlater = Title("Later")');

    expect(program.errors).toHaveLength(0);
    expect(program.statements.has('later')).toBe(true);
  });

  it('records state declarations separately', () => {
    const program = parseUiProgram('root = Col([])\n$count = 3');

    const declaration = program.statements.get('count');
    expect(declaration?.state).toBe(true);
    expect(declaration?.expr).toEqual({ kind: 'literal', value: 3 });
  });

  it('parses arithmetic with correct precedence', () => {
    const expr = rootExpr('root = Col([1 + 2 * 3])');

    const item = expr.kind === 'call' ? expr.args[0] : undefined;
    const first = item?.kind === 'array' ? item.items[0] : undefined;
    expect(first?.kind).toBe('binary');
    expect(first?.kind === 'binary' && first.operator).toBe('+');
    expect(first?.kind === 'binary' && first.right.kind).toBe('binary');
  });

  it('parses member access, indexing and function calls', () => {
    const expr = rootExpr('root = Text(rows[0].title)\nrows = @Each(items, "item", item.title)');

    expect(expr.kind === 'call' && expr.args[0]?.kind).toBe('member');
    const each = parseUiProgram('root = Text("x")\nrows = @Each(items, "item", item.title)').statements.get('rows');
    expect(each?.expr?.kind).toBe('call');
    expect(each?.expr?.kind === 'call' && each.expr.name).toBe('@Each');
  });

  it('tolerates an unterminated string while streaming', () => {
    const program = parseUiProgram('root = Title("unfinished');

    expect(program.errors).toHaveLength(0);
    expect(getRootStatement(program)?.expr).not.toBeNull();
  });

  it('tolerates an unbalanced bracket while streaming', () => {
    const program = parseUiProgram('root = Col([title, chart');

    expect(getRootStatement(program)?.expr).not.toBeNull();
  });

  it('records an error for a malformed statement without throwing', () => {
    const program = parseUiProgram('not-a-statement\nroot = Col([])');

    expect(program.errors.length).toBeGreaterThan(0);
    expect(program.statements.has('root')).toBe(true);
  });

  it('skips comments and blank lines', () => {
    const program = parseUiProgram(['// leading comment', '# another', '', 'root = Col([])'].join('\n'));

    expect(program.errors).toHaveLength(0);
    expect(program.order).toEqual(['root']);
  });

  it('joins a continued statement', () => {
    const program = parseUiProgram('root = Col([\n  title,\n  table\n])');

    expect(program.errors).toHaveLength(0);
    expect(getRootStatement(program)?.expr?.kind).toBe('call');
  });
});
