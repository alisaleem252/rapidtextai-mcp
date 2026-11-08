import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createServer as createHttp } from 'node:http';
import { createServer } from '../src/server.js';
import { RapidTextAI } from '../src/api.js';
import { TOOLS } from '../src/tools.js';

// Fake RapidTextAI API
const article = { title: 'T', meta_description: 'M', body_markdown: 'Body', word_count: 1000, quality: { score: 90 }, tags: ['a'], faq: [{ q: 'Q', a: 'A' }], sources: [{ title: 'S', url: 'https://e.com' }] };
function fakeApi(hits) {
  return createHttp((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      hits.push({ url: req.url, auth: req.headers.authorization, body: b ? JSON.parse(b) : null });
      if (req.url.includes('/v1/models')) { res.setHeader('Content-Type', 'application/json'); return res.end('{"data":[{"id":"gpt-4o-mini"},{"id":"deepseek-chat"}]}'); }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"type":"progress","stage":"search","detail":"looking"}\n\n');
      const data = req.url.includes('article') ? article : req.url.includes('originality') ? { score: 88, checked: 8, matched: 1, matches: [] } : { keyword: 'k', target_words: 1000, median_words: 900, outline: { sections: ['A'] } };
      res.write(`data: ${JSON.stringify({ type: 'result', data })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
}

async function setup() {
  const hits = []; const http = fakeApi(hits).listen(0);
  const client = new RapidTextAI({ apiKey: 'k1', baseUrl: `http://127.0.0.1:${http.address().port}/openai` });
  const input = new PassThrough(), output = new PassThrough();
  const srv = createServer(client, { input, output, log: () => {} });
  const lines = []; let waiters = [];
  output.on('data', (d) => d.toString().split('\n').filter(Boolean).forEach((l) => { const m = JSON.parse(l); lines.push(m); waiters = waiters.filter((w) => !w(m)); }));
  const rpc = (msg) => new Promise((resolve) => {
    if (msg.id !== undefined) waiters.push((m) => (m.id === msg.id ? (resolve(m), true) : false)); else resolve();
    input.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
  });
  return { rpc, lines, hits, close: () => { srv.close(); http.close(); } };
}

test('initialize negotiates version and advertises tools', async () => {
  const s = await setup();
  const r = await s.rpc({ id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
  assert.equal(r.result.protocolVersion, '2024-11-05');
  assert.ok(r.result.capabilities.tools);
  assert.equal((await s.rpc({ id: 2, method: 'initialize', params: { protocolVersion: '1999' } })).result.protocolVersion, '2025-06-18');
  s.close();
});

test('tools/list exposes every tool with a schema and annotations', async () => {
  const s = await setup();
  const r = await s.rpc({ id: 1, method: 'tools/list' });
  assert.equal(r.result.tools.length, TOOLS.length);
  assert.deepEqual(r.result.tools.map((t) => t.name).sort(), ['brand_from_url', 'check_capabilities', 'competitor_gap', 'content_refresh', 'fact_check', 'find_embeds', 'generate_article', 'list_models', 'originality_check']);
  for (const t of r.result.tools) { assert.equal(t.inputSchema.type, 'object'); assert.ok(t.description.length > 20); }
  s.close();
});

test('generate_article calls the API with bearer auth and returns markdown', async () => {
  const s = await setup();
  const r = await s.rpc({ id: 1, method: 'tools/call', params: { name: 'generate_article', arguments: { topic: 'x', word_count: 800, tone: '' } } });
  assert.ok(!r.result.isError);
  assert.match(r.result.content[0].text, /# T[\s\S]*Body[\s\S]*## FAQ[\s\S]*## Sources/);
  const hit = s.hits.find((h) => h.url.split('?')[0].endsWith('/v2/article/generate'));
  assert.equal(hit.auth, 'Bearer k1');
  assert.deepEqual({ ...hit.body, stream: undefined }, { topic: 'x', word_count: 800, stream: undefined });
  s.close();
});

test('SEO tools validate input before any API call (no units wasted)', async () => {
  const s = await setup();
  const r = await s.rpc({ id: 1, method: 'tools/call', params: { name: 'fact_check', arguments: {} } });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /Provide/);
  assert.equal(s.hits.length, 0);
  s.close();
});

test('SEO tool results come back as readable markdown', async () => {
  const s = await setup();
  const o = await s.rpc({ id: 1, method: 'tools/call', params: { name: 'originality_check', arguments: { text: 'hello' } } });
  assert.match(o.result.content[0].text, /Score: 88/);
  const g = await s.rpc({ id: 2, method: 'tools/call', params: { name: 'competitor_gap', arguments: { keyword: 'k' } } });
  assert.match(g.result.content[0].text, /Competitor gap: k/);
  s.close();
});

test('progress notifications are sent only when a progressToken is given', async () => {
  const s = await setup();
  await s.rpc({ id: 1, method: 'tools/call', params: { name: 'originality_check', arguments: { text: 'a' }, _meta: { progressToken: 'p1' } } });
  const p = s.lines.filter((m) => m.method === 'notifications/progress');
  assert.equal(p.length, 1);
  assert.equal(p[0].params.progressToken, 'p1');
  const before = s.lines.length;
  await s.rpc({ id: 2, method: 'tools/call', params: { name: 'originality_check', arguments: { text: 'a' } } });
  assert.equal(s.lines.slice(before).filter((m) => m.method === 'notifications/progress').length, 0);
  s.close();
});

test('list_models, unknown tool and unknown method', async () => {
  const s = await setup();
  assert.match((await s.rpc({ id: 1, method: 'tools/call', params: { name: 'list_models' } })).result.content[0].text, /gpt-4o-mini/);
  assert.equal((await s.rpc({ id: 2, method: 'tools/call', params: { name: 'nope' } })).result.isError, true);
  assert.equal((await s.rpc({ id: 3, method: 'bogus/method' })).error.code, -32601);
  assert.deepEqual((await s.rpc({ id: 4, method: 'ping' })).result, {});
  s.close();
});
