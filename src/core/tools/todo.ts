/**
 * Todo tool helpers.
 *
 * Parses TodoWrite tool input into typed todo items.
 */

export interface TodoItem {
  /** Imperative description (e.g., "Run tests") */
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  /** Present continuous form (e.g., "Running tests") */
  activeForm: string;
}

function isValidTodoItem(item: unknown): item is TodoItem {
  if (typeof item !== 'object' || item === null) return false;
  const record = item as Record<string, unknown>;
  return (
    typeof record.content === 'string' &&
    record.content.length > 0 &&
    typeof record.activeForm === 'string' &&
    record.activeForm.length > 0 &&
    typeof record.status === 'string' &&
    ['pending', 'in_progress', 'completed'].includes(record.status)
  );
}

export function parseTodoInput(input: Record<string, unknown>): TodoItem[] | null {
  if (!input.todos || !Array.isArray(input.todos)) {
    return null;
  }

  const validTodos: TodoItem[] = [];
  for (const item of input.todos) {
    if (isValidTodoItem(item)) {
      validTodos.push(item);
    }
  }

  return validTodos.length > 0 ? validTodos : null;
}
