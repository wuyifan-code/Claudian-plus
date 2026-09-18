import { Buffer } from 'node:buffer';
import { StringDecoder } from 'node:string_decoder';

/**
 * Dependency-free NDJSON reader for the Antigravity CLI's `--output-format stream-json`
 * stdout. It turns any byte stream (a Node `Readable` is one) into per-line records and
 * deliberately knows nothing about Antigravity event semantics — event validation and
 * state transitions belong to the normalization/turn-state layer.
 *
 * UTF-8 safety: bytes are accumulated at the byte level and a line is decoded only once
 * it is complete, so a multi-byte character split across chunks (or even across the
 * newline scan, which is byte-safe because 0x0A never occurs inside a multi-byte UTF-8
 * sequence) is decoded as one unit. Per-chunk `toString()` concatenation is not used.
 *
 * Error model: a corrupt line is a record (`{ kind: 'error' }`); exceeding a configured
 * limit throws `AntigravityJsonlLimitError`, so callers can distinguish a protocol/budget
 * problem from a single corrupt line. A limit never truncates into a fake valid record.
 */

const LINE_FEED = 0x0a;

export const DEFAULT_ANTIGRAVITY_JSONL_MAX_LINE_LENGTH = 1_048_576;
export const DEFAULT_ANTIGRAVITY_JSONL_MAX_BUFFER_BYTES = 4_194_304;

export type AntigravityJsonlLimitReason = 'max-line-length' | 'max-buffer-bytes';

export class AntigravityJsonlLimitError extends Error {
  readonly reason: AntigravityJsonlLimitReason;
  readonly limit: number;

  constructor(reason: AntigravityJsonlLimitReason, limit: number, message: string) {
    super(message);
    this.name = 'AntigravityJsonlLimitError';
    this.reason = reason;
    this.limit = limit;
  }
}

export interface AntigravityJsonlOptions {
  /** Maximum decoded characters per line. Must be a positive integer. */
  maxLineLength?: number;
  /** Maximum bytes buffered while a line is still incomplete. Must be a positive integer. */
  maxBufferBytes?: number;
}

export type AntigravityJsonlParsedRecord = {
  kind: 'parsed';
  raw: string;
  parsed: Record<string, unknown>;
};

export type AntigravityJsonlErrorRecord = {
  kind: 'error';
  raw: string;
  error: string;
};

export type AntigravityJsonlRecord = AntigravityJsonlParsedRecord | AntigravityJsonlErrorRecord;

export async function* parseAntigravityJsonlStream(
  source: AsyncIterable<Uint8Array>,
  options: AntigravityJsonlOptions = {},
): AsyncGenerator<AntigravityJsonlRecord, void, undefined> {
  const maxLineLength = resolveLimit(
    'maxLineLength',
    options.maxLineLength,
    DEFAULT_ANTIGRAVITY_JSONL_MAX_LINE_LENGTH,
  );
  const maxBufferBytes = resolveLimit(
    'maxBufferBytes',
    options.maxBufferBytes,
    DEFAULT_ANTIGRAVITY_JSONL_MAX_BUFFER_BYTES,
  );

  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let lineNumber = 0;

  const emitLine = (lineBytes: Uint8Array): AntigravityJsonlRecord | null => {
    lineNumber += 1;
    const line = stripTrailingCarriageReturn(decodeUtf8Span(lineBytes));
    if (line.trim().length === 0) {
      return null;
    }
    if (line.length > maxLineLength) {
      throw new AntigravityJsonlLimitError(
        'max-line-length',
        maxLineLength,
        `Line ${lineNumber}: decoded line is ${line.length} characters, exceeding maxLineLength (${maxLineLength})`,
      );
    }
    try {
      const parsed: unknown = JSON.parse(line);
      if (!isJsonObject(parsed)) {
        return {
          kind: 'error',
          raw: line,
          error: `Line ${lineNumber}: expected a JSON object, got ${describeJsonType(parsed)}`,
        };
      }
      return { kind: 'parsed', raw: line, parsed };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { kind: 'error', raw: line, error: `Line ${lineNumber}: ${message}` };
    }
  };

  for await (const chunk of source) {
    if (!(chunk instanceof Uint8Array)) {
      throw new TypeError(
        `AntigravityJsonl: expected Uint8Array chunks from the byte source, received ${typeof chunk}`,
      );
    }

    let offset = 0;
    while (offset < chunk.length) {
      const feedIndex = findLineFeed(chunk, offset);
      if (feedIndex < 0) {
        break;
      }
      const lineBytes = pending.length
        ? Buffer.concat([...pending, chunk.subarray(offset, feedIndex)])
        : chunk.subarray(offset, feedIndex);
      pending = [];
      pendingBytes = 0;
      const record = emitLine(lineBytes);
      if (record) {
        yield record;
      }
      offset = feedIndex + 1;
    }

    if (offset < chunk.length) {
      const remainder = chunk.subarray(offset);
      pending.push(remainder);
      pendingBytes += remainder.length;
      if (pendingBytes > maxBufferBytes) {
        throw new AntigravityJsonlLimitError(
          'max-buffer-bytes',
          maxBufferBytes,
          `Line ${lineNumber + 1}: buffered ${pendingBytes} bytes without a line terminator, exceeding maxBufferBytes (${maxBufferBytes})`,
        );
      }
    }
  }

  if (pending.length > 0) {
    const record = emitLine(Buffer.concat(pending));
    if (record) {
      yield record;
    }
  }
}

function findLineFeed(bytes: Uint8Array, from: number): number {
  for (let index = from; index < bytes.length; index += 1) {
    if (bytes[index] === LINE_FEED) {
      return index;
    }
  }
  return -1;
}

function decodeUtf8Span(bytes: Uint8Array): string {
  const decoder = new StringDecoder('utf8');
  const view = Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoded = decoder.write(view);
  const tail = decoder.end();
  return tail.length > 0 ? decoded + tail : decoded;
}

function stripTrailingCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeJsonType(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
}

function resolveLimit(
  name: 'maxLineLength' | 'maxBufferBytes',
  value: number | undefined,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`AntigravityJsonl: ${name} must be a positive integer, received ${String(value)}`);
  }
  return value;
}
