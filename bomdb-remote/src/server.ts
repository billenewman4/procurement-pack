import { createEngine, ensureSchema, type Engine } from '../../bomdb/src/engine.ts';
import { buildApp } from './app.ts';

/**
 * Token → DATABASE_URL map. Two env shapes, newest wins:
 *   TOKEN_MAP  — JSON: {"<token>": "<database_url>", ...}  (multi-user)
 *   TOKEN + DATABASE_URL — single-user fallback (Phase 1 deploys)
 */
function loadTokenMap(): Record<string, string> {
  if (process.env.TOKEN_MAP) {
    const map = JSON.parse(process.env.TOKEN_MAP) as Record<string, string>;
    if (Object.keys(map).length === 0) throw new Error('TOKEN_MAP is empty');
    return map;
  }
  const { TOKEN, DATABASE_URL } = process.env;
  if (!TOKEN || !DATABASE_URL) {
    throw new Error('Set TOKEN_MAP, or TOKEN and DATABASE_URL');
  }
  return { [TOKEN]: DATABASE_URL };
}

const tokenMap = loadTokenMap();
console.log(`bomdb-remote: ${Object.keys(tokenMap).length} token(s) configured`);

// Engines are created lazily on a token's first request and cached, so one
// user's bad credentials can't take the whole service down at boot.
const engineCache = new Map<string, Promise<Engine>>();

async function resolveEngine(token: string): Promise<Engine | null> {
  const url = tokenMap[token];
  if (!url) return null;
  let pending = engineCache.get(token);
  if (!pending) {
    pending = (async () => {
      const engine = await createEngine(url);
      await ensureSchema(engine);
      return engine;
    })();
    // Drop failed attempts so a transient DB outage isn't cached forever.
    pending.catch(() => engineCache.delete(token));
    engineCache.set(token, pending);
  }
  return pending;
}

const port = Number(process.env.PORT ?? 8080);
buildApp(resolveEngine).listen(port, () =>
  console.log(`bomdb-remote listening on :${port}`),
);
