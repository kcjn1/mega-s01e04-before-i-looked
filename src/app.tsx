import { Hono } from 'hono';
import { loadConfig, type RigConfig } from './config.js';
import { lane } from './lane.js';
import { readStatus } from './status.js';
import { readNight } from './digest/reader.js';
import { DigestPage } from './views/digest.js';
import { Layout } from './views/layout.js';
import { StatusBoard } from './views/status.js';

export function createApp(config: RigConfig = loadConfig()) {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, lane: lane().id }));

  app.get('/digest/:night', (c) => {
    let digest;
    try {
      digest = readNight(config.runsDir, c.req.param('night'));
    } catch (error: unknown) {
      if (error instanceof RangeError) return c.notFound();
      throw error;
    }
    if (!digest) return c.notFound();
    return c.html(<Layout title={`digest · ${digest.night}`} lane={lane()}><DigestPage night={digest.night} rows={digest.rows} badLines={digest.badLines} /></Layout>);
  });

  app.get('/api/digest/:night', (c) => {
    let digest;
    try {
      digest = readNight(config.runsDir, c.req.param('night'));
    } catch (error: unknown) {
      if (error instanceof RangeError) return c.notFound();
      throw error;
    }
    if (!digest) return c.notFound();
    return c.json(digest);
  });

  app.get('/', (c) =>
    c.html(
      <Layout title="status" lane={lane()}>
        <StatusBoard status={readStatus(config)} />
      </Layout>,
    ),
  );

  return app;
}
