import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, DigestStatus, NightDigest, ReadNight } from './types.js';

type Event = {
  at: string;
  job: string;
  status: DigestStatus;
  owner: string | null;
  error?: string;
};

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const instant = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === value;
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  return parts !== null && isDate(parts[1]) &&
    Number(parts[2]) < 24 && Number(parts[3]) < 60 && Number(parts[4]) < 60 &&
    (parts[5] === 'Z' || (Number(parts[6]) < 24 && Number(parts[7]) < 60)) &&
    Number.isFinite(Date.parse(value));
}

function isEvent(value: unknown): value is Event {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return 'at' in value && isTimestamp(value.at) &&
    'job' in value && typeof value.job === 'string' && value.job.length > 0 &&
    'status' in value && (value.status === 'ok' || value.status === 'retry' || value.status === 'fail') &&
    'owner' in value && (value.owner === null || typeof value.owner === 'string') &&
    (!('error' in value) || typeof value.error === 'string');
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!isDate(night)) throw new RangeError('Night must be a valid YYYY-MM-DD date');

  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const digest: NightDigest = { night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
  const jobs = new Map<string, { row: DigestRow; first: number; last: number; errorAt: number }>();

  for (const line of contents.split('\n')) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      digest.badLines++;
      continue;
    }
    if (!isEvent(parsed)) {
      digest.badLines++;
      continue;
    }

    const instant = Date.parse(parsed.at);
    digest.counts[parsed.status]++;
    const job = jobs.get(parsed.job);
    if (!job) {
      jobs.set(parsed.job, {
        row: {
          job: parsed.job, owner: parsed.owner, runs: 1,
          retries: parsed.status === 'retry' ? 1 : 0,
          lastStatus: parsed.status, lastError: parsed.error ?? null,
          firstAt: parsed.at, lastAt: parsed.at,
        },
        first: instant, last: instant,
        errorAt: parsed.error === undefined ? -Infinity : instant,
      });
      continue;
    }

    job.row.runs++;
    if (parsed.status === 'retry') job.row.retries++;
    if (instant < job.first) {
      job.first = instant;
      job.row.firstAt = parsed.at;
    }
    if (instant >= job.last) {
      job.last = instant;
      job.row.lastAt = parsed.at;
      job.row.owner = parsed.owner;
      job.row.lastStatus = parsed.status;
    }
    if (parsed.error !== undefined && instant >= job.errorAt) {
      job.errorAt = instant;
      job.row.lastError = parsed.error;
    }
  }

  digest.rows = [...jobs.values()].map(({ row }) => row)
    .sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return digest;
};
