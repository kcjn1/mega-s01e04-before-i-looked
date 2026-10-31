import * as fs from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readNight } from '../src/digest/reader.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

const night = '2026-10-28';
const event = { at: '2026-10-28T23:00:00+01:00', job: 'lane/sync', status: 'ok', owner: 'rook' };
let runsDir: string;

beforeEach(() => {
  runsDir = fs.mkdtempSync(join(import.meta.dirname, '.reader-'));
});

afterEach(() => {
  vi.resetAllMocks();
  fs.rmSync(runsDir, { recursive: true, force: true });
});

function writeEvents(events: unknown[]) {
  fs.writeFileSync(join(runsDir, `${night}.jsonl`), events.map((value) => JSON.stringify(value)).join('\n'));
}

describe('readNight', () => {
  it('aggregates the supplied fixture, including events after midnight and recorded errors', () => {
    const digest = readNight(join(import.meta.dirname, '../runs'), night);
    expect(digest).toEqual({
      night, badLines: 1, counts: { ok: 10, retry: 4, fail: 1 },
      rows: [
        {
          job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00',
        },
        {
          job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503',
          firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
        },
        {
          job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held',
          firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00',
        },
        {
          job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'quota exceeded',
          firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00',
        },
        {
          job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00',
        },
      ],
    });
  });

  it('returns null for a missing file or missing runs directory', () => {
    expect(readNight(runsDir, night)).toBeNull();
    expect(readNight(join(runsDir, 'missing'), night)).toBeNull();
  });

  it.each(['', ' \n\r\n\t\n'])('returns an empty digest for empty or blank input %j', (contents) => {
    fs.writeFileSync(join(runsDir, `${night}.jsonl`), contents);
    expect(readNight(runsDir, night)).toEqual({
      night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('counts each malformed nonblank line once without losing valid surrounding events', () => {
    const invalid: unknown[] = [
      null, [], 42, 'text', true, {},
      { ...event, job: '' }, { ...event, job: null }, { ...event, job: 3 },
      { ...event, owner: undefined }, { ...event, owner: 3 }, { ...event, owner: {} },
      { ...event, status: undefined }, { ...event, status: 'success' },
      { ...event, error: null }, { ...event, error: 42 },
      { ...event, at: undefined }, { ...event, at: 0 }, { ...event, at: 'not a date' },
      { ...event, at: '2026-10-28' }, { ...event, at: '2026-10-28T23:00:00' },
      { ...event, at: '2026-02-30T23:00:00Z' }, { ...event, at: '2025-02-29T23:00:00Z' },
      { ...event, at: '2026-13-01T23:00:00Z' }, { ...event, at: '2026-10-28T25:00:00Z' },
      { ...event, at: '2026-10-28T23:60:00Z' }, { ...event, at: '2026-10-28T23:00:60Z' },
      { ...event, at: '2026-10-28T23:00:00+24:00' }, { ...event, at: '2026-10-28T23:00:00+01:60' },
    ];
    const lines = [event, ...invalid, { ...event, owner: null, extra: true }]
      .map((value) => JSON.stringify(value));
    lines.splice(2, 0, '{broken', '  ', '\t');
    fs.writeFileSync(join(runsDir, `${night}.jsonl`), lines.join('\r\n'));
    expect(readNight(runsDir, night)).toEqual({
      night, badLines: invalid.length + 1, counts: { ok: 2, retry: 0, fail: 0 },
      rows: [{ job: event.job, owner: null, runs: 2, retries: 0, lastStatus: 'ok', lastError: null,
        firstAt: event.at, lastAt: event.at }],
    });
  });

  it('returns an empty aggregate for an entirely invalid file', () => {
    fs.writeFileSync(join(runsDir, `${night}.jsonl`), '{broken\nnull\n[]\n');
    expect(readNight(runsDir, night)).toEqual({
      night, rows: [], badLines: 3, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('uses instants across offsets and file order for ties, retaining the most recent recorded error', () => {
    writeEvents([
      { ...event, at: '2026-10-29T00:30:00+01:00', status: 'fail', error: 'latest error' },
      { ...event, at: '2026-10-29T01:00:00+02:00', owner: 'first', status: 'retry', error: 'old error' },
      { ...event, at: '2026-10-28T23:30:00Z', status: 'retry', error: 'tied error wins' },
      { ...event, at: '2026-10-28T22:00:00-02:00', owner: 'latest' },
      { ...event, at: '2026-10-29T00:00:00+01:00', owner: 'earliest tie', status: 'fail', error: 'older file tail' },
    ]);
    expect(readNight(runsDir, night)).toEqual({
      night, badLines: 0, counts: { ok: 1, retry: 2, fail: 2 },
      rows: [{ job: event.job, owner: 'latest', runs: 5, retries: 2, lastStatus: 'ok',
        lastError: 'tied error wins', firstAt: '2026-10-29T01:00:00+02:00', lastAt: '2026-10-28T22:00:00-02:00' }],
    });
  });

  it('uses earlier file order for firstAt and later file order for lastAt, owner and status on a tie', () => {
    writeEvents([
      { ...event, at: '2026-10-28T23:00:00+01:00', error: 'first error' },
      { ...event, at: '2026-10-28T22:00:00Z', status: 'fail', owner: null, error: 'last error' },
    ]);
    expect(readNight(runsDir, night)?.rows).toEqual([
      { job: event.job, owner: null, runs: 2, retries: 0, lastStatus: 'fail', lastError: 'last error',
        firstAt: '2026-10-28T23:00:00+01:00', lastAt: '2026-10-28T22:00:00Z' },
    ]);
  });

  it('accepts empty supplied errors and owners, fractional seconds and leap dates', () => {
    writeEvents([
      { ...event, at: '2024-02-29T22:00:00.001Z', status: 'fail', error: 'older' },
      { ...event, at: '2024-02-29T22:00:00.002Z', owner: '', error: '' },
    ]);
    expect(readNight(runsDir, night)?.rows[0]).toEqual({
      job: event.job, owner: '', runs: 2, retries: 0, lastStatus: 'ok', lastError: '',
      firstAt: '2024-02-29T22:00:00.001Z', lastAt: '2024-02-29T22:00:00.002Z',
    });
  });

  it('groups exact job names and sorts using JS string comparison', () => {
    const names = ['a', 'Z', '__proto__', 'constructor', 'a', 'A'];
    writeEvents(names.map((job) => ({ ...event, job })));
    const digest = readNight(runsDir, night);
    expect(digest?.rows.map(({ job, runs }) => [job, runs])).toEqual([
      ['A', 1], ['Z', 1], ['__proto__', 1], ['a', 2], ['constructor', 1],
    ]);
    expect(digest?.counts).toEqual({ ok: 6, retry: 0, fail: 0 });
  });

  it.each([
    '', '../2026-10-28', '../../etc/passwd', '/2026-10-28', '2026-10-28/..',
    '2026-10-28\\..', '2026-10-28\0', '2026-10-28\n', '2026-10-28.jsonl',
    '2026-1-28', '2026-00-28', '2026-13-01', '2026-10-00', '2026-10-32',
    '2026-04-31', '2026-02-29', '1900-02-29', '2026-10-28T00:00:00Z',
  ])('rejects invalid night %j before I/O', (invalidNight) => {
    const read = vi.mocked(fs.readFileSync);
    expect(() => readNight(runsDir, invalidNight)).toThrow(RangeError);
    expect(read).not.toHaveBeenCalled();
  });

  it.each(['2024-02-29', '2000-02-29', '2026-12-31'])('accepts valid calendar night %s', (validNight) => {
    fs.writeFileSync(join(runsDir, `${validNight}.jsonl`), '');
    expect(readNight(runsDir, validNight)?.night).toBe(validNight);
  });

  it.each(['EACCES', 'EIO', 'ENOTDIR'])('propagates %s without converting it to a missing night', (code) => {
    const failure = Object.assign(new Error('Cannot read run log'), { code });
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw failure; });
    expect(() => readNight(runsDir, night)).toThrow(failure);
  });

  it('propagates an actual filesystem error when the night path is a directory', () => {
    fs.mkdirSync(join(runsDir, `${night}.jsonl`));
    expect(() => readNight(runsDir, night)).toThrow(expect.objectContaining({ code: 'EISDIR' }));
  });
});
