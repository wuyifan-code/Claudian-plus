/**
 * Turn the low-level errors emitted by child_process.spawn into a message that
 * tells the user what to fix.  In particular, ENOENT is otherwise rendered as
 * a cryptic "spawn ... ENOENT" error in the chat stream.
 */
export function formatProcessStartError(
  error: unknown,
  runtimeName: string,
  command: string,
): Error {
  const source = error instanceof Error ? error : new Error(String(error));
  const code = (source as NodeJS.ErrnoException).code;
  const executable = command.trim() || 'the configured executable';

  if (code === 'ENOENT') {
    return new Error(
      `${runtimeName} could not start because the executable "${executable}" was not found. `
      + `Install ${runtimeName} or set its full CLI path in Claudian Plus settings.`,
      { cause: source },
    );
  }

  if (code === 'EACCES') {
    return new Error(
      `${runtimeName} could not start because the executable "${executable}" is not accessible. `
      + 'Check its permissions or choose a different CLI path in Claudian Plus settings.',
      { cause: source },
    );
  }

  const detail = source.message.trim();
  return new Error(
    `${runtimeName} failed to start${detail ? `: ${detail}` : '.'}`,
    { cause: source },
  );
}
