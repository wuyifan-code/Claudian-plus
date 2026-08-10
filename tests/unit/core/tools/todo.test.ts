import { parseTodoInput } from '@/core/tools/todo';

describe('parseTodoInput', () => {
  it('should parse valid todo items', () => {
    const input = {
      todos: [
        { content: 'Run tests', status: 'pending', activeForm: 'Running tests' },
        { content: 'Fix bug', status: 'in_progress', activeForm: 'Fixing bug' },
        { content: 'Deploy', status: 'completed', activeForm: 'Deploying' },
      ],
    };

    const result = parseTodoInput(input);

    expect(result).toHaveLength(3);
    expect(result![0]).toEqual({ content: 'Run tests', status: 'pending', activeForm: 'Running tests' });
    expect(result![1].status).toBe('in_progress');
    expect(result![2].status).toBe('completed');
  });

  it('should return null when todos key is missing', () => {
    expect(parseTodoInput({})).toBeNull();
  });

  it('should return null when todos is not an array', () => {
    expect(parseTodoInput({ todos: 'not an array' })).toBeNull();
    expect(parseTodoInput({ todos: 42 })).toBeNull();
    expect(parseTodoInput({ todos: null })).toBeNull();
  });

  it('should filter out invalid items', () => {
    const input = {
      todos: [
        { content: 'Valid', status: 'pending', activeForm: 'Working' },
        { content: '', status: 'pending', activeForm: 'Working' }, // empty content
        { content: 'No status', activeForm: 'Working' }, // missing status
        { content: 'Bad status', status: 'unknown', activeForm: 'Working' }, // invalid status
        null,
        42,
        'string',
      ],
    };

    const result = parseTodoInput(input);

    expect(result).toHaveLength(1);
    expect(result![0].content).toBe('Valid');
  });

  it('should return null when all items are invalid', () => {
    const input = {
      todos: [
        { content: '', status: 'pending', activeForm: 'Working' },
        null,
        { status: 'pending' }, // missing content and activeForm
      ],
    };

    expect(parseTodoInput(input)).toBeNull();
  });

  it('should return null for empty todos array', () => {
    expect(parseTodoInput({ todos: [] })).toBeNull();
  });

  it('should reject items with missing activeForm', () => {
    const input = {
      todos: [
        { content: 'Task', status: 'pending' }, // no activeForm
      ],
    };

    expect(parseTodoInput(input)).toBeNull();
  });

  it('should reject items with empty activeForm', () => {
    const input = {
      todos: [
        { content: 'Task', status: 'pending', activeForm: '' },
      ],
    };

    expect(parseTodoInput(input)).toBeNull();
  });

  it('should reject non-object items', () => {
    const input = {
      todos: [undefined, false, 0],
    };

    expect(parseTodoInput(input)).toBeNull();
  });
});
