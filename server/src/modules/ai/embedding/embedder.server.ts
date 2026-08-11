/*
 * The embedding sidecar.
 *
 * A separate process for one measured reason: the API is 110 MB of RSS on its own, the model adds
 * ~352 MB, and PERF-07 caps the backend at 450 MB. In-process is 462 MB at idle — over budget before
 * a single request. Out of process the API stays at 110 MB and the model's memory is somebody
 * else's problem, which is also how the reference architecture in ContainerComponentDiagram.pdf
 * runs its Python inference (newline-delimited JSON over local TCP; this is the same shape over
 * local HTTP, which needs no framing protocol of our own).
 *
 * It binds loopback only. There is no authentication because there is nothing to authenticate: it
 * takes text and returns vectors, holds no data, and is not reachable from outside the host.
 *
 * Run it with: npm run ai:embedder
 */

import { createServer } from 'node:http';
import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, embedderPort } from './embedding.config.js';

// Keep model files inside the repo rather than the user profile, so a teammate can see what was
// downloaded and delete it, and so CI caching has one obvious directory.
env.cacheDir = './.models';

let extractor: FeatureExtractionPipeline | null = null;

async function load(): Promise<FeatureExtractionPipeline> {
  if (extractor) return extractor;
  // `q8`: measured at 3/4 on a Vietnamese relevance probe with a 0.30 score spread, against fp32's
  // 2/4 for the alternative model. `fp16` is not an option — it fails ONNX Runtime graph
  // initialisation on this build.
  extractor = await pipeline('feature-extraction', EMBEDDING_MODEL, { dtype: 'q8' });
  return extractor;
}

async function embed(texts: string[]): Promise<number[][]> {
  const model = await load();
  // Mean pooling and L2 normalisation, which is what this model's sentence-transformer head does
  // and what the cosine index downstream assumes.
  const output = await model(texts, { pooling: 'mean', normalize: true });
  return output.tolist() as number[][];
}

const server = createServer((req, res) => {
  const reply = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (req.method === 'GET' && req.url === '/health') {
    reply(200, { ok: true, model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS, loaded: Boolean(extractor) });
    return;
  }
  if (req.method !== 'POST' || req.url !== '/embed') {
    reply(404, { error: 'not_found' });
    return;
  }

  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    // A guard, not a policy: the indexer batches, and a runaway request should fail fast rather
    // than buffer the heap away.
    if (body.length > 2_000_000) req.destroy();
  });
  req.on('end', () => {
    void (async () => {
      try {
        const parsed = JSON.parse(body) as { texts?: unknown };
        const texts = Array.isArray(parsed.texts) ? parsed.texts.filter((t) => typeof t === 'string') : [];
        if (!texts.length) {
          reply(400, { error: 'texts_required' });
          return;
        }
        reply(200, { embeddings: await embed(texts as string[]) });
      } catch (error) {
        console.error('[embedder] failed:', error instanceof Error ? error.message : error);
        reply(500, { error: 'embed_failed' });
      }
    })();
  });
});

const port = embedderPort();
server.listen(port, '127.0.0.1', () => {
  console.warn(`[embedder] listening on 127.0.0.1:${port} (${EMBEDDING_MODEL})`);
  // Warm at startup, never on the first request: loading takes ~8 s and that must not be somebody's
  // first question.
  void load()
    .then(() => console.warn('[embedder] model ready'))
    .catch((error) => {
      console.error('[embedder] model failed to load:', error);
      process.exit(1);
    });
});
