/** Status of one valid run-log event. */
export type DigestStatus = 'ok' | 'retry' | 'fail';

/** Counts of valid events, not jobs or their final statuses. */
export type DigestCounts = Record<DigestStatus, number>;

/** One job's aggregate across all valid events in the requested file. */
export type DigestRow = {
  job: string;
  /** Owner on the latest event. Render null as "not provided". */
  owner: string | null;
  /** Total valid events for this job, including retries and failures. */
  runs: number;
  /** Events with status "retry", a subset of runs. */
  retries: number;
  lastStatus: DigestStatus;
  /** Error on the latest event, or null if absent. Do not retain old errors. */
  lastError: string | null;
  /** Earliest event's original timestamp string, including its offset. */
  firstAt: string;
  /** Latest event's original timestamp string, including its offset. */
  lastAt: string;
};

/** Result for an existing file, including an empty or entirely invalid file. */
export type NightDigest = {
  /** File's YYYY-MM-DD identifier, not the calendar date of every event. */
  night: string;
  /** One row per exact job name, sorted ascending by JS string comparison. */
  rows: DigestRow[];
  /** Nonblank lines with invalid JSON or an invalid event shape. */
  badLines: number;
  /** Shared board totals. Their sum equals the sum of all row runs. */
  counts: DigestCounts;
};

/**
 * Contract only: this module exports types, never a runtime readNight function.
 * The later implementation belongs in src/digest/reader.ts as:
 *   export const readNight: ReadNight = (runsDir, night) => { ... };
 * From src/app.tsx, import types from './digest/types.js' using import type;
 * import the future readNight value from './digest/reader.js'.
 *
 * Read runsDir/<night>.jsonl synchronously as UTF-8. Night must be a valid
 * calendar date in YYYY-MM-DD form; invalid input throws RangeError before I/O.
 * ENOENT returns null so both routes can return 404. Other I/O errors propagate.
 * Empty files return { night, rows: [], badLines: 0,
 * counts: { ok: 0, retry: 0, fail: 0 } }. Blank lines are ignored.
 * Invalid nonblank lines increment badLines once and do not affect aggregates.
 * An entirely invalid file returns empty rows and zero counts with badLines > 0.
 *
 * A valid event has a nonempty string job, a valid ISO 8601 at timestamp with
 * an explicit offset (Z is allowed), a DigestStatus status, and a string or
 * null owner. Optional error must be a string when present. Ignore extra keys.
 * Group all valid events in the file, including those after midnight.
 * Compare timestamps by their instant, not their string or file order, but
 * preserve the original strings for display. For equal instants, earlier file
 * order wins firstAt and later file order wins lastAt and the latest event.
 * Take owner, lastStatus and lastError from that same latest event.
 * counts totals every valid event by status, even when a retry later succeeds.
 */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
