import { createEngine, ensureSchema } from '../../bomdb/src/engine.ts';
import { buildApp } from './app.ts';

const token = process.env.TOKEN;
if (!token) throw new Error('TOKEN env var is required');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL env var is required');

const engine = await createEngine();
await ensureSchema(engine);

const port = Number(process.env.PORT ?? 8080);
buildApp(engine, token).listen(port, () =>
  console.log(`bomdb-remote listening on :${port}`),
);
