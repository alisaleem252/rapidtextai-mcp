import { createInterface } from 'node:readline';
import { TOOLS, callTool } from './tools.js';

const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
const INFO = { name: 'rapidtextai-mcp', version: '1.0.0' };

/**
 * Minimal MCP server over stdio (newline-delimited JSON-RPC 2.0).
 * `client` is a RapidTextAI instance (or a stand-in with the same methods).
 */
export function createServer(client, { input = process.stdin, output = process.stdout, log = (m) => process.stderr.write(m + '\n') } = {}) {
  const inflight = new Map();           // request id -> AbortController
  let queue = Promise.resolve();        // RapidTextAI allows one job at a time per account, so tool calls are serialised
  const send = (msg) => output.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
  const reply = (id, result) => send({ id, result });
  const fail = (id, code, message) => send({ id, error: { code, message } });

  async function handle(msg) {
    const { id, method, params } = msg;
    const isRequest = id !== undefined && id !== null;
    try {
      switch (method) {
        case 'initialize': {
          const asked = params?.protocolVersion;
          return reply(id, {
            protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: INFO,
            instructions: 'Tools for writing researched articles and running SEO checks via the RapidTextAI API. Most tools consume request units; their descriptions state the cost. Only one job runs at a time.',
          });
        }
        case 'ping': return reply(id, {});
        case 'tools/list':
          return reply(id, { tools: TOOLS.map(({ name, description, inputSchema, readOnly }) => ({
            name, description, inputSchema,
            annotations: { readOnlyHint: readOnly, openWorldHint: true, destructiveHint: false },
          })) });
        case 'tools/call': {
          const { name, arguments: args, _meta } = params || {};
          const ac = new AbortController();
          inflight.set(id, ac);
          const token = _meta?.progressToken;
          let n = 0;
          const ctx = {
            signal: ac.signal,
            onEvent: (e) => {
              if (token === undefined || e.type === 'result') return;
              const message = e.detail || e.heading || e.stage;
              if (message) send({ method: 'notifications/progress', params: { progressToken: token, progress: ++n, message: String(message) } });
            },
          };
          // Serialise: wait for earlier calls, but still answer promptly if cancelled while waiting.
          const run = queue.then(async () => {
            if (ac.signal.aborted) return null;
            try {
              const text = await callTool(name, args, client, ctx);
              return { content: [{ type: 'text', text }] };
            } catch (e) {
              if (ac.signal.aborted) return null;
              return { isError: true, content: [{ type: 'text', text: e.message }] };
            }
          });
          queue = run.catch(() => {});
          const result = await run;
          inflight.delete(id);
          if (result) reply(id, result);
          return;
        }
        case 'notifications/cancelled': inflight.get(params?.requestId)?.abort(); return;
        default:
          if (isRequest) return fail(id, -32601, `Method not found: ${method}`);
      }
    } catch (e) {
      log(`error handling ${method}: ${e.stack || e}`);
      if (isRequest) fail(id, -32603, e.message);
    }
  }

  const rl = createInterface({ input });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return fail(null, -32700, 'Parse error'); }
    handle(msg);
  });
  return { close: () => rl.close(), inflight };
}
