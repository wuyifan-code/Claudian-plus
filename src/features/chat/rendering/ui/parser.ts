/**
 * Tolerant parser for the declarative UI language.
 *
 * Grammar (deliberately a subset of OpenUI Lang 1.0):
 *   statement  := ('$'? ident) '=' expression
 *   expression := ternary over arithmetic over calls/member/index/literals
 *
 * The parser is built for a stream: it must survive truncated input on every
 * animation frame, so it auto-closes unterminated strings and brackets and
 * degrades a broken statement to `null` instead of throwing.
 */

export type UiExpr =
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'array'; items: UiExpr[] }
  | { kind: 'object'; entries: Array<{ key: string; value: UiExpr }> }
  | { kind: 'reference'; name: string }
  | { kind: 'state'; name: string }
  | { kind: 'call'; name: string; args: UiExpr[] }
  | { kind: 'member'; target: UiExpr; name: string }
  | { kind: 'index'; target: UiExpr; index: UiExpr }
  | { kind: 'unary'; operator: string; operand: UiExpr }
  | { kind: 'binary'; operator: string; left: UiExpr; right: UiExpr }
  | { kind: 'ternary'; test: UiExpr; whenTrue: UiExpr; whenFalse: UiExpr };

export interface UiStatement {
  name: string;
  /** True when declared as `$name`, i.e. a two-way bound variable. */
  state: boolean;
  expr: UiExpr | null;
}

export interface UiProgram {
  statements: Map<string, UiStatement>;
  /** Declaration order, useful for diagnostics. */
  order: string[];
  errors: string[];
}

type TokenKind = 'identifier' | 'number' | 'string' | 'punctuation' | 'newline';

interface Token {
  kind: TokenKind;
  value: string;
}

const TWO_CHAR_OPERATORS = ['==', '!=', '>=', '<=', '&&', '||'];
const SINGLE_CHAR_PUNCTUATION = '()[]{},:?.=+-*/%!<>';

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

function isIdentifierStart(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}

function isIdentifierPart(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  return isIdentifierStart(ch) || isDigit(ch);
}

function readEscape(source: string, index: number): { value: string; next: number } {
  const ch = source[index];
  switch (ch) {
    case 'n':
      return { value: '\n', next: index + 1 };
    case 't':
      return { value: '\t', next: index + 1 };
    case 'r':
      return { value: '\r', next: index + 1 };
    case undefined:
      return { value: '', next: index };
    default:
      return { value: ch, next: index + 1 };
  }
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  const length = source.length;

  while (index < length) {
    const ch = source[index];

    if (ch === '\n') {
      tokens.push({ kind: 'newline', value: '\n' });
      index += 1;
      continue;
    }

    if (ch === ' ' || ch === '\t' || ch === '\r') {
      index += 1;
      continue;
    }

    if (ch === '#' || (ch === '/' && source[index + 1] === '/')) {
      while (index < length && source[index] !== '\n') index += 1;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      let value = '';
      index += 1;
      while (index < length) {
        const current = source[index];
        if (current === '\\') {
          const escaped = readEscape(source, index + 1);
          value += escaped.value;
          index = escaped.next;
          continue;
        }
        if (current === quote) {
          index += 1;
          break;
        }
        // An unterminated string while streaming simply ends with the chunk.
        if (current === '\n') break;
        value += current;
        index += 1;
      }
      tokens.push({ kind: 'string', value });
      continue;
    }

    if (isDigit(ch) || (ch === '.' && isDigit(source[index + 1]))) {
      let value = '';
      while (index < length && (isDigit(source[index]) || source[index] === '.')) {
        value += source[index];
        index += 1;
      }
      tokens.push({ kind: 'number', value });
      continue;
    }

    if (startIdentifier(ch, source, index)) {
      const prefix = ch === '@' || ch === '$' ? ch : '';
      if (prefix) index += 1;
      let name = '';
      while (index < length && isIdentifierPart(source[index])) {
        name += source[index];
        index += 1;
      }
      if (prefix && name.length > 0) {
        tokens.push({ kind: 'identifier', value: `${prefix}${name}` });
      } else if (prefix) {
        tokens.push({ kind: 'punctuation', value: prefix });
      } else {
        tokens.push({ kind: 'identifier', value: name });
      }
      continue;
    }

    const twoChar = source.slice(index, index + 2);
    if (TWO_CHAR_OPERATORS.includes(twoChar)) {
      tokens.push({ kind: 'punctuation', value: twoChar });
      index += 2;
      continue;
    }

    if (SINGLE_CHAR_PUNCTUATION.includes(ch)) {
      tokens.push({ kind: 'punctuation', value: ch });
      index += 1;
      continue;
    }

    // Unknown character: skip it rather than abort the whole program.
    index += 1;
  }

  return tokens;
}

function startIdentifier(ch: string, source: string, index: number): boolean {
  if (isIdentifierStart(ch)) return true;
  if (ch !== '@' && ch !== '$') return false;
  return isIdentifierStart(source[index + 1]);
}

const CONTINUATION_TOKENS = new Set([
  '=', '+', '-', '*', '/', '%', '==', '!=', '>=', '<=', '&&', '||', '?', ':', ',', '.', '(', '[', '{',
]);

function endsWithContinuation(tokens: Token[]): boolean {
  const last = tokens[tokens.length - 1];
  return last !== undefined && CONTINUATION_TOKENS.has(last.value);
}

/** Splits on newlines that are not inside brackets and not a continuation. */
function splitStatements(tokens: Token[]): Token[][] {
  const groups: Token[][] = [];
  let current: Token[] = [];
  let depth = 0;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token.kind === 'newline') {
      if (depth > 0) continue;
      const next = tokens[index + 1];
      const continues = current.length > 0
        && (endsWithContinuation(current) || (next !== undefined && (next.value === '?' || next.value === ':')));
      if (current.length > 0 && !continues) {
        groups.push(current);
        current = [];
      }
      continue;
    }

    if (token.value === '(' || token.value === '[' || token.value === '{') depth += 1;
    else if (token.value === ')' || token.value === ']' || token.value === '}') depth = Math.max(0, depth - 1);

    current.push(token);
  }

  if (current.length > 0) groups.push(current);
  return groups;
}

class TokenCursor {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  peek(offset = 0): Token | undefined {
    return this.tokens[this.index + offset];
  }

  next(): Token | undefined {
    const token = this.tokens[this.index];
    if (token !== undefined) this.index += 1;
    return token;
  }

  atEnd(): boolean {
    return this.index >= this.tokens.length;
  }

  match(value: string): boolean {
    if (this.peek()?.value !== value) return false;
    this.index += 1;
    return true;
  }

  /** Consumes a closing token, tolerating end-of-input while streaming. */
  close(value: string): void {
    if (this.peek()?.value === value) this.index += 1;
  }
}

function parsePrimary(cursor: TokenCursor): UiExpr | null {
  const token = cursor.peek();
  if (token === undefined) return null;

  if (token.kind === 'number') {
    cursor.next();
    const value = Number(token.value);
    return { kind: 'literal', value: Number.isNaN(value) ? 0 : value };
  }

  if (token.kind === 'string') {
    cursor.next();
    return { kind: 'literal', value: token.value };
  }

  if (token.value === '(') {
    cursor.next();
    const inner = parseExpression(cursor);
    cursor.close(')');
    return inner;
  }

  if (token.value === '[') {
    cursor.next();
    const items: UiExpr[] = [];
    while (!cursor.atEnd() && cursor.peek()?.value !== ']') {
      const item = parseExpression(cursor);
      if (item !== null) items.push(item);
      if (!cursor.match(',')) break;
    }
    cursor.close(']');
    return { kind: 'array', items };
  }

  if (token.value === '{') {
    cursor.next();
    const entries: Array<{ key: string; value: UiExpr }> = [];
    while (!cursor.atEnd() && cursor.peek()?.value !== '}') {
      const keyToken = cursor.next();
      if (keyToken === undefined) break;
      const key = keyToken.value;
      let value: UiExpr | null = null;
      if (cursor.match(':')) {
        value = parseExpression(cursor);
      }
      entries.push({ key, value: value ?? { kind: 'literal', value: null } });
      if (!cursor.match(',')) break;
    }
    cursor.close('}');
    return { kind: 'object', entries };
  }

  if (token.kind === 'identifier') {
    cursor.next();
    const raw = token.value;

    if (raw === 'true') return { kind: 'literal', value: true };
    if (raw === 'false') return { kind: 'literal', value: false };
    if (raw === 'null') return { kind: 'literal', value: null };

    if (raw.startsWith('$')) {
      return { kind: 'state', name: raw.slice(1) };
    }

    const isFunction = raw.startsWith('@');
    const name = isFunction ? raw.slice(1) : raw;

    if (cursor.peek()?.value === '(') {
      const args = parseArguments(cursor);
      return { kind: 'call', name: isFunction ? `@${name}` : name, args };
    }

    return { kind: 'reference', name };
  }

  return null;
}

function parseArguments(cursor: TokenCursor): UiExpr[] {
  cursor.match('(');
  const args: UiExpr[] = [];
  while (!cursor.atEnd() && cursor.peek()?.value !== ')') {
    const arg = parseExpression(cursor);
    if (arg !== null) args.push(arg);
    if (!cursor.match(',')) break;
  }
  cursor.close(')');
  return args;
}

function parsePostfix(cursor: TokenCursor): UiExpr | null {
  let target = parsePrimary(cursor);
  if (target === null) return null;

  for (;;) {
    const token = cursor.peek();
    if (token === undefined) break;
    if (token.value === '.') {
      cursor.next();
      const name = cursor.next();
      if (name === undefined || name.kind !== 'identifier') break;
      target = { kind: 'member', target, name: name.value };
      continue;
    }
    if (token.value === '[') {
      cursor.next();
      const index = parseExpression(cursor);
      cursor.close(']');
      if (index === null) break;
      target = { kind: 'index', target, index };
      continue;
    }
    break;
  }

  return target;
}

function parseUnary(cursor: TokenCursor): UiExpr | null {
  const token = cursor.peek();
  if (token?.value === '!' || token?.value === '-') {
    cursor.next();
    const operand = parseUnary(cursor);
    if (operand === null) return null;
    return { kind: 'unary', operator: token.value, operand };
  }
  return parsePostfix(cursor);
}

function parseBinaryLevel(cursor: TokenCursor, level: number): UiExpr | null {
  if (level >= BINARY_LEVELS.length) return parseUnary(cursor);
  let left = parseBinaryLevel(cursor, level + 1);
  if (left === null) return null;
  const operators = BINARY_LEVELS[level];
  for (;;) {
    const token = cursor.peek();
    if (token === undefined || !operators.includes(token.value)) break;
    cursor.next();
    const right = parseBinaryLevel(cursor, level + 1);
    if (right === null) break;
    left = { kind: 'binary', operator: token.value, left, right };
  }
  return left;
}

/** Lowest precedence first. */
const BINARY_LEVELS: string[][] = [
  ['==', '!='],
  ['>', '<', '>=', '<='],
  ['+', '-'],
  ['*', '/', '%'],
  ['&&', '||'],
];

function parseExpression(cursor: TokenCursor): UiExpr | null {
  const test = parseBinaryLevel(cursor, 0);
  if (test === null) return null;
  if (cursor.peek()?.value !== '?') return test;
  cursor.next();
  const whenTrue = parseExpression(cursor);
  cursor.close(':');
  const whenFalse = parseExpression(cursor);
  if (whenTrue === null || whenFalse === null) return test;
  return { kind: 'ternary', test, whenTrue, whenFalse };
}

/** Parses a declarative UI program. Never throws. */
export function parseUiProgram(source: string): UiProgram {
  const program: UiProgram = { statements: new Map(), order: [], errors: [] };

  for (const group of splitStatements(tokenize(source))) {
    const nameToken = group[0];
    if (nameToken === undefined || nameToken.kind !== 'identifier') {
      program.errors.push(`unexpected statement start: ${nameToken?.value ?? ''}`);
      continue;
    }

    const assign = group[1];
    if (assign === undefined || assign.value !== '=') {
      program.errors.push(`missing '=' after ${nameToken.value}`);
      continue;
    }

    const raw = nameToken.value;
    const isState = raw.startsWith('$');
    const name = isState ? raw.slice(1) : raw;
    const cursor = new TokenCursor(group.slice(2));
    const expr = parseExpression(cursor);

    if (expr === null) {
      program.errors.push(`could not parse expression for ${name}`);
      program.statements.set(name, { name, state: isState, expr: null });
      program.order.push(name);
      continue;
    }

    program.statements.set(name, { name, state: isState, expr });
    program.order.push(name);
  }

  return program;
}

/** Root statement name, always `root` for this language. */
export const ROOT_STATEMENT = 'root';

export function getRootStatement(program: UiProgram): UiStatement | undefined {
  return program.statements.get(ROOT_STATEMENT);
}
