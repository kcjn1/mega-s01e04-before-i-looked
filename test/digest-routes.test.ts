import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';

const night = '2026-10-28';
const dirs: string[] = [];
const config = (runsDir: string) => ({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir });
function tempRuns() {
  const dir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe.each(['/digest', '/api/digest'])('%s/:night routes', (route) => {
  it.each([['normal', '200'], ['absent', '404'], ['empty', '200'], ['malformed', '200']])('%s input returns %s', async (kind, status) => {
    const dir = tempRuns();
    if (kind === 'normal') writeFileSync(join(dir, `${night}.jsonl`), JSON.stringify({ at: `${night}T00:00:00+01:00`, job: 'job', status: 'ok', owner: null }));
    if (kind === 'empty') writeFileSync(join(dir, `${night}.jsonl`), '');
    if (kind === 'malformed') writeFileSync(join(dir, `${night}.jsonl`), '{broken\n' + JSON.stringify({ at: `${night}T00:00:00+01:00`, job: 'valid', status: 'ok', owner: 'rook' }));
    const res = await createApp(config(dir)).request(`${route}/${night}`);
    expect(res.status).toBe(Number(status));
    if (kind === 'empty' && route === '/digest') expect(await res.text()).toContain('nothing ran');
    if (kind === 'empty' && route === '/api/digest') expect(await res.json()).toMatchObject({ rows: [], counts: { ok: 0, retry: 0, fail: 0 } });
    if (kind === 'malformed' && route === '/api/digest') expect(await res.json()).toMatchObject({ badLines: 1, rows: [{ job: 'valid' }] });
    if (kind === 'malformed' && route === '/digest') {
      const html = await res.text();
      expect(html).toContain('1 bad line skipped');
      expect(html).toContain('<td>valid</td>');
    }
  });

  it('returns 404 for an invalid calendar night', async () => {
    expect((await createApp(config(tempRuns())).request(`${route}/2026-02-30`)).status).toBe(404);
  });

  it('keeps a real I/O failure distinct from a missing file', async () => {
    const dir = tempRuns();
    mkdirSync(join(dir, `${night}.jsonl`));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await createApp(config(dir)).request(`${route}/${night}`)).status).toBe(500);
  });
});

describe('digest representation', () => {
  it('keeps HTML and JSON jobs in the same sorted order, preserves missing owners and offsets, and marks retries and failures', async () => {
    const dir = tempRuns();
    const events = [
      { at: `${night}T01:00:00+01:00`, job: 'z-last', status: 'fail', owner: 'rook', error: 'quota' },
      ...[0, 1, 2].map((minute) => ({ at: `${night}T00:0${minute}:00+02:00`, job: 'a-first', status: 'retry', owner: null })),
      { at: `${night}T00:03:00+02:00`, job: 'a-first', status: 'ok', owner: null },
    ];
    writeFileSync(join(dir, `${night}.jsonl`), events.map((event) => JSON.stringify(event)).join('\n'));
    const app = createApp(config(dir));
    const htmlResponse = await app.request(`/digest/${night}`);
    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(htmlResponse.headers.get('content-type')).toContain('text/html');
    expect(jsonResponse.headers.get('content-type')).toContain('application/json');
    const html = await htmlResponse.text();
    const digest = await jsonResponse.json();
    const htmlJobs = [...html.matchAll(/<tr><td>([^<]*)<\/td>/g)].map((match) => match[1]);
    expect(htmlJobs).toEqual(['a-first', 'z-last']);
    expect(digest.rows.map((row: { job: string }) => row.job)).toEqual(htmlJobs);
    expect(digest.rows[0]).toMatchObject({ owner: null, runs: 4, retries: 3, firstAt: `${night}T00:00:00+02:00`, lastAt: `${night}T00:03:00+02:00` });
    expect(digest.counts).toEqual({ ok: 1, retry: 3, fail: 1 });
    expect(html).toContain('not provided');
    expect(html).toContain(`${night}T00:03:00+02:00`);
    expect(html).toMatch(/class="warn">3 retries/);
    expect(html).toMatch(/class="warn">fail/);
  });

  it('escapes untrusted fields and produces a self-contained page without executable client markup', async () => {
    const dir = tempRuns();
    const event = { at: `${night}T01:00:00+01:00`, job: '<script>alert(1)</script>', status: 'fail', owner: '<img src=x onerror=alert(1)>', error: '<svg onload=alert(1)>' };
    writeFileSync(join(dir, `${night}.jsonl`), JSON.stringify(event));
    const app = createApp(config(dir));
    const html = await (await app.request(`/digest/${night}`)).text();
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&lt;svg');
    expect(html).not.toMatch(/<(script|img|svg)\b/i);
    expect(html.match(/<style>/g)).toHaveLength(1);
    expect(html).not.toMatch(/(?:src|href)=["'](?:https?:)?\/\//i);
    expect((await (await app.request(`/api/digest/${night}`)).json()).rows[0]).toMatchObject({ job: event.job, owner: event.owner, lastError: event.error });
  });
});
