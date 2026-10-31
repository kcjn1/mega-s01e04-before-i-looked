import type { DigestRow } from '../digest/types.js';

export function DigestPage({ night, rows, badLines }: { night: string; rows: DigestRow[]; badLines: number }) {
  return (
    <>
      <h1>digest · {night}</h1>
      {badLines > 0 && <p class="warn">{badLines} bad {badLines === 1 ? 'line' : 'lines'} skipped</p>}
      {rows.length === 0 ? <p class="mute">nothing ran</p> : (
        <div class="digest-scroll" role="region" aria-label={`Digest for ${night}`} tabindex={0}>
          <table class="digest-table">
            <caption>Job runs for {night}</caption>
            <thead><tr><th scope="col">Job</th><th scope="col">Owner</th><th scope="col">Runs</th><th scope="col">Retries</th><th scope="col">Last status</th><th scope="col">Last error</th><th scope="col">First time</th><th scope="col">Last time</th></tr></thead>
            <tbody>{rows.map((row) => <tr>
              <td>{row.job}</td><td>{row.owner ?? 'not provided'}</td><td>{row.runs}</td>
              <td>{row.retries >= 3 ? <span class="warn">{row.retries} retries, warning</span> : row.retries}</td>
              <td>{row.lastStatus === 'fail' ? <span class="warn">fail, warning</span> : row.lastStatus}</td>
              <td>{row.lastError ?? 'not provided'}</td><td>{row.firstAt}</td><td>{row.lastAt}</td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
