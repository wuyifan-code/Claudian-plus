/**
 * Evaluates parsed UI expressions.
 *
 * Kept free of DOM dependencies so it can be unit-tested in the node test
 * environment and reused by any renderer.
 */

import type { UiExpr, UiProgram } from './parser';

export interface ResolvedElement {
  type: 'element';
  name: string;
  /** Raw argument expressions, needed by components that bind to `$state`. */
  args: UiExpr[];
  /** Pre-evaluated argument values, positionally aligned with `args`. */
  values: unknown[];
}

export interface ResolvedAction {
  type: 'action';
  name: string;
  values: unknown[];
  /** State variables written by `@Set` / `@Reset` / `@Toggle`, resolved from the argument expressions. */
  targets?: string[];
}

export interface EvaluationScope {
  program: UiProgram;
  getState(name: string): unknown;
  cache: Map<string, unknown>;
  resolving: Set<string>;
  locals: Record<string, unknown> | null;
}

export function createScope(program: UiProgram, getState: (name: string) => unknown): EvaluationScope {
  return { program, getState, cache: new Map(), resolving: new Set(), locals: null };
}

const ACTION_NAMES = new Set([
  '@Set', '@Reset', '@Toggle', '@ToAssistant', '@OpenUrl', '@Copy', '@OpenNote', '@InsertToNote',
]);

/** Actions whose state-variable arguments name write targets. */
const STATE_WRITING_ACTIONS = new Set(['@Set', '@Reset', '@Toggle']);

/** `Action([@a, @b])` runs several action steps from one gesture. */
export const ACTION_SEQUENCE = 'Action';

export function truthy(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function compare(left: unknown, right: unknown): number {
  if (typeof left === 'string' && typeof right === 'string') {
    return left < right ? -1 : left > right ? 1 : 0;
  }
  const a = asNumber(left);
  const b = asNumber(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Shared number formatting for `@Format`, table columns and chart ticks. */
export function formatNumber(value: unknown, style?: unknown): string {
  const amount = asNumber(value);
  if (style === 'percent') return `${Math.round(amount * 10) / 10}%`;
  if (style === 'compact') {
    const abs = Math.abs(amount);
    if (abs >= 1e9) return `${Math.round(amount / 1e8) / 10}B`;
    if (abs >= 1e6) return `${Math.round(amount / 1e5) / 10}M`;
    if (abs >= 1e3) return `${Math.round(amount / 1e2) / 10}k`;
  }
  return amount.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

const FUNCTIONS: Record<string, (args: unknown[]) => unknown> = {
  '@Count': (args) => asList(args[0]).length,
  '@First': (args) => asList(args[0])[0] ?? null,
  '@Last': (args) => {
    const list = asList(args[0]);
    return list.length > 0 ? list[list.length - 1] : null;
  },
  '@Sum': (args) => asList(args[0]).reduce<number>((total, item) => total + asNumber(item), 0),
  '@Avg': (args) => {
    const list = asList(args[0]);
    if (list.length === 0) return 0;
    return list.reduce<number>((total, item) => total + asNumber(item), 0) / list.length;
  },
  '@Min': (args) => {
    const list = asList(args[0]);
    if (list.length === 0) return null;
    return Math.min(...list.map(asNumber));
  },
  '@Max': (args) => {
    const list = asList(args[0]);
    if (list.length === 0) return null;
    return Math.max(...list.map(asNumber));
  },
  '@Round': (args) => {
    const decimals = Math.max(0, Math.trunc(asNumber(args[1])));
    const factor = 10 ** decimals;
    return Math.round(asNumber(args[0]) * factor) / factor;
  },
  '@Abs': (args) => Math.abs(asNumber(args[0])),
  '@Floor': (args) => Math.floor(asNumber(args[0])),
  '@Ceil': (args) => Math.ceil(asNumber(args[0])),
  '@Clamp': (args) => Math.min(Math.max(asNumber(args[0]), asNumber(args[1])), asNumber(args[2])),
  '@Default': (args) => {
    const value = args[0];
    return value === null || value === undefined || value === '' ? args[1] ?? null : value;
  },
  '@Percent': (args) => {
    const total = asNumber(args[1]);
    if (total === 0) return 0;
    return Math.round((asNumber(args[0]) / total) * 1000) / 10;
  },
  '@Format': (args) => formatNumber(args[0], args[1]),
  '@Plural': (args) => {
    const amount = asNumber(args[0]);
    const singular = typeof args[1] === 'string' ? args[1] : '';
    const plural = typeof args[2] === 'string' ? args[2] : `${singular}s`;
    return `${amount} ${amount === 1 ? singular : plural}`;
  },
  '@Join': (args) => asList(args[0]).map((item) => String(item)).join(typeof args[1] === 'string' ? args[1] : ', '),
  '@Split': (args) => String(args[0] ?? '').split(typeof args[1] === 'string' ? args[1] : ','),
  '@Contains': (args) => {
    const haystack = args[0];
    if (Array.isArray(haystack)) return haystack.includes(args[1]);
    if (typeof haystack === 'string') return haystack.includes(String(args[1] ?? ''));
    return false;
  },
  '@Range': (args) => {
    const start = Math.trunc(asNumber(args[0]));
    const end = Math.trunc(asNumber(args[1]));
    const step = end >= start ? 1 : -1;
    const result: number[] = [];
    for (let value = start; value < end; value += step) result.push(value);
    return result;
  },
  '@Upper': (args) => String(args[0] ?? '').toUpperCase(),
  '@Lower': (args) => String(args[0] ?? '').toLowerCase(),
  '@Sort': (args) => {
    const field = typeof args[1] === 'string' ? args[1] : '';
    const direction = args[2] === 'desc' ? -1 : 1;
    const read = (item: unknown): unknown => (
      field && item !== null && typeof item === 'object' ? (item as Record<string, unknown>)[field] : item
    );
    return [...asList(args[0])].sort((a, b) => compare(read(a), read(b)) * direction);
  },
  '@Filter': (args) => {
    const field = typeof args[1] === 'string' ? args[1] : '';
    const operator = typeof args[2] === 'string' ? args[2] : '==';
    const expected = args[3];
    const read = (item: unknown): unknown => (
      field && item !== null && typeof item === 'object' ? (item as Record<string, unknown>)[field] : item
    );
    return asList(args[0]).filter((item) => {
      const actual = read(item);
      switch (operator) {
        case '!=':
          return actual !== expected;
        case '>':
          return compare(actual, expected) > 0;
        case '<':
          return compare(actual, expected) < 0;
        case '>=':
          return compare(actual, expected) >= 0;
        case '<=':
          return compare(actual, expected) <= 0;
        case 'contains':
          return Array.isArray(actual) ? actual.includes(expected) : String(actual ?? '').includes(String(expected ?? ''));
        default:
          return actual === expected;
      }
    });
  },
};

function evaluateEach(args: UiExpr[], scope: EvaluationScope): unknown {
  const list = asList(evaluate(args[0], scope));
  const varName = evaluate(args[1], scope);
  const template = args[2];
  if (template === undefined) return [];
  if (typeof varName !== 'string') return [];

  const previousLocals = scope.locals;
  try {
    return list.map((item, index) => {
      scope.locals = { ...(previousLocals ?? {}), [varName]: item, [`${varName}Index`]: index };
      return evaluate(template, scope);
    });
  } finally {
    scope.locals = previousLocals;
  }
}

function resolveStateDefault(name: string, scope: EvaluationScope): unknown {
  const declaration = scope.program.states.get(name);
  return declaration === undefined ? null : evaluate(declaration, scope);
}

function evaluateReference(name: string, scope: EvaluationScope): unknown {
  if (scope.locals !== null && Object.prototype.hasOwnProperty.call(scope.locals, name)) {
    return scope.locals[name];
  }

  if (scope.cache.has(name)) return scope.cache.get(name);
  if (scope.resolving.has(name)) return null;

  const statement = scope.program.statements.get(name);
  if (statement === undefined || statement.expr === null) return null;

  scope.resolving.add(name);
  try {
    const value = evaluate(statement.expr, scope);
    scope.cache.set(name, value);
    return value;
  } finally {
    scope.resolving.delete(name);
  }
}

function evaluateCall(name: string, args: UiExpr[], scope: EvaluationScope): unknown {
  if (ACTION_NAMES.has(name)) {
    const values = args.map((arg) => evaluate(arg, scope));
    const action: ResolvedAction = { type: 'action', name, values };
    // `@Set($x, v)` / `@Reset($x, $y)` / `@Toggle($x)` name their targets;
    // the evaluated value alone would lose which variable is written.
    if (STATE_WRITING_ACTIONS.has(name)) {
      const targetArgs = name === '@Set' ? args.slice(0, 1) : args;
      action.targets = targetArgs
        .map((arg) => readActionTarget(arg))
        .filter((target): target is string => target !== null);
    }
    return action;
  }

  if (name === '@Each') {
    return evaluateEach(args, scope);
  }

  const fn = FUNCTIONS[name];
  if (fn === undefined) return null;

  return fn(args.map((arg) => evaluate(arg, scope)));
}

/** Evaluates one expression. Never throws; unknown constructs yield null. */
export function evaluate(expr: UiExpr, scope: EvaluationScope): unknown {
  switch (expr.kind) {
    case 'literal':
      return expr.value;

    case 'array':
      return expr.items.map((item) => evaluate(item, scope));

    case 'object': {
      const result: Record<string, unknown> = {};
      for (const entry of expr.entries) result[entry.key] = evaluate(entry.value, scope);
      return result;
    }

    case 'state': {
      const stored = scope.getState(expr.name);
      return stored === undefined ? resolveStateDefault(expr.name, scope) : stored;
    }

    case 'reference':
      return evaluateReference(expr.name, scope);

    case 'member': {
      const target = evaluate(expr.target, scope);
      if (Array.isArray(target)) {
        return target.map((item) => (
          item !== null && typeof item === 'object' ? (item as Record<string, unknown>)[expr.name] : null
        ));
      }
      if (target !== null && typeof target === 'object') {
        return (target as Record<string, unknown>)[expr.name];
      }
      return null;
    }

    case 'index': {
      const target = evaluate(expr.target, scope);
      const index = evaluate(expr.index, scope);
      if (Array.isArray(target)) {
        const position = Math.trunc(asNumber(index));
        return target[position < 0 ? target.length + position : position];
      }
      if (typeof target === 'string') return target[Math.trunc(asNumber(index))] ?? null;
      if (target !== null && typeof target === 'object') {
        return (target as Record<string, unknown>)[String(index)];
      }
      return null;
    }

    case 'unary': {
      const operand = evaluate(expr.operand, scope);
      return expr.operator === '!' ? !truthy(operand) : -asNumber(operand);
    }

    case 'binary': {
      const left = evaluate(expr.left, scope);
      if (expr.operator === '&&') return truthy(left) ? evaluate(expr.right, scope) : left;
      if (expr.operator === '||') return truthy(left) ? left : evaluate(expr.right, scope);

      const right = evaluate(expr.right, scope);
      switch (expr.operator) {
        case '+':
          if (typeof left === 'string' || typeof right === 'string') return `${left ?? ''}${right ?? ''}`;
          return asNumber(left) + asNumber(right);
        case '-':
          return asNumber(left) - asNumber(right);
        case '*':
          return asNumber(left) * asNumber(right);
        case '/':
          return asNumber(right) === 0 ? 0 : asNumber(left) / asNumber(right);
        case '%':
          return asNumber(right) === 0 ? 0 : asNumber(left) % asNumber(right);
        case '==':
          return left === right;
        case '!=':
          return left !== right;
        case '>':
          return compare(left, right) > 0;
        case '<':
          return compare(left, right) < 0;
        case '>=':
          return compare(left, right) >= 0;
        case '<=':
          return compare(left, right) <= 0;
        default:
          return null;
      }
    }

    case 'ternary':
      return truthy(evaluate(expr.test, scope))
        ? evaluate(expr.whenTrue, scope)
        : evaluate(expr.whenFalse, scope);

    case 'call': {
      if (expr.name.startsWith('@')) {
        return evaluateCall(expr.name, expr.args, scope);
      }
      if (expr.name === ACTION_SEQUENCE) {
        const steps = expr.args[0] === undefined ? [] : asList(evaluate(expr.args[0], scope));
        return { type: 'action', name: ACTION_SEQUENCE, values: [steps] } satisfies ResolvedAction;
      }
      return {
        type: 'element',
        name: expr.name,
        args: expr.args,
        values: expr.args.map((arg) => evaluate(arg, scope)),
      };
    }

    default:
      return null;
  }
}

/** Establishes which state variable an action writes, if any. */
export function readActionTarget(expr: UiExpr | undefined): string | null {
  if (expr !== undefined && expr.kind === 'state') return expr.name;
  return null;
}

/** Converts an evaluated value to display text. */
export function toDisplayText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(toDisplayText).join(', ');
  return '';
}
