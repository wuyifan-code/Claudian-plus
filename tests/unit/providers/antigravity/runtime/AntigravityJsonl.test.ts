import * as fs from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';

import {
  AntigravityJsonlLimitError,
  type AntigravityJsonlOptions,
  type AntigravityJsonlRecord,
  parseAntigravityJsonlStream,
} from '@/providers/antigravity/runtime/AntigravityJsonl';

const FIXTURES_DIR = path.join(__dirname, '..', '..', '..', '..', 'fixtures', 'antigravity', 'jsonl');

function readFixtureBytes(name: string): Buffer {
  return fs.readFileSync(path.join(FIXTURES_DIR, name));
}

function toByteStream(...chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  return (async function* () {
    for (const chunk of chunks) {
      yield chunk;
    }
  })();
}

function textChunk(content: string): Buffer {
  return Buffer.from(content, 'utf8');
}

function sliceBuffer(buffer: Buffer, cutPoints: number[]): Buffer[] {
  const bounds = [0, ...cutPoints, buffer.length];
  const chunks: Buffer[] = [];
  for (let index = 0; index < bounds.length - 1; index += 1) {
    const start = bounds[index];
    const end = bounds[index + 1];
    if (end > start) {
      chunks.push(buffer.subarray(start, end));
    }
  }
  return chunks;
}

async function collect(
  source: AsyncIterable<Uint8Array>,
  options?: AntigravityJsonlOptions,
): Promise<AntigravityJsonlRecord[]> {
  const records: AntigravityJsonlRecord[] = [];
  for await (const record of parseAntigravityJsonlStream(source, options)) {
    records.push(record);
  }
  return records;
}

function expectAllParsed(records: AntigravityJsonlRecord[]): void {
  for (const record of records) {
    expect(record.kind).toBe('parsed');
    if (record.kind !== 'parsed') {
      throw new Error('unreachable: record narrowed as parsed');
    }
    expect(typeof record.raw).toBe('string');
    expect(typeof record.parsed).toBe('object');
    expect(record.parsed).not.toBeNull();
  }
}

function expectErrorRecord(record: AntigravityJsonlRecord): string {
  expect(record.kind).toBe('error');
  if (record.kind !== 'error') {
    throw new Error('unreachable: record narrowed as error');
  }
  return record.error;
}

function nodeReadable(chunks: Uint8Array[]): Readable {
  const readable = new Readable({ read() {} });
  for (const chunk of chunks) {
    readable.push(chunk);
  }
  readable.push(null);
  return readable;
}

describe('parseAntigravityJsonlStream', () => {
  it('parses the captured turn1 stream into ordered parsed records', async () => {
    const records = await collect(toByteStream(readFixtureBytes('turn1-ready.ndjson')));

    expect(records).toHaveLength(5);
    expectAllParsed(records);
    const events = records.map((record) => (record.kind === 'parsed' ? record.parsed.event : null));
    expect(events).toEqual(['init', 'step_update', 'step_update', 'step_update', 'result']);

    const init = records[0].kind === 'parsed' ? records[0].parsed : null;
    expect(init).toMatchObject({
      event: 'init',
      conversation_id: 'e848aee0-50a4-4889-9b1b-697878871fa2',
    });
    const result = records[4].kind === 'parsed' ? records[4].parsed : null;
    expect(result).toMatchObject({ event: 'result' });
    expect((result as { result?: { response?: unknown } }).result?.response).toBe('READY\n');
  });

  it('produces identical records when the fixture arrives in 64-byte slices', async () => {
    const fixtureBytes = readFixtureBytes('turn1-ready.ndjson');
    const whole = await collect(toByteStream(fixtureBytes));
    const sliced = await collect(toByteStream(...sliceBuffer(fixtureBytes, [])));

    const sixtyFourByteSlices: Buffer[] = [];
    for (let offset = 0; offset < fixtureBytes.length; offset += 64) {
      sixtyFourByteSlices.push(fixtureBytes.subarray(offset, offset + 64));
    }
    const slicedByChunks = await collect(toByteStream(...sixtyFourByteSlices));

    expect(slicedByChunks).toEqual(whole);
    expect(sliced).toEqual(whole);
    expect(whole.length).toBeGreaterThan(0);
  });

  it('passes through unknown event types and unexpected extra fields untouched', async () => {
    const line = '{"event":"future_event","future_payload":{"opaque":[1,2,3]},"extra":true}';
    const records = await collect(toByteStream(textChunk(`${line}\n`)));

    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.kind).toBe('parsed');
    if (record.kind !== 'parsed') {
      throw new Error('unreachable: record narrowed as parsed');
    }
    expect(record.parsed).toEqual({
      event: 'future_event',
      future_payload: { opaque: [1, 2, 3] },
      extra: true,
    });
    expect(record.raw).toBe(line);
  });

  it('parses the A0 error envelope even though it has no event field', async () => {
    const records = await collect(toByteStream(readFixtureBytes('error-envelope.ndjson')));

    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.kind).toBe('parsed');
    if (record.kind !== 'parsed') {
      throw new Error('unreachable: record narrowed as parsed');
    }
    expect(record.parsed.status).toBe('ERROR');
    expect(record.parsed.event).toBeUndefined();
  });

  it('recombines a single JSON record split across several chunks', async () => {
    const line =
      '{"event":"result","result":{"conversation_id":"e848aee0-50a4-4889-9b1b-697878871fa2",' +
      '"status":"SUCCESS","response":"READY\\n","duration_seconds":3.2407131,"num_turns":1,' +
      '"usage":{"input_tokens":28081,"output_tokens":1,"thinking_tokens":0,' +
      '"cache_read_tokens":0,"total_tokens":28082}}}';
    const buffer = textChunk(line);
    const chunks = sliceBuffer(buffer, [1, 17, 40, 90, 140, buffer.length - 3]);
    expect(chunks.length).toBeGreaterThanOrEqual(6);

    const records = await collect(toByteStream(...chunks));

    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.kind).toBe('parsed');
    if (record.kind !== 'parsed') {
      throw new Error('unreachable: record narrowed as parsed');
    }
    expect(record.parsed.event).toBe('result');
    expect(record.raw).toBe(line);
  });

  it('decodes UTF-8 multibyte characters split across chunk boundaries', async () => {
    const line = '{"event":"step_update","step_update":{"text_delta":"你好🌍ok"}}';
    const buffer = textChunk(line);
    const firstCut = buffer.indexOf(textChunk('你')) + 1;
    const secondCut = buffer.indexOf(textChunk('🌍')) + 2;
    expect(buffer.subarray(firstCut, firstCut + 1)).not.toEqual(textChunk('你'));

    const records = await collect(
      toByteStream(buffer.subarray(0, firstCut), buffer.subarray(firstCut, secondCut), buffer.subarray(secondCut)),
    );

    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.kind).toBe('parsed');
    if (record.kind !== 'parsed') {
      throw new Error('unreachable: record narrowed as parsed');
    }
    const stepUpdate = record.parsed.step_update as { text_delta?: unknown };
    expect(stepUpdate.text_delta).toBe('你好🌍ok');
  });

  it('parses the synthetic multibyte and unknown-event fixture', async () => {
    const records = await collect(toByteStream(readFixtureBytes('synthetic-unicode.ndjson')));

    expect(records).toHaveLength(2);
    expectAllParsed(records);
    const first = records[0];
    if (first.kind !== 'parsed') {
      throw new Error('unreachable: record narrowed as parsed');
    }
    const stepUpdate = first.parsed.step_update as { text_delta?: unknown };
    expect(stepUpdate.text_delta).toBe('你好，🌍 — synthetic multibyte sample');
  });

  it('tolerates CRLF line endings and strips the carriage return from raw', async () => {
    const first = '{"event":"init","conversation_id":"c1"}';
    const second = '{"event":"result"}';
    const records = await collect(toByteStream(textChunk(`${first}\r\n${second}\r\n`)));

    expect(records).toHaveLength(2);
    expectAllParsed(records);
    const firstRecord = records[0];
    const secondRecord = records[1];
    if (firstRecord.kind !== 'parsed' || secondRecord.kind !== 'parsed') {
      throw new Error('unreachable: records narrowed as parsed');
    }
    expect(firstRecord.raw).toBe(first);
    expect(secondRecord.raw).toBe(second);
  });

  it('emits the final line when the stream ends without a trailing newline', async () => {
    const line = '{"event":"result","result":{"status":"SUCCESS"}}';
    const records = await collect(toByteStream(textChunk('{"event":"init"}\n'), textChunk(line)));

    expect(records).toHaveLength(2);
    const secondRecord = records[1];
    if (secondRecord.kind !== 'parsed') {
      throw new Error('unreachable: record narrowed as parsed');
    }
    expect(secondRecord.raw).toBe(line);
    expect(secondRecord.parsed).toEqual({
      event: 'result',
      result: { status: 'SUCCESS' },
    });
  });

  it('skips empty and whitespace-only lines without emitting records', async () => {
    const records = await collect(
      toByteStream(textChunk('\n\n{"event":"init"}\n   \n\t\n{"event":"result"}\n\n')),
    );

    expect(records).toHaveLength(2);
    expectAllParsed(records);
  });

  it('emits nothing for an empty stream or a stream that only contains newlines', async () => {
    expect(await collect(toByteStream())).toEqual([]);
    expect(await collect(toByteStream(textChunk('\n')))).toEqual([]);
    expect(await collect(toByteStream(textChunk('\r\n')))).toEqual([]);
  });

  it('reports malformed JSON as an error record that preserves the raw line', async () => {
    const fixtureBytes = readFixtureBytes('malformed.ndjson');
    const records = await collect(toByteStream(fixtureBytes));

    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.kind).toBe('error');
    if (record.kind !== 'error') {
      throw new Error('unreachable: record narrowed as error');
    }
    expect(record.raw).toBe('{"event":"result", BROKEN');
    expect(record.error).toMatch(/^Line 1:/);
    expect('parsed' in record).toBe(false);
  });

  it('reports valid JSON that is not an object as an error record', async () => {
    const records = await collect(
      toByteStream(textChunk('42\n"text"\nnull\n[1,2]\ntrue\n{"event":"init"}\n')),
    );

    expect(records).toHaveLength(6);
    for (let index = 0; index < 5; index += 1) {
      expect(expectErrorRecord(records[index])).toContain('expected a JSON object');
    }
    expect(records[5].kind).toBe('parsed');
  });

  it('counts physical lines, including skipped blank lines, in parse error messages', async () => {
    const records = await collect(toByteStream(textChunk('{"event":"init"}\n\nnot json\n')));

    expect(records).toHaveLength(2);
    expect(expectErrorRecord(records[1])).toMatch(/^Line 3:/);
  });

  it('throws a typed limit error when a line exceeds maxLineLength', async () => {
    const makeSource = () =>
      toByteStream(textChunk('{"a":1}\n'), textChunk(`{"long":"${'x'.repeat(40)}"}\n`));

    await expect(collect(makeSource(), { maxLineLength: 16 })).rejects.toBeInstanceOf(
      AntigravityJsonlLimitError,
    );
    await expect(collect(makeSource(), { maxLineLength: 16 })).rejects.toMatchObject({
      reason: 'max-line-length',
      limit: 16,
    });
  });

  it('accepts a line of exactly maxLineLength characters', async () => {
    const records = await collect(toByteStream(textChunk('{"abc":1234}\n')), { maxLineLength: 12 });

    expect(records).toHaveLength(1);
    expect(records[0].kind).toBe('parsed');
  });

  it('throws a typed limit error when pending bytes exceed maxBufferBytes', async () => {
    const makeSource = () => toByteStream(textChunk('{"a":12345}'));
    await expect(collect(makeSource(), { maxBufferBytes: 10 })).rejects.toBeInstanceOf(
      AntigravityJsonlLimitError,
    );
    await expect(collect(makeSource(), { maxBufferBytes: 10 })).rejects.toMatchObject({
      reason: 'max-buffer-bytes',
      limit: 10,
    });
  });

  it('accepts pending bytes of exactly maxBufferBytes', async () => {
    const records = await collect(toByteStream(textChunk('{"a":1234}')), { maxBufferBytes: 10 });

    expect(records).toHaveLength(1);
    expect(records[0].kind).toBe('parsed');
  });

  it('delivers complete lines before applying the buffer cap', async () => {
    const seen: AntigravityJsonlRecord[] = [];
    const source = toByteStream(textChunk('{"a":1}\n'), textChunk('x'.repeat(40)));

    await expect(
      (async () => {
        for await (const record of parseAntigravityJsonlStream(source, { maxBufferBytes: 16 })) {
          seen.push(record);
        }
      })(),
    ).rejects.toBeInstanceOf(AntigravityJsonlLimitError);

    expect(seen).toHaveLength(1);
    expect(seen[0].kind).toBe('parsed');
  });

  it('accepts a Node Readable stream as the byte source', async () => {
    const fixtureBytes = readFixtureBytes('stdin-startup.ndjson');
    const records = await collect(nodeReadable([fixtureBytes]));

    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.kind).toBe('parsed');
    if (record.kind !== 'parsed') {
      throw new Error('unreachable: record narrowed as parsed');
    }
    expect(record.parsed.event).toBe('init');
    expect(record.parsed.conversation_id).toBe('3471b9f1-8492-4609-ace9-c99957f74c07');
  });

  it('uses defaults that accept the real init event without configuration', async () => {
    const records = await collect(toByteStream(readFixtureBytes('stdin-startup.ndjson')));

    expect(records).toHaveLength(1);
    expect(records[0].kind).toBe('parsed');
  });

  it('rejects chunks that are not byte arrays', async () => {
    const makeSource = () =>
      (async function* () {
        yield 'not bytes' as unknown as Uint8Array;
      })();

    await expect(collect(makeSource())).rejects.toThrow(TypeError);
    await expect(collect(makeSource())).rejects.toThrow(/Uint8Array/);
  });

  it('rejects invalid option values with a RangeError', async () => {
    await expect(collect(toByteStream(textChunk('{"a":1}\n')), { maxLineLength: 0 })).rejects.toBeInstanceOf(
      RangeError,
    );
    await expect(collect(toByteStream(textChunk('{"a":1}\n')), { maxBufferBytes: 1.5 })).rejects.toBeInstanceOf(
      RangeError,
    );
    await expect(
      collect(toByteStream(textChunk('{"a":1}\n')), { maxLineLength: Number.NaN }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it('keeps limit errors distinct from parse errors', async () => {
    const malformedRecords = await collect(toByteStream(textChunk('not json\n')));
    expect(malformedRecords).toHaveLength(1);
    expect(malformedRecords[0].kind).toBe('error');

    await expect(collect(toByteStream(textChunk('{"a":1}\n')), { maxLineLength: 2 })).rejects.toBeInstanceOf(
      AntigravityJsonlLimitError,
    );
  });
});
